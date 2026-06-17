# 43 — Cross-repo pull: state remote and branch resolution

## Summary

When the squad **state host** repository is different from the **code clone**'s origin —
the common cross-repo split where code lives in one repository and squad state is published
to another — `squad sync --pull` must resolve both the state *remote* and the
`squad/state/<callsign>` *branch* from the registry / team-root host, not from the code
clone's origin. Today the pull path has three gaps. It runs the in-clone state fetch against
the code clone's own origin (which does not host the state branch), emitting a misleading
"no remote squad-state refs" notice. It defaults an unset state remote to a literal `origin`
rather than the team-root host's remote. And when a registry entry predates
callsign-namespaced state and carries no explicit `stateBranch`, it falls back to the flat
legacy branch `squad-state` instead of deriving the namespaced `squad/state/<callsign>`
target the fold pipeline actually writes.

This piece makes cross-repo `sync --pull` authoritative-by-hydration: (A) resolve the state
remote from the registry/team-root host rather than the code clone's origin; (B) when a
registry entry has no explicit `stateBranch`, derive `squad/state/<callsign>` from the
entry's callsign (matching the pipeline's namespaced target) using the existing callsign
validator; and (C) stop running the in-clone fetch path against the code clone during a
cross-repo pull, so the only hydration source is the state ref. A residual decision (D)
covers the fallback when an entry has neither an explicit `stateBranch` nor a callsign to
derive from.

Stack position: Part 43 of the cross-repo arc. Branches off piece 42
(`squad/piece-42-fold-subtree-overlay-and-serialization`). Depends on the
callsign-namespaced transport surface (inbox prefix `squad/inbox/<callsign>/<handle>/...`,
state branch `squad/state/<callsign>`, and the `CALLSIGN_RE` validator) introduced in piece
40, on the registry `stateRemote` / `stateBranch` / `callsign` fields, and on the
registry-first TEAM_ROOT resolution in `runSync`.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs `40-callsign-namespaced-transport.md`,
`41-fold-pipeline-repo-root-and-generic-discovery.md`, `42-fold-subtree-overlay-and-serialization.md`,
and the piece-43 entry in `_planning/dogfood-backlog.md`.

Changeset requirement: `packages/squad-cli/src/` is touched — include a `patch` changeset
entry for `@bradygaster/squad-cli`. If the namespaced-branch derivation is factored into a
shared helper in the SDK, add a `patch` entry for `@bradygaster/squad-sdk` as well.

---

## Problem

Piece 40 namespaced the transport (inbox `squad/inbox/<callsign>/<handle>/...`, state
`squad/state/<callsign>`); pieces 32–34 added the registry `stateRemote` / `stateBranch`
fields and the registry-first TEAM_ROOT resolution in `runSync`; and the assign/init paths
now persist `stateBranch = squad/state/<callsign>` for newly created entries. The pull side
of `runSync` has not kept pace for the cross-repo split, where TEAM_ROOT resolves to a host
clone whose origin is the state repository while the code clone the command runs in has a
different origin.

**1. The in-clone fetch runs against the code clone during a cross-repo pull.**
The pull path runs the single-repo fetch unconditionally before hydration:

```ts
if (isPull) {
  syncPull(repoRoot, remote, backend, quiet);   // remote = resolveRemote(repoRoot)
  if (crossRepo) {
    await hydrateTeamRootFromStateRef(teamRoot, stateRemote ?? DEFAULT_STATE_REMOTE, stateBranch ?? 'squad-state');
  }
}
```

`syncPull` fetches `refs/heads/squad-state...` from `remote`, where `remote` is
`resolveRemote(repoRoot)` — the **code clone's** origin. In the cross-repo split the code
clone's origin does not host the state branch, so the fetch finds nothing and `syncPull`
prints `No remote squad-state refs found (first push will create them)`. The message is
misleading (it is not the first push; the state lives on a different host), and the fetch is
wasted work. In cross-repo mode the authoritative hydration is `hydrateTeamRootFromStateRef`
against the state ref on the host; the in-clone fetch should not run at all.

**2. An unset state remote defaults to a literal `origin` rather than the host's remote.**
`DEFAULT_STATE_REMOTE` is the literal string `'origin'`, and the pull resolves the effective
state remote as `stateRemote ?? DEFAULT_STATE_REMOTE`. The intent is that the state remote
is the team-root host's remote; deriving it from a hardcoded literal (or, worse, from the
code clone's resolved `remote`) rather than from the registry/team-root host means an entry
that omits `stateRemote` can hydrate from the wrong origin. The effective state remote must
be resolved from the registry entry (`stateRemote`) and, when absent, from the team-root
host clone — never from the code clone's origin.

