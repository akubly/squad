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

### 2026-05-29: Deprecated alias targets and deprecation-warning mechanism for piece 26

**By:** EECOM

**What:** `projectDir` maps to `workSquadDir` (the `.squad/` directory in the product repo), not to `workRoot`. `teamDir` maps to `teamRoot` (the team repo root), not `teamSquadDir`. Deprecation fires via `Object.defineProperties` getters on the returned shape, guarded by a module-level `_deprecationFired` map (exported for test resets) so `console.warn` fires at most once per process per alias.

**Why:** The original `projectDir` semantics pointed to the `.squad/` directory (what is now `workSquadDir`), not the repo root. Mapping it to `workRoot` would have silently broken all callers that use the path to write files inside `.squad/`. Similarly, `teamDir` historically pointed at the team repo root, so it maps to `teamRoot`. The once-per-process guard prevents noisy log spam in long-running CLI sessions while still giving downstream consumers a clear migration signal. The `_deprecationFired` export is the stable test-reset contract for pieces 27+.

---

### 2026-06-04: Piece 25.5 — Sub-proposal F and G repair choices

**By:** EECOM (for akubly)

**What:**

Three decisions made during piece 25.5 test regression repair:

1. **Sub-proposal F — fix-code (not adjust-test):** The `assign.ts` error message `No squad registered as "${callsign}"` contained the substring `squad register`, which matched the test's exclusion regex. Decision: fix the source string to `No squad found with callsign "${callsign}"`. Rationale: the test was asserting the correct contract (no stale guidance referencing a removed command). The source message was the bug.

2. **Sub-proposal G — consult.test.ts registry isolation:** The happy-path describe block ran `init --global` without overriding `SQUAD_REGISTRY_PATH`. On second and subsequent test runs, the real `~/.squad/registry.json` retained a stale callsign entry from the prior run's deleted test directory, causing `ERR_SQUAD_INIT_CALLSIGN_EXISTS` exit 2. Decision: add `SQUAD_REGISTRY_PATH: join(TEST_ROOT, 'isolated-registry.json')` to `envWithGlobal`. This is a test quality fix, not a behavioral change — upstream `origin/dev` has the same vulnerability.

3. **Sub-proposal G — platform detection 'unknown' → 'github' tests:** Fork-introduced tests in `platform-adapter.test.ts` and `platform-adapter-ado.test.ts` expected `'unknown'` from `detectPlatformFromUrl` for unrecognized hosts and tested `toThrow(/SQUAD_PLATFORM/)`. After sub-proposal E corrected the fallback to `'github'` and the error class to `PlatformConfigError`, these tests needed updating. Decision: adjust-test — the assertions tracked the incorrect behavior; updating them makes the tests guard the correct contract.

**Why:**

Fix-code over adjust-test when the original test correctly captured the intended contract and the source was the divergence point. Adjust-test when the test was tracking behavior that was itself a fork-introduced bug. Both choices follow the principle: tests must assert the contract, not the current implementation.

---

### 2026-06-05: EECOM Piece 32 Implementation — Registry State Fields

**By:** EECOM (Core Dev)  
**What:** Piece 32 implementation complete: three new registry state fields (`stateRemote`, `stateBranch`, `developerAlias`) added to `RegistryEntry` interface in `packages/squad-sdk/src/registry.ts`. Both warm and cold paths persist these fields via conditional spreads. New `DEVELOPER_ALIAS_RE` validation module added to `packages/squad-sdk/src/validation.ts` with subpath export. Validation enforces regex `^[a-z][a-z0-9-]{1,38}$` at start of `runAssign`. Structural deviation: `_warmPath` threaded `writeRegistryFn` injectable through `_WarmCtx` for test interception (additive, no behavior change in production). 25 new tests across three files all GREEN. Scrub gate 1 failure pre-existing (identical strip-list on baseline). Branch: `squad/piece-32-registry-state-fields`, commit: `f35fa9b5`.  
**Why:** Enables developer alias and remote/branch metadata persistence for registry entries, with full test coverage and zero new regressions on piece 25.5 baseline.

---

### 2026-06-05: FIDO Piece 32 Adversarial Verification — APPROVE-WITH-NITS

