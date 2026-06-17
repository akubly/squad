/**
 * Tests for installFoldPipeline (sub-proposal C).
 *
 * Covers: github/ado platform args copy templates to repo-root paths; idempotent
 * re-run exits 0; conflict guard exits 1 with path in message; missing target
 * directory exits 1; registry-first docs-path resolution (not config.json-primary),
 * and callsign-generic default pipeline generation.
 */

// ─── Registry mock ───────────────────────────────────────────────────────────
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
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import {
  installFoldPipeline,
  type InstallFoldPipelineOptions,
} from '../../packages/squad-cli/src/cli/commands/install-fold-pipeline.js';

vi.setConfig({ testTimeout: 30_000 });

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.install-fold-pipeline-p35-tmp');
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

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) =>
    p.toLowerCase().replace(/\\/g, '/'),
  );
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
});

// ─── Helper: set up a registry entry pointing at a docs-repo clone ────────────

function setupRegistryEntryForSquadDir(squadDir: string, cloneRoot: string): void {
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

  // normalisedPathKey: return canonical path for both cloneRoot and squadDir
  vi.mocked(normalisedPathKey).mockImplementation((p: string) =>
    p.toLowerCase().replace(/\\/g, '/'),
  );
}

function setupRegistryEntry(docsRepoDir: string, cloneRoot: string): string {
  const docsRepoRoot = initGitRepo(docsRepoDir);
  setupRegistryEntryForSquadDir(path.join(docsRepoRoot, '.squad'), cloneRoot);
  return docsRepoRoot;
}

// ─── Tests: github platform ───────────────────────────────────────────────────

