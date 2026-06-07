/**
 * Tests for installFoldPipeline (sub-proposal C).
 *
 * Covers: github/ado platform args copy templates to correct paths; idempotent
 * re-run exits 0; conflict guard exits 1 with path in message; missing target
 * directory exits 1; registry-first docs-path resolution (not config.json-primary).
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

function setupRegistryEntry(docsRepoDir: string, cloneRoot: string): void {
  const squadDir = path.join(docsRepoDir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });

  vi.mocked(loadRegistryFromDisk).mockReturnValue({
    registry: makeRegistry([{
      callsign: 'test-squad',
      path: squadDir,
      clones: [cloneRoot],
      stateRemote: 'origin',
      stateBranch: 'squad-state',
      developerAlias: 'testdev',
    }]),
    warnings: [],
  });

  // normalisedPathKey: return canonical path for both cloneRoot and squadDir
  const normalizedClone = cloneRoot.toLowerCase().replace(/\\/g, '/');
  vi.mocked(normalisedPathKey).mockImplementation((p: string) =>
    p.toLowerCase().replace(/\\/g, '/'),
  );
}

// ─── Tests: github platform ───────────────────────────────────────────────────

describe('github platform', () => {
  it('D1: copies template to <docsRepoPath>/.github/workflows/fold-squad-state.yml', async () => {
    const docsRepoDir = makeTmpDir('docs-gh');
    const cloneDir = makeTmpDir('clone-gh');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    const dest = path.join(workflowsDir, 'fold-squad-state.yml');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
  });

  it('D2: is idempotent — second run exits 0 and produces no file change', async () => {
    const docsRepoDir = makeTmpDir('docs-gh-idem');
    const cloneDir = makeTmpDir('clone-gh-idem');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });
    const contentAfterFirst = fs.readFileSync(
      path.join(workflowsDir, 'fold-squad-state.yml'),
      'utf-8',
    );

    // Second run — should be a no-op
    await installFoldPipeline('github', { cwd: cloneDir });
    const contentAfterSecond = fs.readFileSync(
      path.join(workflowsDir, 'fold-squad-state.yml'),
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
  it('D5: copies template to <docsRepoPath>/.azure-pipelines/fold-squad-state.yml', async () => {
    const docsRepoDir = makeTmpDir('docs-ado');
    const cloneDir = makeTmpDir('clone-ado');
    const cloneRoot = initGitRepo(cloneDir);
    const pipelinesDir = path.join(docsRepoDir, '.azure-pipelines');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('ado', { cwd: cloneDir });

    const dest = path.join(pipelinesDir, 'fold-squad-state.yml');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
  });

  it('D6: missing .azure-pipelines/ directory exits 1', async () => {
    const docsRepoDir = makeTmpDir('docs-ado-nodir');
    const cloneDir = makeTmpDir('clone-ado-nodir');
    const cloneRoot = initGitRepo(cloneDir);
    // Do NOT create .azure-pipelines/

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
    setupRegistryEntry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    // File must be written to the registry-derived path, not the config.json path
    const dest = path.join(workflowsDir, 'fold-squad-state.yml');
    expect(fs.existsSync(dest)).toBe(true);

    // Wrong path must NOT have been written
    const wrongDest = path.join(wrongDocsDir, '.github', 'workflows', 'fold-squad-state.yml');
    expect(fs.existsSync(wrongDest)).toBe(false);
  });
});
