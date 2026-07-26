/**
 * CLI-layer tests for squad doctor registry maintenance commands.
 *
 * These tests spawn the built CLI binary and assert exit codes and output,
 * providing CLI-layer coverage that complements the unit tests in
 * packages/squad-cli/src/commands/__tests__/doctor.test.ts.
 *
 * Required coverage (spec §18 "Required CLI coverage"):
 *   - --help output text contains --normalize-callsigns and --purge
 *   - --purge with no argument → usage error exit code
 *   - --purge on active entry → CLI exits with code 2
 *   - Cancelled purge (user declines prompt) → exits 0
 *   - --normalize-callsigns dry-run → exits 0, registry unchanged on disk
 *   - --normalize-callsigns --apply → writes registry ONLY when collision pair exists
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const CLI_ENTRY = resolve(process.cwd(), 'packages/squad-cli/dist/cli-entry.js');
const TEST_ROOT = join(process.cwd(), `.test-doctor-cli-${randomBytes(4).toString('hex')}`);

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_ENTRY, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    setTimeout(() => {
      child.kill();
      reject(new Error('CLI timed out after 30s'));
    }, 30_000);
  });
}

function makeDir(rel: string): string {
  const dir = join(TEST_ROOT, rel);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRegistry(registryPath: string, squads: unknown[]): void {
  mkdirSync(join(registryPath, '..'), { recursive: true });
  writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
}

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ── CLI1 ─────────────────────────────────────────────────────────────────────

describe('CLI doctor --help', () => {
  it('CLI1 help text contains --normalize-callsigns and --purge', async () => {
    const result = await runCli(['doctor', '--help']);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('--normalize-callsigns');
    expect(combined).toContain('--purge');
    expect(result.exitCode).toBe(0);
  });
});

// ── CLI2 ─────────────────────────────────────────────────────────────────────

describe('CLI doctor --purge argument validation', () => {
  it('CLI2 --purge with no argument exits with non-zero usage error code', async () => {
    const registryPath = join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, []);
    const result = await runCli(['doctor', '--purge', '--registry-path', registryPath]);
    expect(result.exitCode).not.toBe(0);
  });
});

// ── CLI3 ─────────────────────────────────────────────────────────────────────

describe('CLI doctor --purge on active entry', () => {
  it('CLI3 --purge on active entry with consumers exits with code 2', async () => {
    const hostDir = makeDir('host-cli3');
    const cloneDir = makeDir('clone-cli3');
    const registryPath = join(TEST_ROOT, 'registry-cli3.json');
    writeRegistry(registryPath, [{
      callsign: 'active-squad',
      path: join(hostDir, '.squad'),
      clones: [cloneDir],
      status: 'active',
    }]);
    const result = await runCli([
      'doctor', '--purge', 'active-squad',
      '--yes', '--registry-path', registryPath,
    ]);
    expect(result.exitCode).toBe(2);
  });
});

// ── CLI4 ─────────────────────────────────────────────────────────────────────

describe('CLI doctor --purge cancelled', () => {
  it('CLI4 cancelled purge (user declines prompt) exits 0', async () => {
    const hostDir = makeDir('host-cli4');
    const registryPath = join(TEST_ROOT, 'registry-cli4.json');
    writeRegistry(registryPath, [{
      callsign: 'beta',
      path: join(hostDir, '.squad'),
      clones: [],
      status: 'inactive',
    }]);
    // Send 'n' to stdin to decline the confirmation prompt
    const result = await runCli(
      ['doctor', '--purge', 'beta', '--registry-path', registryPath],
      { stdin: 'n\n' },
    );
    expect(result.exitCode).toBe(0);
    // Registry must be unchanged
    const reg = JSON.parse(readFileSync(registryPath, 'utf8')) as { squads: unknown[] };
    expect(reg.squads).toHaveLength(1);
  });
});

// ── CLI5 ─────────────────────────────────────────────────────────────────────

describe('CLI doctor --normalize-callsigns dry-run', () => {
  it('CLI5 dry-run exits 0 and leaves registry file unchanged', async () => {
    const hostA = makeDir('host-cli5a');
    const hostB = makeDir('host-cli5b');
    const registryPath = join(TEST_ROOT, 'registry-cli5.json');
    writeRegistry(registryPath, [
      { callsign: 'squad', path: join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'Squad', path: join(hostB, '.squad'), clones: [], status: 'active' },
    ]);
    const before = readFileSync(registryPath, 'utf8');
    const result = await runCli([
      'doctor', '--normalize-callsigns', '--registry-path', registryPath,
    ]);
    const after = readFileSync(registryPath, 'utf8');
    expect(result.exitCode).toBe(0);
    expect(after).toBe(before);
  });
});

// ── CLI6 ─────────────────────────────────────────────────────────────────────

describe('CLI doctor --normalize-callsigns --apply', () => {
  it('CLI6a --apply writes registry when a collision pair exists', async () => {
    const hostA = makeDir('host-cli6a');
    const hostB = makeDir('host-cli6b');
    const registryPath = join(TEST_ROOT, 'registry-cli6a.json');
    writeRegistry(registryPath, [
      { callsign: 'myteam', path: join(hostA, '.squad'), clones: [], status: 'active' },
      { callsign: 'MyTeam', path: join(hostB, '.squad'), clones: [], status: 'active' },
    ]);
    const before = readFileSync(registryPath, 'utf8');
    const result = await runCli([
      'doctor', '--normalize-callsigns', '--apply', '--yes',
      '--registry-path', registryPath,
    ]);
    const after = readFileSync(registryPath, 'utf8');
    expect(result.exitCode).toBe(0);
    expect(after).not.toBe(before);
    const reg = JSON.parse(after) as { squads: unknown[] };
    expect(reg.squads).toHaveLength(1);
  });

  it('CLI6b --apply leaves registry unchanged when no collision pair exists', async () => {
    const hostA = makeDir('host-cli6c');
    const registryPath = join(TEST_ROOT, 'registry-cli6b.json');
    writeRegistry(registryPath, [
      { callsign: 'unique', path: join(hostA, '.squad'), clones: [], status: 'active' },
    ]);
    const before = readFileSync(registryPath, 'utf8');
    const result = await runCli([
      'doctor', '--normalize-callsigns', '--apply', '--yes',
      '--registry-path', registryPath,
    ]);
    const after = readFileSync(registryPath, 'utf8');
    expect(result.exitCode).toBe(0);
    expect(after).toBe(before);
  });
});
