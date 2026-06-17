@Lead and Team, this is the Phase B replay session for piece 43 of the upstream stack.
Phase A staged the piece 43 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 43 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-43-cross-repo-state-remote-and-branch-resolution` off
  `squad/piece-42-fold-subtree-overlay-and-serialization`
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
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/40-callsign-namespaced-transport.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/41-fold-pipeline-repo-root-and-generic-discovery.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/42-fold-subtree-overlay-and-serialization.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `43-cross-repo-state-remote-and-branch-resolution.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context: it maps the dogfood-discovered work
to delivered (piece 41), specced (pieces 42–43), and planned candidates (44–45). Read it so
you understand where piece 43 sits and what depends on it; implement **only** piece 43 here.

Piece 43 fixes the cross-repo `sync --pull` resolution that pieces 40–42 left behind. It
(A) resolves the state remote from the registry/team-root host rather than the code clone's
origin; (B) derives `squad/state/<callsign>` when a registry entry has no explicit
`stateBranch` but carries a callsign, reusing the existing `CALLSIGN_RE`; and (C) stops the
cross-repo pull from running the in-clone fetch against the code clone. A, B, C are Tier 1
(implement). D is a Tier-2 decision (fallback when an entry has neither `stateBranch` nor a
callsign) — triage it first and either implement D1 (retain the flat `squad-state` legacy
default, **recommended**) or D2 (fail fast) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-42 base; do not assume signatures.

- `packages/squad-cli/src/cli/commands/sync.ts` — `runSync`: the `--pull` path, how it
  resolves the state remote (`stateRemote`, `DEFAULT_STATE_REMOTE`, `resolveRemote`), the
  state branch (`stateBranch ?? 'squad-state'`), where `syncPull(repoRoot, remote, ...)` is
  invoked relative to `hydrateTeamRootFromStateRef`, and the `crossRepo` / `teamRoot`
  resolution block. Confirm the signatures of `syncPull`, `resolveRemote`, and
  `hydrateTeamRootFromStateRef` before changing call sites.
- Registry / team-root resolution: `packages/squad-sdk/src/registry.ts` (the `stateRemote`
  / `stateBranch` / `callsign` fields and how they are read) and the registry-first
  resolution in `runSync` (`loadRegistryFromDisk`, the `clones[]` match → `entry`).