**3. A legacy entry without `stateBranch` falls back to the flat `squad-state` branch.**
The pull resolves the effective state branch as `stateBranch ?? 'squad-state'`. The fold
pipeline (pieces 40–42) writes each callsign's state to `squad/state/<callsign>`, and
assign/init persist that value into new registry entries. But an entry created before
callsign-namespaced state has no `stateBranch`, so the pull falls back to the flat legacy
`squad-state` — a branch the pipeline no longer writes — and hydrates nothing (or stale
state). When the entry carries a callsign, the pull must derive `squad/state/<callsign>` to
match the pipeline's namespaced target instead of the flat legacy default.

---

## Proposed change

Sub-proposals A, B, and C are Tier 1 (concrete, implementation-ready). Sub-proposal D is
Tier 2 (a decision with a backward-compatibility cost) and is gated on the maintainer's
choice.

**Recommended implementation order:** C (skip the in-clone fetch) and A (host remote
resolution) together, then B (branch derivation), then resolve D.

---

## Tier 1

### A. Resolve the state remote from the registry / team-root host

**Current behavior:** the effective state remote is `stateRemote ?? DEFAULT_STATE_REMOTE`,
where `DEFAULT_STATE_REMOTE` is the literal `'origin'`; the code clone's `remote`
(`resolveRemote(repoRoot)`) is also threaded through the pull.

**Required behavior:** in cross-repo mode the effective state remote is resolved, in order,
from (1) the registry entry's `stateRemote`; (2) when absent, the team-root host clone's
remote (resolved against `teamRoot`, the host whose origin is the state repository). The
code clone's origin is never used as the state remote. The remote that
`hydrateTeamRootFromStateRef` fetches with is this resolved host remote.

**Hard constraints:**
- An entry with an explicit `stateRemote` hydrates from exactly that remote.
- An entry without `stateRemote` resolves the remote from the team-root host, not from the
  code clone's origin and not from a context-free literal that could point at the wrong
  origin.
- Single-repo (non-cross-repo) pulls are unchanged.

**Test surface:** (a) cross-repo pull with an explicit `entry.stateRemote` fetches/hydrates
from that remote. (b) cross-repo pull with no `entry.stateRemote` resolves the remote from
the team-root host, not from the code clone's origin. (c) the code clone's origin is not the
remote passed to the hydration call in cross-repo mode.

### B. Derive `squad/state/<callsign>` when `stateBranch` is unset

**Current behavior:** the effective state branch is `stateBranch ?? 'squad-state'` — the
flat legacy branch.

