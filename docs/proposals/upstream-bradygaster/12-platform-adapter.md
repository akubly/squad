# Piece 12: Platform adapter

## Summary

Piece 12 adds a typed platform seam for git, issue, work item, pull request, comment, and identity operations. The SDK keeps GitHub as the default supported platform and adds Azure DevOps as a first-class git platform through the same command-facing contract.

This piece depends on piece 11b. Tier 7 command pieces consume this seam so command logic routes through capabilities instead of branching on platform-specific CLIs or URL shapes.

## Problem

Several command paths assume GitHub issue and pull request behavior directly. That works for repositories hosted on GitHub, but it makes shared-squad lifecycle commands hard to extend to other documented git platforms.

The runtime needs one platform contract that command code can call without knowing whether work items are GitHub issues or Azure DevOps work items. Runtime correctness depends on URL detection, identity lookup, assignment, comment posting, and pull request creation behaving consistently across both adapters.

## Proposed change

Add `packages/squad-sdk/src/platform/` as the public platform abstraction layer. The layer exposes shared data types, a factory, GitHub and Azure DevOps implementations, URL parsing helpers, and host communication adapters.

### API surface

```ts
export type PlatformType = 'github' | 'azure-devops' | 'planner' | 'unknown';

export interface WorkItem {
  id: number;
  title: string;
  state: string;
  tags: string[];
  assignedTo?: string;
  url: string;
}

export interface PullRequest {
  id: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  status: 'active' | 'completed' | 'abandoned' | 'draft';
  reviewStatus?: 'approved' | 'changes-requested' | 'pending';
  author: string;
  url: string;
}

export interface PlatformAdapter {
  readonly type: PlatformType;

  listWorkItems(options: { tags?: string[]; state?: string; limit?: number }): Promise<WorkItem[]>;
  getWorkItem(id: number): Promise<WorkItem>;
  createWorkItem(options: {
    title: string;
    description?: string;
    tags?: string[];
    assignedTo?: string;
    type?: string;
  }): Promise<WorkItem>;
  addTag(workItemId: number, tag: string): Promise<void>;
  removeTag(workItemId: number, tag: string): Promise<void>;
  addComment(workItemId: number, comment: string): Promise<void>;
  assignWorkItem?(id: number, assignee: string): Promise<void>;
  ensureTag?(tag: string, options?: { color?: string; description?: string }): Promise<void>;
  getCurrentUser?(): string | undefined;
  ensureAuth?(preferredUser?: string): Promise<void>;

  listPullRequests(options: { status?: string; limit?: number }): Promise<PullRequest[]>;
  createPullRequest(options: {
    title: string;
    sourceBranch: string;
    targetBranch: string;
    description?: string;
  }): Promise<PullRequest>;
  mergePullRequest(id: number): Promise<void>;

  createBranch(name: string, fromBranch?: string): Promise<void>;
}

export function createAdapterForOrigin(url: string): PlatformAdapter;

export function normalizeRemoteUrl(url: string): string;
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null;
export function parseAzureDevOpsRemote(url: string): {
  org: string;
  project: string;
  repo: string;
} | null;
```

The SDK package exports the platform barrel and the adapter-factory subpath. `createPlatformAdapter(repoRoot)` remains useful when callers have a repository root instead of an origin URL.

### Mechanism

`createAdapterForOrigin(url)` detects the platform from the origin URL, parses the remote, and returns the matching adapter:

- `github.com` HTTPS and SSH remotes dispatch to `GitHubAdapter`.
- `dev.azure.com`, `ssh.dev.azure.com`, and `visualstudio.com` remotes dispatch to `AzureDevOpsAdapter`.
- Unknown hosts throw a typed configuration error. The factory must not silently fall back to GitHub.

`detectPlatform(repoRoot)` keeps an offline-safe priority chain: explicit `SQUAD_PLATFORM`, then `git remote get-url origin`, then a typed error that tells the operator how to set an override.

Azure DevOps assignment supports the `@me` sentinel as documented Azure DevOps current-user behavior. The adapter resolves `@me` to the current authenticated identity before updating `System.AssignedTo`; if identity lookup is unavailable, assignment no-ops rather than sending an ambiguous value.

The host-comm / discussions module stays separate from the platform adapter. It owns human communication channels such as GitHub Discussions, Azure DevOps work item discussions, Teams, and file logs. Platform detection can choose a default communication adapter, but work item and pull request operations stay in `PlatformAdapter`.

### URL normalization contract

`normalizeRemoteUrl(url)` returns a canonical `host/path` form for origin matching:

- Lowercase the host only. Preserve owner, organization, project, and repository casing.
- Strip HTTPS user info, `.git`, and a trailing slash.
- Normalize Azure DevOps HTTPS, SSH, and `visualstudio.com` URL shapes to `dev.azure.com/{org}/{project}/_git/{repo}`.
- Leave non-Azure DevOps hosts on the generic canonical path.