describe('github platform', () => {
  it('D1: copies template to <docsRepoPath>/.github/workflows/fold-squad-state.yml', async () => {
    const docsRepoDir = makeTmpDir('docs-gh');
    const cloneDir = makeTmpDir('clone-gh');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    const dest = path.join(docsRepoRoot, '.github', 'workflows', 'fold-squad-state.yml');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
  });

  it('D2: is idempotent — second run exits 0 and produces no file change', async () => {
    const docsRepoDir = makeTmpDir('docs-gh-idem');
    const cloneDir = makeTmpDir('clone-gh-idem');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });
    const contentAfterFirst = fs.readFileSync(
      path.join(docsRepoRoot, '.github', 'workflows', 'fold-squad-state.yml'),
      'utf-8',
    );

    // Second run — should be a no-op
    await installFoldPipeline('github', { cwd: cloneDir });
    const contentAfterSecond = fs.readFileSync(
      path.join(docsRepoRoot, '.github', 'workflows', 'fold-squad-state.yml'),
      'utf-8',
    );

    expect(contentAfterSecond).toBe(contentAfterFirst);
  });

  it('D3: conflict guard — existing file with different content exits 1 with path in message', async () => {
    const docsRepoDir = makeTmpDir('docs-gh-conflict');
    const cloneDir = makeTmpDir('clone-gh-conflict');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    const destPath = path.join(workflowsDir, 'fold-squad-state.yml');
    fs.writeFileSync(destPath, '# different content\n', 'utf-8');

    setupRegistryEntry(docsRepoDir, cloneRoot);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(installFoldPipeline('github', { cwd: cloneDir })).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(errOutput).toContain(destPath);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it('D4: missing .github/workflows/ directory exits 1 before any write', async () => {
    const docsRepoDir = makeTmpDir('docs-gh-nodir');
    const cloneDir = makeTmpDir('clone-gh-nodir');
    const cloneRoot = initGitRepo(cloneDir);
    // Do NOT create .github/workflows/

    setupRegistryEntry(docsRepoDir, cloneRoot);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(installFoldPipeline('github', { cwd: cloneDir })).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

// ─── Tests: ado platform ─────────────────────────────────────────────────────

describe('ado platform', () => {
  it('D5: copies template to <docsRepoPath>/.azuredevops/fold-squad-state.yml', async () => {
    const docsRepoDir = makeTmpDir('docs-ado');
    const cloneDir = makeTmpDir('clone-ado');
    const cloneRoot = initGitRepo(cloneDir);
    const pipelinesDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: cloneDir });
    } finally {
      consoleSpy.mockRestore();
    }

    const dest = path.join(docsRepoRoot, '.azuredevops', 'fold-squad-state.yml');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
  });

  it('D6: missing .azuredevops/ directory exits 1', async () => {
    const docsRepoDir = makeTmpDir('docs-ado-nodir');
    const cloneDir = makeTmpDir('clone-ado-nodir');
    const cloneRoot = initGitRepo(cloneDir);
    // Do NOT create .azuredevops/

    setupRegistryEntry(docsRepoDir, cloneRoot);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(installFoldPipeline('ado', { cwd: cloneDir })).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

// ─── Tests: registry-first resolution ────────────────────────────────────────

describe('registry-first docs-repo path resolution', () => {
  it('D7: derives docsRepoPath from path.dirname(entry.path), not from config.json', async () => {
    const docsRepoDir = makeTmpDir('docs-regfirst');
    const cloneDir = makeTmpDir('clone-regfirst');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    // Set up a config.json with a WRONG (non-existent) docsRepoPath to ensure
    // registry entry is used instead of config.json
    const wrongDocsDir = path.join(TMP_ROOT, 'wrong-docs-dir');
    fs.mkdirSync(path.join(cloneDir, '.squad'), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, '.squad', 'config.json'),
      JSON.stringify({ version: 1, stateLocation: wrongDocsDir }),
      'utf-8',
    );

    // Registry entry points to the correct docsRepoDir
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    // File must be written to the registry-derived path, not the config.json path
    const dest = path.join(workflowsDir, 'fold-squad-state.yml');
    expect(fs.existsSync(dest)).toBe(true);
    expect(dest.toLowerCase().replace(/\\/g, '/').startsWith(docsRepoRoot.toLowerCase().replace(/\\/g, '/'))).toBe(true);

    // Wrong path must NOT have been written
    const wrongDest = path.join(wrongDocsDir, '.github', 'workflows', 'fold-squad-state.yml');
    expect(fs.existsSync(wrongDest)).toBe(false);
  });
});

describe('repo-root target resolution', () => {
  it('A1: nested .squad entry writes GitHub workflow under the git repository root', async () => {
    const hostRepoDir = makeTmpDir('host-nested-gh');
    const hostRoot = initGitRepo(hostRepoDir);
    const cloneDir = makeTmpDir('clone-nested-gh');
    const cloneRoot = initGitRepo(cloneDir);
    const nestedSquadDir = path.join(hostRoot, 'alpha-host', '.squad');
    fs.mkdirSync(path.join(hostRoot, '.github', 'workflows'), { recursive: true });

    setupRegistryEntryForSquadDir(nestedSquadDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    const rootDest = path.join(hostRoot, '.github', 'workflows', 'fold-squad-state.yml');
    const nestedDest = path.join(hostRoot, 'alpha-host', '.github', 'workflows', 'fold-squad-state.yml');
    expect(fs.existsSync(rootDest)).toBe(true);
    expect(fs.existsSync(nestedDest)).toBe(false);
  });

  it('A2: root-level .squad entry keeps the GitHub workflow path unchanged', async () => {
    const hostRepoDir = makeTmpDir('host-root-gh');
    const hostRoot = initGitRepo(hostRepoDir);
    const cloneDir = makeTmpDir('clone-root-gh');
    const cloneRoot = initGitRepo(cloneDir);
    fs.mkdirSync(path.join(hostRoot, '.github', 'workflows'), { recursive: true });

    setupRegistryEntryForSquadDir(path.join(hostRoot, '.squad'), cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    expect(fs.existsSync(path.join(hostRoot, '.github', 'workflows', 'fold-squad-state.yml'))).toBe(true);
  });

  it('A3: non-git host entry exits 1 and writes no pipeline file', async () => {
    const hostDir = makeTmpDir('host-nongit-gh');
    const cloneDir = makeTmpDir('clone-nongit-gh');
    const cloneRoot = initGitRepo(cloneDir);
    fs.mkdirSync(path.join(hostDir, '.github', 'workflows'), { recursive: true });
    setupRegistryEntryForSquadDir(path.join(hostDir, '.squad'), cloneRoot);
    const oldCeiling = process.env['GIT_CEILING_DIRECTORIES'];
    process.env['GIT_CEILING_DIRECTORIES'] = path.dirname(hostDir);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(installFoldPipeline('github', { cwd: cloneDir })).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(errOutput).toContain('git repository root');
      expect(fs.existsSync(path.join(hostDir, '.github', 'workflows', 'fold-squad-state.yml'))).toBe(false);
    } finally {
      if (oldCeiling === undefined) {
        delete process.env['GIT_CEILING_DIRECTORIES'];
      } else {
        process.env['GIT_CEILING_DIRECTORIES'] = oldCeiling;
      }
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

describe('callsign-generic generated pipeline', () => {
  it('B1: default GitHub output discovers callsigns and avoids the flat squad-state target', async () => {
    const docsRepoDir = makeTmpDir('docs-gh-generic');
    const cloneDir = makeTmpDir('clone-gh-generic');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.github', 'workflows'), { recursive: true });

    await installFoldPipeline('github', { cwd: cloneDir });

    const yaml = fs.readFileSync(path.join(docsRepoRoot, '.github', 'workflows', 'fold-squad-state.yml'), 'utf-8');
    expect(yaml).toContain("- 'squad/inbox/**'");
    expect(yaml).toContain("git ls-remote --heads origin 'refs/heads/squad/inbox/*'");
    expect(yaml).toContain("sed -nE 's#^[0-9a-f]+\\srefs/heads/squad/inbox/([^/]+)/.*#\\1#p'");
    expect(yaml).toContain('sort -u');
    expect(yaml).toContain('squad/state/$CALLSIGN');
    expect(yaml).toContain('^[a-z][a-z0-9-]{1,38}$');
    expect(yaml).not.toContain('refs/heads/squad-state');
    expect(yaml).not.toContain('git push origin HEAD:refs/heads/squad-state');
  });

  it('B2: default ADO output is batched, discovers callsigns, and avoids the flat squad-state target', async () => {
    const docsRepoDir = makeTmpDir('docs-ado-generic');
    const cloneDir = makeTmpDir('clone-ado-generic');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.azuredevops'), { recursive: true });

    await installFoldPipeline('ado', { cwd: cloneDir });

    const yaml = fs.readFileSync(path.join(docsRepoRoot, '.azuredevops', 'fold-squad-state.yml'), 'utf-8');
    expect(yaml).toContain('batch: true');
    expect(yaml).toContain('- refs/heads/squad/inbox/*');
    expect(yaml).toContain("git ls-remote --heads origin 'refs/heads/squad/inbox/*'");
    expect(yaml).toContain("sed -nE 's#^[0-9a-f]+\\srefs/heads/squad/inbox/([^/]+)/.*#\\1#p'");
    expect(yaml).toContain('sort -u');
    expect(yaml).toContain('squad/state/$CALLSIGN');
    expect(yaml).not.toContain('refs/heads/squad-state');
    expect(yaml).not.toContain('git push origin HEAD:refs/heads/squad-state');
  });

  it('B3: --callsign GitHub output remains scoped to one callsign', async () => {
    const docsRepoDir = makeTmpDir('docs-gh-scoped');
    const cloneDir = makeTmpDir('clone-gh-scoped');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.github', 'workflows'), { recursive: true });

    await installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha-team' });

    const yaml = fs.readFileSync(path.join(docsRepoRoot, '.github', 'workflows', 'fold-squad-state.alpha-team.yml'), 'utf-8');
    expect(yaml).toContain("- 'squad/inbox/alpha-team/**'");
    expect(yaml).toContain("callsigns=\"alpha-team\"");
    expect(yaml).toContain('squad/state/alpha-team');
    expect(yaml).not.toContain("git ls-remote --heads origin 'refs/heads/squad/inbox/*'");
  });

  it('B4: --callsign ADO output remains scoped to one callsign', async () => {
    const docsRepoDir = makeTmpDir('docs-ado-scoped');
    const cloneDir = makeTmpDir('clone-ado-scoped');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.azuredevops'), { recursive: true });

    await installFoldPipeline('ado', { cwd: cloneDir, callsign: 'alpha-team' });

    const yaml = fs.readFileSync(path.join(docsRepoRoot, '.azuredevops', 'fold-squad-state.alpha-team.yml'), 'utf-8');
    expect(yaml).toContain('- refs/heads/squad/inbox/alpha-team/*');
    expect(yaml).toContain("callsigns=\"alpha-team\"");
    expect(yaml).toContain('squad/state/alpha-team');
    expect(yaml).not.toContain("git ls-remote --heads origin 'refs/heads/squad/inbox/*'");
  });
});

// ─── Piece 44 sub-proposal A: callsign-named scoped filename ──────────────────

describe('piece 44 A: callsign-named scoped pipeline filename', () => {
  it('A44.1: --callsign writes fold-squad-state.<callsign>.yml and not the generic filename', async () => {
    const docsRepoDir = makeTmpDir('p44-docs-named');
    const cloneDir = makeTmpDir('p44-clone-named');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    fs.mkdirSync(path.join(docsRepoRoot, '.github', 'workflows'), { recursive: true });

    await installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha' });

    const wfDir = path.join(docsRepoRoot, '.github', 'workflows');
    expect(fs.existsSync(path.join(wfDir, 'fold-squad-state.alpha.yml'))).toBe(true);
    expect(fs.existsSync(path.join(wfDir, 'fold-squad-state.yml'))).toBe(false);
  });

  it('A44.2: two scoped installs for different callsigns coexist without tripping the conflict gate', async () => {
    const docsRepoDir = makeTmpDir('p44-docs-coexist');
    const cloneDir = makeTmpDir('p44-clone-coexist');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wfDir = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_c?: number | string | null) => {
      throw new Error('process.exit called');
    });
    try {
      await installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha' });
      await installFoldPipeline('github', { cwd: cloneDir, callsign: 'bravo' });
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    }

    expect(fs.existsSync(path.join(wfDir, 'fold-squad-state.alpha.yml'))).toBe(true);
    expect(fs.existsSync(path.join(wfDir, 'fold-squad-state.bravo.yml'))).toBe(true);
  });

  it('A44.3: default (no --callsign) install still writes the generic fold-squad-state.yml', async () => {
    const docsRepoDir = makeTmpDir('p44-docs-default');
    const cloneDir = makeTmpDir('p44-clone-default');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wfDir = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });

    await installFoldPipeline('github', { cwd: cloneDir });

    expect(fs.existsSync(path.join(wfDir, 'fold-squad-state.yml'))).toBe(true);
  });

  it('A44.4: idempotent re-run of a scoped install is a no-op (exit 0, no conflict)', async () => {
    const docsRepoDir = makeTmpDir('p44-docs-idem');
    const cloneDir = makeTmpDir('p44-clone-idem');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wfDir = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_c?: number | string | null) => {
      throw new Error('process.exit called');
    });
    try {
      await installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha' });
      const first = fs.readFileSync(path.join(wfDir, 'fold-squad-state.alpha.yml'), 'utf-8');
      await installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha' });
      const second = fs.readFileSync(path.join(wfDir, 'fold-squad-state.alpha.yml'), 'utf-8');
      expect(second).toBe(first);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('A44.5: scoped conflict gate names the callsign-named path when content differs', async () => {
    const docsRepoDir = makeTmpDir('p44-docs-conflict');
    const cloneDir = makeTmpDir('p44-clone-conflict');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wfDir = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    const destPath = path.join(wfDir, 'fold-squad-state.alpha.yml');
    fs.writeFileSync(destPath, '# different content\n', 'utf-8');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_c?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha' })).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(errOutput).toContain(destPath);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it('A44.6 (C1): a scoped install leaves a pre-existing generic fold-squad-state.yml in place', async () => {
    const docsRepoDir = makeTmpDir('p44-docs-c1');
    const cloneDir = makeTmpDir('p44-clone-c1');
    const cloneRoot = initGitRepo(cloneDir);
    const docsRepoRoot = setupRegistryEntry(docsRepoDir, cloneRoot);
    const wfDir = path.join(docsRepoRoot, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    const genericPath = path.join(wfDir, 'fold-squad-state.yml');
    fs.writeFileSync(genericPath, '# pre-existing generic pipeline\n', 'utf-8');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('github', { cwd: cloneDir, callsign: 'alpha' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(fs.existsSync(path.join(wfDir, 'fold-squad-state.alpha.yml'))).toBe(true);
    // C1: the generic file is left in place (not removed by the scoped install).
    expect(fs.existsSync(genericPath)).toBe(true);
    expect(fs.readFileSync(genericPath, 'utf-8')).toBe('# pre-existing generic pipeline\n');
  });
});
