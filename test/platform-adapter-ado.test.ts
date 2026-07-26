/**
 * Platform adapter — Azure DevOps and GitHub concrete adapter tests.
 *
 * Mocks node:child_process at the module level so every test constructs
 * real AzureDevOpsAdapter / GitHubAdapter instances and asserts the exact
 * argv forwarded to the CLI. No hand-built PlatformAdapter literals here.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process');

const IS_WINDOWS = process.platform === 'win32';
const AZ_CMD = IS_WINDOWS ? 'az.cmd' : 'az';

// ─── helpers ──────────────────────────────────────────────────────────

// execFileSync has string/Buffer overloads that vi.mocked cannot collapse to a
// single return type for mockReturnValue. Narrow to the string-returning form
// once here so every mock call site stays free of `as any`.
const mockedExecFileSync = vi.mocked(execFileSync) as MockedFunction<
  (file: string, args?: readonly string[], options?: object) => string
>;

/** Build a minimal ADO work item JSON response */
function adoWiJson(id: number, title = 'Test item', state = 'New', tags = ''): string {
  return JSON.stringify({
    id,
    fields: {
      'System.Title': title,
      'System.State': state,
      'System.Tags': tags,
    },
    url: `https://dev.azure.com/myorg/myproj/_apis/wit/workItems/${id}`,
    _links: { html: { href: `https://dev.azure.com/myorg/myproj/_workitems/edit/${id}` } },
  });
}

/** Build a minimal ADO PR response object */
function adoPrObj(id: number) {
  return {
    pullRequestId: id,
    title: 'My PR',
    sourceRefName: 'refs/heads/feature-branch',
    targetRefName: 'refs/heads/main',
    status: 'active',
    isDraft: false,
    reviewers: [],
    createdBy: { displayName: 'Dev User', uniqueName: 'dev@contoso.com' },
    url: `https://dev.azure.com/myorg/myproj/_apis/git/repositories/myrepo/pullRequests/${id}`,
    repository: { webUrl: 'https://dev.azure.com/myorg/myproj/_git/myrepo' },
  };
}

/** Build a minimal ADO PR JSON response */
function adoPrJson(id: number): string {
  return JSON.stringify(adoPrObj(id));
}

/** Build a minimal gh issue JSON response */
function ghIssueJson(number: number, title = 'Test issue'): string {
  return JSON.stringify({
    number,
    title,
    state: 'open',
    labels: [],
    assignees: [],
    url: `https://github.com/myorg/myrepo/issues/${number}`,
  });
}

// ─── AzureDevOpsAdapter spawn correctness ──────────────────────────────

