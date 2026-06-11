@Lead and Team, this is the Phase B replay session for piece 40 of the upstream stack.
Phase A staged the piece 40 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted Tier-1 sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 40 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay` (clone of akubly/squad).
- Branch to create: `squad/piece-40-callsign-namespaced-transport` off
  `squad/piece-39-dogfood-fixes-and-fold-pipeline-repair`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve
  that isolation.

Read these inputs in order before any work (use `git show` from the spec branch —
do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/40-callsign-namespaced-transport.md
```

If `40-callsign-namespaced-transport.md` does not exist on `akubly/upstream-specs`,
STOP immediately. Post a blocking comment asking the spec to be staged before this
session proceeds.

Piece 40 adds callsign namespacing to transport branches, enabling multiple squads to
share one remote without collision. The implementation in Phase B covers Tier-1 items
A–D. Tier-2 item E requires a recorded decision before any back-compat migration code
lands — do not implement E this session unless the decision is already recorded in
`.squad/decisions/inbox/`.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-40-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Callsign-namespaced inbox branches (`sync.ts:326`, capture near `sync.ts:645`) | Tier 1 | Accept |
| B — Callsign-namespaced state branch (`squad/state/<callsign>` default at init/assign) | Tier 1 | Accept |
| C — `install-fold-pipeline --callsign` parameterization (trigger glob + fold target) | Tier 1 | Accept — both ADO and GitHub templates |
| D — Origin-ambiguity guard behaviors: confirm 2-squad warning, 3-squad --callsign fix, Guard 7 | Tier 1 | Accept — tests only unless a guard is found incorrect |
| E — Back-compat / migration for existing flat-namespace deployments | **DECISION PENDING** | **Do not implement until the decision is recorded. Recommendation is E3 (documented cutover + squad doctor warning). If unresolved, defer.** |

Record accept/defer for each sub-proposal in `.squad/decisions/inbox/piece-40-triage.md`
before writing any product code.

---

## Workflow for piece 40

**a.** Create the implementation branch off piece 39:

```
git fetch origin
git checkout squad/piece-39-dogfood-fixes-and-fold-pipeline-repair
git checkout -b squad/piece-40-callsign-namespaced-transport
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-40-triage.md`
before the first product file is modified.

**c.** For each accepted sub-proposal (A–D), implement TDD: write failing tests first,
then implementation, red-to-green. Recommended order: A (inbox prefix), B (state branch
default), C (pipeline parameterization), D (guard verification). E is gated on its
decision.

See implementation notes below for per-sub-proposal file:line guidance.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking.

