/**
 * Piece 55 — managed consumer clone & one-command cold-start.
 *
 * Covers sub-proposals A (flag-driven cold-start identity), B (managed host clone + registry
 * `managed`), C (orphan-branch hydrate in cold-start), and D (auto-wire after first hydrate). The
 * git-integration cases seed a bare remote carrying `squad/config/<cs>` + `squad/state/<cs>` orphans
 * and drive the real cold-start; the clone uses the G1 blobless fetch shape.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { initSquad } from '@wifi-aware/squad-sdk';
import { seedConfigOrphan, runSync, hydrateTeamRootFromConfigRef } from '../../packages/squad-cli/src/cli/commands/sync.js';
import { runAssign, AssignError } from '../../packages/squad-cli/src/commands/assign.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-55-tmp');
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
  // G1: allow the blobless partial clone against a local file-transport bare remote.
  execFileSync('git', ['--git-dir', dir, 'config', 'uploadpack.allowFilter', 'true'], { stdio: 'pipe' });
  execFileSync('git', ['--git-dir', dir, 'config', 'uploadpack.allowAnySHA1InWant', 'true'], { stdio: 'pipe' });
}

function initWorkingRepo(dir: string, remoteUrl?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'dev@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  if (remoteUrl) execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir, stdio: 'pipe' });
  return dir;
}

async function scaffold(teamRoot: string): Promise<void> {
  await initSquad({
    teamRoot,
    projectName: 'piece55-probe',
    agents: [{ name: 'dev', role: 'Core Dev' }, { name: 'lead', role: 'Lead' }],
    configFormat: 'json',
  });
}

/** Create an orphan branch carrying exactly `files` (relative → content) and push it to the bare. */
function seedOrphanBranch(seedRepo: string, branch: string, files: Record<string, string>, force = false): void {
  // Re-seed support: if the local branch already exists, detach HEAD and delete it so
  // `checkout --orphan` can recreate it with a fresh, unrelated history.
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: seedRepo, stdio: 'pipe' });
    execFileSync('git', ['checkout', '--detach'], { cwd: seedRepo, stdio: 'pipe' });
    execFileSync('git', ['branch', '-D', branch], { cwd: seedRepo, stdio: 'pipe' });
  } catch { /* branch absent — first seed */ }
  execFileSync('git', ['checkout', '--orphan', branch], { cwd: seedRepo, stdio: 'pipe' });
  execFileSync('git', ['rm', '-rf', '--cached', '.'], { cwd: seedRepo, stdio: 'pipe' });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(seedRepo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    execFileSync('git', ['add', '-f', '--', rel], { cwd: seedRepo, stdio: 'pipe' });
  }
  execFileSync('git', ['commit', '-m', `seed ${branch}`], { cwd: seedRepo, stdio: 'pipe' });
  const spec = force ? `+HEAD:refs/heads/${branch}` : `HEAD:refs/heads/${branch}`;
  execFileSync('git', ['push', 'origin', spec], { cwd: seedRepo, stdio: 'pipe' });
}