**Required behavior:** when the registry entry has no explicit `stateBranch` but carries a
callsign, the pull derives the namespaced branch `squad/state/<callsign>` (matching the
pipeline's fold target and what assign/init persist for new entries) instead of the flat
legacy `squad-state`. The callsign is validated with the existing `CALLSIGN_RE`
(`packages/squad-sdk/src/validation.ts`) before it is interpolated into the branch name;
reuse that validator — do not introduce a second callsign pattern. The derivation must
produce the identical `squad/state/<callsign>` string the assign/init paths and the fold
pipeline use (a single source of truth for the namespaced branch name is preferred — either
the existing `CALLSIGN_RE`-guarded interpolation or a shared helper that all three call
sites can adopt).

**Hard constraints:**
- An entry with an explicit `stateBranch` uses that value verbatim (no derivation,
  no override).
- An entry without `stateBranch` but with a valid callsign hydrates from
  `squad/state/<callsign>`.
- The derived branch name is byte-identical to the value assign/init persist and the value
  the fold pipeline writes for the same callsign.
- A callsign that fails `CALLSIGN_RE` is never interpolated into a branch name.

**Test surface:** (a) entry with `stateBranch` set → that exact branch is hydrated
(derivation does not fire). (b) entry without `stateBranch` but with callsign `foo` →
`squad/state/foo` is hydrated. (c) the derived name equals the assign/init-persisted value
for the same callsign. (d) an invalid callsign does not yield a branch name (covered by the
D decision for the no-derivation fallback).

### C. Cross-repo pull does not run the in-clone fetch against the code clone

**Current behavior:** `syncPull(repoRoot, remote, ...)` runs unconditionally in the pull
path, including in cross-repo mode, fetching state refs from the code clone's origin and
printing `No remote squad-state refs found` when that origin does not host them.

**Required behavior:** in cross-repo mode the pull does not run the in-clone fetch against
the code clone; the sole hydration source is `hydrateTeamRootFromStateRef` against the
resolved host remote and state branch. The misleading "no remote squad-state refs" notice no
longer appears for a cross-repo pull. The single-repo pull path (no TEAM_ROOT / no registry
entry) still runs `syncPull` exactly as today.

**Hard constraints:**
- A cross-repo pull invokes only the host-side hydration; it does not fetch `squad-state`
  refs from the code clone's origin and emits no "first push will create them" notice.
- A single-repo pull is unchanged (still runs `syncPull`).
- The recursion guard, dry-run preview, and push path are unaffected.

**Test surface:** (a) a cross-repo pull does not call the in-clone fetch path against the
code clone and prints no "no remote squad-state refs" notice. (b) a single-repo pull still
runs the in-clone fetch. (c) a cross-repo pull's hydration is invoked with the resolved host
remote and state branch from A and B.

---

## Tier 2 (decision)

### D. Fallback when an entry has neither `stateBranch` nor a callsign

**Decision required:** what a cross-repo pull does when a registry entry has no explicit
`stateBranch` and no callsign to derive one from (a legacy entry that predates both the
`stateBranch` field and callsign-namespaced state).

**Option D1 — Retain the flat `squad-state` legacy default (recommended).** When neither an
explicit `stateBranch` nor a derivable callsign is available, keep hydrating from the flat
legacy `squad-state` branch, preserving today's behavior for pre-callsign entries. Derivation
(B) only fires when a valid callsign is present; otherwise the legacy default stands. Cost:
the silent legacy path remains for un-migrated entries; the operator sees no prompt to add a
callsign or `stateBranch`.

**Option D2 — Fail fast with guidance.** When neither value is available, abort the pull with
a teaching error instructing the operator to set a callsign (via `squad assign --callsign`)
or an explicit `stateBranch`. Cost: a louder failure that could break an existing legacy
single-repo-style cross-repo setup that still relies on the flat `squad-state` branch.

**Hard constraints (whichever is chosen):**
- The choice does not change behavior for entries that have an explicit `stateBranch` (A/B
  precedence is unchanged).
- The choice does not change the single-repo pull path.
- The decision and its rationale are recorded in the Phase-B triage file so it is auditable.

**Test surface:** for D1, an entry with neither `stateBranch` nor callsign hydrates from the
flat `squad-state` branch (no derivation, no error). For D2, the same entry aborts with the
teaching error and no hydration is attempted.

---

## Acceptance

- Build exits 0.
- `sync --pull` resolves the state remote from the registry/team-root host origin, not from
  the code clone's origin (A).
- When a registry entry has no explicit `stateBranch`, `sync --pull` derives
  `squad/state/<callsign>` (matching the pipeline's namespaced target) instead of a flat
  legacy branch, using the existing `CALLSIGN_RE` validator (B).
- A cross-repo `sync --pull` no longer runs the in-clone fetch path against the code clone
  (no misleading "no remote squad-state refs" warning); the authoritative hydration is from
  the state ref on the host (C).
- An entry with an explicit `stateRemote` / `stateBranch` uses those values verbatim;
  derivation and host-remote resolution only fill in the gaps.
- Single-repo (non-cross-repo) pulls are unchanged.
- Sub-proposal D is resolved one way or the other: either the flat `squad-state` legacy
  default is retained for entries with neither `stateBranch` nor callsign (D1), or the pull
  fails fast with a teaching error (D2); the choice and rationale are recorded in the
  Phase-B triage.
- Tests cover: host-remote resolution with and without an explicit `stateRemote` (A);
  branch derivation with and without an explicit `stateBranch` and the derived name matching
  the assign/init value (B); the cross-repo pull skipping the in-clone fetch while the
  single-repo pull retains it (C); and the D fallback.
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff (and a `patch`
  changeset for `@bradygaster/squad-sdk` if a shared derivation helper is added there).
- No specific internal tenant/host URL appears in any documentation; placeholders use
  `dev.azure.com/contoso/MyProject`.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
