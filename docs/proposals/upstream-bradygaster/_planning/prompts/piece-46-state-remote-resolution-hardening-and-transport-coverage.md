@Lead and Team, this is the Phase B replay session for piece 46 of the upstream stack.
Phase A staged the piece 46 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 46 this session. No PR creation in Phase B. Piece 46 is the FINAL
planned piece on this stack — there is no piece 47.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-46-state-remote-resolution-hardening-and-transport-coverage`
  off `squad/piece-45-post-commit-hook-entrypoint-resolution` (tip 899d95f3)
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
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/45-post-commit-hook-entrypoint-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/46-state-remote-resolution-hardening-and-transport-coverage.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `46-state-remote-resolution-hardening-and-transport-coverage.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context: piece 46 is the LAST planned piece.
The backlog's "Operational follow-ups" are host administrative actions, NOT stack pieces —
ignore them as implementation scope.

Piece 46 hardens the cross-repo state-remote resolver so it never names a non-existent
`origin`, and closes the piece-43 transport test gap (whose pull/push tests assert argument
plumbing against the mocked `_transport` seam rather than real git fetch/push). A, B, C, D
are Tier 1 (implement). E is a Tier-2 decision (ambiguous multi-remote resolution) — triage
it first and either implement E1 (fail with an actionable error naming `stateRemote`;
**recommended**) or E2 (fall back to the first-listed remote) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-45 base; do not assume signatures.

- `resolveRemote(cwd)` in `packages/squad-cli/src/cli/commands/sync.ts` (~lines 109-121).
  Today it reads the current branch's `branch.<name>.remote` and falls back to the LITERAL
  string `'origin'` on both the empty-config branch (~line 117) and the catch (~line 119) —
  WITHOUT confirming a remote named `origin` exists. Confirm the exact failure: a host clone
  with a single differently named remote (e.g. `upstream`) and no branch tracking resolves to
  a non-existent `origin` instead of the obvious sole remote.
- Confirm EVERY call site before changing throw-behavior: `sync.ts` ~line 718
  (`options.remote ?? resolveRemote(repoRoot)`, the code clone), and ~line 808
  (`effectiveStateRemote = crossRepo ? (stateRemote ?? resolveRemote(teamRoot!)) : remote`,
  the team-root host). The code-clone value is only consumed on the single-repo path — a
  cross-repo sync must NOT throw on an unrelated code-clone remote configuration. A thrown
  error must surface as an actionable CLI message (`SquadError` from
  `packages/squad-cli/src/cli/core/errors.ts`, caught by the `main().catch` handler in
  `cli-entry.ts`), not an unhandled crash.
- `deriveStateBranch(stateBranch, callsign)` in `sync.ts` (~lines 129-133), gated by
  `CALLSIGN_RE` imported from `@bradygaster/squad-sdk/validation`
  (`/^[a-z][a-z0-9-]{1,38}$/`). Confirm the regex's rejected shapes (uppercase, underscore,
  dot, leading digit, over-length) each fall back to the flat legacy `squad-state`. Do NOT
  change `deriveStateBranch`'s behavior — this outcome is a COVERAGE gap, not a logic change.
  If the test reveals a real gap in `CALLSIGN_RE`, treat that as a finding to triage, not a
  silent fix.
- The transport seam: `_transport` (export at `sync.ts` ~line 592:
  `hydrateTeamRootFromStateRef` / `publishTeamRootToInbox`, invoked ~lines 873/899). The
  piece-43 cross-repo tests (`test/cli/cross-repo-pull-resolution.test.ts`,
  `test/cli/cross-repo-sync.test.ts`) set up REAL bare git repos but assert argument plumbing
  against the MOCKED `_transport` seam. Add NEW integration tests (do not weaken the existing
  ones) that exercise the REAL transport end-to-end.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-46-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Harden `resolveRemote` to the precedence: tracking remote → sole configured remote → `origin` only if it exists → else throw an actionable `SquadError` naming `stateRemote` | Tier 1 | Accept |
| B — New integration test: cross-repo `--pull` from a REAL bare state remote whose branch is `squad/state/<callsign>` (derived) hydrates `.squad` files (real fetch, not mocked) | Tier 1 | Accept |
| C — New integration test: cross-repo `--push` to a REAL bare host remote NOT named `origin` publishes the inbox ref (real push, resolved remote) | Tier 1 | Accept |
| D — Focused unit test: `deriveStateBranch` returns flat `squad-state` for every invalid callsign shape (uppercase, underscore, dot, leading digit, over-length) | Tier 1 | Accept |
| E — Ambiguous resolution (no tracking, no `origin`, >1 remote): E1 fail with an actionable error naming `stateRemote` (**recommended**); or E2 fall back to the first-listed remote | Tier 2 | Decide — record E1 or E2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-46-triage.md` before writing any
product code.

---

## Workflow for piece 46

**a.** Create the implementation branch off piece 45 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-46-state-remote-resolution-hardening-and-transport-coverage <worktree-path> squad/piece-45-post-commit-hook-entrypoint-resolution
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-46-triage.md`
before the first product file is modified.

