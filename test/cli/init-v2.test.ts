/**
 * Registry-aware init command tests.
 * Covers runInit with registry-integration flags and isUrlLikeArg detection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { runInit, isUrlLikeArg } from '@wifi-aware/squad-cli/commands/init';

const TEST_ROOT = join(process.cwd(), `.test-init-v2-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

function expectScaffoldEntries(targetDir: string): void {
  expect(existsSync(join(targetDir, '.squad'))).toBe(true);
  expect(existsSync(join(targetDir, '.squad', 'agents'))).toBe(true);
}

async function seedRegistry(squads: unknown[]): Promise<void> {
  await writeFile(tempRegistry(), JSON.stringify({ version: 1, squads }, null, 2));
}

describe('runInit: clean repository scaffold', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates .squad/ in cwd when registration is disabled', async () => {
    const result = await runInit({ cwd: TEST_ROOT, noRegister: true });
    expectScaffoldEntries(TEST_ROOT);
    expect(result.registered).toBeUndefined();
    expect(result.reactivated).toBeUndefined();
  });

  it('does not write a registry entry when registration is disabled', async () => {
    await runInit({ cwd: TEST_ROOT, noRegister: true });
    expect(existsSync(tempRegistry())).toBe(false);
  });
});

describe('runInit: existing scaffold', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('succeeds without overwriting sentinel file when .squad/team.md already exists', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    const teamMdPath = join(squadDir, 'team.md');
    await writeFile(teamMdPath, '# My Custom Team\n');

    // Piece 16: existing scaffold is not an error — init skips scaffold creation and proceeds.
    const result = await runInit({ cwd: TEST_ROOT, noRegister: true });

    // Sentinel file must be preserved unchanged (no clobber).
    expect(readFileSync(teamMdPath, 'utf-8')).toBe('# My Custom Team\n');
    expect(result.registered).toBeUndefined();
  });
});

describe('runInit: target directory', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates intermediate directories and writes .squad/', async () => {
    const targetDir = join(TEST_ROOT, 'nested', 'project');
    await runInit({ targetDir, cwd: TEST_ROOT, noRegister: true });
    expectScaffoldEntries(targetDir);
  });

  it('derives callsign from target directory name and writes registry entry when registryPath is given', async () => {
    const targetDir = join(TEST_ROOT, 'my-team');
    const result = await runInit({ targetDir, registryPath: tempRegistry(), cwd: TEST_ROOT });
    expectScaffoldEntries(targetDir);
    expect(result.registered).toBeDefined();
    expect(result.registered?.callsign).toBe('my-team');
    expect(existsSync(tempRegistry())).toBe(true);
  });

  it('respects an explicit callsign option', async () => {
    const targetDir = join(TEST_ROOT, 'some-dir');
    const result = await runInit({ targetDir, callsign: 'custom-name', registryPath: tempRegistry(), cwd: TEST_ROOT });
    expect(result.registered?.callsign).toBe('custom-name');
  });
});

describe('runInit: --no-register', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates scaffold but does not create or modify registry.json', async () => {
    const result = await runInit({
      cwd: TEST_ROOT,
      callsign: 'test-squad',
      registryPath: tempRegistry(),
      noRegister: true,
    });
    expectScaffoldEntries(TEST_ROOT);
    expect(existsSync(tempRegistry())).toBe(false);
    expect(result.registered).toBeUndefined();
  });
});

describe('runInit: collisions', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('throws when callsign is already active at a different path', async () => {
    const targetA = join(TEST_ROOT, 'alpha');
    const targetB = join(TEST_ROOT, 'beta');
    await runInit({ targetDir: targetA, callsign: 'shared', registryPath: tempRegistry(), cwd: TEST_ROOT });
    await expect(
      runInit({ targetDir: targetB, callsign: 'shared', registryPath: tempRegistry(), cwd: TEST_ROOT }),
    ).rejects.toThrow(/ERR_SQUAD_INIT_CALLSIGN_EXISTS/);
  });

  it('returns reactivated for an active entry when callsign and path match', async () => {
    await seedRegistry([{
      callsign: 'my-squad',
      path: join(TEST_ROOT, '.squad'),
      clones: [],
      origins: [],
      status: 'active',
    }]);
    const result = await runInit({ cwd: TEST_ROOT, callsign: 'my-squad', registryPath: tempRegistry() });
    expect(result.reactivated).toBeDefined();
    expect(result.reactivated?.callsign).toBe('my-squad');
    expectScaffoldEntries(TEST_ROOT);
  });

  it('returns reactivated for an inactive entry when callsign and path match', async () => {
    await seedRegistry([{
      callsign: 'my-squad',
      path: join(TEST_ROOT, '.squad'),
      clones: [],
      origins: [],
      status: 'inactive',
    }]);
    const result = await runInit({ cwd: TEST_ROOT, callsign: 'my-squad', registryPath: tempRegistry() });
    expect(result.reactivated).toBeDefined();
    expect(result.reactivated?.callsign).toBe('my-squad');
    expectScaffoldEntries(TEST_ROOT);
  });
});

describe('isUrlLikeArg', () => {
  it('returns true for http:// URLs', () => {
    expect(isUrlLikeArg('http://example.com')).toBe(true);
  });

  it('returns true for https:// URLs', () => {
    expect(isUrlLikeArg('https://github.com/org/repo')).toBe(true);
  });

  it('returns true for git@ SSH shorthand', () => {
    expect(isUrlLikeArg('git@github.com:org/repo.git')).toBe(true);
  });

  it('returns true for ssh:// URLs', () => {
    expect(isUrlLikeArg('ssh://user@host/repo')).toBe(true);
  });

  it('returns true for protocol-relative URLs', () => {
    expect(isUrlLikeArg('//cdn.example.com')).toBe(true);
  });

  it('returns false for absolute filesystem paths', () => {
    expect(isUrlLikeArg('/home/user/project')).toBe(false);
  });

  it('returns false for relative paths', () => {
    expect(isUrlLikeArg('./my-project')).toBe(false);
  });

  it('returns false for callsign strings', () => {
    expect(isUrlLikeArg('my-team')).toBe(false);
  });
});
