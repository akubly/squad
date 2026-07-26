/**
 * Tests for the squad unassign command module.
 *
 * @module commands/__tests__/unassign.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runUnassign } from '../unassign.js';
import type { RunUnassignOpts } from '../unassign.js';

const TEST_ROOT = path.join(process.cwd(), `.test-unassign-${randomBytes(4).toString('hex')}`);

function makeDir(relPath: string): string {
  const dir = path.join(TEST_ROOT, relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSquadHost(dir: string): string {
  const squadDir = path.join(dir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), '# Team\n');
  return squadDir;
}

function writeRegistry(registryPath: string, squads: unknown[]): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
}

function readRegistry(registryPath: string): { version: number; squads: unknown[] } {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

// ============================================================
// Shared setup helpers
// ============================================================

describe('runUnassign: happy path', () => {
  let hostDir: string;
  let cloneDir: string;
  let otherCloneDir: string;
  let registryPath: string;
  let squadPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    otherCloneDir = makeDir('other-clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: ['github.com/example/api'],
      clones: [cloneDir, otherCloneDir],
      status: 'active',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U1 removes the target git root from clones[] and preserves other clones', async () => {
    const result = await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.alreadyUnassigned).toBeFalsy();
    expect(result.hostPathGuard).toBeFalsy();

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect((entry['clones'] as string[])).not.toContain(cloneDir);
    expect((entry['clones'] as string[])).toContain(otherCloneDir);
  });
});

describe('runUnassign: last clone demotion', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;
  let squadPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      initUri: 'https://github.com/example/squad-host',
      origins: ['github.com/example/api'],
      clones: [cloneDir],
      status: 'active',
      stateBackend: 'orphan',
      _unknownFutureField: 'preserved',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U2 last clone demotion: sets status to inactive and preserves callsign, path, initUri, and unknown fields', async () => {
    const result = await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.demoted).toBe(true);

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('inactive');
    expect(entry['callsign']).toBe('alpha');
    expect(entry['path']).toBe(squadPath);
    expect(entry['initUri']).toBe('https://github.com/example/squad-host');
    expect(entry['stateBackend']).toBe('orphan');
    expect(entry['_unknownFutureField']).toBe('preserved');
    expect((entry['clones'] as string[])).toHaveLength(0);
  });

  it('U3 demote not delete: registry entry still exists after last-clone unassign', async () => {
    await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['callsign']).toBe('alpha');
  });
});

describe('runUnassign: idempotency', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;
  let squadPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [],
      status: 'active',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U4 idempotent no match: target directory not present in any clones[] returns success', async () => {
    const result = await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.alreadyUnassigned).toBe(true);
  });

  it('U5 idempotent explicit callsign: target directory not present in named entry returns success', async () => {
    const result = await runUnassign({
      callsign: 'alpha',
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.alreadyUnassigned).toBe(true);
  });
});

describe('runUnassign: ambiguous match', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath1 = makeSquadHost(makeDir('host1'));
    const squadPath2 = makeSquadHost(makeDir('host2'));
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [
      {
        callsign: 'alpha',
        path: squadPath1,
        origins: [],
        clones: [cloneDir],
        status: 'active',
      },
      {
        callsign: 'beta',
        path: squadPath2,
        origins: [],
        clones: [cloneDir],
        status: 'active',
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U6 ambiguous match: target directory in multiple entries without --callsign fails with exit code 3', async () => {
    await expect(runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    })).rejects.toMatchObject({ code: 'ERR_UNASSIGN_AMBIGUOUS', exitCode: 3 });
  });

  it('U7 explicit callsign resolves ambiguity: removes only from named entry', async () => {
    const result = await runUnassign({
      callsign: 'alpha',
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.alreadyUnassigned).toBeFalsy();

    const reg = readRegistry(registryPath);
    const alpha = (reg.squads as Record<string, unknown>[]).find(s => s['callsign'] === 'alpha')!;
    const beta = (reg.squads as Record<string, unknown>[]).find(s => s['callsign'] === 'beta')!;
    expect((alpha['clones'] as string[])).not.toContain(cloneDir);
    expect((beta['clones'] as string[])).toContain(cloneDir);
    // alpha had only one clone — demotion must have occurred.
    expect(alpha['status']).toBe('inactive');
  });
});

describe('runUnassign: refcounted origins', () => {
  let registryPath: string;
  let cloneDir: string;
  let otherCloneDir: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    const squadPath = makeSquadHost(makeDir('host'));
    cloneDir = makeDir('clone');
    otherCloneDir = makeDir('other-clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: ['github.com/example/sole', 'github.com/example/shared'],
      clones: [cloneDir, otherCloneDir],
      status: 'active',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U8 sole origin reference: removes origin when removed clone was only remaining reference', async () => {
    await runUnassign({
      callsign: 'alpha',
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      // cloneDir contributes 'sole' origin; otherCloneDir does not
      getRemoteUrls: (dir) => dir === cloneDir ? ['https://github.com/example/sole'] : [],
    });

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect((entry['origins'] as string[])).not.toContain('github.com/example/sole');
  });

  it('U9 shared origin reference: keeps origin when another remaining clone still reports it', async () => {
    await runUnassign({
      callsign: 'alpha',
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      // Both cloneDir and otherCloneDir contribute 'shared' origin
      getRemoteUrls: () => ['https://github.com/example/shared'],
    });

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect((entry['origins'] as string[])).toContain('github.com/example/shared');
  });
});

describe('runUnassign: host-path guard', () => {
  let hostDir: string;
  let registryPath: string;
  let squadPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    squadPath = makeSquadHost(hostDir);
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [hostDir],
      status: 'active',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U10 host-path guard: running from the squad host directory is a no-op success', async () => {
    const result = await runUnassign({
      registryPath,
      targetDir: hostDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.hostPathGuard).toBe(true);

    // Registry must not be mutated
    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect((entry['clones'] as string[])).toContain(hostDir);
  });
});

describe('runUnassign: forward-compatible field preservation', () => {
  let registryPath: string;
  let cloneDir: string;
  let otherCloneDir: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    const squadPath = makeSquadHost(makeDir('host'));
    cloneDir = makeDir('clone');
    otherCloneDir = makeDir('other-clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [cloneDir, otherCloneDir],
      status: 'active',
      stateBackend: 'orphan',
      _custom: 'preserved-value',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U11 forward-compatible fields: preserves stateBackend and unknown fields through read-modify-write', async () => {
    await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['stateBackend']).toBe('orphan');
    expect(entry['_custom']).toBe('preserved-value');
  });
});

describe('runUnassign: unknown callsign suggestion', () => {
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    const squadPath = makeSquadHost(makeDir('host'));
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [],
      status: 'active',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U12 suggestion path: unknown callsign can include a close-match suggestion', async () => {
    await expect(runUnassign({
      callsign: 'alph',
      registryPath,
      targetDir: process.cwd(),
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    })).rejects.toMatchObject({ code: 'ERR_UNASSIGN_UNKNOWN_CALLSIGN', message: expect.stringContaining('alpha') });
  });
});

describe('runUnassign: double-call idempotency', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;
  let squadPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [cloneDir],
      status: 'active',
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('U13 double-call idempotency: second call succeeds with no throw and registry unchanged', async () => {
    // First call — removes the clone and demotes the entry.
    const result1 = await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });
    expect(result1.demoted).toBe(true);

    const regAfterFirst = readRegistry(registryPath);

    // Second call — target no longer in clones[]; should return alreadyUnassigned.
    const result2 = await runUnassign({
      registryPath,
      targetDir: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });
    expect(result2.alreadyUnassigned).toBe(true);

    // Registry must be identical after the second call.
    const regAfterSecond = readRegistry(registryPath);
    expect(regAfterSecond).toEqual(regAfterFirst);
  });
});
