/**
 * init conflict guard tests and existing-scaffold registration behavior.
 *
 * Covers:
 *   - ERR_SQUAD_INIT_EXISTING_SCAFFOLD (symlink case only)
 *   - ERR_SQUAD_INIT_CALLSIGN_EXISTS
 *   - ERR_SQUAD_INIT_CLONE_PATH_EXISTS
 *   - Existing scaffold registration (no clobber)
 *   - URL positional rejection at the CLI routing layer
 *
 * Each group verifies: error code in message, no filesystem mutation after
 * conflict, and correct CLI exit code at the process boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import fs from 'fs';
import { ConfigurationError } from '@bradygaster/squad-sdk/adapter/errors';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { runInit } from '@bradygaster/squad-cli/commands/init';

const CLI_ENTRY = resolve(process.cwd(), 'packages/squad-cli/dist/cli-entry.js');
const TEST_ROOT = join(process.cwd(), `.test-init-scope-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

function expectScaffoldEntries(targetDir: string): void {
  expect(existsSync(join(targetDir, '.squad'))).toBe(true);
  expect(existsSync(join(targetDir, '.squad', 'agents'))).toBe(true);
}

function expectConfigurationError(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(ConfigurationError);
  expect((err as Error).message).toContain(code);
}

async function expectRunInitConfigurationError(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.catch(e => e as unknown);
  expectConfigurationError(err, code);
}

async function seedRegistry(squads: unknown[]): Promise<void> {
  await writeFile(tempRegistry(), JSON.stringify({ version: 1, squads }, null, 2));
}

interface SpawnResult { stdout: string; stderr: string; exitCode: number }

function runCli(args: string[], env?: Record<string, string>, cwd?: string): Promise<SpawnResult> {
  return new Promise((res, rej) => {
    const child = spawn('node', [CLI_ENTRY, ...args], {
      cwd: cwd ?? TEST_ROOT,
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', rej);
    child.on('exit', code => { res({ stdout, stderr, exitCode: code ?? 1 }); });
    setTimeout(() => { child.kill(); rej(new Error('CLI timed out')); }, 30_000);
  });
}

// ---------------------------------------------------------------------------
// Scaffold conflict
// ---------------------------------------------------------------------------

describe('runInit: existing scaffold behavior', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('succeeds without clobbering sentinel file when .squad/team.md already exists', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Existing Team\n');
    await expect(
      runInit({ cwd: TEST_ROOT, noRegister: true }),
    ).resolves.toBeDefined();
    expect(readFileSync(join(squadDir, 'team.md'), 'utf-8')).toBe('# Existing Team\n');
  });

  it('agents/ directory is not created when scaffold already exists', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Existing Team\n');
    await runInit({ cwd: TEST_ROOT, noRegister: true });
    expect(existsSync(join(squadDir, 'agents'))).toBe(false);
  });

  it('sentinel file content is preserved when existing scaffold is reused', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    const teamMdPath = join(squadDir, 'team.md');
    await writeFile(teamMdPath, '# Preserved\n');
    await runInit({ cwd: TEST_ROOT, noRegister: true });
    expect(readFileSync(teamMdPath, 'utf-8')).toBe('# Preserved\n');
  });

  it('--no-register with existing scaffold succeeds without writing a registry entry', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Team\n');
    const result = await runInit({ cwd: TEST_ROOT, noRegister: true, callsign: 'test', registryPath: tempRegistry() });
    expect(existsSync(tempRegistry())).toBe(false);
    expect(result.registered).toBeUndefined();
  });

  it('existing scaffold is registered without clobbering sentinel when callsign and registry are given', async () => {
    const registryEntry = { callsign: 'baseline', path: join(TEST_ROOT, 'baseline', '.squad'), clones: [], origins: [], status: 'active' };
    await seedRegistry([registryEntry]);
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Team\n');
    const result = await runInit({ cwd: TEST_ROOT, callsign: 'alpha', registryPath: tempRegistry() });
    expect(result.registered?.callsign).toBe('alpha');
    expect(readFileSync(join(squadDir, 'team.md'), 'utf-8')).toBe('# Team\n');
  });

  it('ERR_SQUAD_INIT_EXISTING_SCAFFOLD is thrown when .squad/ is a symbolic link', async () => {
    // Symlinks are the one case where init must still reject.
    const realDir = join(TEST_ROOT, 'real-squad');
    await mkdir(realDir, { recursive: true });
    const linkPath = join(TEST_ROOT, '.squad');
    try {
      fs.symlinkSync(realDir, linkPath, 'dir');
    } catch {
      // Skip on platforms where symlink creation requires elevated privileges
      return;
    }
    await expectRunInitConfigurationError(
      runInit({ cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_EXISTING_SCAFFOLD',
    );
  });
});

// ---------------------------------------------------------------------------
// Callsign conflict
// ---------------------------------------------------------------------------

describe('runInit: fail-fast — callsign collision', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('throws ERR_SQUAD_INIT_CALLSIGN_EXISTS for an explicit --callsign collision', async () => {
    const otherPath = join(TEST_ROOT, 'other', '.squad');
    await seedRegistry([{ callsign: 'alpha', path: otherPath, clones: [], origins: [], status: 'active' }]);
    const targetDir = join(TEST_ROOT, 'new-project');
    await expectRunInitConfigurationError(
      runInit({ targetDir, callsign: 'alpha', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CALLSIGN_EXISTS',
    );
  });

  it('error message contains the conflicting callsign and existing path', async () => {
    const otherPath = join(TEST_ROOT, 'other', '.squad');
    await seedRegistry([{ callsign: 'alpha', path: otherPath, clones: [], origins: [], status: 'active' }]);
    const targetDir = join(TEST_ROOT, 'new-project');
    const err = await runInit({ targetDir, callsign: 'alpha', registryPath: tempRegistry(), cwd: TEST_ROOT }).catch(e => e as Error);
    expect(err.message).toContain('"alpha"');
    expect(err.message).toContain(otherPath);
  });

  it('throws ERR_SQUAD_INIT_CALLSIGN_EXISTS for a derived callsign collision', async () => {
    // Target dir named 'alpha'; registry already has 'alpha' at a different path.
    const otherPath = join(TEST_ROOT, 'other', '.squad');
    await seedRegistry([{ callsign: 'alpha', path: otherPath, clones: [], origins: [], status: 'active' }]);
    const targetDir = join(TEST_ROOT, 'alpha');
    await expectRunInitConfigurationError(
      runInit({ targetDir, registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CALLSIGN_EXISTS',
    );
  });

  it('no scaffold files created and registry remains unchanged after callsign conflict', async () => {
    const otherPath = join(TEST_ROOT, 'other', '.squad');
    await seedRegistry([{ callsign: 'alpha', path: otherPath, clones: [], origins: [], status: 'active' }]);
    const registryBefore = readFileSync(tempRegistry(), 'utf-8');
    const targetDir = join(TEST_ROOT, 'new-project');
    await expectRunInitConfigurationError(
      runInit({ targetDir, callsign: 'alpha', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CALLSIGN_EXISTS',
    );
    expect(existsSync(join(targetDir, '.squad'))).toBe(false);
    expect(readFileSync(tempRegistry(), 'utf-8')).toBe(registryBefore);
  });
});

// ---------------------------------------------------------------------------
// Guard order
// ---------------------------------------------------------------------------

describe('runInit: fail-fast guard order', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('reports callsign conflict when scaffold already exists and callsign is taken at a different path', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Team\n');
    await seedRegistry([{ callsign: 'alpha', path: join(TEST_ROOT, 'other', '.squad'), clones: [], origins: [], status: 'active' }]);

    await expectRunInitConfigurationError(
      runInit({ cwd: TEST_ROOT, callsign: 'alpha', registryPath: tempRegistry() }),
      'ERR_SQUAD_INIT_CALLSIGN_EXISTS',
    );
  });

  it('reports callsign conflict before clone-path conflict when both are present', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    await mkdir(cloneRoot, { recursive: true });
    await seedRegistry([
      { callsign: 'alpha', path: join(TEST_ROOT, 'other', '.squad'), clones: [], origins: [], status: 'active' },
      { callsign: 'primary', path: join(TEST_ROOT, 'primary', '.squad'), clones: [cloneRoot], origins: [], status: 'active' },
    ]);

    await expectRunInitConfigurationError(
      runInit({ targetDir: cloneRoot, callsign: 'alpha', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CALLSIGN_EXISTS',
    );
  });

  it('reports callsign conflict when scaffold and registry conflicts would both match', async () => {
    const cloneRoot = TEST_ROOT;
    const squadDir = join(cloneRoot, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Team\n');
    await seedRegistry([
      { callsign: 'alpha', path: join(TEST_ROOT, 'other', '.squad'), clones: [], origins: [], status: 'active' },
      { callsign: 'primary', path: join(TEST_ROOT, 'primary', '.squad'), clones: [cloneRoot], origins: [], status: 'active' },
    ]);

    await expectRunInitConfigurationError(
      runInit({ cwd: TEST_ROOT, callsign: 'alpha', registryPath: tempRegistry() }),
      'ERR_SQUAD_INIT_CALLSIGN_EXISTS',
    );
  });
});

// ---------------------------------------------------------------------------
// Clone-path conflict
// ---------------------------------------------------------------------------

describe('runInit: fail-fast — clone-path collision', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('throws ERR_SQUAD_INIT_CLONE_PATH_EXISTS when init dir is a registered clone root', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    await mkdir(cloneRoot, { recursive: true });
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    await expectRunInitConfigurationError(
      runInit({ targetDir: cloneRoot, callsign: 'clone-attempt', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CLONE_PATH_EXISTS',
    );
  });

  it('uses cwd for clone-path conflict detection when targetDir is omitted', async () => {
    const cloneRoot = TEST_ROOT;
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    await expectRunInitConfigurationError(
      runInit({ callsign: 'cwd-attempt', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CLONE_PATH_EXISTS',
    );
  });

  it('throws when init dir is a child of a registered clone root', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    const childDir = join(cloneRoot, 'sub', 'project');
    await mkdir(childDir, { recursive: true });
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    await expectRunInitConfigurationError(
      runInit({ targetDir: childDir, callsign: 'nested', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CLONE_PATH_EXISTS',
    );
  });

  it('does NOT throw for a sibling prefix directory (repo vs repo-tools)', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    const siblingDir = join(TEST_ROOT, 'clones', 'repo-tools');
    await mkdir(cloneRoot, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    // repo-tools is NOT a child of repo; must not match.
    await expect(
      runInit({ targetDir: siblingDir, callsign: 'tools', registryPath: tempRegistry(), cwd: TEST_ROOT }),
    ).resolves.toBeDefined();
  });

  it('error message contains the conflicting callsign', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    await mkdir(cloneRoot, { recursive: true });
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    const err = await runInit({
      targetDir: cloneRoot, callsign: 'x', registryPath: tempRegistry(), cwd: TEST_ROOT,
    }).catch(e => e as Error);
    expect(err.message).toContain('primary');
    expect(err.message).toContain('already registered as a clone');
  });

  it('no scaffold files created and registry remains unchanged after clone-path conflict', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    await mkdir(cloneRoot, { recursive: true });
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    const registryBefore = readFileSync(tempRegistry(), 'utf-8');
    await expectRunInitConfigurationError(
      runInit({ targetDir: cloneRoot, callsign: 'x', registryPath: tempRegistry(), cwd: TEST_ROOT }),
      'ERR_SQUAD_INIT_CLONE_PATH_EXISTS',
    );
    expect(existsSync(join(cloneRoot, '.squad'))).toBe(false);
    expect(readFileSync(tempRegistry(), 'utf-8')).toBe(registryBefore);
  });
});

// ---------------------------------------------------------------------------
// Clean init still works
// ---------------------------------------------------------------------------

describe('runInit: clean init paths remain functional', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('clean init with --callsign creates .squad/ and registers the callsign', async () => {
    const targetDir = join(TEST_ROOT, 'project');
    const result = await runInit({ targetDir, callsign: 'my-squad', registryPath: tempRegistry(), cwd: TEST_ROOT });
    expectScaffoldEntries(targetDir);
    expect(result.registered?.callsign).toBe('my-squad');
  });

  it('clean init without --callsign derives the target basename', async () => {
    const targetDir = join(TEST_ROOT, 'derived-name');
    const result = await runInit({ targetDir, registryPath: tempRegistry(), cwd: TEST_ROOT });
    expectScaffoldEntries(targetDir);
    expect(result.registered?.callsign).toBe('derived-name');
  });

  it('--no-register creates scaffold without writing the registry', async () => {
    const targetDir = join(TEST_ROOT, 'scaffolded');
    const result = await runInit({
      targetDir,
      callsign: 'x',
      registryPath: tempRegistry(),
      noRegister: true,
      cwd: TEST_ROOT,
    });
    expectScaffoldEntries(targetDir);
    expect(existsSync(tempRegistry())).toBe(false);
    expect(result.registered).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CLI-level: exit code 2 for conflict errors
// ---------------------------------------------------------------------------

describe('CLI: init conflict errors exit with code 2', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('exits 0 when existing .squad/ has sentinel files and registration is requested', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await writeFile(join(squadDir, 'team.md'), '# Team\n');
    const result = await runCli(
      ['init', '--callsign', 'existing-squad', '--registry-path', tempRegistry()],
      { SQUAD_REGISTRY_PATH: '' },
      TEST_ROOT,
    );
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(squadDir, 'team.md'), 'utf-8')).toBe('# Team\n');
  });

  it('exits 2 and writes to stderr on ERR_SQUAD_INIT_CALLSIGN_EXISTS', async () => {
    const otherPath = join(TEST_ROOT, 'other', '.squad');
    await seedRegistry([{ callsign: 'alpha', path: otherPath, clones: [], origins: [], status: 'active' }]);
    const targetDir = join(TEST_ROOT, 'new-project');
    await mkdir(targetDir, { recursive: true });
    const result = await runCli(
      ['init', '--target-dir', targetDir, '--callsign', 'alpha', '--registry-path', tempRegistry()],
      { SQUAD_REGISTRY_PATH: '' },
      TEST_ROOT,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Error: ERR_SQUAD_INIT_CALLSIGN_EXISTS');
    expect(result.stderr).toContain('callsign \"alpha\" is already registered');
  });

  it('exits 2 and writes to stderr on ERR_SQUAD_INIT_CLONE_PATH_EXISTS', async () => {
    const cloneRoot = join(TEST_ROOT, 'clones', 'repo');
    await mkdir(cloneRoot, { recursive: true });
    const squadPath = join(TEST_ROOT, 'primary', '.squad');
    await seedRegistry([{
      callsign: 'primary',
      path: squadPath,
      clones: [cloneRoot],
      origins: [],
      status: 'active',
    }]);
    const result = await runCli(
      ['init', '--target-dir', cloneRoot, '--callsign', 'attempt', '--registry-path', tempRegistry()],
      { SQUAD_REGISTRY_PATH: '' },
      TEST_ROOT,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Error: ERR_SQUAD_INIT_CLONE_PATH_EXISTS');
    expect(result.stderr).toContain('already registered as a clone');
  });
});

// ---------------------------------------------------------------------------
// CLI: URL positional rejection
// ---------------------------------------------------------------------------

describe('CLI: URL positional argument rejection', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  const homeRegistryPath = join(TEST_ROOT, 'home', 'registry.json');
  const explicitRegistryPath = tempRegistry();
  const urlGuardCases = [
    {
      label: 'http:// URL positional',
      args: ['init', 'http://example.com/repo.git'],
      expectedRegistryPath: homeRegistryPath,
    },
    {
      label: 'ssh:// URL positional',
      args: ['init', 'ssh://git@example.com/repo.git'],
      expectedRegistryPath: homeRegistryPath,
    },
    {
      label: 'scp-style URL positional',
      args: ['init', 'git@example.com:foo/repo.git'],
      expectedRegistryPath: homeRegistryPath,
    },
    {
      label: 'git+https:// URL positional',
      args: ['init', 'git+https://example.com/repo.git'],
      expectedRegistryPath: homeRegistryPath,
    },
    {
      label: 'file:// URL positional',
      args: ['init', 'file:///tmp/repo'],
      expectedRegistryPath: homeRegistryPath,
    },
    {
      label: 'URL positional after a value-taking option',
      args: ['init', '--registry-path', explicitRegistryPath, 'https://example.com/r.git'],
      expectedRegistryPath: explicitRegistryPath,
    },
  ] as const;

  it.each(urlGuardCases)('rejects $label before mutating local state', async ({ args, expectedRegistryPath }) => {
    const result = await runCli(
      args,
      { SQUAD_HOME: join(TEST_ROOT, 'home'), SQUAD_REGISTRY_PATH: '' },
      TEST_ROOT,
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--target-dir');
    expect(existsSync(join(TEST_ROOT, '.squad'))).toBe(false);
    expect(existsSync(expectedRegistryPath)).toBe(false);
  });
});
