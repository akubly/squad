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
import path from 'node:path';
import fs from 'node:fs';
import type { SquadDirConfig } from '@bradygaster/squad-sdk';

// Bridge: the installed SDK version predates stateRemote/developerAlias additions.
// Augmenting here preserves compile-time field-rename safety against the SDK interface.
declare module '@bradygaster/squad-sdk' {
  interface SquadDirConfig {
    stateRemote?: string;
    developerAlias?: string;
  }
}

const SQUAD_SYNC_ENV = 'SQUAD_SYNC_ACTIVE';
const STATE_BRANCH_PREFIX = 'squad-state';

/**
 * Injection seam for git operations — allows tests to stub without spawning git.
 */
export interface SyncGitOps {
  listRemotes(cwd: string): string[];
  getRefspecs(cwd: string, remoteName: string): string[];
  addFetchRefspec(cwd: string, remoteName: string, refspec: string): void;
}

/** Production implementation using real git subprocesses. */
export const DEFAULT_SYNC_GIT_OPS: SyncGitOps = {
  listRemotes(cwd: string): string[] {
    try {
      return execFileSync('git', ['remote'], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  },
  getRefspecs(cwd: string, remoteName: string): string[] {
    try {
      const raw = execFileSync('git', ['config', '--get-all', `remote.${remoteName}.fetch`], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  },
  addFetchRefspec(cwd: string, remoteName: string, refspec: string): void {
    execFileSync('git', ['config', '--add', `remote.${remoteName}.fetch`, refspec], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  },
};

export interface SyncOptions {
  direction: 'push' | 'pull' | 'both' | 'hydrate-only' | 'publish-only';
  remote?: string;
  cwd?: string;
  quiet?: boolean;
  developer?: string;
  gitOps?: SyncGitOps;
  /** Repo root override — skips git rev-parse when provided (used in tests). */
  workRoot?: string;
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
 * Resolve the default remote for the current branch (or fallback to 'origin').
 */
function resolveRemote(cwd: string): string {
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const remote = execFileSync('git', ['config', `branch.${branch}.remote`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return remote || 'origin';
  } catch {
    return 'origin';
  }
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

/**
 * Typed subset of .squad/config.json fields used by sync.
 * Typed against SquadDirConfig so field renames in the SDK schema produce tsc errors.
 */
type SyncConfig = Pick<SquadDirConfig, 'stateRemote' | 'developerAlias'>;

/**
 * Read sync-relevant fields from .squad/config.json with full type safety.
 * Returns null when the file is absent or unparseable.
 */
function readSyncConfig(repoRoot: string): SyncConfig | null {
  try {
    const configPath = path.join(repoRoot, '.squad', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SquadDirConfig>;
    return {
      stateRemote: typeof parsed.stateRemote === 'string' ? parsed.stateRemote : undefined,
      developerAlias: typeof parsed.developerAlias === 'string' ? parsed.developerAlias : undefined,
    };
  } catch {
    return null;
  }
}

const REQUIRED_REFSPECS = (remote: string) => [
  `+refs/heads/squad-state:refs/remotes/${remote}/squad-state`,
  `+refs/heads/squad/inbox/*:refs/remotes/${remote}/squad/inbox/*`,
];

/**
 * Ensure the given remote exists and has required fetch refspecs configured.
 * Exits 1 with bind-guidance message if the remote is absent.
 * Idempotently adds only missing refspecs.
 */
export async function ensureStateRemote(
  repoRoot: string,
  remoteName: string,
  gitOps: SyncGitOps = DEFAULT_SYNC_GIT_OPS,
): Promise<void> {
  const remotes = gitOps.listRemotes(repoRoot);
  if (!remotes.includes(remoteName)) {
    console.error(
      `squad sync: remote '${remoteName}' not found.\n` +
      `  Run 'squad bind <team-repo-url>' to configure the docs remote and refspecs.\n` +
      `  Or add the remote manually: git remote add ${remoteName} <url>`,
    );
    process.exit(1);
  }

  const existing = gitOps.getRefspecs(repoRoot, remoteName);
  for (const refspec of REQUIRED_REFSPECS(remoteName)) {
    if (!existing.includes(refspec)) {
      gitOps.addFetchRefspec(repoRoot, remoteName, refspec);
    }
  }
}


export async function runSync(options: SyncOptions): Promise<void> {
  // Recursion guard — prevent re-entry when our push triggers pre-push
  if (process.env[SQUAD_SYNC_ENV]) {
    return;
  }
  process.env[SQUAD_SYNC_ENV] = '1';

  try {
    const cwd = options.cwd || process.cwd();
    const repoRoot = options.workRoot ?? getRepoRoot(cwd);

    // Remote resolution: CLI flag → config → default
    const syncConfig = readSyncConfig(repoRoot);
    const remote =
      options.remote ??
      syncConfig?.stateRemote ??
      'squad-docs';

    const gitOps = options.gitOps ?? DEFAULT_SYNC_GIT_OPS;
    const backend = detectBackend(repoRoot);
    const quiet = options.quiet ?? false;

    // --developer guard: push paths require a known alias BEFORE any git ops
    const isPushDirection =
      options.direction === 'push' ||
      options.direction === 'both' ||
      options.direction === 'publish-only';

    if (isPushDirection) {
      const alias =
        options.developer !== undefined
          ? options.developer
          : syncConfig?.developerAlias;

      if (!alias || !alias.trim()) {
        console.error(
          `squad sync: --developer <alias> is required for push operations.\n` +
          `  Provide it via: squad sync --push --developer <alias>\n` +
          `  Or set developerAlias in .squad/config.json`,
        );
        process.exit(1);
      }
    }

    // Skip sync for backends that don't need it
    if (backend === 'local' || backend === 'external' || backend === null) {
      if (!quiet) console.log(`squad sync: backend is '${backend || 'local'}' — no remote sync needed.`);
      return;
    }

    if (!quiet) console.log(`squad sync: ${options.direction} (remote: ${remote}, backend: ${backend || 'orphan'})`);

    const isPull =
      options.direction === 'pull' ||
      options.direction === 'both' ||
      options.direction === 'hydrate-only';
    const isPush =
      options.direction === 'push' ||
      options.direction === 'both' ||
      options.direction === 'publish-only';

    await ensureStateRemote(repoRoot, remote, gitOps);

    if (isPull) {
      syncPull(repoRoot, remote, backend, quiet);
    }
    if (isPush) {
      syncPush(repoRoot, remote, backend, quiet);
    }
  } finally {
    delete process.env[SQUAD_SYNC_ENV];
  }
}