`parseGitHubRemote(url)` accepts GitHub HTTPS and SSH URLs and returns `{ owner, repo }` or `null`. `parseAzureDevOpsRemote(url)` accepts `dev.azure.com` HTTPS, `ssh.dev.azure.com` SSH, and `visualstudio.com` HTTPS URLs and returns `{ org, project, repo }` or `null`.

### Adapter behavior

`GitHubAdapter` wraps the GitHub CLI for issue, label, pull request, auth, and branch operations. It maps GitHub issues to `WorkItem` and GitHub pull requests to `PullRequest`.

`AzureDevOpsAdapter` wraps Azure DevOps work item, repository, pull request, identity, and branch operations through the Azure DevOps command and REST surface. It maps work item fields, tags, assignment, discussions, pull request status, draft state, and reviewer votes into the shared SDK types. Work item type configuration supports project-specific process templates and can fail open when offline tests cannot query the service.

## Files

Expected source and test surface:

- `packages/squad-sdk/src/platform/types.ts`
- `packages/squad-sdk/src/platform/detect.ts`
- `packages/squad-sdk/src/platform/adapter-factory.ts`
- `packages/squad-sdk/src/platform/github.ts`
- `packages/squad-sdk/src/platform/azure-devops.ts`
- `packages/squad-sdk/src/platform/comms.ts`
- `packages/squad-sdk/src/platform/comms-github-discussions.ts`
- `packages/squad-sdk/src/platform/comms-ado-discussions.ts`
- `packages/squad-sdk/src/platform/index.ts`
- `packages/squad-sdk/src/resolution-v2.ts`
- `packages/squad-sdk/src/agents/history-shadow.ts`
- command integration files that stop hard-coding GitHub behavior where they call issue, work item, pull request, auth, or hydration operations
- `test/platform-adapter.test.ts`
- `test/platform-adapter-ado.test.ts`
- URL normalization coverage in `test/resolution-v2.test.ts`
- package export and changeset files required by the SDK source changes

The replay branch should stay within the piece 12 file budget. If command integration grows beyond the expected scope, split only the command consumers and keep the SDK seam intact.

## Test plan

Add or update tests for:

- `detectPlatform` honors `SQUAD_PLATFORM` before shelling out.
- Missing or unrecognized origins throw a typed error with actionable remediation.
- `detectPlatformFromUrl` returns `unknown` for unrecognized hosts.
- `parseGitHubRemote` covers GitHub HTTPS and SSH URL forms.
- `parseAzureDevOpsRemote` covers `dev.azure.com`, `ssh.dev.azure.com`, and `visualstudio.com` URL forms.
- `normalizeRemoteUrl` collapses all supported Azure DevOps URL forms to one canonical value and leaves GitHub URLs on the generic path.
- `createAdapterForOrigin` returns the expected adapter for GitHub and Azure DevOps URLs and throws for unknown hosts.
- Assignment routes through `adapter.assignWorkItem?.()` and handles adapters without that optional method.
- Azure DevOps `@me` assignment resolves the current identity, no-ops when it cannot resolve, and passes literal assignees unchanged.
- Auth preflight calls `adapter.ensureAuth?.()` without requiring every adapter to implement it.
- Board registration remains GitHub-only unless a future piece defines Azure DevOps board registration semantics.
- Hydration calls `adapter.getWorkItem()` instead of invoking platform-specific issue commands directly.

Run:

```bash
npm run build
npx vitest run test/platform-adapter.test.ts test/platform-adapter-ado.test.ts test/resolution-v2.test.ts
```

Then run the upstream scrub gate before opening the pull request.

## Acceptance criteria

- Command-level code calls the adapter contract for work item, pull request, assignment, auth, comment, and hydration operations covered by this piece.
- GitHub behavior remains compatible with existing issue and pull request workflows.
- Azure DevOps repositories are detected from documented public URL forms and receive a concrete Azure DevOps adapter.
- URL normalization supports cross-protocol origin matching for HTTPS and SSH clones.
- Unknown hosts fail closed with a clear configuration error.
- Public exports include the platform barrel and adapter factory.
- Tests cover the seam, both concrete adapters, URL normalization, and command consumers.
- The implementation follows Microsoft Style Guide expectations in user-facing messages and docs: sentence-case headings, active voice, present tense, and no unsupported claims.

## Notes

- Fixture scrub is part of the piece 12 definition. Upstream-bound test fixtures must use generic placeholders such as `myorg`, `myproj`, `myrepo`, `org`, `proj`, `repo`, and `contoso`. A current `visualstudio.com` fixture uses a non-generic tenant path and a prohibited repository abbreviation; it MUST be replaced with a generic placeholder before the piece 12 pull request opens.
- Verify no `.npmrc`, package registry, or package manager config that points at an Azure Artifacts feed or tenant-specific npm registry rides into the upstream pull request.
- Azure DevOps references in this piece describe support for a public Microsoft product. Do not frame the work as an internal migration or a fork replay.
- The proposal document is a replay input. It should describe the forward design, not implementation history.
