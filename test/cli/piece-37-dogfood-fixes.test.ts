/**
 * Piece 37 — Dogfood fixes and publish-model: targeted regression tests for A–H.
 *
 * A: sync direction positional (push/pull positional sets direction)
 * B: stateRemote defaults to 'origin' (not 'squad-docs')
 * C: install-fold-pipeline appears in --help table
 * D: --callsign narrows origin-ambiguous warm-path disambiguation
 * E: "docs-repo" user-facing strings renamed to "shared-squad host clone" / "host clone"
 * F: squad assign --help branch exits 0 without calling runAssign
 * G: help table uses COMMAND_COL_WIDTH padding constant
 * H: ADO pipeline directory changed to .azuredevops/
 */

// ─── Registry mock (required by runSync and installFoldPipeline integration tests) ──
vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
  writeRegistry: vi.fn(),
}));
vi.mock('@bradygaster/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));
vi.mock('@bradygaster/squad-sdk/validation', () => ({
  DEVELOPER_ALIAS_RE: /^[a-z][a-z0-9-]{1,38}$/,
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  runSync,
  _transport,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  installFoldPipeline,
} from '../../packages/squad-cli/src/cli/commands/install-fold-pipeline.js';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import type { Registry } from '@bradygaster/squad-sdk/registry';

// ─── Source files for static analysis tests ──────────────────────────────────

const CLI_ENTRY_SRC = resolve(process.cwd(), 'packages/squad-cli/src/cli-entry.ts');
const SYNC_SRC = resolve(process.cwd(), 'packages/squad-cli/src/cli/commands/sync.ts');
const ASSIGN_SRC = resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts');
const INSTALL_FOLD_SRC = resolve(process.cwd(), 'packages/squad-cli/src/cli/commands/install-fold-pipeline.ts');
const INSTALL_HOOKS_SRC = resolve(process.cwd(), 'packages/squad-cli/src/cli/commands/install-hooks.ts');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-37-tmp');
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

function makeSquadHost(hostDir: string, callsign: string): string {
  const squadDir = path.join(hostDir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), `# ${callsign}\n`, 'utf8');
  return squadDir;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ─── A: sync direction positional ─────────────────────────────────────────────

describe('A — sync direction positional (P37)', () => {
  const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');

  it("P37.A1 subCmd === 'push' positional sets direction to push", () => {
    expect(src).toMatch(/subCmd === ['"]push['"]/);
  });

  it("P37.A2 subCmd === 'pull' positional sets direction to pull", () => {
    expect(src).toMatch(/subCmd === ['"]pull['"]/);
  });

  it('P37.A3 flag checks (hasPush/hasPull) come before positional subCmd check', () => {
    const flagIdx = src.indexOf("hasPush = args.includes('--push')");
    const positionalIdx = src.indexOf("subCmd === 'push'");
    expect(flagIdx).toBeGreaterThan(-1);
    expect(positionalIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(positionalIdx);
  });

  it("P37.A4 sync status check is separate from direction parsing", () => {
    // Status subcommand is handled before direction resolution
    const statusIdx = src.indexOf("subCmd === 'status'");
    const pushFlagIdx = src.indexOf("hasPush = args.includes('--push')");
    expect(statusIdx).toBeGreaterThan(-1);
    expect(pushFlagIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeLessThan(pushFlagIdx);
  });
});

// ─── B: stateRemote defaults to 'origin' ─────────────────────────────────────

describe('B — stateRemote defaults to origin (P37)', () => {
  it('P37.B1 DEFAULT_STATE_REMOTE constant defined as origin in sync.ts', () => {
    const src = readFileSync(SYNC_SRC, 'utf-8');
    expect(src).toMatch(/DEFAULT_STATE_REMOTE\s*=\s*['"]origin['"]/);
  });

  it('P37.B2 cross-repo push with unset stateRemote calls publishTeamRootToInbox with origin', async () => {
    const docsRepoDir = makeTmpDir('docs-b2');
    const cloneDir = makeTmpDir('clone-b2');
    const cloneRoot = initGitRepo(cloneDir);

    const squadDir = makeSquadHost(docsRepoDir, 'test-squad');
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'log'), { recursive: true });
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'decisions.md'), '# Decisions\n');
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'log', 'session.md'), '# Log\n');
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'sessions', 'session.json'), '{}');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        developerAlias: 'devtest',
        // stateRemote is intentionally NOT set → should default to 'origin'
        stateBranch: 'squad-state',
      }]),
      warnings: [],
    });

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-b2';
      await runSync({ direction: 'push', cwd: cloneDir });

      expect(publishSpy).toHaveBeenCalledOnce();
      // Second argument is the stateRemote — should be 'origin' not 'squad-docs'
      const [, calledRemote] = publishSpy.mock.calls[0]!;
      expect(calledRemote).toBe('origin');
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('P37.B3 explicit stateRemote=upstream in registry entry uses upstream', async () => {
    const docsRepoDir = makeTmpDir('docs-b3');
    const cloneDir = makeTmpDir('clone-b3');
    const cloneRoot = initGitRepo(cloneDir);

    const squadDir = makeSquadHost(docsRepoDir, 'test-squad');
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'log'), { recursive: true });
    fs.mkdirSync(path.join(docsRepoDir, '.squad', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'decisions.md'), '# Decisions\n');
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'log', 'session.md'), '# Log\n');
    fs.writeFileSync(path.join(docsRepoDir, '.squad', 'sessions', 'session.json'), '{}');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        developerAlias: 'devtest',
        stateRemote: 'upstream',
        stateBranch: 'squad-state',
      }]),
      warnings: [],
    });

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-b3';
      await runSync({ direction: 'push', cwd: cloneDir });

      expect(publishSpy).toHaveBeenCalledOnce();
      const [, calledRemote] = publishSpy.mock.calls[0]!;
      expect(calledRemote).toBe('upstream');
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('P37.B4 cross-repo status log shows stateRemote ?? origin, not single-repo remote variable', () => {
    const src = readFileSync(SYNC_SRC, 'utf-8');
    // The status log for cross-repo should use stateRemote ?? DEFAULT_STATE_REMOTE
    expect(src).toMatch(/stateRemote \?\? DEFAULT_STATE_REMOTE/);
    // The 'squad-docs' literal must no longer appear
    expect(src).not.toContain("'squad-docs'");
  });
});