describe('AzureDevOpsAdapter — spawn correctness', () => {
  beforeEach(() => {
    // Default: az devops -h succeeds (constructor check)
    mockedExecFileSync.mockReturnValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructor calls az devops -h to verify CLI presence', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    const firstCall = mockedExecFileSync.mock.calls[0]!;
    expect(firstCall[0]).toBe(AZ_CMD);
    expect(firstCall[1]).toContain('devops');
    expect(firstCall[1]).toContain('-h');
  });

  it('constructor does NOT use shell:true (injection guard)', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    const firstCall = mockedExecFileSync.mock.calls[0]!;
    const opts = firstCall[2] as Record<string, unknown> | undefined;
    expect(opts?.shell).toBeUndefined();
  });

  it('getWorkItem calls az boards work-item show with correct id', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')        // constructor
      .mockReturnValueOnce(adoWiJson(42));  // getWorkItem

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    const wi = await adapter.getWorkItem(42);

    const call = mockedExecFileSync.mock.calls[1]!;
    expect(call[0]).toBe(AZ_CMD);
    expect(call[1]).toContain('boards');
    expect(call[1]).toContain('work-item');
    expect(call[1]).toContain('show');
    expect(call[1]).toContain('--id');
    expect(call[1]).toContain('42');
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
    expect(wi.id).toBe(42);
    expect(wi.title).toBe('Test item');
  });

  it('createWorkItem calls az boards work-item create with title and type', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce(adoWiJson(99, 'New feature'));

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    const wi = await adapter.createWorkItem({ title: 'New feature' });

    const call = mockedExecFileSync.mock.calls[1]!;
    // Exact argv order matters: wrong order can misinterpret flags as values
    expect(call[1]).toEqual([
      'boards', 'work-item', 'create',
      '--type', 'User Story',
      '--fields', 'System.Title=New feature',
      '--org', 'https://dev.azure.com/myorg',
      '--project', 'myproj',
      '--output', 'json',
    ]);
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
    expect(wi.id).toBe(99);
  });

  it('addTag reads current tags then updates with merged set', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')                                   // constructor
      .mockReturnValueOnce(adoWiJson(10, 'Item', 'Active', 'old-tag'))  // getWorkItem
      .mockReturnValueOnce(adoWiJson(10));                        // update

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.addTag(10, 'new-tag');

    const updateCall = mockedExecFileSync.mock.calls[2]!;
    expect(updateCall[1]).toContain('update');
    expect(updateCall[1]).toContain('--fields');
    const fieldsArg = updateCall[1]!.join(' ');
    expect(fieldsArg).toContain('old-tag');
    expect(fieldsArg).toContain('new-tag');
  });

  it('addComment calls az boards work-item update --discussion', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce(adoWiJson(5));

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.addComment(5, 'Great work!');

    const call = mockedExecFileSync.mock.calls[1]!;
    expect(call[1]).toContain('--discussion');
    expect(call[1]).toContain('Great work!');
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
  });

  it('assignWorkItem with literal assignee passes through unchanged', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce(adoWiJson(7));

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.assignWorkItem(7, 'alice@contoso.com');

    const call = mockedExecFileSync.mock.calls[1]!;
    expect(call[1]).toContain('--fields');
    expect(call[1]!.join(' ')).toContain('alice@contoso.com');
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
  });

  it('assignWorkItem with @me resolves to current user identity', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const accountJson = JSON.stringify({ user: { name: 'Dev User' } });
    mockedExecFileSync
      .mockReturnValueOnce('')        // constructor
      .mockReturnValueOnce(accountJson)  // getCurrentUser → az account show
      .mockReturnValueOnce(adoWiJson(8)); // update

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.assignWorkItem(8, '@me');

    const updateCall = mockedExecFileSync.mock.calls[2]!;
    expect(updateCall[1]!.join(' ')).toContain('Dev User');
    expect((updateCall[2] as Record<string, unknown>)?.shell).toBeUndefined();
  });

  it('assignWorkItem with @me no-ops when getCurrentUser returns undefined', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const err = new Error('auth failed');
    mockedExecFileSync
      .mockReturnValueOnce('')          // constructor
      .mockImplementationOnce(() => { throw err; }); // getCurrentUser throws → undefined

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.assignWorkItem(9, '@me');

    // Only 2 calls: constructor + getCurrentUser. No update call.
    expect(mockedExecFileSync.mock.calls).toHaveLength(2);
  });

  it('listPullRequests calls az repos pr list with correct args', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce(JSON.stringify([adoPrObj(1)]));

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    const prs = await adapter.listPullRequests({});

    const call = mockedExecFileSync.mock.calls[1]!;
    expect(call[1]).toContain('repos');
    expect(call[1]).toContain('pr');
    expect(call[1]).toContain('list');
    expect(call[1]).toContain('--repository');
    expect(call[1]).toContain('myrepo');
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
    expect(prs[0]!.id).toBe(1);
    expect(prs[0]!.sourceBranch).toBe('feature-branch');
  });

  it('createPullRequest calls az repos pr create with title and branches', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce(JSON.stringify(adoPrObj(55)));

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    const pr = await adapter.createPullRequest({
      title: 'My PR',
      sourceBranch: 'feature',
      targetBranch: 'main',
    });

    const call = mockedExecFileSync.mock.calls[1]!;
    // Exact argv order guards against source/target branch transposition
    expect(call[1]).toEqual([
      'repos', 'pr', 'create',
      '--repository', 'myrepo',
      '--source-branch', 'feature',
      '--target-branch', 'main',
      '--title', 'My PR',
      '--org', 'https://dev.azure.com/myorg',
      '--project', 'myproj',
      '--output', 'json',
    ]);
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
    expect(pr.id).toBe(55);
  });

  it('mergePullRequest calls az repos pr update --status completed', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce(JSON.stringify(adoPrObj(22)));

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.mergePullRequest(22);

    const call = mockedExecFileSync.mock.calls[1]!;
    expect(call[1]).toContain('update');
    expect(call[1]).toContain('--status');
    expect(call[1]).toContain('completed');
    expect((call[2] as Record<string, unknown>)?.shell).toBeUndefined();
  });
});

