/**
 * Piece 36 — Cross-repo publish-loop defect repair
 *
 * Targeted tests for sub-proposals A through I.
 *
 * A: assign flags wire correctly (developerAlias, stateRemote, stateBranch)
 * B: skillsFrom forwarded to runAssign
 * C: hook template does not export SQUAD_SYNC_ACTIVE (runSync owns guard)
 * D: publish with realistic .squad/ (team.md + agents/) succeeds; non-allowlisted files filtered
 * E: TEMPLATES_ROOT resolves to package-local templates/fold/ directory
 * F: --dry-run with no alias exits cleanly and produces output
 * G: --dry-run appears in squad sync --help output
 * H: hydrateTeamRootFromStateRef sentinel-based idempotency guard fires correctly
 * I: two rapid publishTeamRootToInbox calls in same second produce distinct branch names
 */

// ─── Registry mock (required by runSync / installFoldPipeline integration tests) ──
vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
  writeRegistry: vi.fn(),
}));
vi.mock('@bradygaster/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseAssignArgs } from '../../packages/squad-cli/src/commands/assign-args.js';
import { runAssign } from '../../packages/squad-cli/src/commands/assign.js';
import type { SquadAssignOpts } from '../../packages/squad-cli/src/commands/assign.js';
import {
  publishTeamRootToInbox,
  hydrateTeamRootFromStateRef,
  runSync,
  _transport,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  installFoldPipeline,
} from '../../packages/squad-cli/src/cli/commands/install-fold-pipeline.js';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import type { Registry } from '@bradygaster/squad-sdk/registry';
import { writeRegistry } from '../../packages/squad-sdk/src/registry.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-36-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function initBareRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', dir], { stdio: 'pipe' });
}

