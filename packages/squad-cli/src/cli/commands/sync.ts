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
import crypto from 'node:crypto';
import type { SquadDirConfig } from '@bradygaster/squad-sdk';
import { OrphanBranchBackend } from '@bradygaster/squad-sdk';

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

/**
 * Injection seam for inbox publish and hydration git operations.
 * Separates from SyncGitOps because the operation set is distinct.
 * Default implementation uses real git subprocesses; tests inject stubs.
 */
export interface InboxGitOps {
  /** Fetch a refspec from a remote; throws if the remote ref is absent */
  fetchRef(cwd: string, remote: string, refspec: string): void;
  /** Resolve a ref to its SHA; throws if the ref does not exist */
  revParse(cwd: string, ref: string): string;
  /** Resolve a ref to its SHA; returns null instead of throwing */
  revParseOrNull(cwd: string, ref: string): string | null;
  /** Update or create a local ref to point to a commit SHA */
  updateRef(cwd: string, ref: string, sha: string): void;
  /** List all files tracked in a branch tree (ls-tree -r --name-only) */
  lsTree(cwd: string, branch: string): string[];
  /** Write a file into the git object store; returns the blob SHA */
  hashObject(cwd: string, absPath: string): string;
  /** Stage a cached entry into the index (update-index --add --cacheinfo) */
  updateIndex(cwd: string, mode: string, blobHash: string, relPath: string, env: NodeJS.ProcessEnv): void;
  /** Flush the index to a tree object; returns the tree SHA */
  writeTree(cwd: string, env: NodeJS.ProcessEnv): string;
  /** Create a rootless commit from a tree; returns the commit SHA */
  commitTree(cwd: string, tree: string, message: string, env: NodeJS.ProcessEnv): string;
  /** Push a refspec to a remote */
  push(cwd: string, remote: string, refspec: string): void;
}

/** Production InboxGitOps — real git subprocesses. */
export const DEFAULT_INBOX_GIT_OPS: InboxGitOps = {
  fetchRef(cwd, remote, refspec) {
    execFileSync('git', ['fetch', remote, refspec], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  },
  revParse(cwd, ref) {
    return execFileSync('git', ['rev-parse', ref], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  },
  revParseOrNull(cwd, ref) {
    try {
      return execFileSync('git', ['rev-parse', ref], {
        cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  },
  updateRef(cwd, ref, sha) {
    execFileSync('git', ['update-ref', ref, sha], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
    });
  },
  lsTree(cwd, branch) {
    return listBranchFiles(cwd, branch);
  },
  hashObject(cwd, absPath) {
    return execFileSync('git', ['hash-object', '-w', absPath], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  },
  updateIndex(cwd, mode, blobHash, relPath, env) {
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `${mode},${blobHash},${relPath}`], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env,
    });
  },
  writeTree(cwd, env) {
    return execFileSync('git', ['write-tree'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env,
    }).trim();
  },
  commitTree(cwd, tree, message, env) {
    return execFileSync('git', ['commit-tree', tree, '-m', message], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env,
    }).trim();
  },
  push(cwd, remote, refspec) {
    execFileSync('git', ['push', remote, refspec], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  },
};

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
type SyncConfig = Pick<SquadDirConfig, 'stateRemote' | 'developerAlias'> &
  Partial<Pick<SquadDirConfig, 'stateBranch'>> & {
    teamRoot?: string;
  };

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
      teamRoot: typeof parsed.teamRoot === 'string' ? parsed.teamRoot : undefined,
      stateBranch: typeof parsed.stateBranch === 'string' ? parsed.stateBranch : undefined,
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

    // Resolve alias to outer scope — needed by both the guard and push dispatch
    let resolvedAlias: string | undefined;
    if (isPushDirection) {
      resolvedAlias =
        options.developer !== undefined
          ? options.developer
          : process.env['SQUAD_DEVELOPER_ALIAS'] ?? syncConfig?.developerAlias;

      if (!resolvedAlias || !resolvedAlias.trim()) {
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
      // Sub-proposal C: hydrate TEAM_ROOT sidecar from the fetched state branch
      if (syncConfig?.teamRoot) {
        const absTeamRoot = path.resolve(repoRoot, syncConfig.teamRoot);
        const stateBranch = syncConfig.stateBranch ?? 'squad-state';
        await hydrateTeamRootFromStateRef(absTeamRoot, remote, stateBranch);
      }
    }
    if (isPush) {
      if (syncConfig?.teamRoot) {
        // Sub-proposal A: cross-repo — publish per-developer inbox branch
        const sessionId = process.env['COPILOT_SESSION_ID'] ?? crypto.randomUUID();
        const inboxBranch = computeInboxBranchName(resolvedAlias!, sessionId);
        const absTeamRoot = path.resolve(repoRoot, syncConfig.teamRoot);
        await publishTeamRootToInbox(absTeamRoot, remote, inboxBranch, {
          developerAlias: resolvedAlias!,
          sessionId,
          workRoot: repoRoot,
        });
      } else {
        syncPush(repoRoot, remote, backend, quiet);
      }
    }
  } finally {
    delete process.env[SQUAD_SYNC_ENV];
  }
}

// ============================================================================
// Piece 28 — Inbox branch publish flow
// ============================================================================

/** developerAlias must be lowercase letters, digits, and hyphens; starts with a letter; max 39 chars */
export const DEVELOPER_ALIAS_RE = /^[a-z][a-z0-9-]{0,38}$/;

/**
 * sessionId must be a UUID v4 or a lowercase hex-dash string of 8–64 chars.
 * Rejects @, /, \, whitespace, and other shell-unsafe characters.
 */
const SESSION_ID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9-]{8,64})$/;