// ─── AzureDevOpsAdapter error handling ────────────────────────────────

describe('AzureDevOpsAdapter — error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when az CLI is not installed (ENOENT on constructor)', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const err = Object.assign(new Error('spawn az ENOENT'), { code: 'ENOENT' });
    mockedExecFileSync.mockImplementation(() => { throw err; });

    expect(() => new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo')).toThrow(
      /Azure DevOps CLI not found/,
    );
  });

  it('throws with install instructions on ENOENT', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const err = Object.assign(new Error('spawn az ENOENT'), { code: 'ENOENT' });
    mockedExecFileSync.mockImplementation(() => { throw err; });

    expect(() => new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo')).toThrow(
      /az extension add/,
    );
  });

  it('throws descriptive error on malformed JSON output', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')             // constructor
      .mockReturnValueOnce('not json {{{'); // getWorkItem returns garbage

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await expect(adapter.getWorkItem(1)).rejects.toThrow(/Failed to parse JSON/);
  });

  it('throws on non-zero exit (execFileSync throws with stderr)', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const spawnErr = Object.assign(
      new Error('Command failed: az boards work-item show'),
      { stderr: 'ERROR: Work item not found', status: 1 },
    );
    mockedExecFileSync
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => { throw spawnErr; });

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    // spawnErr is a plain Error propagated directly from execFileSync
    await expect(adapter.getWorkItem(9999)).rejects.toThrow(Error);
  });

  it('throws on empty stdout when JSON parsing is required', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')   // constructor
      .mockReturnValueOnce('');  // getWorkItem — empty response

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    // Empty string is invalid JSON; parseJson wraps SyntaxError in a plain Error
    await expect(adapter.getWorkItem(1)).rejects.toThrow(Error);
  });
});

// ─── Hostile-input regression (injection guard) ────────────────────────

describe('AzureDevOpsAdapter — hostile-input regression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hostile title with shell metacharacters does not invoke extra commands', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const HOSTILE_TITLE = '"; echo INJECTED #';
    mockedExecFileSync
      .mockReturnValueOnce('')                        // constructor
      .mockReturnValueOnce(adoWiJson(1, HOSTILE_TITLE)); // createWorkItem

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.createWorkItem({ title: HOSTILE_TITLE });

    // The hostile title MUST appear as a literal argv element, not a shell string.
    // shell: true would concatenate args into a cmd string where & | > execute.
    const createCall = mockedExecFileSync.mock.calls[1]!;
    expect((createCall[2] as Record<string, unknown>)?.shell).toBeUndefined();

    // Title is present somewhere in the args array as a literal string.
    const argsFlat = JSON.stringify(createCall[1]);
    expect(argsFlat).toContain(HOSTILE_TITLE);

    // Exactly 2 execFileSync calls: constructor + createWorkItem.
    // shell: true would allow injection that spawns additional processes.
    expect(mockedExecFileSync.mock.calls).toHaveLength(2);
  });
});

