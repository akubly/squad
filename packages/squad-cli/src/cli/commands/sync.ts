/**
 * Squad Sync — synchronizes squad-state branches and git notes with a remote.
 *
 * Used directly (`squad sync`) or invoked by git hooks (pre-push, post-merge, post-rewrite).
 * Handles both orphan and two-layer backends transparently.
 *
 * Design:
 * - Fetches remote squad-state branch(es) and fast-forwards local refs
 * - Pushes local squad-state branch(es) to remote
 * - For two-layer, also syncs refs/notes/squad* namespaces
 * - Uses fast-forward-only semantics to avoid data loss on divergence
 * - Recursion guard via SQUAD_SYNC_ACTIVE env var
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { INBOX_HANDLE_RE, CALLSIGN_RE } from '@bradygaster/squad-sdk/validation';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import { SquadError } from '../core/errors.js';

const SQUAD_SYNC_ENV = 'SQUAD_SYNC_ACTIVE';
const STATE_BRANCH_PREFIX = 'squad-state';

export interface SyncOptions {
  direction: 'push' | 'pull' | 'both';
  remote?: string;
  cwd?: string;
  quiet?: boolean;
  /** Inbox handle for cross-repo inbox publish. Primary flag (--inbox-handle). */
  inboxHandle?: string;
  /** @deprecated Use inboxHandle instead. Retained as a deprecated alias (--developer). */
  developer?: string;
  /** Dry-run: print pending files and target branch info without publishing. */
  dryRun?: boolean;
  /**
   * Publish the durable config lane (piece 53 §A): snapshot TEAM_ROOT filtered to
   * `CONFIG_ALLOWLIST` and push to `squad/config-inbox/<callsign>/<handle>/<ts>`. Independent of
   * the ephemeral `--push`; both may run in one invocation.
   */
  pushConfig?: boolean;
  /**
   * When set with `pushConfig`, publish ONLY the durable lane — suppress the ephemeral state
   * push/pull that `direction` would otherwise drive. Set by the CLI when `--push-config` is the
   * sole direction flag so a bare `squad sync --push-config` does not also fold ephemeral state.
   */
  pushConfigOnly?: boolean;
  /**
   * Alternate registry path (matches `init`'s `--registry-path`). A file path, or a directory
   * in which `registry.json` is resolved (per the SDK's `resolveRegistryPath`). When absent,
   * the default user registry is used.
   */
  registryPath?: string;
}

/**
 * Detect the configured state backend from .squad/config.json
 */
function detectBackend(cwd: string): string | null {
  try {
    const configPath = path.join(cwd, '.squad', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return config.stateBackend || null;
  } catch {
    return null;
  }
}

/**
 * Get git repo root for the given working directory.
 */
function getRepoRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Discover all local squad-state branches (supports subsquads).
 * Uses strict prefix matching: squad-state or squad-state/<name>
 */
function discoverStateBranches(cwd: string): string[] {
  try {
    const output = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', `refs/heads/${STATE_BRANCH_PREFIX}`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const exact = output ? output.split('\n').filter(Boolean) : [];

    // Also find squad-state/* (subsquad branches)
    const subOutput = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', `refs/heads/${STATE_BRANCH_PREFIX}/`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const subs = subOutput ? subOutput.split('\n').filter(Boolean) : [];

    return [...exact, ...subs];
  } catch {
    return [];
  }
}

/**
 * Discover remote squad-state branches.
 */
function discoverRemoteStateBranches(cwd: string, remote: string): string[] {
  try {
    const output = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}/${STATE_BRANCH_PREFIX}`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const exact = output ? output.split('\n').filter(Boolean) : [];

    const subOutput = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}/${STATE_BRANCH_PREFIX}/`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const subs = subOutput ? subOutput.split('\n').filter(Boolean) : [];

    return [...exact, ...subs];
  } catch {
    return [];
  }
}

/**
 * Resolve the default remote for the current branch.
 *
 * Precedence:
 *   1. the current branch's tracking remote (`branch.<name>.remote`) when it names a
 *      configured remote (git stores `.` for local-tracking branches and can retain stale
 *      names, so the tracking value is only honored when it is a real remote);
 *   2. else, when exactly one remote is configured, that sole remote (even when it is not
 *      named `origin`);
 *   3. else `origin` only when a remote named `origin` actually exists;
 *   4. else fail with an actionable error directing the operator to set `stateRemote`
 *      (deterministic — the resolver never guesses among several remotes).
 *
 * The failure is thrown as a `SquadError` so the CLI entrypoint surfaces it as a clean
 * `✗ <message>` rather than an unhandled crash.
 */
