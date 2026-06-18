# 47 — Monorepo team-root git-dir resolution and sync registry robustness

## Summary

The cross-repo transport in `packages/squad-cli/src/cli/commands/sync.ts` assumes a team root
is always the top level of its own git repository: in two places it constructs the git
directory as the literal `<teamRoot>/.git`. That holds for a single-repo host (team root ==
repo root) but **not** for a monorepo host, where the `.squad` team root lives in a subdirectory
(for example `teams/<callsign>/.squad`) and the repository's real `.git` is at the repo root.
On such a host both transport directions fail: `--push` aborts when it tries to create its
isolated index under a non-existent `<subdir>/.git`, and `--pull` would fail identically when it
runs `git --git-dir <subdir>/.git` to enumerate and write the state tree.

This was found by a dogfooding pass against the landed stack (piece-46 tip). A single-repo
`sync --push` completes end-to-end and publishes the inbox ref; the same flow on a monorepo team
root in a subdirectory fails with:

```
fatal: Unable to create '<repo>/teams/<callsign>/.git/squad-publish-index-...lock':
No such file or directory
```

because the index path is built from `<teamRoot>/.git` while the real git directory is at the
repo root. The fix is to resolve the **actual** git directory for the team root with
`git rev-parse --absolute-git-dir` (run with `cwd: teamRoot`, which discovers the repository
upward) instead of assuming `<teamRoot>/.git` — correct for single-repo hosts, monorepo
subdirectory team roots, and linked worktrees alike.

The same pass surfaced two adjacent robustness gaps in `sync`'s registry/team-root resolution
that the monorepo scenario runs into: (1) `sync` calls `loadRegistryFromDisk()` with no
arguments, so it silently ignores the `--registry-path` option that `init` honours and always
reads the default user registry; and (2) setting the `SQUAD_TEAM_ROOT` env override bypasses the
registry lookup entirely, discarding the entry's `callsign` (and `stateRemote` / `stateBranch` /
`inboxHandle`), after which a cross-repo `--push` fails the callsign guard with `FATAL: no
callsign set for this registry entry` and offers no flag to supply one.

This piece (A) resolves the real git dir in `publishTeamRootToInbox` and (B) in
`hydrateTeamRootFromStateRef`, replacing both `<teamRoot>/.git` assumptions with a shared
git-dir resolver; (C) threads the `--registry-path` option through `sync` into
`loadRegistryFromDisk`; and a Tier-2 decision (D) covers what the `SQUAD_TEAM_ROOT` override
should do about registry-sourced config (callsign and state fields) so cross-repo publish from an
env-overridden team root is usable.

Stack position: Part 47 of the cross-repo arc. Branches off piece 46
(`squad/piece-46-state-remote-resolution-hardening-and-transport-coverage`, tip `583543b9`).
Piece 46 was the last *planned* piece on this stack; this piece reopens it from a fresh
dogfooding pass that found the monorepo team-root transport defect (live) plus the two sync
registry-resolution gaps. It depends on the callsign-namespaced transport (piece 40), the
repo-root / generic discovery work (piece 41), and the cross-repo state-remote / state-branch
resolution (piece 43) that established `teamRoot`, the `_transport` seam
(`publishTeamRootToInbox` / `hydrateTeamRootFromStateRef`), and the registry `callsign` /
`stateRemote` / `stateBranch` / `inboxHandle` fields this piece operates on.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs
`41-fold-pipeline-repo-root-and-generic-discovery.md`,
`43-cross-repo-state-remote-and-branch-resolution.md`,
`46-state-remote-resolution-hardening-and-transport-coverage.md`, and the
`_planning/dogfood-backlog.md` roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (the git-dir resolver and the
registry-path threading) — include a `patch` changeset entry for `@bradygaster/squad-cli`.

---

## Problem

### 1. `publishTeamRootToInbox` builds the isolated index under `<teamRoot>/.git`

In `publishTeamRootToInbox`, the snapshot is built with an isolated index whose path is
constructed from the team root plus a literal `.git`:

```ts
// Step 5: Build snapshot via git plumbing with isolated index
const indexFile = path.join(
  teamRoot, '.git',
  `squad-publish-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
