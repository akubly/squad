/**
 * Registry register command tests.
 * Covers runRegister validation and entry write behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { runRegister } from '@bradygaster/squad-cli/commands/register';

const TEST_ROOT = join(process.cwd(), `.test-register-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

describe('runRegister: required flags', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('fails with usage text when callsign is empty', async () => {
    await expect(
      runRegister({ callsign: '', path: TEST_ROOT, registryPath: tempRegistry() }),
    ).rejects.toThrow(/callsign/i);
  });

  it('fails with usage text when path is omitted and no inference is possible', async () => {
    // Initialize a git repo in TEST_ROOT so getGitRoot returns TEST_ROOT,
    // but create no .squad directories so inference fails.
    const { spawnSync } = await import('child_process');
    spawnSync('git', ['init'], { cwd: TEST_ROOT, stdio: 'ignore' });
    await expect(
      runRegister({ callsign: 'test-no-path', cwd: TEST_ROOT, registryPath: tempRegistry() }),
    ).rejects.toThrow(/path/i);
  });
});

describe('runRegister: entry write', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('writes a valid registry entry for an existing .squad/ path and returns registered callsign and path', async () => {
    const result = await runRegister({ callsign: 'test-squad', path: squadDir, registryPath: tempRegistry(), installAgent: false });
    expect(result.registered.callsign).toBe('test-squad');
    expect(result.registered.path).toBe(squadDir);
    expect(existsSync(tempRegistry())).toBe(true);
    const reg = JSON.parse(readFileSync(tempRegistry(), 'utf-8'));
    expect(reg.squads).toHaveLength(1);
    expect(reg.squads[0].callsign).toBe('test-squad');
    expect(reg.squads[0].path).toBe(squadDir);
  });

  it('accepts project root path and resolves the .squad/ subdirectory', async () => {
    const result = await runRegister({ callsign: 'project-squad', path: TEST_ROOT, registryPath: tempRegistry(), installAgent: false });
    expect(result.registered.path).toBe(squadDir);
  });

  it('preserves unknown fields in existing registry entries during write', async () => {
    const existingReg = {
      version: 1,
      squads: [{ callsign: 'existing', path: squadDir, origins: ['https://github.com/org/repo'] }],
    };
    await import('fs/promises').then(({ writeFile }) =>
      writeFile(tempRegistry(), JSON.stringify(existingReg, null, 2)),
    );
    const anotherSquad = join(TEST_ROOT, 'another', '.squad');
    await mkdir(anotherSquad, { recursive: true });
    await runRegister({ callsign: 'new-squad', path: anotherSquad, registryPath: tempRegistry(), installAgent: false });
    const reg = JSON.parse(readFileSync(tempRegistry(), 'utf-8'));
    const existingEntry = reg.squads.find((e: { callsign: string }) => e.callsign === 'existing');
    expect(existingEntry?.origins).toEqual(['https://github.com/org/repo']);
  });
});