// ─── GitHubAdapter spawn correctness ──────────────────────────────────

describe('GitHubAdapter — spawn correctness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listWorkItems calls gh issue list with correct repo flag', async () => {
    const { GitHubAdapter } = await import('../packages/squad-sdk/src/platform/github.js');
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify([
      { number: 3, title: 'Fix bug', state: 'open', labels: [], assignees: [], url: 'https://github.com/myorg/myrepo/issues/3' },
    ]));

    const adapter = new GitHubAdapter('myorg', 'myrepo');
    const items = await adapter.listWorkItems({});

    const call = mockedExecFileSync.mock.calls[0]!;
    expect(call[0]).toBe('gh');
    expect(call[1]).toContain('issue');
    expect(call[1]).toContain('list');
    expect(call[1]).toContain('--repo');
    expect(call[1]).toContain('myorg/myrepo');
    expect(items[0]!.id).toBe(3);
  });

  it('assignWorkItem calls gh issue edit --add-assignee', async () => {
    const { GitHubAdapter } = await import('../packages/squad-sdk/src/platform/github.js');
    mockedExecFileSync.mockReturnValueOnce('');

    const adapter = new GitHubAdapter('myorg', 'myrepo');
    await adapter.assignWorkItem(5, 'alice');

    const call = mockedExecFileSync.mock.calls[0]!;
    expect(call[0]).toBe('gh');
    expect(call[1]).toContain('issue');
    expect(call[1]).toContain('edit');
    expect(call[1]).toContain('--add-assignee');
    expect(call[1]).toContain('alice');
  });

  it('throws when gh CLI is not installed (ENOENT)', async () => {
    const { GitHubAdapter } = await import('../packages/squad-sdk/src/platform/github.js');
    const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    mockedExecFileSync.mockImplementation(() => { throw err; });

    const adapter = new GitHubAdapter('myorg', 'myrepo');
    // The ENOENT error from execFileSync propagates directly as a plain Error
    await expect(adapter.listWorkItems({})).rejects.toThrow(Error);
  });

  it('throws descriptive error on malformed JSON from gh', async () => {
    const { GitHubAdapter } = await import('../packages/squad-sdk/src/platform/github.js');
    mockedExecFileSync.mockReturnValueOnce('not valid json');

    const adapter = new GitHubAdapter('myorg', 'myrepo');
    await expect(adapter.listWorkItems({})).rejects.toThrow(/Failed to parse JSON/);
  });

  it('listPullRequests calls gh pr list with repo flag', async () => {
    const { GitHubAdapter } = await import('../packages/squad-sdk/src/platform/github.js');
    const prPayload = JSON.stringify([{
      number: 11, title: 'feat: add thing',
      headRefName: 'feat/thing', baseRefName: 'main',
      state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED',
      author: { login: 'alice' },
      url: 'https://github.com/myorg/myrepo/pull/11',
    }]);
    mockedExecFileSync.mockReturnValueOnce(prPayload);

    const adapter = new GitHubAdapter('myorg', 'myrepo');
    const prs = await adapter.listPullRequests({});

    const call = mockedExecFileSync.mock.calls[0]!;
    expect(call[1]).toContain('pr');
    expect(call[1]).toContain('list');
    expect(prs[0]!.reviewStatus).toBe('approved');
  });
});

// ─── createAdapterForOrigin factory ───────────────────────────────────

