/**
 * Piece 57 — managed-consumer discovery: cold-start restores the `local` anchor and wires the
 * state-MCP bridge into the product clone.
 *
 * The managed model (pieces 55/56) stood up the host clone and bound the product clone into the
 * registry `clones[]`, but left the product clone with NO filesystem-discoverable anchor: no
 * `.squad/config.json` pointer (so Copilot's `.mcp.json` walk and agent greps found nothing) and
 * no `.mcp.json` bridge. This exercises the two discovery repairs:
 *   §A — cold-start writes the product clone's `.squad/config.json` teamRoot pointer (source=local).
 *   §D — cold-start writes a `.mcp.json` at the product git-root whose bridge command resolves
 *        locally (`squad state-mcp`), NOT the unspawnable `npx @wifi-aware/squad-cli@insider` form.
 *   §B — the product clone remains bound into the managed entry `clones[]` (regression guard).
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { initSquad, resolveTeamRoot, clearResolveSquadCache } from '@wifi-aware/squad-sdk';
import { seedConfigOrphan } from '../../packages/squad-cli/src/cli/commands/sync.js';
import { runAssign } from '../../packages/squad-cli/src/commands/assign.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-57-discovery-tmp');
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
    projectName: 'piece57-probe',
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

describe('piece 57 — cold-start restores the local anchor + wires the state-MCP bridge', { timeout: 240_000 }, () => {
  it('P57.A1: product clone gets a .squad/config.json teamRoot pointer that resolves via source=local', async () => {
    const bare = await seedRemote('a1');
    const home = makeTmpDir('a1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
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
      _installCrossRepoHookFn: vi.fn(() => {}),
    });
    expect(result.kind).toBe('assigned');

    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');

    // §A: the product clone now has a local `.squad/config.json` pointing at the managed host.
    const cfgPath = path.join(productClone, '.squad', 'config.json');
    expect(fs.existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(cfg.teamRoot).toBeTruthy();
    expect(path.resolve(productClone, cfg.teamRoot)).toBe(path.resolve(managedProjectDir));

    // The anchor is machine-local — never committed.
    const gitignore = fs.readFileSync(path.join(productClone, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.squad/config.json');

    // §A acceptance: the resolver flips to source=local and follows the pointer to the host .squad.
    clearResolveSquadCache();
    const info = resolveTeamRoot({ cwd: productClone });
    expect(info.resolved).toBe(true);
    expect(info.source).toBe('local');
    expect(normKey(info.teamRoot!)).toBe(normKey(path.join(managedProjectDir, '.squad')));
  });

  it('P57.D1: product clone gets a .mcp.json whose squad_state command resolves locally (not npx @insider)', async () => {
    const bare = await seedRemote('d1');
    const home = makeTmpDir('d1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const productClone = initWorkingRepo(makeTmpDir('d1-product'), 'https://example.com/product.git');

    await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: productClone,
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    const mcpPath = path.join(productClone, '.mcp.json');
    expect(fs.existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    const entry = mcp.mcpServers?.squad_state;
    expect(entry).toBeDefined();
    // §D: the command must resolve on THIS machine with no network — the local `squad` bin, not npx.
    expect(entry.command).toBe('squad');
    expect(entry.args).toContain('state-mcp');
    expect(JSON.stringify(entry)).not.toContain('npx');
    expect(JSON.stringify(entry)).not.toContain('@insider');
  });

  it('P57.D2: a Squad-created .mcp.json is added to .gitignore (never left untracked in the product repo)', async () => {
    const bare = await seedRemote('d2');
    const home = makeTmpDir('d2-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const productClone = initWorkingRepo(makeTmpDir('d2-product'), 'https://example.com/product.git');

    await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: productClone,
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    // The bridge command is machine-local (resolves against THIS install), so the file must be
    // gitignored — otherwise every managed consumer clone shows a stray untracked `.mcp.json`.
    expect(fs.existsSync(path.join(productClone, '.mcp.json'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(productClone, '.gitignore'), 'utf-8');
    expect(gitignore.split(/\r?\n/).some((l) => l.trim() === '.mcp.json')).toBe(true);
    // git must actually consider it ignored (not merely a line in the file).
    const ignored = execFileSync('git', ['check-ignore', '.mcp.json'], { cwd: productClone, encoding: 'utf-8' }).trim();
    expect(ignored).toBe('.mcp.json');
  });

  it('P57.B1: product clone remains bound into the managed entry clones[] (regression guard)', async () => {
    const bare = await seedRemote('b1');
    const home = makeTmpDir('b1-home');
    const registryPath = path.join(home, '.squad', 'registry.json');
    const productClone = initWorkingRepo(makeTmpDir('b1-product'), 'https://example.com/product.git');

    await runAssign({
      callsign: 'probe',
      stateRemote: bare,
      stateBranch: 'squad/state/probe',
      skillsFrom: 'host',
      inboxHandle: 'dev1',
      home,
      registryPath,
      cwd: productClone,
      _runUpgradeFn: vi.fn(async () => {}),
      _installCrossRepoHookFn: vi.fn(() => {}),
    });

    const managedProjectDir = path.join(home, '.squad', 'hosts', 'probe');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const entry = registry.squads.find((s: { callsign?: string }) => s.callsign === 'probe');
    const cloneKeys = (entry.clones as string[]).map(normKey);
    expect(cloneKeys).toContain(normKey(managedProjectDir));
    expect(cloneKeys).toContain(normKey(productClone));
  });
});