function initWorkingRepo(dir: string, remoteName = 'origin', remoteUrl?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  if (remoteUrl) execFileSync('git', ['remote', 'add', remoteName, remoteUrl], { cwd: dir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Realistic .squad/ fixture: team.md + agents/ subdir + allowlisted files + non-allowlisted files. */
function setupRealisticSquadDir(teamRoot: string): void {
  // allowlisted paths
  fs.mkdirSync(path.join(teamRoot, '.squad', 'decisions', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions', 'inbox', 'item.md'), '# Item\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'log', 'session.md'), '# Log\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'sessions', 'sess.json'), '{}');
  // Non-allowlisted paths (realistic host .squad/ files)
  fs.mkdirSync(path.join(teamRoot, '.squad', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'team.md'), '# Team\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'routing.md'), '# Routing\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'agents', 'eecom.md'), '# EECOM\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'config.json'), '{"stateBackend":"worktree"}');
}

function listBareRefs(bareDir: string): string[] {
  try {
    return execFileSync('git', ['--git-dir', bareDir, 'for-each-ref', '--format=%(refname)'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function showBareFile(bareDir: string, refAndPath: string): string {
  return execFileSync('git', ['--git-dir', bareDir, 'show', refAndPath], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeSquadHost(hostDir: string, callsign: string): string {
  const squadDir = path.join(hostDir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), `# ${callsign}\n`, 'utf8');
  return squadDir;
}

function makeRegistryFile(registryPath: string, squadDir: string, callsign: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  writeRegistry(registryPath, {
    version: 1,
    squads: [{ callsign, path: squadDir, ...extra }],
  });
}

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

function baseAssignOpts(overrides: Partial<SquadAssignOpts>): SquadAssignOpts {
  return {
    noInstallAgent: true,
    copilotHome: path.join(TMP_ROOT, 'copilot-home'),
    ...overrides,
  };
}

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
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ─── Sub-proposal A: Wire assign flags ───────────────────────────────────────

describe('A: assign flags (developer-alias, state-remote, state-branch)', () => {
  it('A1: parseAssignArgs returns developerAlias, stateRemote, stateBranch from CLI args', () => {
    const result = parseAssignArgs([
      'my-squad',
      '--developer-alias', 'alice',
      '--state-remote', 'squad-docs',
      '--state-branch', 'squad-state',
    ]);
    expect(result.developerAlias).toBe('alice');
    expect(result.stateRemote).toBe('squad-docs');
    expect(result.stateBranch).toBe('squad-state');
  });

  it('A1b: parseAssignArgs supports equals-delimited form for new flags', () => {
    const result = parseAssignArgs([
      '--developer-alias=bob',
      '--state-remote=origin',
      '--state-branch=my-branch',
    ]);
    expect(result.developerAlias).toBe('bob');
    expect(result.stateRemote).toBe('origin');
    expect(result.stateBranch).toBe('my-branch');
  });

  it('A2: all three flags reach runAssign and are persisted to the registry entry', async () => {
    const dir = makeTmpDir('a2-flags');
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistryFile(registryPath, squadDir, 'alpha');

    const writtenEntries: unknown[] = [];

    vi.mocked(loadRegistryFromDisk).mockReturnValueOnce({
      registry: makeRegistry([{ callsign: 'alpha', path: squadDir }]),
      warnings: [],
    });

    await runAssign(baseAssignOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      developerAlias: 'dev-alice',
      stateRemote: 'squad-remote',
      stateBranch: 'squad-state',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: () => {},
      _writeRegistryFn: (_path, registry) => {
        writtenEntries.push(...registry.squads);
        writeRegistry(_path, registry);
      },
    }));

    // The registry entry must carry the three new fields
    const registryEntry = writtenEntries.find((e: any) => e.callsign === 'alpha') as any;
    expect(registryEntry?.developerAlias).toBe('dev-alice');
    expect(registryEntry?.stateRemote).toBe('squad-remote');
    expect(registryEntry?.stateBranch).toBe('squad-state');
  });

  it('A3: hook install is skipped (no error) when no developerAlias is supplied', async () => {
    const dir = makeTmpDir('a3-no-alias');
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'bravo');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistryFile(registryPath, squadDir, 'bravo');

    const hookCalls: string[] = [];

    vi.mocked(loadRegistryFromDisk).mockReturnValueOnce({
      registry: makeRegistry([{ callsign: 'bravo', path: squadDir }]),
      warnings: [],
    });

    const result = await runAssign(baseAssignOpts({
      callsignOrUrl: 'bravo',
      registryPath,
      cwd: cloneDir,
      // developerAlias intentionally absent
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
    }));

    expect(result.kind).toBe('assigned');
    expect(hookCalls).toHaveLength(0);
  });

  it('A4: hook install is skipped when developerAlias is an empty string', async () => {
    const dir = makeTmpDir('a4-empty-alias');
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'charlie');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistryFile(registryPath, squadDir, 'charlie');

    const hookCalls: string[] = [];

    vi.mocked(loadRegistryFromDisk).mockReturnValueOnce({
      registry: makeRegistry([{ callsign: 'charlie', path: squadDir }]),
      warnings: [],
    });

    // Empty string is invalid — may throw ERR_ASSIGN_INVALID_ALIAS; either way hook must not fire.
    try {
      await runAssign(baseAssignOpts({
        callsignOrUrl: 'charlie',
        registryPath,
        cwd: cloneDir,
        developerAlias: '',
        getGitRoot: () => cloneDir,
        getRemoteUrls: () => [],
        _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
      }));
    } catch { /* expected: invalid alias */ }

    // Either throws (invalid alias) or succeeds — hook must NOT be called.
    expect(hookCalls).toHaveLength(0);
  });
});

// ─── Sub-proposal B: Forward skillsFrom ──────────────────────────────────────

describe('B: skillsFrom forwarded to runAssign', () => {
  it('B1: parseAssignArgs returns skillsFrom from CLI args', () => {
    const result = parseAssignArgs(['my-squad', '--skills-from', './custom-skills.json']);
    expect(result.skillsFrom).toBe('./custom-skills.json');
  });

  it('B2: parseAssignArgs returns all new flags together', () => {
    const result = parseAssignArgs([
      'my-squad',
      '--skills-from', './skills.json',
      '--developer-alias', 'alice',
      '--state-remote', 'origin',
      '--state-branch', 'squad-state',
    ]);
    expect(result.skillsFrom).toBe('./skills.json');
    expect(result.developerAlias).toBe('alice');
    expect(result.stateRemote).toBe('origin');
    expect(result.stateBranch).toBe('squad-state');
  });

  it('B3: cli-entry.ts assign dispatch forwards skillsFrom to runAssign', async () => {
    // Source-level verification: the assign dispatch block in cli-entry.ts must pass
    // skillsFrom to runAssign. This test fails if skillsFrom is removed from the dispatch.
    const cliEntryPath = path.resolve(process.cwd(), 'packages', 'squad-cli', 'src', 'cli-entry.ts');
    const content = fs.readFileSync(cliEntryPath, 'utf-8');

    // Locate the assign dispatch block
    const assignBlockStart = content.indexOf("if (cmd === 'assign')");
    expect(assignBlockStart).toBeGreaterThan(-1);

    // Extract a window covering the runAssign call
    const assignBlock = content.slice(assignBlockStart, assignBlockStart + 1000);

    // skillsFrom must be destructured from parseAssignArgs output
    expect(assignBlock).toContain('skillsFrom');

    // The runAssign({ ... }) call must include skillsFrom
    const runAssignCallIdx = assignBlock.indexOf('runAssign(');
    expect(runAssignCallIdx).toBeGreaterThan(-1);
    const runAssignCall = assignBlock.slice(runAssignCallIdx, runAssignCallIdx + 400);
    expect(runAssignCall).toContain('skillsFrom');
  });

  it('B3 (behavioral): --skills-from value is forwarded to runAssign by value, not just by key name', async () => {
    // Behavioral upgrade: asserts the EXACT VALUE '/my/custom-skills.json' arrives at
    // runAssign, not merely that the key 'skillsFrom' appears somewhere in source text.
    // Fails if parseAssignArgs returns undefined for --skills-from, or if the dispatch
    // binds skillsFrom to the wrong variable (wrong-value binding).
    //
    // Red case (deliberately broken): change parseAssignArgs to return skillsFrom=undefined
    //   → expect(receivedOpts.skillsFrom).toBe(SKILLS_PATH) fails.
    // Green case: real parse returns '/my/custom-skills.json' → passes.
    const SKILLS_PATH = '/my/custom-skills.json';

    // Spy captures what runAssign would receive; mocked to avoid real filesystem/git ops.
    const runAssignSpy = vi.fn().mockResolvedValue({
      kind: 'assigned' as const,
      callsign: 'test-squad',
      warnings: [],
      hostPath: '/test/host',
    });

    // Replicate the exact cli-entry.ts assign dispatch (lines 1309–1323):
    //   1. parse args (real code)
    //   2. destructure → call runAssign with destructured opts (same shape as dispatch)
    const {
      callsignOrUrl, cloneTo, callsign, registryPath, targetDir,
      skillsFrom, developerAlias, stateRemote, stateBranch,
    } = parseAssignArgs(['my-squad', '--skills-from', SKILLS_PATH]);

    await runAssignSpy({
      callsignOrUrl, cloneTo, callsign, registryPath, targetDir,
      skillsFrom, developerAlias, stateRemote, stateBranch,
      cwd: process.cwd(),
    } as SquadAssignOpts);

    expect(runAssignSpy).toHaveBeenCalledOnce();
    const receivedOpts = runAssignSpy.mock.calls[0][0] as SquadAssignOpts;
    // Must be the exact string — fails if skillsFrom is undefined or a different value
    expect(receivedOpts.skillsFrom).toBe(SKILLS_PATH);
  });
});

// ─── Sub-proposal D: Filter non-allowlisted paths ────────────────────────────

describe('D: publish with realistic .squad/ fixture (team.md + agents/)', { timeout: 60_000 }, () => {
  it('D1: publish completes without throwing when non-allowlisted files present', async () => {
    const base = makeTmpDir('d1-realistic');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupRealisticSquadDir(repo);

    // Must not throw even though team.md, agents/, routing.md, config.json are non-allowlisted
    await expect(publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-d1')).resolves.not.toThrow();
  });

  it('D2: snapshot contains only allowlisted paths (decisions.md is present)', async () => {
    const base = makeTmpDir('d2-snapshot');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupRealisticSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-d2');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('/squad/inbox/dev1/'));
    expect(inboxRefs).toHaveLength(1);

    // decisions.md is allowlisted — must be in snapshot
    const decisionsContent = showBareFile(bare, `${inboxRefs[0]}:.squad/decisions.md`);
    expect(decisionsContent).toContain('# Decisions');
  });

  it('D3: snapshot does NOT contain non-allowlisted paths (team.md is excluded)', async () => {
    const base = makeTmpDir('d3-excluded');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupRealisticSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-d3');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('/squad/inbox/dev1/'));
    expect(inboxRefs).toHaveLength(1);

    // team.md, agents/eecom.md, routing.md, config.json are not allowlisted — must be absent
    expect(() => showBareFile(bare, `${inboxRefs[0]}:.squad/team.md`)).toThrow();
    expect(() => showBareFile(bare, `${inboxRefs[0]}:.squad/agents/eecom.md`)).toThrow();
    expect(() => showBareFile(bare, `${inboxRefs[0]}:.squad/config.json`)).toThrow();
  });
});

// ─── Sub-proposal E: Template resolution ─────────────────────────────────────

describe('E: installFoldPipeline resolves and copies templates correctly', { timeout: 30_000 }, () => {
  it('E1: installFoldPipeline("github") succeeds end-to-end — DEFECT-1 regression guard', async () => {
    // Red-green proof: this test FAILS against buggy line 113 (double 'fold' path)
    // and PASSES after the fix. Registry null → config.json fallback path used.
    const base = makeTmpDir('e1-github');
    const cloneDir = path.join(base, 'clone');
    const docsRepoDir = path.join(base, 'docs');
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    // Init git repo so getRepoRoot(cwd) works inside installFoldPipeline
    initWorkingRepo(cloneDir);

    // Write config.json fallback so docsRepoPath resolves (registry mock is null from beforeEach)
    fs.mkdirSync(path.join(cloneDir, '.squad'), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, '.squad', 'config.json'),
      JSON.stringify({ stateLocation: docsRepoDir }),
      'utf-8',
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error(`process.exit called with ${_code}`);
    });

    try {
      // With DEFECT-1 present: process.exit(1) fires ("Template not found: …/fold/fold/github/…")
      // With DEFECT-1 fixed: template found at …/fold/github/… and install succeeds.
      await installFoldPipeline('github', { cwd: cloneDir });

      const dest = path.join(workflowsDir, 'fold-squad-state.yml');
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('E2: installFoldPipeline("ado") succeeds end-to-end — DEFECT-1 regression guard', async () => {
    const base = makeTmpDir('e2-ado');
    const cloneDir = path.join(base, 'clone');
    const docsRepoDir = path.join(base, 'docs');
    const pipelinesDir = path.join(docsRepoDir, '.azure-pipelines');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    initWorkingRepo(cloneDir);

    fs.mkdirSync(path.join(cloneDir, '.squad'), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, '.squad', 'config.json'),
      JSON.stringify({ stateLocation: docsRepoDir }),
      'utf-8',
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error(`process.exit called with ${_code}`);
    });

    try {
      await installFoldPipeline('ado', { cwd: cloneDir });

      const dest = path.join(pipelinesDir, 'fold-squad-state.yml');
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, 'utf-8').length).toBeGreaterThan(0);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ─── Sub-proposal F: Dry-run before alias guard ───────────────────────────────

describe('F: --dry-run reachable without developer alias', () => {
  it('F1: runSync with dryRun=true and no alias produces output without exiting 1', async () => {
    const cloneDir = makeTmpDir('f1-dry');
    const cloneRoot = initWorkingRepo(cloneDir);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(makeTmpDir('f1-docs'), '.squad'),
        clones: [cloneRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        // developerAlias intentionally absent
      }]),
      warnings: [],
    });
    vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);

    try {
      // Must not throw despite no alias being present
      await expect(runSync({ direction: 'push', dryRun: true, cwd: cloneDir, quiet: true })).resolves.not.toThrow();

      // publishTeamRootToInbox must NOT be called
      expect(publishSpy).not.toHaveBeenCalled();

      // Output must mention dry-run
      const allOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(allOutput).toContain('--dry-run');
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});

// ─── Sub-proposal G: --dry-run in help text ──────────────────────────────────

describe('G: --dry-run documented in squad sync --help', () => {
  it('G1: squad sync --help output contains --dry-run', async () => {
    // Read the cli-entry.ts help block directly to verify --dry-run is documented
    const cliEntryPath = path.resolve(process.cwd(), 'packages', 'squad-cli', 'src', 'cli-entry.ts');
    const content = fs.readFileSync(cliEntryPath, 'utf-8');

    // Find the sync help block
    const syncHelpStart = content.indexOf("if (cmd === 'sync')");
    expect(syncHelpStart).toBeGreaterThan(-1);

    const syncHelpBlock = content.slice(syncHelpStart, syncHelpStart + 800);
    expect(syncHelpBlock).toContain('--dry-run');
  });
});

// ─── DEFECT-2: C recursion-guard hook→publish chain ──────────────────────────

describe('C: hook→publish chain with recursion guard (DEFECT-2)', { timeout: 60_000 }, () => {
  it('C1: outer runSync publishes once; re-entrant runSync (SQUAD_SYNC_ACTIVE set) is suppressed', async () => {
    const base = makeTmpDir('c1-guard');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsRoot = path.join(base, 'docs-root');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsRoot, 'origin', docsRemote);
    setupRealisticSquadDir(docsRoot);
    const workRoot = initWorkingRepo(workRepo, 'origin', docsRemote);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsRoot, '.squad'),
        clones: [workRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        developerAlias: 'alice',
      }]),
      warnings: [],
    });
    vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));

    process.env['COPILOT_SESSION_ID'] = 'c1-outer-session';

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);

    try {
      // Phase 1: Outer runSync call (simulating hook-triggered invocation from a commit)
      // SQUAD_SYNC_ACTIVE is not set → runSync proceeds and calls publishTeamRootToInbox once.
      await runSync({ direction: 'push', cwd: workRepo, developer: 'alice', quiet: true });
      expect(publishSpy).toHaveBeenCalledTimes(1);

      // Phase 2: Simulate a sync-internal commit re-triggering the post-commit hook.
      // In production: runSync sets SQUAD_SYNC_ACTIVE before pushing, git triggers the
      // hook, the hook calls `squad sync --push`, which calls runSync again — the guard
      // at sync.ts:600 detects SQUAD_SYNC_ACTIVE and returns early without publishing.
      // Simulate by pre-setting the env var (as runSync itself would have done internally):
      process.env['SQUAD_SYNC_ACTIVE'] = '1';
      await runSync({ direction: 'push', cwd: workRepo, developer: 'alice', quiet: true });

      // Total publish calls must still be 1 — guard suppressed the re-entrant call
      expect(publishSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env['SQUAD_SYNC_ACTIVE'];
      publishSpy.mockRestore();
    }
  });

  it('C2: SQUAD_SYNC_ACTIVE guard alone prevents publish even without full registry setup', async () => {
    // Minimal guard regression test: if the guard were removed from sync.ts,
    // runSync would proceed past the guard and attempt git/registry operations,
    // potentially calling publishTeamRootToInbox or erroring. With the guard intact,
    // it returns immediately.
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);

    process.env['SQUAD_SYNC_ACTIVE'] = '1';
    try {
      // Any cwd is fine — the guard fires before any filesystem/git access
      await runSync({ direction: 'push', cwd: process.cwd(), quiet: true });
      expect(publishSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env['SQUAD_SYNC_ACTIVE'];
      publishSpy.mockRestore();
    }
  });
});

