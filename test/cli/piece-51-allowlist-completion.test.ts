/**
 * Piece 51 — Publish-allowlist completion and team-root state hygiene.
 *
 * Sub-proposals:
 *   A  — extend the publish allowlist for unambiguous append-only state
 *   B1 — per-agent history folds; per-agent charter does NOT
 *   C  — machine-local scratch declared; publish-history.json excluded from the fold
 *   D  — install-fold-pipeline installs the allowlist-aware managed .gitignore
 *   E1 — casting registries fold (last-writer-wins) and converge
 */

// ─── Registry mock (required by installFoldPipeline resolution) ───────────────
vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
  writeRegistry: vi.fn(),
}));
vi.mock('@bradygaster/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));
vi.mock('@bradygaster/squad-sdk/validation', () => ({
  INBOX_HANDLE_RE: /^[a-z][a-z0-9-]{1,38}$/,
  CALLSIGN_RE: /^[a-z][a-z0-9-]{1,38}$/,
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  publishTeamRootToInbox,
  hydrateTeamRootFromStateRef,
  isAllowlisted,
  PUBLISH_ALLOWLIST_EXACT,
  PUBLISH_ALLOWLIST_PREFIX,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  applyManagedGitignore,
  managedGitignorePaths,
  PUBLISH_MACHINE_LOCAL,
} from '../../packages/squad-cli/src/cli/commands/allowlist-gitignore.js';
import { installFoldPipeline } from '../../packages/squad-cli/src/cli/commands/install-fold-pipeline.js';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';

// The convergence / fold cases drive real git-integration (init, publish, hydrate across
// clones) and can exceed 30s under load; use a generous per-test timeout to avoid false
// timeout failures on slow runs.
vi.setConfig({ testTimeout: 120_000 });

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-51-tmp');
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

function initSelfHostRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function listBareRefs(bareDir: string): string[] {
  return execFileSync('git', ['--git-dir', bareDir, 'for-each-ref', '--format=%(refname)'], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
}

function listPublishedFiles(bareDir: string, ref: string): string[] {
  return execFileSync('git', ['--git-dir', bareDir, 'ls-tree', '-r', '--name-only', ref], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
}

function write(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** A team root exercising every piece-51 classification category. */
function setupClassificationFixture(teamRoot: string): void {
  // A: unambiguous append-only state (folds)
  write(teamRoot, '.squad/history.md', '# History\nentry-1\n');
  write(teamRoot, '.squad/orchestration-log.md', '# Orchestration\nspawn-1\n');
  write(teamRoot, '.squad/casting-history.json', '{"universe_usage_history":["a"]}');
  write(teamRoot, '.squad/casting-registry.json', '{"reg":1}');
  write(teamRoot, '.squad/casting/registry.json', '{"reg":"nested"}');
  write(teamRoot, '.squad/casting/history.json', '{"nested":true}');
  write(teamRoot, '.squad/files/onboarding/welcome.md', '# Welcome\n');
  // A + shipped allowlist
  write(teamRoot, '.squad/decisions.md', '# Decisions\n');
  write(teamRoot, '.squad/log/session.md', '# Log\n');
  // B1: per-agent history folds; per-agent charter does NOT
  write(teamRoot, '.squad/agents/dev/history.md', '# Dev history\n');
  write(teamRoot, '.squad/agents/dev/charter.md', '# Dev charter (durable)\n');
  // Durable set — must NOT fold (piece 52)
  write(teamRoot, '.squad/team.md', '# Team\n');
  write(teamRoot, '.squad/routing.md', '# Routing\n');
  // C: machine-local scratch / pipeline-owned — must NOT fold
  write(teamRoot, '.squad/raw-agent-output.md', 'scratch');
  write(teamRoot, '.squad/run-output.md', 'scratch');
  write(teamRoot, '.squad/publish-metadata.json', '{"meta":1}');
  write(teamRoot, '.squad/publish-history.json', '{"local":"mutated"}');
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
});

// ─── A + B1 + C + E1: publish snapshot classification ──────────────────────────

describe('A/B1/C/E1: publish snapshot carries the completed ephemeral lane and nothing else', () => {
  it('folds append-only state, casting registries, onboarding, and per-agent history', async () => {
    const base = makeTmpDir('a-snapshot');
    const bare = path.join(base, 'bare.git');
    const publisher = path.join(base, 'publisher');
    initBareRepo(bare);
    initWorkingRepo(publisher, 'origin', bare);
    setupClassificationFixture(publisher);

    await publishTeamRootToInbox(publisher, 'origin', 'tester', 'sess-a');

    const inboxRef = listBareRefs(bare).find(r => r.includes('/squad/inbox/tester/'))!;
    const files = listPublishedFiles(bare, inboxRef.replace('refs/heads/', ''));

    // A + E1 folded
    for (const p of [
      '.squad/history.md',
      '.squad/orchestration-log.md',
      '.squad/casting-history.json',
      '.squad/casting-registry.json',
      '.squad/casting/registry.json',
      '.squad/casting/history.json',
      '.squad/files/onboarding/welcome.md',
      '.squad/decisions.md',
      '.squad/log/session.md',
      // B1
      '.squad/agents/dev/history.md',
    ]) {
      expect(files, `expected ${p} in snapshot`).toContain(p);
    }

    // B1: charter excluded; durable set excluded; machine-local excluded
    for (const p of [
      '.squad/agents/dev/charter.md',
      '.squad/team.md',
      '.squad/routing.md',
      '.squad/raw-agent-output.md',
      '.squad/run-output.md',
      '.squad/publish-history.json',
    ]) {
      expect(files, `expected ${p} absent from snapshot`).not.toContain(p);
    }

    // C nuance: the publish writes its OWN pipeline publish-metadata.json into the
    // snapshot; the developer's local machine-local copy must NOT be the one folded.
    expect(files).toContain('.squad/publish-metadata.json');
    const snapshotMeta = execFileSync(
      'git', ['--git-dir', bare, 'show', `${inboxRef.replace('refs/heads/', '')}:.squad/publish-metadata.json`],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(snapshotMeta).not.toContain('"meta"'); // not the local scratch copy
    expect(snapshotMeta).toContain('baseStateCommit'); // pipeline-generated metadata
  });

  it('C: publish EXCLUDES publish-history.json even when a locally-mutated copy exists', async () => {
    const base = makeTmpDir('c-publish-history');
    const bare = path.join(base, 'bare.git');
    const publisher = path.join(base, 'publisher');
    initBareRepo(bare);
    initWorkingRepo(publisher, 'origin', bare);
    write(publisher, '.squad/decisions.md', '# Decisions\n');
    write(publisher, '.squad/publish-history.json', '{"folded":["should-not-transport"]}');

    await publishTeamRootToInbox(publisher, 'origin', 'tester', 'sess-c');

    const inboxRef = listBareRefs(bare).find(r => r.includes('/squad/inbox/tester/'))!;
    const files = listPublishedFiles(bare, inboxRef.replace('refs/heads/', ''));
    expect(files).toContain('.squad/decisions.md');
    expect(files).not.toContain('.squad/publish-history.json');
  });

  it('B1: isAllowlisted matches per-agent history but not charter', () => {
    expect(isAllowlisted('.squad/agents/dev/history.md')).toBe(true);
    expect(isAllowlisted('.squad/agents/scribe/history.md')).toBe(true);
    expect(isAllowlisted('.squad/agents/dev/charter.md')).toBe(false);
    // must not over-match a nested path
    expect(isAllowlisted('.squad/agents/dev/notes/history.md')).toBe(false);
  });

  it('A: new EXACT/PREFIX entries are present in the shipped constants', () => {
    for (const p of ['.squad/history.md', '.squad/orchestration-log.md', '.squad/casting-history.json', '.squad/casting-registry.json']) {
      expect(PUBLISH_ALLOWLIST_EXACT).toContain(p);
    }
    for (const p of ['.squad/casting/', '.squad/files/onboarding/']) {
      expect(PUBLISH_ALLOWLIST_PREFIX).toContain(p);
    }
  });
});

// ─── A/E1: fold → hydrate convergence (no permanent drift) ─────────────────────

describe('A/E1: publish → hydrate lands the new paths and two clones converge', () => {
  it('hydrate reconstitutes the folded paths with identical content', async () => {
    const base = makeTmpDir('converge');
    const bare = path.join(base, 'bare.git');
    const publisher = path.join(base, 'publisher');
    const hydrate = path.join(base, 'hydrate');
    initBareRepo(bare);
    initWorkingRepo(publisher, 'origin', bare);
    setupClassificationFixture(publisher);

    await publishTeamRootToInbox(publisher, 'origin', 'tester', 'sess-conv');
    const inboxRef = listBareRefs(bare).find(r => r.includes('/squad/inbox/tester/'))!;
    const stateBranch = inboxRef.replace('refs/heads/', '');

    initWorkingRepo(hydrate, 'origin', bare);
    await hydrateTeamRootFromStateRef(hydrate, 'origin', stateBranch);

    const convergePaths = [
      '.squad/history.md',
      '.squad/orchestration-log.md',
      '.squad/casting-history.json',
      '.squad/casting-registry.json',
      '.squad/casting/registry.json',
      '.squad/files/onboarding/welcome.md',
      '.squad/agents/dev/history.md',
    ];
    for (const p of convergePaths) {
      const dst = path.join(hydrate, p);
      expect(fs.existsSync(dst), `expected ${p} hydrated`).toBe(true);
      expect(fs.readFileSync(dst, 'utf-8')).toBe(fs.readFileSync(path.join(publisher, p), 'utf-8'));
    }
    // charter must not have been transported
    expect(fs.existsSync(path.join(hydrate, '.squad/agents/dev/charter.md'))).toBe(false);
  });
});

// ─── C: managed-block content ──────────────────────────────────────────────────

describe('C: machine-local scratch declared in the managed .gitignore set', () => {
  it('managedGitignorePaths includes the machine-local scratch and allowlist paths', () => {
    const paths = managedGitignorePaths();
    for (const p of PUBLISH_MACHINE_LOCAL) expect(paths).toContain(p);
    expect(paths).toContain('.squad/publish-history.json');
    expect(paths).toContain('.squad/history.md');
    // scoped variant prefixes every entry
    expect(managedGitignorePaths('wifi/')).toContain('wifi/.squad/publish-history.json');
    // NEVER a blanket ignore
    expect(paths).not.toContain('.squad/');
    expect(paths).not.toContain('.squad');
  });

  it('applyManagedGitignore writes a marker-delimited block and is idempotent', () => {
    const repo = initSelfHostRepo(makeTmpDir('gitignore-idem'));
    const first = applyManagedGitignore(repo, '');
    expect(first.changed).toBe(true);
    const afterFirst = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
    expect(afterFirst).toContain('# --- squad (managed) ---');
    expect(afterFirst).toContain('# --- end squad (managed) ---');
    expect(afterFirst).toContain('.squad/publish-history.json');
    expect(afterFirst).not.toMatch(/^\.squad\/\s*$/m);

    const second = applyManagedGitignore(repo, '');
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8')).toBe(afterFirst);
  });
});

// ─── D: install-fold-pipeline installs the allowlist .gitignore ────────────────

describe('D: install-fold-pipeline installs the managed .gitignore (no init)', () => {
  it('root host: git add -A stages no folded/hydrated .squad state', async () => {
    const repo = initSelfHostRepo(makeTmpDir('d-root'));
    write(repo, '.squad/team.md', '# Team\n');
    write(repo, '.squad/config.json', '{"stateBackend":"orphan"}');
    // folded/hydrated ephemeral state present but never init-managed
    write(repo, '.squad/history.md', '# History\n');
    write(repo, '.squad/decisions.md', '# Decisions\n');
    write(repo, '.squad/log/session.md', '# Log\n');
    write(repo, '.squad/casting-history.json', '{}');
    write(repo, '.squad/publish-history.json', '{}');

    await installFoldPipeline('github', { cwd: repo });

    expect(fs.existsSync(path.join(repo, '.gitignore'))).toBe(true);
    const gi = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
    expect(gi).toContain('# --- squad (managed) ---');

    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'pipe' });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);

    for (const p of ['.squad/history.md', '.squad/decisions.md', '.squad/log/session.md', '.squad/casting-history.json', '.squad/publish-history.json']) {
      expect(staged, `expected ${p} NOT staged`).not.toContain(p);
    }
  });

  it('subfolder host: blanket ignore is scoped to <callsign>/.squad/ under Pole A', async () => {
    const repo = initSelfHostRepo(makeTmpDir('d-subfolder'));
    write(repo, 'wifi/.squad/team.md', '# Team\n');
    write(repo, 'wifi/.squad/config.json', '{"stateBackend":"orphan"}');
    write(repo, 'wifi/.squad/history.md', '# History\n');
    write(repo, 'wifi/.squad/publish-history.json', '{}');

    await installFoldPipeline('github', { cwd: repo });

    const gi = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
    // Pole A: a single blanket ignore for the whole subfolder .squad, NOT per-path allowlist entries.
    expect(gi).toContain('wifi/.squad/');
    expect(gi).not.toContain('wifi/.squad/history.md');
    expect(gi).not.toContain('wifi/.squad/publish-history.json');

    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'pipe' });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    // Nothing under the subfolder .squad may reach main.
    expect(staged.some(p => p.startsWith('wifi/.squad/'))).toBe(false);
  });

  it('non-orphan host: no managed block is written', async () => {
    const repo = initSelfHostRepo(makeTmpDir('d-worktree'));
    write(repo, '.squad/team.md', '# Team\n');
    write(repo, '.squad/config.json', '{"stateBackend":"worktree"}');
    write(repo, '.squad/history.md', '# History\n');

    await installFoldPipeline('github', { cwd: repo });

    const giPath = path.join(repo, '.gitignore');
    const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf-8') : '';
    expect(gi).not.toContain('# --- squad (managed) ---');
  });

  it('multi-callsign subfolder host: each callsign is gated on its OWN backend', async () => {
    // alpha is orphan (must be isolated); bravo is local/non-orphan (must NOT be touched).
    // A registry entry describes only bravo — the buggy path would reuse bravo's backend
    // for alpha too, skipping alpha (D leak stays open) and/or untracking bravo.
    const repo = initSelfHostRepo(makeTmpDir('d-multi'));
    write(repo, 'alpha/.squad/team.md', '# Team\n');
    write(repo, 'alpha/.squad/config.json', '{"stateBackend":"orphan"}');
    write(repo, 'alpha/.squad/history.md', '# History\n');
    write(repo, 'bravo/.squad/team.md', '# Team\n');
    write(repo, 'bravo/.squad/config.json', '{"stateBackend":"local"}');
    write(repo, 'bravo/.squad/history.md', '# History\n');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: {
        squads: [{
          handle: 'bravo',
          callsign: 'bravo',
          path: path.join(repo, 'bravo', '.squad'),
          clones: [repo],
          stateBackend: 'local',
        }],
      },
      warnings: [],
    } as unknown as ReturnType<typeof loadRegistryFromDisk>);

    await installFoldPipeline('github', { cwd: repo });

    const gi = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
    // alpha (orphan) MUST be isolated even though the registry entry is bravo's — Pole A blanket.
    expect(gi, 'alpha (orphan) must receive the blanket block').toContain('alpha/.squad/');
    // bravo (local/non-orphan) MUST NOT be added to the managed ignore.
    expect(gi, 'bravo (non-orphan) must not be gitignored').not.toContain('bravo/.squad/');

    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'pipe' });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    expect(staged, 'alpha orphan state must not be staged').not.toContain('alpha/.squad/history.md');
    // bravo, being non-orphan, is intentionally left tracked/stageable.
    expect(staged, 'bravo non-orphan state stays tracked').toContain('bravo/.squad/history.md');
  });
});
