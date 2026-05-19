/**
 * Tests for the squad doctor command module.
 *
 * Covers registry health warnings, --normalize-callsigns, and --purge.
 *
 * @module commands/__tests__/doctor.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  runDoctor,
  runDoctorNormalize,
  runDoctorPurge,
} from '../doctor.js';
import type {
  RunDoctorOpts,
  NormalizeCallsignsOpts,
  RunDoctorPurgeOpts,
} from '../doctor.js';

const TEST_ROOT = path.join(process.cwd(), `.test-doctor-cmd-${randomBytes(4).toString('hex')}`);

function makeDir(relPath: string): string {
  const dir = path.join(TEST_ROOT, relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRegistry(registryPath: string, squads: unknown[]): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
}

function readRegistry(registryPath: string): { version: number; squads: unknown[] } {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

// ============================================================
// Registry health warning tests
// ============================================================

describe('runDoctor: registry health warnings', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadDir = path.join(hostDir, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('W01 clean registry produces no registry health warnings', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      origins: ['https://github.com/org/repo.git'],
      clones: [cloneDir],
      status: 'active',
    }]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    const hasHealthWarning = result.findings.some(
      f => f.toLowerCase().includes('empty clones') ||
           f.toLowerCase().includes('ambiguous') ||
           f.toLowerCase().includes('origin overlap'),
    );
    expect(hasHealthWarning).toBe(false);
  });

  it('W02 inactive entry with empty clones emits informational guidance, not a warning', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      origins: [],
      clones: [],
      status: 'inactive',
    }]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('info');
    const hasGuidance= result.findings.some(
      f => f.toLowerCase().includes('inactive') || f.toLowerCase().includes('assign'),
    );
    expect(hasGuidance).toBe(true);
  });

  it('W03 active entry with empty clones emits warning and elevates severity to warn', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      origins: [],
      clones: [],
      status: 'active',
    }]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('warn');
    const hasWarning = result.findings.some(
      f => f.toLowerCase().includes('alpha') && f.toLowerCase().includes('clones'),
    );
    expect(hasWarning).toBe(true);
  });

  it('W04 entry with missing status and empty clones is treated as active and emits warning', async () => {
    writeRegistry(registryPath, [{
      callsign: 'beta',
      path: path.join(hostDir, '.squad'),
      origins: [],
      clones: [],
    }]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('warn');
    const hasWarning = result.findings.some(
      f => f.toLowerCase().includes('beta') && f.toLowerCase().includes('clones'),
    );
    expect(hasWarning).toBe(true);
  });

  it('W05 two entries with the same clone path produce a clone-path ambiguity warning', async () => {
    const host2Dir = makeDir('host2');
    fs.mkdirSync(path.join(host2Dir, '.squad'), { recursive: true });
    writeRegistry(registryPath, [
      {
        callsign: 'alpha',
        path: path.join(hostDir, '.squad'),
        origins: [],
        clones: [cloneDir],
        status: 'active',
      },
      {
        callsign: 'beta',
        path: path.join(host2Dir, '.squad'),
        origins: [],
        clones: [cloneDir],
        status: 'active',
      },
    ]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('warn');
    const hasWarning = result.findings.some(
      f => f.toLowerCase().includes('alpha') && f.toLowerCase().includes('beta'),
    );
    expect(hasWarning).toBe(true);
  });

  it('W06containment clone-path overlap across entries produces a warning', async () => {
    const subCloneDir = makeDir('clone/sub');
    const host2Dir = makeDir('host2');
    fs.mkdirSync(path.join(host2Dir, '.squad'), { recursive: true });
    writeRegistry(registryPath, [
      {
        callsign: 'alpha',
        path: path.join(hostDir, '.squad'),
        origins: [],
        clones: [cloneDir],
        status: 'active',
      },
      {
        callsign: 'beta',
        path: path.join(host2Dir, '.squad'),
        origins: [],
        clones: [subCloneDir],
        status: 'active',
      },
    ]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('warn');
    const hasWarning = result.findings.some(
      f => f.toLowerCase().includes('alpha') && f.toLowerCase().includes('beta'),
    );
    expect(hasWarning).toBe(true);
  });

  it('W07inactive entries are listed in findings without making the command fail', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      origins: [],
      clones: [],
      status: 'inactive',
    }]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).not.toBe('error');
    const mentionsInactive = result.findings.some(
      f => f.toLowerCase().includes('inactive') || f.toLowerCase().includes('alpha'),
    );
    expect(mentionsInactive).toBe(true);
  });

  it('W08 two active entries sharing a normalized origin produce an overlap warning', async () => {
    const host2Dir = makeDir('host2');
    fs.mkdirSync(path.join(host2Dir, '.squad'), { recursive: true });
    const clone2Dir = makeDir('clone2');
    writeRegistry(registryPath, [
      {
        callsign: 'alpha',
        path: path.join(hostDir, '.squad'),
        origins: ['https://github.com/org/repo.git'],
        clones: [cloneDir],
        status: 'active',
      },
      {
        callsign: 'beta',
        path: path.join(host2Dir, '.squad'),
        origins: ['https://github.com/org/repo.git'],
        clones: [clone2Dir],
        status: 'active',
      },
    ]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('warn');
    const hasOriginWarning = result.findings.some(
      f => f.toLowerCase().includes('origin'),
    );
    expect(hasOriginWarning).toBe(true);
  });

  it('W09 inactive entry is excluded from origin overlap check', async () => {
    const host2Dir = makeDir('host2');
    fs.mkdirSync(path.join(host2Dir, '.squad'), { recursive: true });
    const clone2Dir = makeDir('clone2');
    writeRegistry(registryPath, [
      {
        callsign: 'alpha',
        path: path.join(hostDir, '.squad'),
        origins: ['https://github.com/org/repo.git'],
        clones: [cloneDir],
        status: 'active',
      },
      {
        callsign: 'beta',
        path: path.join(host2Dir, '.squad'),
        origins: ['https://github.com/org/repo.git'],
        clones: [clone2Dir],
        status: 'inactive',
      },
    ]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    const hasOriginOverlapWarning = result.findings.some(
      f => f.toLowerCase().includes('origin') && f.toLowerCase().includes('overlap'),
    );
    expect(hasOriginOverlapWarning).toBe(false);
  });

  it('W10 registry health warning elevates an otherwise informational CWD result', async () => {
    // CWD does not match any entry (no clone/origin match), so CWD result is info.
    // Active entry with empty clones should escalate to warn.
    const cwdDir = makeDir('unrelated-cwd');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      origins: [],
      clones: [],
      status: 'active',
    }]);
    const result = await runDoctor({
      cwd: cwdDir,
      registryPath,
      env: {},
      copilotHome: path.join(TEST_ROOT, 'test-copilot-home'),
    });
    expect(result.severity).toBe('warn');
  });
});

// ============================================================
// --normalize-callsigns tests
// ============================================================

describe('runDoctorNormalize', () => {
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    registryPath = path.join(TEST_ROOT, 'registry.json');
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('N01 no collisions: reports zero pairs and makes no changes', async () => {
    const hostA = makeDir('hostA');
    const hostB = makeDir('hostB');
    writeRegistry(registryPath, [
      { callsign: 'alpha', path: path.join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'beta', path: path.join(hostB, '.squad'), clones: [], status: 'active' },
    ]);
    const before = fs.readFileSync(registryPath, 'utf8');
    const result = await runDoctorNormalize({ registryPath });
    const after = fs.readFileSync(registryPath, 'utf8');
    expect(result.pairsFound).toBe(0);
    expect(result.mergedCount).toBe(0);
    expect(after).toBe(before);
  });

  it('N02 one pair dry-run: reports the pair and leaves registry unchanged', async () => {
    const hostA = makeDir('norm-host-a');
    const hostB = makeDir('norm-host-b');
    writeRegistry(registryPath, [
      { callsign: 'myteam', path: path.join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'MyTeam', path: path.join(hostB, '.squad'), clones: [], status: 'active' },
    ]);
    const before = fs.readFileSync(registryPath, 'utf8');
    const result = await runDoctorNormalize({ registryPath });
    const after = fs.readFileSync(registryPath, 'utf8');
    expect(result.pairsFound).toBe(1);
    expect(result.mergedCount).toBe(0);
    expect(after).toBe(before);
    const pairLine = result.lines.some(l => l.includes('myteam') || l.includes('MyTeam'));
    expect(pairLine).toBe(true);
  });

  it('N03 one pair apply yes: merges into deterministic survivor with deduped clones and origins', async () => {
    const hostA = makeDir('norm-host-c');
    const hostB = makeDir('norm-host-d');
    const cloneA = makeDir('clone-a');
    const cloneB = makeDir('clone-b');
    writeRegistry(registryPath, [
      {
        callsign: 'myteam',
        path: path.join(hostA, '.squad'),
        clones: [cloneA, cloneB],
        origins: ['https://github.com/org/repo.git'],
        status: 'active',
      },
      {
        callsign: 'MyTeam',
        path: path.join(hostB, '.squad'),
        clones: [cloneB],
        origins: ['https://github.com/org/repo'],
        status: 'inactive',
      },
    ]);
    const result = await runDoctorNormalize({ registryPath, apply: true, yes: true });
    expect(result.pairsFound).toBe(1);
    expect(result.mergedCount).toBe(1);
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
    const survivor = reg.squads[0] as Record<string, unknown>;
    expect(survivor['status']).toBe('active');
    // deduped clones: cloneA and cloneB (cloneB was in both)
    const clones = survivor['clones'] as string[];
    expect(clones).toContain(cloneA);
    expect(clones).toContain(cloneB);
    const uniqueByKey = new Set(clones.map(c => c.toLowerCase()));
    expect(uniqueByKey.size).toBe(clones.length);
    // F6: origins must also be deduped (cloneB's origin was a non-.git variant of the same URL)
    const origins = survivor['origins'] as string[];
    expect(origins).toHaveLength(1);
  });

  it('N04 multiple pairs dry-run: reports each independent pair', async () => {
    const hostA = makeDir('norm-host-e');
    const hostB = makeDir('norm-host-f');
    const hostC = makeDir('norm-host-g');
    const hostD = makeDir('norm-host-h');
    writeRegistry(registryPath, [
      { callsign: 'teamA', path: path.join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'TeamA', path: path.join(hostB, '.squad'), clones: [], status: 'active' },
      { callsign: 'teamB', path: path.join(hostC, '.squad'), clones: [], status: 'active' },
      { callsign: 'TeamB', path: path.join(hostD, '.squad'), clones: [], status: 'active' },
    ]);
    const result = await runDoctorNormalize({ registryPath });
    expect(result.pairsFound).toBe(2);
    expect(result.mergedCount).toBe(0);
  });

  it('N05 prompt skip: leaves a prompted pair unchanged when the answer is no', async () => {
    const hostA = makeDir('norm-host-i');
    const hostB = makeDir('norm-host-j');
    writeRegistry(registryPath, [
      { callsign: 'myteam2', path: path.join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'MyTeam2', path: path.join(hostB, '.squad'), clones: [], status: 'active' },
    ]);
    const before = fs.readFileSync(registryPath, 'utf8');
    const result = await runDoctorNormalize({
      registryPath,
      apply: true,
      promptFn: async (_q: string) => 'n',
    });
    const after = fs.readFileSync(registryPath, 'utf8');
    expect(result.mergedCount).toBe(0);
    expect(after).toBe(before);
  });

  it('N06 tie handling: uses registry order when activity score ties', async () => {
    const hostA = makeDir('norm-host-k');
    const hostB = makeDir('norm-host-l');
    writeRegistry(registryPath, [
      { callsign: 'first', path: path.join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'First', path: path.join(hostB, '.squad'), clones: [], status: 'active' },
    ]);
    await runDoctorNormalize({ registryPath, apply: true, yes: true });
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
    const survivor = reg.squads[0] as Record<string, unknown>;
    // First entry in registry order wins the tie
    expect(survivor['callsign']).toBe('first');
  });

  it('N07 clone-count tiebreaker: entry with more clones wins when activity score ties', async () => {
    const hostA = makeDir('norm-host-clone-a');
    const hostB = makeDir('norm-host-clone-b');
    const cloneA = makeDir('clone-count-a');
    const cloneB = makeDir('clone-count-b');
    const cloneC = makeDir('clone-count-c');
    // 'first' has 1 clone, 'First' has 2 — both active, so activity scores tie
    writeRegistry(registryPath, [
      { callsign: 'first', path: path.join(hostA, '.squad'), clones: [cloneA], status: 'active' },
      { callsign: 'First', path: path.join(hostB, '.squad'), clones: [cloneB, cloneC], status: 'active' },
    ]);
    await runDoctorNormalize({ registryPath, apply: true, yes: true });
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
    const survivor = reg.squads[0] as Record<string, unknown>;
    // Higher clone count wins; 'First' has 2 clones vs 'first' has 1
    expect(survivor['callsign']).toBe('First');
  });

  it('N07 forward-compatible fields on survivor are preserved through merge', async () => {
    const hostA = makeDir('norm-host-m');
    const hostB = makeDir('norm-host-n');
    writeRegistry(registryPath, [
      {
        callsign: 'cs',
        path: path.join(hostA, '.squad'),
        clones: [],
        status: 'active',
        metadata: { owner: 'team-x' },
      },
      {
        callsign: 'CS',
        path: path.join(hostB, '.squad'),
        clones: [],
        status: 'inactive',
      },
    ]);
    await runDoctorNormalize({ registryPath, apply: true, yes: true });
    const reg = readRegistry(registryPath);
    const survivor = reg.squads[0] as Record<string, unknown>;
    expect(survivor['metadata']).toEqual({ owner: 'team-x' });
  });

  it('N08 entries without callsigns are ignored in normalization', async () => {
    const hostA = makeDir('norm-host-o');
    writeRegistry(registryPath, [
      { path: path.join(hostA, '.squad'), clones: [], status: 'active' },
    ]);
    const before = fs.readFileSync(registryPath, 'utf8');
    const result = await runDoctorNormalize({ registryPath, apply: true, yes: true });
    const after = fs.readFileSync(registryPath, 'utf8');
    expect(result.pairsFound).toBe(0);
    expect(after).toBe(before);
  });
});

// ============================================================
// --purge tests
// ============================================================

describe('runDoctorPurge', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadDir = path.join(hostDir, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('P01 active entry with clone consumers is refused and consumers are returned', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [cloneDir],
      status: 'active',
    }]);
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      yes: true,
    });
    expect(result.refused).toBeDefined();
    expect(result.refused!.consumers).toContain(cloneDir);
    expect(result.removed).toBeFalsy();
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
  });

  it('P02 inactive entry is removed with --yes', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'inactive',
    }]);
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      yes: true,
    });
    expect(result.removed).toBe(true);
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(0);
  });

  it('P03 active entry with empty clones is removed with --yes', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'active',
    }]);
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      yes: true,
    });
    expect(result.removed).toBe(true);
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(0);
  });

  it('P04 unknown callsign returns not-found with a close-match suggestion when available', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'active',
    }]);
    const result = await runDoctorPurge({
      callsign: 'alph',
      registryPath,
      yes: true,
    });
    expect(result.notFound).toBeDefined();
    expect(result.notFound!.suggestion).toBe('alpha');
  });

  it('P05 unknown callsign with no close match returns null suggestion', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'active',
    }]);
    const result = await runDoctorPurge({
      callsign: 'zzz-completely-unrelated',
      registryPath,
      yes: true,
    });
    expect(result.notFound).toBeDefined();
    expect(result.notFound!.suggestion).toBeNull();
  });

  it('P06 confirmation no returns cancelled and leaves registry unchanged', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'inactive',
    }]);
    const before = fs.readFileSync(registryPath, 'utf8');
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      promptFn: async (_q: string) => 'n',
    });
    const after = fs.readFileSync(registryPath, 'utf8');
    expect(result.cancelled).toBe(true);
    expect(after).toBe(before);
  });

  it('P07 confirmation yes removes the entry', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'inactive',
    }]);
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      promptFn: async (_q: string) => 'y',
    });
    expect(result.removed).toBe(true);
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(0);
  });

  it('P08 host directory and .squad directory are not deleted after purge', async () => {
    const squadDir = path.join(hostDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadDir,
      clones: [],
      status: 'inactive',
    }]);
    await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      yes: true,
    });
    expect(fs.existsSync(hostDir)).toBe(true);
    expect(fs.existsSync(squadDir)).toBe(true);
  });

  it('P09 second purge returns not-found after first removal', async () => {
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: path.join(hostDir, '.squad'),
      clones: [],
      status: 'inactive',
    }]);
    await runDoctorPurge({ callsign: 'alpha', registryPath, yes: true });
    const result = await runDoctorPurge({ callsign: 'alpha', registryPath, yes: true });
    expect(result.notFound).toBeDefined();
  });

  it('P10 removing one entry does not mutate unrelated entries', async () => {
    const host2Dir = makeDir('host2');
    fs.mkdirSync(path.join(host2Dir, '.squad'), { recursive: true });
    const clone2Dir = makeDir('clone2');
    writeRegistry(registryPath, [
      {
        callsign: 'alpha',
        path: path.join(hostDir, '.squad'),
        clones: [],
        status: 'inactive',
        extraField: 'preserved',
      },
      {
        callsign: 'beta',
        path: path.join(host2Dir, '.squad'),
        clones: [clone2Dir],
        origins: ['https://github.com/org/beta.git'],
        status: 'active',
        anotherField: 42,
      },
    ]);
    await runDoctorPurge({ callsign: 'alpha', registryPath, yes: true });
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
    const beta = reg.squads[0] as Record<string, unknown>;
    expect(beta['callsign']).toBe('beta');
    expect(beta['anotherField']).toBe(42);
    expect((beta['clones'] as string[])).toContain(clone2Dir);
  });

  it('P11 absent registry file returns noRegistry (not notFound)', async () => {
    const missingRegistry = path.join(TEST_ROOT, 'does-not-exist.json');
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath: missingRegistry,
      yes: true,
    });
    expect(result.noRegistry).toBe(true);
    expect(result.notFound).toBeUndefined();
  });

  it('P12 corrupt registry file returns noRegistry', async () => {
    fs.writeFileSync(registryPath, 'NOT JSON');
    const result = await runDoctorPurge({
      callsign: 'alpha',
      registryPath,
      yes: true,
    });
    expect(result.noRegistry).toBe(true);
    expect(result.notFound).toBeUndefined();
  });

  it('P13 callsign with invalid characters returns invalidCallsign', async () => {
    writeRegistry(registryPath, []);
    const result = await runDoctorPurge({
      callsign: 'alpha!@#',
      registryPath,
      yes: true,
    });
    expect(result.invalidCallsign).toBe(true);
  });

  it('P14 callsign exceeding 64 characters returns invalidCallsign', async () => {
    writeRegistry(registryPath, []);
    const result = await runDoctorPurge({
      callsign: 'a'.repeat(65),
      registryPath,
      yes: true,
    });
    expect(result.invalidCallsign).toBe(true);
  });
});

// ============================================================
// Fix 7 (FIDO gap G3): runDoctor orphan wiring integration
// ============================================================

describe('runDoctor: orphan payload wiring', () => {
  let registryPath: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    registryPath = path.join(TEST_ROOT, 'registry.json');
    copilotHome = makeDir('orphan-copilot-home');
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('O01 orphaned skill directory escalates severity to warn and appears in findings', async () => {
    // Populate copilotHome with an orphaned skill whose callsign is not in the registry.
    const orphanSkillDir = path.join(copilotHome, 'skills', 'squad-ghost-old-skill');
    fs.mkdirSync(orphanSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(orphanSkillDir, 'SKILL.md'),
      '---\nname: squad-ghost-old-skill\ndescription: orphan test\n---\n# Ghost skill\n',
    );

    // Registry contains a different callsign — ghost is not registered.
    const hostDir = makeDir('orphan-host');
    fs.mkdirSync(path.join(hostDir, '.squad'), { recursive: true });
    writeRegistry(registryPath, [{
      callsign: 'other',
      path: path.join(hostDir, '.squad'),
      origins: [],
      clones: [],
      status: 'active',
    }]);

    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath,
      env: {},
      copilotHome,
    });

    expect(result.severity).toBe('warn');
    const orphanFinding = result.findings.find(
      f => /orphan/i.test(f) && /ghost/i.test(f) && /not in the registry/i.test(f),
    );
    expect(orphanFinding).toBeDefined();
  });
});
