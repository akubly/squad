# Decisions

> Team decisions that all agents must respect. Managed by Scribe.


---

### 2026-05-28: User directive — push policy
**By:** akubly (via Copilot)
**What:** Pushing to github.com/akubly/squad is acceptable if there are no leaked gate violations that weren't pre-existing. Reverses the strict "commit-only no-push" stance applied across pieces 21–25 for any future stack work. The condition: a push must not introduce NEW build/lint/test/tsc failures beyond what the parent branch already had — pre-existing failures inherited from upstream are not a blocker.
**Why:** User request — clarifies that the no-push rule was situational, not absolute. Aligns with normal git workflow on a personal fork while preserving the gate-cleanliness contract.

**Practical implications for the Coordinator:**
- Future implementer spawns may push their branch to `origin` (akubly/squad fork) after committing locally.
- Implementers must run build/lint/tsc/tests AND confirm they pass cleanly OR document any failures as pre-existing (with evidence: the same failure on the parent commit).
- Pushing does NOT mean opening a PR — those remain Brady's call.
- Retroactive: the piece-25 push (`origin/squad/piece-25-resolver-rename-and-cli-hardening` at `e67e0959`) is acceptable under this policy; Flight's self-report said gates were clean.


---

### 2026-05-28: FIDO Piece 25 Adversarial Review Approval

# FIDO Piece 25 Adversarial Review Approval

Date: 2026-05-28
Reviewer: FIDO (Quality Owner)
Commit: `e67e0959`
Branch: `squad/piece-25-resolver-rename-and-cli-hardening`
Requested by: akubly

## Verdict: ⚠️ APPROVE-WITH-NITS

### Blockers
None.

### Option A compliance
- ✅ `resolveSquad` has `@deprecated` JSDoc pointing to `resolveSquadDir` in SDK implementation and public barrel.
- ✅ SDK barrel exports `resolveSquadDir` and retains `resolveSquad` as a `typeof resolveSquadDir` alias.
- ✅ Internal SDK callsites are migrated/clean; only the compatibility alias and unrelated `resolution-v2` import alias retain the old name.
- ✅ Changeset classifies `@bradygaster/squad-sdk` as `minor` and `@bradygaster/squad-cli` as `patch`.
- ✅ Contract test asserts `resolveSquadDir(opts)` and deprecated `resolveSquad(opts)` return equivalent results.

### Push-policy compliance
- Pre-existing failures on parent:
  - Raw clean dependency setup has pre-existing lock/dependency skew: `npm ci` reports package-lock out of sync; `npm install` creates a nested stale `@bradygaster/squad-sdk@0.9.4` under CLI, causing build/lint/CLI tsc to resolve stale declarations.
  - With the local workspace SDK controlling for that skew: `npm run build`, `npm run lint`, SDK tsc, and CLI tsc pass on parent.
  - `npx vitest run` is red on parent: 42 failed test files / 197 passed / 1 skipped.
- New failures on `e67e0959`:
  - None after controlling for the pre-existing dependency skew. Workspace-linked `npm run build`, `npm run lint`, SDK tsc, and CLI tsc all pass.
  - `npx vitest run` remains red but improves to 15 failed test files / 225 passed / 1 skipped; no new visible failure class versus parent.

### Test coverage
- Alias: ✅ `test/cli/legacy-resolver-migration.test.ts` includes a D-18 canonical-vs-deprecated alias equivalence test.
- N2 runtime/type proof: ⚠️ `renderFinding` has the required `never` switch arm, but no dedicated `// @ts-expect-error` test proves a new `DoctorSource` variant fails type-check.
- Env seam: ✅ `test/cli/squad-resolver.test.ts` has four resolver wrapper tests; fake env is injected through `isolatedEnv()` and passed to `resolveSquadDir`.

### LOC actual vs forecast
- Production TS diff: 40 insertions / 17 deletions = +23 net LOC across five package `.ts` files.
- Forecast: +9 to +14 net production LOC.
- Assessment: Above forecast by ~9-14 LOC, still small and below the 40-net warning threshold / 200 LOC ceiling.

### Non-blocking nits
1. Add a compile-time regression test with `// @ts-expect-error` for a hypothetical new `DoctorSource` variant so N2 is test-proven, not only implementation-proven.
2. Consider typing the internal `resolution.ts` compatibility alias as `typeof resolveSquadDir` to match the public barrel.
3. Stale comments still say the CLI wrapper wraps SDK `resolveSquad`; update to `resolveSquadDir` opportunistically.
4. Dependency hygiene remains pre-existing: clean install can resolve CLI against a stale nested published SDK. Not introduced by piece 25, but worth an EECOM/Surgeon follow-up.

### If REJECT
Not rejected. If these nits become blocking later, recommend EECOM because Flight is locked out and the remaining work is implementation/test hygiene.


---

### 2026-05-28: EECOM Piece 25 Revision

**Date:** 2026-05-28  
**Owner:** EECOM (Core Dev)  
**Branch:** `squad/piece-25-resolver-rename-and-cli-hardening`  
**Commit:** `185617e51e215dfbf59415a688ff9e1b9fd9a9af`

**Nits folded:**
- N1 (CONTROL): `packages/squad-sdk/src/resolution.ts` now types the internal compatibility alias as `typeof resolveSquadDir`.
- N2 (FIDO): `test/cli/doctor.test.ts` adds a `@ts-expect-error` regression proving an unhandled `DoctorSource` variant is rejected at compile time through `renderFinding`.
- N3 (FIDO): stale non-deprecated comments/JSDoc now reference `resolveSquadDir` in the SDK resolver docs, path-utils reader note, and CLI wrapper header.

