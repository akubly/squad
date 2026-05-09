# 03 — clones/origins resolver + init-mode guard

**Stack position:** 03 of 20  
**Depends on:** 02 — worktree-local + callsign resolver  
**Tier:** 2  
**Breaking change:** No  
**Primary scope:** SDK resolver chain completion

## Problem

Piece 02 establishes explicit callsign resolution and worktree-local `.squad/` discovery, but shared squads also need to resolve from machine-local clone paths and repository remotes. Without those steps, a checkout that has no local `.squad/` directory can only resolve when the caller supplies a callsign, even when the registry already contains enough information to identify the squad.

The resolver also needs a deterministic fail-shut path for initialization callers. If the caller passes a current working directory that does not exist or is not a directory, the SDK must not continue into registry, Git, or fallback probing. It must throw a configuration error before attempting resolution.

## Proposed change

Extend the SDK resolver chain after the piece 02 steps:

1. `callsign` option: resolve by explicit callsign from the registry.
2. Worktree-local: find `.squad/` at the Git root.
3. `SQUAD_CALLSIGN`: resolve by environment callsign from the registry.
4. `clones[]`: match the caller's current working directory against registered clone roots.
5. `origins[]`: match Git remote fetch URLs against registered origin URLs after canonicalization.
6. Platform fallback: probe the user-scoped platform registry location for a `.squad/` directory.
7. Linked-worktree fallback: when the current checkout is a linked worktree, inspect `git worktree list --porcelain` and use the main checkout's `.squad/` directory if present.
8. Exhausted chain: return `null`, which is the init-mode signal that no squad is currently locatable.

The guard for unreachable `cwd` runs before step 1. An empty `cwd`, missing directory, or file path is an SDK configuration error, not an init-mode `null` result.

### API surface

Add or complete the following exports from `packages/squad-sdk/src/resolution-v2.ts` and the SDK barrel as applicable:

```ts
export interface ResolvedSquad {
  path: string;
  source: 'local' | 'env' | 'clones' | 'origins' | 'platform' | 'worktree';
  callsign?: string;
  matchedOrigin?: string | null;
}

export interface ResolveOpts {
  cwd: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homeDir?: string;
  callsign?: string;
  registryPath?: string;
}

export function resolveSquad(opts: ResolveOpts): ResolvedSquad | null;
export function clonesMatch(cwd: string, clone: string): boolean;
export function collectCwdRemoteUrls(cwd: string): string[];
export function normalizeRemoteUrl(url: string): string;
```

`registryPath` has highest precedence for registry file selection, followed by `env.SQUAD_REGISTRY_PATH`, then the default user registry path under the resolved home directory. `env` is the only environment source used when provided, so tests and callers can isolate resolution from the process environment.

### Mechanism

#### Clone matching

`clonesMatch(cwd, clone)` returns true when `cwd` is the clone root or a sentinel-bounded child of the clone root. It must not match sibling prefixes such as `D:\git\repo-tools` for a registered clone `D:\git\repo`.

Path comparison contract:

- Resolve both literals with `node:path.resolve` before comparing.
- Treat Windows and macOS paths as case-insensitive; treat Linux paths as case-sensitive.
- Exact equality is bidirectional symlink-aware through `pathsRefSameLocation`.
- Containment is literal-first and then realpath fallback.
- Realpath is resolved once per side per comparison; failures fall back to literal comparison.
- Registry storage remains literal: never rewrite stored clone paths to realpaths.
- Relative clone entries are malformed for resolution and throw a configuration error.

When exactly one registry entry matches by `clones[]`, return that entry with `source: 'clones'`, its `callsign` when present, and `matchedOrigin: null`. When multiple entries match, throw a configuration error whose message starts with `Ambiguous` and tells the caller to disambiguate with `SQUAD_CALLSIGN` or a registered clone path.

#### Origin URL canonicalization

`normalizeRemoteUrl(url)` produces a canonical `host/path` string for comparison only. The resolver does not rewrite registry data or Git config values.

Canonicalization contract:

- Lowercase the host.
- Preserve organization, project, owner, and repository path casing.
- Strip a trailing `.git` suffix from recognized Git remote forms.
- Strip a single trailing slash from Azure DevOps SSH repository forms.
- Strip HTTPS userinfo such as `user@` before comparison.
- Treat standard SSH and HTTPS forms for the same GitHub-style repository as equivalent, for example `git@github.com:org/repo.git` and `https://github.com/org/repo` both compare as `github.com/org/repo`.
- Normalize Azure DevOps modern SSH, legacy SSH, modern HTTPS, and legacy HTTPS to `dev.azure.com/{org}/{project}/_git/{repo}`.
- For unknown or unparseable URL forms, lowercase the full input and use that value only as a last-resort exact comparison key.