**By:** FIDO (Quality Owner)  
**What:** Adversarial verification of piece 32 (commit `f35fa9b5`) against baseline `92139e5b` finds zero real regressions. Raw failure count apparent increase (159 → 169 failures) attributable to resource contention, confirmed via spot-check isolation: all 22 apparent regressions pass when run individually. 25 new piece 32 tests all GREEN. Scrub gate 1 failure identical on both branches (pre-existing strip-list). writeRegistryFn injectable threading verified as genuinely additive with zero production behavior change. Verdict: **APPROVE-WITH-NITS**. Two cosmetic nits flagged: N1 — `.github/agents/squad.agent.md` version stamp is side-effect artifact from dev-time init/upgrade, should be excluded; N2 — `test-fixtures/init-test/.gitignore` deletion is out-of-scope cleanup. Neither blocks piece 32 from proceeding.  
**Why:** Confirms piece 32 meets acceptance criterion (zero real regressions, 25 new tests green, gates clean). Nits require cleanup before next stack merge for commit hygiene but do not block current piece.

---

### 2026-06-05: CAPCOM Piece 32 Adversarial Review — APPROVE-WITH-NITS

**By:** CAPCOM (SDK Expert)

**What:** Adversarial contract review of piece 32 (commit `f35fa9b5`) finds zero SDK-boundary defects. Re-assign preservation mechanism validated on both warm and cold paths: `...entry` spread precedes conditional field overwrites, ensuring existing `stateRemote`/`stateBranch`/`developerAlias` values survive when flags are absent. Test P32.A5 confirmed as genuine disk round-trip (writeRegistry → loadRegistryFromDisk → validate). Export contract integrity confirmed: `./validation` subpath present in package.json, both `dist/validation.js` and `dist/validation.d.ts` exist. `DEVELOPER_ALIAS_RE` imported correctly from subpath; circular dependency structurally impossible.

Findings ranked by severity: (1) package.json brace indentation broken around `./validation` entry — valid JSON but visually suggests nesting that doesn't exist, maintenance risk. (2) `INVALID_ALIAS` error code violates `ERR_ASSIGN_*` naming convention — spec-binding defect, not implementation bug; recommend spec errata to rename `ERR_ASSIGN_INVALID_ALIAS` before piece 33/34 consumer locks in bare name. (3) No test exercises cold-start re-assign preservation when reactivating with existing `stateRemote` — code is correct; test coverage gap. (4) `validation.ts` JSDoc mentions `'origin'`/`'squad-state'` defaults on `stateRemote`/`stateBranch` — these are piece 33 consumer semantics, not validation-module concerns; misplaced doc.

Verdict: **APPROVE-WITH-NITS**. No blocking bugs. Nit 1 (indentation) and Nit 3 (test gap) highest-value for piece 33/34 foundation. Nit 2 (error code) track as spec errata with zero-cost rename opportunity before downstream consumer adoption.

**Why:** Validates SDK contract preservation mechanism, export surface integrity, and import path correctness. Clears re-assign preservation and circular-dependency hypotheses. Nits are cosmetic, spec-errata, or forward-risk — none require piece-32 rework; all deferred to spec errata and pieces 33/34.

---

### 2026-06-05: CONTROL Piece 32 Adversarial Review — APPROVE-WITH-NITS

**By:** CONTROL (TypeScript Engineer)

**What:** Adversarial type-system and build-pipeline review of piece 32 (commit `f35fa9b5`) finds zero type errors and zero new regressions. Regex `/^[a-z][a-z0-9-]{1,38}$/` has no flags (confirmed via `re.flags === ""`); repeated `.test()` calls return consistent results across valid aliases, stateless correctness verified. SDK tsc exit 0 under strict+noUncheckedIndexedAccess. CLI tsc exit 2 but all failures pre-existing (stale node_modules mismatch, unchanged context lines); piece 32 introduces zero new type errors. Build emit clean: `npm run build` exit 0, both `dist/validation.js` and `dist/validation.d.ts` exist. Conditional spreads on both `_warmPath` and `_coldStart` type-sound: `...(opts.field !== undefined ? { field: opts.field } : {})` correctly narrows to omit property when flag absent. All 79 SDK tests GREEN.