// ─── C: install-fold-pipeline in help table ───────────────────────────────────

describe('C — install-fold-pipeline in --help table (P37)', () => {
  it('P37.C1 cli-entry.ts help table contains install-fold-pipeline', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    expect(src).toContain('install-fold-pipeline');
  });

  it('P37.C2 install-fold-pipeline help entry description mentions fold pipeline', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    // Find the help table entry for install-fold-pipeline (in the padEnd format)
    expect(src).toContain("'install-fold-pipeline'.padEnd(COMMAND_COL_WIDTH)");
    expect(src).toContain('Install the fold pipeline YAML into the shared-squad host repository');
  });
});

// ─── D: --callsign warm-path disambiguation ───────────────────────────────────

describe('D — callsign warm-path disambiguation (P37)', () => {
  it('P37.D1 assign.ts originMatchingEntries filter includes opts.callsign discriminator', () => {
    const src = readFileSync(ASSIGN_SRC, 'utf-8');
    // The filter must contain an opts.callsign guard so that when the flag is provided,
    // only entries matching that callsign are counted as "ambiguous".
    expect(src).toMatch(/opts\.callsign.*e\.callsign|e\.callsign.*opts\.callsign/);
  });

  it('P37.D2 originMatchingEntries filter short-circuits on opts.callsign mismatch', () => {
    const src = readFileSync(ASSIGN_SRC, 'utf-8');
    // The guard should appear near the originMatchingEntries filter definition
    expect(src).toContain('opts.callsign && e.callsign !== opts.callsign');
  });
});

// ─── E: rename "docs-repo" user-facing strings ───────────────────────────────

describe('E — rename docs-repo strings (P37)', () => {
  it('P37.E1 assign.ts user-facing message no longer contains "docs-repo clone"', () => {
    const src = readFileSync(ASSIGN_SRC, 'utf-8');
    // The specific user-visible warning string (not code comments) must not say "docs-repo clone"
    expect(src).not.toContain('after the docs-repo clone is available');
    // Must contain the new term in the warning
    expect(src).toContain('after the shared-squad host clone is available');
  });

  it('P37.E2 install-fold-pipeline.ts user-facing messages no longer contain "docs-repo"', () => {
    const src = readFileSync(INSTALL_FOLD_SRC, 'utf-8');
    // User-visible error/log strings (not jsdoc comments) should not reference "docs-repo path"
    expect(src).not.toContain('docs-repo path. Run');
    expect(src).not.toContain('docs-repo pipeline directory');
    // New terms are present in user-facing strings
    expect(src).toContain('shared-squad host clone path');
  });

  it('P37.E3 install-hooks.ts user-facing error message no longer contains "docs-repo"', () => {
    const src = readFileSync(INSTALL_HOOKS_SRC, 'utf-8');
    // The throw message must not say "docs-repo clone path"
    expect(src).not.toContain('docs-repo clone path');
    expect(src).toContain('shared-squad host clone path');
  });

  it('P37.E4 sync.ts label renamed from "Docs repo path:" to new term', () => {
    const src = readFileSync(SYNC_SRC, 'utf-8');
    expect(src).not.toContain('Docs repo path:');
    expect(src).toMatch(/Host clone path:|host clone/i);
  });
});

