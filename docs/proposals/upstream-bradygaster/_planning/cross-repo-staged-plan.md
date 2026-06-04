# Cross-Repo Arc — Staged Plan
**Authored by:** Flight  
**Date:** 2026-05-29  
**Pieces:** 26–30.5 (local numbering; handoff's stale "upstream-22–26" references are retired)

---

## Decisions Locked

| # | Lock | One-line summary |
|---|------|-----------------|
| Q1 | A | Piece 26 ships as a single session (no 26a/26b subdivision). |
| Q2 | C | `sourceWorkRoot` stored as `{ repo, pathHash }` — no absolute paths; §9 NFR annotation in spec. |
| Q3 | A | Louder restart banner in piece 29 commit message; version-check tooling deferred to follow-on. |
| Q4 | D | Behavioral YAML assertions for piece 30 templates; `yaml` added as devDep. |
| Q5 | C | Hybrid: per-piece behavioral tests + single post-30 gate-audit pass (piece 30.5). |

---

## A. Executive Framing

This five-piece arc delivers a production-grade cross-repo transport for Squad deployments in enterprise mono-repo environments. The core problem it solves: developers on a large mono-repo need live Squad team state without committing Squad files to the product repo, where they would pollute product PRs and create ownership ambiguity.

The arc's end-to-end story: a developer runs `squad bind` once (piece 26) to attach their mono-repo clone to a sidecar docs/specs repo. `squad sync` (piece 27) becomes the explicit, supported mechanism for pulling canonical team state from that docs repo and publishing local state changes to per-developer inbox branches. An ADO fold pipeline (piece 30) serializes concurrent inbox writes into a single canonical `squad-state` orphan branch. The coordinator protocol (piece 29) is updated so agents always know which root is the code root and which is the Squad state root — eliminating a category of accidental WORK_ROOT writes.

The decomposition in handoff §3 is sound. The only reorder worth calling out: piece 29 (coordinator protocol) depends logically on piece 26's path model being stable, not on piece 27 or 28 being shipped. The handoff's stated dependency "Piece 4 depends on Piece 1" is correct; the plan below honors it.

**Hard invariants, non-negotiable:**
- No Squad files in product PR diffs (enforced by `.git/info/exclude` + projection-only WORK_SQUAD_DIR)
- Single canonical writable state root: TEAM_ROOT / `squad-state` branch in the docs repo
- Least-privilege automation: fold pipeline identity is repo-scoped; never carries user credentials into artifacts
- Aliases, not emails, in all published metadata and provenance files

---

## B. Piece-by-Piece Staging Table

---

### Piece 26 — cross-repo-bind-config
**One-line summary:** Normalize TEAM_ROOT/WORK_ROOT in config, resolution, and add `squad bind` command.

**Branch off:** `squad/piece-25-resolver-rename-and-cli-hardening`  
**Local branch:** `squad/piece-26-cross-repo-bind-config`

**Spec file on `akubly/upstream-specs`:**  
`docs/proposals/upstream-bradygaster/26-cross-repo-bind-config.md`  
⚠️ **BLOCKER:** This file almost certainly does not exist yet. Spec authoring is required before replay can proceed. See Section D.

**Hard dependencies:** None (foundational piece). All other pieces in this arc depend on piece 26.

**Verify-first sub-elements:**
- Probe `SquadDirConfig` in `resolution.ts`: confirm `teamRoot`/`projectDir` exist but `workRoot`/`teamSquadDir` do not — if already present, drop the addition and record the verify result.
- Probe `cli-entry.ts` for `--team-root` flag handling: confirm current shape before specifying the expansion.
- Probe `link.ts` and `init-remote.ts` for any existing sidecar-clone logic that `runBind()` might duplicate.

**Special-scrutiny items:**
- `runBind()` writes `.git/info/exclude` and installs git hooks: **new write surface** on the developer's WORK_ROOT. Extra scrutiny on path safety (no overwrite of existing content, idempotent append, Windows path handling across drives).
- `stateRemote`, `stateBranch`, `inboxBranchPrefix`, `developerAlias`, `teamCachePath` are new config fields in `.squad/config.json`. These fields persist and will be read by pieces 27–30; the schema must be locked at this piece. **Schema breakage here cascades to the entire arc.**
- Deprecated aliases (`projectDir`/`teamDir`) introduce a transitional contract; flag what version the removal is planned for.

**Scrub-gate risk:** Gate 5 (changeset gate) — this piece touches `packages/squad-sdk/src/resolution.ts` and `packages/squad-cli/src/`. A changeset is required. Risk: the developer forgets to run `npx changeset add` before commit.

**Changeset:** ✅ Yes — both `packages/squad-sdk/src/` and `packages/squad-cli/src/` touched.

**Decisions:** Q1 = A — single session, no subdivision.

**Tone-and-Record callouts:** `runBind()` is an entirely new command surface. Its description in decisions/history must not use comparison framing. Refer to the feature as "cross-repo bind configuration" — not as "the upstream feature" or as a fork of any existing tool.

---

### Piece 27 — explicit-sync-command
**One-line summary:** Wire `squad sync` as a supported CLI command with docs-remote flags.

**Branch off:** `squad/piece-26-cross-repo-bind-config`  
**Local branch:** `squad/piece-27-explicit-sync-command`

**Spec file on `akubly/upstream-specs`:**  
`docs/proposals/upstream-bradygaster/27-explicit-sync-command.md`  
⚠️ **BLOCKER:** Requires authoring before replay.

**Hard dependencies:** Piece 26 (config schema with `stateRemote`, `stateBranch`, `developerAlias` must be in place).

**Verify-first sub-elements:**
- Probe `sync.ts` for existing `runSync()`/`syncPull()`/`syncPush()`: confirm current signatures and whether a `--remote` flag exists. The spec must match the actual function signatures on tip.
- Probe `cli-command-wiring.test.ts` for the `KNOWN_UNWIRED` list: confirm `sync` is still in that list. If already wired, drop wiring work and record verify.
- Probe `install-hooks.ts` for current hook templates: understand what triggers are present before specifying additions.

**Special-scrutiny items:**
- `ensureStateRemote()` configures git refspecs in the developer's WORK_ROOT remote config — a **new write surface** touching `.git/config`. Must be idempotent; must not clobber existing refspecs for unrelated remotes.
- The `--push` flag initiates a push to the docs repo. This is the first place in the arc where a CLI command can trigger a remote write. Scrutinize: does the command require explicit confirmation, or is it silent-success? Silent push on a hook (post-push) is high-risk if the developer has not run `squad bind` first.
- Hook templates updated to pull from the docs remote: any hook that auto-pushes must be guarded behind a presence check for `stateRemote` in config.

**Scrub-gate risk:** Gate 3 (lint/type-check) — adding new CLI flags tends to produce implicit-any on option parsing. Gate 6 (no debug artifacts) — sync commands commonly leave `console.log` breadcrumbs.

**Changeset:** ✅ Yes — `packages/squad-cli/src/` touched.

**Decisions:** (No dedicated Q-lock; piece 27 inherits Q1's single-session approach and Q2's `{ repo, pathHash }` shape for sourceWorkRoot validation.)

**Tone-and-Record callouts:** When recording sync decisions, refer to the remote as the "state remote" or "docs remote" — never as "upstream" or "the original repo."

---

### Piece 28 — inbox-branch-publish-flow
**One-line summary:** Implement read-from-state / write-to-inbox split with provenance metadata.

**Branch off:** `squad/piece-27-explicit-sync-command`  
**Local branch:** `squad/piece-28-inbox-branch-publish-flow`

**Spec file on `akubly/upstream-specs`:**  
`docs/proposals/upstream-bradygaster/28-inbox-branch-publish-flow.md`  
⚠️ **BLOCKER:** Requires authoring before replay.

**Hard dependencies:** Pieces 26 + 27 (both `squad bind` config schema and `squad sync` remote plumbing must be in place).

**Verify-first sub-elements:**
- Probe `state-backend.ts` for `OrphanBranchBackend` and `TwoLayerBackend`: confirm the backend abstraction shape before writing the hydrate/publish helpers that sit above it.
- Probe `sync.ts` for existing `syncPull()`/`syncPush()`: confirm no partial implementation of `hydrateTeamRootFromStateRef` or `publishTeamRootToInbox` is already present.

**Special-scrutiny items:**
- `publishTeamRootToInbox()` creates branches in the docs/specs repo. If the developer's `developerAlias` is empty or malformed, branch names will be invalid. Add strict validation: alias must match `[a-z][a-z0-9-]{0,38}` (ADO branch name safety).
- `.squad/publish-metadata.json` records `developerAlias`, `sessionId`, `sourceWorkRoot`, `publishedAt`, `baseStateCommit`. This is the first provenance surface in the arc. Confirm `publishedAt` uses ISO 8601 UTC and `sourceWorkRoot` does not leak absolute Windows paths that include username in `C:\Users\<name>\...`.
- Concurrent publish test (bare-repo fixture) is a **new test fixture requirement**. Must be purpose-built for this piece; do not reuse `.test-state-backend-*` fixtures without audit.
- Session shard path format `sessions/<projectKey>/<workstream>/<sessionId>/` must be documented in the spec and locked here — downstream fold logic depends on it.

**Scrub-gate risk:** Gate 2 (tests must be red before green) — the bare-repo concurrent-publish test is complex. Risk of writing the implementation before the test is sufficiently failing. Gate 4 (no secrets/PII) — `sourceWorkRoot` in provenance metadata may contain Windows username in path; must be scrubbed or replaced with a relative form.

**Changeset:** ✅ Yes — `packages/squad-cli/src/` and `packages/squad-sdk/src/` touched.

**Decisions:** Q2 = C — `sourceWorkRoot` stored as `{ repo, pathHash }` (no absolute paths; §9 NFR annotation).

**Tone-and-Record callouts:** Session artifacts recording the publish flow must not reference "fork" semantics. "Inbox branch" and "state branch" are the correct vocabulary.

---

### Piece 29 — team-root-work-root-protocol
**One-line summary:** Update coordinator protocol (squad.agent.md templates) for the TEAM_ROOT / WORK_ROOT split.

**Branch off:** `squad/piece-28-inbox-branch-publish-flow`  
**Local branch:** `squad/piece-29-team-root-work-root-protocol`

> ⚠️ **Dependency note:** Piece 29 can logically branch off piece 26 (it needs the config model, not the sync engine). However, to keep the chain linear and ensure the coordinator prompt accurately reflects the full sync vocabulary from pieces 27–28, branching off piece 28 is recommended. If piece 28 is delayed, piece 29 can optionally branch off piece 27 with a scope annotation.

**Spec file on `akubly/upstream-specs`:**  
`docs/proposals/upstream-bradygaster/29-team-root-work-root-protocol.md`  
⚠️ **BLOCKER:** Requires authoring before replay.

**Hard dependencies:** Piece 26 (config model stable). Piece 28 (sync vocabulary finalized) recommended but not strictly required.

**Verify-first sub-elements:**
- Probe `.squad-templates/squad.agent.md` for any existing `TEAM_ROOT`/`WORK_ROOT` mentions — if sections are already present, scope the change to additions only.
- Probe `scripts/sync-templates.mjs` and `test/template-sync.test.ts` to understand the mirror/sync mechanism before touching template source files.
- Probe all four mirror targets (`templates/`, `packages/squad-cli/templates/`, `packages/squad-sdk/templates/`, `.github/agents/`) to confirm they are generated — never hand-edit mirror outputs.

**Special-scrutiny items:**
- `squad.agent.md` is the coordinator contract read by every active session. A change here is a **protocol-level breaking change** for any session running mid-arc. The session restart requirement is binding: **any session open at the time piece 29 merges must be restarted** before the agent acts on the new protocol. This must be stated explicitly in the commit message and the PR description.
- The four-path table (TEAM_ROOT / TEAM_SQUAD_DIR / WORK_ROOT / WORK_SQUAD_DIR) must be unambiguous. Scrub for any phrasing that could be read as "WORK_SQUAD_DIR is writable by non-Scribe agents."
- The spawn prompt contract (§4.5 of handoff) must be verbatim-reproducible: the five variables must appear in a fixed order with no optional omissions.

**Scrub-gate risk:** Gate 1 (tsc/build clean) — template changes that include TypeScript variable references may cause interpolation issues if the template engine parses `{TEAM_ROOT}` as a literal. Gate 6 (no debug artifacts) — template files must not contain TODO/FIXME stubs after commit.

**Changeset:** ❌ No — no `packages/*/src/` changes. Template-only piece.

**Decisions:** Q3 = A — louder restart banner in commit message and PR description; version-check tooling deferred.

**Tone-and-Record callouts:** **Session restart required after this piece merges.** Record this in the commit message and in `.squad/decisions.md`. Any history/log entries written post-merge must use the new four-path vocabulary. Old references to "the team root" (singular, undifferentiated) must not appear in new entries.

---

### Piece 30 — ado-cross-repo-templates
**One-line summary:** Ship ADO pipeline templates (publish-inbox.yml, fold-squad-state.yml, bootstrap-cross-repo.ps1) and template-sync integration.

**Branch off:** `squad/piece-29-team-root-work-root-protocol`  
**Local branch:** `squad/piece-30-ado-cross-repo-templates`

**Spec file on `akubly/upstream-specs`:**  
`docs/proposals/upstream-bradygaster/30-ado-cross-repo-templates.md`  
⚠️ **BLOCKER:** Requires authoring before replay.

**Hard dependencies:** Pieces 26–29 (all prior pieces — bootstrap script wraps `squad bind`; pipelines rely on sync vocabulary and provenance schema).

**Verify-first sub-elements:**
- Probe `scripts/sync-templates.mjs` for whether it already handles subdirectories under `.squad-templates/` (e.g., an `ado/` subdirectory) — confirm the sync script does not need modification before placing templates there.
- Probe `test/template-sync.test.ts` for the current assertion pattern so new ADO template existence assertions follow the same style.
- Probe existing docs files (`shared-squad.md`, `state-backends.md`, `team-state-storage.md`) to understand current coverage before adding new content.

**Special-scrutiny items:**
- `fold-squad-state.yml`: this pipeline fast-forwards `squad-state`, which is a protected branch in the docs repo. The pipeline identity permissions must be explicit in the template YAML (comments at minimum). The template must never grant `allow scripts to access OAuth token` broadly — scope it to the specific step that needs write access.
- `publish-inbox.yml`: must carry a `branches:` exclude pattern that prevents triggering on `squad-state` or `main`/`dev` — otherwise a rogue push to a protected branch could trigger an inbox write incorrectly.
- `bootstrap-cross-repo.ps1` executes `squad bind` with mandatory parameters. If `DeveloperAlias` is empty, the script must fail fast with a clear error — not proceed silently with a blank alias that corrupts provenance metadata.
- All three templates are shipped to four mirror locations. The template sync test must verify all four. Missing a mirror target is a silent failure.

**Scrub-gate risk:** Gate 4 (no secrets/PII) — YAML pipeline templates often include placeholder tokens (e.g., `$(System.AccessToken)`) that look like secrets to naive scanners. Pre-scrub: confirm the gate's secret-detection pattern handles ADO variable syntax. Gate 5 (changeset) — templates land in `.squad-templates/` which is NOT under `packages/*/src/`; however, if `sync-templates.mjs` is updated, that is under `scripts/` — confirm changeset is not required for `scripts/` changes.

**Changeset:** ❌ No — no `packages/*/src/` changes. Template and docs piece only. (If `scripts/sync-templates.mjs` requires modification, reassess — `scripts/` is not a changeset target.)

**Decisions:** Q4 = D — behavioral YAML assertions using `yaml` devDep; structural contract tests per template.

**Tone-and-Record callouts:** Pipeline template comments must not reference any external product names or version numbers. Use generic terms: "Squad state remote," "Squad fold pipeline," "Squad inbox branch." No comparison framing in YAML comments.

---

### Piece 30.5 — scrub-gate audit
**One-line summary:** Atomic gate-rule extension covering all new surfaces from pieces 26–30.

**Branch off:** `squad/piece-30-ado-cross-repo-templates`  
**Local branch:** `squad/piece-30.5-scrub-gate-audit`

**Spec file on `akubly/upstream-specs`:**  
`docs/proposals/upstream-bradygaster/30.5-scrub-gate-audit.md`  
⚠️ **BLOCKER:** Requires authoring after piece 30 replay completes (all surfaces must be known).

**Hard dependencies:** Pieces 26–30 (all surfaces must be landed before the gate can be extended atomically).

**Three new gate rules** (all tagged `[upstream-bound]`):
1. No `Users\` or `/home/` path segments in any string value in `.squad/config.json` or `.squad/publish-metadata.json` — serves pieces 26, 28.
2. ADO variable syntax `$(...)` exclusion in `.squad-templates/ado/**` paths — serves piece 30.
3. Alias format validation `[a-z][a-z0-9-]{0,38}` for `developerAlias` field — serves pieces 26, 27, 28.

**Test fixture:** `test/scrub-gate-surfaces.test.ts` — synthetic fixtures exercising each new surface rule against pass/fail cases.

**Changeset:** ❌ No — gate rules are test-only; no `packages/*/src/` changes.

**Decisions:** Q5 = C — hybrid approach; see `.squad/decisions/inbox/flight-q5-scrub-gate-hybrid.md`. Gate-flavor bifurcation directive: see `.squad/decisions/inbox/copilot-directive-scrub-gate-bifurcation.md`.

**Tone-and-Record callouts:** All three rules are `[upstream-bound]` — they flow upstream as product surface protections. The existing replay-private gates (2, 3, 4) remain untouched and do NOT appear in this piece's diff.

---

## C. Cross-Cutting Concerns

### `squad.agent.md` session restart requirement
Piece 29 replaces the coordinator contract. Any session that loaded `squad.agent.md` before piece 29 is merged will be operating on the old protocol. **Mandatory action:** before any post-29 session proceeds with code work, the coordinator must reload the agent file. Recommended implementation: add a `## Protocol Version` marker to `squad.agent.md` that increments on breaking changes; Scribe checks for version drift at session start.

### Transitional state during the arc
- **`.squad/casting/`**: No changes in pieces 26–30. Casting reads from TEAM_ROOT are implied by piece 29's protocol update but the casting machinery itself is not modified in this arc.
- **Decisions inbox**: Scribe continues to write to the local TEAM_ROOT `.squad/decisions/inbox/` throughout the arc. After piece 28, Scribe should eventually migrate to using `squad sync --push` for remote publication — but that transition is NOT scoped to this arc. Document as a follow-on.
- **Existing `link`/`init-remote` users**: Piece 26 must preserve the `projectDir`/`teamDir` deprecated aliases for one release cycle. No existing `init-remote` or `link` deployments should break silently.
- **Hooks**: Pieces 26 and 27 both touch hook installation. Ensure the two pieces' hook changes do not conflict. Piece 26 adds hooks via `runBind()`; piece 27 updates hook templates. Recommend the spec for piece 27 explicitly states which hook template files it modifies vs. the hook install logic from piece 26.
- **Scribe behavior mid-arc**: Scribe does not write to WORK_SQUAD_DIR until piece 29 lands. Before 29, Scribe may continue using the current single-root path. After 29, Scribe must use the explicit TEAM_SQUAD_DIR. This is a behavioral cutover — flag it in piece 29's commit message.

### Subdivision candidates
- **Piece 26** is the highest-complexity piece in the arc (~150–200 estimated LOC across resolution.ts, bind.ts, init-remote.ts, link.ts, cli-entry.ts, plus 4 test files). If a single session cannot complete all of it within the scrub-gate quality bar, consider splitting: **26a** = config schema expansion only (SquadDirConfig fields + deprecated aliases + test coverage), **26b** = `runBind()` implementation + CLI wiring. The spec author should flag this split option.
- **Piece 30** has three independent deliverables (two YAML pipelines + one PS1 bootstrap). If the ADO YAML linter is not available in the replay environment, the YAML pieces could slip to a follow-on. The bootstrap PS1 is the highest-value item for early adopters — ship it first if scope forces a cut.

### Recommended order
The handoff states: Piece 1 → 2 → 3 (linear); Piece 1 → 4 (parallel option); Pieces 1–4 → 5. Translated to local numbers: **26 → 27 → 28 → 29 → 30**, with the option to run **26 → 29** in parallel if two sessions are available. For a single-session-per-piece linear chain, the order above (26, 27, 28, 29, 30) is correct. Parallel execution of 26→27 and 26→29 is an option only if the piece-26 config schema is locked before either branch diverges — risky for solo development.

**Confirmed order: 26 → 27 → 28 → 29 → 30 → 30.5 (linear chain).**

### Scrub-gate flavor rule
Scrub-gate rules are bifurcated into two flavors: **replay-private** (isolation guards that never flow upstream) and **surface-relevant / upstream-bound** (product-surface protections that ship with their owning piece). Every new gate rule must be explicitly tagged `[replay-private]` or `[upstream-bound]` in its spec section. The three rules in piece 30.5 are all `[upstream-bound]`. See `.squad/decisions/inbox/copilot-directive-scrub-gate-bifurcation.md` for full directive.

---

## D. Pre-Flight Checklist (One-Time, Before Piece 26)

### 🚨 Spec authoring — hard blocker

The following spec files **must exist on `akubly/upstream-specs`** before any replay session can proceed. None of them exist today. Spec authoring is a pre-flight requirement:

| File | Required before |
|------|----------------|
| `docs/proposals/upstream-bradygaster/26-cross-repo-bind-config.md` | Piece 26 replay |
| `docs/proposals/upstream-bradygaster/27-explicit-sync-command.md` | Piece 27 replay |
| `docs/proposals/upstream-bradygaster/28-inbox-branch-publish-flow.md` | Piece 28 replay |
| `docs/proposals/upstream-bradygaster/29-team-root-work-root-protocol.md` | Piece 29 replay |
| `docs/proposals/upstream-bradygaster/30-ado-cross-repo-templates.md` | Piece 30 replay |
| `docs/proposals/upstream-bradygaster/30.5-scrub-gate-audit.md` | Piece 30.5 replay |
| `docs/proposals/upstream-bradygaster/_scrub-gate.ps1` | All pieces (must exist or be verified present) |

The `_scrub-gate.ps1` file may already exist from prior pieces (21–25). Verify with `git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1` before assuming it's absent.

### Repo state expectations
- Working tree clean on `squad/piece-25-resolver-rename-and-cli-hardening` (no uncommitted changes)
- `origin/dev` synced: confirm no new commits to dev that would create divergence before branching
- Confirm piece 25 is complete: `git log --oneline -5` shows `185617e5` or later as tip

### Tooling requirements
- **Bare-repo fixture for piece 28 concurrent-publish test:** No existing bare-repo fixture pattern in this repo covers concurrent branch creation. The spec for piece 28 must include a concrete fixture setup that the replay session can follow. Pre-flight option: author a fixture helper script before piece 28 replay.
- **ADO YAML linter for piece 30:** There is no ADO YAML linter available in the local replay environment. The YAML pipeline templates in piece 30 should be validated using `az pipelines` dry-run or a manual schema check against the ADO YAML schema. Pre-flight: confirm what YAML validation is feasible in the replay environment and document in the piece 30 spec.
- **`yaml` devDep (Q4):** Piece 30 adds `yaml` (npm) as a devDependency for behavioral YAML assertions in `test/ado-template-structure.test.ts`. Piece 30.5 reuses this dep — no additional dependency beyond what piece 30 introduced.
- **`REPLAY-PROTOCOL.md` on `akubly/upstream-specs`:** Confirm this file covers pieces 26–30.5 (or that the existing copy from piece 21 still applies without modification).

---

## E. Resolutions

All five open questions are now resolved:

| # | Resolution | Rationale |
|---|-----------|-----------|
| Q1 = A | Piece 26 ships as a single session. | Replay workflow handles complexity; subdivision adds coordination cost without benefit. |
| Q2 = C | `sourceWorkRoot` stored as `{ repo, pathHash }`. | Eliminates PII (no absolute paths); §9 NFR annotation ensures the shape contract is spec-visible. |
| Q3 = A | Louder restart banner; defer version-check tooling. | Banner is sufficient for the replay workflow; automated version detection is a follow-on concern. |
| Q4 = D | Behavioral YAML assertions with `yaml` devDep. | Structural contract tests catch template regressions without requiring an ADO connection. |
| Q5 = C | Hybrid: per-piece behavioral tests + single post-30 gate-audit pass (piece 30.5). | Avoids mid-arc regression coupling; keeps gate evolution atomic after all surfaces are known. |
