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


---

# Decision: External Copilot CLI post-tool hook — deferred

**Date:** 2026-06-06

## Summary

Sub-proposal B of the automatic publish triggers piece investigated whether the Copilot CLI
exposes a file-based external hook API for post-tool events that could be used to invoke
`squad sync --push --quiet` after writes to the team state directory.

## Investigation

At implementation time, the Copilot CLI data directory was probed at the following paths:

- `~/.config/github-copilot/` — not found
- `~/AppData/Roaming/github-copilot/` — not found
- `~/AppData/Local/github-copilot/` — found; contains only auth artifacts and a version manifest

The `AppData/Local/github-copilot/` directory contained: `auth.db`, `auth.db-shm`,
`auth.db-wal`, `versions.json`. No `hooks.json`, no `hooks/` subdirectory, no post-tool
hook registration surface was found.

## Determination

**Deferred.** No external, file-based Copilot CLI post-tool hook API exists at this time.

Sub-proposals A and C were implemented. Sub-proposal B is documented here as a follow-up piece.
A `// TODO(piece-34-B)` comment is present in `install-hooks.ts` at the relevant integration
point. A skip-annotated test stub is included in `test/cli/install-hooks.test.ts`.

## Follow-up

If the Copilot CLI adds a file-based external hook API in a future release, a follow-up piece
should:

1. Register a hook scoped to `TEAM_ROOT/.squad/**` that invokes `squad sync --push --quiet`.
2. Write a test asserting the registration call produces the expected hook file.
3. Update this decision document and remove the TODO stub.

---

# Decision: Recursion-guard hook tests must assert invocation absence, not exit code

**Date:** 2026-06-06

## Context

Piece-34 review (commit `b0045b27`) identified that the recursion-guard fixture for post-commit hooks
(test A3 in `test/cli/install-hooks.test.ts`) asserts `exit 0` when the hook body is run with
`SQUAD_SYNC_ACTIVE=1`. This assertion does not distinguish between "guard fired — `squad sync` was
skipped" and "guard absent — `squad sync` was invoked but the script still exited 0 because
`unset SQUAD_SYNC_ACTIVE` (the last command) always exits 0."

## Finding

The kill-list criterion for recursion-guard tests is: *a test that would fail if the guard were
removed.* An exit-code assertion on a script that ends with `unset VARIABLE` does not meet this
criterion — the script exits 0 regardless of whether `squad sync` was invoked.

## Standard (binding for all future hook tests)

Any test that claims to verify a recursion guard **MUST** detect whether the guarded command was
invoked, not merely whether the script exited 0. Acceptable approaches:

1. **Sentinel binary on PATH:** Place a fake `squad` executable in a temp dir prepended to `PATH`.
   The fake script exits non-zero (or creates a marker file). Assert that the marker is absent
   (or the hook exits non-zero) when the guard fires.

2. **Marker file approach:** Same as above but the fake `squad` writes a sentinel file. Assert
   the sentinel does NOT exist after running with `SQUAD_SYNC_ACTIVE=1`.

3. **Stderr check:** Assert that process stderr contains no output referencing `squad sync`
   (only valid if the real guard path produces no stderr).

A test that only checks `result.status === 0` while the hook body contains any cleanup command
after the guarded invocation (e.g., `unset`, `trap`, `exec`) is INSUFFICIENT.

## Impact

- Current A3 in `test/cli/install-hooks.test.ts` (commit `b0045b27`) fails this standard. A
  revision by a different agent (reviewer-rejection lockout applies) must replace the exit-code
  assertion with an invocation-detection assertion.
- All future post-commit hook templates that contain cleanup steps after the guarded command
  must be tested with an invocation-detecting fixture.

## Ownership

FIDO owns this standard. All future recursion-guard test assertions in hook templates must pass
FIDO's invocation-detection check before receiving approval.

---

# Gate Decision: Piece 34 Constraint-Compliance (Flight)

**Date:** 2026-06-06  
**Commit under review:** `b0045b27` + FIDO's uncommitted A3 fix (`test/cli/install-hooks.test.ts`)  
**Branch:** `squad/piece-34-client-side-publish-triggers`

## Verdict: PASS

All 6 constraint-compliance items cleared. Conditional on coordinator executing fold + restructure steps before push (see directives below).

---

## Per-item results

### 1. Hooks install in docs-repo clone ONLY — PASS

`installCrossRepoHook` accepts an explicit `docsRepoPath` parameter. Two-stage git-repo check: (a) `git rev-parse --git-dir` on `docsRepoPath`; (b) comparison of the resolved git root against `normalisedPathKey(path.resolve(docsRepoPath))` — throws `Error` if the path is inside a repo but not the root. Zero CWD fallback. `ensureHooksForBackend` is not wired to `installCrossRepoHook`. The cross-repo hook install is a cleanly isolated export.

### 2. Recursion guard TEST-ENFORCED — PASS (with FIDO's A3 fix folded)

FIDO's revised A3 uses a sh-function sentinel: a `squad()` function is prepended to the hook body; it shadows any PATH entry and writes a marker file on invocation. Three-case structure:

- Case 1 — `SQUAD_SYNC_ACTIVE=1`: if-block skipped, marker absent. `expect(false)` ✓  
- Case 2 — `SQUAD_SYNC_ACTIVE` unset: if-block runs, squad invoked, marker present. `expect(true)` ✓  
- Case 3 (load-bearing proof) — guard code stripped from hook body, `SQUAD_SYNC_ACTIVE=1` set: squad invoked unconditionally, marker appears. `expect(true)` ✓  

Case 3 proves the test would fail if the guard were absent from the template, because Case 1's `toBe(false)` assertion would find the marker present. The original A3 (exit-code-only) did not have this property. FIDO's fix is correctly load-bearing.