**e.** Add a changeset:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Callsign-namespaced transport:
inbox branches include callsign, state branch defaults to squad/state/<callsign>,
install-fold-pipeline accepts --callsign to scope trigger and target per squad."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A–D), E deferral status, triage outcome, scrub
gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-40-callsign-namespaced-transport
```

**h.** STOP. Do not open a PR.

---

## Implementation notes

### Sub-proposal A — Callsign-namespaced inbox branches (`sync.ts:326`, `sync.ts:645`)

Capture the callsign from the registry entry near `sync.ts:645`, where
`registryAlias = entry.inboxHandle` is already captured:
```typescript
registryCallsign = entry.callsign;  // add alongside registryAlias
```

Thread `registryCallsign` through to `publishTeamRootToInbox` (it receives `teamRoot`,
`inboxHandle`, and other params — add `callsign`).

Change the branch name at `sync.ts:326` from:
```typescript
const inboxBranch = `squad/inbox/${inboxHandle}/${ts}-${seq}-${sessionId}`;
```
to:
```typescript
const inboxBranch = `squad/inbox/${callsign}/${inboxHandle}/${ts}-${seq}-${sessionId}`;
```

Validate `callsign` before use — apply the same character pattern as `INBOX_HANDLE_RE`
(or a new `CALLSIGN_RE` constant). If callsign is unset at publish time, throw a fatal
error with a clear message directing the user to set it via `squad assign --callsign`.

Add `callsign` to the `publish-metadata.json` written during staging (wherever the
metadata object is constructed in `publishTeamRootToInbox`).

**Callsign in single-repo mode:** When no registry entry is matched (`crossRepo = false`,
no callsign available), continue using the two-component prefix
`squad/inbox/<handle>/<ts>-<seq>-<sessionId>` unchanged.

Align new test import specifiers with the working branch's existing test file import
pattern.

---

### Sub-proposal B — Callsign-namespaced state branch default

In `squad init` and/or `squad assign`, when writing a new registry entry and a callsign
is provided, set the default `stateBranch` to `squad/state/<callsign>`:

```typescript
stateBranch: opts.callsign ? `squad/state/${opts.callsign}` : undefined,
```

The hydrate call at `sync.ts:749–750` already reads `entry.stateBranch ?? 'squad-state'`
— once the registry entry carries the namespaced branch name, pull automatically uses it
without further change to the pull path.

The bare `squad-state` fallback in `sync.ts:749–750` remains as the last resort for
entries with no `stateBranch`, preserving compatibility with existing un-migrated entries.

---

### Sub-proposal C — `install-fold-pipeline --callsign` (`install-fold-pipeline.ts`)

Add `--callsign <name>` to the command's option parser. When provided:
- **GitHub template:** replace the hardcoded trigger branch pattern
  `'squad/inbox/**'` with `'squad/inbox/<callsign>/**'` and replace the hardcoded fold
  target `squad-state` with `squad/state/<callsign>`.
- **ADO template:** replace `refs/heads/squad/inbox/*` with
  `refs/heads/squad/inbox/<callsign>/*` and replace the fold target `squad-state` with
  `squad/state/<callsign>`.

When `--callsign` is absent, both templates are generated verbatim as before (backward
compatibility).

Validate callsign before injecting into the YAML (use the same `CALLSIGN_RE` from
sub-proposal A).

Test: generate GitHub template with `--callsign teamA`, verify trigger contains
`squad/inbox/teamA/**` and target contains `squad/state/teamA`. Same for ADO. Generate
without `--callsign`, verify existing patterns are unchanged.

---

### Sub-proposal D — Origin-ambiguity guard confirmation (`assign.ts:530–544`)

Write three tests:
1. **2-squad scenario:** Two registry entries with distinct callsigns, both with the same
   remote URL in `origins[]`. Assigning a new product clone to the second entry:
   `originMatchingEntries.length === 1` → warning emitted, assignment succeeds.
2. **3-squad scenario without `--callsign`:** Three entries with the same remote.
   Assigning a new product clone → `ERR_ASSIGN_ORIGIN_AMBIGUITY`.
3. **3-squad scenario with `--callsign`:** Same setup, pass `--callsign <specific>` →
   ambiguous entries excluded at `assign.ts:532` → assignment succeeds.
4. **Guard 7:** Two successive assigns of the same product clone path to two different
   squad entries → second assign fails (Guard 7 violation).

If any guard behavior does not match expectations, file a corrective code fix within
this sub-proposal before marking it done.

---

## Acceptance gate

- `npm run build` exits 0.
- All new tests pass (`npm test`).
- Sub-proposal A: two registry entries (distinct callsigns, same remote) publish to
  `squad/inbox/<callsign-A>/...` and `squad/inbox/<callsign-B>/...` respectively; no
  collision.
- Sub-proposal B: `squad init --callsign <name>` writes `stateBranch: "squad/state/<name>"`
  to the registry; `squad sync --pull` fetches from that branch.
- Sub-proposal C: `install-fold-pipeline --callsign <name>` produces scoped YAML for
  both ADO and GitHub platforms; absence of `--callsign` produces the unchanged global
  output.
- Sub-proposal D: all four guard-behavior tests pass.
- Two-squad integration scenario: two registry entries, one remote, both publish and pull
  independently without observing each other's data.
- Sub-proposal E: no back-compat migration code unless decision is recorded; triage
  document notes the deferral.
- Scrub gate: changes contribute no new hits.
- Changeset: `patch` for `@bradygaster/squad-cli` is present.
- Commit: single squashed commit with `Co-authored-by: Copilot ...` trailer.
- Branch pushed to `origin`; no PR opened.