/** Snapshot payload — paths relative to TEAM_ROOT that may appear in an inbox publish commit */
const SNAPSHOT_ALLOWLIST: ReadonlyArray<string> = [
  '.squad/decisions.md',
  '.squad/decisions/inbox',
  '.squad/log',
  '.squad/orchestration-log',
  '.squad/sessions',
  '.squad/identity',
  '.squad/publish-metadata.json',
];

/**
 * Provenance metadata written to `.squad/publish-metadata.json` in each
 * inbox publish commit.
 *
 * `sourceWorkRoot` MUST NOT contain raw path strings — only `{repo, pathHash}`.
 *
 * Retained as public export: consumed by tests and the Piece 30 fold pipeline.
 */
export interface PublishMetadata {
  developerAlias: string;
  sessionId: string;
  sourceWorkRoot: {
    /** Basename of the WORK_ROOT git repository directory */
    repo: string;
    /** SHA-256 hexdigest of the normalized absolute WORK_ROOT path, prefixed with 'sha256:' */
    pathHash: string;
  };
  /** ISO 8601 UTC timestamp with Z suffix */
  publishedAt: string;
  /** The squad-state commit SHA this snapshot is derived from */
  baseStateCommit: string;
}

/**
 * Options for `publishTeamRootToInbox()`.
 */
export interface InboxPublishOpts {
  /** Short alias identifying the developer — must match `^[a-z][a-z0-9-]{0,38}$` */
  developerAlias: string;
  /** UUID or short ID uniquely identifying this session */
  sessionId: string;
  /**
   * Absolute path to the WORK_ROOT (product repo).
   * Never stored raw — only a SHA-256 pathHash goes into metadata.
   */
  workRoot: string;
  /** The squad-state commit SHA this snapshot is derived from. Empty string if unknown. */
  baseStateCommit?: string;
}

/**
 * Compute the SHA-256 pathHash for a given WORK_ROOT path.
 *
 * Normalization: lowercased, forward-slash-separated, no trailing slash.
 * Returns the hash prefixed with `'sha256:'`.
 *
 * Retained as public export: consumed by tests and the Piece 30 fold pipeline.
 */