Findings ranked by severity: (N1) Regex accepts trailing/consecutive hyphens — spec-faithful but forward-risk for piece 33/34 branch-name construction (`squad/inbox/ab-/...` visually ambiguous); pieces 33/34 must sanitise at interpolation or tighten regex before branch naming. (N2) Error message hardcodes regex source instead of `DEVELOPER_ALIAS_RE.source` — DRY violation, error message silently stale if regex changes. (N3) `validation.ts` JSDoc misplaces `stateRemote`/`stateBranch` defaults — these belong on `RegistryEntry` field docs, not regex constant. (N4) `package.json` indentation inconsistency: `./validation` entry at 6 spaces while other exports at 4 spaces — valid JSON, visually suggests nesting, future maintenance risk. (N5) Test suite does not assert trailing-hyphen acceptance as explicit contract — coverage gap for forward-risk documentation.

Verdict: **APPROVE-WITH-NITS**. No blocking defects. N1 is most consequential for pieces 33/34 branch-naming; annotate as forward-risk and defer tightening to piece 33/34 spec decision. N2–N5 are cosmetic/coverage/DRY issues.

**Why:** Confirms type-system clean, build-emit working, regex statelessness verified. Clears all core type-safety and build-integrity hypotheses. Nits document forward-risk for pieces 33/34 (trailing-hyphen branch-name handling) and minor improvements for spec errata and coverage.

---

### 2026-06-05: EECOM Piece 32 Nit Pass — What Was Fixed and What Is Deferred

**By:** EECOM (Core Dev)  
**Scope:** Post-adversarial-review cleanup; folded into amended product commit `26c17667`

All independent verification checks pass. The nit-fix amend is clean. No regressions.

#### Fixed in This Pass

**(1) `./validation` export indentation in `packages/squad-sdk/package.json`**  
Re-indented to align with siblings (`"./copilot-payload"`, `"./resolution"`, etc.). JSON remained valid throughout; verified with `node -e "JSON.parse(...)"`.

**(2) INVALID_ALIAS error message — DRY via `DEVELOPER_ALIAS_RE.source`**  
Replaced hardcoded `/^[a-z][a-z0-9-]{1,38}$/` with `` `.../${DEVELOPER_ALIAS_RE.source}/...` `` so the displayed pattern tracks the live regex. Drift between the message and the actual enforcement pattern is now structurally impossible.

**(3) JSDoc moved to the right owner**  
Removed from `DEVELOPER_ALIAS_RE` doc block in `packages/squad-sdk/src/validation.ts`: the two lines describing `'origin'`/`'squad-state'` defaults for `stateRemote`/`stateBranch`. Added to `RegistryEntry` in `packages/squad-sdk/src/registry.ts`: brief inline JSDoc on `stateRemote` (`default: 'origin' when absent`) and `stateBranch` (`default: 'squad-state' when absent`).

**(4) Two new tests**  
P32.V11 (`test/sdk/validation.test.ts`): asserts that `DEVELOPER_ALIAS_RE` currently accepts `"ab-"` and `"a--b"`. Documents the intentional spec-faithful behaviour. Any future tightening will fail this test loudly.

P32.B4 (`test/cli/assign.test.ts`): cold-start re-assign without `--state-remote`/`--state-branch`/`--developer-alias` flags preserves the existing values already on the registry entry.

#### Deferred — Piece 33 Backlog

**Regex tightening: trailing and consecutive hyphens**  
`DEVELOPER_ALIAS_RE` (`/^[a-z][a-z0-9-]{1,38}$/`) accepts `"ab-"` and `"a--b"`. Tightening is **not** in scope for piece 32. P32.V11 ensures any future tightening is a loud, explicit test change rather than a silent behaviour shift.

**INVALID_ALIAS error code name**  
The error code `'INVALID_ALIAS'` is mandated by the piece 32 spec. A rename (e.g. to `'ERR_ASSIGN_INVALID_ALIAS'`) is recorded spec-errata for a later piece. The spec mandate takes precedence during piece 32; consistency is a separate concern.

#### Test Result

27 tests GREEN after nit pass: 11 validation, 3 registry, 13 assign.  
Scrub gate: Gate 1 pre-existing baseline FAIL; Gates 2–9 PASS, no new violations introduced.

**Why:** Four nits addressed (indentation, DRY regex message, JSDoc ownership, test gaps). Working-tree noise reverted. Isolated product commit `26c17667` remains clean on origin (8 files, zero .squad/noise). No regression introduced.

---

### 2026-06-05: FIDO Piece 32 Nit-Fix Re-Verification — APPROVE

