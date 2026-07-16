/**
 * Piece 54 — publish batching (§C) and lane-correct `--push-config --dry-run` (§D).
 *
 * Sub-proposals under test here:
 *   C — batch the publish git-spawns: `batchHashAndStage` hashes every blob with ONE
 *       `git hash-object -w --no-filters --stdin-paths` and stages them with ONE
 *       `git update-index --index-info`, replacing the O(2·N) per-file loop. The resulting
 *       `write-tree` SHA must be BYTE-IDENTICAL to the old per-file path (mode/path/content
 *       preserved), including for CRLF, large, and deeply-nested files.
 *   D — `sync --push-config --dry-run` previews the DURABLE lane: the CONFIG_ALLOWLIST pending
 *       set, a `squad/config-inbox/<callsign>/…` target, and the config remote — never the
 *       ephemeral lane. `--push --dry-run` is unchanged.
 *
 * These git-integration cases can exceed 30s under load; use a generous per-test timeout.
 */

vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
}));
vi.mock('@bradygaster/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Registry } from '@bradygaster/squad-sdk/registry';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import {
  runSync,
  batchHashAndStage,
  _transport,
  type BatchStageEntry,
} from '../../packages/squad-cli/src/cli/commands/sync.js';

vi.setConfig({ testTimeout: 30_000 });

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-54-batch-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function initWorkingRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['COPILOT_SESSION_ID'];
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ═══ Sub-proposal C: batch the publish git-spawns (identical tree SHA) ═════════

/**
 * The OLD per-file staging path (piece 38): one `git hash-object -w --stdin` + one
 * `git update-index --add --cacheinfo` PER file, against an isolated index. Reproduced here
 * so the batched path can be proven to yield the identical resulting tree.
 */
function stagePerFile(cwd: string, indexFile: string, entries: BatchStageEntry[]): void {
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  for (const e of entries) {
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd, env, input: fs.readFileSync(e.absPath), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${sha},${e.indexPath}`], {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

function writeTree(cwd: string, indexFile: string): string {
  return execFileSync('git', ['write-tree'], {
    cwd, env: { ...process.env, GIT_INDEX_FILE: indexFile }, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Build a mixed fixture: nested paths, a large file, CRLF content, LF content. */
function buildFixture(root: string): BatchStageEntry[] {
  const files: Array<[string, Buffer]> = [
    ['.squad/team.md', Buffer.from('# team\nline1\nline2\n', 'utf-8')],
    ['.squad/agents/dev/charter.md', Buffer.from('charter\r\nwith\r\ncrlf\r\n', 'utf-8')], // CRLF
    ['.squad/templates/deep/nested/file.md', Buffer.from('x'.repeat(200_000), 'utf-8')],   // large
    ['.squad/config.json', Buffer.from('{"a":1}\n', 'utf-8')],
    ['.squad/roster.md', Buffer.from('roster no trailing newline', 'utf-8')],
  ];
  const entries: BatchStageEntry[] = [];
  for (const [rel, buf] of files) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    entries.push({ indexPath: rel, absPath: abs });
  }
  return entries;
}

describe('piece 54 — C: batchHashAndStage yields an identical tree SHA', () => {
  it('C1: batched staging == old per-file staging (nested + CRLF + large + no-trailing-newline)', () => {
    const root = initWorkingRepo(makeTmpDir('c1'));
    // A .gitattributes with text=auto would tempt --stdin-paths to normalize CRLF; --no-filters
    // must defeat that so the blob SHA matches the raw-bytes per-file path.
    fs.writeFileSync(path.join(root, '.gitattributes'), '* text=auto\n', 'utf-8');
    const entries = buildFixture(root);

    const oldIndex = path.join(root, '.git', 'index.old');
    const newIndex = path.join(root, '.git', 'index.new');

    stagePerFile(root, oldIndex, entries);
    batchHashAndStage(root, { ...process.env, GIT_INDEX_FILE: newIndex }, entries);

    const oldTree = writeTree(root, oldIndex);
    const newTree = writeTree(root, newIndex);
    expect(newTree).toBe(oldTree);
  });

  it('C2: a ≥100-file fixture stages via the batched path without per-file fan-out', () => {
    const root = initWorkingRepo(makeTmpDir('c2'));
    const entries: BatchStageEntry[] = [];
    for (let i = 0; i < 120; i++) {
      const rel = `.squad/files/triage-flow/step-${i}.md`;
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `# step ${i}\ncontent-${i}\n`, 'utf-8');
      entries.push({ indexPath: rel, absPath: abs });
    }
    const newIndex = path.join(root, '.git', 'index.new');
    // The batched path is two spawns regardless of count — this completes near-instantly where the
    // old O(2·N) loop would fire 240 git processes. (Byte-identity vs. the old path is proven by C1.)
    batchHashAndStage(root, { ...process.env, GIT_INDEX_FILE: newIndex }, entries);

    const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', writeTree(root, newIndex)], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    expect(tree.length).toBe(120);
    expect(tree).toContain('.squad/files/triage-flow/step-0.md');
    expect(tree).toContain('.squad/files/triage-flow/step-119.md');
  });

  it('C3: empty entries is a no-op (no spawn, empty tree)', () => {
    const root = initWorkingRepo(makeTmpDir('c3'));
    const idx = path.join(root, '.git', 'index.empty');
    expect(() => batchHashAndStage(root, { ...process.env, GIT_INDEX_FILE: idx }, [])).not.toThrow();
    // The empty git tree SHA.
    expect(writeTree(root, idx)).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });

  it('C4: refuses a path containing a newline (would corrupt path→SHA alignment)', () => {
    const root = initWorkingRepo(makeTmpDir('c4'));
    const bad: BatchStageEntry = { indexPath: '.squad/x.md', absPath: path.join(root, 'a\nb.md') };
    expect(() => batchHashAndStage(root, { ...process.env }, [bad])).toThrow(/newline/);
  });
});