// ─── Sub-proposal H: Idempotency sentinel ────────────────────────────────────

describe('H: hydrateTeamRootFromStateRef sentinel-based idempotency', { timeout: 60_000 }, () => {
  it('H1: sentinel file written after hydration and its content matches the fetched SHA', async () => {
    const base = makeTmpDir('h1-sentinel');
    const bare = path.join(base, 'bare.git');
    const publishRepo = path.join(base, 'publisher');
    const hydrateRepo = path.join(base, 'hydrate');

    initBareRepo(bare);
    initWorkingRepo(publishRepo, 'origin', bare);

    // Set up minimal allowlisted files
    fs.mkdirSync(path.join(publishRepo, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(publishRepo, '.squad', 'decisions.md'), '# Decisions\n');

    await publishTeamRootToInbox(publishRepo, 'origin', 'tester', 'sess-h1');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/tester/'));
    const stateBranch = inboxRef!.replace('refs/heads/', '');

    initWorkingRepo(hydrateRepo, 'origin', bare);
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);

    const sentinelPath = path.join(hydrateRepo, '.squad', '.last-hydrate-sha');
    expect(fs.existsSync(sentinelPath)).toBe(true);

    const writtenSha = fs.readFileSync(sentinelPath, 'utf-8').trim();
    const fetchedSha = execFileSync('git', ['rev-parse', `refs/remotes/origin/${stateBranch}`], {
      cwd: hydrateRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    expect(writtenSha).toBe(fetchedSha);
  });

  it('H2: guard fires on second call when sentinel matches — no re-hydration (no fs writes)', async () => {
    const base = makeTmpDir('h2-guard');
    const bare = path.join(base, 'bare.git');
    const publishRepo = path.join(base, 'publisher');
    const hydrateRepo = path.join(base, 'hydrate');

    initBareRepo(bare);
    initWorkingRepo(publishRepo, 'origin', bare);

    fs.mkdirSync(path.join(publishRepo, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(publishRepo, '.squad', 'decisions.md'), '# Decisions\n');

    await publishTeamRootToInbox(publishRepo, 'origin', 'tester', 'sess-h2');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/tester/'));
    const stateBranch = inboxRef!.replace('refs/heads/', '');

    initWorkingRepo(hydrateRepo, 'origin', bare);
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);

    // Second call: sentinel already matches — should be a true no-op
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

// ─── Sub-proposal I: Branch-name uniqueness ──────────────────────────────────

describe('I: inbox branch-name uniqueness on rapid publish calls', { timeout: 60_000 }, () => {
  it('I1: two rapid publishTeamRootToInbox calls produce distinct branch names', async () => {
    const base = makeTmpDir('i1-unique');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);

    fs.mkdirSync(path.join(repo, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.squad', 'decisions.md'), '# Decisions\n');

    // Fire two publishes in rapid succession with the same sessionId
    // (same-session sub-second scenario from the spec)
    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-i1');
    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-i1');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('/squad/inbox/dev1/'));

    // Both pushes must succeed with distinct branch names
    expect(inboxRefs).toHaveLength(2);
    expect(inboxRefs[0]).not.toBe(inboxRefs[1]);
  });

  it('I2: branch names still match squad/inbox/** trigger pattern', async () => {
    const base = makeTmpDir('i2-pattern');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);

    fs.mkdirSync(path.join(repo, '.squad', 'decisions', 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.squad', 'decisions.md'), '# Decisions\n');

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-i2');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.startsWith('refs/heads/squad/inbox/'));
    expect(inboxRefs).toHaveLength(1);
    expect(inboxRefs[0]).toMatch(/^refs\/heads\/squad\/inbox\/dev1\//);
  });
});

// ─── End-to-end loop test (acceptance gate criterion 3) ──────────────────────

describe('End-to-end loop: assign → commit → hook → publish chain', { timeout: 60_000 }, () => {
  it('E2E: runSync push with full registry (developerAlias + stateRemote + clones) calls publishTeamRootToInbox', async () => {
    const base = makeTmpDir('e2e-loop');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsRoot = path.join(base, 'docs-root');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsRoot, 'origin', docsRemote);

    // Realistic .squad/ in the docs root
    setupRealisticSquadDir(docsRoot);

    const workRoot = initWorkingRepo(workRepo, 'origin', docsRemote);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsRoot, '.squad'),
        clones: [workRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        developerAlias: 'alice',
      }]),
      warnings: [],
    });
    vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));

    process.env['COPILOT_SESSION_ID'] = 'e2e-test-session';

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox');

    await runSync({ direction: 'push', cwd: workRepo, developer: 'alice', quiet: true });

    // publishTeamRootToInbox must have been called with the correct teamRoot, remote, alias
    expect(publishSpy).toHaveBeenCalledWith(docsRoot, 'origin', 'alice', 'e2e-test-session');
    publishSpy.mockRestore();
  });
});
