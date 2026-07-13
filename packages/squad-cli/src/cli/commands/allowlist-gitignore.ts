/**
 * Shared allowlist-aware managed `.gitignore` installer (piece 51, sub-proposals C/D).
 *
 * Both `init` (orphan backend) and `install-fold-pipeline` need to keep the ephemeral
 * `.squad/` state that the fold pipeline transports — and the machine-local scratch that is
 * never transported — off the product branch. This module owns the single managed-block
 * writer so the two commands stay in lockstep instead of drifting between copies.
 *
 * It NEVER writes a blanket `.squad/` ignore: only the explicit publish allowlist paths
 * (which fold to the state branch) plus the machine-local scratch declared here. A blanket
 * `.squad/` ignore is the Pole-A change (piece 52), gated on the durable lane existing.
 *
 * @module cli/commands/allowlist-gitignore
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLISH_ALLOWLIST_EXACT, PUBLISH_ALLOWLIST_PREFIX } from './sync.js';

/**
 * Machine-local / pipeline-owned scratch paths (piece 51, sub-proposal C).
 *
 * None of these are on the publish allowlist, so they already never transport — declaring
 * them here makes the exclusion explicit and keeps them out of any product commit:
 *   - `raw-agent-output.md`, `run-output.md`, `publish-metadata.json` — per-run scratch.
 *   - `publish-history.json` — written solely by the fold pipeline on the state branch;
 *     folding a locally-mutated copy would race, so the team-root copy is machine-local.
 *   - `.last-hydrate-sha`, `.first-run` — pipeline sentinels (per the managed-block reference).
 */
export const PUBLISH_MACHINE_LOCAL = [
  '.squad/raw-agent-output.md',
  '.squad/run-output.md',
  '.squad/publish-metadata.json',
  '.squad/publish-history.json',
  '.squad/.last-hydrate-sha',
  '.squad/.first-run',
];

const BLOCK_START = '# --- squad (managed) ---';
const BLOCK_END = '# --- end squad (managed) ---';

/**
 * All paths the managed block governs, in a stable order, prefixed for the host layout.
 * `pathPrefix` is `''` for a root-hosted squad and `'<callsign>/'` for a subfolder host,
 * so a git-root `.gitignore` can scope the block to `<callsign>/.squad/**`.
 */
export function managedGitignorePaths(pathPrefix = ''): string[] {
  return [
    ...PUBLISH_ALLOWLIST_EXACT,
    ...PUBLISH_ALLOWLIST_PREFIX,
    ...PUBLISH_MACHINE_LOCAL,
  ].map(p => `${pathPrefix}${p}`);
}

function buildManagedBlock(pathPrefix: string): string {
  const pre = (p: string): string => `${pathPrefix}${p}`;
  return [
    BLOCK_START,
    '# Ephemeral state is transported to the state branch by the fold pipeline, not committed here.',
    ...PUBLISH_ALLOWLIST_EXACT.map(pre),
    ...PUBLISH_ALLOWLIST_PREFIX.map(pre),
    '# Machine-local scratch / pipeline-owned -- never transported, never committed.',
    ...PUBLISH_MACHINE_LOCAL.map(pre),
    BLOCK_END,
  ].join('\n');
}

/**
 * Insert or replace the marker-delimited managed block within an existing `.gitignore`
 * body. Idempotent: a re-run fully replaces the previous block rather than appending.
 */
function upsertManagedBlock(existing: string, block: string): string {
  const startIdx = existing.indexOf(BLOCK_START);
  if (startIdx !== -1) {
    const endMarkerIdx = existing.indexOf(BLOCK_END, startIdx);
    const before = existing.slice(0, startIdx);
    // If the end marker is missing (a hand-truncated block), replace from the start
    // marker to end-of-file rather than appending a second block — otherwise a later
    // re-run would splice out any user lines sitting between the orphan marker and the
    // appended block. This keeps the "fully replace, idempotent" guarantee intact.
    const after = endMarkerIdx !== -1 ? existing.slice(endMarkerIdx + BLOCK_END.length) : '';
    return `${before}${block}${after}`;
  }
  if (existing.length === 0) return `${block}\n`;
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}\n`;
}

export interface ApplyManagedGitignoreResult {
  /** Number of already-tracked managed paths that were `git rm --cached`-ed. */
  untracked: number;
  /** Whether the `.gitignore` file content changed. */
  changed: boolean;
}

/**
 * Install (or refresh) the allowlist-aware managed `.gitignore` block at `repoRoot` and
 * `git rm --cached` any already-tracked managed paths, so folded/hydrated ephemeral state
 * is structurally invisible to the product branch (`git add -A` cannot sweep it in).
 *
 * The block is delimited by markers and fully replaced on re-run (idempotent, safe on a
 * host `init` already configured). NEVER writes a blanket `.squad/` ignore.
 *
 * @param repoRoot   Directory that receives the `.gitignore` (the git root for a subfolder host).
 * @param pathPrefix `''` for a root-hosted squad; `'<callsign>/'` for a subfolder host.
 */
export function applyManagedGitignore(repoRoot: string, pathPrefix = ''): ApplyManagedGitignoreResult {
  const managedPaths = managedGitignorePaths(pathPrefix);

  // Best-effort: untrack any already-tracked managed paths. A never-committed host has none.
  let untracked = 0;
  try {
    const lsOutput = execFileSync('git', ['ls-files', '--', ...managedPaths], {
      cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const tracked = lsOutput.trim().split('\n').filter(Boolean);
    if (tracked.length > 0) {
      execFileSync('git', ['rm', '-r', '--cached', '--', ...tracked], {
        cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'],
      });
      untracked = tracked.length;
    }
  } catch {
    /* not a git repo, or nothing tracked — still install the ignore block below */
  }

  const gitignorePath = path.join(repoRoot, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(gitignorePath, 'utf-8'); } catch { /* absent — create it */ }
  const next = upsertManagedBlock(existing, buildManagedBlock(pathPrefix));
  const changed = next !== existing;
  if (changed) fs.writeFileSync(gitignorePath, next, 'utf-8');
  return { untracked, changed };
}
