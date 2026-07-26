import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { resolveSquad } from '../../packages/squad-sdk/src/index.js';
import { resolveSquadState } from '../../packages/squad-sdk/src/resolution.js';
import { runWatch } from '../../packages/squad-cli/src/cli/commands/watch/index.js';
import { resolveWatchStartupSquadDir } from '../../packages/squad-cli/src/cli/commands/watch/startup.js';
import { runTriage } from '../../packages/squad-cli/src/commands/triage.js';

const {
  mockCreatePlatformAdapter,
  mockEnsureTag,
  mockListWorkItems,
  mockListPullRequests,
  mockLoadCapabilities,
  mockFilterByCapabilities,
  mockMonitorStart,
  mockMonitorStop,
  mockMonitorHealthCheck,
  mockEventBusEmit,
  mockLoadExternalCapabilities,
  mockPidCleanupStale,
  mockPidRegisterExitHandlers,
} = vi.hoisted(() => {
  const mockEnsureTag = vi.fn(async () => undefined);
  const mockListWorkItems = vi.fn(async () => []);
  const mockListPullRequests = vi.fn(async () => []);
  const mockAdapter = {
    type: 'github',
    listWorkItems: mockListWorkItems,
    getWorkItem: vi.fn(),
    createWorkItem: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    addComment: vi.fn(),
    ensureTag: mockEnsureTag,
    listPullRequests: mockListPullRequests,
    createPullRequest: vi.fn(),
    mergePullRequest: vi.fn(),
    createBranch: vi.fn(),
  };

  return {
    mockCreatePlatformAdapter: vi.fn(() => mockAdapter),
    mockEnsureTag,
    mockListWorkItems,
    mockListPullRequests,
    mockLoadCapabilities: vi.fn(async () => null),
    mockFilterByCapabilities: vi.fn((issues: unknown[]) => ({ handled: issues, skipped: [] })),
    mockMonitorStart: vi.fn(async () => undefined),
    mockMonitorStop: vi.fn(async () => undefined),
    mockMonitorHealthCheck: vi.fn(async () => undefined),
    mockEventBusEmit: vi.fn(async () => undefined),
    mockLoadExternalCapabilities: vi.fn(async () => undefined),
    mockPidCleanupStale: vi.fn(() => 0),
    mockPidRegisterExitHandlers: vi.fn(),
  };
});

vi.mock('@bradygaster/squad-sdk/platform', () => ({
  createPlatformAdapter: mockCreatePlatformAdapter,
}));

vi.mock('../../packages/squad-cli/src/cli/core/gh-cli.js', () => ({
  ghAvailable: vi.fn(async () => true),
  ghAuthenticated: vi.fn(async () => true),
  ghRateLimitCheck: vi.fn(async () => null),
  isRateLimitError: vi.fn(() => false),
}));

vi.mock('@bradygaster/squad-sdk/ralph/capabilities', () => ({
  loadCapabilities: mockLoadCapabilities,
  filterByCapabilities: mockFilterByCapabilities,
}));

vi.mock('@bradygaster/squad-sdk/ralph', () => ({
  RalphMonitor: vi.fn(() => ({
    start: mockMonitorStart,
    stop: mockMonitorStop,
    healthCheck: mockMonitorHealthCheck,
  })),
}));

vi.mock('@bradygaster/squad-sdk/runtime/event-bus', () => ({
  EventBus: vi.fn(() => ({ emit: mockEventBusEmit })),
}));

vi.mock('../../packages/squad-cli/src/cli/commands/watch/capabilities/index.js', () => ({
  createDefaultRegistry: vi.fn(() => ({ all: () => [] })),
}));

vi.mock('../../packages/squad-cli/src/cli/commands/watch/external-loader.js', () => ({
  loadExternalCapabilities: mockLoadExternalCapabilities,
}));

vi.mock('../../packages/squad-cli/src/cli/commands/watch/pid-tracker.js', () => ({
  PidTracker: vi.fn(() => ({
    cleanupStale: mockPidCleanupStale,
    registerExitHandlers: mockPidRegisterExitHandlers,
  })),
}));

const TEST_ROOT = join(process.cwd(), `.test-watch-triage-${randomBytes(4).toString('hex')}`);

