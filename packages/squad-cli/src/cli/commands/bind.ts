/**
 * squad bind — wire up a cross-repo deployment from scratch.
 *
 * Performs all setup steps atomically:
 *   1. Clone or fetch the docs/specs sidecar into the cache path.
 *   2. Write WORK_ROOT/.squad/config.json with cross-repo fields.
 *   3. Add the `squad-docs` remote in WORK_ROOT (idempotent).
 *   4. Set fetch refspecs for squad-state and squad/inbox branches.
 *   5. Append `.squad/` and `.github/agents/*` to WORK_ROOT/.git/info/exclude (idempotent).
 *   6. Install sync hook templates (post-merge, post-checkout, post-rewrite).
 *   7. Run an initial sync pull to hydrate TEAM_ROOT.
 *
 * Git operations are injected via `BindGitOps` for test isolation.
 *
 * @module cli/commands/bind
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FSStorageProvider } from '@bradygaster/squad-sdk';
import type { SquadDirConfig } from '@bradygaster/squad-sdk';
import { DEVELOPER_ALIAS_RE } from './sync.js';

const storage = new FSStorageProvider();

// ---------------------------------------------------------------------------
// Seam types — injected in tests to avoid real git/fs side effects
// ---------------------------------------------------------------------------

export interface BindGitOps {
  /**
   * Clone `url` into `dest`, or fetch if `dest/.git` already exists.
   * Default: real git clone/fetch.
   */
  cloneOrFetch(url: string, dest: string): void;

  /**
   * Add a remote named `name` pointing at `url` in repo at `cwd`.
   * Should be idempotent — skip silently when the remote already exists.
   */
  addRemote(cwd: string, name: string, url: string): void;

  /**
   * Append a fetch refspec to the named remote in `cwd`.
   * Idempotent — no-op if the exact refspec is already present.
   */
  addRefspec(cwd: string, remoteName: string, refspec: string): void;

  /**
   * Run `squad sync --pull` from `cwd` to hydrate TEAM_ROOT.
   * May be a no-op in tests.
   */
  syncPull(cwd: string): void;
}

