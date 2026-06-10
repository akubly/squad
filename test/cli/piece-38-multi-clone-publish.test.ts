/**
 * Piece 38 — Multi-clone publish model & Tier-2 completion.
 *
 * Tests for: J (inbox-handle rename), L (hardcoded prefix doc), M (sync-from-host guard),
 * O (backend-enum reconciliation), Two-hook decoupled model, Product .squad/-forbid guard,
 * N (dual-role registration).
 *
 * NOTE: Tests that need runAssign are in piece-38-assign.test.ts (collection-failing env debt
 * from the @bradygaster/squad-sdk root import). Tests here cover sync.ts, install-hooks.ts,
 * validation.ts, and registry.ts — all resolvable via mocking.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
  writeRegistry: vi.fn(),
}));
vi.mock('@bradygaster/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));
vi.mock('@bradygaster/squad-sdk/validation', () => ({
  INBOX_HANDLE_RE: /^[a-z][a-z0-9-]{1,38}$/,
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { INBOX_HANDLE_RE } from '../../packages/squad-sdk/src/validation.js';
import { validateEntry, parseRegistry, writeRegistry as realWriteRegistry } from '../../packages/squad-sdk/src/registry.js';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import type { Registry } from '../../packages/squad-sdk/src/registry.js';
import {
  runSync,
  _transport,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  installCrossRepoHook,
  installProductSquadForbidHook,
} from '../../packages/squad-cli/src/cli/commands/install-hooks.js';
import { parseAssignArgs } from '../../packages/squad-cli/src/commands/assign-args.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-38-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function initGitRepo(dir: string): string {
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

function makeSquadHost(hostDir: string, callsign: string): string {
  const squadDir = path.join(hostDir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), `# ${callsign}\n`, 'utf8');
  return squadDir;
}

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ═══════════════════════════════════════════════════════════════════════════════
// J — inbox-handle rename
// ═══════════════════════════════════════════════════════════════════════════════

describe('J — inbox-handle rename (P38)', () => {
  it('P38.J1 INBOX_HANDLE_RE exported and matches valid handle', () => {
    expect(INBOX_HANDLE_RE.test('dev1')).toBe(true);
    expect(INBOX_HANDLE_RE.test('alice-2')).toBe(true);
  });

  it('P38.J2 zero residue of developerAlias/--developer-alias/SQUAD_DEVELOPER_ALIAS/DEVELOPER_ALIAS_RE in packages/*/src', () => {
    const srcDirs = [
      resolve(process.cwd(), 'packages/squad-sdk/src'),
      resolve(process.cwd(), 'packages/squad-cli/src'),
    ];
    const forbidden = ['DEVELOPER_ALIAS_RE', '--developer-alias', 'SQUAD_DEVELOPER_ALIAS', 'ERR_ASSIGN_INVALID_ALIAS', 'developerAlias'];
    for (const dir of srcDirs) {
      const files = getAllTsFiles(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const token of forbidden) {
          expect(content).not.toContain(token);
        }
      }
    }
  });

  it('P38.J3 --inbox-handle flag parsed by parseAssignArgs', () => {
    const result = parseAssignArgs(['my-squad', '--inbox-handle', 'alice']);
    expect(result.inboxHandle).toBe('alice');
  });

  it('P38.J4 SDK validator accepts inboxHandle field and round-trips', () => {
    const entry = validateEntry({ path: '/test/.squad', inboxHandle: 'alice' }, 0);
    expect(entry.inboxHandle).toBe('alice');
  });

  it('P38.J5 developerAlias is no longer read-compat migrated (compat removed)', () => {
    // After compat removal, developerAlias is not recognized as inboxHandle.
    // It passes through as an unknown forward-compatible field instead.
    const entry = validateEntry({ path: '/test/.squad', developerAlias: 'bob' }, 0);
    expect(entry.inboxHandle).toBeUndefined();
    expect((entry as any).developerAlias).toBe('bob');
  });

  it('P38.J6 SQUAD_INBOX_HANDLE env var honored in sync resolution chain', async () => {
    const docsRepoDir = makeTmpDir('docs-j6');
    const cloneDir = makeTmpDir('clone-j6');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(docsRepoDir, 'test-squad');
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'decisions.md'), '# D\n');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        // No inboxHandle on entry — will fall through to env var
      }]),
      warnings: [],
    });

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['SQUAD_INBOX_HANDLE'] = 'env-handle';
      process.env['COPILOT_SESSION_ID'] = 'test-session-j6';
      await runSync({ direction: 'push', cwd: cloneDir });

      expect(publishSpy).toHaveBeenCalledOnce();
      const [, , calledHandle] = publishSpy.mock.calls[0]!;
      expect(calledHandle).toBe('env-handle');
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('P38.J7 push-without-handle guard fires with renamed symbols', async () => {
    const docsRepoDir = makeTmpDir('docs-j7');
    const cloneDir = makeTmpDir('clone-j7');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(docsRepoDir, 'test-squad');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        // No inboxHandle
      }]),
      warnings: [],
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runSync({ direction: 'push', cwd: cloneDir });
    } catch (e: any) {
      expect(e.message).toBe('exit');
    } finally {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('inbox handle is required'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SQUAD_INBOX_HANDLE'));
      consoleSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L — inbox prefix hardcoded + known limitation
// ═══════════════════════════════════════════════════════════════════════════════

describe('L — inbox prefix stays hardcoded (P38)', () => {
  it('P38.L1 install-fold-pipeline output references squad/inbox/ as known limitation', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/cli/commands/install-fold-pipeline.ts'), 'utf-8');
    expect(src).toContain('squad/inbox/');
    expect(src).toContain('Known limitation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// M — sync-from-host guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('M — sync-from-host guard (P38)', () => {
  it('P38.M1 squad sync from host root exits 1 with actionable message', async () => {
    const hostDir = makeTmpDir('host-m1');
    const hostRoot = initGitRepo(hostDir);
    const squadDir = makeSquadHost(hostDir, 'test-squad');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: ['/some/product/clone'],
      }]),
      warnings: [],
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runSync({ direction: 'push', cwd: hostDir });
    } catch (e: any) {
      expect(e.message).toBe('exit');
    } finally {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('shared-squad host clone'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('product clone'));
      consoleSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('P38.M2 squad sync from registered product clone is unaffected', async () => {
    const hostDir = makeTmpDir('host-m2');
    const cloneDir = makeTmpDir('clone-m2');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(hostDir, 'test-squad');
    fs.mkdirSync(path.join(hostDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(hostDir, '.squad', 'decisions.md'), '# D\n');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'devtest',
      }]),
      warnings: [],
    });

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-m2';
      await runSync({ direction: 'push', cwd: cloneDir });
      expect(publishSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('P38.M3 single-repo mode (no registry match) is unaffected', async () => {
    const repoDir = makeTmpDir('repo-m3');
    initGitRepo(repoDir);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      // No registry, no config → single-repo pull is fine (no exit)
      await runSync({ direction: 'pull', cwd: repoDir });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// K — handle-only update from host (assign-dependent tests live in collection-failing suite)
// Static assertion: Guard 3 source code contains the handle-only exception path.
// ═══════════════════════════════════════════════════════════════════════════════

describe('K — handle-only update from host (P38)', () => {
  it('P38.K1 assign.ts contains handle-only exception path in Guard 3', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    expect(src).toContain('isHandleOnly');
    expect(src).toContain('opts.inboxHandle !== undefined && !opts.cloneTo && !opts.targetDir');
  });

  it('P38.K2 --inbox-handle flag is parsed by parseAssignArgs', () => {
    const result = parseAssignArgs(['my-squad', '--inbox-handle', 'alice']);
    expect(result.inboxHandle).toBe('alice');
  });

  it('P38.K3 assign without --inbox-handle from host is still the noOp path (source assertion)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    // When isHandleOnly is false, still returns noOp
    expect(src).toContain("return { kind: 'noOp', callsign, hostPath: hostSquadDir }");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// O — backend-enum reconciliation
// ═══════════════════════════════════════════════════════════════════════════════

describe('O — backend-enum reconciliation (P38)', () => {
  it('P38.O1 SDK validator accepts stateBackend orphan', () => {
    const entry = validateEntry({ path: '/test/.squad', stateBackend: 'orphan' }, 0);
    expect(entry.stateBackend).toBe('orphan');
  });

  it('P38.O2 SDK validator accepts stateBackend two-layer', () => {
    const entry = validateEntry({ path: '/test/.squad', stateBackend: 'two-layer' }, 0);
    expect(entry.stateBackend).toBe('two-layer');
  });

  it('P38.O3 SDK validator rejects stateBackend worktree (removed from canonical set)', () => {
    expect(() => validateEntry({ path: '/test/.squad', stateBackend: 'worktree' }, 0)).toThrow(/stateBackend must be one of/);
  });

  it('P38.O4 SDK validator rejects stateBackend flat (phantom removed)', () => {
    expect(() => validateEntry({ path: '/test/.squad', stateBackend: 'flat' }, 0)).toThrow(/stateBackend must be one of/);
  });

  it('P38.O5 stateBackend orphan round-trips through writeRegistry', () => {
    const tmpFile = path.join(makeTmpDir('o5'), 'registry.json');
    const reg: Registry = { version: 1, squads: [{ path: '/test/.squad', stateBackend: 'orphan' }] };
    realWriteRegistry(tmpFile, reg);
    const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    expect(content.squads[0].stateBackend).toBe('orphan');
  });

  it('P38.O6 warn-on-override: non-orphan stateBackend on shared-squad entry produces warning', async () => {
    const hostDir = makeTmpDir('host-o6');
    const cloneDir = makeTmpDir('clone-o6');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(hostDir, 'test-squad');
    fs.mkdirSync(path.join(hostDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(hostDir, '.squad', 'decisions.md'), '# D\n');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'devtest',
        stateBackend: 'two-layer', // Non-orphan on a shared-squad entry
      }]),
      warnings: [],
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-o6';
      await runSync({ direction: 'push', cwd: cloneDir });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('two-layer'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('enforce orphan'));
      // Still uses orphan (publish still called)
      expect(publishSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      warnSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('P38.O7 no source reference to worktree in registry validBackends', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-sdk/src/registry.ts'), 'utf-8');
    // validBackends should not contain worktree
    expect(src).toMatch(/validBackends = \['orphan', 'local', 'external', 'two-layer'\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Two-hook decoupled model
// ═══════════════════════════════════════════════════════════════════════════════

describe('Two-hook decoupled model (P38)', () => {
  it('P38.TH1 installCrossRepoHook installs host-filtered hook in host clone', () => {
    const hostDir = makeTmpDir('host-th1');
    initGitRepo(hostDir);
    makeSquadHost(hostDir, 'test-squad');

    installCrossRepoHook(hostDir);

    const hookPath = path.join(hostDir, '.git', 'hooks', 'post-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('diff-tree');
    expect(content).toContain('--root');
    expect(content).toContain('grep -qv');
    expect(content).toContain('.squad/');
    expect(content).toContain('squad sync --push --quiet');
  });

  it('P38.TH2 installCrossRepoHook installs unfiltered hook in product clone', () => {
    const productDir = makeTmpDir('product-th2');
    initGitRepo(productDir);
    // No .squad/team.md → product clone

    installCrossRepoHook(productDir);

    const hookPath = path.join(productDir, '.git', 'hooks', 'post-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).not.toContain('diff-tree');
    expect(content).toContain('squad sync --push --quiet');
    expect(content).toContain('SQUAD_SYNC_ACTIVE');
  });

  it('P38.TH3 assign.ts installs hooks in both host and product (source assertion)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    // Two independent installCrossRepoHookFn calls
    expect(src).toContain('installCrossRepoHookFn(docsRepoPath)');
    expect(src).toContain('installCrossRepoHookFn(clonePath)');
    // Each in independent try/catch
    const hookSection = src.slice(src.indexOf('Install cross-repo post-commit hook in BOTH'));
    expect(hookSection).toContain('} catch (err) {');
  });

  it('P38.TH4 host hook template uses --root, never HEAD~1 in actual shell code', () => {
    // Install in a host repo and verify the hook content
    const hostDir = makeTmpDir('host-th4');
    initGitRepo(hostDir);
    makeSquadHost(hostDir, 'test-squad');
    installCrossRepoHook(hostDir);
    const hookContent = fs.readFileSync(path.join(hostDir, '.git', 'hooks', 'post-commit'), 'utf-8');
    expect(hookContent).toContain('--root HEAD');
    expect(hookContent).not.toContain('HEAD~1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Product .squad/-forbid pre-commit guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('Product .squad/-forbid pre-commit guard (P38)', () => {
  it('P38.FG1 installProductSquadForbidHook installs pre-commit hook', () => {
    const productDir = makeTmpDir('product-fg1');
    initGitRepo(productDir);

    installProductSquadForbidHook(productDir);

    const hookPath = path.join(productDir, '.git', 'hooks', 'pre-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('git diff --cached --name-only');
    expect(content).toContain('.squad/');
    expect(content).toContain('TEAM_ROOT');
    expect(content).toContain('exit 1');
  });

  it('P38.FG2 guard is NOT installed in host clone (source assertion: installProductSquadForbidHook called on clonePath only)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    // installProductSquadForbidHook is called on clonePath (product), not docsRepoPath (host)
    expect(src).toContain('installProductSquadForbidHook(clonePath)');
    expect(src).not.toContain('installProductSquadForbidHook(docsRepoPath)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// N — dual-role registration
// ═══════════════════════════════════════════════════════════════════════════════

describe('N — dual-role registration (P38)', () => {
  it('P38.N1 single assign produces one entry with both read role (path) and state role (inboxHandle)', () => {
    // Source assertion: assign.ts writes inboxHandle on the same entry that has path
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    expect(src).toContain('inboxHandle: opts.inboxHandle');
    // No role/type discriminant fields
    expect(src).not.toMatch(/['"]role['"]\s*:/);
    expect(src).not.toMatch(/['"]upstreamPath['"]\s*:/);
  });

  it('P38.N2 with no inbox handle, state push is inert but read role resolves', async () => {
    const hostDir = makeTmpDir('host-n2');
    const cloneDir = makeTmpDir('clone-n2');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(hostDir, 'test-squad');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        // No inboxHandle — state role is inert
      }]),
      warnings: [],
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runSync({ direction: 'push', cwd: cloneDir });
    } catch (e: any) {
      expect(e.message).toBe('exit');
    }

    // Push guard fires = state role is inert without handle
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('inbox handle is required'));

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('P38.N3 writeRegistry round-trips dual-role entry without dropping fields', () => {
    const tmpFile = path.join(makeTmpDir('n3'), 'registry.json');
    const reg: Registry = {
      version: 1,
      squads: [{
        path: '/test/.squad',
        callsign: 'my-squad',
        inboxHandle: 'dev-handle',
        stateBackend: 'orphan',
        clones: ['/product/clone'],
      }],
    };
    realWriteRegistry(tmpFile, reg);
    const readBack = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const entry = readBack.squads[0];
    expect(entry.path).toBe('/test/.squad');
    expect(entry.callsign).toBe('my-squad');
    expect(entry.inboxHandle).toBe('dev-handle');
    expect(entry.stateBackend).toBe('orphan');
    expect(entry.clones).toEqual(['/product/clone']);
  });

  it('P38.N4 no second registry file or role discriminant in registry schema', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-sdk/src/registry.ts'), 'utf-8');
    expect(src).not.toContain("'role'");
    expect(src).not.toContain("'type'");
    expect(src).not.toContain('upstreamPath');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKER 2 — Cold-start hook installation (acceptance #8)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cold-start hook installation (P38.CS)', () => {
  it('P38.CS1 _coldStart installs cross-repo hooks in host AND product and forbid guard in product (source assertion)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    // cold-start installs host post-commit
    expect(src).toContain('installCrossRepoHookFn(cloneDest)');
    // cold-start installs product post-commit
    expect(src).toContain('installCrossRepoHookFn(clonePath)');
    // cold-start installs product forbid pre-commit
    expect(src).toContain('installProductSquadForbidHookFn(clonePath)');
  });

  it('P38.CS2 _ColdStartCtx carries injectable hook fns (source assertion)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    expect(src).toContain('installCrossRepoHookFn: (repoPath: string)');
    expect(src).toContain('installProductSquadForbidHookFn: (productRepoPath: string)');
  });

  it('P38.CS3 cold-start hook installs are in independent try/catch blocks (source assertion)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    // Locate the cold-start hook section in _coldStart (after registry write)
    const coldStartIdx = src.indexOf('async function _coldStart');
    const coldStartSection = src.slice(coldStartIdx);
    // Count independent try { installCrossRepoHookFn blocks
    const crossRepoTries = coldStartSection.match(/try \{\s*installCrossRepoHookFn/g) ?? [];
    expect(crossRepoTries.length).toBeGreaterThanOrEqual(2);
    const forbidTries = coldStartSection.match(/try \{\s*installProductSquadForbidHookFn/g) ?? [];
    expect(forbidTries.length).toBeGreaterThanOrEqual(1);
  });

  it('P38.CS4 SquadAssignOpts exposes _installProductSquadForbidHookFn seam (source assertion)', () => {
    const src = readFileSync(resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    expect(src).toContain('_installProductSquadForbidHookFn?:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKER 3 — E2E publish-model: product-commit triggers host publish (acceptance #4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E publish model — product commit triggers host .squad/ publish (P38.PM)', () => {
  it('P38.PM1 publishTeamRootToInbox is called with HOST teamRoot, not product dir, on product-clone push', async () => {
    const hostDir = makeTmpDir('host-pm1');
    const cloneDir = makeTmpDir('clone-pm1');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(hostDir, 'pm-squad');
    fs.mkdirSync(path.join(hostDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(hostDir, '.squad', 'decisions.md'), '# D\n');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'pm-squad',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'pmdev',
      }]),
      warnings: [],
    });

    let syncActiveAtPublish: string | undefined;
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockImplementation(async (teamRoot, remote, handle, sessionId) => {
      syncActiveAtPublish = process.env['SQUAD_SYNC_ACTIVE'];
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-pm1';
      await runSync({ direction: 'push', cwd: cloneDir });

      // (a) publishTeamRootToInbox was called with the HOST teamRoot (path.dirname(squadDir)), not the product dir
      expect(publishSpy).toHaveBeenCalledOnce();
      const [calledTeamRoot] = publishSpy.mock.calls[0]!;
      const expectedHostRoot = path.dirname(squadDir);
      expect(calledTeamRoot).toBe(expectedHostRoot);
      // product dir must NOT be the source
      expect(calledTeamRoot).not.toBe(cloneRoot);

      // (b) SQUAD_SYNC_ACTIVE was set during the publish call
      expect(syncActiveAtPublish).toBe('1');
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('P38.PM2 no working-tree commit is created in either clone during product push', async () => {
    const hostDir = makeTmpDir('host-pm2');
    const cloneDir = makeTmpDir('clone-pm2');
    const cloneRoot = initGitRepo(cloneDir);
    const squadDir = makeSquadHost(hostDir, 'pm-squad');
    fs.mkdirSync(path.join(hostDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(hostDir, '.squad', 'decisions.md'), '# D\n');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'pm-squad',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'pmdev2',
      }]),
      warnings: [],
    });

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Record commit count in product clone before sync
    const commitsBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: cloneRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-pm2';
      await runSync({ direction: 'push', cwd: cloneDir });

      // (c) no new commit in product clone
      const commitsAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: cloneRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      expect(commitsAfter).toBe(commitsBefore);

      expect(publishSpy).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKER 4 — .squad/-forbid pre-commit behavioral test (acceptance #5)
// ═══════════════════════════════════════════════════════════════════════════════

describe('.squad/-forbid pre-commit guard behavioral (P38.FG)', () => {
  function tryExec(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): { status: number; stderr: string } {
    const result = spawnSync(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      encoding: 'utf-8',
    });
    return { status: result.status ?? 1, stderr: result.stderr ?? '' };
  }

  function shAvailable(): boolean {
    const r = spawnSync('sh', ['--version'], { stdio: 'pipe' });
    return r.status === 0;
  }

  it('P38.FG3 staging .squad/ path triggers guard: hook exits non-zero with error text', () => {
    if (!shAvailable()) return;

    const repoDir = makeTmpDir('product-fg3');
    initGitRepo(repoDir);
    installProductSquadForbidHook(repoDir);

    // Stage a .squad/ path
    const squadFile = path.join(repoDir, '.squad', 'foo.md');
    fs.mkdirSync(path.dirname(squadFile), { recursive: true });
    fs.writeFileSync(squadFile, 'forbidden\n');
    execFileSync('git', ['add', '.squad/foo.md'], { cwd: repoDir, stdio: 'pipe' });

    const hookPath = path.join(repoDir, '.git', 'hooks', 'pre-commit');
    const result = tryExec('sh', [hookPath], { cwd: repoDir });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot commit .squad/');
    expect(result.stderr).toContain('TEAM_ROOT');
  });

  it('P38.FG4 staging only non-.squad/ file: hook exits 0', () => {
    if (!shAvailable()) return;

    const repoDir = makeTmpDir('product-fg4');
    initGitRepo(repoDir);
    installProductSquadForbidHook(repoDir);

    // Stage a normal file
    const normalFile = path.join(repoDir, 'README.md');
    fs.writeFileSync(normalFile, 'ok\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'pipe' });

    const hookPath = path.join(repoDir, '.git', 'hooks', 'pre-commit');
    const result = tryExec('sh', [hookPath], { cwd: repoDir });

    expect(result.status).toBe(0);
  });

  it('P38.FG5 untracked .squad/ file on disk does NOT trip the guard', () => {
    if (!shAvailable()) return;

    const repoDir = makeTmpDir('product-fg5');
    initGitRepo(repoDir);
    installProductSquadForbidHook(repoDir);

    // Untracked .squad/ file — NOT staged
    const squadFile = path.join(repoDir, '.squad', 'bar.md');
    fs.mkdirSync(path.dirname(squadFile), { recursive: true });
    fs.writeFileSync(squadFile, 'untracked\n');
    // Do NOT git add

    const hookPath = path.join(repoDir, '.git', 'hooks', 'pre-commit');
    const result = tryExec('sh', [hookPath], { cwd: repoDir });

    expect(result.status).toBe(0);
  });
});

// ─── Utility ─────────────────────────────────────────────────────────────────

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.ts')) results.push(fullPath);
    }
  }
  walk(dir);
  return results;
}
