# 51 — Publish-allowlist completion and team-root state hygiene

## Summary

The cross-repo transport carries a **narrow, explicit subset** of the team root to the state branch —
the `PUBLISH_ALLOWLIST` (exact paths plus prefixes) filtered inside `publishTeamRootToInbox` before
any git object is created. Everything not on that allowlist is silently excluded from the fold. That
is the right shape, but a dogfooding audit of a live team root found **three** categories, not two:
allowlisted (folds), reviewable/durable (a separate concern — see piece 52), and a **drift** category
of mutable, append-only files that are neither reviewable nor allowlisted, so they mutate on every
developer's machine but never transport and never converge. This piece completes the ephemeral/state
classification so every mutable team-root path has a defined home — folded to the state branch, or
gitignored as machine-local scratch — and closes the leak whereby a host set up via
`install-fold-pipeline` (rather than `init`) carries no `.gitignore` at all, letting a careless `git
add -A` sweep folded state onto the product branch.

This piece is **topology-agnostic**: it stands on its own under the current model and is a prerequisite
for the Pole-A re-architecture in pieces 52–53. It surfaced four gaps.

1. **Append-only state files drift because they are neither reviewable nor allowlisted.** The audit
   found twelve mutable paths outside the allowlist — agent and orchestration histories, casting
   history/registry, and generated onboarding artifacts — that every session rewrites locally but the
   fold never carries. Two developers' team roots diverge on these permanently with no convergence
   path.

2. **Machine-local scratch files are neither ignored nor classified.** A few generated files
   (`raw-agent-output.md`, `run-output.md`, `publish-metadata.json`) are pure per-run scratch: they
   must never transport and never be committed, yet nothing declares them local, so they surface as
   untracked noise and risk being swept into a fold or a product commit.

3. **`publish-history.json` has undefined ownership.** It is written by the fold pipeline on the state
   branch, but the team-root copy is also mutated locally, and it is unclear whether the publish path
   should carry it (it must not — the pipeline is its sole writer).

4. **A host set up via `install-fold-pipeline` has no `.gitignore`, so folded state can land on the
   product branch.** `init` installs an allowlist-aware `.gitignore` (`applyAllowlistGitignore`) under
   the orphan backend, but a host onboarded only through `install-fold-pipeline` never runs that step.
   A dogfood host's default branch tracked exactly one file (the fold workflow) and had **no**
   `.gitignore`; the hydrated team root showed as untracked, so only operator discipline kept folded
   state off the branch — a `git add -A` would sweep it into the next product PR.

This piece delivers three Tier-1 fixes — (A) extend the publish allowlist to fold the unambiguous
append-only state prefixes/paths, (C) declare machine-local scratch in the managed `.gitignore` and
confirm `publish-history.json` is pipeline-owned, (D) have `install-fold-pipeline` install the same
allowlist-aware `.gitignore` `init` does — and resolves two Tier-2 decisions: (B) how to fold
per-agent histories without also folding per-agent charters, and (E) the fold semantics of
last-writer-wins registries.

Stack position: Part 51 of the cross-repo arc. Branches off piece 50
(`squad/piece-50-subfolder-host-and-self-hosted-runner-hardening`). It depends on the
`PUBLISH_ALLOWLIST` and `publishTeamRootToInbox` filter from the publish/fold pieces (32/41), the
`hydrateTeamRootFromStateRef` merge from piece 43+, and `init`'s `applyAllowlistGitignore` under the
orphan backend.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, the publish/fold and hydrate specs, and the
`_planning/dogfood-backlog.md` roadmap. This piece also lays the classification groundwork the Pole-A
pieces (52 durable lane, 53 durable review transport) build on — read them together.

Changeset requirement: `packages/squad-cli/src/` is touched (the allowlist constants, the
`.gitignore` writer, the `install-fold-pipeline` wiring) — include a `patch` changeset for
`@bradygaster/squad-cli`. If the allowlist is mirrored in `@bradygaster/squad-sdk`, add a `patch`
changeset there too.

---

## Problem

### Authority: the shipped classification (do not reinvent)

`sync.ts` already defines the durable-vs-ephemeral line as `PUBLISH_ALLOWLIST_EXACT` +
`PUBLISH_ALLOWLIST_PREFIX`, and `publishTeamRootToInbox` filters the team root through
`isAllowlisted(path)` **before** creating git objects — a non-allowlisted file is silently excluded
from the snapshot. The shipped allowlist is:

