/**
 * Piece 57 §E — doctor detects + heals the stale managed host whose config lane never hydrated.
 *
 * The live `wifi-aware` symptom: a managed host RESOLVES (it is in the registry, product clones are
 * bound to it) but was stood up with only the state lane — no durable `team.md` and no
 * `.last-config-hydrate-sha` sentinel — so agents and Copilot silently see "no team.md". `squad
 * doctor` must report this RED, and the heal (`hydrateTeamRootFromConfigRef`) must turn it GREEN.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { runDoctor, healManagedConfigLane } from '../../packages/squad-cli/src/commands/doctor.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-57-doctor-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

/**
 * Stand up a managed host on disk with ONLY the ephemeral state lane hydrated (a `session.md`
 * log) and no durable config lane (no team.md, no `.last-config-hydrate-sha`). Writes a registry
 * with a managed entry pointing at it. Returns { registryPath, hostRepoRoot, hostSquadDir }.
 */
function seedStaleManagedHost(): { registryPath: string; hostRepoRoot: string; hostSquadDir: string } {
  const home = makeTmpDir('home');
  const hostRepoRoot = path.join(home, '.squad', 'hosts', 'probe');
  const hostSquadDir = path.join(hostRepoRoot, '.squad');
  fs.mkdirSync(path.join(hostSquadDir, 'log'), { recursive: true });
  // state lane hydrated, config lane absent.
  fs.writeFileSync(path.join(hostSquadDir, 'log', 'session.md'), '# session\n');

  const registryPath = path.join(home, '.squad', 'registry.json');
  const registry = {
    version: 1,
    squads: [
      {
        callsign: 'probe',
        path: hostSquadDir,
        managed: true,
        clones: [hostRepoRoot],
        stateRemote: 'https://example.com/state.git',
        stateBranch: 'squad/state/probe',
        configRemote: 'https://example.com/state.git',
        configBranch: 'squad/config/probe',
      },
    ],
  };
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return { registryPath, hostRepoRoot, hostSquadDir };
}

/**
 * Stand up a HEALTHY managed host that has a durable `team.md` (so agents/Copilot resolve it
 * fine) but is missing only the `.last-config-hydrate-sha` sentinel — e.g. a state-only squad
 * whose config branch was never published, or a host hydrated by a pre-sentinel Squad version.
 * §E must NOT flag this: there is no "no team.md" harm, and the heal (which fetches a config
 * branch that may not exist) could never clear it — an unfixable false-positive RED.
 */