### 3. Registry-first topology preserved — PASS

`runSyncStatus` calls `loadRegistryFromDisk()` first; `teamRoot = path.dirname(entry.path)`. Config.json is exclusively in the fallback branch (`if (!teamRoot)`). Assign wiring uses `path.dirname(entry.path)` from the registry lookup — not config.json. No regression against piece-33 topology. CAPCOM's prior approval stands.

### 4. `--quiet` suppresses stdout only — PASS

All informational stdout is gated behind `if (!quiet) console.log(...)`. All error paths (thrown `Error` objects propagated to cli-entry.ts, plus explicit `console.error` calls) reach stderr regardless of `--quiet`. No stdout leak on error paths found.

### 5. B determination recorded — PASS

`.squad/decisions/inbox/piece-34-B-deferred.md` present with correct functional prose: investigation steps documented, deferred determination stated, follow-up conditions specified. Tone clean — no version/fork/porting language, no author identity.

### 6. REPLAY-PROTOCOL tone — PASS

Changeset, B-deferred doc, and commit message carry zero version/fork/porting/comparison language. "Previous piece" in changeset is a neutral ordering reference. Commit subject and body are purely functional. No author identity in `.squad` files.

---

## Binding ruling: B-doc placement

**Directive:** Remove `.squad/decisions/inbox/piece-34-B-deferred.md` from the pushed product commit. Place it in a separate LOCAL `.squad` commit that is NOT pushed to origin.

**Rationale:** Kickoff step h is explicit: "Keep `.squad` logging commits SEPARATE and LOCAL — origin tip stays the isolated product commit. Push product SHA only." The B-deferred doc is a `.squad/decisions/inbox/` record — a logging artifact by definition. The KILL-LIST's "recorded before commit" requirement is satisfied by the local `.squad` commit existing on the branch immediately after the product commit; the record does not need to be inside the product commit itself.

**Final pushed product commit must contain exactly these 8 files:**

1. `.changeset/client-side-publish-triggers.md`
2. `packages/squad-cli/src/cli-entry.ts`
3. `packages/squad-cli/src/cli/commands/install-hooks.ts`
4. `packages/squad-cli/src/cli/commands/sync.ts`
5. `packages/squad-cli/src/commands/assign.ts`
6. `test/cli/assign.test.ts`
7. `test/cli/install-hooks.test.ts`
8. `test/cli/sync-command.test.ts`

---

## Coordinator push clearance

**(a) Fold FIDO's A3 fix into product commit** — CLEARED. The fix (`test/cli/install-hooks.test.ts` sentinel + three-case recursion-guard proof) addresses the prior FIDO rejection. Fold via `git add test/cli/install-hooks.test.ts && git commit --amend --no-edit` (or equivalent rebase) before restructuring.

**(b) Restructure per B-doc ruling** — REQUIRED. Amend the product commit to exclude `.squad/decisions/inbox/piece-34-B-deferred.md`. Immediately after, create a separate local `.squad` commit (not pushed) containing that file. Verify the amended product commit contains exactly the 8 files above.

**(c) Revert working-tree build/version noise** — CLEARED. Revert `package-lock.json`, root/package-level `package.json` version stamps, `.github/agents/squad.agent.md`, `test-fixtures/*/.gitignore`, `.squad/commit-msg.txt` before staging product files.

**(d) Force-push restructured product SHA only, no PR** — CLEARED. `git push -f origin <amended-product-sha>:squad/piece-34-client-side-publish-triggers`. Do NOT open a PR.

---

# Decision: Piece 34 SDK Contract Review — APPROVE

**Date:** 2026-06-06

## Summary

CAPCOM performed adversarial SDK contract review of commit `b0045b27`
(client-side publish triggers, sub-proposals A, B-deferred, C). All four
contract checks passed. No disqualifying defects found.

## Findings

### 1. Registry-first resolution

Both `runSync` and `runSyncStatus` resolve `teamRoot` exclusively from the
registry (`loadRegistryFromDisk` + `normalisedPathKey` + `entry.path`
→ `path.dirname(entry.path)`). config.json is accessed only in the `else`
branch (no registry match). The kill-list constraint — no regression to
config.json-primary — is met.

### 2. `installCrossRepoHook` signature and call-site

Exported signature `installCrossRepoHook(docsRepoPath, options?)` matches the
spec contract. The warm-path call-site derives `docsRepoPath = path.dirname(entry.path)`
from the registry entry — registry-resolved, not from config.json. Failure
degrades to `warnings.push(...)`, not throw. The `_installCrossRepoHookFn`
injectable seam is `@internal`, optional, and defaults to the real implementation
at `opts._installCrossRepoHookFn ?? installCrossRepoHook`. Pattern matches
`_writeRegistryFn` from piece 32.

### 3. HookPipeline non-conflation

`packages/squad-sdk/src/hooks/index.ts` (`HookPipeline`) is not referenced in
any changed file. Sub-proposal B is cleanly deferred: `// TODO(piece-34-B)`
stub in `install-hooks.ts`, decision record in
`.squad/decisions/inbox/piece-34-B-deferred.md`, skip-annotated test stub
in `install-hooks.test.ts`. No HookPipeline wired as stand-in.

### 4. `.last-publish` write points

Written after `publishTeamRootToInbox` resolves (cross-repo) and after
`syncPush` returns (single-repo). Best-effort wrapper prevents aborting a
successful sync. `.squad/.last-publish` added to `PUBLISH_ALLOWLIST_EXACT`.
Piece-33 push contract undisturbed.

## Verdict

**APPROVE** — no changes requested.