export function computePathHash(workRoot: string): string {
  const normalized = workRoot
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  const hex = crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * Compute the inbox branch name for a publish operation.
 *
 * Format: `squad/inbox/<developerAlias>/<yyyyMMdd-HHmmss>-<sessionId>`
 *
 * Retained as public export: consumed by tests and the Piece 30 fold pipeline.
 */
export function computeInboxBranchName(developerAlias: string, sessionId: string): string {
  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  const yyyyMMdd = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
  ].join('');
  const HHmmss = [
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('');
  return `squad/inbox/${developerAlias}/${yyyyMMdd}-${HHmmss}-${sessionId}`;
}

/**
 * Recursively collect all files under teamRoot that fall within the snapshot
 * allowlist. Returns `{ rel, abs }` pairs where `rel` is forward-slash-separated
 * relative to `teamRoot`.
 *
 * Fails closed: any file found within `.squad/` that is NOT on the allowlist causes
 * an immediate throw. Files outside `.squad/` are silently ignored (not squad state).
 */
function collectSnapshotFiles(teamRoot: string, dir: string = ''): { rel: string; abs: string }[] {
  const result: { rel: string; abs: string }[] = [];
  const absDir = dir ? path.join(teamRoot, ...dir.split('/')) : teamRoot;

  if (!fs.existsSync(absDir)) return result;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const absEntry = path.join(absDir, entry.name);
    const relEntry = dir ? `${dir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      result.push(...collectSnapshotFiles(teamRoot, relEntry));
    } else if (entry.isFile()) {
      const isAllowed = SNAPSHOT_ALLOWLIST.some(
        (a) => relEntry === a || relEntry.startsWith(a + '/'),
      );
      if (isAllowed) {
        result.push({ rel: relEntry, abs: absEntry });
      } else if (relEntry.startsWith('.squad/')) {
        // Any .squad/ file not on the allowlist is a hard error — fail closed,
        // never silently include or skip it.
        throw new Error(
          `squad publish: path '${relEntry}' is within .squad/ but is not on the ` +
          `snapshot payload allowlist. Remove the file or update the allowlist.`,
        );
      }
      // Files outside .squad/ are irrelevant to the snapshot — silently skip.
    }
  }

  return result;
}

/**
 * List all files recursively in a git branch using ls-tree -r.
 */
function listBranchFiles(teamRoot: string, branch: string): string[] {
  try {
    const output = execFileSync(
      'git', ['ls-tree', '-r', '--name-only', branch],
      { cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Recursively collect all files under a directory.
 * Returns `{ rel, abs }` pairs where `rel` is relative to `base` with forward slashes.
 */
function collectAllFilesUnder(dir: string, base: string): { rel: string; abs: string }[] {
  const result: { rel: string; abs: string }[] = [];
  if (!fs.existsSync(dir)) return result;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const absEntry = path.join(dir, entry.name);
    const relEntry = path.relative(base, absEntry).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      result.push(...collectAllFilesUnder(absEntry, base));
    } else if (entry.isFile()) {
      result.push({ rel: relEntry, abs: absEntry });
    }
  }
  return result;
}

/**
 * Hydrate TEAM_ROOT from a remote state branch.
 *
 * Fetches `refs/heads/<stateBranch>` from `<remote>` and fast-forwards
 * (or creates) the local `<stateBranch>` ref to match. Then populates the
 * TEAM_ROOT working directory with the file tree from that branch using
 * `OrphanBranchBackend` for content reads.
 *
 * Idempotent: if TEAM_ROOT already points to the fetched commit, no work is done.
 *
 * @param teamRoot    - Absolute path to the sidecar clone (TEAM_ROOT directory).
 * @param remote      - Name of the git remote that holds the state branch.
 * @param stateBranch - Name of the state branch (e.g. `'squad-state'`).
 */
export async function hydrateTeamRootFromStateRef(
  teamRoot: string,
  remote: string,
  stateBranch: string,
  gitOps: InboxGitOps = DEFAULT_INBOX_GIT_OPS,
): Promise<void> {
  // Fetch the state branch from remote, updating the remote-tracking ref
  try {
    gitOps.fetchRef(teamRoot, remote, `refs/heads/${stateBranch}:refs/remotes/${remote}/${stateBranch}`);
  } catch {
    // Branch does not exist on remote yet — nothing to hydrate
    return;
  }

  // Resolve the fetched commit SHA from the remote-tracking ref
  const remoteSha = gitOps.revParseOrNull(teamRoot, `refs/remotes/${remote}/${stateBranch}`);
  if (!remoteSha) return;

  // Check if the local branch already exists and is at this commit
  const localSha = gitOps.revParseOrNull(teamRoot, `refs/heads/${stateBranch}`);
  if (localSha === remoteSha) {
    return; // Already at the fetched commit — idempotent exit
  }

  // Fast-forward (or create) the local branch ref to the fetched commit
  gitOps.updateRef(teamRoot, `refs/heads/${stateBranch}`, remoteSha);

  // Use OrphanBranchBackend to read the branch's file tree and populate the
  // working directory. This avoids raw `git show` calls on individual files.
  const backend = new OrphanBranchBackend(teamRoot, stateBranch);
  const allFiles = gitOps.lsTree(teamRoot, stateBranch);

  for (const relPath of allFiles) {
    const content = backend.read(relPath);
    if (content !== undefined) {
      const destPath = path.join(teamRoot, ...relPath.split('/'));
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content, 'utf-8');
    }
  }
}

/**
 * Hydrate the WORK_ROOT projection from TEAM_ROOT.
 *
 * Copies the `.squad/` subtree of TEAM_ROOT into the corresponding `.squad/`
 * directory in WORK_ROOT. Files removed from TEAM_ROOT are also removed from
 * WORK_ROOT's projection.
 *
 * Does not touch any file outside the `.squad/` subdirectory of WORK_ROOT.
 *
 * @param workRoot - Absolute path to the product repo (WORK_ROOT).
 * @param teamRoot - Absolute path to the sidecar clone (TEAM_ROOT).
 */
export async function hydrateWorkRootProjection(
  workRoot: string,
  teamRoot: string,
): Promise<void> {
  const srcSquad = path.join(teamRoot, '.squad');
  const dstSquad = path.join(workRoot, '.squad');

  if (!fs.existsSync(srcSquad)) {
    return;
  }

  fs.mkdirSync(dstSquad, { recursive: true });

  const srcFiles = collectAllFilesUnder(srcSquad, srcSquad);
  const copiedRels = new Set<string>();

  for (const { rel, abs } of srcFiles) {
    const destPath = path.join(dstSquad, ...rel.split('/'));
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(abs, destPath);
    copiedRels.add(rel);
  }

  // Remove files from WORK_ROOT's .squad/ that no longer exist in TEAM_ROOT
  const dstFiles = collectAllFilesUnder(dstSquad, dstSquad);
  for (const { rel, abs } of dstFiles) {
    if (!copiedRels.has(rel)) {
      try { fs.unlinkSync(abs); } catch { /* best-effort */ }
    }
  }
}

/**
 * Publish TEAM_ROOT state to a per-developer inbox branch on the state remote.
 *
 * Creates a commit on a new branch named by `inboxBranch` containing only the
 * snapshot payload allowlist paths from TEAM_ROOT, plus a `.squad/publish-metadata.json`
 * provenance file. Pushes the branch to `remote`.
 *
 * The branch is isolated to this session — concurrent publishes from different
 * developers create independent refs with no non-fast-forward relationship.
 *
 * **PII guardrail:** Raw absolute paths MUST NOT appear in the provenance file.
 * `sourceWorkRoot` stores `{repo: basename, pathHash: sha256:<hex>}` only.
 *
 * @param teamRoot    - Absolute path to the sidecar clone (TEAM_ROOT directory).
 * @param remote      - Name of the git remote to push to.
 * @param inboxBranch - Full inbox branch name (from `computeInboxBranchName()`).
 * @param opts        - Publish metadata options including `developerAlias`.
 */
export async function publishTeamRootToInbox(
  teamRoot: string,
  remote: string,
  inboxBranch: string,
  opts: InboxPublishOpts,
  gitOps: InboxGitOps = DEFAULT_INBOX_GIT_OPS,
): Promise<void> {
  const { developerAlias, sessionId, workRoot, baseStateCommit = '' } = opts;

  // [RETRO H] Validate inboxBranch namespace BEFORE alias parsing and BEFORE any git op
  if (!inboxBranch.startsWith('squad/inbox/')) {
    throw new Error(
      `squad publish: inboxBranch must start with 'squad/inbox/' — got '${inboxBranch}'. ` +
      `Use computeInboxBranchName() to construct a valid branch name.`,
    );
  }

  // [RETRO H] Validate sessionId charset before any git op
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      `squad publish: sessionId must be a UUID v4 or match ^[a-z0-9-]{8,64}$ ` +
      `(no @, /, \\, whitespace, or shell-unsafe chars). Got: '${sessionId}'`,
    );
  }

  // [CAPCOM TS] Validate developerAlias — throw, not process.exit, so callers can catch
  if (!developerAlias || !DEVELOPER_ALIAS_RE.test(developerAlias)) {
    throw new Error(
      `squad publish: developerAlias must match ^[a-z][a-z0-9-]{0,38}$ ` +
      `(lowercase letters, digits, hyphens; starts with a letter; max 39 chars). ` +
      `Got: '${developerAlias}'`,
    );
  }

  // Build provenance metadata — no raw paths allowed
  const workRootNorm = workRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const workRootBasename = workRootNorm.split('/').pop() ?? 'unknown';
  const pathHash = computePathHash(workRoot);

  const metadata: PublishMetadata = {
    developerAlias,
    sessionId,
    sourceWorkRoot: {
      repo: workRootBasename,
      pathHash,
    },
    publishedAt: new Date().toISOString(),
    baseStateCommit,
  };

  // [RETRO M] Atomic write — tmp file + rename prevents torn JSON on crash
  const squadDir = path.join(teamRoot, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  const metadataPath = path.join(squadDir, 'publish-metadata.json');
  const metadataTmpPath = `${metadataPath}.tmp`;
  fs.writeFileSync(metadataTmpPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
  fs.renameSync(metadataTmpPath, metadataPath);

  // [FIDO CRITICAL] Collect snapshot files — throws on non-allowlisted .squad/ paths
  let snapshotFiles = collectSnapshotFiles(teamRoot);

  if (snapshotFiles.length === 0) {
    snapshotFiles = [{ rel: '.squad/publish-metadata.json', abs: metadataPath }];
  }

  // Belt-and-suspenders: validate collected files (collectSnapshotFiles already throws
  // for .squad/ violations; this loop catches any future code-path regressions)
  for (const { rel } of snapshotFiles) {
    const isAllowed = SNAPSHOT_ALLOWLIST.some(
      (a) => rel === a || rel.startsWith(a + '/'),
    );
    if (!isAllowed) {
      throw new Error(
        `squad publish: path '${rel}' is outside the snapshot payload allowlist.`,
      );
    }
  }

  // Build the commit using a temporary git index to avoid disturbing the main index
  const tmpIndexPath = path.join(teamRoot, '.git', `tmp-inbox-${Date.now()}-${sessionId}`);
  try {
    const gitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: developerAlias,
      GIT_AUTHOR_EMAIL: `${developerAlias}@squad.local`,
      GIT_COMMITTER_NAME: developerAlias,
      GIT_COMMITTER_EMAIL: `${developerAlias}@squad.local`,
      GIT_INDEX_FILE: tmpIndexPath,
    };

    // Stage each snapshot file into the temporary index
    for (const { rel, abs } of snapshotFiles) {
      const blobHash = gitOps.hashObject(teamRoot, abs);
      gitOps.updateIndex(teamRoot, '100644', blobHash, rel, gitEnv);
    }

    // Write the tree from the temporary index
    const tree = gitOps.writeTree(teamRoot, gitEnv);

    // Create a rootless commit (inbox branches are independent — no parent)
    const commit = gitOps.commitTree(
      teamRoot, tree,
      `squad inbox publish: ${developerAlias}/${sessionId}`,
      gitEnv,
    );

    // Create the local branch ref
    gitOps.updateRef(teamRoot, `refs/heads/${inboxBranch}`, commit);

    // Push to remote — inbox branches are always new refs, so no non-fast-forward
    gitOps.push(teamRoot, remote, `refs/heads/${inboxBranch}:refs/heads/${inboxBranch}`);
  } finally {
    try { fs.unlinkSync(tmpIndexPath); } catch { /* best-effort */ }
  }
}