**By:** FIDO (Quality Owner)  
**Amended commit:** `26c17667`

All independent verification checks pass. The nit-fix amend is clean. No regressions.

#### Verification Evidence

**Origin isolation:** `origin/squad/piece-32-registry-state-fields` tip = `26c17667`. Exactly 8 files in diff (no `.squad/` files, no `package-lock.json`, no root `package.json`, no `.github/`, no `test-fixtures`).

**Piece 32 Tests:** 27/27 GREEN — validation 11, registry 3, assign 13.  
P32.V11 confirmed present: accepts trailing hyphen and consecutive hyphens per spec.  
P32.B4 confirmed present: cold-start re-assign without state flags preserves existing fields.  
P32.B4 cold-path soundness: `cloneDir` not created before `runAssign`; state flags omitted; asserts fields preserved. **Test is NOT tautological** — removal of the additive merge operators would cause the test to fail.

**Nit Correctness:**
- (a) `./validation` export aligns with sibling exports. `node -e "JSON.parse(...)"` returns without error.
- (b) INVALID_ALIAS error message uses `DEVELOPER_ALIAS_RE.source` — no hardcoded regex pattern.
- (c) Default-semantics JSDoc on registry fields: `stateRemote` and `stateBranch` have inline defaults. Regex JSDoc in `validation.ts` describes only type/format.
- (d) Regex `/^[a-z][a-z0-9-]{1,38}$/` unchanged. `'INVALID_ALIAS'` code name unchanged. No deferred items touched.

**Build + Scrub Gate:**  
SDK builds clean. CLI TypeScript fails with pre-existing errors — reproduced identically on `dev` baseline before piece 32.  
Scrub gate: Gate 1 FAIL (pre-existing strip-list, byte-for-byte same as parent). Gates 2–9 PASS. Gate 9 (developerAlias format) is new and PASS — directly exercises piece 32 code.

**Regression spot-check:**  
`test/cli/init.test.ts` — 13/13 PASS.  
No new failures versus baseline.

#### Final Assessment

All nit fixes verified correct. Origin isolation confirmed. 27/27 piece-32 tests green. P32.V11 present and meaningful. P32.B4 present and cold-path sound. Build clean (no new failures). Scrub gates pass (Gate 1 pre-existing, Gate 9 new PASS). Zero regressions introduced.

**Verdict: ✅ APPROVE — nit-fix amend verified clean. Ready for stack progression.**

**Why:** Independent re-verification confirms all four nits are correct, working-tree noise is cleaned, isolated product commit remains clean on origin, and zero regressions introduced by the amendment. FIDO approval clears piece 32 for stack progression.

---

### 2026-06-05: Piece 32.5 — State transport helpers spec

**Date:** 2026-06-05  
**Author:** Procedures  
**Status:** Adopted

## What piece 32.5 specifies

Spec `docs/proposals/upstream-bradygaster/32.5-state-transport-helpers.md` defines two exported async functions in `packages/squad-cli/src/cli/commands/sync.ts`:

1. `publishTeamRootToInbox(teamRoot: string, remote: string, developerAlias: string, sessionId: string): Promise<void>`
   — Builds a git commit from a TEAM_ROOT `.squad/` snapshot and pushes it as a per-developer inbox branch (`squad/inbox/<alias>/<yyyyMMdd-HHmmss>-<sessionId>`) to the docs remote. Validates `developerAlias` against `DEVELOPER_ALIAS_RE` before any branch work. Enforces a snapshot allowlist guard. Writes `publish-metadata.json` with `{ repo, pathHash }` shaped `sourceWorkRoot` (§9 NFR PII rule: no raw absolute paths).

2. `hydrateTeamRootFromStateRef(teamRoot: string, remote: string, stateBranch: string): Promise<void>`
   — Fetches the docs remote's state branch and checks out its tree into TEAM_ROOT. Idempotent.

