@Lead and Team, this is the Phase B replay session for piece 45 of the upstream stack.
Phase A staged the piece 45 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 45 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-45-post-commit-hook-entrypoint-resolution` off
  `squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve
  that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of
  the clone.

Read these inputs in order before any work (use `git show` from the spec branch —
do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/42-fold-subtree-overlay-and-serialization.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/45-post-commit-hook-entrypoint-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `45-post-commit-hook-entrypoint-resolution.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context: piece 45 is the penultimate planned
piece; piece 46 (state-remote resolution hardening) is forward context only — implement
**only** piece 45 here.

Piece 45 resolves the cross-repo post-commit hook's entrypoint at install time so the hook
runs the same CLI build that installed it instead of a bare `squad` from the global `PATH`.
A is Tier 1 (implement). B is a Tier-2 decision (the unresolvable-entrypoint fallback) —
triage it first and either implement B1 (resolve with fallback to bare `squad`;
**recommended**) or B2 (hard-require a resolved entrypoint) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-44 base; do not assume signatures.

- `packages/squad-cli/src/cli/commands/install-hooks.ts` — the two module-level constants
  `CROSS_REPO_HOST_POST_COMMIT_TEMPLATE` (~lines 122-132; bare `squad sync --push --quiet`
  at ~line 129, inside the `.squad/`-filter `if`) and `CROSS_REPO_PRODUCT_POST_COMMIT_TEMPLATE`
  (~lines 139-146; bare invocation at ~line 144). Confirm `installCrossRepoHook` (~line 293)
  selects the variant by `isHost` (`.squad/team.md` exists) and installs via `installHook`.
  Confirm the other `HOOK_TEMPLATES` (pre-push / post-merge / post-rewrite / post-checkout,
  ~lines 32-111) invoke `git` directly and never `squad` — they are OUT OF SCOPE.
- The self-location idiom: `fileURLToPath(import.meta.url)` (the module already uses
  `createRequire(import.meta.url)` in `cli-entry.ts`). Confirm the `bin` map in
  `packages/squad-cli/package.json` (`squad` → `dist/cli-entry.js`) and that `cli-entry.ts`
  is the ESM entry. Resolve `cli-entry.js` relative to the `install-hooks` module
  (`<dist>/cli/commands/install-hooks.js` → `../../cli-entry.js`); probe `.ts` too so the
  resolver works from a source/test checkout; fall back to `process.argv[1]` when it names a
  CLI entry.
- The recursion-guard / idempotency machinery: the `SQUAD_SYNC_ACTIVE` guard, the
  `# --- squad-sync-hook ---` marker, the chaining in `installHook` (~lines 196-225), and the
  `--force` reinstall path. An absolute-path invocation changes the hook bytes — confirm
  reinstall/`--force` semantics and update any test that pinned the old bare-`squad` content.
- Tests: `test/cli/install-hooks.test.ts` is the cross-repo post-commit suite (A2 asserts the
  body contains `squad sync --push --quiet`; A3 is the recursion-guard sentinel that shadows a
  `squad` sh function). `test/hooks.test.ts` and `test/hooks-security.test.ts` are the SDK
  `HookPipeline` suites — unrelated to the git post-commit hook; confirm they are unaffected.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-45-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Resolve the CLI entrypoint at install time (`process.execPath` + `fileURLToPath(import.meta.url)`-located `cli-entry`) and embed a `<node> <cli-entry> sync --push --quiet` invocation, POSIX-quoted and Windows-path-safe, in both post-commit variants via builder functions | Tier 1 | Accept |
| B — Fallback when the entry cannot be resolved at install time: B1 resolve-with-fallback-to-bare-`squad` (**recommended**); or B2 hard-require a resolved entrypoint | Tier 2 | Decide — record B1 or B2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-45-triage.md` before writing any
product code.

---

## Workflow for piece 45

**a.** Create the implementation branch off piece 44 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-45-post-commit-hook-entrypoint-resolution <worktree-path> squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-45-triage.md`
before the first product file is modified.

**c.** For sub-proposal A (and the chosen B behavior), implement TDD: write failing tests
first, then implementation, red-to-green. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
contribute **no new** hits (compare against the piece-44 base — the count must not grow). The
stack's package scope is `@bradygaster/squad-*`; keep it as-is.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Cross-repo post-commit hook resolves
the CLI entrypoint at install time (resolved node + cli-entry, POSIX-quoted and Windows-path-
safe) instead of a bare `squad` from PATH, so the hook runs the same CLI build that installed
it."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A and the B1/B2 outcome), triage outcome, scrub gate
result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-45-post-commit-hook-entrypoint-resolution
```

**h.** STOP. Do not open a PR.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under
  `packages/squad-cli/node_modules` and shadows the workspace source, remove it so the
  workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is
  `tsc --noEmit` (no churn).
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks`) to avoid worker-contention
  timeouts (a trailing `onTaskUpdate` timeout with all tests passing is infra flakiness — the
  "Tests N passed" line is the signal).
- Revert any incidental `package.json` / `package-lock.json` / build-stamp churn before
  committing.

### Sub-proposal A — resolve and embed the entrypoint

Add a pure invocation builder, e.g. `buildSquadSyncInvocation(execPath, entryPath)`, that
returns `<sh-quoted node> <sh-quoted entry> sync --push --quiet` when `entryPath` is non-null,
else the bare `squad sync --push --quiet` (the B1 fallback). Convert each path to MSYS/POSIX
form by path shape (`C:\…` → `/c/…`, backslashes → forward slashes) and single-quote it
(`'` → `'\''`). Add `resolveCliEntry()` that probes `<moduleDir>/../../cli-entry.js`, then
`.ts`, then `process.argv[1]`. Turn the two post-commit constants into builder functions taking
the invocation string; the host builder keeps the `.squad/`-filter `if`, both keep the
`SQUAD_SYNC_ACTIVE` guard and the marker. `installCrossRepoHook` resolves once and passes the
invocation to the selected builder — its public signature is unchanged. Expose an internal
test seam (an `_`-prefixed option, matching the `_installCrossRepoHookFn` convention in
`assign.ts`) so a test can inject a known invocation for the recursion-guard fixture.

Tests: both variants embed the resolved `<node> <cli-entry> sync --push --quiet` and not the
bare `squad sync` token; the builder converts a Windows path with spaces to MSYS form and
single-quotes it; the recursion guard still gates the (injected) invocation; idempotent
re-install; the host `.squad/`-filter diff intact. Update the existing A2/A3 assertions that
pinned the bare-`squad` content.

### Sub-proposal B — unresolvable-entry fallback (decision)

Implement B1 (recommended): when `resolveCliEntry()` returns null, the builder degrades to the
bare `squad sync --push --quiet`, the install still succeeds, and the hook is non-empty. Record
B1 (or B2 if chosen) with rationale in the triage file.