interface Fixture {
  hostRepo: string;
  hostSquad: string;
  consumerRepo: string;
  registryPath: string;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function createFixture(): Promise<Fixture> {
  const hostRepo = join(TEST_ROOT, 'host');
  const hostSquad = join(hostRepo, '.squad');
  const consumerRepo = join(TEST_ROOT, 'consumer');
  const registryPath = join(TEST_ROOT, 'registry.json');

  await mkdir(join(hostRepo, '.git'), { recursive: true });
  await mkdir(hostSquad, { recursive: true });
  await mkdir(join(consumerRepo, '.git'), { recursive: true });
  await writeFile(join(hostSquad, 'team.md'), '# Mission Control\n\n## Members\n\n| Name | Role |\n|------|------|\n| EECOM | Core Dev |\n', 'utf8');
  await writeFile(join(hostSquad, 'routing.md'), '# Routing\n', 'utf8');
  await writeJson(join(hostSquad, 'config.json'), { version: 1, teamRoot: '.' });
  await writeJson(registryPath, {
    version: 1,
    squads: [{ callsign: 'host', path: hostSquad, clones: [consumerRepo], origins: [] }],
  });

  return { hostRepo, hostSquad, consumerRepo, registryPath };
}

async function captureRunError(run: () => Promise<void>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected Error, received ${String(error)}`);
  }
  throw new Error('Expected command startup to stop before polling');
}

async function withRegistryPath<T>(registryPath: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env['SQUAD_REGISTRY_PATH'];
  if (registryPath === undefined) {
    delete process.env['SQUAD_REGISTRY_PATH'];
  } else {
    process.env['SQUAD_REGISTRY_PATH'] = registryPath;
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env['SQUAD_REGISTRY_PATH'];
    } else {
      process.env['SQUAD_REGISTRY_PATH'] = previous;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCommandState(
  condition: () => boolean,
  getRunState: () => { completed: boolean; error: unknown },
  failureMessage: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    const runState = getRunState();
    if (runState.error) throw runState.error;
    if (runState.completed) throw new Error('Command exited before first-round boundary');
    await delay(10);
  }

  throw new Error(failureMessage);
}

async function runCommandThroughFirstRound(run: () => Promise<void>): Promise<void> {
  type ShutdownHandler = () => void | Promise<void>;
  let shutdown: ShutdownHandler | undefined;
  let reachedFirstRoundBoundary = false;
  const originalOn = process.on.bind(process);
  const originalOff = process.off.bind(process);

  const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === 'SIGINT') {
      shutdown = listener as ShutdownHandler;
      return process;
    }
    if (event === 'SIGTERM') return process;
    return originalOn(event, listener);
  }) as typeof process.on);
  const offSpy = vi.spyOn(process, 'off').mockImplementation(((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === 'SIGINT' || event === 'SIGTERM') return process;
    return originalOff(event, listener);
  }) as typeof process.off);
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (args.some(arg => String(arg).includes('Next poll at'))) {
      reachedFirstRoundBoundary = true;
    }
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    const runPromise = run();
    let completed = false;
    let error: unknown;
    runPromise.then(
      () => { completed = true; },
      (caught: unknown) => { completed = true; error = caught; },
    );
    const getRunState = () => ({ completed, error });
    await waitForCommandState(() => reachedFirstRoundBoundary, getRunState, 'Watch command did not reach first-round boundary');
    await waitForCommandState(() => shutdown !== undefined, getRunState, 'Watch command did not register shutdown handler');
    if (!shutdown) throw new Error('Expected shutdown handler after first-round boundary');
    await shutdown();
    await runPromise;
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    onSpy.mockRestore();
    offSpy.mockRestore();
  }
}

describe('watch and triage registry resolution', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockListWorkItems.mockResolvedValue([]);
    mockListPullRequests.mockResolvedValue([]);
    mockLoadCapabilities.mockResolvedValue(null);
    mockFilterByCapabilities.mockImplementation((issues: unknown[]) => ({ handled: issues, skipped: [] }));
    mockPidCleanupStale.mockReturnValue(0);
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('fixture sanity: resolver finds host squad from consumer cwd via clones[]', async () => {
    const fixture = await createFixture();

    const resolved = resolveSquad({
      cwd: fixture.consumerRepo,
      env: { SQUAD_REGISTRY_PATH: fixture.registryPath },
    });

    expect(resolved).toMatchObject({
      path: fixture.hostSquad,
      source: 'clones',
      callsign: 'host',
    });
  });

  it('watch resolves shared squad from consumer cwd', async () => {
    const fixture = await createFixture();

    await withRegistryPath(fixture.registryPath, () =>
      runCommandThroughFirstRound(() => runWatch(fixture.consumerRepo, { interval: 1, execute: false, capabilities: {} })),
    );

    expect(mockCreatePlatformAdapter).toHaveBeenCalledWith(fixture.hostRepo);
    expect(mockListWorkItems).toHaveBeenCalledWith({ tags: ['squad'], state: 'open', limit: 20 });
  });

  it('triage resolves shared squad from consumer cwd', async () => {
    const fixture = await createFixture();

    await withRegistryPath(fixture.registryPath, () =>
      runCommandThroughFirstRound(() => runTriage(fixture.consumerRepo, { interval: 1, execute: false, capabilities: {} })),
    );

    const triageModule = await import('@bradygaster/squad-cli/commands/triage');
    expect(runTriage).toBe(runWatch);
    expect(typeof triageModule.runTriage).toBe('function');
    expect(mockCreatePlatformAdapter).toHaveBeenCalledWith(fixture.hostRepo);
    expect(mockListWorkItems).toHaveBeenCalledWith({ tags: ['squad'], state: 'open', limit: 20 });
  });

  it('state context wins over fallback', async () => {
    const fixture = await createFixture();
    const invalidRegistryPath = join(TEST_ROOT, 'invalid-registry.json');
    await writeFile(invalidRegistryPath, '{ not valid json %%', 'utf8');

    const stateContext = await withRegistryPath(fixture.registryPath, async () => resolveSquadState(fixture.consumerRepo));
    if (!stateContext) throw new Error('Expected state context for registered consumer repo');
    expect(stateContext.resolution.path).toBe(fixture.hostSquad);

    const squadDir = await withRegistryPath(invalidRegistryPath, async () =>
      resolveWatchStartupSquadDir(fixture.consumerRepo, {
        interval: 1,
        execute: false,
        capabilities: {},
        stateContext,
      }),
    );

    expect(squadDir.path).toBe(fixture.hostSquad);
  });

  it('startup errors stay fatal', async () => {
    const consumerRepo = join(TEST_ROOT, 'consumer-without-squad');
    const emptyRegistryPath = join(TEST_ROOT, 'empty-registry.json');
    await mkdir(join(consumerRepo, '.git'), { recursive: true });
    await writeJson(emptyRegistryPath, { version: 1, squads: [] });

    const missingError = await withRegistryPath(emptyRegistryPath, () =>
      captureRunError(() => runWatch(consumerRepo, { interval: 1, execute: false, capabilities: {} })),
    );
    expect(missingError.message).toMatch(/No squad found.*run init first/i);

    const sharedClone = join(TEST_ROOT, 'shared-clone');
    const registryPath = join(TEST_ROOT, 'ambiguous-registry.json');
    await mkdir(join(sharedClone, '.git'), { recursive: true });
    await mkdir(join(TEST_ROOT, 'squad-a', '.squad'), { recursive: true });
    await mkdir(join(TEST_ROOT, 'squad-b', '.squad'), { recursive: true });
    await writeJson(registryPath, {
      version: 1,
      squads: [
        { callsign: 'team-a', path: join(TEST_ROOT, 'squad-a', '.squad'), clones: [sharedClone], origins: [] },
        { callsign: 'team-b', path: join(TEST_ROOT, 'squad-b', '.squad'), clones: [sharedClone], origins: [] },
      ],
    });

    const ambiguousError = await withRegistryPath(registryPath, () =>
      captureRunError(() => runWatch(sharedClone, { interval: 1, execute: false, capabilities: {} })),
    );
    expect(ambiguousError.message).toMatch(/ambiguous/i);
    expect(mockCreatePlatformAdapter).not.toHaveBeenCalled();
  });
});