Both helpers are parameterized transport primitives: they receive resolved inputs as arguments and must not read config files or query the registry. Caller (piece 33's `runSync`) owns all resolution.

## Stack re-sequence

```
32 (registry state fields)
  └── 32.5 (state transport helpers)  ← this piece
        └── 33 (sync from registry)
              └── 34 (coordinator protocol)
                    └── 35 (fold pipeline / docs repo)
```

Piece 33's dependency line now reads "branches off 32.5" rather than "branches off 32."

## Invariants baked in

| Invariant | Mechanism |
|-----------|-----------|
| No product-repo writes | Both helpers operate on TEAM_ROOT only |
| No raw absolute paths in metadata | `sourceWorkRoot` is `{ repo, pathHash }` object; §9 NFR PII rule enforced |
| No squad files outside allowlist in inbox commits | Allowlist guard exits before commit on violation |
| `developerAlias` format validated | `DEVELOPER_ALIAS_RE` from `@bradygaster/squad-sdk/validation` checked before any branch creation |
| Idempotent hydration | `hydrateTeamRootFromStateRef` no-ops if TEAM_ROOT already at fetched commit |
| GitHub AND ADO supported | `remote` is a name, not a URL; platform-agnostic |
| No `.gitignore` / `.git/info/exclude` writes | Deployer constraint 2 honored |
| No product-repo pipeline automation | Deployer constraint 4 honored |

## Kill-list (must NOT be created by the implementing piece)

- `hydrateWorkRootProjection` and all WORK_SQUAD_DIR projection writes
- `config.json` reads, `readSyncConfig`, `detectBackend` calls inside the helpers
- `runBind` / `bind.ts` references
- `SquadDirConfig` augmentation or `declare module` extension
- `.gitignore` / `.git/info/exclude` writes
- Writes into WORK_ROOT
- Product-repo pipeline or server-side automation

---

### 2026-06-05: Piece 33 Reduced Scope — A + D Only

**By:** Flight (Lead), pending user authorization

**What:** Piece 33 proceeds with sub-proposals A (registry resolution) and D (alias env-var fallback). Sub-proposals B and C deferred: spec references transport functions from archived pieces 26–31; contradiction requires Procedures resolution.

**Why:** A + D deliver independent value, leave runSync coherent, and make future B + C easier. No half-wired state.

**Triage decision:**

Piece 33's spec references transport functions (`publishTeamRootToInbox` from piece 28, `hydrateTeamRootFromStateRef` from piece 31 sub-C) that belong to a lineage explicitly marked "archived under archive/pieces-26-30-dead" in the piece 32 spec. Piece 32 declares itself the foundation of a NEW cross-repo arc (32→33→34→35), yet piece 33 depends on exports from the archived lineage. This is a stack-design contradiction, not a not-yet-staged dependency.

**Authorized implementation scope:**

Authorize implementing:
- **Sub-proposal A** (registry resolution) — Replace config.json with registry as the primary source for `teamRoot`, `stateRemote`, `stateBranch`, `developerAlias` in `runSync`. This is marked "non-deferrable" in the spec. Delivers registry-first topology support.
- **Sub-proposal D** (alias env-var fallback) — Add `SQUAD_DEVELOPER_ALIAS` to the alias resolution chain. Unblocks pipeline invocations.

Defer to a future piece:
- **Sub-proposal B** (wire `publishTeamRootToInbox` into push path)
- **Sub-proposal C** (wire `hydrateTeamRootFromStateRef` into pull path)

---

### 2026-06-05: Piece 33 scope restored to full A–D (supersedes reduced-scope ruling)

**By:** akubly (via Copilot), on Flight's re-sequencing

**What:** The earlier piece-33 ruling (reduced scope: sub-proposals A + D only, defer B + C) is SUPERSEDED. Piece 32.5 (state-transport-helpers) is staged on akubly/upstream-specs (be32791c); it defines `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef`, which piece 33 sub-proposals B and C wire into `runSync`. Piece 33 therefore returns to its full A–D scope and branches off `squad/piece-32.5-state-transport-helpers` (not piece 32). Stack re-sequences to 32 → 32.5 → 33 → 34 → 35.

**Why:** The transport helpers piece 33 depends on were absent from the piece-32 lineage; rather than ship a partial piece 33, piece 32.5 supplies the helpers as parameterized, registry-agnostic primitives (TEAM_ROOT-only, kill-list enforced, §9 PII rule, snapshot allowlist guard). This unblocks the full cross-repo arc (33/34/35) without reintroducing dead-topology surfaces.

---

### 2026-06-05: Use ls-tree+cat-file for hydrateTeamRootFromStateRef on Windows

**Context:** The spec prescribes `git --work-tree=<teamRoot> checkout refs/remotes/<remote>/<stateBranch> -- .`, but this fails in nested test environments with "Directory not empty" when the test `teamRoot` is inside the outer squad-replay repo.

**Decision:** Replace Step 4 with git-plumbing:
1. `git --git-dir=<X> ls-tree -r --name-only <ref>` — enumerate file paths
2. For each path: `git --git-dir=<X> cat-file blob <ref>:<path>` — extract content
3. `fs.mkdirSync` + `fs.writeFileSync` — write to TEAM_ROOT

**Effect:** Materializes the state tree in TEAM_ROOT without altering HEAD, semantically identical to spec. Platform-agnostic; avoids OS-level path resolution ambiguity in nested contexts. Applies to `packages/squad-cli/src/cli/commands/sync.ts` — `hydrateTeamRootFromStateRef` only. Piece 33 should note this implementation detail in integration tests.

---

### 2026-06-05: hydrateTeamRootFromStateRef idempotency mechanism

**Finding:** The idempotency guard `if (headSha === fetchedSha) return;` is structurally broken. The snapshot commit is always orphan (no parent), and working repo HEAD is always its own init commit — SHAs can never be equal. The short-circuit never fires.

**Decision needed:** Choose one:
- **A. Fix via sentinel:** After hydrating, persist a `.squad/.hydrate-sha` file with `fetchedSha`; compare against that on re-entry.
- **B. Drop idempotency claim:** Document that `hydrateTeamRootFromStateRef` is safe to call repeatedly (overwrites with identical content) but does not short-circuit. Remove dead code.
- **C. Update HEAD after hydrating:** Move HEAD to fetched SHA via `git update-ref`, but this violates spec ("does not alter HEAD").

**Recommendation:** Option A is least invasive and preserves spec. Option B is honest about current behavior. Piece 33 author must not assume repeated hydrate calls are skipped — they are re-executed silently.

---

### 2026-06-05: Piece 32.5 State Transport Helpers — CAPCOM SDK-Contract Review

**Date:** 2026-06-05  
**Reviewer:** CAPCOM (SDK Expert)  
**Branch:** `squad/piece-32.5-state-transport-helpers`  
**Verdict:** APPROVE

**Contract checks:** All signatures byte-for-byte match piece 33 call sites. `DEVELOPER_ALIAS_RE` imported correctly from `@bradygaster/squad-sdk/validation`. Regex `/^[a-z][a-z0-9-]{1,38}$/` matches canonical. Both helpers are `export async function` and NOT invoked from `runSync`.

**Advisory (non-blocking):** `publishTeamRootToInbox` applies the allowlist as a hard throw-gate (entire call throws if any `.squad/` file is unlisted). On a live squad repo, this will throw on first invocation. Recommend confirming whether strict-guard (throw on unlisted) or filter-mode (silently skip unlisted) is intended before piece 33 integration. Either is defensible.

---

### 2026-06-05: Piece 32.5 State Transport Helpers — CONTROL Type/Edge Adversarial Review

**Date:** 2026-06-05  
**Reviewer:** CONTROL (TypeScript Engineer)  
**Subject:** `packages/squad-cli/src/cli/commands/sync.ts` (new exports + private helpers) and `test/cli/cross-repo-sync.test.ts`  
**Verdict:** APPROVE

**Findings:** No blocking type-safety issues. Build compiles without new type errors. Type hygiene: no new `any` leaks, no `@ts-ignore`, no unjustified non-null assertions. `pathHash` normalization stable across Windows/Unix. Allowlist prefix matching has no collision bugs (all entries carry trailing `/`). Isolated index via `GIT_INDEX_FILE` env var never mutates real `.git/index`. Error ordering correct: alias validation → allowlist check → git operations → push.

**MEDIUM (non-blocking):** Idempotency guard is dead code — `headSha === fetchedSha` never fires because function never updates HEAD. Files are re-written on every invocation (idempotent in outcome, not a true no-op). Recommended fix for follow-up: use sentinel ref or revise spec comment.

**Export independence:** Both helpers are `export async function` and NOT called from `runSync`. Correct. VERDICT: Approved to merge; MEDIUM finding for follow-up before exposing to end users.

---

### 2026-06-05: Gate Decision — Piece 32.5 State Transport Helpers

**Date:** 2026-06-05  
**Commit:** `d32fe25b` — `squad/piece-32.5-state-transport-helpers`  
**Gate:** Constraint-Compliance Gate (read-only)  
**Verdict:** PASS

**Checks:** Exactly 3 files changed (`.changeset/state-transport-helpers.md`, `packages/squad-cli/src/cli/commands/sync.ts`, `test/cli/cross-repo-sync.test.ts`). Zero kill-list violations (`config.json`/`detectBackend` only in pre-existing functions, not in new helpers). §9 PII rule enforced by passing Test 4 (no raw path in JSON, forbidden segments absent, `pathHash` with `sha256:` prefix present). Allowlist guard enforced by passing Test 8 (unlisted path throws before any commit). Signatures exact, not invoked from `runSync`. Scrub gate: pre-existing baseline carryover only, zero new violations. Tests: 10/10 GREEN.

**Final disposition:** GATE PASS. Cleared to push product SHA `d32fe25b`. No kill-list violation, no PII leak, no scope creep.

---

### 2026-06-06: Decision — detectBackend Disposition — Piece 33

**Date:** 2026-06-06  
**Piece:** 33 (sync-from-registry)  
**Filed by:** EECOM  

**Context:** `runSync` previously called `detectBackend(repoRoot)` to determine state backend. This read from WORK_ROOT/.squad/config.json and returned `'local' | 'external' | 'orphan' | null`. The call was used as a gate: backend `null` → early return (no sync). Sub-proposal A introduced registry-first TEAM_ROOT resolution. With registry resolution in place, config.json is demoted to fallback. The `detectBackend` call was a duplicate read of config.json data now already loaded inline.

**Decision:** Remove the `detectBackend(repoRoot)` call from `runSync`. Backend is now derived inline:
- Registry entry found → backend = `'orphan'`
- No entry, config.json present → backend = `config.stateBackend ?? null`
- No entry, no config.json → `configJsonPresent = false` (triggers exit-1 on push)

The `detectBackend` function definition is retained in sync.ts (unused by runSync, not exported) to avoid scope creep. It may be removed in a dedicated cleanup piece if no other callers exist.

**Rationale:** Eliminates a second config.json read after registry resolution already captured the needed data. Registry presence is the natural signal for orphan-branch backend mode — no separate detection needed. Keeps the change surface minimal. The `'local'` and `'external'` backend early-exits are replaced by the config.json stateBackend field, preserving backward-compat for single-repo setups.

---

### 2026-06-06: Piece 33 FIDO Adversarial Review — Gaps to Track Forward

**Status:** Approved  
**Context:** Piece 33 (sync-from-registry) — FIDO adversarial review of commit `0ce892e2`.  
**Verdict:** APPROVE

**Decision:** Piece 33 ships APPROVED. The following gaps are carried forward as explicit debt items for piece 34 test hardening or the next test-pass opportunity. None blocked the approve; all are non-critical.

**Gaps Carried Forward:**
- **G1:** B2 regression guard: add spy-based NOT-called assertion for `publishTeamRootToInbox`
- **G2:** Single-repo pull: add `hydrateTeamRootFromStateRef` NOT-called assertion (A6/A7)
- **G3:** Exit message content: assert stderr references `squad assign` (D4, A4)
- **G4:** `direction: 'both'` integration test missing — combined push+pull scenario untested
- **G5:** `SQUAD_TEAM_ROOT` + pull direction untested (A3 pull variant)
- **G6:** C2 idempotency: assert stable state after second pull

**Rationale for Approve Despite Gaps:** All gaps are assertion-coverage gaps, not logic errors. The implementation is correct. The behavioral protections for all gaps exist (incorrect wiring would produce a TypeError or git error that surfaces as test failure). The 64 targeted tests are GREEN; zero regressions vs baseline.

---

### 2026-06-06: Piece 33 SDK Contract Review — CAPCOM

**Reviewer:** CAPCOM (SDK Expert)  
**Commit:** `0ce892e2` on `squad/piece-33-sync-from-registry`  
**Date:** 2026-06-06  
**Verdict:** APPROVE

**Summary:** All six SDK contract checks for `runSync`'s consumption of registry primitives and 32.5 transport helpers passed. No defects found. No blocking issues.

**Contracts Verified:**
1. Imports: `loadRegistryFromDisk`, `normalisedPathKey`, `randomUUID` all canonical
2. Registry Entry Shape: `entry.path`, `entry.clones`, `entry.stateRemote`, `entry.stateBranch`, `entry.developerAlias` — all actual field names
3. Clone Matching: Both sides normalized via `normalisedPathKey` — case-insensitive on win32/darwin, case-sensitive on linux
4. Helper Call-Site Signatures: `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` parameter order and types match
5. sessionId: `process.env['COPILOT_SESSION_ID'] ?? randomUUID()` — correct
6. Remote is Platform-Agnostic Name: git remote name, not URL

**Finding:** No mismatch between call sites and frozen helper signatures. Kill-list honored on all six points.

---

### 2026-06-06: Piece 33 — Adversarial review findings (CONTROL)

**Date:** 2026-06-06  
**Reviewer:** CONTROL (TypeScript Engineer)  
**Scope:** `sync.ts`, `cli-entry.ts`, commit `0ce892e2`  
**Verdict:** APPROVE

**Type-safety findings:** Non-null assertions (teamRoot!, resolvedAlias!) are justified by control-flow guards. No `@ts-ignore`. No implicit `any`. No unsafe casts. Zero new type errors in changed files. `strict: true` and `noUncheckedIndexedAccess: true` both active.

**Branch/precedence findings:** Resolution order implemented correctly:
- TEAM_ROOT: `SQUAD_TEAM_ROOT` env > registry > config.json fallback ✅
- Alias: `options.developer` > `SQUAD_DEVELOPER_ALIAS` > `registryAlias` ✅

**MEDIUM — Whitespace alias inconsistency (not blocking):** Whitespace-only values (e.g. `"  "`) in `options.developer`, `SQUAD_DEVELOPER_ALIAS`, or registry `developerAlias` pass the `!resolvedAlias` guard and then throw inside `publishTeamRootToInbox` from regex validation, rather than `process.exit(1)` with the "squad assign" guidance message. Recommend: add `.trim()` before the falsy guard, or document the behaviour.

**Exit-code paths:** Registry-miss + no config.json + push → exit 1 naming `squad assign` ✅. Missing alias on push + crossRepo → exit 1 referencing `squad assign --developer-alias` ✅. Single-repo push → `syncPush` — no alias error ✅.

**Build result:** No new type errors. All `npm run build` failures are pre-existing piece-32 errors. SDK compiles cleanly.

---

### 2026-06-06: Gate Decision — Piece 33 (sync-from-registry)

**Date:** 2026-06-06  
**Gate:** Constraint-Compliance — final gate before piece 33 completion  
**Commit under review:** `b1f2da98`  
**Branch:** `squad/piece-33-sync-from-registry`  
**Verdict:** PASS

**Kill-List Checklist (all passing):**
1. config.json demoted to fallback — NOT primary when registry entry matches cwd ✅
2. TEAM_ROOT = `path.dirname(entry.path)` — `.squad` itself never passed ✅
3. Transport helper bodies and signatures byte-identical to 32.5 base ✅
4. No hydrateWorkRootProjection / WORK_SQUAD_DIR / WORK_ROOT writes / `.gitignore` edits / runBind / bind.ts / SquadDirConfig augmentation / OrphanBranchBackend ✅
5. Single-repo push routes to `syncPush` (not `publishTeamRootToInbox`) when `teamRoot` absent ✅
6. Alias-chain precedence: --developer > SQUAD_DEVELOPER_ALIAS > registry developerAlias > exit 1; whitespace-only trims to missing ✅
7. Registry-miss on push exits 1 naming `squad assign` ✅
8. SQUAD_TEAM_ROOT override precedes registry; single-repo (config.json present, no registry entry) still works ✅

**Test Results:** 66/66 tests pass
- cli-command-wiring.test.ts: 37 ✅
- sync-registry-resolution.test.ts: 13 ✅
- cross-repo-sync.test.ts: 16 ✅

**Process Hygiene:** 6-file commit (sync.ts, cli-entry.ts, two test files, cli-command-wiring.test.ts, .changeset/sync-from-registry.md). No .squad/ files. No package-lock.json. Changeset is `patch` for @bradygaster/squad-cli. No push to origin.

**Disposition:** Work is complete. Piece 34 may branch off `squad/piece-33-sync-from-registry`. EECOM is not locked out. No revision required.