// ═══ Sub-proposal D: lane-correct --push-config --dry-run ══════════════════════

/** Create a team root whose `.squad/` carries BOTH durable and ephemeral files. */
function setupMixedSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad'), { recursive: true });
  // Durable (CONFIG_ALLOWLIST):
  fs.writeFileSync(path.join(teamRoot, '.squad', 'team.md'), '# team\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'roster.md'), '# roster\n');
  // Ephemeral (PUBLISH_ALLOWLIST):
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# decisions\n');
}

function runDry(opts: Parameters<typeof runSync>[0]): Promise<string> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return (async () => {
    try {
      await runSync(opts);
      return logSpy.mock.calls.map(a => a.join(' ')).join('\n');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  })();
}

describe('piece 54 — D: --push-config --dry-run previews the durable lane', () => {
  it('D1: --push-config --dry-run shows CONFIG_ALLOWLIST + config-inbox target, not the ephemeral lane', async () => {
    const docsRepoDir = makeTmpDir('d1-docs');
    const cloneDir = makeTmpDir('d1-clone');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupMixedSquadDir(docsRepoDir);
    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'dev1',
        stateRemote: 'squad-docs',
        stateBranch: 'squad-state',
        configRemote: 'squad-config',
      }]),
      warnings: [],
    });
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    try {
      process.env['COPILOT_SESSION_ID'] = 'sess-d1';
      const out = await runDry({ direction: 'push', pushConfig: true, pushConfigOnly: true, dryRun: true, cwd: cloneDir });

      // Durable lane target + config remote.
      expect(out).toContain('squad/config-inbox/');
      expect(out).toContain('CONFIG_ALLOWLIST');
      // Durable files listed; ephemeral file NOT in the durable preview.
      expect(out).toContain('.squad/team.md');
      expect(out).not.toContain('.squad/decisions.md');
      // The ephemeral lane target is suppressed for a bare --push-config.
      expect(out).not.toContain('squad/inbox/');
      expect(publishSpy).not.toHaveBeenCalled();
    } finally {
      publishSpy.mockRestore();
    }
  });

  it('D2: --push --dry-run is unchanged — it previews the ephemeral lane only', async () => {
    const docsRepoDir = makeTmpDir('d2-docs');
    const cloneDir = makeTmpDir('d2-clone');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupMixedSquadDir(docsRepoDir);
    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'dev1',
        stateRemote: 'squad-docs',
        stateBranch: 'squad-state',
      }]),
      warnings: [],
    });
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    try {
      process.env['COPILOT_SESSION_ID'] = 'sess-d2';
      const out = await runDry({ direction: 'push', dryRun: true, cwd: cloneDir });

      expect(out).toContain('squad/inbox/');
      expect(out).toContain('.squad/decisions.md'); // ephemeral is in the state preview
      expect(out).not.toContain('squad/config-inbox/');
      expect(out).not.toContain('CONFIG_ALLOWLIST');
    } finally {
      publishSpy.mockRestore();
    }
  });
});
