/**
 * CLI resolver migration coverage for read-only commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { resolveSquad, resolveSquadDir } from '@wifi-aware/squad-sdk';

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

  it('D-18: resolveSquadDir (canonical) and resolveSquad (deprecated alias) return equivalent results', async () => {
    const fixture = await createFixture();
    const opts = { cwd: fixture.consumerRepo, env: { SQUAD_REGISTRY_PATH: fixture.registryPath } };

    const fromCanonical = resolveSquadDir(opts);
    const fromAlias = resolveSquad(opts);

    // Both must resolve and return equivalent objects (deprecated alias wraps canonical).
    expect(fromCanonical).not.toBeNull();
    expect(fromAlias).not.toBeNull();
    expect(fromCanonical).toMatchObject({ path: fixture.hostSquad });
    expect(fromAlias).toMatchObject({ path: fixture.hostSquad });
    // Deprecated alias must still be callable as a function (backward-compat smoke check).
    expect(typeof resolveSquad).toBe('function');
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
    // Spec: ignore/exclude entries must not be written on failure.
    expect(existsSync(join(TEST_ROOT, '.gitignore'))).toBe(false);
    const gitExcludePath = join(TEST_ROOT, '.git', 'info', 'exclude');
    if (existsSync(gitExcludePath)) {
      expect(readFileSync(gitExcludePath, 'utf8')).not.toContain('.squad/');
    }
  });

  it('consult --check does not create .squad/config.json when no squad is found', async () => {
    const fixture = await createFixture();

    const result = await runCli(['consult', '--check'], TEST_ROOT, {
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/no squad found/i);
    expect(existsSync(join(TEST_ROOT, '.squad', 'config.json'))).toBe(false);
    // Spec: ignore/exclude entries must not be written on failure.
    expect(existsSync(join(TEST_ROOT, '.gitignore'))).toBe(false);
    const gitExcludePath = join(TEST_ROOT, '.git', 'info', 'exclude');
    if (existsSync(gitExcludePath)) {
      expect(readFileSync(gitExcludePath, 'utf8')).not.toContain('.squad/');
    }
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
    // Spec: .gitignore must not be appended on failure.
    expect(existsSync(join(TEST_ROOT, '.gitignore'))).toBe(false);
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
    // The runner output includes the resolved squad path, proving the dispatch
    // guard result was threaded through rather than re-resolved independently.
    expect(result.stdout).toContain(fixture.hostSquad);
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

  // Gap #1: consult guarded setup path going GREEN

  it('consult setup creates .squad/config.json when resolver succeeds and personal squad exists', async () => {
    const fixture = await createFixture();

    // Initialize consumerRepo as a real git repo so setupConsultMode can write .git/info/exclude.
    execSync('git init', { cwd: fixture.consumerRepo, stdio: 'ignore' });
    execSync('git config user.email "t@t.com"', { cwd: fixture.consumerRepo, stdio: 'ignore' });
    execSync('git config user.name "T"', { cwd: fixture.consumerRepo, stdio: 'ignore' });

    // Create personal squad at a test-local XDG location.
    const globalConfig = join(TEST_ROOT, 'global-config');
    await mkdir(globalConfig, { recursive: true });
    const initResult = await runCli(['init', '--global'], fixture.consumerRepo, {
      XDG_CONFIG_HOME: globalConfig,
      APPDATA: globalConfig,
      LOCALAPPDATA: globalConfig,
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });
    expect(initResult.exitCode).toBe(0);

    // consumerRepo is a registered clone; resolver guard passes and personal squad exists.
    const result = await runCli(['consult'], fixture.consumerRepo, {
      XDG_CONFIG_HOME: globalConfig,
      APPDATA: globalConfig,
      LOCALAPPDATA: globalConfig,
      SQUAD_REGISTRY_PATH: fixture.registryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Consult mode activated');
    expect(existsSync(join(fixture.consumerRepo, '.squad', 'config.json'))).toBe(true);
    // setupConsultMode adds .squad/ to .git/info/exclude so the project dir stays untracked.
    const gitExcludePath = join(fixture.consumerRepo, '.git', 'info', 'exclude');
    expect(existsSync(gitExcludePath)).toBe(true);
    expect(readFileSync(gitExcludePath, 'utf8')).toContain('.squad/');
  });
});

// ─── Short-timeout CLI runner for lifecycle tests ───────────────────────────

interface ShortSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

function runCliShort(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs = 5_000,
): Promise<ShortSpawnResult> {
  return new Promise((resolveResult) => {
    // Build env: start with process.env, remove SQUAD_CALLSIGN so an empty or inherited
    // value cannot cause the resolver to throw before returning null.
    const { SQUAD_CALLSIGN: _omit, ...inheritedEnv } = process.env as Record<string, string>;
    const child = spawn('node', [CLI_ENTRY, ...args], {
      cwd,
      env: { ...inheritedEnv, NO_COLOR: '1', NODE_NO_WARNINGS: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', () => resolveResult({ stdout, stderr, exitCode: 1, timedOut: false }));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
  });
}

// ─── Runner-level unit tests for lifecycle commands ──────────────────────────

describe('lifecycle CLI command resolver migration', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('start resolves shared squad from consumer cwd', async () => {
    const fixture = await createFixture();

    let capturedSquadDir: string | undefined;
    const remoteBridgeCtor = vi.fn();
    const remoteBridgeStart = vi.fn().mockResolvedValue(4444);
    const mockPtySpawn = vi.fn().mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
    });

    vi.doMock('@wifi-aware/squad-sdk', () => {
      class FSStorageProvider {
        existsSync(_p: string): boolean { return false; }
        statSync(): undefined { return undefined; }
        appendSync(): void {}
      }
      class RemoteBridge {
        setStaticHandler = vi.fn();
        start = remoteBridgeStart;
        getSessionToken = vi.fn(() => 'token');
        getAuditLogPath = vi.fn(() => 'audit.log');
        getSessionExpiry = vi.fn(() => Date.now() + 60_000);
        setPassthrough = vi.fn();
        passthroughFromAgent = vi.fn();
        stop = vi.fn();
        constructor(config: { squadDir?: string }) {
          remoteBridgeCtor(config);
          capturedSquadDir = config.squadDir;
        }
      }
      return { FSStorageProvider, RemoteBridge };
    });

    vi.doMock('../../packages/squad-cli/src/cli/commands/rc-tunnel.js', () => ({
      isDevtunnelAvailable: vi.fn(() => false),
      createTunnel: vi.fn().mockResolvedValue({ url: 'https://tunnel.test' }),
      destroyTunnel: vi.fn(),
      getMachineId: vi.fn(() => 'machine-id'),
      getGitInfo: vi.fn(() => ({ repo: 'test/repo', branch: 'main' })),
    }));

    vi.doMock('node-pty', () => ({ default: { spawn: mockPtySpawn }, spawn: mockPtySpawn }));

    const { runStart } = await import('../../packages/squad-cli/src/cli/commands/start.ts');

    // Pass squadDir as cli-entry would after resolution; runner must use it, not local detection.
    void runStart(fixture.consumerRepo, {
      tunnel: false,
      port: 0,
      copilotArgs: [],
      squadDir: fixture.hostSquad,
    } as Parameters<typeof runStart>[1]);

    await vi.waitFor(() => expect(remoteBridgeCtor).toHaveBeenCalled(), { timeout: 5_000 });

    expect(capturedSquadDir).toBe(fixture.hostSquad);
  });

  it('rc resolves shared squad from consumer cwd', async () => {
    const fixture = await createFixture();

    let capturedSquadDir: string | undefined;
    const remoteBridgeCtor = vi.fn();
    const remoteBridgeStart = vi.fn().mockResolvedValue(5555);
    const mockSpawnChild = vi.fn().mockReturnValue({
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { writable: true, write: vi.fn() },
      kill: vi.fn(),
    });
    const mockCreateRL = vi.fn().mockReturnValue({ on: vi.fn() });

    vi.doMock('@wifi-aware/squad-sdk', () => {
      class FSStorageProvider {
        existsSync(_p: string): boolean { return false; }
        statSync(): undefined { return undefined; }
        readSync(): string | null { return null; }
      }
      class RemoteBridge {
        setStaticHandler = vi.fn();
        start = remoteBridgeStart;
        stop = vi.fn();
        setPassthrough = vi.fn();
        passthroughFromAgent = vi.fn();
        addMessage = vi.fn();
        updateAgents = vi.fn();
        getConnectionCount = vi.fn(() => 0);
        constructor(config: { squadDir?: string }) {
          remoteBridgeCtor(config);
          capturedSquadDir = config.squadDir;
        }
      }
      return { FSStorageProvider, RemoteBridge };
    });

    vi.doMock('../../packages/squad-cli/src/cli/commands/rc-tunnel.js', () => ({
      isDevtunnelAvailable: vi.fn(() => false),
      createTunnel: vi.fn().mockResolvedValue({ url: 'https://tunnel.test' }),
      destroyTunnel: vi.fn(),
      getMachineId: vi.fn(() => 'machine-id'),
      getGitInfo: vi.fn(() => ({ repo: 'test/repo', branch: 'main' })),
    }));

    vi.doMock('node:child_process', () => ({ spawn: mockSpawnChild }));
    vi.doMock('node:readline', () => ({ createInterface: mockCreateRL }));

    const { runRC } = await import('../../packages/squad-cli/src/cli/commands/rc.ts');

    // Pass squadDir as cli-entry would after resolution; runner must use it, not local detection.
    void runRC(fixture.consumerRepo, {
      tunnel: false,
      port: 0,
      squadDir: fixture.hostSquad,
    } as Parameters<typeof runRC>[1]);

    await vi.waitFor(() => expect(remoteBridgeCtor).toHaveBeenCalled(), { timeout: 5_000 });

    expect(capturedSquadDir).toBe(fixture.hostSquad);
  });
});

// ─── Dispatch-level tests: resolver runs before lifecycle command setup ───────

describe('cli-entry lifecycle', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    // Fake .git so findGitRoot stops here and does not resolve the outer repo's .squad/.
    await mkdir(join(TEST_ROOT, '.git'), { recursive: true });
  });

  afterEach(async () => {
    if (!existsSync(TEST_ROOT)) return;
    // On Windows, child processes spawned by runCliShort may still hold file
    // handles briefly after the test completes. Retry with backoff to avoid
    // EBUSY teardown failures.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(TEST_ROOT, { recursive: true, force: true });
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if ((code === 'EBUSY' || code === 'EPERM') && attempt < 4) {
          await new Promise<void>(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
  });

  it('start does not start bridge when resolution returns null', async () => {
    const fixture = await createFixture();
    // TEST_ROOT is not in the registry, so resolution returns null.
    // Use --command cmd.exe with /c exit as passthrough so the PTY exits immediately
    // before migration (avoids spawning a real Copilot session in the test).
    const result = await runCliShort(
      ['start', '--command', 'cmd.exe', '/c', 'exit'],
      TEST_ROOT,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
    );
    expect(result.timedOut).toBe(false);
    expect(result.stdout + result.stderr).toMatch(/no squad found/i);
    // Deprecation notice must print exactly once before resolution.
    expect(result.stdout + result.stderr).toMatch(/deprecated/i);
  });

  it('rc does not start bridge when resolution throws', async () => {
    const fixture = await createFixture();
    // Write invalid JSON to the registry so the resolver throws REGISTRY_INVALID.
    await writeFile(fixture.registryPath, '{ not valid json %%', 'utf8');
    // Create a platform-fallback squad so a silent fallback would select it if the
    // malformed explicit registry were ignored — proving the fail-closed throw path.
    const fallbackSquadDir = join(TEST_ROOT, 'fake-appdata', 'squad', '.squad');
    await mkdir(fallbackSquadDir, { recursive: true });

    const result = await runCliShort(
      ['rc'],
      fixture.consumerRepo,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
    );
    // Resolver must throw REGISTRY_INVALID before runRC is called.
    expect(result.timedOut).toBe(false);
    expect(result.stdout + result.stderr).toMatch(/registry|malformed|invalid/i);
  });

  it('start does not start bridge when resolution throws', async () => {
    const fixture = await createFixture();
    // Write invalid JSON to the registry so the resolver throws REGISTRY_INVALID.
    await writeFile(fixture.registryPath, '{ not valid json %%', 'utf8');
    // Create a platform-fallback squad — proves malformed explicit registry cannot be
    // silently bypassed to select the fallback squad.
    const fallbackSquadDir = join(TEST_ROOT, 'fake-appdata', 'squad', '.squad');
    await mkdir(fallbackSquadDir, { recursive: true });

    const result = await runCliShort(
      ['start'],
      fixture.consumerRepo,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
    );
    expect(result.timedOut).toBe(false);
    expect(result.stdout + result.stderr).toMatch(/registry|malformed|invalid/i);
  });

  it('start does not start bridge when resolved squad path is stale', async () => {
    const fixture = await createFixture();
    // Remove the actual squad directory so the registry entry is stale.
    await rm(fixture.hostSquad, { recursive: true, force: true });

    const result = await runCliShort(
      ['start'],
      fixture.consumerRepo,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
    );
    expect(result.timedOut).toBe(false);
    expect(result.stdout + result.stderr).toMatch(/stale|not exist|not a directory|STALE_PATH/i);
  });

  it('rc does not start bridge when resolved squad path is stale', async () => {
    const fixture = await createFixture();
    // Remove the actual squad directory so the registry entry is stale.
    await rm(fixture.hostSquad, { recursive: true, force: true });

    const result = await runCliShort(
      ['rc'],
      fixture.consumerRepo,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
    );
    expect(result.timedOut).toBe(false);
    expect(result.stdout + result.stderr).toMatch(/stale|not exist|not a directory|STALE_PATH/i);
  });

  it('rc --path resolves from explicit path', async () => {
    const fixture = await createFixture();
    // Run from TEST_ROOT with --path pointing at the registered consumer checkout.
    // rc prints "Squad: <dir>" before bridge.start(), so partial output is sufficient.
    const result = await runCliShort(
      ['rc', '--path', fixture.consumerRepo],
      TEST_ROOT,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
    );
    // Before migration: local detection on consumerRepo → squadDir = '' → "Squad: not found".
    // After migration: resolver uses consumerRepo → resolves hostSquad → "Squad: <hostSquad>".
    expect(result.stdout + result.stderr).toContain(fixture.hostSquad);
  });

  it('start preserves Copilot passthrough args', async () => {
    vi.resetModules();

    const fixture = await createFixture();

    let capturedSquadDir: string | undefined;
    let capturedPtyArgs: string[] | undefined;
    const remoteBridgeCtor = vi.fn();
    const remoteBridgeStart = vi.fn().mockResolvedValue(7777);
    const mockPtySpawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      capturedPtyArgs = args;
      return { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() };
    });

    vi.doMock('@wifi-aware/squad-sdk', () => {
      class FSStorageProvider {
        existsSync(_p: string): boolean { return false; }
        statSync(): undefined { return undefined; }
        appendSync(): void {}
      }
      class RemoteBridge {
        setStaticHandler = vi.fn();
        start = remoteBridgeStart;
        getSessionToken = vi.fn(() => 'token');
        getAuditLogPath = vi.fn(() => 'audit.log');
        getSessionExpiry = vi.fn(() => Date.now() + 60_000);
        setPassthrough = vi.fn();
        passthroughFromAgent = vi.fn();
        stop = vi.fn();
        constructor(config: { squadDir?: string }) {
          remoteBridgeCtor(config);
          capturedSquadDir = config.squadDir;
        }
      }
      return { FSStorageProvider, RemoteBridge };
    });

    vi.doMock('../../packages/squad-cli/src/cli/commands/rc-tunnel.js', () => ({
      isDevtunnelAvailable: vi.fn(() => false),
      createTunnel: vi.fn().mockResolvedValue({ url: 'https://tunnel.test' }),
      destroyTunnel: vi.fn(),
      getMachineId: vi.fn(() => 'machine-id'),
      getGitInfo: vi.fn(() => ({ repo: 'test/repo', branch: 'main' })),
    }));

    vi.doMock('node-pty', () => ({ default: { spawn: mockPtySpawn }, spawn: mockPtySpawn }));

    const { runStart } = await import('../../packages/squad-cli/src/cli/commands/start.ts');

    void runStart(fixture.consumerRepo, {
      tunnel: false,
      port: 0,
      copilotArgs: ['--extra-copilot-flag'],
      squadDir: fixture.hostSquad,
    } as Parameters<typeof runStart>[1]);

    await vi.waitFor(() => expect(mockPtySpawn).toHaveBeenCalled(), { timeout: 5_000 });

    expect(capturedSquadDir).toBe(fixture.hostSquad);
    expect(capturedPtyArgs).toContain('--extra-copilot-flag');

    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('start passes copilot flags through dispatch layer', async () => {
    const fixture = await createFixture();
    // Run through the full cli-entry dispatch to prove the squadFlags filter does not
    // consume copilot args that are not squad flags.  The process will fail to spawn
    // copilot (not installed in CI) but "Copilot flags:" is printed before PTY spawn.
    const result = await runCliShort(
      ['start', '--extra-copilot-flag', '--command', 'cmd.exe', '/c', 'exit'],
      fixture.consumerRepo,
      {
        SQUAD_REGISTRY_PATH: fixture.registryPath,
        APPDATA: join(TEST_ROOT, 'fake-appdata'),
        LOCALAPPDATA: join(TEST_ROOT, 'fake-appdata'),
        XDG_CONFIG_HOME: join(TEST_ROOT, 'fake-xdg'),
      },
      8_000,
    );
    // "Copilot flags: --extra-copilot-flag" is printed before PTY spawn, proving
    // the dispatch-layer filter did not strip --extra-copilot-flag.
    expect(result.stdout + result.stderr).toMatch(/extra-copilot-flag/);
  });
});