- The existing callsign validator and namespaced-branch construction: `CALLSIGN_RE` in
  `packages/squad-sdk/src/validation.ts`, and the inline `squad/state/${callsign}`
  interpolation in `packages/squad-cli/src/commands/assign.ts` and `init.ts`. REUSE
  `CALLSIGN_RE` to derive `squad/state/<callsign>`; do not introduce a second pattern. Prefer
  a single source of truth for the namespaced branch name across the pull, assign, and init
  call sites.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-43-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Resolve the state remote from the registry/team-root host (entry `stateRemote`, else the host clone's remote), never the code clone's origin | Tier 1 | Accept |
| B — Derive `squad/state/<callsign>` when `stateBranch` is unset but a valid callsign is present, reusing `CALLSIGN_RE`; explicit `stateBranch` wins | Tier 1 | Accept |
| C — Cross-repo pull does not run the in-clone fetch (`syncPull`) against the code clone; hydration from the state ref is the sole source; single-repo pull unchanged | Tier 1 | Accept |
| D — Fallback when an entry has neither `stateBranch` nor a callsign: D1 retain flat `squad-state` legacy default (**recommended**); or D2 fail fast with a teaching error | Tier 2 | Decide — record D1 or D2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-43-triage.md` before writing any
product code.

---

## Workflow for piece 43

**a.** Create the implementation branch off piece 42 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-43-cross-repo-state-remote-and-branch-resolution <worktree-path> squad/piece-42-fold-subtree-overlay-and-serialization
```

A placeholder branch may already exist at the tip of piece 42 with no commits of its own;
if so, reset/reuse it — it must start from the piece-42 tip and carry only this session's
work.

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-43-triage.md`
before the first product file is modified.

**c.** For each accepted sub-proposal, implement TDD: write failing tests first, then
implementation, red-to-green. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
contribute **no new** hits (compare the strip-list against the piece-42 base — the count
must not grow). The stack's package scope is `@bradygaster/squad-*`; keep it as-is and do
not let any other scope leak into product strings.

**e.** Add a changeset (REQUIRED — `packages/*/src` is touched):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. If you factor the namespaced-branch derivation
into a shared SDK helper, also select `patch` for `@bradygaster/squad-sdk`. Summary:
"Cross-repo squad sync --pull resolves the state remote from the registry/team-root host and
derives squad/state/<callsign> when a registry entry has no explicit stateBranch, and no
longer runs the in-clone fetch against the code clone."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A, B, C, and the D1/D2 outcome), triage outcome, scrub
gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-43-cross-repo-state-remote-and-branch-resolution
```

**h.** STOP. Do not open a PR.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under
  `packages/squad-cli/node_modules` and shadows the workspace source, remove it so the
  workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`.

### Sub-proposal A — host state-remote resolution

In `runSync`'s `--pull` path, the effective state remote must resolve from (1) the registry
entry's `stateRemote`; (2) when absent, the team-root host clone's remote (resolved against
`teamRoot`, e.g. `resolveRemote(teamRoot)`), never the code clone's `resolveRemote(repoRoot)`
and never a context-free literal that could point at the wrong origin. Thread the resolved
host remote into `hydrateTeamRootFromStateRef`. An explicit `entry.stateRemote` is used
verbatim. Leave the single-repo path's `remote` resolution unchanged.

Tests: cross-repo pull with explicit `stateRemote` hydrates from that remote; cross-repo
pull without `stateRemote` resolves the remote from the team-root host (not the code clone's
origin); the code clone's origin is not the remote handed to the hydration call.

### Sub-proposal B — namespaced state-branch derivation

When `entry.stateBranch` is set, use it verbatim. When it is unset but `entry.callsign` is a
valid callsign (`CALLSIGN_RE.test(callsign)`), derive `squad/state/${callsign}` — byte
identical to what `assign.ts` / `init.ts` persist and what the fold pipeline writes. Reuse
`CALLSIGN_RE` from `packages/squad-sdk/src/validation.ts`; do not add a second pattern.
Prefer a single shared helper for the `squad/state/<callsign>` string that the pull, assign,
and init call sites can all adopt (if added in the SDK, classify the SDK changeset
accordingly).

Tests: explicit `stateBranch` → no derivation; unset `stateBranch` + callsign `foo` →
`squad/state/foo`; derived value equals the assign/init-persisted value for the same
callsign.

### Sub-proposal C — cross-repo pull skips the in-clone fetch

In the `--pull` path, only run `syncPull(repoRoot, remote, ...)` when NOT in cross-repo mode
(`crossRepo === false`). In cross-repo mode the sole hydration source is
`hydrateTeamRootFromStateRef` with the resolved host remote (A) and state branch (B). The
misleading "No remote squad-state refs found" notice must not appear for a cross-repo pull.
The recursion guard, dry-run preview, and push path are untouched.

Tests: cross-repo pull does not invoke the in-clone fetch and prints no "no remote
squad-state refs" notice; single-repo pull still invokes `syncPull`; cross-repo hydration is
called with the resolved host remote and branch.

### Sub-proposal D — fallback decision

If **D1** (recommended): when neither `stateBranch` nor a valid callsign is available, retain
the flat `squad-state` legacy default (current behavior). Derivation (B) only fires when a
valid callsign is present. Record D1 and rationale in the triage file.

If **D2**: abort the cross-repo pull with a teaching error directing the operator to set a
callsign (`squad assign --callsign <name>`) or an explicit `stateBranch`. Add a test for the
abort path. Record D2 and rationale in the triage file.

---

## Acceptance gate

- `npm run build` exits 0.
- All new tests pass (`npm test`); no existing tests broken. (The full suite is heavy and
  some integration tests are flaky under worker contention — confirm the deliverable test
  files for sync pull resolution are green, and that any failures elsewhere reproduce on the
  piece-42 base, i.e. are pre-existing rather than introduced here.)
- Sub-proposal A: the state remote resolves from the registry/team-root host, never the code
  clone's origin; an explicit `stateRemote` is used verbatim.
- Sub-proposal B: an entry without `stateBranch` but with a callsign hydrates from
  `squad/state/<callsign>`, derived via `CALLSIGN_RE`, byte-identical to the assign/init
  value; an explicit `stateBranch` wins.
- Sub-proposal C: a cross-repo pull does not run the in-clone fetch against the code clone
  and emits no "no remote squad-state refs" notice; the single-repo pull is unchanged.
- Sub-proposal D: the chosen option (D1 or D2) is implemented and recorded in the triage with
  rationale.
- Changeset: `patch` for `@bradygaster/squad-cli` present (plus `@bradygaster/squad-sdk` if a
  shared helper is added there).
- No specific internal tenant URL appears in any documentation.
- Scrub gate: changes contribute no new hits.
- Commit: single squashed commit with `Co-authored-by: Copilot ...` trailer.
- Branch pushed to `origin`; no PR opened.