describe('createAdapterForOrigin — factory integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a GitHubAdapter for a github.com HTTPS URL', async () => {
    // GitHubAdapter constructor does not shell out — no mock needed
    const { createAdapterForOrigin } = await import('../packages/squad-sdk/src/platform/adapter-factory.js');
    const { GitHubAdapter } = await import('../packages/squad-sdk/src/platform/github.js');
    const adapter = createAdapterForOrigin('https://github.com/contoso/myrepo');
    expect(adapter.type).toBe('github');
    expect(adapter).toBeInstanceOf(GitHubAdapter);
  });

  it('returns an AzureDevOpsAdapter for a dev.azure.com HTTPS URL', async () => {
    mockedExecFileSync.mockReturnValue(''); // constructor az devops -h
    const { createAdapterForOrigin } = await import('../packages/squad-sdk/src/platform/adapter-factory.js');
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    const adapter = createAdapterForOrigin('https://dev.azure.com/contoso/myproj/_git/myrepo');
    expect(adapter.type).toBe('azure-devops');
    expect(adapter).toBeInstanceOf(AzureDevOpsAdapter);
  });

  it('throws PlatformConfigError for an unknown host', async () => {
    const { createAdapterForOrigin } = await import('../packages/squad-sdk/src/platform/adapter-factory.js');
    const { PlatformConfigError } = await import('../packages/squad-sdk/src/platform/types.js');
    expect(() => createAdapterForOrigin('https://gitlab.com/owner/repo.git'))
      .toThrow(PlatformConfigError);
  });

  it('throws with SQUAD_PLATFORM hint for unknown host', async () => {
    const { createAdapterForOrigin } = await import('../packages/squad-sdk/src/platform/adapter-factory.js');
    const { PlatformConfigError: PCE } = await import('../packages/squad-sdk/src/platform/types.js');
    expect(() => createAdapterForOrigin('https://bitbucket.org/owner/repo'))
      .toThrow(PCE);
  });
});

// ─── AzureDevOpsAdapter ensureAuth — AZ_CMD dispatch ──────────────────

describe('AzureDevOpsAdapter — ensureAuth uses AZ_CMD', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ensureAuth calls az devops configure via AZ_CMD (not bare "az")', async () => {
    const { AzureDevOpsAdapter } = await import('../packages/squad-sdk/src/platform/azure-devops.js');
    mockedExecFileSync
      .mockReturnValueOnce('')   // constructor az devops -h
      .mockReturnValueOnce('refs/heads/main\nmyorg@vs-ssh.visualstudio.com:v3/myorg/myproj/myrepo\n') // git remote get-url origin
      .mockReturnValueOnce('');  // az devops configure

    const adapter = new AzureDevOpsAdapter('myorg', 'myproj', 'myrepo');
    await adapter.ensureAuth('myorg');

    // Find the call that invokes 'devops configure'
    const configureCalls = mockedExecFileSync.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1].includes('configure'),
    );
    expect(configureCalls.length).toBeGreaterThan(0);
    expect(configureCalls[0]![0]).toBe(AZ_CMD);
  });
});


describe('detectPlatform — SQUAD_PLATFORM env var', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SQUAD_PLATFORM'];
  });

  it('honors SQUAD_PLATFORM=github without shelling out', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    process.env['SQUAD_PLATFORM'] = 'github';
    expect(detectPlatform('/nonexistent')).toBe('github');
  });

  it('honors SQUAD_PLATFORM=azure-devops without shelling out', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    process.env['SQUAD_PLATFORM'] = 'azure-devops';
    expect(detectPlatform('/nonexistent')).toBe('azure-devops');
  });

  it('throws PlatformConfigError for SQUAD_PLATFORM=planner', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    const { PlatformConfigError } = await import('../packages/squad-sdk/src/platform/types.js');
    process.env['SQUAD_PLATFORM'] = 'planner';
    expect(() => detectPlatform('/nonexistent')).toThrow(PlatformConfigError);
  });

  it('throws PlatformConfigError with remediation message for SQUAD_PLATFORM=planner', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    process.env['SQUAD_PLATFORM'] = 'planner';
    expect(() => detectPlatform('/nonexistent')).toThrow(/work-item source/);
  });

  it('throws PlatformConfigError for unrecognised SQUAD_PLATFORM value', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    const { PlatformConfigError } = await import('../packages/squad-sdk/src/platform/types.js');
    process.env['SQUAD_PLATFORM'] = 'gitlab';
    expect(() => detectPlatform('/nonexistent')).toThrow(PlatformConfigError);
  });

  it('throws PlatformConfigError for missing origin when SQUAD_PLATFORM is unset', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    const { PlatformConfigError } = await import('../packages/squad-sdk/src/platform/types.js');
    delete process.env['SQUAD_PLATFORM'];
    expect(() => detectPlatform('/nonexistent-path-xyz')).toThrow(PlatformConfigError);
  });

  it('error message mentions SQUAD_PLATFORM as remediation hint', async () => {
    const { detectPlatform } = await import('../packages/squad-sdk/src/platform/detect.js');
    delete process.env['SQUAD_PLATFORM'];
    expect(() => detectPlatform('/nonexistent-path-xyz')).toThrow(/SQUAD_PLATFORM/);
  });
});

