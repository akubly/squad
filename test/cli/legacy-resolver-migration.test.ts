/**
 * CLI resolver migration coverage for read-only commands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { resolveSquad } from '@bradygaster/squad-sdk';

const CLI_ENTRY = resolve(process.cwd(), 'packages/squad-cli/dist/cli-entry.js');
const TEST_ROOT = join(
  process.cwd(),
  `.test-legacy-resolver-${randomBytes(4).toString('hex')}`,
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
);

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface Fixture {
  hostRepo: string;
  hostSquad: string;
  consumerRepo: string;
  registryPath: string;
  relatedRepo: string;
}

function runCli(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('node', [CLI_ENTRY, ...args], {
      cwd,
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
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });

    setTimeout(() => {
      child.kill();
      reject(new Error('CLI timed out'));
    }, 30_000);
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function createFixture(): Promise<Fixture> {
  const hostRepo = join(TEST_ROOT, 'host');
  const hostSquad = join(hostRepo, '.squad');
  const consumerRepo = join(TEST_ROOT, 'consumer');
  const relatedRepo = join(TEST_ROOT, 'related');
  const registryPath = join(TEST_ROOT, 'registry.json');

  await mkdir(join(hostRepo, '.git'), { recursive: true });
  await mkdir(join(hostSquad, 'agents', 'control'), { recursive: true });
  await mkdir(join(consumerRepo, '.git'), { recursive: true });
  await mkdir(join(relatedRepo, '.squad'), { recursive: true });

  await writeFile(join(hostSquad, 'agents', 'control', 'charter.md'), '# CONTROL\n\nTypeScript Engineer\n', 'utf8');
  await writeJson(join(hostSquad, 'upstream.json'), {
    upstreams: [{ name: 'related-fixture', type: 'local', source: relatedRepo }],
  });
  await writeJson(join(relatedRepo, '.squad', 'manifest.json'), {
    name: 'related-fixture',
    capabilities: ['testing'],
    contact: { repo: 'contoso/related-fixture' },
    accepts: ['issues'],
  });
  await writeJson(registryPath, {
    version: 1,
    squads: [{ callsign: 'host', path: hostSquad, clones: [consumerRepo], origins: [] }],
  });

  return { hostRepo, hostSquad, consumerRepo, registryPath, relatedRepo };
}

describe('read-only CLI command resolver migration', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('fixture resolves registered consumer checkout through resolveSquad', async () => {
    const fixture = await createFixture();

    const result = resolveSquad({
      cwd: fixture.consumerRepo,
      env: { SQUAD_REGISTRY_PATH: fixture.registryPath },
    });

    expect(result).toMatchObject({
      path: fixture.hostSquad,
      source: 'clones',
      callsign: 'host',
    });
  });

  it('status resolves a registered consumer checkout', async () => {
    const fixture = await createFixture();

    const result = await runCli(['status'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Active squad:\s+.*repo/);
    expect(result.stdout).toContain(fixture.hostSquad);
    expect(result.stdout).not.toContain('Active squad: none');
  });

  it('discover resolves a registered consumer checkout', async () => {
    const fixture = await createFixture();

    const result = await runCli(['discover'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('related-fixture');
    expect(result.stdout).toContain('contoso/related-fixture');
  });

  it('discover honors --team-root from a different working directory', async () => {
    const fixture = await createFixture();

    const result = await runCli(['--team-root', fixture.consumerRepo, 'discover'], TEST_ROOT, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('related-fixture');
    expect(result.stdout).toContain('contoso/related-fixture');
  });

  it('discover honors SQUAD_TEAM_ROOT from a different working directory', async () => {
    const fixture = await createFixture();

    const result = await runCli(['discover'], TEST_ROOT, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
      SQUAD_TEAM_ROOT: fixture.consumerRepo,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('related-fixture');
    expect(result.stdout).toContain('contoso/related-fixture');
  });

  it('dev resolves a registered consumer checkout through config model status', async () => {
    const fixture = await createFixture();

    const result = await runCli(['config', 'model'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Model configuration');
    expect(result.stdout).toContain('Default model');
  });

  it('delegate resolves a registered consumer checkout before action execution', async () => {
    const fixture = await createFixture();
    await writeJson(join(fixture.relatedRepo, '.squad', 'manifest.json'), {
      name: 'related-fixture',
      capabilities: ['testing'],
      contact: { repo: 'contoso/related-fixture' },
      accepts: ['prs'],
    });

    const result = await runCli(['delegate', 'related-fixture', 'Fix the fixture'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('does not accept issues');
  });

  it('action commands keep legacy start-directory dispatch outside v2 resolution', async () => {
    const fixture = await createFixture();
    await writeJson(join(fixture.hostSquad, 'config.json'), {
      version: 1,
      teamRoot: fixture.hostSquad,
      projectKey: 'host',
      consult: true,
    });

    const result = await runCli(['consult', '--status'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Not in consult mode');
    expect(result.stdout).not.toContain('Consult mode active');
    expect(result.stdout).not.toContain(fixture.hostSquad);
  });
});

describe('user-action CLI command resolver migration', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    // Create a fake .git directory so findGitRoot stops here and does not walk up to
    // the outer repo root (D:\git\squad-replay) which has a real .squad/ directory.
    // Without this, resolveSquad() finds the outer squad and the resolver guard passes
    // when it should fail for these "no squad found" tests.
    await mkdir(join(TEST_ROOT, '.git'), { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // consult: resolver-failure paths

  it('consult setup does not create local .squad/ when no squad is found', async () => {
    const fixture = await createFixture();

    // Run from TEST_ROOT which is not in the registry clones list.
    const result = await runCli(['consult'], TEST_ROOT, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/no squad found/i);
    expect(existsSync(join(TEST_ROOT, '.squad', 'config.json'))).toBe(false);
  });

  it('consult --check does not create .squad/config.json when no squad is found', async () => {
    const fixture = await createFixture();

    const result = await runCli(['consult', '--check'], TEST_ROOT, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/no squad found/i);
    expect(existsSync(join(TEST_ROOT, '.squad', 'config.json'))).toBe(false);
  });

  it('consult --status from consumer repo still reports local project state', async () => {
    const fixture = await createFixture();
    // No local .squad/ in consumerRepo — --status must NOT fall back to resolved squad.
    const result = await runCli(['consult', '--status'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Not in consult mode');
    expect(result.stdout).not.toContain(fixture.hostSquad);
  });

  // link: resolver-failure and resolver-success paths

  it('link does not create .squad/config.json when no squad is found', async () => {
    const fixture = await createFixture();

    const result = await runCli(['link', fixture.hostRepo], TEST_ROOT, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/no squad found/i);
    expect(existsSync(join(TEST_ROOT, '.squad', 'config.json'))).toBe(false);
  });

  it('link creates .squad/config.json after resolving consumer checkout through registry', async () => {
    const fixture = await createFixture();

    // consumerRepo is a registered clone of 'host' — resolver succeeds, then link writes config.
    const result = await runCli(['link', fixture.hostRepo], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Linked to team root');
    const configPath = join(fixture.consumerRepo, '.squad', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf8'));
    expect(config.teamRoot).toBeTruthy();
  });

  // assign-to-copilot: resolver-success and resolver-failure paths

  it('assign-to-copilot reports already-assigned for registered consumer checkout', async () => {
    const fixture = await createFixture();

    // consumerRepo is already in the registry clones list for 'host'.
    const result = await runCli(['assign-to-copilot', '--callsign', 'host', '--no-install-agent'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/already assigned|assigned/i);
  });

  it('assign-to-copilot does not mutate registry when callsign is not found', async () => {
    const fixture = await createFixture();
    const registryBefore = await (await import('node:fs/promises')).readFile(fixture.registryPath, 'utf8');

    const result = await runCli(['assign-to-copilot', '--callsign', 'does-not-exist', '--no-install-agent'], fixture.consumerRepo, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).not.toBe(0);
    const registryAfter = await (await import('node:fs/promises')).readFile(fixture.registryPath, 'utf8');
    expect(registryAfter).toBe(registryBefore);
  });

  it('assign-to-copilot --dry-run reports intent without writing', async () => {
    const fixture = await createFixture();

    const result = await runCli(
      ['assign-to-copilot', '--callsign', 'host', '--dry-run', '--no-install-agent'],
      fixture.consumerRepo,
      { SQUAD_REGISTRY_PATH: fixture.registryPath },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Dry-run');
  });
});
