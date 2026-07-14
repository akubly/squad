/**
 * Guarded Pole-B → Pole-A migration (piece 52, sub-proposals A + B).
 *
 * The Pole-A blanket ignore untracks the WHOLE `<prefix>.squad` subtree from the product
 * branch. Because that subtree can hold the durable constitution, the untrack is DESTRUCTIVE
 * unless every removed file is first captured by a lane. This module is the single safety gate
 * both wirings (`squad init` and `install-fold-pipeline`) route through so the untrack runs
 * only when it cannot lose durable content.
 *
 * Two guards, both fail SAFE (skip the untrack, leave `.squad` tracked):
 *   1. Totality — refuse if any tracked `.squad` path is `unclassified` (claimed by no lane);
 *      it would be removed from `main` and captured by nothing → lost on a fresh clone.
 *   2. Durable capture — never remove tracked DURABLE files unless they are captured on the
 *      reviewed `squad/config/<callsign>` orphan (seeded now, or already present).
 *
 * @module cli/commands/pole-a-migrate
 */

import { execFileSync } from 'node:child_process';
import { deriveConfigBranch, seedConfigOrphan } from './sync.js';
import { classifyTeamRootPath } from './team-root-classifier.js';
import { applyBlanketGitignore } from './allowlist-gitignore.js';

export interface PoleAMigrateResult {
  /** True when the blanket ignore block was installed (guards passed). */
  installed: boolean;
  /** Number of `.squad` paths removed from the index. */
  untracked: number;
  /** Config branch created by this call, when genesis ran. */
  seededBranch?: string;
  /** Set when a guard blocked the untrack; the reason names which guard. */
  aborted?: 'unclassified' | 'unseedable-durable';
  /** Tracked paths with no owning lane (only when `aborted === 'unclassified'`). */
  unclassified?: string[];
}

export interface PoleAMigrateOptions {
  /** Git repo root where `.gitignore` and `git rm` run. */
  repoRoot: string;
  /** Team root whose `.squad/**` durable files seed the config orphan. */
  teamRoot: string;
  /** `''` for a root host, `'<callsign>/'` for a subfolder host. */
  pathPrefix: string;
  /** Callsign used to derive the config branch when one isn't supplied. */
  callsign?: string;
  /** Explicit config branch (overrides callsign derivation). */
  configBranch?: string;
  /** When set, seed the durable orphan on a remote instead of a local ref. */
  remote?: string;
}

/**
 * Perform the guarded Pole-B → Pole-A migration for one team root. Returns without untracking
 * (and with `aborted` set) whenever removing tracked content could lose the constitution.
 */
export async function migratePoleBToA(opts: PoleAMigrateOptions): Promise<PoleAMigrateResult> {
  const { repoRoot, teamRoot, pathPrefix, callsign, remote } = opts;

  // Enumerate `.squad` paths tracked on the product branch (relative to repoRoot).
  let tracked: string[] = [];
  try {
    const out = execFileSync('git', ['ls-files', '--', `${pathPrefix}.squad`], {
      cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    tracked = out.trim().split('\n').filter(Boolean);
  } catch {
    // Not a git repo — nothing tracked; the blanket ignore block is still installed below.
  }

  // Classify each tracked path (strip the subfolder prefix so paths are team-root relative).
  const toTeamRel = (p: string): string =>
    (pathPrefix && p.startsWith(pathPrefix) ? p.slice(pathPrefix.length) : p);
  const unclassified: string[] = [];
  let hasDurableTracked = false;
  for (const p of tracked) {
    const lane = classifyTeamRootPath(toTeamRel(p));
    if (lane === 'unclassified') unclassified.push(p);
    else if (lane === 'durable') hasDurableTracked = true;
  }

  // Guard 1 (totality): a path with no owning lane would be removed and captured by nothing.
  if (unclassified.length > 0) {
    return { installed: false, untracked: 0, aborted: 'unclassified', unclassified };
  }

  // Establish / verify the durable config orphan. When durable content is tracked this is a
  // precondition for the untrack; for a greenfield host it is best-effort lane establishment.
  const configBranch = deriveConfigBranch(opts.configBranch, callsign);
  let seededBranch: string | undefined;
  let durableCaptured = false;
  if (configBranch) {
    try {
      // `seeded: true` — created now; `seeded: false` — branch already exists (durable present).
      const res = await seedConfigOrphan(teamRoot, configBranch, remote ? { remote } : {});
      durableCaptured = true;
      if (res.seeded) seededBranch = configBranch;
    } catch {
      durableCaptured = false;
    }
  }

  // Guard 2 (durable capture): never remove tracked durable files that no config orphan holds.
  if (hasDurableTracked && !durableCaptured) {
    return { installed: false, untracked: 0, aborted: 'unseedable-durable' };
  }

  // Guards passed (or nothing durable is at risk). Untrack + install the blanket ignore block.
  const { untracked } = applyBlanketGitignore(repoRoot, pathPrefix);
  return { installed: true, untracked, seededBranch };
}