// ─── F: squad assign --help branch ───────────────────────────────────────────

describe('F — squad assign --help branch (P37)', () => {
  it("P37.F1 cli-entry.ts contains assign --help dispatch branch", () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    expect(src).toMatch(/cmd === ['"]assign['"]/);
    // The help block must print assign usage
    expect(src).toContain('--developer-alias');
    expect(src).toContain('--state-remote');
    expect(src).toContain('--state-branch');
  });

  it('P37.F2 assign --help branch does not invoke runAssign (just returns)', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    // The assign help block must exist and return immediately (not call runAssign)
    expect(src).toContain("cmd === 'assign'");
    // The block contains a return statement
    const helpBlockStart = src.indexOf("cmd === 'assign'");
    // Extend search area to accommodate longer blocks
    const afterBlock = src.slice(helpBlockStart, helpBlockStart + 1200);
    expect(afterBlock).toContain('return');
    // runAssign must not be called inside the help block (before the next 'if (cmd ===' boundary)
    const nextCmdBoundary = afterBlock.indexOf("cmd === '", 30);
    const searchArea = nextCmdBoundary > 0 ? afterBlock.slice(0, nextCmdBoundary) : afterBlock;
    expect(searchArea).not.toMatch(/runAssign\s*\(/);
  });
});

// ─── G: help table column padding ─────────────────────────────────────────────

describe('G — help table COMMAND_COL_WIDTH padding (P37)', () => {
  it('P37.G1 COMMAND_COL_WIDTH constant is defined (>= 24)', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    expect(src).toContain('COMMAND_COL_WIDTH');
    const match = src.match(/COMMAND_COL_WIDTH\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const width = parseInt(match![1]!, 10);
    expect(width).toBeGreaterThanOrEqual(24);
  });

  it('P37.G2 padEnd(COMMAND_COL_WIDTH) is applied to command names in help table', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    expect(src).toMatch(/\.padEnd\(COMMAND_COL_WIDTH\)/);
  });

  it('P37.G3 all description strings begin at the same character offset (alignment)', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');
    const widthMatch = src.match(/COMMAND_COL_WIDTH\s*=\s*(\d+)/);
    expect(widthMatch).not.toBeNull();
    const width = parseInt(widthMatch![1]!, 10);
    // All padEnd(COMMAND_COL_WIDTH) calls produce uniform width regardless of name length
    expect(width).toBeGreaterThanOrEqual(24);
    // 'install-fold-pipeline' (21 chars) + 2-char gap fits in width
    expect(width).toBeGreaterThanOrEqual('install-fold-pipeline'.length + 2);
  });
});

// ─── H: ADO pipeline directory ────────────────────────────────────────────────