function defaultCloneOrFetch(url: string, dest: string): void {
  if (fs.existsSync(path.join(dest, '.git'))) {
    execFileSync('git', ['-C', dest, 'fetch', '--all', '--prune'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else {
    fs.mkdirSync(dest, { recursive: true });
    execFileSync('git', ['clone', url, dest], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

function defaultAddRemote(cwd: string, name: string, url: string): void {
  try {
    execFileSync('git', ['-C', cwd, 'remote', 'add', name, url], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Remote already exists — idempotent, skip silently
  }
}

function defaultAddRefspec(cwd: string, remoteName: string, refspec: string): void {
  // Read existing refspecs for this remote
  let existing = '';
  try {
    existing = execFileSync(
      'git',
      ['-C', cwd, 'config', '--get-all', `remote.${remoteName}.fetch`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    // No refspecs yet — that's fine
  }
  if (existing.split('\n').some(r => r.trim() === refspec)) return;
  execFileSync('git', ['-C', cwd, 'config', '--add', `remote.${remoteName}.fetch`, refspec], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function defaultSyncPull(cwd: string): void {
  try {
    execFileSync('squad', ['sync', '--pull'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Best-effort — initial sync may fail if remote is unreachable
  }
}

export const DEFAULT_GIT_OPS: BindGitOps = {
  cloneOrFetch: defaultCloneOrFetch,
  addRemote: defaultAddRemote,
  addRefspec: defaultAddRefspec,
  syncPull: defaultSyncPull,
};

// ---------------------------------------------------------------------------
// BindOptions
// ---------------------------------------------------------------------------

export interface BindOptions {
  /** Absolute path to the product repo root (WORK_ROOT). */
  workRoot: string;

  /** URL of the docs/specs sidecar repository. */
  teamRepoUrl: string;

  /**
   * Absolute path where the sidecar should be cloned.
   * Defaults to a platform-appropriate directory under the user data dir.
   */
  teamCachePath?: string;

  /**
   * Remote name to configure in WORK_ROOT for the docs remote.
   * @default 'squad-docs'
   */
  stateRemote?: string;

  /**
   * Branch name used for persistent squad state on the docs remote.
   * @default 'squad-state'
   */
  stateBranch?: string;

  /**
   * Prefix for per-developer inbox branches on the docs remote.
   * @default 'squad/inbox'
   */
  inboxBranchPrefix?: string;

  /** Short alias identifying the developer in cross-repo workflows. */
  developerAlias?: string;

  /**
   * When true, the sync command will also hydrate the WORK_ROOT projection.
   * @default false
   */
  hydrateWorkRoot?: boolean;

  /** Injected git operations — replace with stubs in tests. */
  gitOps?: BindGitOps;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Append `entry` to the git exclude file at `excludePath` if not already present.
 * Normalizes the entry to forward-slash form regardless of host OS.
 */
function appendExcludeEntry(excludePath: string, rawEntry: string): void {
  // Always use forward-slash patterns in git exclude files (cross-platform)
  const entry = rawEntry.replace(/\\/g, '/');

  let existing = '';
  if (fs.existsSync(excludePath)) {
    existing = fs.readFileSync(excludePath, 'utf-8');
  }

  const lines = existing.split('\n').map(l => l.trim());
  if (lines.includes(entry)) return;

  // Ensure trailing newline before appending
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.appendFileSync(excludePath, `${prefix}${entry}\n`, 'utf-8');
}

/**
 * Resolve the default sidecar cache path on this platform.
 * Returns a path under the user data directory.
 */
function defaultTeamCachePath(workRoot: string): string {
  // Use a directory adjacent to workRoot named `<workRoot-basename>-squad-docs`
  const base = path.dirname(workRoot);
  const name = path.basename(workRoot);
  return path.join(base, `${name}-squad-docs`);
}

// ---------------------------------------------------------------------------
// runBind — main entrypoint
// ---------------------------------------------------------------------------

/**
 * Perform all cross-repo bind setup steps for WORK_ROOT.
 *
 * Idempotent: safe to call multiple times on an already-configured WORK_ROOT.
 */
export async function runBind(opts: BindOptions): Promise<void> {
  const {
    workRoot,
    teamRepoUrl,
    stateRemote = 'squad-docs',
    stateBranch = 'squad-state',
    inboxBranchPrefix = 'squad/inbox',
    developerAlias,
    hydrateWorkRoot = false,
    gitOps = DEFAULT_GIT_OPS,
  } = opts;

  // Sub-proposal E: validate alias format before any writes
  if (developerAlias !== undefined) {
    if (!DEVELOPER_ALIAS_RE.test(developerAlias)) {
      console.error(
        `squad bind: --developer-alias '${developerAlias}' is invalid.\n` +
        `  Must match ^[a-z][a-z0-9-]{0,38}$ (lowercase letters, digits, hyphens; ` +
        `starts with a letter; max 39 chars).`,
      );
      process.exit(1);
    }
  }

  const teamCachePath = opts.teamCachePath ?? defaultTeamCachePath(workRoot);

  // Step 1: Clone or fetch the sidecar
  gitOps.cloneOrFetch(teamRepoUrl, teamCachePath);

  // Step 2: Write WORK_ROOT/.squad/config.json
  const squadDir = path.join(workRoot, '.squad');
  storage.mkdirSync(squadDir, { recursive: true });

  const relativeTeamRoot = path.relative(workRoot, teamCachePath);

  const config: SquadDirConfig = {
    version: 1,
    teamRoot: relativeTeamRoot,
    projectKey: null,
    stateRemote,
    stateBranch,
    inboxBranchPrefix,
    stateBackend: 'orphan',           // Sub-proposal B: persist permanently
    ...(developerAlias !== undefined ? { developerAlias } : {}),
    ...(opts.teamCachePath !== undefined ? { teamCachePath: opts.teamCachePath } : {}),
    ...(hydrateWorkRoot ? { hydrateWorkRoot: true } : {}),
  };

  storage.writeSync(
    path.join(squadDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );

  // Step 3: Add the squad-docs remote (idempotent)
  gitOps.addRemote(workRoot, stateRemote, teamRepoUrl);

  // Step 4: Set fetch refspecs for squad-state and squad/inbox branches
  gitOps.addRefspec(
    workRoot,
    stateRemote,
    `+refs/heads/${stateBranch}:refs/remotes/${stateRemote}/${stateBranch}`,
  );
  gitOps.addRefspec(
    workRoot,
    stateRemote,
    `+refs/heads/${inboxBranchPrefix}/*:refs/remotes/${stateRemote}/${inboxBranchPrefix}/*`,
  );

  // Step 5: Append entries to WORK_ROOT/.git/info/exclude (idempotent)
  const excludePath = path.join(workRoot, '.git', 'info', 'exclude');
  appendExcludeEntry(excludePath, '.squad/');
  appendExcludeEntry(excludePath, '.github/agents/*');

  // Step 6: Install or update sync hook templates.
  // installGitHooks reads stateBackend from the on-disk config.json written in Step 2.
  // stateBackend: 'orphan' is now in the canonical config, so no intermediate flush needed.
  const { installGitHooks } = await import('./install-hooks.js');
  installGitHooks(workRoot, { force: false });

  // Step 7: Initial sync pull (best-effort)
  gitOps.syncPull(workRoot);
}