function normPath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function readFileMaybe(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

afterAll(() => {
  for (const dir of FIXTURE_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ─── A — flag-driven cold-start identity (routing) ──────────────────────────────

describe('piece 55 — A: flag-driven managed cold-start routing', () => {
  it('A1 --callsign without any resolvable state remote teaches the managed cold-start form', async () => {
    // Piece 58 §B: with no --state-remote, no SQUAD_STATE_REMOTE, and no registry.defaults.stateRemote,
    // `--callsign` alone still cannot onboard — teach the (now callsign-first) form.
    const iso = { registryPath: path.join(makeTmpDir('a1-reg'), 'registry.json'), env: {} };
    await expect(runAssign({ callsign: 'probe', cwd: makeTmpDir('a1'), ...iso })).rejects.toMatchObject({
      code: 'ERR_ASSIGN_MANAGED_MISSING_IDENTITY',
    });
    await expect(runAssign({ callsign: 'probe', cwd: makeTmpDir('a1b'), ...iso })).rejects.toThrow(/--state-remote/);
  });

  it('A2 managed cold-start rejects a non-host --skills-from', async () => {
    await expect(runAssign({
      callsign: 'probe',
      stateRemote: makeTmpDir('a2-remote'),
      stateBranch: 'squad/state/probe',
      skillsFrom: 'clone',
      registryPath: path.join(makeTmpDir('a2-home'), 'registry.json'),
      cwd: makeTmpDir('a2'),
    })).rejects.toMatchObject({ code: 'ERR_ASSIGN_INVALID_SKILLS_SOURCE' });
  });

  it('A3 existing shapes preserved: no callsign + no positional → ERR_ASSIGN_MISSING_ARG', async () => {
    await expect(runAssign({ cwd: makeTmpDir('a3') })).rejects.toMatchObject({ code: 'ERR_ASSIGN_MISSING_ARG' });
  });

  it('A4 existing shapes preserved: URL positional without --clone-to still teaches --clone-to', async () => {
    await expect(runAssign({ callsignOrUrl: 'https://example.com/x.git', cwd: makeTmpDir('a4') }))
      .rejects.toMatchObject({ code: 'ERR_ASSIGN_URL_WITHOUT_CLONE_TO' });
  });
});

// ─── B/C/D — managed clone, orphan hydrate, auto-wire (git-integration) ─────────

describe('piece 55 — B/C/D: managed cold-start hydrate + wire', { timeout: 60_000 }, () => {
  it('C1 hydrates state+config orphans into ~/.squad/hosts/<cs>/.squad and writes a managed entry', async () => {
    const bare = makeTmpDir('c1-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('c1-seed'), bare);
    await scaffold(seed);
    // Durable config orphan carries team.md; ephemeral state orphan carries a log entry.
    await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed, 'squad/state/probe', { '.squad/log/session.md': '# session\n' });

    const home = makeTmpDir('c1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const runUpgradeFn = vi.fn(async () => {});
    const installCrossRepoHookFn = vi.fn(() => {});

    const result = await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: makeTmpDir('c1-cwd'), noBind: true,
      _runUpgradeFn: runUpgradeFn,
      _installCrossRepoHookFn: installCrossRepoHookFn,
    });

    expect(result.kind).toBe('assigned');
    if (result.kind !== 'assigned') return;
    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    expect(result.managed).toBe(true);
    expect(result.managedHostPath).toBe(managedProjectDir);
    expect(result.stateHydrated).toBe(true);
    expect(result.configHydrated).toBe(true);
    expect(result.wired).toBe(true);

    // Managed clone exists; team.md + both sentinels landed in the managed team root.
    expect(fs.existsSync(path.join(managedProjectDir, '.git'))).toBe(true);
    expect(readFileMaybe(path.join(managedProjectDir, '.squad', 'team.md'))).not.toBeNull();
    expect(readFileMaybe(path.join(managedProjectDir, '.squad', '.last-hydrate-sha'))).not.toBeNull();
    expect(readFileMaybe(path.join(managedProjectDir, '.squad', '.last-config-hydrate-sha'))).not.toBeNull();

    // Auto-wire ran against the managed project directory.
    expect(runUpgradeFn).toHaveBeenCalledWith(managedProjectDir);
    expect(installCrossRepoHookFn).toHaveBeenCalledWith(managedProjectDir);

    // Registry entry recorded as managed with the resolved identity.
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect(entry.managed).toBe(true);
    expect(entry.path).toBe(path.join(managedProjectDir, '.squad'));
    expect(entry.stateBranch).toBe('squad/state/probe');
    expect(entry.configBranch).toBe('squad/config/probe');
    expect(entry.inboxHandle).toBe('dev1');
  });

  it('C2 a second run is idempotent (managed entry re-hydrates, one clone per callsign)', async () => {
    const bare = makeTmpDir('c2-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('c2-seed'), bare);
    await scaffold(seed);
    await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed, 'squad/state/probe', { '.squad/log/session.md': '# s\n' });

    const home = makeTmpDir('c2-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const common = {
      callsign: 'probe', stateRemote: bare, stateBranch: 'squad/state/probe',
      skillsFrom: 'host' as const, home, registryPath, noBind: true,
      _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}),
    };
    await runAssign({ ...common, cwd: makeTmpDir('c2-cwd1') });
    const r2 = await runAssign({ ...common, cwd: makeTmpDir('c2-cwd2') });

    expect(r2.kind).toBe('assigned');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    expect(registry.squads.filter((s: { callsign?: string }) => s.callsign === 'probe')).toHaveLength(1);
  });

  it('C3 fails fast naming the remote + both branches when the orphans carry no team.md', async () => {
    const bare = makeTmpDir('c3-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('c3-seed'), bare);
    // Neither orphan carries team.md.
    seedOrphanBranch(seed, 'squad/config/probe', { '.squad/routing.md': '# routing\n' });
    seedOrphanBranch(seed, 'squad/state/probe', { '.squad/log/session.md': '# s\n' });

    const home = makeTmpDir('c3-home');
    let err: unknown;
    try {
      await runAssign({
        callsign: 'probe', stateRemote: bare, stateBranch: 'squad/state/probe',
        skillsFrom: 'host', home, registryPath: path.join(home, '.squad', 'registry.json'),
        cwd: makeTmpDir('c3-cwd'), noBind: true,
        _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(AssignError);
    expect((err as AssignError).code).toBe('ERR_ASSIGN_MANAGED_NO_TEAM_MD');
    expect((err as Error).message).toMatch(/squad\/state\/probe/);
    expect((err as Error).message).toMatch(/squad\/config\/probe/);
    // Failed onboarding leaves no dangling registry entry.
    const registryPath = path.join(home, '.squad', 'registry.json');
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      expect(registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe')).toBeUndefined();
    }
  });
});

// ─── Piece 58 §B — assign ergonomics: derived/defaulted/system-wide identity ─────

describe('piece 58 §B — assign --callsign ergonomics', { timeout: 90_000 }, () => {
  async function seedOrphans(seed: string): Promise<void> {
    await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed, 'squad/state/probe', { '.squad/log/session.md': '# session\n' });
  }

  it('B1 --callsign with SQUAD_STATE_REMOTE derives the full managed identity', async () => {
    const bare = makeTmpDir('b1-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('b1-seed'), bare);
    await scaffold(seed);
    await seedOrphans(seed);

    const home = makeTmpDir('b1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const result = await runAssign({
      callsign: 'probe',
      home,
      registryPath,
      cwd: makeTmpDir('b1-cwd'),
      noBind: true,
      env: { SQUAD_STATE_REMOTE: bare, SQUAD_INBOX_HANDLE: 'dev1' },
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    expect(result.kind).toBe('assigned');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect(entry.managed).toBe(true);
    expect(entry.stateRemote).toBe(bare);
    expect(entry.stateBranch).toBe('squad/state/probe');
    expect(entry.configBranch).toBe('squad/config/probe');
    expect(entry.inboxHandle).toBe('dev1');
  });

  it('B2 --callsign with registry.defaults.stateRemote (H1) derives the managed identity', async () => {
    const bare = makeTmpDir('b2-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('b2-seed'), bare);
    await scaffold(seed);
    await seedOrphans(seed);

    const home = makeTmpDir('b2-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    // Pre-seed a system-wide default state remote (decision H1).
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads: [], defaults: { stateRemote: bare } }, null, 2));

    const result = await runAssign({
      callsign: 'probe',
      home,
      registryPath,
      cwd: makeTmpDir('b2-cwd'),
      noBind: true,
      env: { SQUAD_INBOX_HANDLE: 'dev2' },
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    expect(result.kind).toBe('assigned');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    // The system-wide default is preserved across the write.
    expect(registry.defaults.stateRemote).toBe(bare);
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect(entry.stateRemote).toBe(bare);
    expect(entry.stateBranch).toBe('squad/state/probe');
    expect(entry.configBranch).toBe('squad/config/probe');
    expect(entry.inboxHandle).toBe('dev2');
  });

  it('B3 the full explicit form yields a registry entry identical to the short form', async () => {
    const bare = makeTmpDir('b3-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('b3-seed'), bare);
    await scaffold(seed);
    await seedOrphans(seed);

    const home = makeTmpDir('b3-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const seams = { home, registryPath, noBind: true, _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}) };

    // Short form.
    await runAssign({ callsign: 'probe', cwd: makeTmpDir('b3-cwd1'), env: { SQUAD_STATE_REMOTE: bare, SQUAD_INBOX_HANDLE: 'dev1' }, ...seams });
    const entryShort = JSON.parse(fs.readFileSync(registryPath, 'utf-8')).squads.find((s: { callsign?: string }) => s.callsign === 'probe');

    // Full explicit form — idempotent re-run against the same managed host must produce an
    // identical entry (proves the short form derives exactly the explicit values).
    await runAssign({
      callsign: 'probe',
      cwd: makeTmpDir('b3-cwd2'),
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      configBranch: 'squad/config/probe',
      inboxHandle: 'dev1',
      skillsFrom: 'host',
      env: {},
      ...seams,
    });
    const entryExplicit = JSON.parse(fs.readFileSync(registryPath, 'utf-8')).squads.find((s: { callsign?: string }) => s.callsign === 'probe');

    expect(entryExplicit).toEqual(entryShort);
  });

  it('B4 --callsign with no resolvable state remote fails naming all three sources', async () => {
    const home = makeTmpDir('b4-home');
    let err: unknown;
    try {
      await runAssign({
        callsign: 'probe',
        home,
        registryPath: path.join(home, '.squad', 'registry.json'),
        cwd: makeTmpDir('b4-cwd'),
        env: {},
      });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AssignError);
    expect((err as AssignError).code).toBe('ERR_ASSIGN_MANAGED_MISSING_IDENTITY');
    expect((err as Error).message).toMatch(/--state-remote/);
    expect((err as Error).message).toMatch(/SQUAD_STATE_REMOTE/);
    expect((err as Error).message).toMatch(/registry\.defaults\.stateRemote/);
  });

  it('B5a inbox precedence: --inbox-handle flag beats SQUAD_INBOX_HANDLE', async () => {
    const bare = makeTmpDir('b5a-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('b5a-seed'), bare);
    await scaffold(seed);
    await seedOrphans(seed);
    const home = makeTmpDir('b5a-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    await runAssign({
      callsign: 'probe', stateRemote: bare, home, registryPath,
      cwd: makeTmpDir('b5a-cwd'), noBind: true,
      inboxHandle: 'flagwins', env: { SQUAD_INBOX_HANDLE: 'envhandle' },
      _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}),
    });
    const entry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')).squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect(entry.inboxHandle).toBe('flagwins');
  });

  it('B5b inbox precedence: SQUAD_INBOX_HANDLE (sanitized) beats git user.name', async () => {
    const bare = makeTmpDir('b5b-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('b5b-seed'), bare);
    await scaffold(seed);
    await seedOrphans(seed);
    const home = makeTmpDir('b5b-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    await runAssign({
      callsign: 'probe', stateRemote: bare, home, registryPath,
      cwd: makeTmpDir('b5b-cwd'), noBind: true,
      env: { SQUAD_INBOX_HANDLE: 'From Env Name' },
      _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}),
    });
    const entry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')).squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect(entry.inboxHandle).toBe('from-env-name');
  });

  it('B6 (review F4) a bad SQUAD_INBOX_HANDLE does not preempt the warm-entry teaching path', async () => {
    // A warm (unmanaged) entry already exists for the callsign. The short-form `--callsign` path
    // short-circuits to the teaching error (bind via `squad assign <callsign>`) and must NOT throw
    // an inbox-handle error — the handle is only resolved on a genuine cold-start, AFTER the
    // warm-entry check. Regression for the pre-fix ordering where _resolveInboxHandle threw first.
    const home = makeTmpDir('b6-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const warmSquadDir = path.join(makeTmpDir('b6-warm'), '.squad');
    fs.mkdirSync(warmSquadDir, { recursive: true });
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({
      version: 1,
      squads: [{ callsign: 'probe', path: warmSquadDir }],
    }, null, 2));

    let err: unknown;
    try {
      await runAssign({
        callsign: 'probe',
        home,
        registryPath,
        cwd: makeTmpDir('b6-cwd'),
        noBind: true,
        // A resolvable state remote enters the cold-start branch; the unsanitizable handle would
        // throw if it were resolved before the warm-entry check.
        env: { SQUAD_STATE_REMOTE: makeTmpDir('b6-bare'), SQUAD_INBOX_HANDLE: '!!!' },
      });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AssignError);
    expect((err as AssignError).code).toBe('ERR_ASSIGN_MANAGED_MISSING_IDENTITY');
    expect((err as AssignError).code).not.toBe('ERR_ASSIGN_INVALID_INBOX_HANDLE');
  });
});

// ─── Adversarial-review fixes ───────────────────────────────────────────────────

describe('piece 55 — adversarial-review fixes', { timeout: 90_000 }, () => {
  it('FIX1 managed entry records clones[] so `squad sync --pull` from the managed clone does NOT trip the host-clone guard', async () => {
    const bare = makeTmpDir('fix1-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('fix1-seed'), bare);
    await scaffold(seed);
    await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed, 'squad/state/probe', { '.squad/log/session.md': '# s\n' });

    const home = makeTmpDir('fix1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    await runAssign({
      callsign: 'probe', stateRemote: bare, stateBranch: 'squad/state/probe',
      skillsFrom: 'host', home, registryPath, cwd: makeTmpDir('fix1-cwd'), noBind: true,
      _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}),
    });

    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect(entry.clones).toContain(managedProjectDir);

    // Real runSync --pull from the managed clone: the host-clone guard calls process.exit(1).
    // With clones[] recorded the entry resolves as a product clone and the guard is never reached.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      delete process.env['SQUAD_SYNC_ACTIVE'];
      await runSync({ direction: 'pull', cwd: managedProjectDir, registryPath, quiet: true });
    } finally {
      exitSpy.mockRestore();
    }
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('FIX2 auto-wire (real runUpgrade) does NOT clobber the hydrated durable constitution', async () => {
    const bare = makeTmpDir('fix2-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('fix2-seed'), bare);
    await scaffold(seed);
    // Inject a distinctive durable charter, publish it on the config lane.
    const marker = 'SENTINEL-DURABLE-CHARTER-4f2a';
    fs.writeFileSync(path.join(seed, '.squad', 'charter.md'), `# Shared Squad Charter\n${marker}\n`);
    execFileSync('git', ['add', '-f', '--', '.squad/charter.md'], { cwd: seed, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'custom charter'], { cwd: seed, stdio: 'pipe' });
    await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed, 'squad/state/probe', { '.squad/log/session.md': '# s\n' });

    const home = makeTmpDir('fix2-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    // NOTE: real runUpgrade (no _runUpgradeFn seam) — the previous behaviour overwrote charter.md
    // with the bundled default. The preserveHydratedTeamRoot fix must keep the hydrated content.
    const result = await runAssign({
      callsign: 'probe', stateRemote: bare, stateBranch: 'squad/state/probe',
      skillsFrom: 'host', home, registryPath, cwd: makeTmpDir('fix2-cwd'), noBind: true,
      _installCrossRepoHookFn: vi.fn(() => {}),
    });
    expect(result.kind).toBe('assigned');

    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    const charter = readFileMaybe(path.join(managedProjectDir, '.squad', 'charter.md'));
    expect(charter).not.toBeNull();
    expect(charter).toContain(marker);
  });

  it('FIX2b auto-wire (real runUpgrade) does NOT clobber hydrated EPHEMERAL state (history/orchestration-log)', async () => {
    const bare = makeTmpDir('fix2b-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('fix2b-seed'), bare);
    await scaffold(seed);
    await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
    // Seed the shared squad's ephemeral coordinator memory on the STATE lane. These files are
    // in PUBLISH_ALLOWLIST but NOT CONFIG_ALLOWLIST and carry overwriteOnUpgrade:true in the
    // manifest — the durable-only preserve would clobber them with bundled placeholders.
    const histMarker = 'SENTINEL-HYDRATED-HISTORY-9c31';
    const logMarker = 'SENTINEL-HYDRATED-ORCH-LOG-9c31';
    seedOrphanBranch(seed, 'squad/state/probe', {
      '.squad/history.md': `# Shared History\n${histMarker}\n`,
      '.squad/orchestration-log.md': `# Shared Orchestration Log\n${logMarker}\n`,
      '.squad/log/session.md': '# s\n',
    });

    const home = makeTmpDir('fix2b-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const result = await runAssign({
      callsign: 'probe', stateRemote: bare, stateBranch: 'squad/state/probe',
      skillsFrom: 'host', home, registryPath, cwd: makeTmpDir('fix2b-cwd'), noBind: true,
      _installCrossRepoHookFn: vi.fn(() => {}),
    });
    expect(result.kind).toBe('assigned');

    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    const history = readFileMaybe(path.join(managedProjectDir, '.squad', 'history.md'));
    const orchLog = readFileMaybe(path.join(managedProjectDir, '.squad', 'orchestration-log.md'));
    expect(history).not.toBeNull();
    expect(history).toContain(histMarker);
    expect(orchLog).not.toBeNull();
    expect(orchLog).toContain(logMarker);
  });

  it('FIX3 managed durable hydrate is CLEAN-OVERWRITE — prunes durable files removed upstream', async () => {
    const bare = makeTmpDir('fix3-bare');
    initBareRepo(bare);
    const seed = initWorkingRepo(makeTmpDir('fix3-seed'), bare);
    // v1 durable tree: team.md + charter.md + routing.md.
    seedOrphanBranch(seed, 'squad/config/probe', {
      '.squad/team.md': '# team\n', '.squad/charter.md': '# charter\n', '.squad/routing.md': '# routing\n',
    });

    const proj = makeTmpDir('fix3-proj');
    execFileSync('git', ['clone', bare, proj], { stdio: 'pipe' });
    await hydrateTeamRootFromConfigRef(proj, 'origin', 'squad/config/probe', true);
    expect(fs.existsSync(path.join(proj, '.squad', 'routing.md'))).toBe(true);
    expect(fs.existsSync(path.join(proj, '.squad', 'charter.md'))).toBe(true);

    // v2 durable tree drops routing.md (force — orphan history is unrelated).
    seedOrphanBranch(seed, 'squad/config/probe', {
      '.squad/team.md': '# team\n', '.squad/charter.md': '# charter v2\n',
    }, true);
    await hydrateTeamRootFromConfigRef(proj, 'origin', 'squad/config/probe', true);
    expect(fs.existsSync(path.join(proj, '.squad', 'routing.md'))).toBe(false); // pruned
    expect(fs.existsSync(path.join(proj, '.squad', 'charter.md'))).toBe(true);  // kept

    // Non-managed hydrate stays additive: the same v1→v2 transition leaves routing.md in place.
    const projAdditive = makeTmpDir('fix3-proj-additive');
    execFileSync('git', ['clone', bare, projAdditive], { stdio: 'pipe' });
    seedOrphanBranch(seed, 'squad/config/probe', {
      '.squad/team.md': '# team\n', '.squad/charter.md': '# charter\n', '.squad/routing.md': '# routing\n',
    }, true);
    await hydrateTeamRootFromConfigRef(projAdditive, 'origin', 'squad/config/probe'); // no managed flag
    expect(fs.existsSync(path.join(projAdditive, '.squad', 'routing.md'))).toBe(true);
    seedOrphanBranch(seed, 'squad/config/probe', {
      '.squad/team.md': '# team\n', '.squad/charter.md': '# charter v2\n',
    }, true);
    await hydrateTeamRootFromConfigRef(projAdditive, 'origin', 'squad/config/probe'); // additive
    expect(fs.existsSync(path.join(projAdditive, '.squad', 'routing.md'))).toBe(true); // NOT pruned
  });

  it('FIX5 re-run with a changed --state-remote realigns the managed clone origin', async () => {
    const bare1 = makeTmpDir('fix5-bare1');
    initBareRepo(bare1);
    const seed1 = initWorkingRepo(makeTmpDir('fix5-seed1'), bare1);
    await scaffold(seed1);
    await seedConfigOrphan(seed1, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed1, 'squad/state/probe', { '.squad/log/s.md': '#\n' });

    const bare2 = makeTmpDir('fix5-bare2');
    initBareRepo(bare2);
    const seed2 = initWorkingRepo(makeTmpDir('fix5-seed2'), bare2);
    await scaffold(seed2);
    await seedConfigOrphan(seed2, 'squad/config/probe', { remote: 'origin' });
    seedOrphanBranch(seed2, 'squad/state/probe', { '.squad/log/s.md': '#\n' });

    const home = makeTmpDir('fix5-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const common = {
      callsign: 'probe', stateBranch: 'squad/state/probe', skillsFrom: 'host' as const,
      home, registryPath, noBind: true, _runUpgradeFn: vi.fn(async () => {}), _installCrossRepoHookFn: vi.fn(() => {}),
    };
    await runAssign({ ...common, stateRemote: bare1, cwd: makeTmpDir('fix5-cwd1') });
    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    let origin = execFileSync('git', ['-C', managedProjectDir, 'remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
    expect(normPath(origin)).toBe(normPath(bare1));

    const result = await runAssign({ ...common, stateRemote: bare2, cwd: makeTmpDir('fix5-cwd2') });
    origin = execFileSync('git', ['-C', managedProjectDir, 'remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
    expect(normPath(origin)).toBe(normPath(bare2));
    expect(result.kind === 'assigned' && result.warnings.some(w => /realigned/i.test(w))).toBe(true);
  });
});