**Gate results:**
- `npm run build`: PASS (after dependency setup).
- `npm run lint`: PASS.
- All tsc checks: PASS.
- `npx vitest run test/cli/doctor.test.ts`: PASS (47/47).
- `npx vitest run`: FAIL, inherited baseline only (15 failed files / 225 passed / 1 skipped — no new failures).

---

### 2026-05-28: CONTROL Directive — Piece 25 Type-Fidelity Findings

# CONTROL Directive — Piece 25 Type-Fidelity Findings

**Date:** 2026-05-28  
**Author:** CONTROL (TypeScript Engineer)  
**Branch:** squad/piece-25-resolver-rename-and-cli-hardening  
**Commit audited:** e67e0959

---

## Finding 1 — `resolution.ts` alias uses bare const (no `typeof`)

**File:** `packages/squad-sdk/src/resolution.ts`, line 159  
**Code:** `export const resolveSquad = resolveSquadDir;`  
**Issue:** The alias lacks `typeof` annotation. TypeScript infers the type from the implementation signature. Since `resolution.ts`'s `resolveSquadDir` is currently single-signature, this is harmless today. However, if overloads were ever added to `resolution.ts`'s `resolveSquadDir`, TypeScript would collapse the alias to the implementation signature — losing overload resolution for direct-module consumers.

**Contrast with barrel:** `packages/squad-sdk/src/index.ts` line 29 correctly uses `export const resolveSquad: typeof resolveSquadDir = resolveSquadDir;` — preserving both barrel overloads.

