/**
 * Piece 56 §A — managed cold-start binds the invoking product clone.
 *
 * Piece 55's one-command cold-start stood up the managed host but ignored the repo the user was
 * standing in, so the product clone still needed a manual `squad assign`. §A resolves cwd's git
 * root and, when it is a work tree distinct from the managed host, reuses the warm-bind path to
 * append it to the managed entry's clones[] and install the cross-repo + product-forbid hooks.
 * Decision H1 gates this with a `--no-bind` opt-out; a non-repo cwd stays host-only.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { initSquad } from '@bradygaster/squad-sdk';
import { seedConfigOrphan } from '../../packages/squad-cli/src/cli/commands/sync.js';
import { runAssign } from '../../packages/squad-cli/src/commands/assign.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-56-bind-tmp');
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
    projectName: 'piece56-probe',
    agents: [{ name: 'dev', role: 'Core Dev' }, { name: 'lead', role: 'Lead' }],
    configFormat: 'json',
  });
}

function seedStateOrphan(seedRepo: string, branch: string, files: Record<string, string>): void {
  execFileSync('git', ['checkout', '--orphan', branch], { cwd: seedRepo, stdio: 'pipe' });
  execFileSync('git', ['rm', '-rf', '--cached', '.'], { cwd: seedRepo, stdio: 'pipe' });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(seedRepo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    execFileSync('git', ['add', '-f', '--', rel], { cwd: seedRepo, stdio: 'pipe' });
  }
  execFileSync('git', ['commit', '-m', `seed ${branch}`], { cwd: seedRepo, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: seedRepo, stdio: 'pipe' });
}

function normKey(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/** Stand up a fresh bare remote carrying config + state orphans, returns { bare }. */
async function seedRemote(label: string): Promise<string> {
  const bare = makeTmpDir(`${label}-bare`);
  initBareRepo(bare);
  const seed = initWorkingRepo(makeTmpDir(`${label}-seed`), bare);
  await scaffold(seed);
  await seedConfigOrphan(seed, 'squad/config/probe', { remote: 'origin' });
  seedStateOrphan(seed, 'squad/state/probe', { '.squad/log/session.md': '# session\n' });
  return bare;
}

afterAll(() => {
  for (const dir of FIXTURE_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('piece 56 §A — cold-start binds the invoking product clone', { timeout: 90_000 }, () => {
  it('P56.A1: a git product clone at cwd is appended to the managed entry clones[] and gets hooks', async () => {
    const bare = await seedRemote('a1');
    const home = makeTmpDir('a1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const installCrossRepoHookFn = vi.fn(() => {});

    // cwd is a REAL product git clone, distinct from the managed host.
    const productClone = initWorkingRepo(makeTmpDir('a1-product'), 'https://example.com/product.git');

    const result = await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: productClone,
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: installCrossRepoHookFn,
    });

    expect(result.kind).toBe('assigned');
    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    const cloneKeys = (entry.clones as string[]).map(normKey);

    // Both the managed host AND the invoking product clone are bound.
    expect(cloneKeys).toContain(normKey(managedProjectDir));
    expect(cloneKeys).toContain(normKey(productClone));

    // The cross-repo hook was installed against the product clone (not only the managed host).
    const hookTargets = installCrossRepoHookFn.mock.calls.map(c => normKey(String(c[0])));
    expect(hookTargets).toContain(normKey(productClone));

    // The product .squad/-forbid pre-commit guard landed in the product clone.
    expect(fs.existsSync(path.join(productClone, '.git', 'hooks', 'pre-commit'))).toBe(true);
  });

  it('P56.A2: --no-bind leaves the flow host-only (product clone NOT bound)', async () => {
    const bare = await seedRemote('a2');
    const home = makeTmpDir('a2-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const productClone = initWorkingRepo(makeTmpDir('a2-product'), 'https://example.com/product.git');

    const result = await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: productClone,
      noBind: true,
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    expect(result.kind).toBe('assigned');
    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    const cloneKeys = (entry.clones as string[]).map(normKey);

    expect(cloneKeys).toEqual([normKey(managedProjectDir)]);
    expect(cloneKeys).not.toContain(normKey(productClone));
  });

  it('P56.A3: a non-repo cwd stays host-only and does not error', async () => {
    const bare = await seedRemote('a3');
    const home = makeTmpDir('a3-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    // Simulate a cwd that is not inside any git work tree. (Temp dirs in this harness live inside
    // the piece-56 worktree, so a real directory would still resolve a git root; the getGitRoot
    // seam deterministically exercises the "non-repo cwd → host-only" branch.)
    const nonRepoCwd = makeTmpDir('a3-cwd');

    const result = await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: nonRepoCwd,
      getGitRoot: () => null,
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    expect(result.kind).toBe('assigned');
    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    expect((entry.clones as string[]).map(normKey)).toEqual([normKey(managedProjectDir)]);
  });
});