const indexEnv = { ...process.env, GIT_INDEX_FILE: indexFile };
```

`GIT_INDEX_FILE` is then handed to `git update-index` (and the subsequent write-tree /
commit-tree plumbing). When the team root is a monorepo subdirectory, `<teamRoot>/.git` does not
exist — the repository's real git directory is at the repo root — so git cannot create the
index lock file and the push aborts with `fatal: Unable to create
'<teamRoot>/.git/squad-publish-index-...lock': No such file or directory`. Note that the
neighbouring plumbing calls that use `cwd: teamRoot` (for example the base-commit
`git rev-parse HEAD` at Step 3) work correctly, because git discovers the repository by walking
**up** from the working directory; only the places that **construct** `<teamRoot>/.git`
explicitly are wrong. This is the defect reproduced live in the dogfooding pass.

### 2. `hydrateTeamRootFromStateRef` runs `git --git-dir <teamRoot>/.git`

The pull side has the same assumption. After fetching the state branch (the fetch itself uses
`cwd: teamRoot` and so discovers the repo correctly), the tree is enumerated and written with an
explicit `--git-dir` built from `<teamRoot>/.git`:

```ts
const normalizedGitDir = path.join(teamRoot, '.git').replace(/\\/g, '/');
// ...
const fileList = execFileSync('git', [
  '--git-dir', normalizedGitDir,
  'ls-tree', '-r', '--name-only', `refs/remotes/${remote}/${stateBranch}`,
], { ... });
```

For a monorepo subdirectory team root, `<teamRoot>/.git` is not a git directory, so
`git --git-dir <teamRoot>/.git ls-tree ...` (and the per-file `cat-file blob`) fails and the
hydration aborts. This is the pull-direction sibling of (1); it was confirmed by static
inspection (a single-repo pull succeeds; the monorepo path takes this branch and fails
identically).

### 3. `sync` ignores `--registry-path` and `SQUAD_TEAM_ROOT` drops the registry callsign

Two registry-resolution gaps in `runSync` surface in the monorepo scenario:

**3a. `--registry-path` is silently ignored.** `runSync` resolves the registry with
`loadRegistryFromDisk()` — called with **no arguments** at both resolution sites — so it always
reads the default user registry (`<home>/registry.json`). The SDK helper already accepts an
options object (`loadRegistryFromDisk({ registryPath })` → `resolveRegistryPath`), and `init`
exposes a `--registry-path` flag, but `sync` never threads it through. There is no way to point
`sync` at an alternate registry, which blocks isolated testing/dogfooding and is an
inconsistency with `init`.

**3b. `SQUAD_TEAM_ROOT` discards the registry entry's callsign and state config.** When
`SQUAD_TEAM_ROOT` is set, `runSync` adopts it as the team root and **bypasses the registry
lookup entirely**:

```ts
if (process.env['SQUAD_TEAM_ROOT']) {
  // Explicit env override: bypass registry lookup entirely
  teamRoot = process.env['SQUAD_TEAM_ROOT'];
} else {
  const { registry } = loadRegistryFromDisk();
  // ... resolves registryCallsign, stateRemote, stateBranch, registryAlias ...
}
```

Because the override skips the `else` branch, `registryCallsign` (and `stateRemote`,
`stateBranch`, `registryAlias`) stay undefined. A cross-repo `--push` then hits the callsign
guard and exits `FATAL: no callsign set for this registry entry`, and `sync` exposes no
`--callsign` flag to supply one — so pointing `SQUAD_TEAM_ROOT` at a monorepo team root and
publishing is impossible even when a matching registry entry exists.

---

## Proposed change

Sub-proposals A, B, and C are Tier 1 (concrete, implementation-ready). Sub-proposal D is Tier 2
(a decision with a behavior-surprise cost) and is gated on the maintainer's choice.

A and B are the git-dir correctness fix (the anchor of this piece) and share one small resolver
helper. C is a small option-threading fix. D governs the `SQUAD_TEAM_ROOT` override's
interaction with the registry.

**Recommended implementation order:** A and B together (introduce the shared git-dir resolver
and apply it at both sites), then C (thread `--registry-path`), then resolve D and implement the
chosen behavior.

---

## Tier 1

### A. Resolve the real git dir in `publishTeamRootToInbox`

**Current behavior:** the isolated-index path is `path.join(teamRoot, '.git', ...)`, which does
not exist when the team root is a monorepo subdirectory, aborting the push.

**Required behavior:** resolve the team root's **actual** git directory and place the isolated
index inside it. The git directory is obtained by running `git rev-parse --absolute-git-dir`
with `cwd: teamRoot` (git discovers the repository by walking upward), which returns the repo's
real `.git` for a single-repo host, the repo-root `.git` for a monorepo subdirectory team root,
and the correct linked-worktree git directory for a worktree checkout. The resolved directory is
used to build `GIT_INDEX_FILE`; all other plumbing is unchanged.

**Hard constraints:**
- The isolated index is created inside the directory reported by `git rev-parse
  --absolute-git-dir` (cwd = teamRoot), never a literal `<teamRoot>/.git`.
- A single-repo host (team root == repo root) behaves exactly as today.
- A monorepo team root in a subdirectory publishes successfully — the live-reproduced
  `fatal: Unable to create '<teamRoot>/.git/squad-publish-index-...lock'` no longer occurs.
- The isolated-index cleanup (the existing `fs.unlinkSync(indexFile)`) targets the new resolved
  path so no stray index file is left in the real git directory.
- If git dir resolution fails (the team root is not inside a git repository), the failure is an
  actionable error, not an attempt to write under a non-existent path.

**Test surface:** (a) single-repo team root — push succeeds and the index path resolves to the
repo's own `.git` (unchanged behavior). (b) monorepo team root in a subdirectory whose real
`.git` is at the repo root — push succeeds and publishes the inbox ref to the remote (the
regression test for the live defect). (c) the temporary index file does not remain in the
resolved git directory after a successful publish.

### B. Resolve the real git dir in `hydrateTeamRootFromStateRef`

**Current behavior:** `normalizedGitDir = path.join(teamRoot, '.git')` is passed as `--git-dir`
to the `ls-tree` and `cat-file` calls that enumerate and write the state tree, which fails for a
monorepo subdirectory team root.

**Required behavior:** resolve the team root's actual git directory with the same shared helper
used in A (`git rev-parse --absolute-git-dir`, cwd = teamRoot) and use that value for the
`--git-dir` arguments. The fetch (Step 1, already `cwd: teamRoot`) and the sentinel/idempotency
logic are unchanged.

**Hard constraints:**
- The `--git-dir` passed to `ls-tree` / `cat-file` is the directory reported by
  `git rev-parse --absolute-git-dir` (cwd = teamRoot), never a literal `<teamRoot>/.git`.
- A single-repo team root hydrates exactly as today.
- A monorepo team root in a subdirectory hydrates `.squad` files correctly from the state branch.
- The resolved git-dir string is normalized for the `--git-dir` argument the same way the
  current code normalizes path separators.

**Test surface:** (a) single-repo team root — pull hydrates `.squad` files (unchanged). (b)
monorepo team root in a subdirectory whose real `.git` is at the repo root — pull hydrates a
known `.squad` file into the team root (the pull-side regression test).

### C. Thread `--registry-path` through `sync` into `loadRegistryFromDisk`

**Current behavior:** `runSync` calls `loadRegistryFromDisk()` with no arguments at both
resolution sites, ignoring any `--registry-path` the operator passes; `sync` always reads the
default user registry.

**Required behavior:** `sync` accepts a registry-path option (the same `--registry-path` flag
`init` honours) and threads it into `loadRegistryFromDisk({ registryPath })` at every call site
in `runSync`. When the option is absent, behavior is unchanged (default user registry). This
restores parity with `init` and makes `sync` usable against an isolated registry.

**Hard constraints:**
- When `--registry-path` is provided, every `loadRegistryFromDisk` call in the sync path uses it.
- When it is absent, the default registry path resolution is unchanged.
- The option is surfaced in `squad sync --help`.
- The flag name and semantics match `init`'s `--registry-path` (a file path, or a directory in
  which `registry.json` is resolved, per the SDK's `resolveRegistryPath`).

**Test surface:** `runSync` with an explicit registry path resolves the team-root entry from
that registry (not the default); without the option, the default path is used.

---

## Tier 2 (decision)

### D. `SQUAD_TEAM_ROOT` override and registry-sourced callsign / state config

**Decision required:** what `runSync` does about the registry entry's `callsign` (and
`stateRemote` / `stateBranch` / `inboxHandle`) when `SQUAD_TEAM_ROOT` is set. Today the env
override bypasses the registry lookup, leaving `callsign` undefined, so a cross-repo `--push`
fails the callsign guard with no way to supply one.

**Option D1 — Augment the override from the registry when a matching entry exists (recommended).**
When `SQUAD_TEAM_ROOT` is set, still load the registry and look for the entry whose team root
(`path.dirname(entry.path)`) matches the override; if found, adopt its `callsign`,
`stateRemote`, `stateBranch`, and `inboxHandle` (the env override still wins for the team-root
*path* itself). If no entry matches, proceed exactly as today (env-only, no registry config).
This keeps the override's purpose — point at a specific team root — while making cross-repo push
work when the team root is registered, and stays fully backward compatible for the unregistered
env-only case. Cost: the override now performs a registry read it previously skipped (a
best-effort lookup whose failure is non-fatal).

**Option D2 — Add explicit `--callsign` (and `--state-remote` / `--state-branch`) flags to
`sync`.** Leave the env override registry-free and let the operator supply the callsign and
state config on the command line. Cost: more flags to pass on every invocation and an
opportunity for the supplied callsign to disagree with the registry; it does, however, keep the
env override deliberately registry-independent for hermetic contexts.

**Recommendation: D1.** Make the env override augment from the registry when an entry matches,
falling back to today's env-only behavior otherwise. It fixes the cross-repo publish case with no
new flags and no change for unregistered overrides. (D1 and D2 are not mutually exclusive — a
`--callsign` flag could be added later — but D1 alone resolves the defect.)

**Hard constraints (whichever is chosen):**
- The `SQUAD_TEAM_ROOT` value continues to win for the team-root *path*.
- For D1: when an entry matches the override team root, its `callsign` / `stateRemote` /
  `stateBranch` / `inboxHandle` are adopted; when none matches, behavior is exactly as today
  (env-only, no registry config, no new failure).
- For D1: the registry read triggered by the override is best-effort — a missing or unreadable
  registry does not turn a previously-working env-only sync into a failure.
- A cross-repo `--push` from an env-overridden team root that resolves a callsign no longer exits
  `FATAL: no callsign set for this registry entry`.
- The decision and rationale are recorded in the Phase-B triage file so it is auditable.

**Test surface:** for D1, `SQUAD_TEAM_ROOT` pointed at a registered team root yields a cross-repo
`--push` that resolves the registry callsign and publishes (no callsign-guard failure), while
`SQUAD_TEAM_ROOT` pointed at an unregistered path behaves as today. For D2, `sync --push
--callsign <name>` under the env override publishes with the supplied callsign.

---

## Acceptance

- Build exits 0.
- `publishTeamRootToInbox` builds its isolated index inside the directory reported by `git
  rev-parse --absolute-git-dir` (cwd = teamRoot), never a literal `<teamRoot>/.git` (A).
- `hydrateTeamRootFromStateRef` passes that same resolved git directory as `--git-dir` to its
  `ls-tree` / `cat-file` calls, never a literal `<teamRoot>/.git` (B).
- A single-repo host (team root == repo root) pushes and pulls exactly as before (A/B).
- A monorepo team root in a subdirectory whose real `.git` is at the repo root: `sync --push`
  publishes the inbox ref (no `fatal: Unable to create '<teamRoot>/.git/squad-publish-index-...'`)
  and `sync --pull` hydrates `.squad` files into the team root (A/B).
- The temporary isolated-index file is cleaned up from the resolved git directory after a
  successful publish (A).
- `sync` honours `--registry-path`, threading it into every `loadRegistryFromDisk` call in the
  sync path; absent the option, the default registry is used; the option appears in
  `sync --help` (C).
- Sub-proposal D is resolved one way or the other: either `SQUAD_TEAM_ROOT` augments callsign /
  state config from a matching registry entry (D1) or `sync` gains explicit `--callsign` (and
  state) flags (D2); the choice and rationale are recorded in the Phase-B triage. A cross-repo
  `--push` from an env-overridden, registered team root no longer fails the callsign guard.
- For D1: an env override pointed at an unregistered path behaves exactly as today, and the
  best-effort registry read never turns a previously-working env-only sync into a failure.
- Tests cover: single-repo push/pull unchanged; monorepo subdirectory push publishes and pull
  hydrates (A/B); index cleanup (A); `--registry-path` resolution and its default fallback (C);
  and the chosen D behavior (env-override callsign resolution for D1, or the `--callsign` flag
  for D2).
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
- No specific internal tenant/host URL appears in any documentation; placeholders use
  `dev.azure.com/contoso/MyProject`.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
