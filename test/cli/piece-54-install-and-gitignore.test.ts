/**
 * Piece 54 — config-pipeline install wiring, `--runner` parity, and `.gitignore` canonicalization.
 *
 * Sub-proposals under test here:
 *   A — install-fold-pipeline also deploys the durable config pipeline (`fold-squad-config.yml`)
 *       next to the state pipeline, reusing the host-root resolution, callsign parameterization,
 *       and the three-way idempotency gate. Callsign-generic by default, `--callsign`-scoped when
 *       supplied. `--state-only` / `--config-only` are the escape hatches (E1).
 *   B — `--runner` parity for the GitHub config template: the SAME `applyRunner` renders
 *       `runs-on: [<labels>]` (+ non-Linux `defaults.run.shell: bash`) for the config template;
 *       default rendering is byte-identical to the committed template (`ubuntu-latest`).
 *   F — canonical `.gitignore` placement (F1): a single host git-root managed block carrying one
 *       `<prefix>.squad/` line per callsign (accumulating, not replacing), and migration of a legacy
 *       per-subfolder managed block (user lines preserved).
 *
 * These git-integration cases can exceed 30s under load; use a generous per-test timeout.
 */

// ─── Registry / path-utils mocks (match install-fold-pipeline.test.ts) ───────
vi.mock('@wifi-aware/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
}));
vi.mock('@wifi-aware/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Registry } from '@wifi-aware/squad-sdk/registry';
import { loadRegistryFromDisk } from '@wifi-aware/squad-sdk/registry';
import { normalisedPathKey } from '@wifi-aware/squad-sdk/path-utils';
import {
  installFoldPipeline,
} from '../../packages/squad-cli/src/cli/commands/install-fold-pipeline.js';
import {
  applyBlanketGitignore,
  removeLegacySubfolderManagedBlock,
} from '../../packages/squad-cli/src/cli/commands/allowlist-gitignore.js';

vi.setConfig({ testTimeout: 30_000 });

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-54-install-tmp');
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

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

/** Point the registry at a docs-repo `.squad` for a code clone, then return the docs repo root. */
function setupRegistryEntry(docsRepoDir: string, cloneRoot: string): string {
  const docsRepoRoot = initGitRepo(docsRepoDir);
  const squadDir = path.join(docsRepoRoot, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({
    registry: makeRegistry([{
      callsign: 'test-squad',
      path: squadDir,
      clones: [cloneRoot],
      stateRemote: 'origin',
      stateBranch: 'squad-state',
      inboxHandle: 'testdev',
    }]),
    warnings: [],
  });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  return docsRepoRoot;
}

function committedTemplate(platform: 'github' | 'ado', basename: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'packages', 'squad-cli', 'templates', 'fold', platform, basename),
    'utf-8',
  );
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
});

// A helper that runs installFoldPipeline with console.log muted.
async function installMuted(...args: Parameters<typeof installFoldPipeline>): Promise<void> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await installFoldPipeline(...args);
  } finally {
    logSpy.mockRestore();
  }
}

// ═══ Sub-proposal A: install the config pipeline alongside the fold pipeline ════