export function resolveRemote(cwd: string): string {
  // Enumerate configured remotes up front: the tracking remote is only honored when it names
  // a real remote, and the sole-remote / origin-existence precedence needs the list anyway.
  let remotes: string[] = [];
  try {
    const out = execFileSync('git', ['remote'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    remotes = out ? out.split('\n').map(r => r.trim()).filter(Boolean) : [];
  } catch {
    remotes = [];
  }

  // 1. The current branch's tracking remote, when it names a configured remote.
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const tracking = execFileSync('git', ['config', `branch.${branch}.remote`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (tracking && remotes.includes(tracking)) return tracking;
  } catch {
    // No HEAD branch or no tracking config — fall through to the remote-list precedence.
  }

  // 2. Exactly one remote configured — select it, even when not named `origin`.
  if (remotes.length === 1) return remotes[0]!;

  // 3. `origin` only when it actually exists.
  if (remotes.includes('origin')) return 'origin';

  // 4. Ambiguous (multiple remotes, none `origin`) or none — fail with guidance.
  throw new SquadError(
    `squad sync: cannot determine the git remote for "${cwd}".\n` +
    (remotes.length === 0
      ? `  No remotes are configured.\n`
      : `  Multiple remotes are configured (${remotes.join(', ')}) and none is named "origin",\n` +
        `  and the current branch has no tracking remote.\n`) +
    `  Set an explicit state remote in the registry entry with 'stateRemote' so the resolver\n` +
    `  does not have to guess.`,
  );
}

/**
 * Resolve the effective state remote for a cross-repo team root, IN the team-root git
 * context (piece 50 §A).
 *
 * In cross-repo mode both transport halves run git with `cwd = teamRoot`, whose git directory
 * is the HOST clone — so the effective state remote must name a remote that exists in the host
 * clone, not in the product clone where `sync` is invoked. Precedence:
 *
 *   1. the registry entry's `stateRemote`, but ONLY when it resolves in the team-root git
 *      context (`git -C <teamRoot> remote get-url <name>` succeeds);
 *   2. else `resolveRemote(teamRoot)` — the host clone's own resolvable remote (piece 46 §A
 *      precedence: tracking remote; else sole remote; else `origin` when it exists);
 *   3. else fail with an actionable `SquadError` naming the HOST clone git root, the missing
 *      remote, and both remediations.
 *
 * A configured-but-absent `stateRemote` (the piece-50 dogfood failure) now falls through to
 * the host clone's resolvable remote instead of being passed to git unvalidated.
 */
export function resolveStateRemote(teamRoot: string, configuredStateRemote: string | undefined): string {
  // 1. Registry stateRemote, honored only when it exists in the team-root (host clone) context.
  if (configuredStateRemote) {
    try {
      execFileSync('git', ['-C', teamRoot, 'remote', 'get-url', configuredStateRemote], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return configuredStateRemote;
    } catch {
      // Configured but absent in the host clone — fall through to host-clone resolution.
    }
  }

  // 2. Fall back to the host clone's own resolvable remote.
  try {
    return resolveRemote(teamRoot);
  } catch {
    // 3. Nothing resolvable — fail with an error that points at the HOST clone, not the product.
    let hostRoot = teamRoot;
    try {
      hostRoot = execFileSync('git', ['-C', teamRoot, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || teamRoot;
    } catch { /* not a work tree — name the team root itself */ }

    throw new SquadError(
      `squad sync: cannot resolve the cross-repo state remote in the host clone at "${hostRoot}".\n` +
      (configuredStateRemote
        ? `  The registry entry's stateRemote "${configuredStateRemote}" does not name a remote in the\n` +
          `  host clone, and no fallback remote could be resolved there.\n`
        : `  No registry stateRemote is set and no remote could be resolved in the host clone.\n`) +
      `  Remediate by either:\n` +
      `    - adding the remote to the host clone: ` +
      `git -C "${hostRoot}" remote add ${configuredStateRemote ?? '<name>'} <url>\n` +
      `    - or clearing the registry entry's stateRemote so the host clone's "origin" is used.`,
    );
  }
}

/**
 * Resolve the state branch for a registry entry. An explicit `stateBranch` wins; otherwise,
 * when a valid callsign is present, derive the namespaced `squad/state/<callsign>` branch
 * (matching the fold pipeline's target and the value assign/init persist for new entries).
 * Falls back to the flat legacy `squad-state` branch when neither is available.
 */
export function deriveStateBranch(stateBranch: string | undefined, callsign: string | undefined): string {
  if (stateBranch) return stateBranch;
  if (callsign && CALLSIGN_RE.test(callsign)) return `squad/state/${callsign}`;
  return 'squad-state';
}

/**
 * Resolve the durable config branch for a registry entry (piece 52, sub-proposal B).
 * An explicit `configBranch` wins; otherwise a callsign yields `squad/config/<callsign>`.
 * Returns `undefined` when neither is available — a host predating Pole A has no config lane.
 */
export function deriveConfigBranch(configBranch: string | undefined, callsign: string | undefined): string | undefined {
  if (configBranch) return configBranch;
  if (callsign && CALLSIGN_RE.test(callsign)) return `squad/config/${callsign}`;
  return undefined;
}

/**
 * Pull: fetch remote state branches and fast-forward local refs.
 */
function syncPull(cwd: string, remote: string, backend: string | null, quiet: boolean): void {
  // Fetch squad-state refs from remote
  try {
    execFileSync('git', ['fetch', remote, `+refs/heads/${STATE_BRANCH_PREFIX}:refs/remotes/${remote}/${STATE_BRANCH_PREFIX}`, `+refs/heads/${STATE_BRANCH_PREFIX}/*:refs/remotes/${remote}/${STATE_BRANCH_PREFIX}/*`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Remote may not have these refs yet — not an error
    if (!quiet) console.log('  No remote squad-state refs found (first push will create them).');
    return;
  }

  // Fast-forward local branches from remote-tracking refs
  const remoteBranches = discoverRemoteStateBranches(cwd, remote);
  for (const remoteBranch of remoteBranches) {
    // remoteBranch is like "origin/squad-state" — extract local name
    const localName = remoteBranch.replace(`${remote}/`, '');
    const localRef = `refs/heads/${localName}`;
    const remoteRef = `refs/remotes/${remoteBranch}`;

    try {
      // Check if local branch exists
      execFileSync('git', ['rev-parse', '--verify', localRef], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Local exists — try fast-forward
      const localSha = execFileSync('git', ['rev-parse', localRef], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const remoteSha = execFileSync('git', ['rev-parse', remoteRef], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (localSha === remoteSha) continue; // Already up-to-date

      // Check if fast-forward is possible (local is ancestor of remote)
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', localSha, remoteSha], {
          cwd, stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Fast-forward: update local ref
        execFileSync('git', ['update-ref', localRef, remoteSha], {
          cwd, stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (!quiet) console.log(`  ✓ ${localName}: fast-forwarded`);
      } catch {
        // Diverged — cannot fast-forward
        if (!quiet) console.log(`  ⚠ ${localName}: diverged from remote (manual merge needed)`);
      }
    } catch {
      // Local branch doesn't exist — create it tracking the remote
      const remoteSha = execFileSync('git', ['rev-parse', remoteRef], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      execFileSync('git', ['update-ref', localRef, remoteSha], {
        cwd, stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!quiet) console.log(`  ✓ ${localName}: created from remote`);
    }
  }

  // For two-layer: also fetch notes
  if (backend === 'two-layer') {
    try {
      execFileSync('git', ['fetch', remote, '+refs/notes/squad*:refs/notes/squad*'], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!quiet) console.log('  ✓ notes synced');
    } catch {
      // Notes may not exist yet
    }
  }
}

/**
 * Push: push local state branches to remote.
 */
function syncPush(cwd: string, remote: string, backend: string | null, quiet: boolean): void {
  const branches = discoverStateBranches(cwd);
  if (branches.length === 0) {
    if (!quiet) console.log('  No local squad-state branches to push.');
    return;
  }

  // Build refspecs for all state branches
  const refspecs = branches.map(b => `refs/heads/${b}:refs/heads/${b}`);

  try {
    execFileSync('git', ['push', '--no-verify', remote, ...refspecs], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!quiet) console.log(`  ✓ pushed: ${branches.join(', ')}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    if (msg.includes('non-fast-forward')) {
      if (!quiet) console.log(`  ⚠ push rejected (non-fast-forward). Run 'squad sync --pull' first.`);
    } else {
      if (!quiet) console.log(`  ⚠ push failed: ${msg}`);
    }
  }

  // For two-layer: also push notes
  if (backend === 'two-layer') {
    try {
      execFileSync('git', ['push', '--no-verify', remote, 'refs/notes/squad*:refs/notes/squad*'], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!quiet) console.log('  ✓ notes pushed');
    } catch {
      // Notes may not exist yet — not an error
    }
  }
}

// ─── Piece 32.5: State transport helpers ─────────────────────────────────────

/**
 * Characters and patterns illegal in git ref components.
 * A sessionId must not cause the inbox branch name to be malformed.
 */
const SESSION_ID_FORBIDDEN_RE = /[\x00-\x20\x7f~^:?*\[\\]|\.\.|\@\{|\/\/|^\/|^\-|\/\.lock$|\.lock\/|\.$/;

/**
 * Allowlisted paths within .squad/ that may be published.
 * Relative to teamRoot, forward-slash separated.
 */
export const PUBLISH_ALLOWLIST_EXACT = [
  '.squad/decisions.md',
  '.squad/.last-publish',
  // Piece 51 (A): unambiguous append-only top-level logs. The PREFIX list has the
  // `orchestration-log/` DIRECTORY but not this top-level `.md` file.
  '.squad/history.md',
  '.squad/orchestration-log.md',
  // Piece 51 (A + E1): last-writer-wins casting state — folded (cheap to reconstruct,
  // last-writer convergence acceptable) so clones converge instead of drifting.
  '.squad/casting-history.json',
  '.squad/casting-registry.json',
];
export const PUBLISH_ALLOWLIST_PREFIX = [
  '.squad/decisions/inbox/',
  '.squad/log/',
  '.squad/orchestration-log/',
  '.squad/sessions/',
  '.squad/identity/',
  // Piece 51 (A): runtime casting state under `casting/` (history.json/registry.json)
  // and generated onboarding artifacts.
  '.squad/casting/',
  '.squad/files/onboarding/',
];

/**
 * Glob matchers for allowlisted paths that need a wildcard segment (piece 51, B1).
 *
 * `.squad/agents/<name>/history.md` is ephemeral and folds, while the sibling
 * `.squad/agents/<name>/charter.md` is durable and must NOT fold into the ephemeral lane
 * (it is piece-52 reviewable content). A blanket `.squad/agents/` prefix would sweep
 * charters into state, so per-agent histories are matched by this targeted glob instead.
 */
export const PUBLISH_ALLOWLIST_GLOB: RegExp[] = [
  /^\.squad\/agents\/[^/]+\/history\.md$/,
];

export function isAllowlisted(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (PUBLISH_ALLOWLIST_EXACT.includes(p)) return true;
  if (PUBLISH_ALLOWLIST_PREFIX.some(prefix => p.startsWith(prefix))) return true;
  return PUBLISH_ALLOWLIST_GLOB.some(re => re.test(p));
}

// ─── Piece 52 (C): the durable payload set (CONFIG_ALLOWLIST) ─────────────────
//
// Pole A gives the squad's durable constitution its own reviewed home,
// `squad/config/<callsign>`. CONFIG_ALLOWLIST is the DETERMINISTIC COMPLEMENT of
// piece 51's ephemeral + machine-local partition: a path is durable iff it is neither
// ephemeral (`isAllowlisted`) nor machine-local scratch. These constants make that
// complement explicit so the durable publish (piece 53) carries exactly the constitution
// and nothing else, and so the classifier below can prove the partition is total & disjoint.
//
// Disjointness with the ephemeral lane is by construction:
//   - `casting-policy.json` is the top-level hyphenated file; the ephemeral `.squad/casting/`
//     PREFIX governs the runtime `casting/` subtree — the two never overlap.
//   - durable `files/triage-flow/` is disjoint from the ephemeral `files/onboarding/` prefix.
//   - the durable per-agent `charter.md` glob is the complement of the ephemeral `history.md` glob.

/**
 * Durable constitution files (exact paths). Roster/charters/routing/config/process docs.
 */
export const CONFIG_ALLOWLIST_EXACT = [
  '.squad/team.md',
  '.squad/roster.md',
  '.squad/routing.md',
  '.squad/charter.md',
  '.squad/scribe-charter.md',
  '.squad/fact-checker-charter.md',
  '.squad/config.json',
  '.squad/casting-policy.json',
  '.squad/ceremonies.md',
  '.squad/issue-lifecycle.md',
  '.squad/mcp-config.md',
  '.squad/multi-agent-format.md',
  '.squad/copilot-instructions.md',
  '.squad/constraint-tracking.md',
  '.squad/skill.md',
  '.squad/plugin-marketplace.md',
];

/**
 * Durable subtrees (prefixes). `templates/**` and authored (non-generated) content.
 * `files/triage-flow/` is authored; the generated `files/onboarding/` subtree is ephemeral.
 */
export const CONFIG_ALLOWLIST_PREFIX = [
  '.squad/templates/',
  '.squad/skills/',
  '.squad/files/triage-flow/',
];

/**
 * Glob matchers for durable paths with a wildcard segment. `.squad/agents/<name>/charter.md`
 * is durable and reviewable — the exact complement of the ephemeral per-agent `history.md`.
 */
export const CONFIG_ALLOWLIST_GLOB: RegExp[] = [
  /^\.squad\/agents\/[^/]+\/charter\.md$/,
];

export function isConfigAllowlisted(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (CONFIG_ALLOWLIST_EXACT.includes(p)) return true;
  if (CONFIG_ALLOWLIST_PREFIX.some(prefix => p.startsWith(prefix))) return true;
  return CONFIG_ALLOWLIST_GLOB.some(re => re.test(p));
}

// ─── Piece 53 (A): lane-aware publish (config-inbox lane, decision F1) ─────────
//
// The publish path carries a single lane's payload to that lane's inbox prefix. Two
// physically distinct lanes (F1) mean a ref's prefix fully determines its downstream
// handling — `squad/inbox/**` folds (force-push), `squad/config-inbox/**` opens a PR — so
// neither pipeline classifies paths and the payloads can never cross-contaminate:
//   - `'state'`  → ephemeral: `isAllowlisted` (piece 51) → `squad/inbox/<callsign>/…`.
//   - `'config'` → durable:   `isConfigAllowlisted` (piece 52 §C) → `squad/config-inbox/<callsign>/…`.
// The two allowlists are proven disjoint by the piece-52 total/disjoint classifier.

/** Which transport lane a publish targets. */
export type PublishLane = 'state' | 'config';

interface PublishLaneConfig {
  /** Filter selecting this lane's payload before any git object is created. */
  filter: (relPath: string) => boolean;
  /** Inbox ref prefix this lane publishes under (no trailing slash). */
  inboxPrefix: string;
  /** Basename (no extension) of the host pipeline embedded in the snapshot for this lane. */
  pipelineBasename: string;
}

/** Resolve the filter / inbox-prefix / pipeline for a publish lane. */
export function resolvePublishLane(lane: PublishLane): PublishLaneConfig {
  if (lane === 'config') {
    return {
      filter: isConfigAllowlisted,
      inboxPrefix: 'squad/config-inbox',
      pipelineBasename: 'fold-squad-config',
    };
  }
  return {
    filter: isAllowlisted,
    inboxPrefix: 'squad/inbox',
    pipelineBasename: 'fold-squad-state',
  };
}

/**
 * Derive a valid inbox handle from the git user.email local-part.
 *
 * Sanitization pipeline:
 *   1. lowercase
 *   2. spaces → '.' then '.' → '-'
 *   3. strip non-[a-z0-9-]
 *   4. prepend 'u-' if result starts with a digit
 *   5. truncate at 39 chars
 *
 * Returns undefined if user.email is unset or the sanitized result is empty.
 */
export function deriveHandleFromGitEmail(cwd: string): string | undefined {
  try {
    const email = execFileSync('git', ['config', 'user.email'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!email) return undefined;
    const localPart = email.split('@')[0] ?? '';
    if (!localPart) return undefined;
    let handle = localPart.toLowerCase();
    handle = handle.replace(/ /g, '.').replace(/\./g, '-');
    handle = handle.replace(/[^a-z0-9-]/g, '');
    if (/^\d/.test(handle)) handle = 'u-' + handle;
    handle = handle.slice(0, 39);
    if (!INBOX_HANDLE_RE.test(handle)) return undefined;
    return handle || undefined;
  } catch {
    return undefined;
  }
}

/** Enumerate all regular files under `teamRoot/.squad/` as forward-slash relative paths. */
function enumerateSquadFiles(teamRoot: string): string[] {
  const squadDir = path.join(teamRoot, '.squad');
  if (!fs.existsSync(squadDir)) return [];
  const entries = fs.readdirSync(squadDir, { recursive: true }) as string[];
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(squadDir, entry);
    try {
      if (fs.statSync(fullPath).isFile()) {
        result.push(`.squad/${entry.replace(/\\/g, '/')}`);
      }
    } catch { /* skip unreadable entries */ }
  }
  return result;
}

/** Format a Date as yyyyMMdd-HHmmssSSS (with milliseconds) from its UTC representation. */
function formatPublishTimestamp(date: Date): string {
  const iso = date.toISOString();
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${ms}`;
}

// Per-process monotonic counter for sub-millisecond branch-name uniqueness.
// Guarantees distinct branch names even when two publishes occur within the same millisecond
// (same-session rapid-fire scenario). The counter is appended between timestamp and sessionId.
// The resulting branch pattern squad/inbox/<alias>/<ts>-<seq>-<sessionId> still satisfies
// the squad/inbox/** trigger glob.
let _publishSeq = 0;

/**
 * Publish a snapshot of TEAM_ROOT/.squad/ (allowlisted subtree) to a
 * per-session inbox branch on `remote`.
 *
 * Parameterized: takes all resolved inputs as arguments.
 * Does NOT read config.json, call detectBackend, or query the registry.
 */
/**
 * Resolve the real git directory for a team root.
 *
 * A team root is not always the top of its own git repository: on a monorepo host the `.squad`
 * team root lives in a subdirectory (for example `teams/<callsign>/.squad`) and the repository's
 * real `.git` is at the repo root. `git rev-parse --absolute-git-dir` (run with `cwd: teamRoot`)
 * discovers the repository by walking upward and returns the actual git directory — the repo's
 * own `.git` for a single-repo host, the repo-root `.git` for a monorepo subdirectory team root,
 * and the correct linked-worktree git directory for a worktree checkout. Path separators are
 * normalized to forward slashes so the value can be passed directly as a `--git-dir` argument.
 */
function resolveTeamRootGitDir(teamRoot: string): string {
  let gitDir: string;
  try {
    gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error
      ? ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err.message)
      : String(err);
    throw new SquadError(
      `squad sync: could not resolve the git directory for team root "${teamRoot}".\n` +
      `  The team root must be inside a git repository.\n` +
      `  git error: ${String(msg).trim()}`,
    );
  }
  if (!gitDir) {
    throw new SquadError(
      `squad sync: could not resolve the git directory for team root "${teamRoot}" (empty result).`,
    );
  }
  return gitDir.replace(/\\/g, '/');
}

/** One on-disk file to hash and stage: its git-index path (forward-slash) and absolute source. */
export interface BatchStageEntry {
  /** Index path (always forward-slash separated, e.g. `.squad/charter.md`). */
  indexPath: string;
  /** Absolute on-disk path whose bytes are hashed verbatim. */
  absPath: string;
}

/**
 * Piece 54 §C: batch the publish git-spawns.
 *
 * Hash every on-disk file with a SINGLE `git hash-object -w --no-filters --stdin-paths` and stage
 * them all with a SINGLE `git update-index --index-info`, against the isolated `GIT_INDEX_FILE` in
 * `env`. This replaces the per-file O(2·N) `hash-object --stdin` + `update-index --add --cacheinfo`
 * loop (two child processes per file, ~124 ms each on Windows) with an O(1) small constant of two
 * spawns regardless of file count.
 *
 * Byte-for-byte fidelity (so `write-tree` yields the SAME tree SHA as the per-file path):
 *   - `--no-filters` hashes the raw disk bytes exactly as the old `--stdin` path did. Without it,
 *     `--stdin-paths` would apply the path's gitattributes (e.g. `text=auto` CRLF normalization)
 *     and produce a DIFFERENT blob SHA for CRLF content.
 *   - mode is fixed at `100644` and the index path is the forward-slash `indexPath`, matching the
 *     old `--cacheinfo 100644,<sha>,<path>` staging exactly.
 *
 * git 2.x `hash-object --stdin-paths` has no `-z`, so paths are newline-delimited; a path carrying
 * an embedded CR/LF would corrupt the path→SHA alignment, so such a path is refused (a git-tracked
 * `.squad/` path never contains one). A no-op (no spawn) when `entries` is empty.
 */
export function batchHashAndStage(
  cwd: string,
  env: NodeJS.ProcessEnv,
  entries: BatchStageEntry[],
): void {
  if (entries.length === 0) return;

  for (const e of entries) {
    if (/[\r\n]/.test(e.absPath)) {
      throw new Error(`Cannot batch-hash a path containing a newline: ${e.absPath}`);
    }
  }

  const stdinPaths = entries.map(e => e.absPath).join('\n') + '\n';
  const shaOut = execFileSync('git', ['hash-object', '-w', '--no-filters', '--stdin-paths'], {
    cwd, env, input: stdinPaths, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const shas = shaOut.split('\n').map(s => s.trim()).filter(Boolean);
  if (shas.length !== entries.length) {
    throw new Error(
      `git hash-object returned ${shas.length} object id(s) for ${entries.length} path(s).`,
    );
  }

  const manifest = entries.map((e, i) => `100644 ${shas[i]}\t${e.indexPath}`).join('\n') + '\n';
  execFileSync('git', ['update-index', '--index-info'], {
    cwd, env, input: manifest, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function publishTeamRootToInbox(
  teamRoot: string,
  remote: string,
  inboxHandle: string,
  sessionId: string,
  callsign?: string,
  lane: PublishLane = 'state',
): Promise<void> {
  const laneConfig = resolvePublishLane(lane);
  // Step 1: Validate inboxHandle before any git operation
  if (!INBOX_HANDLE_RE.test(inboxHandle)) {
    throw new Error(
      `Invalid inboxHandle "${inboxHandle}": must match /^[a-z][a-z0-9-]{1,38}$/ (lowercase, starts with a letter, hyphens allowed, max 39 chars).`,
    );
  }

  // Step 1b: Validate sessionId for git-ref legality before constructing any branch name
  if (!sessionId || SESSION_ID_FORBIDDEN_RE.test(sessionId) || sessionId.startsWith('/') || sessionId.startsWith('-') || sessionId.endsWith('/') || sessionId.endsWith('.lock')) {
    throw new Error(
      `Invalid sessionId "${sessionId}": must be non-empty and must not contain characters illegal in a git ref component (whitespace, control chars, ~^:?*[\\, .., @{, consecutive/leading/trailing slashes, leading dash, or .lock suffix).`,
    );
  }

  // Step 1c: Validate callsign when provided.
  // When a callsign is present it is embedded in the branch name and must match the same
  // character constraints as inboxHandle.
  if (callsign !== undefined) {
    if (!CALLSIGN_RE.test(callsign)) {
      throw new Error(
        `Invalid callsign "${callsign}": must match /^[a-z][a-z0-9-]{1,38}$/ (lowercase, starts with a letter, hyphens allowed, max 39 chars). ` +
        `Set the callsign via 'squad assign --callsign <name>'.`,
      );
    }
  }

  // Step 2: Build inbox branch name (monotonic seq suffix guarantees uniqueness below ms).
  // Lane-aware prefix (F1): state → squad/inbox/…, config → squad/config-inbox/… so a ref's
  // prefix fully determines its downstream handling (fold force-push vs auto-PR).
  // Cross-repo mode (callsign present): <prefix>/<callsign>/<handle>/<ts>-<seq>-<sessionId>
  // Single-repo / legacy mode (no callsign): <prefix>/<handle>/<ts>-<seq>-<sessionId>
  const ts = formatPublishTimestamp(new Date());
  const seq = _publishSeq++;
  const inboxBranch = callsign
    ? `${laneConfig.inboxPrefix}/${callsign}/${inboxHandle}/${ts}-${seq}-${sessionId}`
    : `${laneConfig.inboxPrefix}/${inboxHandle}/${ts}-${seq}-${sessionId}`;

  // Step 3: Resolve base commit
  const baseStateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  // Step 4: Enumerate files and filter to this lane's allowlist BEFORE any git object is created.
  // Non-payload paths are silently excluded; they do not abort the publish. The lane filter
  // (ephemeral `isAllowlisted` vs durable `isConfigAllowlisted`) is what keeps the two lanes
  // from ever cross-contaminating.
  const allSquadFiles = enumerateSquadFiles(teamRoot);
  const squadFiles = allSquadFiles.filter(relPath => laneConfig.filter(relPath));

  // Step 5: Build snapshot via git plumbing with isolated index.
  // The isolated index must live inside the team root's REAL git directory. On a monorepo host
  // the team root is a subdirectory and `<teamRoot>/.git` does not exist — the repository's real
  // `.git` is at the repo root — so resolve the actual git directory via
  // `git rev-parse --absolute-git-dir` (cwd = teamRoot) rather than assuming `<teamRoot>/.git`.
  const resolvedGitDir = resolveTeamRootGitDir(teamRoot);
  const indexFile = path.join(
    resolvedGitDir,
    `squad-publish-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const indexEnv = { ...process.env, GIT_INDEX_FILE: indexFile };

  // Author/committer identity fallback for environments without global git config
  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env['GIT_AUTHOR_NAME'] ?? 'Squad',
    GIT_AUTHOR_EMAIL: process.env['GIT_AUTHOR_EMAIL'] ?? 'squad@system',
    GIT_COMMITTER_NAME: process.env['GIT_COMMITTER_NAME'] ?? 'Squad',
    GIT_COMMITTER_EMAIL: process.env['GIT_COMMITTER_EMAIL'] ?? 'squad@system',
  };

  try {
    // §C: hash + stage ALL allowlisted files in two spawns (was two spawns PER file).
    batchHashAndStage(
      teamRoot,
      indexEnv,
      squadFiles.map(relPath => ({
        indexPath: relPath,
        absPath: path.join(teamRoot, relPath.replace(/\//g, path.sep)),
      })),
    );

    // §9 PII: sourceWorkRoot is {repo: basename, pathHash: sha256(normalizedAbsPath)} — no raw path
    const normalizedTeamRoot = teamRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const pathHash = 'sha256:' + createHash('sha256').update(normalizedTeamRoot).digest('hex');
    const metadata: Record<string, unknown> = {
      inboxHandle,
      sessionId,
      sourceWorkRoot: {
        repo: path.basename(teamRoot),
        pathHash,
      },
      publishedAt: new Date().toISOString(),
      baseStateCommit,
    };
    if (callsign !== undefined) {
      metadata['callsign'] = callsign;
    }
    const metadataJson = JSON.stringify(metadata, null, 2);
    const metadataSha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: teamRoot, env: indexEnv, input: Buffer.from(metadataJson, 'utf-8'),
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${metadataSha},.squad/publish-metadata.json`], {
      cwd: teamRoot, env: indexEnv, stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Sub-proposal A (piece 39): embed the host pipeline YAML in the inbox snapshot so CI
    // systems can evaluate triggers against the published snapshot.
    // Piece 44 (B): a host may carry a pipeline copy in more than one directory (a stale
    // alternate-platform copy from an earlier convention). Resolve a single canonical
    // pipeline path and embed ONLY that one — never a second, stale alternate-directory copy.
    // Precedence (first existing wins, then stop): callsign-scoped file before the generic
    // file, Azure DevOps before GitHub.
    const pipelineCandidates: string[] = [];
    if (callsign !== undefined) {
      pipelineCandidates.push(
        path.join('.azuredevops', `${laneConfig.pipelineBasename}.${callsign}.yml`),
        path.join('.github', 'workflows', `${laneConfig.pipelineBasename}.${callsign}.yml`),
      );
    }
    pipelineCandidates.push(
      path.join('.azuredevops', `${laneConfig.pipelineBasename}.yml`),
      path.join('.github', 'workflows', `${laneConfig.pipelineBasename}.yml`),
    );
    for (const relPipeline of pipelineCandidates) {
      const absPipeline = path.join(teamRoot, relPipeline);
      if (!fs.existsSync(absPipeline)) continue;
      const pipelineContent = fs.readFileSync(absPipeline);
      const pipelineSha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: teamRoot, env: indexEnv, input: pipelineContent, encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      // git index paths are always forward-slash separated, regardless of host OS.
      const gitRelPipeline = relPipeline.split(path.sep).join('/');
      execFileSync('git', ['update-index', '--add', '--cacheinfo',
        `100644,${pipelineSha},${gitRelPipeline}`], {
        cwd: teamRoot, env: indexEnv, stdio: ['pipe', 'pipe', 'pipe'],
      });
      break; // embed only the canonical pipeline; never a stale alternate-directory copy
    }

    // Write tree from isolated index
    const treeSha = execFileSync('git', ['write-tree'], {
      cwd: teamRoot, env: indexEnv, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Commit tree (orphan snapshot — no parent)
    const commitSha = execFileSync('git', ['commit-tree', treeSha, '-m', 'squad: publish snapshot'], {
      cwd: teamRoot, env: commitEnv, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Step 6: Push to inbox branch (new branch per session — no non-fast-forward possible)
    execFileSync('git', ['push', remote, `${commitSha}:refs/heads/${inboxBranch}`], {
      cwd: teamRoot, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } finally {
    try { fs.unlinkSync(indexFile); } catch { /* index may not exist if we errored before creating it */ }
  }
}

/** Outcome of a config-orphan genesis attempt. */
export interface SeedConfigOrphanResult {
  /** The durable config branch ref name (without `refs/heads/`). */
  configBranch: string;
  /** Orphan commit sha, or `undefined` when genesis was skipped (branch already existed). */
  commit?: string;
  /** True when this call created the branch; false when it already existed (idempotent skip). */
  seeded: boolean;
  /** The durable `.squad/**` paths written into the genesis tree. */
  files: string[];
}

/**
 * Genesis-seed the durable orphan branch `squad/config/<callsign>` from TEAM_ROOT's durable
 * payload (piece 52, sub-proposal B).
 *
 * Reuses the same commit-tree plumbing the ephemeral publish uses, with two differences: the
 * snapshot is filtered to `CONFIG_ALLOWLIST` (the durable constitution only), and the commit is
 * an ORPHAN — no `main` ancestor — so nothing durable ever descends from the product lineage.
 *
 * Genesis is the ONE exception to "the config lane advances only by reviewed merge" (piece 53):
 * the seed has no prior to review against. The operation is therefore idempotent — if the config
 * branch already exists it is left untouched (`seeded: false`), so a re-run never clobbers
 * reviewed history.
 *
 * @param teamRoot     Team root whose `.squad/**` durable files seed the orphan.
 * @param configBranch Target branch ref (without `refs/heads/`), e.g. `squad/config/<callsign>`.
 * @param opts.remote  When set, publish via `git push <remote>`; otherwise seed a LOCAL ref
 *                     with `update-ref` (single-repo / self-host genesis, no remote required).
 */
export async function seedConfigOrphan(
  teamRoot: string,
  configBranch: string,
  opts: { remote?: string } = {},
): Promise<SeedConfigOrphanResult> {
  const { remote } = opts;

  // Idempotency: never re-seed an existing config branch (it advances only by reviewed merge).
  const branchExists = (): boolean => {
    try {
      if (remote) {
        const out = execFileSync('git', ['ls-remote', '--heads', remote, `refs/heads/${configBranch}`], {
          cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return out.length > 0;
      }
      execFileSync('git', ['rev-parse', '--verify', `refs/heads/${configBranch}`], {
        cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  };

  const durableFiles = enumerateSquadFiles(teamRoot).filter(rel => isConfigAllowlisted(rel));

  if (branchExists()) {
    return { configBranch, seeded: false, files: durableFiles };
  }

  // Build the durable snapshot in an isolated index inside the team root's REAL git dir
  // (monorepo-safe), exactly like publishTeamRootToInbox.
  const resolvedGitDir = resolveTeamRootGitDir(teamRoot);
  const indexFile = path.join(
    resolvedGitDir,
    `squad-config-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const indexEnv = { ...process.env, GIT_INDEX_FILE: indexFile };
  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env['GIT_AUTHOR_NAME'] ?? 'Squad',
    GIT_AUTHOR_EMAIL: process.env['GIT_AUTHOR_EMAIL'] ?? 'squad@system',
    GIT_COMMITTER_NAME: process.env['GIT_COMMITTER_NAME'] ?? 'Squad',
    GIT_COMMITTER_EMAIL: process.env['GIT_COMMITTER_EMAIL'] ?? 'squad@system',
  };

  try {
    // §C: hash + stage ALL durable files in two spawns (was two spawns PER file), byte-identical
    // to the per-file path so the genesis tree SHA is unchanged.
    batchHashAndStage(
      teamRoot,
      indexEnv,
      durableFiles.map(relPath => ({
        indexPath: relPath,
        absPath: path.join(teamRoot, relPath.replace(/\//g, path.sep)),
      })),
    );

    const treeSha = execFileSync('git', ['write-tree'], {
      cwd: teamRoot, env: indexEnv, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Orphan commit — NO parent, so the durable lane never descends from `main`.
    const commitSha = execFileSync('git', ['commit-tree', treeSha, '-m', 'squad: config lane genesis'], {
      cwd: teamRoot, env: commitEnv, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (remote) {
      execFileSync('git', ['push', remote, `${commitSha}:refs/heads/${configBranch}`], {
        cwd: teamRoot, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      // Create-only: the empty old-value asserts the ref does NOT already exist, so a racing
      // or false-negative existence check fails safe instead of clobbering reviewed history.
      execFileSync('git', ['update-ref', `refs/heads/${configBranch}`, commitSha, ''], {
        cwd: teamRoot, stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    return { configBranch, commit: commitSha, seeded: true, files: durableFiles };
  } finally {
    try { fs.unlinkSync(indexFile); } catch { /* index may not exist if we errored early */ }
  }
}

/**
 * Hydrate TEAM_ROOT working directory from a branch ref on `remote`.
 *
 * Fetches the branch, then writes its tree files into TEAM_ROOT without altering HEAD.
 * Idempotent: returns early when the recorded sentinel already equals the fetched commit.
 *
 * Parameterized: takes all resolved inputs as arguments (the sentinel filename distinguishes
 * the ephemeral state hydrate from the durable config hydrate — piece 53 §D). Does NOT read
 * config.json, call detectBackend, or query the registry.
 */
async function hydrateTeamRootFromRef(
  teamRoot: string,
  remote: string,
  branch: string,
  sentinelName: string,
): Promise<void> {
  // Step 1: Fetch the branch into a remote-tracking ref
  try {
    execFileSync('git', [
      'fetch', remote,
      `refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
    ], { cwd: teamRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err.message) : String(err);
    throw new Error(
      `hydrateTeamRootFromRef: failed to fetch "${branch}" from "${remote}": ${msg}`,
    );
  }

  // Step 2: Resolve fetched SHA
  const fetchedSha = execFileSync('git', ['rev-parse', `refs/remotes/${remote}/${branch}`], {
    cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  // Step 3: Idempotency — skip if we already applied this exact snapshot.
  // HEAD cannot be used as a sentinel because teamRoot is a product repo whose HEAD
  // is its own working-branch tip, never equal to the orphan branch SHA.
  // Instead, write the applied SHA to a local sentinel file after each hydration.
  const sentinelPath = path.join(teamRoot, '.squad', sentinelName);
  let lastAppliedSha: string | null = null;
  try {
    lastAppliedSha = fs.readFileSync(sentinelPath, 'utf-8').trim();
  } catch { /* sentinel absent — proceed */ }

  if (lastAppliedSha === fetchedSha) return;

  // Step 4: Write branch tree files into TEAM_ROOT (does not alter HEAD).
  // Uses ls-tree + cat-file blob to enumerate and write files directly — avoids
  // `git checkout --work-tree` index-state conflicts in nested repo contexts.
  // Resolve the team root's REAL git directory: on a monorepo host the team root is a
  // subdirectory and `<teamRoot>/.git` is not a git directory, so assuming it would break the
  // `--git-dir` ls-tree / cat-file calls below. `git rev-parse --absolute-git-dir` (cwd =
  // teamRoot) returns the repo-root `.git` for that case and the repo's own `.git` otherwise.
  const normalizedGitDir = resolveTeamRootGitDir(teamRoot);
  const isolatedEnv = { ...process.env };
  delete isolatedEnv['GIT_DIR'];
  delete isolatedEnv['GIT_WORK_TREE'];
  delete isolatedEnv['GIT_INDEX_FILE'];

  const fileList = execFileSync('git', [
    '--git-dir', normalizedGitDir,
    'ls-tree', '-r', '--name-only', `refs/remotes/${remote}/${branch}`,
  ], { encoding: 'utf-8', env: isolatedEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean);

  for (const filePath of fileList) {
    const content = execFileSync('git', [
      '--git-dir', normalizedGitDir,
      'cat-file', 'blob', `refs/remotes/${remote}/${branch}:${filePath}`,
    ], { encoding: null, env: isolatedEnv, stdio: ['pipe', 'pipe', 'pipe'] }) as Buffer;
    const outPath = path.join(teamRoot, filePath.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }

  // Write sentinel so next call can skip re-hydration when snapshot unchanged.
  try {
    fs.mkdirSync(path.join(teamRoot, '.squad'), { recursive: true });
    fs.writeFileSync(sentinelPath, fetchedSha + '\n', 'utf-8');
  } catch { /* best-effort — do not abort a successful hydration */ }
}

/**
 * Hydrate TEAM_ROOT from the ephemeral state ref (`squad/state/<callsign>`).
 * Sentinel: `.squad/.last-hydrate-sha`.
 */
export async function hydrateTeamRootFromStateRef(
  teamRoot: string,
  remote: string,
  stateBranch: string,
): Promise<void> {
  await hydrateTeamRootFromRef(teamRoot, remote, stateBranch, '.last-hydrate-sha');
}

/**
 * Hydrate TEAM_ROOT from the durable config ref (`squad/config/<callsign>`) — piece 53 §D.
 *
 * Symmetric with the state hydrate but writes the durable constitution and records a distinct
 * sentinel (`.squad/.last-config-hydrate-sha`) so the two lanes track independently and re-pull
 * is a no-op. The durable and ephemeral trees are DISJOINT by construction (piece 52 §C total
 * classifier), so landing this before the state hydrate composes without clobbering.
 */
export async function hydrateTeamRootFromConfigRef(
  teamRoot: string,
  remote: string,
  configBranch: string,
): Promise<void> {
  await hydrateTeamRootFromRef(teamRoot, remote, configBranch, '.last-config-hydrate-sha');
}

// ─── End piece 32.5 ──────────────────────────────────────────────────────────

/**
 * Internal transport dispatch — exposed for test interception via vi.spyOn.
 * runSync calls helpers through this object so spy-based guards work under ESM
 * (direct local calls bypass module-export replacement; object-property calls do not).
 */
export const _transport = {
  publishTeamRootToInbox,
  hydrateTeamRootFromStateRef,
  hydrateTeamRootFromConfigRef,
};

/**
 * Detect durable team-root files that differ from the last-hydrated config tip (piece 53 §E).
 *
 * Compares every `CONFIG_ALLOWLIST` file in TEAM_ROOT against the blob recorded at the
 * `.squad/.last-config-hydrate-sha` commit. A durable file is "unpromoted" when its working-copy
 * content differs from that tip (edited or newly added). Returns the forward-slash relative paths
 * of the differing durable files, sorted; empty when nothing durable has drifted.
 *
 * Silent-by-design preconditions return `[]` (never a false nudge): no sentinel (never hydrated,
 * so there is no baseline to diff against), or the sentinel commit is unreadable.
 */
export function detectUnpromotedDurableChanges(teamRoot: string): string[] {
  const sentinelPath = path.join(teamRoot, '.squad', '.last-config-hydrate-sha');
  let baseSha: string;
  try {
    baseSha = fs.readFileSync(sentinelPath, 'utf-8').trim();
  } catch {
    return []; // never hydrated — no baseline, stay silent
  }
  if (!baseSha) return [];

  let gitDir: string;
  try {
    gitDir = resolveTeamRootGitDir(teamRoot);
  } catch {
    return [];
  }
  const isolatedEnv = { ...process.env };
  delete isolatedEnv['GIT_DIR'];
  delete isolatedEnv['GIT_WORK_TREE'];
  delete isolatedEnv['GIT_INDEX_FILE'];

  // Verify the baseline commit is present locally; if not, do not guess.
  try {
    execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-e', `${baseSha}^{commit}`], {
      env: isolatedEnv, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }

  const durableFiles = enumerateSquadFiles(teamRoot).filter(rel => isConfigAllowlisted(rel));
  const changed: string[] = [];
  for (const rel of durableFiles) {
    const fullPath = path.join(teamRoot, rel.replace(/\//g, path.sep));
    let working: Buffer;
    try {
      working = fs.readFileSync(fullPath);
    } catch {
      continue;
    }
    let baseline: Buffer | null;
    try {
      baseline = execFileSync('git', ['--git-dir', gitDir, 'cat-file', 'blob', `${baseSha}:${rel}`], {
        encoding: null, env: isolatedEnv, stdio: ['pipe', 'pipe', 'pipe'],
      }) as Buffer;
    } catch {
      baseline = null; // path absent at the tip — a newly-added durable file
    }
    if (baseline === null || Buffer.compare(working, baseline) !== 0) {
      changed.push(rel);
    }
  }
  return changed.sort();
}

/**
 * Write the publish timestamp to .squad/.last-publish in the given root.
 * Called on successful push (cross-repo and single-repo paths). Best-effort.
 */
function writeLastPublish(root: string): void {
  try {
    const squadDir = path.join(root, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, '.last-publish'), new Date().toISOString() + '\n', 'utf-8');
  } catch { /* best-effort — do not abort a successful sync */ }
}

/**
 * Options for the `squad sync status` subcommand.
 */
export interface SyncStatusOptions {
  cwd?: string;
  /** Alternate registry path (matches `init`'s `--registry-path`). */
  registryPath?: string;
}

/**
 * Print a structured status summary for `squad sync status`.
 *
 * Six fields: Last published / Pending changes / State remote / State branch /
 * Developer alias / Docs repo path.
 *
 * Reads .squad/.last-publish (ISO-8601) from the resolved TEAM_ROOT; shows "never"
 * when absent. Registry-first resolution: team root and state fields come from the
 * registry entry matching cwd. Config.json is a fallback for unregistered contexts.
 */
export async function runSyncStatus(options: SyncStatusOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = getRepoRoot(cwd);

  let teamRoot: string | undefined;
  let stateRemote: string | undefined;
  let stateBranch: string | undefined;
  let inboxHandle: string | undefined;

  const { registry } = loadRegistryFromDisk({ registryPath: options.registryPath });
  const normalizedRoot = normalisedPathKey(repoRoot);
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
  );
  if (entry) {
    teamRoot = path.dirname(entry.path);
    stateRemote = entry.stateRemote;
    stateBranch = entry.stateBranch;
    inboxHandle = entry.inboxHandle;
  } else {
    // Fallback: config.json for unregistered/single-repo contexts
    const configPath = path.join(repoRoot, '.squad', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        stateRemote = config.stateRemote;
        stateBranch = config.stateBranch;
        inboxHandle = config.inboxHandle;
      } catch { /* ignore */ }
    }
  }

  const effectiveRoot = teamRoot ?? repoRoot;

  // Read .last-publish
  const lastPublishPath = path.join(effectiveRoot, '.squad', '.last-publish');
  let lastPublished = 'never';
  try {
    lastPublished = fs.readFileSync(lastPublishPath, 'utf-8').trim();
  } catch { /* absent = never */ }

  // Count pending changes (files modified since last publish)
  const files = enumerateSquadFiles(effectiveRoot);
  let pendingChanges: string;
  if (lastPublished === 'never') {
    pendingChanges = files.length === 0 ? 'none' : `${files.length} file${files.length === 1 ? '' : 's'} changed`;
  } else {
    const lastTime = new Date(lastPublished).getTime();
    let changedCount = 0;
    for (const f of files) {
      const fullPath = path.join(effectiveRoot, f.replace(/\//g, path.sep));
      try {
        if (fs.statSync(fullPath).mtimeMs > lastTime) changedCount++;
      } catch { /* skip unreadable */ }
    }
    pendingChanges = changedCount === 0 ? 'none' : `${changedCount} file${changedCount === 1 ? '' : 's'} changed`;
  }

  console.log(`Last published:    ${lastPublished}`);
  console.log(`Pending changes:   ${pendingChanges}`);
  console.log(`State remote:      ${stateRemote ?? '(not set)'}`);
  console.log(`State branch:      ${stateBranch ?? '(not set)'}`);
  console.log(`Inbox handle:      ${inboxHandle ?? '(not set)'}`);
  console.log(`Host clone path:   ${teamRoot ?? '(not bound)'}`);

  // Piece 53 §E: surface unpromoted durable changes with a single actionable nudge.
  // Silent otherwise (durable mutation is rare and deliberate; never block or auto-publish).
  const durableChanged = detectUnpromotedDurableChanges(effectiveRoot);
  if (durableChanged.length > 0) {
    const names = durableChanged.map(p => p.replace(/^\.squad\//, ''));
    console.log(
      `Durable config changed (${names.join(', ')}) — run 'squad sync --push-config' to open a review PR.`,
    );
  }
}

/**
 * Main sync entrypoint.
 *
 * Resolution order (sub-proposal A):
 *   1. SQUAD_TEAM_ROOT env var — explicit override of the team-root path. The override still
 *      consults the registry (best-effort) to adopt a matching entry's callsign / state config
 *      (sub-proposal D1); the env value always wins for the path itself.
 *   2. Registry lookup via loadRegistryFromDisk() — find entry whose clones[] contains
 *      the current git root; TEAM_ROOT = path.dirname(entry.path).
 *   3. Fallback to WORK_ROOT/.squad/config.json for single-repo / unregistered contexts.
 *   4. Neither present + push direction → exit 1 (run 'squad assign').
 *
 * detectBackend disposition: the detectBackend call has been removed from runSync.
 * backend is now derived from registry presence (entry → 'orphan'; no entry → null from
 * config.json stateBackend, or null when config.json is absent). detectBackend() is kept
 * as a private helper but no longer called from runSync.
 */
export async function runSync(options: SyncOptions): Promise<void> {
  // Recursion guard — prevent re-entry when our push triggers pre-push
  if (process.env[SQUAD_SYNC_ENV]) {
    return;
  }
  process.env[SQUAD_SYNC_ENV] = '1';

  try {
    const cwd = options.cwd ?? process.cwd();
    const quiet = options.quiet ?? false;
    const repoRoot = getRepoRoot(cwd);
    // Resolve the code-clone remote lazily and memoize it. In cross-repo mode the state
    // remote resolves from the team-root host, so the code-clone remote is unused — deferring
    // resolution means a cross-repo sync never throws on an unrelated code-clone remote
    // configuration (the hardened resolveRemote can throw when no remote is determinable).
    // On the single-repo path the conventional default remote is `origin`; preserve that soft
    // default here (the fail-closed hardening applies to the cross-repo state remote).
    let _codeCloneRemote: string | undefined;
    const getCodeCloneRemote = (): string => {
      if (options.remote) return options.remote;
      if (_codeCloneRemote === undefined) {
        try {
          _codeCloneRemote = resolveRemote(repoRoot);
        } catch {
          _codeCloneRemote = 'origin';
        }
      }
      return _codeCloneRemote;
    };
    // Piece 53 §A: the durable config lane. `pushConfigOnly` suppresses the ephemeral
    // state push/pull so a bare `squad sync --push-config` does not also fold ephemeral state.
    const wantConfigPush = options.pushConfig === true;
    const configOnly = options.pushConfigOnly === true;
    const isPush = (options.direction === 'push' || options.direction === 'both') && !configOnly;
    const isPull = (options.direction === 'pull' || options.direction === 'both') && !configOnly;

    // ── Sub-proposal A: Registry-first TEAM_ROOT resolution ───────────────────
    let teamRoot: string | undefined;
    let stateRemote: string | undefined;
    let stateBranch: string | undefined;
    let registryAlias: string | undefined;
    let registryCallsign: string | undefined;
    let configRemote: string | undefined;
    let configBranch: string | undefined;
    let backend: string | null = null;
    let configJsonPresent = false;

    if (process.env['SQUAD_TEAM_ROOT']) {
      // Explicit env override: the env value wins for the team-root PATH. Sub-proposal D1:
      // still consult the registry (best-effort, honouring --registry-path) and, when an entry's
      // team root matches the override, adopt its callsign / state config. Without this, a
      // cross-repo --push from an env-overridden team root fails the callsign guard with no flag
      // to supply one. A missing/unreadable registry or no matching entry is non-fatal — the
      // env-only case then behaves exactly as before (no registry config).
      teamRoot = process.env['SQUAD_TEAM_ROOT'];
      try {
        const { registry } = loadRegistryFromDisk({ registryPath: options.registryPath });
        const overrideKey = normalisedPathKey(teamRoot);
        const entry = registry?.squads.find(e =>
          normalisedPathKey(path.dirname(e.path)) === overrideKey
        );
        if (entry) {
          stateRemote = entry.stateRemote;
          stateBranch = entry.stateBranch;
          registryAlias = entry.inboxHandle;
          registryCallsign = entry.callsign;
          configRemote = entry.configRemote;
          configBranch = entry.configBranch;
          const entryBackend = entry.stateBackend;
          if (entryBackend && entryBackend !== 'orphan') {
            console.warn(
              `squad sync: warning: entry "${entry.callsign ?? entry.path}" has stateBackend '${entryBackend}' ` +
              `but shared-squad entries enforce orphan backend. Using 'orphan'.`,
            );
          }
          backend = 'orphan';
        }
      } catch { /* best-effort: a missing/unreadable registry must not fail an env-only sync */ }
    } else {
      const { registry } = loadRegistryFromDisk({ registryPath: options.registryPath });
      const normalizedRoot = normalisedPathKey(repoRoot);
      const entry = registry?.squads.find(e =>
        e.clones?.some(c => normalisedPathKey(c) === normalizedRoot)
      );
      if (entry) {
        teamRoot = path.dirname(entry.path); // entry.path ends in .squad
        stateRemote = entry.stateRemote;
        stateBranch = entry.stateBranch;
        registryAlias = entry.inboxHandle;
        registryCallsign = entry.callsign;
        configRemote = entry.configRemote;
        configBranch = entry.configBranch;
        // O: Read entry.stateBackend, default to and enforce 'orphan'.
        // Warn (non-fatal) when an explicit non-orphan value is overridden.
        const entryBackend = entry.stateBackend;
        if (entryBackend && entryBackend !== 'orphan') {
          console.warn(
            `squad sync: warning: entry "${entry.callsign ?? entry.path}" has stateBackend '${entryBackend}' ` +
            `but shared-squad entries enforce orphan backend. Using 'orphan'.`,
          );
        }
        backend = 'orphan';
      } else {
        // Item M: Sync-from-host guard — detect if cwd IS the host root (not a product clone).
        const hostEntry = registry?.squads.find(e =>
          normalisedPathKey(path.dirname(e.path)) === normalizedRoot
        );
        if (hostEntry) {
          console.error(
            `squad sync: you are in the shared-squad host clone (${repoRoot}).\n` +
            `  squad sync runs from a product clone. To publish, run squad sync from your product repository.`,
          );
          process.exit(1);
        }
      }
    }

    // Fallback to config.json for single-repo / unregistered contexts
    if (!teamRoot) {
      const configPath = path.join(repoRoot, '.squad', 'config.json');
      if (fs.existsSync(configPath)) {
        configJsonPresent = true;
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          stateRemote ??= config.stateRemote;
          stateBranch ??= config.stateBranch;
          registryAlias ??= config.inboxHandle;
          backend = config.stateBackend ?? null;
        } catch { /* ignore parse errors — treat as empty config */ }
      }
    }

    // Explicit local/external backends do not use remote sync
    if (backend === 'local' || backend === 'external') {
      if (!quiet) console.log(`squad sync: backend is '${backend}' — no remote sync needed.`);
      return;
    }

    // No registry match AND no config.json AND push direction → error
    if (!teamRoot && !configJsonPresent && isPush && !options.dryRun) {
      console.error(
        `squad sync: no registry entry found for ${repoRoot}.\n` +
        `  Run 'squad assign' to register this repo before syncing.`,
      );
      process.exit(1);
    }

    const crossRepo = teamRoot !== undefined;

    // ── Piece 43/50: cross-repo state remote / branch resolution ──────────────
    // The state remote and the squad/state/<callsign> branch are resolved from the
    // registry / team-root host, not from the code clone's origin. An explicit
    // stateRemote wins ONLY when it exists in the team-root git context (piece 50 §A);
    // otherwise resolution falls back to the host clone's own remote, or fails with an
    // actionable error naming the host git root. The branch derives from the callsign
    // (falling back to the flat legacy `squad-state`).
    const effectiveStateRemote = crossRepo ? resolveStateRemote(teamRoot!, stateRemote) : getCodeCloneRemote();
    const effectiveStateBranch = deriveStateBranch(stateBranch, registryCallsign);

    // ── Piece 53 §A/§D: durable config remote / branch resolution ─────────────
    // The durable lane rides squad/config/<callsign>. Its remote defaults to the state remote
    // (same host) unless an explicit configRemote is set; resolve it in the team-root git context
    // (piece 50 §A). The branch derives from an explicit configBranch or the callsign; when
    // neither yields a branch (a host predating Pole A) the durable lane is skipped.
    const effectiveConfigBranch = deriveConfigBranch(configBranch, registryCallsign);
    const effectiveConfigRemote = crossRepo
      ? resolveStateRemote(teamRoot!, configRemote ?? stateRemote)
      : getCodeCloneRemote();

    // ── Inbox-handle resolution chain ─────────────────────────────────────────
    // Order: (1) --inbox-handle / --developer flag; (2) SQUAD_INBOX_HANDLE env var;
    //        (3) registry entry handle; (4) git config user.email fallback.
    // Trim whitespace so a blank/whitespace-only handle triggers the friendly exit-1 guidance.
    const rawAlias =
      (options.inboxHandle !== undefined ? options.inboxHandle : options.developer)
        ?? process.env['SQUAD_INBOX_HANDLE']
        ?? registryAlias;
    let resolvedAlias = rawAlias?.trim() || undefined;

    // 4th resolution step: derive inbox handle from git config user.email
    if (!resolvedAlias) {
      const gitEmailHandle = deriveHandleFromGitEmail(repoRoot);
      if (gitEmailHandle) {
        console.warn(
          `squad sync: no inbox handle configured; using git config user.email as handle: ${gitEmailHandle}\n` +
          `  Set a permanent handle with 'squad assign --inbox-handle <handle>' to suppress this warning.`,
        );
        resolvedAlias = gitEmailHandle;
      }
    }

    // ── Dry-run: print pending info without publishing ─────────────────────────
    // Must run before handle guard so developers can preview without a configured handle.
    if (options.dryRun) {
      const allFiles = teamRoot ? enumerateSquadFiles(teamRoot) : enumerateSquadFiles(repoRoot);
      const effectiveAlias = resolvedAlias ?? '(handle required)';
      const callsignPrefix = registryCallsign ? `${registryCallsign}/` : '';
      console.log(`squad sync --dry-run`);

      // §D: the DURABLE lane. Route `--push-config --dry-run` through the SAME lane resolver the
      // real publish uses (resolvePublishLane('config')), so the preview shows the CONFIG_ALLOWLIST
      // set, the squad/config-inbox/<callsign>/… target, and the config remote — never the
      // ephemeral lane. `--push --dry-run` (below) is unchanged.
      if (wantConfigPush) {
        const laneCfg = resolvePublishLane('config');
        const configFiles = allFiles.filter(laneCfg.filter);
        console.log(`  Target inbox branch: ${laneCfg.inboxPrefix}/${callsignPrefix}${effectiveAlias}/<timestamp>-<sessionId>`);
        console.log(`  Would publish to remote: ${crossRepo ? effectiveConfigRemote : effectiveStateRemote}`);
        console.log(`  Pending durable files (${configFiles.length} of ${allFiles.length} total, after CONFIG_ALLOWLIST filter):`);
        for (const f of configFiles) {
          console.log(`    ${f}`);
        }
      }

      // The ephemeral (state) lane preview — unchanged. Suppressed when a bare `--push-config`
      // made the durable lane the sole action (pushConfigOnly ⇒ isPush/isPull are false).
      if (isPush || isPull) {
        const laneCfg = resolvePublishLane('state');
        const files = allFiles.filter(laneCfg.filter);
        if (isPush) {
          console.log(`  Target inbox branch: ${laneCfg.inboxPrefix}/${callsignPrefix}${effectiveAlias}/<timestamp>-<sessionId>`);
          console.log(`  Would publish to remote: ${effectiveStateRemote}`);
        }
        if (isPull) {
          console.log(`  Would pull from remote: ${effectiveStateRemote}, branch: ${effectiveStateBranch}`);
        }
        console.log(`  Pending files (${files.length} of ${allFiles.length} total, after allowlist filter):`);
        for (const f of files) {
          console.log(`    ${f}`);
        }
      }
      return;
    }

    if (!resolvedAlias && isPush && crossRepo) {
      console.error(
        `squad sync: inbox handle is required for --push.\n` +
        `  Pass --developer <handle>, set SQUAD_INBOX_HANDLE, or run ` +
        `'squad assign --inbox-handle <handle>' to persist the handle.`,
      );
      process.exit(1);
    }

    if (!quiet) {
      console.log(`squad sync: ${options.direction} (remote: ${effectiveStateRemote}, backend: ${backend ?? 'orphan'})`);
    }
    // ── Sub-proposal C / Piece 53 §D: Pull path ───────────────────────────────
    if (isPull) {
      if (crossRepo) {
        // Piece 53 §D: hydrate the durable config lane FIRST, then the ephemeral state lane.
        // The two write disjoint path sets (piece 52 §C total classifier), so ordering only
        // makes the apply deterministic — it never clobbers. Skip the durable hydrate when no
        // config branch is resolvable (a host predating Pole A) with a one-line notice.
        if (effectiveConfigBranch) {
          try {
            await _transport.hydrateTeamRootFromConfigRef(
              teamRoot!,
              effectiveConfigRemote,
              effectiveConfigBranch,
            );
          } catch (err: unknown) {
            // A missing config branch on the remote (never seeded) must not fail the state pull.
            if (!quiet) {
              const msg = err instanceof Error ? err.message : String(err);
              console.log(`  ℹ️  durable config hydrate skipped: ${msg}`);
            }
          }
        } else if (!quiet) {
          console.log(`  ℹ️  no config branch configured — skipping durable hydrate (host predates Pole A).`);
        }
        // Cross-repo: the authoritative hydration is from the state ref on the host. Do not
        // run the in-clone fetch against the code clone (its origin does not host the state
        // branch — that produced a misleading "no remote squad-state refs" notice).
        await _transport.hydrateTeamRootFromStateRef(
          teamRoot!,
          effectiveStateRemote,
          effectiveStateBranch,
        );
      } else {
        syncPull(repoRoot, getCodeCloneRemote(), backend, quiet);
      }
    }

    // ── Sub-proposal B: Push path ──────────────────────────────────────────────
    if (isPush) {
      if (crossRepo) {
        // Guard: callsign is required for cross-repo publish. Without a callsign the
        // inbox branch would collide with other squads sharing the same remote.
        if (!registryCallsign || !CALLSIGN_RE.test(registryCallsign)) {
          console.error(
            `squad sync: FATAL: no callsign set for this registry entry.\n` +
            `  A callsign is required to publish in cross-repo mode so inbox branches are\n` +
            `  scoped to this squad (squad/inbox/<callsign>/<handle>/...).\n` +
            `  Set it with: squad assign <callsign> --callsign <name>`,
          );
          process.exit(1);
          return;
        }
        const sessionId = process.env['COPILOT_SESSION_ID'] ?? randomUUID();
        await _transport.publishTeamRootToInbox(
          teamRoot!,
          effectiveStateRemote,
          resolvedAlias!,
          sessionId,
          registryCallsign,
        );
        // Write last-publish timestamp after successful cross-repo push.
        writeLastPublish(teamRoot!);
      } else {
        // Single-repo path: unchanged
        syncPush(repoRoot, getCodeCloneRemote(), backend, quiet);
        // Write last-publish timestamp after successful single-repo push.
        writeLastPublish(repoRoot);
      }
    }

    // ── Piece 53 §A: durable config-inbox publish ──────────────────────────────
    // Publishes the CONFIG_ALLOWLIST snapshot to squad/config-inbox/<callsign>/<handle>/<ts>,
    // where the config pipeline opens a review PR into squad/config/<callsign> (§B/§C).
    // Cross-repo only — the durable lane is a shared-squad construct.
    if (wantConfigPush && crossRepo) {
      if (!registryCallsign || !CALLSIGN_RE.test(registryCallsign)) {
        console.error(
          `squad sync: FATAL: no callsign set for this registry entry.\n` +
          `  A callsign is required to publish the durable config lane so config-inbox branches\n` +
          `  are scoped to this squad (squad/config-inbox/<callsign>/<handle>/...).\n` +
          `  Set it with: squad assign <callsign> --callsign <name>`,
        );
        process.exit(1);
        return;
      }
      if (!resolvedAlias) {
        console.error(
          `squad sync: inbox handle is required for --push-config.\n` +
          `  Pass --developer <handle>, set SQUAD_INBOX_HANDLE, or run ` +
          `'squad assign --inbox-handle <handle>' to persist the handle.`,
        );
        process.exit(1);
        return;
      }
      const configSessionId = process.env['COPILOT_SESSION_ID'] ?? randomUUID();
      await _transport.publishTeamRootToInbox(
        teamRoot!,
        effectiveConfigRemote,
        resolvedAlias,
        configSessionId,
        registryCallsign,
        'config',
      );
      if (!quiet) {
        console.log(
          `  ✓ durable config published to ${effectiveConfigRemote}:squad/config-inbox/${registryCallsign}/${resolvedAlias}/… ` +
          `— the config pipeline will open a review PR into ${effectiveConfigBranch ?? `squad/config/${registryCallsign}`}.`,
        );
      }
    } else if (wantConfigPush && !crossRepo) {
      console.error(
        `squad sync: --push-config requires a shared-squad (cross-repo) registry entry.\n` +
        `  The durable config lane rides squad/config/<callsign> on the squad host.\n` +
        `  Run 'squad assign' to register this repo against a shared squad first.`,
      );
      process.exit(1);
    }
  } finally {
    delete process.env[SQUAD_SYNC_ENV];
  }
}
