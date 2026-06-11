# 40 — Callsign-namespaced transport

## Summary

Enable multiple distinct squads to share a single remote (the per-clone topology: N
separate host clones, shared `origin`) by namespacing transport branches with the squad
callsign. Today the inbox prefix `squad/inbox/<handle>/...` has no callsign component
and the fold pipeline trigger and target are hardcoded to catch and write all squads
into one branch. This piece adds the callsign slot to the inbox branch name, adopts
`squad/state/<callsign>` as the fold target, and parameterizes `install-fold-pipeline`
so one scoped pipeline can be installed per squad.

Stack position: Part 40 of the cross-repo arc. Branches off piece 39
(`squad/piece-39-dogfood-fixes-and-fold-pipeline-repair`). Depends on pieces 26–39 all
being present on the branch.

Changeset requirement: `packages/squad-cli/src/` is touched — include a `patch`
changeset entry for `@bradygaster/squad-cli`. Fold-pipeline templates are also touched;
include them in the same changeset.

---

## Problem

The per-clone topology (verified as of piece 38): separate host clones at distinct
absolute filesystem paths make the on-disk isolation blockers non-issues — the hardcoded
`.squad` directory name (`resolution.ts:120`) and the registry duplicate-path guard
(`registry.ts:233`, keys on absolute path) both pass when each clone has a unique path.
The CLI sync layer already supports per-squad `stateBranch`, `stateRemote`, `inboxHandle`,
and `callsign`; `squad sync --pull` honors per-entry `stateBranch` at `sync.ts:749–750`.

The only remaining blockers are two shared-remote namespace collisions:

**Inbox prefix lacks a callsign component.** `sync.ts:326` builds the inbox branch as
`squad/inbox/${inboxHandle}/${ts}-${seq}-${sessionId}`. A developer working on two squads
with the same handle produces inbox branches under the same `squad/inbox/<handle>/` prefix
on the shared remote. The branches are indistinguishable without reading
`publish-metadata.json`.

**Fold pipeline folds all squads into one branch.** Both templates trigger on
`squad/inbox/**` (GitHub `fold-squad-state.yml:11`; ADO `fold-squad-state.yml:13`) and
hardcode the fold target as `squad-state` (GitHub `:219`, ADO `:205`). A deployed fold
pipeline for Squad A will also ingest Squad B's inbox branches and write their content
into the same `squad-state` branch — cross-contaminating state. Per-entry `stateBranch`
is correctly honored on the hydrate (pull) side but completely ignored by the fold (write)
side.

---

## Proposed change

Sub-proposals A–D are Tier 1 (concrete, implementation-ready). Sub-proposal E is Tier 2
(decision-required: back-compat migration path).

**Recommended implementation order:** A (inbox prefix), B (state branch naming), C (fold
pipeline parameterization), D (UX / origin-ambiguity confirmation), then E (back-compat,
gated on decision).

---

## Tier 1

### A. Callsign-namespaced inbox branches