**Impact:** This module-level alias is NOT re-exported by the barrel (barrel's named-export list on line 32 omits `resolveSquad`). Public API consumers are unaffected. Only users who import directly from `resolution.js` are exposed to the brittle form.

**Directive:** In future pieces touching `resolution.ts`, update the alias to:
```ts
export const resolveSquad: typeof resolveSquadDir = resolveSquadDir;
```
This aligns the internal module alias with the barrel alias form and future-proofs against overload additions.

**Severity:** Non-blocking nit. Do not block the PR for this; fix opportunistically.

---

## Finding 2 — Env seam was pre-existing; piece-25 contribution was import rename only

The Directive 2 env seam (`env: NodeJS.ProcessEnv = process.env`) was implemented in a prior piece, not piece-25. Piece-25 only renamed the import alias from `resolveSquad as resolveSquadV2` to `resolveSquadDir as sdkResolveSquadDir` to align with the D-18 rename. The commit message correctly describes this. No action needed — documented here for audit transparency.

---

## Overall: ✅ APPROVE-WITH-NITS


---

### 2026-05-28: EECOM Decision — Version drift from manual incomplete package.json edit

**Date:** 2026-05-28  
**Author:** EECOM (Core Dev)  
**Branch:** `akubly/upstream-npm-release`  

**Root Cause:** `scripts/bump-build.mjs` was NOT involved. Brady had `SKIP_BUILD_BUMP=1` set when `npm run build` ran — the script was skipped entirely. Commit `0f5ac1d2` manually edited only `packages/squad-cli/package.json` — bumping its version and `@wifi-aware/squad-sdk` dep pin from `.10` to `.11` — without touching `package.json` (root) or `packages/squad-sdk/package.json`. This left: root=`.10`, sdk=`.10`, cli=`.11`, cli sdk-pin=`.11`. The pin referenced an SDK version that does not exist on disk.

**Decision:** Direct edits to any individual `package.json` version field are prohibited. When manual version alignment is necessary, ALL THREE files must be updated in a single atomic commit (root, squad-sdk, squad-cli), and `packages/squad-cli`'s `dependencies["@wifi-aware/squad-sdk"]` pin must equal the new version. **Canonical version resolution rule: Highest on disk wins.** Bring lower-versioned files up; never down.

**Repair:** Brought root and `packages/squad-sdk` to `0.9.6-mc.preview.11` in commit `a3a3a9f0`. bump-build.mjs unchanged (was not the cause).


---

### 2026-05-29: Flight Decision — Cross-Repo Arc Staging

**Author:** Flight  
**Date:** 2026-05-29  
**Status:** Merged from inbox

**Decision: Linear chain 26 → 27 → 28 → 29 → 30; spec authoring is a hard pre-flight blocker**

The cross-repo handoff defines five implementation pieces mapped to local piece numbers 26–30. Execution order: strict linear chain (26 → 27 → 28 → 29 → 30). Piece 26 subdivision option is available but not mandated. **Spec authoring is a hard pre-flight blocker for the entire arc** — no replay session can proceed until the relevant spec file is present on `akubly/upstream-specs`. The scrub gate must be verified before piece 26 replay. Session restart required after piece 29 merges (coordinator protocol update is breaking).

**Hard invariants:** No Squad files in product PR diffs, single canonical writable state root, least-privilege automation, aliases (not emails) in published metadata.


---

### 2026-05-29: Procedures Decision — Cross-Repo Prompt Pack

**Date:** 2026-05-29  
**Author:** Procedures  
**Scope:** Pieces 26–30 prompt artifacts

**Decision:** Shipped five Phase-B session prompts for pieces 26–30. No implementation sub-division required — all five pieces are coherent, self-contained units. 

**Guard-rails identified (team-relevant, not blocking):**
1. Per-piece spec file existence check added to all prompts — recommend standardizing in baseline template.
2. Acceptance gate naming — recommend adding optional `## Acceptance gate` section to baseline.
3. YAML/JSON static asset validation — scrub gate does not validate YAML parse. Recommend adding YAML validation to gate 7.
4. Coordinator restart guidance in commit body — piece 29 changes `squad.agent.md` and requires session restart. Recommend standardizing for any piece modifying coordinator templates.
5. PII guard in publish metadata (piece 28: `.squad/publish-metadata.json` must never contain email — alias only).

**Flight-plan alignment:** Cross-check branching order before execution. If Flight's plan specifies non-linear order, "Currently on branch" lines in affected prompts must be updated.

---

### 2026-05-29: Piece 26 stays as single session (Q1 = A)

**By:** Adam (decision), Flight (recorded)  
**What:** Piece 26 (cross-repo bind config) is NOT subdivided. Config schema + runBind() + tests ship in one session, one commit, one spec file.  
**Why:** Load-bearing contracts ship with their first consumer to prove fitness. Schema correctness is validated by runBind() in same session; speculative-contract risk avoided.  
**Scope:** Replay arc pieces 26–30. Chain remains 26 → 27 → 28 → 29 → 30.

---

### 2026-05-29: sourceWorkRoot is structured `{ repo, pathHash }` (Q2 = C)

**By:** Adam (decision), Flight (recorded), RETRO (security challenge resolution)  
**What:** `publish-metadata.json` field `sourceWorkRoot` is an object: `{ repo: <basename>, pathHash: "sha256:<hex>" }` where pathHash is SHA-256 of the lowercased, forward-slash-normalized absolute path. Raw paths MUST NOT appear in published metadata.  
**Why:** Pipeline publish path (no git author identity to fall back on) and BYOD-alias-mismatch case both expose identity that the developer alias was meant to protect. Hashed form preserves cross-clone race-debugging signal at zero runtime cost.  
**§9 NFR annotation:** "Git commit author identity is the identity floor. Metadata fields must not add incremental identity or infrastructure surface beyond that floor."  
**Scope:** Piece 28 spec + _scrub-gate.ps1 must enforce object-shape assertion.

---

### 2026-05-29: Piece 29 session-restart is a louder banner only (Q3 = A)

**By:** Adam (decision), Flight (recorded)  
**What:** Piece 29 ships as a coordinator-protocol change only. Restart-enforcement tooling is NOT in scope. The piece-29 commit body and PR description must carry a prominent restart banner: "🔄 squad.agent.md updated — restart sessions to pick up new path semantics (TEAM_ROOT/WORK_ROOT split). Pre-29 sessions will silently route writes to wrong roots."  
**Why:** Piece 29 is a coordinator-protocol change, not a tooling change. The current single-developer replay arc is adequately protected by the existing self-development rule + a louder banner. Version-check tooling (Option B from the deliberation) is a generic Squad-platform concern that belongs in its own piece after the arc ships and multi-developer scenarios become real.  
**Follow-up piece (future, separate arc):** Coordinator version enforcement — implement on-disk-vs-session version comparison at session start, with cross-surface support (CLI / VS Code / GitHub.com). Out of scope for this arc.

---

### 2026-05-29: Piece 30 YAML templates validated by behavioral assertions (Q4 = D)

**By:** Adam (decision), Flight (recorded)  
**What:** Piece 30 adds `test/cli/ado-templates.test.ts` that parses each .yml template with the `yaml` npm package and asserts piece-specific structural contracts: no `pr:` trigger on `publish-inbox.yml`; `squad/inbox/*` trigger on `fold-squad-state.yml`; no broad OAuth scope on fold; alias-empty guard in `bootstrap-cross-repo.ps1`. NO schema vendoring (ADO YAML schema not fetched or stored).  
**Why:** TDD discipline requires RED→GREEN tests on every shipped surface. Spec contracts (our concerns) are testable in-repo; ADO schema conformance (their concerns) is best caught by Phase C reviewer pasting into a pipeline editor. Vendoring 180KB of drift-prone schema violates replay isolation with no proportional value.  
**New devDependency:** `yaml` (lightweight, no transitive deps).  
**Scope:** Piece 30 spec + Procedures' piece-30 prompt updated with explicit "Test surface" callout.

---

### 2026-05-29: Scrub-gate evolution = hybrid (Q5 = C)

**By:** Adam (decision), Flight (recorded)  
**What:** Per-piece behavioral test files validate piece-internal structural contracts (Q4 pattern). A single post-30 gate-audit piece (call it 30.5) adds the genuinely cross-cutting gate rules in one atomic commit AFTER all surfaces 26–30 are known. Pieces 26, 27, 28 do NOT modify `_scrub-gate.ps1` in their own commits.  
**Three new gate rules for piece 30.5:**  
1. No `Users\` or `/home/` path segments in any string value in `.squad/config.json` or `.squad/publish-metadata.json` (serves pieces 26, 28; new Gate 7 or G4 extension)
2. ADO variable syntax `$(...)` exclusion in `.squad-templates/ado/**` paths (serves piece 30; G4 exclusion clause)
3. Alias format validation `[a-z][a-z0-9-]{0,38}` for `developerAlias` field (serves 26, 27, 28; new Gate 7 or G3 extension)

**Why:** Q2 already established the per-piece-gate-sub-rule precedent (piece 28's sourceWorkRoot shape check lives in piece 28's tests, not the gate). The scrub gate is a cross-cutting exclusion filter operating tree-wide via `git grep`. Extending it piecemeal creates regression coupling (piece 26's rule may flag piece 30's `$(System.AccessToken)` before piece 30 lands its exclusion). Hybrid keeps gate evolution atomic and avoids mid-arc breakage.  
**Test fixture:** `test/scrub-gate-surfaces.test.ts` in piece 30.5 — synthetic fixtures for each new surface.  
**Scope:** Pieces 26–30 + new piece 30.5.

---

### 2026-05-29: Scrub-gate rules have two flavors — replay-private vs upstream-bound

**By:** Adam (directive), Flight (recorded)  
**What:** Scrub-gate rules MUST be authored with explicit awareness of which flavor they are.  
- **Flavor 1 — Replay-private:** Isolation guards specific to this workflow that prevent first-party concepts from leaking into commits (e.g., current Gates 2 (wifi.aware), 3 (akubly), 4 (Microsoft/internal). Stay in `akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1`. NEVER flow upstream as a code change.
- **Flavor 2 — Surface-relevant:** Gate rules that protect product surfaces being shipped (e.g., the three new rules for piece 30.5: abs-path segment exclusion, ADO `$(...)` exclusion, alias-format allowlist). These ARE product features. They flow upstream as part of their owning piece's PR.

**Why:** Conflating the two would either (a) leak first-party isolation rules into upstream PRs (bad — outs the replay process) or (b) keep product-surface protections trapped in replay-private gate code (bad — upstream loses the protection that ships with the feature).  
**Authoring rule:** Every gate-rule addition MUST be tagged in its spec section as `[replay-private]` or `[upstream-bound]`. The piece 30.5 spec must annotate all three new rules as `[upstream-bound]`. Any future replay-private gate rule additions stay outside the upstream-bound flow.  
**Scope:** Binding for all future scrub-gate work in this replay arc and any successor arcs.

---

### 2026-05-29: Procedures spec decision — Foundation pieces 26–28

**Date:** 2026-05-29  
**Author:** Procedures  
**Scope:** Spec authoring for cross-repo arc pieces 26, 27, 28

**Decision: Six structural choices made while authoring that were not pre-locked**

The following items were resolved during spec authoring. None override any locked decision (Q1–Q5). All are additive refinements.

#### 1. `runBind()` idempotency contract is at entry-level, not step-level

The piece 26 spec requires that `runBind()` be fully idempotent end-to-end (re-running on an already-configured WORK_ROOT is a no-op). The handoff specified individual step idempotency but did not state that the function as a whole must also be re-runnable without error. The spec locks this as a test assertion.

#### 2. Windows cross-drive path normalization rule for `.git/info/exclude`

The handoff identified `.git/info/exclude` as a new write surface but did not specify how to handle absolute Windows paths when WORK_ROOT and TEAM_ROOT are on different drives. The spec locks: entries must be written as forward-slash relative patterns, never as absolute paths, regardless of host OS. This is consistent with git's own exclude format contract.

#### 3. `ensureStateRemote()` placement in piece 27

The handoff described `ensureStateRemote()` as a helper inside `sync.ts` but did not specify whether it should be called at dispatch time or at the pull/push call site. The spec locks: called at the start of every `--pull` and every `--push` execution path. This ensures the guard fires for hook-triggered syncs as well as direct CLI invocations.

#### 4. `publishedAt` serialization format locked to ISO 8601 UTC with `Z` suffix

The handoff specified ISO 8601 UTC but did not address local-time serialization risk. The spec adds: must use `Z` suffix, not a UTC offset, to eliminate fold-ordering ambiguity across time zones.

#### 5. Piece 28 test assertion count expanded from 2 to 6

The handoff listed two bare-repo fixture assertions. Decision Q2 added three more (object shape, no raw paths, pathHash stability). The spec adds one more (alias-empty guard prevents branch creation). Total: six numbered assertions as the acceptance gate.

#### 6. `hydrateWorkRootProjection()` file deletion semantics

The handoff did not specify what happens to files in the WORK_ROOT projection that no longer exist in TEAM_ROOT. The spec locks: remove stale files from the projection. This prevents ghost files from accumulating across hydration cycles and is necessary for the projection to remain a faithful read-only mirror.

---

### 2026-05-29: Spec Protocol Decisions — Procedures

**Date:** 2026-05-29  
**Author:** Procedures

#### Gate 8: positive-assertion pattern for allowlist coverage

When adding a gate rule that must permit a known class of expressions in a specific file surface, implement it as a positive assertion (every expression in the target surface must match an allowlist pattern) rather than a pure exclusion (do not match X). The positive-assertion approach:

- Explicitly allows all known-good expressions (e.g., ADO variable names matching `[A-Za-z][A-Za-z0-9._]*`).
- Fails on novel patterns that were never explicitly reviewed, including future injection attempts.
- Does not require modifying existing gate rules — the new gate covers the new surface independently.

This is the correct pattern when (a) the existing gate that would otherwise cover the surface (e.g., Gate 4's internal-reference check) cannot be modified, and (b) the new surface has a well-defined allowlist (e.g., ADO runtime variable names are well-specified).

Generalizable rule: any gate rule that adds allowlist coverage for a new file surface should use positive assertion, not exclusion. Document this in the spec's proposed-change section alongside the rule body.

#### Gate numbering convention for additive audit pieces

When adding gate rules to a fixed-count scrub gate (where existing rules display `[1/6]` through `[6/6]`), new rules use `[7]`, `[8]`, `[9]` headers without a total count. Do not update the existing `[N/6]` labels — that would violate the preserve-existing constraint.

This creates a header inconsistency that is intentional and acknowledged. A future cleanup piece can normalize all headers simultaneously. The additive piece's spec notes section should call this out explicitly so reviewers do not flag it as a defect.

#### Spec section: Session restart requirement

Protocol-change specs (any piece that alters an agent-observable behavior or modifies a template read at session start) require a dedicated `## Session restart requirement` section. This section must contain the exact verbatim restart banner string that will appear in the commit body and PR description — not a paraphrase. The spec is the contract; the commit body is derived from it.

This pattern was invented for piece 29 (TEAM_ROOT/WORK_ROOT protocol change). It is reusable for any future piece that changes coordinator templates or agent charter files that are read at session initialization.

---

---

### 2026-05-29: Deprecated alias targets and deprecation-warning mechanism for piece 26

**By:** EECOM

**What:** `projectDir` maps to `workSquadDir` (the `.squad/` directory in the product repo), not to `workRoot`. `teamDir` maps to `teamRoot` (the team repo root), not `teamSquadDir`. Deprecation fires via `Object.defineProperties` getters on the returned shape, guarded by a module-level `_deprecationFired` map (exported for test resets) so `console.warn` fires at most once per process per alias.

**Why:** The original `projectDir` semantics pointed to the `.squad/` directory (what is now `workSquadDir`), not the repo root. Mapping it to `workRoot` would have silently broken all callers that use the path to write files inside `.squad/`. Similarly, `teamDir` historically pointed at the team repo root, so it maps to `teamRoot`. The once-per-process guard prevents noisy log spam in long-running CLI sessions while still giving downstream consumers a clear migration signal. The `_deprecationFired` export is the stable test-reset contract for pieces 27+.


---

### 2026-05-29: EECOM Piece 27 — Pre-existing build and scrub-gate baseline

**Author:** EECOM
**Piece:** 27 — explicit sync command

## Build failure baseline

`npm run build` was failing BEFORE piece 27 changes on branch `squad/piece-26-cross-repo-bind-config` (the piece-26 tip). Confirmed by stashing piece-27 changes and running `npm run build` — same errors produced.

Failing files (all pre-existing, not touched in piece 27):
- `packages/squad-cli/src/commands/doctor.ts` — imports missing SDK exports (`clonesMatch`, `isValidCallsign`, `normalisedPathKey`, `normalizeRemoteUrl`)
- `packages/squad-cli/src/commands/init.ts` — imports missing SDK exports
- `packages/squad-cli/src/commands/unassign.ts` — imports missing SDK exports

Root cause: SDK refactor in an earlier piece removed or renamed these exports. CLI commands referencing them were not updated. This is a separate work item and not within piece 27 scope.

**Action:** Flight or the next scheduled piece should reconcile CLI commands against current SDK exports. No piece-27 files introduce new TypeScript errors (confirmed via targeted `tsc --noEmit` check).

## Scrub-gate Gate 1 baseline

Scrub gate exits 1 due to pre-existing strip-listed paths:
- `docs/_internal/` directory (16 files)
- `templates/casting/`, `templates/identity/`, `templates/orchestration-log.md`
- `packages/squad-cli/templates/` and `packages/squad-sdk/templates/` equivalents
- `packages/squad-sdk/src/casting/`

These paths have been present since before piece 08a. Per piece-08a coordinator decision: "Scrub gate failures are pre-existing upstream baseline contamination, not piece responsibility." The strip-list was designed to exclude MS-internal Windows wireless team artifacts; Squad's own product directories (`/casting/`, `/identity/`, `orchestration-log`) match the pattern incidentally. Piece 27 introduces zero new strip-listed paths.

Gate 2 (wifi-aware): PASS
Gate 3 (akubly mentions): WARN — `.squad/` state files only, expected
Gate 4 (internal mentions): WARN — `.squad/` state files only, expected
Gate 5 (ADO fixtures): PASS
Gate 6 (file count): PASS (13 files)

## Wiring test pre-existing failures

Two wiring test failures pre-date piece 27:
- `commands/doctor-types.ts is imported in cli-entry.ts` — FAIL (pre-existing)
- `commands/init-remote.ts is imported in cli-entry.ts` — FAIL (pre-existing)

These are not piece 27 responsibility. `sync` now passes the wiring test (wire added in piece 27).


### 2026-06-01: Piece 27 adversarial review — CONTROL verdict
**By:** CONTROL (TypeScript Engineer)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- Type design is sound overall — `SyncOptions.direction` is a correctly-typed string literal union; `SyncGitOps` injection interface is clean; `ensureStateRemote()` signature is `Promise<void>` with process.exit semantics consistent with the rest of the codebase.
- Remote resolution (`options.remote ?? readStateRemoteFromConfig(repoRoot) ?? 'squad-docs'`) is a pure, nullish-correct precedence chain — exactly right.
- ESM correctness: all new imports use `.js` extensions; dynamic `await import('./cli/commands/sync.js')` in cli-entry.ts is correct.
- Zero new tsc errors vs. parent (43 pre-existing on both). Piece-27 introduced no type regressions.
- Zero new suppressions. Pre-existing `(err as any).stderr` in `syncPush` is untouched by this piece.
- **Mandatory nit (N1):** `readStateRemoteFromConfig` and `readDeveloperAliasFromConfig` both hand-roll `JSON.parse(raw)` → `any` access, bypassing the SDK's typed `loadDirConfig(squadDir: string): SquadDirConfig | null` which already covers `stateRemote` and `developerAlias`. A rename of either field in `SquadDirConfig` would fail at runtime in sync.ts with no compile-time alert. The typed seam exists; sync.ts should use it.

**Type nits (mandatory):**
N1: `readStateRemoteFromConfig` and `readDeveloperAliasFromConfig` bypass `loadDirConfig()` and operate on `any` (JSON.parse result). Replace both with a single call to `loadDirConfig(path.join(repoRoot, '.squad'))` from `@bradygaster/squad-sdk`, then read `config?.stateRemote` and `config?.developerAlias` from the typed `SquadDirConfig | null` return. This makes field-name renames a compile-time catch instead of a runtime surprise. The SDK function is already exported from the barrel and handles missing/malformed files identically to the hand-rolled fallback.

**Type nits (non-blocking):**
N2: `SyncOptions.developer?: string` accepts `''` — the empty-alias guard (`if (!alias)`) is runtime-only. The type system does not enforce non-empty alias at the boundary. A JSDoc `@remarks` on the field documenting the non-empty contract, or a `NonEmptyString` brand, would make the contract explicit to callers. The spec question confirms this is the expected finding; runtime behavior is correct.

N3: `REQUIRED_REFSPECS` is named in SCREAMING_SNAKE_CASE (convention = module-level constant) but is a factory function `(remote: string) => string[]`. Rename to `requiredRefspecs(remote)` or `getRequiredRefspecs(remote)` to signal that it is a function, not a frozen value.

N4: `return config.stateRemote || undefined` in `readStateRemoteFromConfig` uses falsy-OR. If the field were ever an empty string, it would be treated as absent — which may be intentional, but `?? undefined` (nullish) is the correct nullish-coalescing form to pair with the `??` chain in `runSync`. Replace with `return config.stateRemote != null && config.stateRemote !== '' ? config.stateRemote : undefined` or, once N1 is adopted, this row disappears.

N5: Direction flag parsing in cli-entry.ts uses sequential `if` without `else if` — last match wins silently. `squad sync --pull --push` resolves to `push` with no feedback. Not a type error, but the intent contract is undocumented; a comment noting "last-flag-wins" or an explicit conflict guard would prevent confusion.

**Build/tsc status:** FAIL (pre-existing) — `tsc --noEmit -p packages/squad-cli/tsconfig.json` exits 2 with 43 errors on the parent commit (piece-26) and 43 errors on piece-27 commit `31177e72`. Zero new errors introduced. All 43 failures are baseline contamination from stale published SDK in `packages/squad-cli/node_modules/@bradygaster/squad-sdk` (stale `SquadDirConfig` missing recent fields, missing renamed exports). This is the pre-existing dependency skew documented by FIDO in the piece-25 review. Piece-27 is clean against baseline.

**Suppressions introduced (`@ts-ignore`/`as any`/`eslint-disable`):** 0 — none introduced. `(err as any).stderr` in `syncPush` is pre-existing on the parent commit; confirmed by diffing `31177e72^`.

**Public API surface drift:**
- `SyncGitOps` interface — new export (additive)
- `DEFAULT_SYNC_GIT_OPS` — new export (additive)
- `SyncOptions.direction` union expanded from `'push'|'pull'|'both'` to `+'hydrate-only'|'publish-only'` — additive, no breakage
- `SyncOptions.{developer?, gitOps?, workRoot?}` — new optional fields (additive)
- `ensureStateRemote(repoRoot, remoteName, gitOps?)` — new export (additive; this is the piece-28–30 contract boundary)
- No removals. All existing callers of `runSync` remain valid.

**Cross-piece consistency:** `stateRemote` in `SquadDirConfig` is present and typed as `string | undefined` in the SDK's `resolution.ts` at this commit. Piece-27 reads it from `.squad/config.json` at runtime (via untyped hand-roll — see N1). The schema field aligns with piece-26's design. The TS2353 on `bind.ts(235,5)` is stale-modules contamination, not design drift.

**If REJECT:** Not rejected. If N1 becomes blocking (post-merge regression risk increases as pieces 28–30 add more callers), recommend EECOM as revision author (piece-27 implementer locked out per team protocol).


### 2026-06-01: Piece 27 adversarial review — FIDO verdict
**By:** FIDO (Quality Owner)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- All 18 sync-command tests and 15 install-hooks tests GREEN on piece-27 tip (31177e72). Confirmed.
- Recursion guard (SQUAD_SYNC_ACTIVE) present in all 4 hook templates AND in `runSync()` — PASS.
- Core spec functionality (remote resolution, ensureStateRemote, CLI wiring) sound and tested.
- Two functional defects found via adversarial probing: whitespace alias bypass and force-install duplication. Neither is a spec misread; both are implementation bugs with real user impact.
- No new `eslint-disable`, `@ts-ignore`, or `as any` introduced by piece 27 (existing `(err as any).stderr` in syncPush predates this piece).
- Lint/build failures identical on piece-26 and piece-27 tip — pre-existing baseline, not regressions.

**Mandatory nits (must resolve before PR merge):**

N1: **Whitespace-only alias bypasses the empty-alias guard.**
`runSync()` checks `if (!alias)` — a falsy check. `developer: ' '` (space), `developer: '\t'` (tab), and `developer: '\n'` (newline) are all truthy in JavaScript and pass straight through to push operations. The resulting push would construct refs like `squad/inbox/ /session-id`, which fail in git with a cryptic ref-name error rather than the spec-required clean exit-1 with guidance. Fix: change the guard to `if (!alias || !alias.trim())`. Add tests: `developer: ' '`, `developer: '\t'`. These must fire BEFORE any git op (currently they would reach `syncPush()`).

N2: **`installHook()` with `force: true` duplicates the squad section instead of replacing it.**
The force branch computes `const cleaned = existing.split('\n').filter(...).join('\n')` but the variable is never used — it is dead code. Execution falls through to the chain block, which appends the new template on top of the already-marked hook. Each `squad install-hooks --force` invocation doubles the hook content. This can exceed shell script limits and cause silent double-invocations of the state fetch. Fix: use `content` directly (not chained on `existing`) when `force` is true and marker is found. Add a test: run `installHooks` twice with `force: true`; assert the marker appears exactly once and the hook length matches a fresh install.

**Non-blocking nits:**

N3: **No flag-combination-precedence tests.** Passing `--pull --push` to the CLI produces `direction = 'push'` (last-if-wins); `--hydrate-only --publish-only` produces `publish-only`. These precedence rules are not documented and not tested. No spec requirement to reject the combo, but tests verifying the winner (or a clear error) would prevent silent user confusion.

N4: **`--remote ""` at CLI dispatch is silently ignored.** If a user types `squad sync --remote ""`, the CLI condition `args[remoteIdx + 1] ? { remote: ... } : {}` treats the empty string as falsy and falls through to config/default without any warning. Not harmful but surprising. Consider a non-empty validation guard or a short warning.

N5: **No test for `stateRemote` absent + `--both` direction.** The existing remote-resolution tests cover each source independently for `--pull`. No test exercises `--both` with `stateRemote` absent from config (falls back to `squad-docs` default) — this path is untested through the combined pull+push flow.

**Pre-existing baseline claim:** VALIDATED
- Build: identical TS errors on assign.ts, doctor.ts, init.ts, unassign.ts on both piece-26 (b5fc0af3) and piece-27 (31177e72). Diffed `npm run build` output line-by-line — zero new errors introduced.
- Wiring failures: `doctor-types.ts` and `init-remote.ts` both fail on piece-26 with the same assertion text. On piece-26, `sync.ts` passes as `KNOWN_UNWIRED`; on piece-27 it passes as wired. EECOM's baseline-contamination claim for Gates 1+2 is confirmed correct.
- Lint: `npm run lint` failures on piece-27 are the same pre-existing errors (stale SDK exports in legacy commands). No piece-27 files appear in lint output.

**Hook recursion guard:** PASS
- All 4 templates (`pre-push`, `post-merge`, `post-checkout`, `post-rewrite`) contain `SQUAD_SYNC_ACTIVE`.
- `runSync()` checks `process.env[SQUAD_SYNC_ENV]` at entry and sets it before any git call.
- Install-hooks test `pre-push hook still has recursion guard after update` passes GREEN.
- Post-merge, post-checkout, post-rewrite guard tests (3 × recursion) all pass GREEN.

**Spec conformance:** 17/19 acceptance criteria pass (2 partial — empty-alias guard misses whitespace; force-reinstall not implemented correctly and untested).

**If REJECT:** N/A — this is APPROVE-WITH-NITS. If N1 or N2 block after revision, recommended rev author: EECOM (implementer of this piece). Flight is locked out as original implementer.


### 2026-06-01: Piece 27 adversarial security review — RETRO verdict
**By:** RETRO (Security)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- All git subprocess calls use `execFileSync` with array argument forms throughout — no shell-string `exec` anywhere in the diff. This is the primary defense against shell and flag injection and it holds.
- The `--remote` flag injection surface is closed: `ensureStateRemote()` validates the remote name via string comparison against `listRemotes()` output before any git invocation that takes the remote name as input. A hostile `--remote "--upload-pack=evil"` fails the `remotes.includes()` check and exits 1 with bind guidance — never reaches a git invocation with that value as a flag.
- Hook templates use `"$REMOTE"` (double-quoted variable) throughout all four templates. Shell command substitution in `$REMOTE` cannot be executed — the value is already assigned as a string. No code injection path exists through a hostile `stateRemote` in config.
- `SQUAD_SYNC_ACTIVE` recursion guard is present in all four hook templates and at the entry of `runSync()`, with proper `unset` on exit. Guard does not require cross-session persistence and is correctly scoped to the process environment.
- All config reads (`git config --add`, `git config --get-all`) use local-repo scope — no `--global` flag anywhere.
- One mandatory fix required (H1): the alias-empty guard does not reject whitespace-only values, violating the spec contract.

**Critical findings (BLOCK PR):**
None.

**High findings (mandatory before PR):**
H1: **Whitespace-only alias bypasses the alias-empty guard.**
- In `runSync()`: `const alias = options.developer !== undefined ? options.developer : readDeveloperAliasFromConfig()`. For `options.developer = " "` (spaces/tabs), `alias = " "` is truthy — `if (!alias)` does not fire.
- In `cli-entry.ts` dispatch: `...(developerIdx !== -1 ? { developer: args[developerIdx + 1] ?? '' } : {})`. A user running `squad sync --push --developer "   "` passes three spaces as the alias, which passes the guard.
- Spec contract: "If `--developer <alias>` is provided but the value is empty, exit 1." Whitespace-only is functionally empty.
- Fix: `if (!alias || !alias.trim())` in the push-direction guard in `runSync()`. One-line change.
- Probe verified: `--developer ""` correctly exits 1; `--developer " "` incorrectly proceeds.

**Medium / Low findings (non-blocking):**
M1: **Push error messages may expose auth tokens embedded in git remote URLs.**
- In `syncPush()`, the catch block: `const msg = err instanceof Error ? (err as any).stderr || err.message : String(err)`. Git push failure stderr can contain the remote URL; if the URL is `https://<token>@github.com/org/repo`, the token appears in the console output.
- Mitigation: strip URL credentials from `msg` before printing (regex: replace `https?://[^@]+@` with `https://***@`).
- Not a block — requires an already-misconfigured credential-in-URL, and console output is not persisted to committed files.

M2: **`installHook()` force-reinstall logic is incomplete — double-appends on `--force`.**
- When `force=true` and the hook already contains `SQUAD_HOOK_MARKER`, the code computes a `cleaned` variable but never uses it. Execution falls through to the chaining path, appending the new squad section without removing the old one. Repeated `squad install-hooks --force` compounds hook content indefinitely.
- Not a security issue (the hook still guards correctly), but a correctness defect. Fix: complete the forced-overwrite path to remove the old squad section before appending.

M3: **No charset allowlist on `--remote` or `stateRemote` values.**
- All git subprocess calls use `execFileSync` array args (not shell), so shell metacharacters are inert. However, a remote name containing null bytes or newlines could cause confusing failures in refspec construction and hook template parsing without an informative error.
- The piece 30.5 decision establishes alias format `[a-z][a-z0-9-]{0,38}` as the scrub-gate rule. Remote names should be held to a similar allowlist (`[a-zA-Z0-9_.-]{1,64}`) enforced at input validation time. Non-blocking because the actual injection path is closed; this is a defence-in-depth hardening.

M4: **Developer alias accepted without charset validation — future injection surface.**
- The alias is validated for presence (H1 aside) but not for character set or length. When `squad/inbox/<alias>/<session>` refspecs are implemented in later pieces, an alias containing `/`, `*`, `..`, or control characters will be interpolated directly into git refspecs.
- The piece 30.5 decision (decision 2026-05-29) already specifies `[a-z][a-z0-9-]{0,38}` as the alias allowlist for the scrub gate. Apply the same allowlist in `runSync()` alias validation now, before the refspec interpolation lands.

L1: **Hook templates lack `set -eu` strict mode.**
- All four hook templates omit `set -e` (exit on error) and `set -u` (error on unset variable). Critical git calls use `|| true` or `2>/dev/null` as safety valves, which is intentional. But non-critical intermediate steps (e.g., `REPO_ROOT=$(git rev-parse ...)`) could fail silently under unusual conditions.
- Low risk given the `|| true` coverage. Adding `set -e` at the top of each hook (after the shebang) with explicit `|| true` on the intentionally-fallible calls would improve error visibility without changing current behavior.

L2: **`cli-entry.ts` dispatch is missing `--push` and `--both` direction handlers.**
- Direction resolution: `--pull`, `--hydrate-only`, `--publish-only` are explicitly mapped. `--push` has no handler — it silently falls to the default of `'both'`. `--both` also falls to `'both'` (correct result, wrong path). Not a security issue; a correctness gap that makes `squad sync --push` behave as `--both`.

**Attack surface assessed:**
- `--developer` validation: **partial** — empty string `""` correctly exits 1; whitespace `" "` incorrectly passes. No charset check. Alias unused in git ops in this impl, so no injection reachable today, but H1 violates spec contract.
- `--remote` injection: **pass** — `remotes.includes(remoteName)` check fires before any git invocation taking the remote name. `execFileSync` array args throughout. No `--` separator needed for config-key construction. Flag injection probe (e.g., `--remote "--upload-pack=evil"`) exits 1 at the includes check.
- Config-driven attack (`stateRemote`): **pass** — hook templates quote `"$REMOTE"` throughout all four templates. No command substitution re-evaluation occurs. Hostile `stateRemote` causes git to reject an unknown remote, not to execute attacker code. JS code path uses `execFileSync` array args.
- Refspec safety: **pass** — `+` force-update prefix is correctly scoped to remote-tracking refs (`refs/remotes/`), not local branches. Local branch updates in `syncPull()` are gated on `merge-base --is-ancestor` before `git update-ref`. Push refspecs have no `+` prefix.
- Hook template safety: **partial** — recursion guard present and correct in all four templates. Variable quoting is correct (`"$REMOTE"` everywhere). `set -eu` absent (L1). Force-reinstall deduplication incomplete (M2). Missing-config silent-skip works correctly.
- Secret/PII leakage: **partial** — no `.env` reads, no credential writes to committed files. Push error messages may surface git remote URLs including any embedded auth tokens (M1). No stack traces leak in non-debug paths. Hooks directory path printed at install time contains no credentials.

**If REJECT:** Not rejected. If H1 fix is contested, recommended rev author: EECOM (implementer locked out per strict lockout protocol — assign to CONTROL or Sims, consistent with piece 10 revision precedent).

### 2026-06-01: Piece 27 Nit Revision — Adversarial Review Complete

**Status:** Resolved  
**Revision Author:** Flight (Lead)  
**Branch:** squad/piece-27-explicit-sync-command  
**Commit:** 5d8509f4 (pushed)

#### Nits Resolved

- **N1/H1 (FIDO+RETRO):** Whitespace-only --developer " " rejected before git ops (!alias || !alias.trim()). 10 whitespace test cases added.
- **N2 (FIDO):** installHook(force:true) now idempotent — single squad section after repeat calls. Idempotency test added (16 tests total in install-hooks.test.ts).
- **N3 (CONTROL):** Hand-rolled JSON config readers replaced with typed loadDirConfig() + module augmentation to bridge SDK versions.

#### Test Results Post-Revision

| Test file | Status |
|-----------|--------|
| sync-command.test.ts | 33/33 PASS |
| install-hooks.test.ts | 16/16 PASS |
| cli-command-wiring.test.ts | 36/38 (2 pre-existing: doctor-types, init-remote) |

#### Verification

- Recursion guard (SQUAD_SYNC_ACTIVE) PASS in all 4 hook templates.
- Scrub-gate delta: zero new failures vs baseline.

#### Context

EECOM locked out per reviewer protocol; Flight assigned as rev author. Revision produced independently.