describe('piece 54 — A: install-fold-pipeline deploys BOTH pipelines by default', () => {
  it('A1: a host install writes fold-squad-state.yml AND fold-squad-config.yml', async () => {
    const docsRepoDir = makeTmpDir('a1-docs');
    const cloneDir = makeTmpDir('a1-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.github', 'workflows'), { recursive: true });

    await installMuted('github', { cwd: cloneDir });

    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    expect(fs.existsSync(path.join(wf, 'fold-squad-state.yml'))).toBe(true);
    expect(fs.existsSync(path.join(wf, 'fold-squad-config.yml'))).toBe(true);
    // The config consumer is the durable auto-PR pipeline (piece 53).
    expect(fs.readFileSync(path.join(wf, 'fold-squad-config.yml'), 'utf-8'))
      .toContain('open-config-pr');
  });

  it('A2: re-run is idempotent per file — no change on either pipeline', async () => {
    const docsRepoDir = makeTmpDir('a2-docs');
    const cloneDir = makeTmpDir('a2-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });

    await installMuted('github', { cwd: cloneDir });
    const stateA = fs.readFileSync(path.join(wf, 'fold-squad-state.yml'), 'utf-8');
    const configA = fs.readFileSync(path.join(wf, 'fold-squad-config.yml'), 'utf-8');

    await installMuted('github', { cwd: cloneDir });
    expect(fs.readFileSync(path.join(wf, 'fold-squad-state.yml'), 'utf-8')).toBe(stateA);
    expect(fs.readFileSync(path.join(wf, 'fold-squad-config.yml'), 'utf-8')).toBe(configA);
  });

  it('A3: a differing config file conflicts (exit 1) unless --force, which backs up only that file', async () => {
    const docsRepoDir = makeTmpDir('a3-docs');
    const cloneDir = makeTmpDir('a3-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });
    // State is up to date; config differs.
    await installMuted('github', { cwd: cloneDir, configOnly: false, stateOnly: true });
    fs.writeFileSync(path.join(wf, 'fold-squad-config.yml'), '# stale\n', 'utf-8');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(installFoldPipeline('github', { cwd: cloneDir })).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore(); errSpy.mockRestore(); logSpy.mockRestore();
    }

    // --force overwrites and backs up only the differing (config) file.
    await installMuted('github', { cwd: cloneDir, force: true });
    expect(fs.existsSync(path.join(wf, 'fold-squad-config.yml.bak'))).toBe(true);
    expect(fs.existsSync(path.join(wf, 'fold-squad-state.yml.bak'))).toBe(false);
  });

  it('A4: --callsign scopes BOTH pipelines to that callsign', async () => {
    const docsRepoDir = makeTmpDir('a4-docs');
    const cloneDir = makeTmpDir('a4-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });

    await installMuted('github', { cwd: cloneDir, callsign: 'alpha' });

    const state = fs.readFileSync(path.join(wf, 'fold-squad-state.alpha.yml'), 'utf-8');
    const config = fs.readFileSync(path.join(wf, 'fold-squad-config.alpha.yml'), 'utf-8');
    // Config lane scoped to the callsign's durable branch + inbox glob.
    expect(config).toContain('squad/config/alpha');
    expect(config).toContain("'squad/config-inbox/alpha/**'");
    expect(config).not.toContain("'squad/config-inbox/**'");
    // State lane scoped too.
    expect(state).toContain("'squad/inbox/alpha/**'");
  });

  it('A5: --state-only writes ONLY the state pipeline; --config-only writes ONLY the config pipeline', async () => {
    // --state-only
    {
      const docsRepoDir = makeTmpDir('a5s-docs');
      const cloneDir = makeTmpDir('a5s-clone');
      const cloneRoot = initGitRepo(cloneDir);
      const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
      const wf = path.join(docsRepoRoot, '.github', 'workflows');
      fs.mkdirSync(wf, { recursive: true });
      await installMuted('github', { cwd: cloneDir, stateOnly: true });
      expect(fs.existsSync(path.join(wf, 'fold-squad-state.yml'))).toBe(true);
      expect(fs.existsSync(path.join(wf, 'fold-squad-config.yml'))).toBe(false);
    }
    // --config-only
    {
      const docsRepoDir = makeTmpDir('a5c-docs');
      const cloneDir = makeTmpDir('a5c-clone');
      const cloneRoot = initGitRepo(cloneDir);
      const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
      const wf = path.join(docsRepoRoot, '.github', 'workflows');
      fs.mkdirSync(wf, { recursive: true });
      await installMuted('github', { cwd: cloneDir, configOnly: true });
      expect(fs.existsSync(path.join(wf, 'fold-squad-config.yml'))).toBe(true);
      expect(fs.existsSync(path.join(wf, 'fold-squad-state.yml'))).toBe(false);
    }
  });

  it('A6: --state-only and --config-only together fail fast (mutually exclusive)', async () => {
    const docsRepoDir = makeTmpDir('a6-docs');
    const cloneDir = makeTmpDir('a6-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.github', 'workflows'), { recursive: true });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(installFoldPipeline('github', { cwd: cloneDir, stateOnly: true, configOnly: true }))
        .rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore(); errSpy.mockRestore();
    }
  });

  it('A7: a non-squad repo (no registry entry, no .squad) still fails fast', async () => {
    const plainDir = makeTmpDir('a7-plain');
    initGitRepo(plainDir);
    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(installFoldPipeline('github', { cwd: plainDir })).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore(); errSpy.mockRestore();
    }
  });
});

