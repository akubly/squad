/**
 * Piece 55 — F1 (upgrade/doctor agree on the repo-agent path: write at the git root) and
 * I1 (origin-overlap suppression between callsign-distinguished managed entries).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runInit } from '@bradygaster/squad-cli/core/init';
import { runUpgrade } from '@bradygaster/squad-cli/core/upgrade';
import { runDoctor } from '../../packages/squad-cli/src/commands/doctor.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-55-f1-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'dev@squad.test'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Squad Test'], { stdio: 'pipe' });
}

afterAll(() => {
  for (const dir of FIXTURE_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('piece 55 — F1: upgrade writes the repo agent at the git root', { timeout: 60_000 }, () => {
  it('F1a root host (dest == git root): agent lands at <root>/.github/agents/squad.agent.md', async () => {
    const root = makeTmpDir('f1a-root');
    gitInit(root);
    await runInit(root);
    const homeDir = makeTmpDir('f1a-home');
    await runUpgrade(root, { homeDir });
    expect(fs.existsSync(path.join(root, '.github', 'agents', 'squad.agent.md'))).toBe(true);
  });

  it('F1b subfolder host (dest != git root): agent lands at the GIT ROOT, not under dest', async () => {
    const root = makeTmpDir('f1b-root');
    gitInit(root);
    const proj = path.join(root, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    await runInit(proj);
    const homeDir = makeTmpDir('f1b-home');
    await runUpgrade(proj, { homeDir });
    // Repo agent must be at the git root — the same base `doctor` checks — not under the subfolder.
    expect(fs.existsSync(path.join(root, '.github', 'agents', 'squad.agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(proj, '.github', 'agents', 'squad.agent.md'))).toBe(false);
  });
});

describe('piece 55 — I1: origin-overlap suppression for callsign-distinguished managed entries', () => {
  function writeRegistry(homeDir: string, squads: Array<Record<string, unknown>>): string {
    const registryPath = path.join(homeDir, 'registry.json');
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
    return registryPath;
  }

  it('I1a two managed, callsign-distinguished entries sharing a state remote → no origin-overlap warning', async () => {
    const home = makeTmpDir('i1a-home');
    const shared = 'https://example.com/shared-host.git';
    const dirA = makeTmpDir('i1a-a');
    const dirB = makeTmpDir('i1a-b');
    const registryPath = writeRegistry(home, [
      { callsign: 'probe', path: path.join(dirA, '.squad'), managed: true, origins: [shared], stateBranch: 'squad/state/probe', configBranch: 'squad/config/probe' },
      { callsign: 'scout', path: path.join(dirB, '.squad'), managed: true, origins: [shared], stateBranch: 'squad/state/scout', configBranch: 'squad/config/scout' },
    ]);
    const { findings } = await runDoctor({ cwd: makeTmpDir('i1a-cwd'), registryPath });
    expect(findings.some(f => /origin overlap/i.test(f))).toBe(false);
  });

  it('I1b non-managed entries sharing an origin still warn (regression guard)', async () => {
    const home = makeTmpDir('i1b-home');
    const shared = 'https://example.com/shared-host.git';
    const dirA = makeTmpDir('i1b-a');
    const dirB = makeTmpDir('i1b-b');
    const registryPath = writeRegistry(home, [
      { callsign: 'probe', path: path.join(dirA, '.squad'), origins: [shared], stateBranch: 'squad/state/probe' },
      { callsign: 'scout', path: path.join(dirB, '.squad'), origins: [shared], stateBranch: 'squad/state/scout' },
    ]);
    const { findings } = await runDoctor({ cwd: makeTmpDir('i1b-cwd'), registryPath });
    expect(findings.some(f => /origin overlap/i.test(f))).toBe(true);
  });
});