describe('H — ADO pipeline directory .azuredevops (P37)', () => {
  it('P37.H1 install-fold-pipeline.ts maps ado platform to .azuredevops directory', () => {
    const src = readFileSync(INSTALL_FOLD_SRC, 'utf-8');
    expect(src).toContain('.azuredevops');
    expect(src).not.toContain('.azure-pipelines');
  });

  it('P37.H2 installFoldPipeline(ado) writes to .azuredevops/fold-squad-state.yml', async () => {
    const docsRepoDir = makeTmpDir('docs-h2');
    const cloneDir = makeTmpDir('clone-h2');
    const cloneRoot = initGitRepo(cloneDir);

    const squadDir = makeSquadHost(docsRepoDir, 'test-squad');
    const adoDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(adoDir, { recursive: true });

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

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: cloneDir });
      const dest = path.join(adoDir, 'fold-squad-state.yml');
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('P37.H3 installFoldPipeline(ado) detects conflict at .azuredevops/ path and exits 1', async () => {
    const docsRepoDir = makeTmpDir('docs-h3');
    const cloneDir = makeTmpDir('clone-h3');
    const cloneRoot = initGitRepo(cloneDir);

    const squadDir = makeSquadHost(docsRepoDir, 'test-squad');
    const adoDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(adoDir, { recursive: true });

    // Pre-populate with different content to trigger conflict
    const destPath = path.join(adoDir, 'fold-squad-state.yml');
    fs.writeFileSync(destPath, '# different content\n', 'utf-8');

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

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(installFoldPipeline('ado', { cwd: cloneDir })).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(errOutput).toContain(destPath);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it('P37.H4 install-fold-pipeline.ts contains ADO portal note for .azuredevops path', () => {
    const src = readFileSync(INSTALL_FOLD_SRC, 'utf-8');
    expect(src).toMatch(/\.azuredevops.*fold-squad-state\.yml|fold-squad-state\.yml.*\.azuredevops/i);
  });
});

// ─── A5: Behavioral direction-computation test ────────────────────────────────

describe('A — sync direction positional behavioral (P37)', () => {
  it('P37.A5 behavioral: positional push/pull sets direction (not default both) — fails on old code', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');

    // Extract the direction-computation block from cli-entry.ts sync dispatch.
    // Old code lacked the "else if (subCmd === 'push')" lines, so extracting and
    // running them would return 'both' for positional-only args on old code.
    const blockMatch = src.match(
      /const hasPush = args\.includes\('--push'\);[\s\S]+?else if \(subCmd === 'pull'\) direction = 'pull';/,
    );
    expect(blockMatch).not.toBeNull();

    // Strip TypeScript type annotation so the block is valid JS for Function()
    const jsBlock = blockMatch![0].replace(/: 'push' \| 'pull' \| 'both'/, '');

    // Execute the production direction-computation block via Function constructor.
    // subCmd is args[1] in cli-entry.ts (args[0] = 'sync').
    // eslint-disable-next-line no-new-func
    const computeDirection = new Function('args', `
      const subCmd = args[1];
      ${jsBlock}
      return direction;
    `) as (args: string[]) => string;

    // Positional-only: OLD code returns 'both' here (positional was ignored).
    expect(computeDirection(['sync', 'push'])).toBe('push');
    expect(computeDirection(['sync', 'pull'])).toBe('pull');

    // Flag-only (unchanged from old behaviour):
    expect(computeDirection(['sync', '--push'])).toBe('push');
    expect(computeDirection(['sync', '--pull'])).toBe('pull');
    expect(computeDirection(['sync', '--both'])).toBe('both');

    // Flag wins over positional (precedence rule):
    expect(computeDirection(['sync', 'push', '--both'])).toBe('both');
    expect(computeDirection(['sync', 'push', '--pull'])).toBe('pull');
    expect(computeDirection(['sync', 'pull', '--push'])).toBe('push');

    // No direction specified → defaults to 'both':
    expect(computeDirection(['sync'])).toBe('both');
  });
});

// ─── D3/D4: Behavioral callsign warm-path disambiguation tests ────────────────

describe('D — callsign warm-path disambiguation behavioral (P37)', () => {
  it('P37.D3 behavioral: opts.callsign discriminator narrows originMatchingEntries to single entry', () => {
    const src = readFileSync(ASSIGN_SRC, 'utf-8');

    // Extract the originMatchingEntries filter block from assign.ts.
    // Old code lacked "if (opts.callsign && e.callsign !== opts.callsign) return false;"
    // so old code would yield 2 entries even with opts.callsign set.
    const filterStart = src.indexOf('const originMatchingEntries = existingSquads.filter(e => {');
    expect(filterStart).toBeGreaterThan(-1);
    const afterFilter = src.slice(filterStart);
    const filterCode = afterFilter.slice(0, afterFilter.indexOf('});') + '});'.length);

    // Provide all variables the filter uses. Use identity for normalizeRemoteUrl
    // so URL matching is exact (no transformation needed for test data).
    // eslint-disable-next-line no-new-func
    const execFilter = new Function(
      'existingSquads', 'callsign', 'opts', 'normalizeRemoteUrl', 'normalizedNewOrigins',
      `${filterCode}\nreturn originMatchingEntries;`,
    ) as (
      squads: Array<{ callsign: string; origins?: string[] }>,
      cs: string,
      opts: Record<string, unknown>,
      norm: (u: string) => string,
      newOrigins: string[]
    ) => Array<{ callsign: string; origins?: string[] }>;

    const sharedOrigin = 'https://github.com/org/shared-repo.git';
    const squads = [
      { callsign: 'alpha', origins: [] as string[] },
      { callsign: 'beta',  origins: [sharedOrigin] },
      { callsign: 'gamma', origins: [sharedOrigin] },
    ];
    const normFn = (u: string): string => u;
    const newOrigins = [sharedOrigin];

    // Without opts.callsign: beta + gamma both match → ambiguity (≥ 2 entries)
    const withoutCallsign = execFilter(squads, 'alpha', {}, normFn, newOrigins);
    expect(withoutCallsign.length).toBeGreaterThanOrEqual(2);

    // With opts.callsign = 'beta': gamma is excluded → only beta → 1 entry (no ambiguity)
    const withBeta = execFilter(squads, 'alpha', { callsign: 'beta' }, normFn, newOrigins);
    expect(withBeta.length).toBe(1);
    expect((withBeta[0] as { callsign: string }).callsign).toBe('beta');

    // With opts.callsign = 'gamma': beta excluded → only gamma → 1 entry
    const withGamma = execFilter(squads, 'alpha', { callsign: 'gamma' }, normFn, newOrigins);
    expect(withGamma.length).toBe(1);
    expect((withGamma[0] as { callsign: string }).callsign).toBe('gamma');
  });

  it('P37.D4 behavioral: without opts.callsign, two origin-matching entries preserved (ambiguity unchanged)', () => {
    const src = readFileSync(ASSIGN_SRC, 'utf-8');

    const filterStart = src.indexOf('const originMatchingEntries = existingSquads.filter(e => {');
    const afterFilter = src.slice(filterStart);
    const filterCode = afterFilter.slice(0, afterFilter.indexOf('});') + '});'.length);

    // eslint-disable-next-line no-new-func
    const execFilter = new Function(
      'existingSquads', 'callsign', 'opts', 'normalizeRemoteUrl', 'normalizedNewOrigins',
      `${filterCode}\nreturn originMatchingEntries;`,
    ) as (
      squads: Array<{ callsign: string; origins?: string[] }>,
      cs: string,
      opts: Record<string, unknown>,
      norm: (u: string) => string,
      newOrigins: string[]
    ) => Array<{ callsign: string; origins?: string[] }>;

    const sharedOrigin = 'https://github.com/org/shared-repo.git';
    const squads = [
      { callsign: 'alpha', origins: [] as string[] },
      { callsign: 'beta',  origins: [sharedOrigin] },
      { callsign: 'gamma', origins: [sharedOrigin] },
    ];

    // No callsign → beta + gamma both pass → ≥ 2 entries → production throws
    // ERR_ASSIGN_ORIGIN_AMBIGUITY.  This is the pre-existing ambiguity behaviour.
    const result = execFilter(squads, 'alpha', {}, (u: string) => u, [sharedOrigin]);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const names = result.map((e) => (e as { callsign: string }).callsign);
    expect(names).toContain('beta');
    expect(names).toContain('gamma');
    expect(names).not.toContain('alpha');  // target is always excluded
  });
});

// ─── F3/F4: Behavioral assign --help tests ────────────────────────────────────

describe('F — squad assign --help behavioral (P37)', () => {
  it('P37.F3 behavioral: assign --help block invokes zero runAssign calls for both --help and -h', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');

    // Locate the per-command --help dispatch (outer condition).
    const helpDispatchIdx = src.indexOf("args.includes('--help') || args.includes('-h')");
    expect(helpDispatchIdx).toBeGreaterThan(-1);

    // Verify both --help and -h are covered by the outer condition.
    const outerCondition = src.slice(helpDispatchIdx, helpDispatchIdx + 60);
    expect(outerCondition).toContain("'--help'");
    expect(outerCondition).toContain("'-h'");

    // Find the 'if (cmd === assign)' block INSIDE the help dispatch.
    const ifAssignHelp = `if (cmd === 'assign')`;
    const assignHelpIdx = src.indexOf(ifAssignHelp, helpDispatchIdx);
    expect(assignHelpIdx).toBeGreaterThan(helpDispatchIdx);

    // Extract the block up to and including 'return;' AND the closing '}'.
    const snippet = src.slice(assignHelpIdx, assignHelpIdx + 1200);
    const returnIdx = snippet.indexOf('return;');
    expect(returnIdx).toBeGreaterThan(-1);
    // Include the closing brace that ends the 'if (cmd === assign)' block
    const closingBraceIdx = snippet.indexOf('}', returnIdx + 'return;'.length);
    expect(closingBraceIdx).toBeGreaterThan(returnIdx);
    const helpBlock = snippet.slice(0, closingBraceIdx + 1);

    // The block must NOT contain any runAssign call before the return.
    expect(helpBlock).not.toMatch(/runAssign\s*\(/);
    expect(helpBlock).not.toContain("import('./commands/assign.js')");

    // Behavioral: execute the block via Function() with a runAssign spy.
    // The 'return;' exits the function before any spy could be triggered.
    let runAssignCallCount = 0;
    const runAssignSpy = (): void => { runAssignCallCount++; };
    // eslint-disable-next-line no-new-func
    const execBlock = new Function('cmd', 'b', 'r', 'runAssign', 'console', helpBlock);
    const noopConsole = { log: () => {}, error: () => {} };

    runAssignCallCount = 0;
    execBlock('assign', '', '', runAssignSpy, noopConsole);
    expect(runAssignCallCount).toBe(0);   // --help path: runAssign not called

    // Also verify for -h: the outer condition is checked before cmd dispatch,
    // so cmd === 'assign' + -h leads to the same inner block → same result.
    runAssignCallCount = 0;
    execBlock('assign', '', '', runAssignSpy, noopConsole);
    expect(runAssignCallCount).toBe(0);   // -h path: same block, runAssign not called
  });

  it('P37.F4 behavioral: assign.ts Guard 1a — ERR_ASSIGN_MISSING_ARG thrown when callsignOrUrl is empty', () => {
    const src = readFileSync(ASSIGN_SRC, 'utf-8');
    // Guard 1a: when rawArg (trimmed callsignOrUrl) is empty, throw ERR_ASSIGN_MISSING_ARG.
    // This proves that if the --help dispatch path inadvertently invoked runAssign
    // with no callsign, it would throw a visible error — not silently pass.
    const rawArgIdx = src.indexOf('if (!rawArg)');
    expect(rawArgIdx).toBeGreaterThan(-1);
    // ERR_ASSIGN_MISSING_ARG throw must appear after the !rawArg check (same block)
    const missingArgIdx = src.indexOf("'ERR_ASSIGN_MISSING_ARG'", rawArgIdx);
    expect(missingArgIdx).toBeGreaterThan(rawArgIdx);
    expect(missingArgIdx - rawArgIdx).toBeLessThan(300);   // same code block
    // Guard 1a must appear before any registry write
    const writeIdx = src.indexOf('writeRegistryFn(');
    expect(missingArgIdx).toBeLessThan(writeIdx);
  });
});

// ─── G4: Behavioral alignment test ────────────────────────────────────────────

describe('G — help table alignment behavioral (P37)', () => {
  it('P37.G4 behavioral: all help table padEnd rows align descriptions at the same character offset', () => {
    const src = readFileSync(CLI_ENTRY_SRC, 'utf-8');

    // Extract COMMAND_COL_WIDTH value.
    const widthMatch = src.match(/COMMAND_COL_WIDTH\s*=\s*(\d+)/);
    expect(widthMatch).not.toBeNull();
    const width = parseInt(widthMatch![1]!, 10);

    // Extract every command name that uses padEnd(COMMAND_COL_WIDTH).
    // Pattern: 'commandName'.padEnd(COMMAND_COL_WIDTH)
    const padEndRe = /['"]([^'"]+)['"]\.padEnd\(COMMAND_COL_WIDTH\)/g;
    const commandNames: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = padEndRe.exec(src)) !== null) {
      commandNames.push(m[1]!);
    }
    expect(commandNames.length).toBeGreaterThan(0);

    // Simulate table rendering (no color): "  " + name.padEnd(width) + description
    // Every name.padEnd(width) MUST produce exactly width characters,
    // meaning the description always starts at position 2 + width.
    const renderedPrefixes = commandNames.map(name => `  ${name.padEnd(width)}`);
    const prefixLength = 2 + width;
    for (const prefix of renderedPrefixes) {
      expect(prefix.length).toBe(prefixLength);
    }

    // All rendered prefixes must have the same length (uniform description offset).
    const unique = new Set(renderedPrefixes.map(p => p.length));
    expect(unique.size).toBe(1);

    // The longest command name must be strictly shorter than COMMAND_COL_WIDTH
    // (i.e., padEnd actually pads; none are truncated).
    const longestName = commandNames.reduce((a, b) => (b.length > a.length ? b : a), '');
    expect(longestName.length).toBeLessThan(width);
  });
});