- EXACT: `.squad/decisions.md`, `.squad/.last-publish`
- PREFIX: `.squad/decisions/inbox/`, `.squad/log/`, `.squad/orchestration-log/`, `.squad/sessions/`,
  `.squad/identity/`

This is the ephemeral/state lane. The `tiered-memory` skill independently names the durable set the
"Wiki tier" (charters, routing, ADRs). This piece extends the **ephemeral** lane to cover the drift;
it does not touch the durable set (piece 52). Do not invent a parallel classification — extend these
constants.

### 1. Append-only state files drift (twelve paths outside the allowlist)

A live-team-root audit found these mutable, append-only paths that no allowlist prefix matches, so the
fold never carries them and two clones diverge permanently:

- `.squad/history.md`, `.squad/orchestration-log.md` (top-level append-only logs; note the allowlist
  has the `orchestration-log/` *directory* prefix but not the `.md` file)
- `.squad/agents/<name>/history.md` (per-agent append-only history — but `.squad/agents/<name>/`
  **also** holds the durable `charter.md`, so the prefix cannot be blanket-added; see B)
- `.squad/casting-history.json`, `.squad/casting/history.json`, `.squad/casting-registry.json`,
  `.squad/casting/registry.json` (runtime casting state, last-writer-wins; see E)
- `.squad/files/onboarding/**` (generated onboarding artifacts)

The unambiguous ones — the top-level `.md` logs, the casting logs, and `files/onboarding/` — can be
added to the allowlist directly. The per-agent histories collide with per-agent charters and need a
decision (B). The last-writer-wins registries need fold semantics (E).

### 2. Machine-local scratch is unclassified

`.squad/raw-agent-output.md`, `.squad/run-output.md`, and `.squad/publish-metadata.json` are
per-invocation scratch. They must never transport (they carry no cross-developer meaning) and must
never be committed to any branch, but nothing declares them local, so they appear as untracked noise
and are exposed to `git add -A`.

### 3. `publish-history.json` ownership is undefined

`.squad/publish-history.json` records folded refs and is written by the fold pipeline on the state
branch. The team-root copy is also mutated locally by publish. It must be **excluded** from the
publish snapshot (the pipeline is the sole writer on the state branch; folding a locally-mutated copy
would cause write-write races), and it must be gitignored in the team root.

### 4. `install-fold-pipeline` leaves the host with no `.gitignore`

`init` under the orphan backend runs `applyAllowlistGitignore`, which `git rm --cached` + ignores the
allowlisted ephemeral paths so folded state is structurally invisible to the branch. A host onboarded
only via `install-fold-pipeline` never runs `init`, so it has no `.gitignore`: the dogfood host's
default branch tracked one file (the fold workflow), had no `.gitignore`, and the hydrated team root
sat untracked. Nothing structural kept folded state off the product branch — only discipline.

---

## Proposed change

### Sub-proposal A (Tier 1) — extend the publish allowlist for unambiguous append-only state

Add to `PUBLISH_ALLOWLIST`:

- EXACT: `.squad/history.md`, `.squad/orchestration-log.md`, `.squad/casting-history.json`,
  `.squad/casting-registry.json`
- PREFIX: `.squad/casting/`, `.squad/files/onboarding/`

These are unambiguously append-only or last-writer state with no durable/reviewable content. Mirror
the change into the `squad-sdk` copy if the allowlist is duplicated. The per-agent histories are
deferred to B; the last-writer-wins semantics of the casting registries are addressed by E.

### Sub-proposal B (Tier 2, decision) — per-agent histories without folding per-agent charters

`.squad/agents/<name>/` holds both `history.md` (ephemeral, should fold) and `charter.md` (durable,
must **not** fold into the state lane — it is piece-52 reviewable content). A blanket
`.squad/agents/` prefix would sweep charters into state. Decide:

- **B1 (recommended):** add a **suffix/glob** matcher to the allowlist (`isAllowlisted` also matches
  `.squad/agents/*/history.md`), leaving charters excluded. Smallest change; keeps agent files
  colocated.
- **B2:** relocate per-agent histories under a folded prefix (e.g. `.squad/history/agents/<name>.md`)
  and add that prefix to the allowlist, leaving `.squad/agents/<name>/` for durable charter content
  only. Cleaner separation but a layout migration.