**Current behavior:** `sync.ts:326` constructs:
```
squad/inbox/${inboxHandle}/${ts}-${seq}-${sessionId}
```
The registry entry's `callsign` is available at `sync.ts:645` (where `registryAlias =
entry.inboxHandle` is captured) but is not captured into a variable and not included in
the inbox branch name.

**Required behavior:** Change the inbox branch prefix to:
```
squad/inbox/<callsign>/<handle>/<ts>-<seq>-<sessionId>
```
Capture `entry.callsign` near `sync.ts:645` (add `registryCallsign = entry.callsign`
alongside the existing `registryAlias = entry.inboxHandle`), and thread it through to
`publishTeamRootToInbox`. Include the callsign in `publish-metadata.json` so the fold
pipeline and any consumers can read it. Validate callsign against the same character
constraints as `INBOX_HANDLE_RE` (or an equivalent `CALLSIGN_RE` constant), since it
appears in a branch name.

**Hard constraints:**
- `INBOX_HANDLE_RE` validation for the handle component is unchanged.
- Callsign validation is performed before constructing the branch name; an unset or
  invalid callsign is a fatal error at this point (not a fallback).
- `publish-metadata.json` must include a `callsign` field in the written metadata.
- Single-repo mode (no registry match) continues to use the existing two-component prefix
  `squad/inbox/<handle>/...` — no callsign is injected when no registry entry is matched.

**Test surface:** (a) Cross-repo push constructs inbox branch as
`squad/inbox/<callsign>/<handle>/...`. (b) `publish-metadata.json` contains the
`callsign` field. (c) Unset callsign at publish time produces a fatal error with a clear
message. (d) Single-repo mode branch name is unchanged.

---

### B. Callsign-namespaced state branch

**Current behavior:** The fold pipeline templates hardcode `squad-state` as the fold
target (GitHub `:102–104,219`; ADO `:99–101,205`). Per-entry `stateBranch` from the
registry is honored on the hydrate (pull) side at `sync.ts:749–750` but has no effect on
the fold (write) side.

**Required behavior:** Adopt `squad/state/<callsign>` as the default state branch naming
convention. The fold pipeline, the `publishTeamRootToInbox` metadata, and the
`hydrateTeamRootFromStateRef` call must all agree on the scheme:
- When `install-fold-pipeline` generates the pipeline YAML for a named callsign (via the
  `--callsign` flag added in sub-proposal C), it writes `squad/state/<callsign>` as the
  fold target in the template.
- When `squad init --callsign <name>` (or `squad assign`) sets up a new entry, the
  default `stateBranch` written to the registry entry should be `squad/state/<callsign>`
  rather than the bare `squad-state`.
- The `hydrateTeamRootFromStateRef` call at `sync.ts:749–750` already reads
  `stateBranch ?? 'squad-state'`; once the registry entry carries
  `squad/state/<callsign>`, the pull side automatically uses the namespaced branch without
  further change.

**Hard constraints:**
- The change to the default `stateBranch` naming applies to newly created registry entries.
  Existing entries that explicitly set `stateBranch: "squad-state"` continue to work
  (their value is used as-is by the hydrate logic).
- The bare `squad-state` fallback in `sync.ts:749–750` remains as the last resort for
  entries with no `stateBranch` set, preserving compatibility with existing un-migrated
  entries.

**Test surface:** (a) `squad init --callsign <name>` writes `stateBranch:
"squad/state/<name>"` into the registry entry. (b) `squad sync --pull` for that entry
fetches from `squad/state/<name>`. (c) Existing entry with `stateBranch: "squad-state"`
continues to pull from `squad-state`.

---

### C. `install-fold-pipeline --callsign` parameterization

**Current behavior:** `install-fold-pipeline` (`install-fold-pipeline.ts`) generates
pipeline YAML with a hardcoded trigger glob (`squad/inbox/**` for GitHub;
`refs/heads/squad/inbox/*` for ADO) and a hardcoded fold target (`squad-state`). One
deployed pipeline catches all squads.

**Required behavior:** Add a `--callsign <name>` flag to `install-fold-pipeline`. When
provided:
- The trigger glob becomes `squad/inbox/<callsign>/**` (GitHub) or
  `refs/heads/squad/inbox/<callsign>/*` (ADO).
- The fold target becomes `squad/state/<callsign>` (matching sub-proposal B).

With `--callsign`, each squad gets its own dedicated pipeline scoped to its inbox
namespace. Two squads sharing a remote install two pipeline files (or two pipeline
definitions in ADO), each consuming only its own squad's inbox pushes.

When `--callsign` is not provided, the behavior is backward-compatible: existing
hardcoded globals (`squad/inbox/**`, `squad-state`) are used, matching the current output
unchanged.

**Hard constraints:**
- `--callsign` is optional; absence preserves the current output verbatim.
- When `--callsign` is provided, it must be validated against the callsign character
  constraints before being written into the YAML.
- Both ADO and GitHub templates are parameterized.
- The generated pipeline file name may optionally include the callsign for disambiguation
  (e.g., `fold-squad-state-<callsign>.yml`) — this is a DECISION item (see sub-proposal E
  for naming conventions) but the trigger/target parameterization is Tier 1.

**Test surface:** (a) `install-fold-pipeline --platform github --callsign teamA` produces
a GitHub template with trigger `squad/inbox/teamA/**` and target `squad/state/teamA`. (b)
`install-fold-pipeline --platform ado --callsign teamA` produces an ADO template with
trigger `refs/heads/squad/inbox/teamA/*` and target `squad/state/teamA`. (c)
`install-fold-pipeline --platform github` (no callsign) produces the existing global
trigger and target unchanged.

---

### D. Origin-ambiguity binding UX confirmation (UX)

**Current behavior:** `assign.ts:530–544` (Guard 8) filters `existingSquads` for entries
whose `origins[]` overlap with the product clone's remote URLs, excluding the target
callsign (line 531). With two squads registered against the same remote:
- 2 squads → `originMatchingEntries.length === 1` → warning only, not error → assignment
  succeeds.
- 3+ squads → `ERR_ASSIGN_ORIGIN_AMBIGUITY` → resolved by passing `--callsign <name>`
  which activates the exclusion at line 532.

Guard 7 (`assign.ts:512–523`) prevents one product clone path from appearing in more than
one squad's `clones[]`, ensuring one product clone binds to exactly one squad.

**Required behavior:** This sub-proposal is a verification and documentation item, not a
code change. Confirm via test that:
1. Assigning a product clone to Squad B when Squad A already uses the same remote (2-squad
   scenario) produces a warning and succeeds.
2. A 3-squad scenario is resolved by `squad assign <callsign> --callsign <callsign>`.
3. Guard 7 holds: one product clone path cannot appear in two squads simultaneously.

If any of the three behaviors is incorrect as of piece 39, file a corrective code fix
under this sub-proposal. If all three are correct, this sub-proposal is satisfied by
tests only.

**Hard constraints:**
- No behavior changes unless a guard is found to be incorrect.
- Guard 7 must remain in force for all scenarios.

**Test surface:** (a) 2-squad origin-sharing assign: warning emitted, exit 0. (b) 3-squad
origin-sharing assign without `--callsign`: `ERR_ASSIGN_ORIGIN_AMBIGUITY`. (c) Same with
`--callsign`: succeeds. (d) Guard 7: second assign of the same product clone path to a
different squad fails.

---

## Tier 2 — Design decision (DECISION REQUIRED before implementation)

### E. Back-compat and migration for existing single-squad deployments (DECISION REQUIRED)

**Context:** Existing deployments use the flat namespace: inbox branches at
`squad/inbox/<handle>/...` and state branch at `squad-state`. After this piece, newly
created squads use `squad/inbox/<callsign>/<handle>/...` and `squad/state/<callsign>`.
The two naming schemes coexist on the same remote during any migration window. The fold
pipeline (from piece 39, sub-proposal A: embed YAML in inbox snapshot) also changes the
pipeline YAML embedded in future snapshots — old-style inbox branches may carry no YAML
or the old-style YAML.

**Option E1 (callsign-default: assign a default callsign to existing entries):** At init
time (or via a migration command), existing entries with no callsign are assigned a
default callsign (e.g., derived from the first `--callsign` seen, or a sentinel like
`default`). The fold pipeline installed with `--callsign default` picks up their branches.
*Downside:* Requires a one-time migration step; sentinel callsigns pollute the namespace.

**Option E2 (dual-mode fold pipeline):** The fold pipeline retains the global
`squad/inbox/**` trigger as a fallback when `--callsign` is not specified. Operators
who want per-squad pipelines install an additional scoped pipeline without removing the
global one.
*Downside:* A global pipeline and per-squad pipelines coexist indefinitely, potentially
double-folding the same refs (fold is idempotent so correctness holds, but wasted runs
occur).

**Option E3 (documented cutover):** Publish a migration note: existing single-squad
deployments continue to use the old names; new squads adopt the namespaced scheme. No
automatic migration code. The `squad doctor` command warns when an entry lacks a
`stateBranch` that matches the namespaced scheme.
*Downside:* Two naming conventions coexist permanently in multi-squad environments.

**Recommendation:** E3 for the initial release of this piece. The simplest path for
existing users is a documented cutover with a `squad doctor` warning, not silent
migration. Operators who need the namespaced scheme re-run `install-fold-pipeline
--callsign <name>` and update their registry entry's `stateBranch`. E1 or E2 can be
revisited if community feedback shows the manual cutover is prohibitive.

**Implementation gate:** Record decision in `.squad/decisions/inbox/` before implementing
the migration mechanism. The Tier-1 items (A–D) do not depend on this decision and should
be implemented first.

---

## Acceptance

- Build exits 0.
- Two squads sharing one remote (separate host clones) publish to distinct
  `squad/inbox/<callsign>/<handle>/...` namespaces and fold to distinct
  `squad/state/<callsign>` branches without collision.
- `squad sync --pull` for each squad fetches only its own state.
- Tests cover: namespaced inbox branch construction (A), namespaced state branch in
  registry and hydrate (B), scoped pipeline YAML generation for both platforms (C),
  origin-ambiguity guard behaviors for 2-squad and 3-squad scenarios (D).
- A two-squad integration test scenario: two registry entries with different callsigns,
  one remote, two host clones; each publishes and pulls independently without observing
  the other's data.
- Sub-proposal E is implemented only after its recorded decision is present in
  `.squad/decisions/inbox/`; deferred without implementation if unresolved.
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