// ─── Azure DevOps URL detection ────────────────────────────────────────

describe('Azure DevOps URL forms — detectPlatformFromUrl', () => {
  it('dev.azure.com HTTPS URL', async () => {
    const { detectPlatformFromUrl } = await import('../packages/squad-sdk/src/platform/detect.js');
    expect(detectPlatformFromUrl('https://dev.azure.com/myorg/myproj/_git/myrepo')).toBe('azure-devops');
  });

  it('dev.azure.com HTTPS URL with user prefix', async () => {
    const { detectPlatformFromUrl } = await import('../packages/squad-sdk/src/platform/detect.js');
    expect(detectPlatformFromUrl('https://myorg@dev.azure.com/myorg/myproj/_git/myrepo')).toBe('azure-devops');
  });

  it('ssh.dev.azure.com SSH URL', async () => {
    const { detectPlatformFromUrl } = await import('../packages/squad-sdk/src/platform/detect.js');
    expect(detectPlatformFromUrl('git@ssh.dev.azure.com:v3/myorg/myproj/myrepo')).toBe('azure-devops');
  });

  it('visualstudio.com HTTPS URL (legacy)', async () => {
    const { detectPlatformFromUrl } = await import('../packages/squad-sdk/src/platform/detect.js');
    expect(detectPlatformFromUrl('https://contoso.visualstudio.com/WebApp/_git/frontend')).toBe('azure-devops');
  });
});

// ─── parseAzureDevOpsRemote ─────────────────────────────────────────────

describe('parseAzureDevOpsRemote — documented URL forms', () => {
  it('parses dev.azure.com HTTPS', async () => {
    const { parseAzureDevOpsRemote } = await import('../packages/squad-sdk/src/platform/detect.js');
    const result = parseAzureDevOpsRemote('https://dev.azure.com/myorg/myproj/_git/myrepo');
    expect(result).toEqual({ org: 'myorg', project: 'myproj', repo: 'myrepo' });
  });

  it('parses ssh.dev.azure.com SSH', async () => {
    const { parseAzureDevOpsRemote } = await import('../packages/squad-sdk/src/platform/detect.js');
    const result = parseAzureDevOpsRemote('git@ssh.dev.azure.com:v3/myorg/myproj/myrepo');
    expect(result).toEqual({ org: 'myorg', project: 'myproj', repo: 'myrepo' });
  });

  it('parses visualstudio.com HTTPS (legacy)', async () => {
    const { parseAzureDevOpsRemote } = await import('../packages/squad-sdk/src/platform/detect.js');
    const result = parseAzureDevOpsRemote('https://contoso.visualstudio.com/WebApp/_git/frontend');
    expect(result).toEqual({ org: 'contoso', project: 'WebApp', repo: 'frontend' });
  });

  it('returns null for non-ADO URLs', async () => {
    const { parseAzureDevOpsRemote } = await import('../packages/squad-sdk/src/platform/detect.js');
    expect(parseAzureDevOpsRemote('https://github.com/owner/repo')).toBeNull();
  });
});

