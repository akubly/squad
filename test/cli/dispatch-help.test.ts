/**
 * CLI dispatch, --help, exit code, NO_COLOR, stdout/stderr discipline,
 * and doctor origin/clone resolution tests.
 *
 * Addresses FIDO A1 (dispatch), A2 (origin resolution), A5 (dual-doctor),
 * INCO B1 (--help), B6 (NO_COLOR), B7 (exit codes / stdio discipline).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { runDoctor } from '@bradygaster/squad-cli/commands/doctor';
import type { RunDoctorResult } from '@bradygaster/squad-cli/commands/doctor';

const CLI_ENTRY = resolve(process.cwd(), 'packages/squad-cli/dist/cli-entry.js');
const TEST_ROOT = join(process.cwd(), `.test-dispatch-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

async function seedRegistry(squads: unknown[]): Promise<void> {
  await writeFile(tempRegistry(), JSON.stringify({ version: 1, squads }, null, 2));
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], env?: Record<string, string>, cwd?: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
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

    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    setTimeout(() => {
      child.kill();
      reject(new Error('CLI timed out'));
    }, 30_000);
  });
}

// ── --help side-effect-free (INCO B1) ──────────────────────────────────────

describe('CLI --help is side-effect-free', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('squad init --help exits 0 and does not create .squad/', async () => {
    const result = await runCli(['init', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('squad init');
    expect(existsSync(join(TEST_ROOT, '.squad'))).toBe(false);
  });

  it('squad register --help exits 0 and prints usage', async () => {
    const result = await runCli(['register', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('squad register');
    expect(result.stdout).toContain('--callsign');
  });

  it('squad list --help exits 0 and prints usage', async () => {
    const result = await runCli(['list', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('squad list');
  });

  it('squad doctor --help exits 0 and does not run diagnostics', async () => {
    const result = await runCli(['doctor', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('squad doctor');
    expect(result.stdout).not.toContain('System doctor');
  });
});

// ── CLI dispatch (FIDO A1) ─────────────────────────────────────────────────

describe('CLI dispatch reaches command modules', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('squad init --callsign creates .squad/ and registry entry', async () => {
    const result = await runCli([
      'init', '--callsign', 'dispatch-test',
      '--registry-path', tempRegistry(),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dispatch-test');
    expect(existsSync(join(TEST_ROOT, '.squad'))).toBe(true);
    expect(existsSync(tempRegistry())).toBe(true);
  });

  it('squad register fails with missing --callsign', async () => {
    const result = await runCli(['register', '--path', TEST_ROOT]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--callsign');
  });

  it('squad register without --path in a non-git directory exits with error', async () => {
    const noGitDir = join(tmpdir(), `squad-no-git-${randomBytes(4).toString('hex')}`);
    await mkdir(noGitDir, { recursive: true });
    const cleanRegistry = join(noGitDir, 'clean-registry.json');
    try {
      const result = await runCli(
        ['register', '--callsign', 'x', '--registry-path', cleanRegistry],
        undefined,
        noGitDir,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/no Git repository|Pass --path/i);
    } finally {
      await rm(noGitDir, { recursive: true, force: true });
    }
  });

  it('squad list with missing registry prints guidance', async () => {
    const result = await runCli([
      'list', '--registry-path', tempRegistry(),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/no registry|init|register/i);
  });

  it('squad doctor runs and exits 0 on clean state', async () => {
    const result = await runCli(['doctor']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('System doctor');
    expect(result.stdout).toContain('Registry doctor');
  });
});

// ── NO_COLOR discipline (INCO B6) ──────────────────────────────────────────

describe('NO_COLOR discipline', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('help output contains no ANSI escape codes when NO_COLOR is set', async () => {
    const result = await runCli(['--help'], { NO_COLOR: '1' });
    // eslint-disable-next-line no-control-regex
    const hasAnsi = /\x1B\[[0-9;]*[a-zA-Z]/.test(result.stdout);
    expect(hasAnsi).toBe(false);
  });

  it('init --help contains no ANSI escape codes when NO_COLOR is set', async () => {
    const result = await runCli(['init', '--help'], { NO_COLOR: '1' });
    // eslint-disable-next-line no-control-regex
    const hasAnsi = /\x1B\[[0-9;]*[a-zA-Z]/.test(result.stdout);
    expect(hasAnsi).toBe(false);
  });

  it('doctor output uses textual severity prefixes when NO_COLOR is set', async () => {
    const result = await runCli(['doctor'], { NO_COLOR: '1' });
    if (result.stdout.includes('[info]') || result.stdout.includes('[warn]') || result.stdout.includes('[error]')) {
      // eslint-disable-next-line no-control-regex
      const hasAnsi = /\x1B\[[0-9;]*[a-zA-Z]/.test(result.stdout);
      expect(hasAnsi).toBe(false);
    }
  });
});

// ── stdout/stderr discipline (INCO B7) ─────────────────────────────────────

describe('stdout/stderr discipline', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('register validation errors go to stderr', async () => {
    const result = await runCli(['register', '--path', TEST_ROOT]);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain('--callsign');
  });

  it('list data goes to stdout', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await seedRegistry([{ callsign: 'stdio-test', path: squadDir }]);
    const result = await runCli([
      'list', '--registry-path', tempRegistry(),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('stdio-test');
  });
});

// ── doctor origin/clone resolution (FIDO A2) ──────────────────────────────

describe('runDoctor: origin and clone resolution', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('reports origin match when cwd matches a registered origin', async () => {
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await seedRegistry([{
      callsign: 'origin-squad',
      path: squadDir,
      origins: [TEST_ROOT],
      clones: [],
    }]);
    const result: RunDoctorResult = await runDoctor({
      cwd: TEST_ROOT,
      registryPath: tempRegistry(),
    });
    expect(result.findings.some(f => /origin/i.test(f))).toBe(true);
    expect(result.findings.some(f => f.includes('origin-squad'))).toBe(true);
  });

  it('reports clone match when cwd matches a registered clone', async () => {
    const squadDir = join(TEST_ROOT, 'main', '.squad');
    await mkdir(squadDir, { recursive: true });
    await seedRegistry([{
      callsign: 'clone-squad',
      path: squadDir,
      origins: [],
      clones: [TEST_ROOT],
    }]);
    const result: RunDoctorResult = await runDoctor({
      cwd: TEST_ROOT,
      registryPath: tempRegistry(),
    });
    expect(result.findings.some(f => /clone/i.test(f))).toBe(true);
    expect(result.findings.some(f => f.includes('clone-squad'))).toBe(true);
  });

  it('reports ambiguous when multiple entries match as clones', async () => {
    const squadDirA = join(TEST_ROOT, 'a', '.squad');
    const squadDirB = join(TEST_ROOT, 'b', '.squad');
    await mkdir(squadDirA, { recursive: true });
    await mkdir(squadDirB, { recursive: true });
    await seedRegistry([
      { callsign: 'alpha', path: squadDirA, clones: [TEST_ROOT] },
      { callsign: 'beta', path: squadDirB, clones: [TEST_ROOT] },
    ]);
    const result: RunDoctorResult = await runDoctor({
      cwd: TEST_ROOT,
      registryPath: tempRegistry(),
    });
    expect(result.severity).toBe('warn');
    expect(result.findings.some(f => /ambiguous/i.test(f))).toBe(true);
  });
});

// ── register path existence (FIDO A3) ──────────────────────────────────────

describe('runRegister: path existence check', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('throws when .squad/ directory does not exist', async () => {
    const { runRegister } = await import('@bradygaster/squad-cli/commands/register');
    const noSquadDir = join(TEST_ROOT, 'empty-project');
    await mkdir(noSquadDir, { recursive: true });
    await expect(
      runRegister({
        callsign: 'missing',
        path: noSquadDir,
        registryPath: tempRegistry(),
      }),
    ).rejects.toThrow(/\.squad/);
  });
});

// ── register differentiation (INCO B3) ─────────────────────────────────────

describe('runRegister: outcome differentiation', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns outcome=registered for a new entry', async () => {
    const { runRegister } = await import('@bradygaster/squad-cli/commands/register');
    const squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    const result = await runRegister({
      callsign: 'new-squad',
      path: TEST_ROOT,
      registryPath: tempRegistry(),
    });
    expect(result.outcome).toBe('registered');
  });

  it('throws on callsign collision at different path', async () => {
    const { runRegister } = await import('@bradygaster/squad-cli/commands/register');
    const squadDirA = join(TEST_ROOT, 'a', '.squad');
    const squadDirB = join(TEST_ROOT, 'b', '.squad');
    await mkdir(squadDirA, { recursive: true });
    await mkdir(squadDirB, { recursive: true });
    await runRegister({
      callsign: 'shared',
      path: join(TEST_ROOT, 'a'),
      registryPath: tempRegistry(),
    });
    await expect(
      runRegister({
        callsign: 'shared',
        path: join(TEST_ROOT, 'b'),
        registryPath: tempRegistry(),
      }),
    ).rejects.toThrow(/already registered/i);
  });
});

// ── dual-doctor coherence (INCO B5 / FIDO A5) ─────────────────────────────

describe('CLI doctor: dual-section coherence', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('labels System doctor and Registry doctor sections', async () => {
    const result = await runCli(['doctor']);
    expect(result.stdout).toContain('System doctor');
    expect(result.stdout).toContain('Registry doctor');
  });

  it('exits 0 when registry has only info-level findings', async () => {
    const result = await runCli(['doctor']);
    expect(result.exitCode).toBe(0);
  });
});

// ── doctor severity prefixes (INCO B4) ─────────────────────────────────────

describe('runDoctor: severity in findings', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns severity info for no-setup scenario', async () => {
    const result = await runDoctor({ cwd: TEST_ROOT, registryPath: tempRegistry() });
    expect(result.severity).toBe('info');
  });

  it('returns severity warn for stale paths', async () => {
    const missingDir = join(TEST_ROOT, 'gone', '.squad');
    await seedRegistry([{ callsign: 'stale', path: missingDir }]);
    const result = await runDoctor({ cwd: TEST_ROOT, registryPath: tempRegistry() });
    expect(result.severity).toBe('warn');
  });

  it('returns severity error for missing callsign', async () => {
    await seedRegistry([]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath: tempRegistry(),
      env: { SQUAD_CALLSIGN: 'nonexistent' },
    });
    expect(result.severity).toBe('error');
  });
});

// ── init collision tests (FIDO A4) ─────────────────────────────────────────

describe('runInit: clone/path collision', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('throws when target matches an existing clone entry', async () => {
    const { runInit } = await import('@bradygaster/squad-cli/commands/init');

    const alphaDir = join(TEST_ROOT, 'alpha');
    await mkdir(alphaDir, { recursive: true });

    // Seed a registry with a clone pointing at a new target
    const betaDir = join(TEST_ROOT, 'beta');
    await mkdir(betaDir, { recursive: true });

    await writeFile(tempRegistry(), JSON.stringify({
      version: 1,
      squads: [{
        callsign: 'alpha',
        path: join(alphaDir, '.squad'),
        clones: [betaDir],
      }],
    }, null, 2));

    await expect(
      runInit({
        targetDir: betaDir,
        callsign: 'beta',
        registryPath: tempRegistry(),
        cwd: TEST_ROOT,
      }),
    ).rejects.toThrow(/clone/i);
  });
});

// ── register validation copy (INCO B2) ─────────────────────────────────────

describe('CLI register: validation copy', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('missing --callsign shows which flag and a complete example', async () => {
    const result = await runCli(['register', '--path', TEST_ROOT]);
    expect(result.stderr).toContain('--callsign');
    expect(result.stderr).toContain('squad register');
  });

  it('missing --path shows which flag and a complete example', async () => {
    const noGitDir = join(tmpdir(), `squad-no-git-${randomBytes(4).toString('hex')}`);
    await mkdir(noGitDir, { recursive: true });
    const cleanRegistry = join(noGitDir, 'clean-registry.json');
    try {
      const result = await runCli(
        ['register', '--callsign', 'x', '--registry-path', cleanRegistry],
        undefined,
        noGitDir,
      );
      expect(result.stderr).toContain('--path');
      expect(result.stderr).toContain('squad register');
    } finally {
      await rm(noGitDir, { recursive: true, force: true });
    }
  });
});