**c.** For sub-proposal A (and the chosen E behavior), implement TDD: write failing tests
first, then implementation, red-to-green. B, C, D are test-coverage additions. See
implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
contribute **no new** hits (compare against the piece-45 base — the count must not grow). The
stack's package scope is `@bradygaster/squad-*`; keep it as-is — do not introduce
`@wifi-aware` into clean files.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Harden the cross-repo state-remote
resolver to prefer the branch's tracking remote, then the sole configured remote, then an
existing `origin`, else fail with an actionable error directing the operator to set
`stateRemote` — instead of silently naming a non-existent `origin`."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A/B/C/D and the E1/E2 outcome), triage outcome, scrub
gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-46-state-remote-resolution-hardening-and-transport-coverage
```

**h.** STOP. Do not open a PR. This is the final piece on the stack; when it is pushed,
report stack completion.

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
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
  worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is
  infra flakiness — the "Tests N passed" line is the signal). The real-git fetch/push tests
  are slow on Windows — keep them isolated and give them headroom.
- Revert any incidental `package.json` / `package-lock.json` / build-stamp churn (the prebuild
  stamps a version into `package.json` x3 and `.github/agents/squad.agent.md`, and runs
  `sync-templates`) before committing.
- The piece-38 sync/publish failures (J6/J7/M2/O6/N2/PM1/PM2) and assign P34.A1/A3 are KNOWN
  pre-existing on this stack — confirm they remain unchanged; do not attribute them to piece
  46. Classify every regression sweep failure as pre-existing-on-base vs. caused-by-this-piece
  (run the same file on the piece-45 base worktree to confirm).

### Sub-proposal A — harden the resolver

Rewrite `resolveRemote(cwd)` to the precedence: (1) the branch's tracking remote
(`branch.<name>.remote`) when set; (2) else parse `git remote` — when exactly one remote is
configured, return it; (3) else return `origin` only when `origin` appears in the remote list;
(4) else throw a `SquadError` naming `stateRemote` as the fix. Keep the function signature.
To keep the code-clone call site (`options.remote ?? resolveRemote(repoRoot)`) from throwing
on a cross-repo sync where the value is unused, resolve it lazily (memoized) so it is only
evaluated on the single-repo path. Confirm the team-root call
(`stateRemote ?? resolveRemote(teamRoot!)`) is the one whose throw is the desired
cross-repo behavior.

Tests (unit, fast — real bare/working repos but no network): tracking remote → that remote;
no tracking + single `upstream` → `upstream`; no tracking + `upstream`+`origin` → `origin`;
no tracking + multiple non-`origin` → throws `SquadError` naming `stateRemote`.

### Sub-proposals B, C — real-transport integration tests

Model the fixtures on the existing `test/cli/cross-repo-sync.test.ts` real-bare-repo helpers
(`initBareRepo`, `initWorkingRepo`, `setupSquadDir`, `listBareRefs`). Do NOT spy on
`_transport` in these tests.
- B (pull): publish a snapshot to a real bare remote so a `squad/state/<callsign>` (or inbox)
  branch exists; configure a registry entry with the callsign and no explicit `stateBranch`;
  run `runSync({ direction: 'pull', ... })`; assert a known `.squad` file now exists in the
  team-root.
- C (push): create a real bare remote and a team-root host whose SOLE remote is named (e.g.)
  `upstream`; configure a registry entry with a callsign and no explicit `stateRemote`; run
  `runSync({ direction: 'push', ... })`; assert a `squad/inbox/<callsign>/...` ref exists on
  the bare remote (proving the sole-remote precedence + real push).

### Sub-proposal D — invalid-callsign unit test

A focused, fast unit test importing `deriveStateBranch` from `sync.ts`. Table-driven over the
invalid shapes (`Foo`, `foo_bar`, `foo.bar`, `1foo`, and a 40+-char string) asserting each
returns `squad-state`; positive controls: a valid callsign → `squad/state/<callsign>`, and an
explicit `stateBranch` → that value verbatim. Do not change `deriveStateBranch`.
