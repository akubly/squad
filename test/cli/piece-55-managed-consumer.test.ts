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
  it('A1 --callsign without --state-remote teaches the managed cold-start form', async () => {
    await expect(runAssign({ callsign: 'probe', cwd: makeTmpDir('a1') })).rejects.toMatchObject({
      code: 'ERR_ASSIGN_MANAGED_MISSING_IDENTITY',
    });
    await expect(runAssign({ callsign: 'probe', cwd: makeTmpDir('a1b') })).rejects.toThrow(/--state-remote and --state-branch/);
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
