/**
 * Removal-contract tests for the `register` subcommand.
 *
 * `squad register` is no longer a supported command. Users bind a checkout to
 * a registered squad with `squad assign` and create a new squad host with
 * `squad init`. These tests pin the teaching-error contract and verify that
 * the removed command no longer appears on the public CLI surface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';

const CLI_ENTRY = resolve(process.cwd(), 'packages/squad-cli/dist/cli-entry.js');
const TEST_ROOT = join(process.cwd(), `.test-register-removed-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], env?: Record<string, string>): Promise<SpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [CLI_ENTRY, ...args], {
      cwd: TEST_ROOT,
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
    });

    setTimeout(() => {
      child.kill();
      rejectPromise(new Error('CLI timed out'));
    }, 30_000);
  });
}

describe('register removal — teaching error', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('bare `register` exits 2 and writes the teaching error to stderr', async () => {
    const result = await runCli(['register'], { SQUAD_REGISTRY_PATH: tempRegistry() });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('ERR_SQUAD_REGISTER_REMOVED');
    expect(result.stderr).toContain('squad register has been removed');
    expect(result.stderr).toMatch(/squad assign\s+<callsign>/);
    expect(result.stderr).toContain('squad init --callsign');
    expect(result.stderr).toContain('squad list');
  });

  it('`register` with old flags returns the same teaching error and does not create a registry file', async () => {
    const registryPath = tempRegistry();
    const result = await runCli(
      ['register', '--callsign', 'alpha', '--path', TEST_ROOT, '--registry-path', registryPath],
      { SQUAD_REGISTRY_PATH: registryPath },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('ERR_SQUAD_REGISTER_REMOVED');
    expect(result.stderr).toMatch(/squad assign\s+<callsign>/);
    // No suggestion to re-run `register` in any form.
    expect(result.stderr).not.toMatch(/(try|run|use).*squad register/i);
    expect(existsSync(registryPath)).toBe(false);
  });

  it('teaching error message does not propose `register` as a remedy', async () => {
    const result = await runCli(['register', '--origin', 'https://example.test/x.git']);
    expect(result.exitCode).toBe(2);
    // The replacement guidance must not loop the user back to the removed command.
    const lower = result.stderr.toLowerCase();
    expect(lower).not.toContain('try: squad register');
    expect(lower).not.toContain('run squad register');
    expect(lower).not.toContain('use squad register');
  });
});

describe('register removal — help surface cleanup', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('`squad help` does not list `register` as a command', async () => {
    const result = await runCli(['help']);
    expect(result.exitCode).toBe(0);
    // Match a help-table line that names register as a command, not incidental prose.
    expect(result.stdout).not.toMatch(/^\s*register\s+\S/m);
    expect(result.stdout).not.toMatch(/squad register --callsign/);
  });

  it('`squad --help` does not list `register` as a command', async () => {
    const result = await runCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/^\s*register\s+\S/m);
  });

  it('`squad help register` does not print a register subcommand help page', async () => {
    const result = await runCli(['help', 'register']);
    // Either a usage line is absent, or the command falls through to the
    // teaching error / general help. Either way, no positive register usage.
    expect(result.stdout).not.toMatch(/^Usage:\s+squad register/m);
    expect(result.stdout).not.toMatch(/Register a squad path/);
  });
});

describe('register removal — public package surface', () => {
  it('CLI package no longer exports `./commands/register`', async () => {
    const pkgPath = resolve(process.cwd(), 'packages/squad-cli/package.json');
    const raw = await readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { exports?: Record<string, unknown> };
    expect(pkg.exports).toBeDefined();
    expect(Object.keys(pkg.exports ?? {})).not.toContain('./commands/register');
  });

  it('register command implementation module is removed', () => {
    const modPath = resolve(process.cwd(), 'packages/squad-cli/src/commands/register.ts');
    expect(existsSync(modPath)).toBe(false);
  });
});

describe('register removal — stale guidance cleanup', () => {
  it('list, doctor, and assign command modules no longer point users at `squad register`', async () => {
    const candidates = [
      resolve(process.cwd(), 'packages/squad-cli/src/commands/list.ts'),
      resolve(process.cwd(), 'packages/squad-cli/src/commands/doctor.ts'),
      resolve(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'),
      resolve(process.cwd(), 'packages/squad-cli/src/commands/init.ts'),
    ];
    for (const file of candidates) {
      if (!existsSync(file)) continue;
      const contents = await readFile(file, 'utf8');
      expect(contents, `${file} must not advise running 'squad register'`)
        .not.toMatch(/squad register/);
    }
  });

  it('cli-entry no longer routes the `register` command to a writer', async () => {
    const entryPath = resolve(process.cwd(), 'packages/squad-cli/src/cli-entry.ts');
    const contents = await readFile(entryPath, 'utf8');
    // No import of the removed module under any name.
    expect(contents).not.toMatch(/from\s+['"]\.\/commands\/register(\.js)?['"]/);
    expect(contents).not.toMatch(/runRegister/);
  });
});