`collectCwdRemoteUrls(cwd)` runs `git remote -v`, reads only fetch URLs, deduplicates by canonical URL, and returns the original remote URL strings. It returns an empty array when `cwd` is not a Git repository, Git is unavailable, or no remotes are configured.

Origin matching runs only after clone matching does not resolve a squad. It compares canonicalized current fetch URLs to canonicalized `origins[]` values. A single registry entry match returns `source: 'origins'` and sets `matchedOrigin` to the original `origins[]` value that matched. Multiple entry matches throw an `Ambiguous origin` configuration error with a disambiguation hint.

#### Platform and worktree fallbacks

After registry-based steps are exhausted, probe a platform-scoped `.squad/` directory:

- Windows: `%APPDATA%\squad\.squad`, falling back to `%LOCALAPPDATA%\squad\.squad` when `APPDATA` is unset.
- macOS: `~/Library/Application Support/squad/.squad`.
- Linux and other Unix platforms: `$XDG_DATA_HOME/squad/.squad`, falling back to `~/.local/share/squad/.squad`.

Only existing directories match. If the current Git root is a linked worktree marker, run `git worktree list --porcelain` and use the first listed worktree whose root contains a `.squad/` directory.

#### Init-mode guard

Before any registry read, Git command, or filesystem walk beyond the provided path, validate `opts.cwd`:

- Missing or whitespace-only `cwd`: throw a configuration error.
- Nonexistent `cwd`: throw a configuration error containing `ERR_CWD_UNREACHABLE`.
- File path instead of directory: throw the same unreachable-CWD error.
- Reachable directory with no squad match: return `null`.

This preserves the difference between “no squad is locatable; init may proceed” and “the caller supplied an invalid working directory; fail shut.”

## Test surface

Add or update unit tests for:

- Clone exact match and subdirectory match.
- Clone sibling-prefix rejection.
- Case sensitivity by platform.
- Symlink and junction exact equality through bidirectional realpath checks.
- Realpath containment fallback for registered clone paths.
- Relative clone entry rejection.
- Multiple clone matches producing an `Ambiguous` error.
- Registry-missing clone step falling through instead of throwing.
- Origin matching for any named fetch remote, not only `origin`.
- No-remotes and detached-repository fallthrough.
- Multiple origin matches producing an `Ambiguous origin` error.
- HTTPS and SSH equivalence for GitHub-style URLs.
- Azure DevOps modern SSH, legacy SSH, modern HTTPS, and legacy HTTPS normalization.
- `.git` suffix and trailing-slash handling.
- Userinfo stripping for HTTPS remote URLs.
- `matchedOrigin` preserving the original registry string.
- Platform fallback paths for Windows and Linux at minimum; macOS should be covered if practical through `platform` and `homeDir` overrides.
- Linked-worktree fallback using `git worktree list --porcelain`.
- Full chain precedence: explicit callsign, local `.squad/`, environment callsign, clones, origins, platform, worktree, null.
- Unreachable `cwd` throwing before registry or Git probing.

Tests must keep filesystem fixtures under the repository working directory and clean them up after each case. Do not use system temporary directories.

## Files

Expected implementation files:

- `packages/squad-sdk/src/resolution-v2.ts` — resolver chain, URL normalization, remote collection, platform fallback, worktree fallback, unreachable-CWD guard.
- `packages/squad-sdk/src/path-utils.ts` — shared path comparison helpers used by clone matching.
- `packages/squad-sdk/src/index.ts` — additive type/helper exports.
- `test/resolution-v2.test.ts` — resolver chain, URL normalization, and fallback coverage.
- `test/path-utils.test.ts` — path comparison and clone-matching edge cases.
- `.changeset/*resolution*clones*.md` — patch changeset for clone resolver API behavior.
- `.changeset/*resolution*origins*.md` — patch changeset for origin resolver API behavior.
- `.changeset/*resolution*init*guard*.md` — patch changeset for init-mode guard behavior.

The replay should keep the piece within the stack file-count target. If the implementation consolidates changesets, the PR description must still call out clone matching, origin matching, and init-mode guard behavior.

## Rollback

Rollback is isolated to the additive resolver module and its tests. Revert the changes in `resolution-v2.ts`, `path-utils.ts`, the SDK barrel exports, the new tests, and the changeset files. Existing legacy resolver behavior remains untouched.

If rollback is needed after later pieces depend on the completed chain, restore the piece 02 resolver behavior and temporarily disable callers that require `clones[]`, `origins[]`, platform fallback, or linked-worktree fallback.

## Notes

- Predecessor proposal documents 01 and 02 are not present in this workspace; terminology is aligned to the stack overview and recorded resolver decisions.
- The resolver stores and returns literal registry values. Canonical URL strings and realpaths are comparison keys only.
- Azure DevOps fixture URLs must use generic organizations and projects such as `contoso` and must not contain tenant-specific values.
- Keep public behavior forward-designed: describe the resolver as the SDK contract for shared-squad discovery, not as a migration from another implementation.