Record the decision and rationale in the triage file.

### Sub-proposal C (Tier 1) — declare machine-local scratch; confirm `publish-history.json` ownership

- Add `.squad/raw-agent-output.md`, `.squad/run-output.md`, `.squad/publish-metadata.json`, and
  `.squad/publish-history.json` to the managed `.gitignore` block (below) as machine-local /
  pipeline-owned. None are on the publish allowlist, so they already never transport — this makes the
  exclusion explicit and keeps them out of any product commit.
- Confirm and assert with a test that `publishTeamRootToInbox` excludes `publish-history.json` (the
  fold pipeline is its sole writer on the state branch).

### Sub-proposal D (Tier 1) — `install-fold-pipeline` installs the allowlist `.gitignore`

Factor `init`'s `applyAllowlistGitignore` into a shared helper and invoke it from
`install-fold-pipeline` when the resolved host uses the orphan backend, so a host onboarded via
`install-fold-pipeline` (never `init`) gets the same structural isolation: the allowlisted ephemeral
paths (and the C machine-local scratch) are `git rm --cached` + ignored, so folded/hydrated state
cannot be swept onto the product branch by `git add -A`. The helper is idempotent (safe to re-run on a
host `init` already configured). Under a subfolder host, scope the ignore block to the callsign's
`<callsign>/.squad/**` team root. **Never** write a blanket `.squad/` ignore here — that is the
Pole-A change (piece 52), gated on the durable lane existing.

### Sub-proposal E (Tier 2, decision) — casting-registry fold semantics

`.squad/casting-registry.json` / `casting/registry.json` are last-writer-wins runtime state. Decide:

- **E1 (recommended):** fold them (last-writer-wins on the state branch, consistent with logs) — the
  registry is cheap to reconstruct and last-writer convergence is acceptable.
- **E2:** treat them as machine-local (gitignore, never fold) if casting must stay per-machine.

Record the decision; A already assumes E1 (registries in the allowlist) — if E2 is chosen, remove
`casting-registry.json` from A's EXACT list and gitignore it instead.

### The managed `.gitignore` block (reference)

```
# --- squad (managed) ---
# Ephemeral state is transported to the state branch by the fold pipeline, not committed here.
<callsign>/.squad/decisions.md
<callsign>/.squad/decisions/inbox/
<callsign>/.squad/log/
<callsign>/.squad/orchestration-log/
<callsign>/.squad/orchestration-log.md
<callsign>/.squad/history.md
<callsign>/.squad/sessions/
<callsign>/.squad/identity/
<callsign>/.squad/casting/
<callsign>/.squad/casting-history.json
<callsign>/.squad/casting-registry.json
<callsign>/.squad/files/onboarding/
# Machine-local scratch / pipeline-owned — never transported, never committed.
<callsign>/.squad/raw-agent-output.md
<callsign>/.squad/run-output.md
<callsign>/.squad/publish-metadata.json
<callsign>/.squad/publish-history.json
<callsign>/.squad/.last-publish
<callsign>/.squad/.last-hydrate-sha
<callsign>/.squad/.first-run
# --- end squad (managed) ---
```

(Root-hosted squads omit the `<callsign>/` prefix. The exact set follows the A/B/E decisions.)

---

## Acceptance

- After A, a publish snapshot from a team root carries `history.md`, `orchestration-log.md`, the
  casting logs/registries (per E), and `files/onboarding/**`, and a subsequent hydrate lands them on
  another clone; two clones converge on these paths (no permanent drift).
- Per-agent `history.md` folds (per B) while per-agent `charter.md` does **not** appear in the publish
  snapshot.
- `publish-history.json`, `raw-agent-output.md`, `run-output.md`, and `publish-metadata.json` are
  absent from every publish snapshot and are gitignored in the team root (C).
- A host onboarded via `install-fold-pipeline` (no `init`) has the managed `.gitignore` block; `git
  add -A` at the host root stages **no** folded/hydrated `.squad/` state (D).
- No blanket `.squad/` ignore is introduced (that is deferred to piece 52).
- Scrub gate contributes no new hits versus the piece-50 base; `@bradygaster/squad-cli` (+
  `@bradygaster/squad-sdk` if the allowlist is mirrored) changesets present.