function seedHealthyStateOnlyHost(): { registryPath: string; hostRepoRoot: string } {
  const home = makeTmpDir('home-healthy');
  const hostRepoRoot = path.join(home, '.squad', 'hosts', 'probe');
  const hostSquadDir = path.join(hostRepoRoot, '.squad');
  fs.mkdirSync(hostSquadDir, { recursive: true });
  fs.writeFileSync(path.join(hostSquadDir, 'team.md'), '# Team\n\n## Members\n- Lead\n');

  const registryPath = path.join(home, '.squad', 'registry.json');
  const registry = {
    version: 1,
    squads: [{
      callsign: 'probe',
      path: hostSquadDir,
      managed: true,
      clones: [hostRepoRoot],
      stateRemote: 'https://example.com/state.git',
      stateBranch: 'squad/state/probe',
    }],
  };
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return { registryPath, hostRepoRoot };
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Stand up a stale managed host backed by a REAL git remote: a bare repo carrying a
 * `squad/config/probe` branch whose tree contains `.squad/team.md`, and a host clone (origin →
 * bare) whose working tree has only the ephemeral state lane. The registry records the config
 * remote as the bare repo *URL/path* (exactly as `assign` writes it), so the heal must convert
 * that URL into a resolvable remote NAME before fetching — no hydrate seam is injected.
 */
function seedRealGitStaleManagedHost(): { registryPath: string; hostRepoRoot: string; hostSquadDir: string } {
  const home = makeTmpDir('rg-home');
  const bareRepo = makeTmpDir('rg-bare');
  git(bareRepo, ['init', '--bare', '-b', 'main']);

  // Seed the durable config lane on an orphan branch, push to the bare repo.
  const seed = makeTmpDir('rg-seed');
  git(seed, ['init', '-b', 'main']);
  git(seed, ['checkout', '--orphan', 'squad/config/probe']);
  fs.mkdirSync(path.join(seed, '.squad'), { recursive: true });
  fs.writeFileSync(path.join(seed, '.squad', 'team.md'), '# Team\n\n## Members\n- Lead\n');
  git(seed, ['add', '-A']);
  git(seed, ['-c', 'user.email=t@t.co', '-c', 'user.name=Test', 'commit', '-m', 'config lane']);
  git(seed, ['remote', 'add', 'bare', bareRepo]);
  git(seed, ['push', 'bare', 'squad/config/probe']);

  // Host clone: origin → bare. Working tree has the state lane, no durable team.md.
  const hostRepoRoot = path.join(home, '.squad', 'hosts', 'probe');
  fs.mkdirSync(path.dirname(hostRepoRoot), { recursive: true });
  git(path.dirname(hostRepoRoot), ['clone', bareRepo, hostRepoRoot]);
  const hostSquadDir = path.join(hostRepoRoot, '.squad');
  fs.mkdirSync(path.join(hostSquadDir, 'log'), { recursive: true });
  fs.writeFileSync(path.join(hostSquadDir, 'log', 'session.md'), '# session\n');

  const registryPath = path.join(home, '.squad', 'registry.json');
  const registry = {
    version: 1,
    squads: [{
      callsign: 'probe',
      path: hostSquadDir,
      managed: true,
      clones: [hostRepoRoot],
      stateRemote: bareRepo,
      stateBranch: 'squad/state/probe',
      configRemote: bareRepo,
      configBranch: 'squad/config/probe',
    }],
  };
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return { registryPath, hostRepoRoot, hostSquadDir };
}

afterAll(() => {
  for (const dir of FIXTURE_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('piece 57 §E — doctor detects + heals the stale managed config lane', () => {
  it('P57.E1: a managed host that resolves but has no config lane is reported RED', async () => {
    const { registryPath, hostRepoRoot } = seedStaleManagedHost();
    const cwd = makeTmpDir('cwd');

    const result = await runDoctor({ cwd, registryPath, env: {} });

    const laneFinding = result.findings.find(f => /config lane/i.test(f));
    expect(laneFinding).toBeTruthy();
    expect(laneFinding).toContain(hostRepoRoot);
    expect(laneFinding).toMatch(/team\.md|last-config-hydrate-sha/);
    expect(result.severity).toBe('error');
  });

  it('P57.E2: healManagedConfigLane runs the config hydrate and doctor re-checks GREEN', async () => {
    const { registryPath, hostRepoRoot, hostSquadDir } = seedStaleManagedHost();
    const cwd = makeTmpDir('cwd');

    // Pre-heal: RED.
    const before = await runDoctor({ cwd, registryPath, env: {} });
    expect(before.findings.some(f => /config lane/i.test(f))).toBe(true);

    // Heal: the injected hydrate models `hydrateTeamRootFromConfigRef` materialising the durable
    // config lane (team.md + sentinel) into the host team root.
    const hydrateCalls: Array<{ teamRoot: string; remote: string; branch: string; managed?: boolean }> = [];
    const healResult = await healManagedConfigLane({
      registryPath,
      env: {},
      _resolveConfigRemoteFn: (_hostRepoRoot, entry) => entry.configRemote ?? entry.stateRemote ?? 'origin',
      _hydrateConfigFn: async (teamRoot, remote, branch, managed) => {
        hydrateCalls.push({ teamRoot, remote, branch, managed });
        const squadDir = path.join(teamRoot, '.squad');
        fs.mkdirSync(squadDir, { recursive: true });
        fs.writeFileSync(path.join(squadDir, 'team.md'), '# Team\n\n## Members\n');
        fs.writeFileSync(path.join(squadDir, '.last-config-hydrate-sha'), 'abc123\n');
      },
    });

    // The heal targeted the host repo root with the registry's config remote + branch.
    expect(healResult.healed.map(h => h.callsign)).toContain('probe');
    expect(hydrateCalls).toHaveLength(1);
    expect(hydrateCalls[0]!.teamRoot).toBe(hostRepoRoot);
    expect(hydrateCalls[0]!.branch).toBe('squad/config/probe');
    expect(hydrateCalls[0]!.managed).toBe(true);
    expect(fs.existsSync(path.join(hostSquadDir, 'team.md'))).toBe(true);

    // Post-heal: GREEN — no more config-lane finding.
    const after = await runDoctor({ cwd, registryPath, env: {} });
    expect(after.findings.some(f => /config lane/i.test(f))).toBe(false);
  });

  it('P57.E3: a healthy host WITH team.md but no config sentinel is GREEN (no false positive)', async () => {
    const { registryPath } = seedHealthyStateOnlyHost();
    const cwd = makeTmpDir('cwd');

    const result = await runDoctor({ cwd, registryPath, env: {} });

    // team.md is present → agents see a team root → §E must not flag it, and must not escalate.
    expect(result.findings.some(f => /config lane/i.test(f))).toBe(false);
    expect(result.severity).not.toBe('error');
  });

  it('P57.E4: heal resolves the real remote NAME (not the URL) and hydrates team.md', async () => {
    const { registryPath, hostRepoRoot, hostSquadDir } = seedRealGitStaleManagedHost();
    const cwd = makeTmpDir('cwd');

    // Pre-heal: RED — the host has no durable team.md.
    const before = await runDoctor({ cwd, registryPath, env: {} });
    expect(before.findings.some(f => /config lane/i.test(f))).toBe(true);

    // Heal with NO injected seams — exercises the real URL→remote-name resolution + git fetch.
    // Before the fix this fails deterministically: the registry stores the remote as a URL, and
    // hydrateTeamRootFromRef embeds it into a `refs/remotes/<remote>/<branch>` refspec, which git
    // rejects as an invalid ref name (the URL/drive-letter colon) before any network access.
    const heal = await healManagedConfigLane({ registryPath, env: {} });

    expect(heal.skipped.map(s => `${s.callsign}: ${s.reason}`)).toEqual([]);
    expect(heal.healed.map(h => h.callsign)).toContain('probe');
    expect(heal.healed[0]!.hostRepoRoot).toBe(hostRepoRoot);
    expect(fs.existsSync(path.join(hostSquadDir, 'team.md'))).toBe(true);

    // Post-heal: GREEN.
    const after = await runDoctor({ cwd, registryPath, env: {} });
    expect(after.findings.some(f => /config lane/i.test(f))).toBe(false);
  }, 60_000);
});