// ═══ Sub-proposal B: --runner parity for the GitHub config template ════════════

describe('piece 54 — B: --runner parity for the config template', () => {
  it('B1: no --runner → config file byte-identical to the committed config template', async () => {
    const docsRepoDir = makeTmpDir('b1-docs');
    const cloneDir = makeTmpDir('b1-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });

    await installMuted('github', { cwd: cloneDir, configOnly: true });

    const yaml = fs.readFileSync(path.join(wf, 'fold-squad-config.yml'), 'utf-8');
    expect(yaml).toBe(committedTemplate('github', 'fold-squad-config.yml'));
    expect(yaml).toContain('runs-on: ubuntu-latest');
    expect(yaml).not.toContain('defaults:');
  });

  it('B2: --runner "self-hosted,Windows,X64" → runs-on array + defaults.run.shell bash in the config file', async () => {
    const docsRepoDir = makeTmpDir('b2-docs');
    const cloneDir = makeTmpDir('b2-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });

    await installMuted('github', { cwd: cloneDir, configOnly: true, runner: 'self-hosted,Windows,X64' });

    const yaml = fs.readFileSync(path.join(wf, 'fold-squad-config.yml'), 'utf-8');
    expect(yaml).toContain('runs-on: [self-hosted, Windows, X64]');
    expect(yaml).not.toContain('runs-on: ubuntu-latest');
    expect(yaml).toMatch(/defaults:\s*\n\s+run:\s*\n\s+shell: bash/);
  });

  it('B3: one --runner moves BOTH templates — fold AND config share the same applyRunner', async () => {
    const docsRepoDir = makeTmpDir('b3-docs');
    const cloneDir = makeTmpDir('b3-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wf = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });

    await installMuted('github', { cwd: cloneDir, runner: 'self-hosted,Windows,X64' });

    const state = fs.readFileSync(path.join(wf, 'fold-squad-state.yml'), 'utf-8');
    const config = fs.readFileSync(path.join(wf, 'fold-squad-config.yml'), 'utf-8');
    expect(state).toContain('runs-on: [self-hosted, Windows, X64]');
    expect(config).toContain('runs-on: [self-hosted, Windows, X64]');
    expect(state).toMatch(/shell: bash/);
    expect(config).toMatch(/shell: bash/);
  });

  it('B4: --runner is ignored for the ADO config template (agent-pool-driven)', async () => {
    const docsRepoDir = makeTmpDir('b4-docs');
    const cloneDir = makeTmpDir('b4-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.azuredevops'), { recursive: true });

    await installMuted('ado', { cwd: cloneDir, configOnly: true, runner: 'self-hosted,Windows,X64' });

    const yaml = fs.readFileSync(path.join(docsRepoRoot, '.azuredevops', 'fold-squad-config.yml'), 'utf-8');
    expect(yaml).toBe(committedTemplate('ado', 'fold-squad-config.yml'));
  });
});

// ═══ Sub-proposal F: canonicalize the Pole-A .gitignore placement (F1) ═════════

const MANAGED_START = '# --- squad (managed) ---';

describe('piece 54 — F1: single git-root managed block, one line per callsign', () => {
  it('F1: applyBlanketGitignore ACCUMULATES one <prefix>.squad/ line per callsign (no replace)', () => {
    const root = initGitRepo(makeTmpDir('f1-accum'));
    applyBlanketGitignore(root, 'alpha/');
    applyBlanketGitignore(root, 'beta/');

    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    expect(gi).toContain('alpha/.squad/');
    expect(gi).toContain('beta/.squad/'); // NOT clobbered by the second callsign
    // Exactly one managed block survives.
    expect(gi.split(MANAGED_START).length - 1).toBe(1);
  });

  it('F2: re-applying a callsign already present is idempotent (no change)', () => {
    const root = initGitRepo(makeTmpDir('f2-idem'));
    applyBlanketGitignore(root, 'alpha/');
    const first = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    const res = applyBlanketGitignore(root, 'alpha/');
    expect(res.changed).toBe(false);
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf-8')).toBe(first);
  });

  it('F3: switching from an allowlist block to the blanket block drops the old allowlist lines', () => {
    const root = initGitRepo(makeTmpDir('f3-switch'));
    // Seed a managed block that carries a non-blanket (allowlist-style) entry.
    fs.writeFileSync(
      path.join(root, '.gitignore'),
      `${MANAGED_START}\n.squad/history.md\n# --- end squad (managed) ---\n`,
      'utf-8',
    );
    applyBlanketGitignore(root); // root host, prefix ''
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    expect(gi).toContain('.squad/');
    expect(gi).not.toContain('.squad/history.md');
    expect(gi.split(MANAGED_START).length - 1).toBe(1);
  });

  it('F4: removeLegacySubfolderManagedBlock strips a legacy subfolder block, preserving user lines', () => {
    const root = initGitRepo(makeTmpDir('f4-legacy'));
    const subDir = path.join(root, 'alpha');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, '.gitignore'),
      `# my own rule\nnode_modules/\n${MANAGED_START}\n.squad/\n# --- end squad (managed) ---\n`,
      'utf-8',
    );

    const changed = removeLegacySubfolderManagedBlock(root, 'alpha');
    expect(changed).toBe(true);

    const gi = fs.readFileSync(path.join(subDir, '.gitignore'), 'utf-8');
    expect(gi).toContain('# my own rule');
    expect(gi).toContain('node_modules/');
    expect(gi).not.toContain(MANAGED_START);
    expect(gi).not.toContain('.squad/');
  });

  it('F5: removeLegacySubfolderManagedBlock deletes the file when only the managed block remained', () => {
    const root = initGitRepo(makeTmpDir('f5-delete'));
    const subDir = path.join(root, 'alpha');
    fs.mkdirSync(subDir, { recursive: true });
    const legacy = path.join(subDir, '.gitignore');
    fs.writeFileSync(legacy, `${MANAGED_START}\n.squad/\n# --- end squad (managed) ---\n`, 'utf-8');

    expect(removeLegacySubfolderManagedBlock(root, 'alpha')).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('F6: removeLegacySubfolderManagedBlock is a no-op when there is no legacy block', () => {
    const root = initGitRepo(makeTmpDir('f6-noop'));
    fs.mkdirSync(path.join(root, 'alpha'), { recursive: true });
    // No subfolder .gitignore at all.
    expect(removeLegacySubfolderManagedBlock(root, 'alpha')).toBe(false);
    // A subfolder .gitignore with only user lines is left untouched.
    const legacy = path.join(root, 'alpha', '.gitignore');
    fs.writeFileSync(legacy, 'dist/\n', 'utf-8');
    expect(removeLegacySubfolderManagedBlock(root, 'alpha')).toBe(false);
    expect(fs.readFileSync(legacy, 'utf-8')).toBe('dist/\n');
  });
});
