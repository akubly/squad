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
import { DEVELOPER_ALIAS_RE } from '@bradygaster/squad-sdk/validation';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';

const SQUAD_SYNC_ENV = 'SQUAD_SYNC_ACTIVE';
const STATE_BRANCH_PREFIX = 'squad-state';

export interface SyncOptions {
  direction: 'push' | 'pull' | 'both';
  remote?: string;
  cwd?: string;
  quiet?: boolean;
  /** Developer alias for cross-repo inbox publish. Overrides env var and registry entry. */
  developer?: string;
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
const PUBLISH_ALLOWLIST_EXACT = ['.squad/decisions.md'];
const PUBLISH_ALLOWLIST_PREFIX = [
  '.squad/decisions/inbox/',
  '.squad/log/',
  '.squad/orchestration-log/',
  '.squad/sessions/',
  '.squad/identity/',
];

function isAllowlisted(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (PUBLISH_ALLOWLIST_EXACT.includes(p)) return true;
  return PUBLISH_ALLOWLIST_PREFIX.some(prefix => p.startsWith(prefix));
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

/** Format a Date as yyyyMMdd-HHmmss from its UTC representation. */
function formatPublishTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

/**
 * Publish a snapshot of TEAM_ROOT/.squad/ (allowlisted subtree) to a
 * per-session inbox branch on `remote`.
 *
 * Parameterized: takes all resolved inputs as arguments.
 * Does NOT read config.json, call detectBackend, or query the registry.
 */
export async function publishTeamRootToInbox(
  teamRoot: string,
  remote: string,
  developerAlias: string,
  sessionId: string,
): Promise<void> {
  // Step 1: Validate developerAlias before any git operation
  if (!DEVELOPER_ALIAS_RE.test(developerAlias)) {
    throw new Error(
      `Invalid developerAlias "${developerAlias}": must match /^[a-z][a-z0-9-]{1,38}$/ (lowercase, starts with a letter, hyphens allowed, max 39 chars).`,
    );
  }

  // Step 1b: Validate sessionId for git-ref legality before constructing any branch name
  if (!sessionId || SESSION_ID_FORBIDDEN_RE.test(sessionId) || sessionId.startsWith('/') || sessionId.startsWith('-') || sessionId.endsWith('/') || sessionId.endsWith('.lock')) {
    throw new Error(
      `Invalid sessionId "${sessionId}": must be non-empty and must not contain characters illegal in a git ref component (whitespace, control chars, ~^:?*[\\, .., @{, consecutive/leading/trailing slashes, leading dash, or .lock suffix).`,
    );
  }

  // Step 2: Build inbox branch name
  const ts = formatPublishTimestamp(new Date());
  const inboxBranch = `squad/inbox/${developerAlias}/${ts}-${sessionId}`;

  // Step 3: Resolve base commit
  const baseStateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  // Step 4: Enumerate files and enforce allowlist BEFORE any git object is created
  const squadFiles = enumerateSquadFiles(teamRoot);
  for (const relPath of squadFiles) {
    if (!isAllowlisted(relPath)) {
      throw new Error(
        `Publish blocked: path "${relPath}" is outside the allowed .squad/ subtree. ` +
        `Only decisions.md, decisions/inbox/**, log/**, orchestration-log/**, sessions/**, and identity/** may be published.`,
      );
    }
  }

  // Step 5: Build snapshot via git plumbing with isolated index
  const indexFile = path.join(
    teamRoot, '.git',
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
    // Hash and stage each allowlisted file
    for (const relPath of squadFiles) {
      const fullPath = path.join(teamRoot, relPath.replace(/\//g, path.sep));
      const content = fs.readFileSync(fullPath);
      const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: teamRoot, env: indexEnv, input: content,
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${sha},${relPath}`], {
        cwd: teamRoot, env: indexEnv, stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // §9 PII: sourceWorkRoot is {repo: basename, pathHash: sha256(normalizedAbsPath)} — no raw path
    const normalizedTeamRoot = teamRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const pathHash = 'sha256:' + createHash('sha256').update(normalizedTeamRoot).digest('hex');
    const metadata = {
      developerAlias,
      sessionId,
      sourceWorkRoot: {
        repo: path.basename(teamRoot),
        pathHash,
      },
      publishedAt: new Date().toISOString(),
      baseStateCommit,
    };
    const metadataJson = JSON.stringify(metadata, null, 2);
    const metadataSha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: teamRoot, env: indexEnv, input: Buffer.from(metadataJson, 'utf-8'),
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${metadataSha},.squad/publish-metadata.json`], {
      cwd: teamRoot, env: indexEnv, stdio: ['pipe', 'pipe', 'pipe'],
    });

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

/**
 * Hydrate TEAM_ROOT working directory from a state ref on `remote`.
 *
 * Fetches the state branch, then writes its tree files into TEAM_ROOT without
 * altering HEAD. Idempotent: returns early when HEAD already equals the fetched commit.
 *
 * Parameterized: takes all resolved inputs as arguments.
 * Does NOT read config.json, call detectBackend, or query the registry.
 */
export async function hydrateTeamRootFromStateRef(
  teamRoot: string,
  remote: string,
  stateBranch: string,
): Promise<void> {
  // Step 1: Fetch the state branch into a remote-tracking ref
  try {
    execFileSync('git', [
      'fetch', remote,
      `refs/heads/${stateBranch}:refs/remotes/${remote}/${stateBranch}`,
    ], { cwd: teamRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err.message) : String(err);
    throw new Error(
      `hydrateTeamRootFromStateRef: failed to fetch "${stateBranch}" from "${remote}": ${msg}`,
    );
  }

  // Step 2: Resolve fetched SHA
  const fetchedSha = execFileSync('git', ['rev-parse', `refs/remotes/${remote}/${stateBranch}`], {
    cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  // Step 3: Idempotency — skip if HEAD already matches the fetched commit
  let headSha: string | null = null;
  try {
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: teamRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* empty repo or detached HEAD — proceed */ }

  if (headSha === fetchedSha) return;

  // Step 4: Write state branch tree files into TEAM_ROOT (does not alter HEAD).
  // Uses ls-tree + cat-file blob to enumerate and write files directly — avoids
  // `git checkout --work-tree` index-state conflicts in nested repo contexts.
  const normalizedGitDir = path.join(teamRoot, '.git').replace(/\\/g, '/');
  const isolatedEnv = { ...process.env };
  delete isolatedEnv['GIT_DIR'];
  delete isolatedEnv['GIT_WORK_TREE'];
  delete isolatedEnv['GIT_INDEX_FILE'];

  const fileList = execFileSync('git', [
    '--git-dir', normalizedGitDir,
    'ls-tree', '-r', '--name-only', `refs/remotes/${remote}/${stateBranch}`,
  ], { encoding: 'utf-8', env: isolatedEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean);

  for (const filePath of fileList) {
    const content = execFileSync('git', [
      '--git-dir', normalizedGitDir,
      'cat-file', 'blob', `refs/remotes/${remote}/${stateBranch}:${filePath}`,
    ], { encoding: null, env: isolatedEnv, stdio: ['pipe', 'pipe', 'pipe'] }) as Buffer;
    const outPath = path.join(teamRoot, filePath.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }
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
};

/**
 * Main sync entrypoint.
 *
 * Resolution order (sub-proposal A):
 *   1. SQUAD_TEAM_ROOT env var — explicit override.
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
    const remote = options.remote ?? resolveRemote(repoRoot);
    const isPush = options.direction === 'push' || options.direction === 'both';
    const isPull = options.direction === 'pull' || options.direction === 'both';

    // ── Sub-proposal A: Registry-first TEAM_ROOT resolution ───────────────────
    let teamRoot: string | undefined;
    let stateRemote: string | undefined;
    let stateBranch: string | undefined;
    let registryAlias: string | undefined;
    let backend: string | null = null;
    let configJsonPresent = false;

    if (process.env['SQUAD_TEAM_ROOT']) {
      // Explicit env override: bypass registry lookup entirely
      teamRoot = process.env['SQUAD_TEAM_ROOT'];
    } else {
      const { registry } = loadRegistryFromDisk();
      const normalizedRoot = normalisedPathKey(repoRoot);
      const entry = registry?.squads.find(e =>
        e.clones?.some(c => normalisedPathKey(c) === normalizedRoot)
      );
      if (entry) {
        teamRoot = path.dirname(entry.path); // entry.path ends in .squad
        stateRemote = entry.stateRemote;
        stateBranch = entry.stateBranch;
        registryAlias = entry.developerAlias;
        backend = 'orphan';
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
          registryAlias ??= config.developerAlias;
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
    if (!teamRoot && !configJsonPresent && isPush) {
      console.error(
        `squad sync: no registry entry found for ${repoRoot}.\n` +
        `  Run 'squad assign' to register this repo before syncing.`,
      );
      process.exit(1);
    }

    const crossRepo = teamRoot !== undefined;

    // ── Sub-proposal D: Alias resolution chain ────────────────────────────────
    // Order: (1) --developer flag; (2) SQUAD_DEVELOPER_ALIAS env var; (3) registry entry alias.
    // Trim whitespace so a blank/whitespace-only alias triggers the friendly exit-1 guidance.
    const rawAlias =
      options.developer !== undefined
        ? options.developer
        : (process.env['SQUAD_DEVELOPER_ALIAS'] ?? registryAlias);
    const resolvedAlias = rawAlias?.trim() || undefined;

    if (!resolvedAlias && isPush && crossRepo) {
      console.error(
        `squad sync: developer alias is required for --push.\n` +
        `  Pass --developer <alias>, set SQUAD_DEVELOPER_ALIAS, or run ` +
        `'squad assign --developer-alias <alias>' to persist the alias.`,
      );
      process.exit(1);
    }

    if (!quiet) console.log(`squad sync: ${options.direction} (remote: ${remote}, backend: ${backend ?? 'orphan'})`);

    // ── Sub-proposal C: Pull path ──────────────────────────────────────────────
    if (isPull) {
      syncPull(repoRoot, remote, backend, quiet);
      if (crossRepo) {
        await _transport.hydrateTeamRootFromStateRef(
          teamRoot!,
          stateRemote ?? 'squad-docs',
          stateBranch ?? 'squad-state',
        );
      }
    }

    // ── Sub-proposal B: Push path ──────────────────────────────────────────────
    if (isPush) {
      if (crossRepo) {
        const sessionId = process.env['COPILOT_SESSION_ID'] ?? randomUUID();
        await _transport.publishTeamRootToInbox(
          teamRoot!,
          stateRemote ?? 'squad-docs',
          resolvedAlias!,
          sessionId,
        );
      } else {
        // Single-repo path: unchanged
        syncPush(repoRoot, remote, backend, quiet);
      }
    }
  } finally {
    delete process.env[SQUAD_SYNC_ENV];
  }
}
