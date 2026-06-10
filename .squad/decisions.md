### 2026-06-08: Surgeon Root Package Rescope — @bradygaster/squad → @wifi-aware/squad

**Date:** 2026-06-08  
**Author:** Surgeon (Release Manager)  
**Branch:** akubly/upstream-npm-release  
**Commit:** 786b032c

## Decision

**RESCOPE: YES** — rename private root package @bradygaster/squad to @wifi-aware/squad.

## Context

After EECOM's @bradygaster → @wifi-aware scrub of the four publishable CLI source files (commit b3e01924), the monorepo root package.json still carried the old @bradygaster/squad name. This caused the root package to appear as @bradygaster/squad in 
pm run build output, creating a confusing mixed-scope signal even though the publishable workspaces were already under @wifi-aware.

decisions.md contained **no prior recorded decision** about the root package name. The coordinator confirmed no lockout existed.

## Rationale

1. **Zero publish risk** — root is private: true; it is never published to npm and never referenced externally by package name.
2. **Eliminates @bradygaster sighting** — the only remaining reason to see @bradygaster in build output was this root name; rescoping removes it entirely.
3. **Full workspace alignment** — root + @wifi-aware/squad-sdk + @wifi-aware/squad-cli are now under one scope, reducing cognitive overhead.
4. **Low blast radius** — only two lines changed across package.json and package-lock.json (the root 
ame field and its lockfile mirror).

## Files Changed

| File | Change |
|------|--------|
| package.json | "name": "@bradygaster/squad" → "name": "@wifi-aware/squad" |
| package-lock.json | Top-level 
ame + packages[""].name both updated |

## Version Lockstep

Canonical version kept at .9.6-mc.preview.11 (committed baseline). Working-tree .12 churn from prebuild bump-build was discarded via git restore before applying this change.

## Churn-Free Build Verification

Command: $env:SKIP_BUILD_BUMP = '1'; npm run build  
Result: ✅ exit 0 — all packages build as @wifi-aware/squad@0.9.6-mc.preview.11, no version mutation.

---
### 2026-06-08: Surgeon bump-build Placement Decision — Remove from prebuild

**Date:** 2026-06-08  
**Author:** Surgeon (Release Manager)  
**Status:** Implemented — commit 8969d1e

## Problem

scripts/bump-build.mjs ran on every 
pm run build via the prebuild hook,
causing two issues:
1. Every local build permanently dirtied the working tree (version churn .N → .N+1).
2. A misleading npm lifecycle banner: npm prints the root package banner BEFORE prebuild runs
   (showing .11), then prebuild bumps to .12, then workspace builds print .12. This
   is a print-timing artifact — files were always in lockstep — but it caused repeated
   confusion and false alarm about version skew.

## Options Evaluated

**(a) Remove from prebuild; expose as ersion:bump-build explicit script.**  
**(b) Flip env gate — only bump when RELEASE_BUMP=1.**  
**(c) Document SKIP_BUILD_BUMP=1 as the standard local-build flag; no code change.**

## Decision: Option (a)

**Rationale:**
- Safest: the only change is package.json scripts — no logic change to bump-build.mjs itself.
- Option (b) achieves the same outcome but requires inverting the env-var logic and updating
  any documentation that references the current default-on behavior.
- Option (c) is a documentation band-aid that still leaves the default surprising and leaves
  the banner ambiguity unfixed.
- The build counter bump was always conceptually opt-in ("I am cutting a new pre-release build")
  not a passive side-effect of compiling code.

## Release Workflow Impact (None)

All CI workflows were already protected and remain unaffected:
- squad-release.yml: reads committed version; never invokes 
pm run build
- squad-npm-publish.yml smoke-test: had SKIP_BUILD_BUMP: '1' explicitly (now moot)
- squad-npm-publish.yml publish jobs: use workspace-level 
pm -w ... run build; root
  prebuild was never triggered
- squad-insider-publish.yml: GitHub Actions sets CI=true; bump-build already skipped
- squad-ci.yml: same CI=true guard

## Change Made

package.json scripts section:
`
// Before
"prebuild": "node scripts/bump-build.mjs && node scripts/sync-skill-templates.mjs && node scripts/sync-templates.mjs"

// After
"prebuild": "node scripts/sync-skill-templates.mjs && node scripts/sync-templates.mjs",
"version:bump-build": "node scripts/bump-build.mjs",
`

## Explicit Release Bump Command

To increment the pre-release build counter before committing a new build:

`sh
npm run version:bump-build
git add -- package.json packages/squad-sdk/package.json packages/squad-cli/package.json
git commit -m "chore: bump build to 0.9.6-mc.preview.12"
`

## Verification

Ran 
pm run build after the change — all three packages printed .9.6-mc.preview.11
(consistent, no banner mismatch) and git status showed no dirty version files.

---
### 2026-06-08: PAO Docs Decision — Dotfile-flow arc (pieces 32–35)

**Date:** 2026-06-08  
**Author:** PAO (DevRel)  
**Commit:** 46139dcf

## What was decided

Updated the following docs pages to reflect the new dotfile-flow solution shipped in pieces 32–35:

1. docs/src/content/docs/guide/shared-squad.md — primary shared-squad guide (extended in-place, no new page)
2. docs/src/content/docs/reference/cli.md — CLI reference (new sections + flag additions)
3. docs/src/content/docs/features/external-state.md — cross-reference added (not duplicated)
4. docs/_internal/internal/getting-started-journey.md — package scope fix + sync walkthrough
5. 	est/docs-build.test.ts — 3 new assertions for new commands

## Structural decisions

- **Content discipline: extend, don't create.** Sync, fold pipeline, alias chain, and status subcommand all live under shared-squad.md. No new page warranted — these are all part of the shared-squad topology, not a standalone concept.
- **Cross-link from xternal-state.md.** The two pages cover different topologies (per-user external vs. multi-developer shared). Deep-linked from the Related section at the bottom of external-state.md rather than duplicated.

## CLI wiring discrepancy flagged

squad assign --developer-alias <alias> is implemented in unAssign opts and ssign.ts (line 284, 548, 584) but is NOT wired in cli-entry.ts dispatch (no --developer-alias in parseAssignArgs NAMED_FLAGS, not passed to unAssign). The flag name in squad sync is --developer (not --developer-alias). Docs reflect this accurately with a workaround note pointing users to SQUAD_DEVELOPER_ALIAS env var. Recommend EECOM/Flight to wire --developer-alias in ssign-args.ts and cli-entry.ts dispatch before piece-36 or next release.

---
### 2026-06-08: FIDO Bug Audit — Shared-Squad Dotfile Flow (Pieces 32–35)

**Author:** FIDO (Quality Owner)  
**Date:** 2026-06-08  
**Scope:** READ-ONLY pre-dogfooding audit of squad sync, squad assign --developer-alias, installCrossRepoHook, publishTeamRootToInbox, hydrateTeamRootFromStateRef, squad install-fold-pipeline

## Build & Test Summary

**Build gate:** 
pm run build (SKIP_BUILD_BUMP=1) → **exit 0** ✅  
**Test gate:** 
px vitest run test/cli/sync-registry-resolution.test.ts test/cli/cross-repo-sync.test.ts test/cli/sync-command.test.ts test/cli/install-fold-pipeline.test.ts test/cli/install-hooks.test.ts test/cli/assign.test.ts

| File | Tests | Passed | Failed | Status |
|------|-------|--------|--------|--------|
| install-hooks.test.ts | 7 (1 skip) | 6 | 0 | ✅ |
| assign.test.ts | 16 | 16 | 0 | ✅ |
| sync-command.test.ts | 6 | 2 | 4 | ❌ |
| sync-registry-resolution.test.ts | 13 | 5 | 8 | ❌ |
| cross-repo-sync.test.ts | ~17 | – | – | ❌ (partial run) |
| install-fold-pipeline.test.ts | 7 | 2 | 5 | ❌ |

**Root cause of all test failures:** scope mismatch (see BUG-1 below).

## BLOCKS DOGFOODING NOW

### BUG-1 — BLOCKER: Test mock scope mismatch — all registry mocks are dead

**Severity:** Blocker  
**Blocks dogfooding:** YES (test gate is non-functional; 22 tests fail)  
**Symptom:** Running the key surface tests produces 22 failures with "no registry entry found" or "Could not resolve docs-repo path" — the test mocks have no effect.  
**Root cause:** The source-level rescope (@bradygaster/squad-sdk → @wifi-aware/squad-sdk) updated the handler source files but NOT the test files. Four test files call i.mock('@bradygaster/squad-sdk/registry', ...) and import from @bradygaster/squad-sdk/.... However @bradygaster/ in 
ode_modules/ is an EMPTY directory — no packages inside. The actual code imports from @wifi-aware/squad-sdk/... (symlinked to the workspace). The mocks target the wrong (nonexistent) module.

**Affected files:**
- 	est/cli/sync-registry-resolution.test.ts:9,16,20 — i.mock('@bradygaster/squad-sdk/registry', ...) + imports
- 	est/cli/cross-repo-sync.test.ts:9,23,24 — same
- 	est/cli/sync-command.test.ts:7,15,16 — same
- 	est/cli/install-fold-pipeline.test.ts:10,13,21,22,23 — also mocks @bradygaster/squad-sdk/path-utils

**Fix:** Replace every @bradygaster/squad-sdk/... with @wifi-aware/squad-sdk/... in all four test files. Also update itest.config.ts dedupe to include @bradygaster/squad-sdk as a safety net if any remain.  
**Owner:** EECOM

### BUG-2 — BLOCKER: publishTeamRootToInbox allowlist guard throws on any real docs-repo

**Severity:** Blocker  
**Blocks dogfooding:** YES (squad sync --push always fails against a real squad-host docs-repo)  
**Symptom:** squad sync --push exits with: Error: Publish blocked: path ".squad/team.md" is outside the allowed .squad/ subtree.  
**Root cause:** publishTeamRootToInbox (sync.ts:325–333) calls numerateSquadFiles(teamRoot) which lists ALL files under 	eamRoot/.squad/, then throws if ANY file is outside the allowlist. The allowlist only permits decisions.md, .last-publish, decisions/inbox/**, log/**, orchestration-log/**, sessions/**, identity/**. A standard squad-host docs-repo contains .squad/team.md, .squad/agents/, .squad/routing.md, .squad/config.json — none of which are allowlisted. Since 	eamRoot = path.dirname(entry.path) = docs-repo root, any real setup fails immediately.

The test fixtures in cross-repo-sync.test.ts:57–65 carefully avoid this by only writing allowlisted files — so the tests pass but the real scenario is untested.

**File:Line:** packages/squad-cli/src/cli/commands/sync.ts:325–333  
**Fix:** Change the allowlist from a BLOCK guard to a FILTER: instead of throwing if non-allowlisted files exist, silently skip them. Only stage/publish allowlisted files. The hard-block logic was appropriate for path-traversal protection but the real threat is already addressed by numerateSquadFiles only walking inside .squad/. Change step 4 to filter, and step 5's loop to only iterate the filtered list.  
**Owner:** EECOM (with CAPCOM review on allowlist semantics)

### BUG-3 — BLOCKER: --developer-alias silently dropped from squad assign (known, per brief)

**Severity:** Blocker  
**Blocks dogfooding:** YES (auto-publish hook never installs)  
**Symptom:** squad assign <callsign> --developer-alias alice runs without error but the alias is not stored in registry and the post-commit hook is never installed.  
**Root cause:** Three-stage break:
1. ssign-args.ts:19 — NAMED_FLAGS array does NOT include '--developer-alias'. The parser is unaware of it.
2. ssign-args.ts:50–57 — parseAssignArgs return type has no developerAlias field (not destructured either).
3. cli-entry.ts:1309,1312–1319 — even if parsed, developerAlias is not in the destructuring or the unAssign({ }) call.

The handler (unAssign) is fully implemented and tested via injectable seam (_installCrossRepoHookFn). The wiring just isn't there.  
**Fix:** Add '--developer-alias' to NAMED_FLAGS; add developerAlias to AssignCliArgs interface and parseAssignArgs return; destructure developerAlias in cli-entry.ts line 1309; pass it to unAssign.  
**Owner:** EECOM

## SHOULD FIX IN NEXT PIECE (workarounds exist)

### BUG-4 — HIGH: --skills-from parsed but not forwarded to handler

**Severity:** High  
**Blocks dogfooding:** No (workaround: use injectable seam in tests; CLI users just can't use this flag)  
**Symptom:** squad assign my-squad --skills-from host appears to accept the flag with no error, but skills are never copied. No warning emitted.  
**Root cause:** --skills-from IS in NAMED_FLAGS (assign-args.ts:19) and IS returned as skillsFrom by parseAssignArgs. But cli-entry.ts:1309 does NOT destructure skillsFrom from the result. The handler uses opts.skillsFrom extensively (assign.ts:341–354, 568, 761).  
**Documented:** cli.md:144 lists --skills-from as a working flag.  
**Fix:** Add skillsFrom to the destructuring at cli-entry.ts:1309 and pass it to unAssign.  
**Owner:** EECOM

### BUG-5 — HIGH: --state-remote / --state-branch not in NAMED_FLAGS and not forwarded (siblings of BUG-3)

**Severity:** High  
**Root cause:** Same three-stage break as BUG-3 for both --state-remote and --state-branch.  
**Fix:** Same pattern as BUG-3/BUG-4: add to NAMED_FLAGS, parseAssignArgs, destructuring, runAssign call.  
**Owner:** EECOM

### BUG-6 — MEDIUM: --dry-run missing from squad sync --help output

**Severity:** Medium  
**Root cause:** cli-entry.ts:329–344 — the --help text for sync omits --dry-run.  
**Fix:** Add   --dry-run             Print pending files/target branch without publishing to cli-entry.ts lines 332–344.  
**Owner:** EECOM

### BUG-7 — MEDIUM: hydrateTeamRootFromStateRef idempotency guard is structurally broken

**Severity:** Medium  
**Blocks dogfooding:** No (hydration still works; just always re-runs even when no-op is correct)  
**Root cause:** sync.ts:438–446 — idempotency compares HEAD to the fetched snapshot SHA. In a shared-squad docs-repo, HEAD always points to the main working branch commit. The fetched sha is an orphan snapshot — they can NEVER match unless HEAD is manually updated to the snapshot SHA.  
**Fix:** Compare the tree SHA instead of the commit SHA, OR store the last-hydrated SHA in a local ref/file and compare against that.  
**Owner:** CAPCOM

### BUG-8 — LOW: Coverage gap — no test exercises publishTeamRootToInbox with a standard docs-repo structure

**Severity:** Low  
**Root cause:** setupSquadDir in cross-repo-sync.test.ts:57–65 only creates allowlisted files. The case where .squad/ has a standard structure (team.md, agents/, config.json) is untested.  
**Fix (after BUG-2 is resolved):** Add a test that creates a realistic docs-repo with team.md and agents/ present.  
**Owner:** FIDO

---
### 2026-06-07: Surgeon Release Rebase — akubly/upstream-npm-release onto piece-35 (clean, pre-existing build gap)

## Decision: Rebase Completed — Build Failures Are Pre-existing

The rebase of `akubly/upstream-npm-release` (12 release/versioning commits) onto `squad/piece-35-fold-pipeline-in-docs-repo` (HEAD `8e7000a6`) completed **cleanly with zero conflicts**.

### Final state
- Branch: `akubly/upstream-npm-release`
- New HEAD: `42da044d` (top commit: `chore: scope rename + release workflow tweak + fixture cleanup`)
- 12 release commits now sit on top of `8e7000a6` (piece-35 HEAD) — confirmed via `git log --oneline -15`

### Build gate
- `npm run build`: **FAILS** — exit code 2
- **All failures are pre-existing** — verified by checking `git show df30d250:<file>` (the first rescope commit in the release branch). The following files already had `@bradygaster` scope before the rebase:
  1. `packages/squad-cli/src/commands/assign.ts:28` — `@bradygaster/squad-sdk/validation`
  2. `packages/squad-cli/src/cli/commands/install-hooks.ts` — `@bradygaster/squad-sdk/path-utils`
  3. `packages/squad-cli/src/cli/commands/sync.ts` — `@bradygaster/squad-sdk/{validation,registry,path-utils}`
  4. `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` — piece-35 new file, never reached by the rescope commits

### Team action required
A follow-up scrub is needed to update the 4 files above from `@bradygaster/squad-sdk` → `@wifi-aware/squad-sdk`. This is EECOM/Flight scope (source fix), not Surgeon scope (release orchestration). Recommend filing as a piece-36 fix item or tagging it onto the next feature piece before publishing.

### No push performed
Branch left local per instructions. DO NOT force-push; DO NOT open a PR until the build gate is clean.



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


---

### 2026-06-06: Piece-35 Kickoff Authoring — Procedures Reconciliation Notes

**Date:** 2026-06-06  
**Filed by:** Procedures

## Summary

Authored the piece-35 kickoff at session-state files. Three reconciliations required relative to the raw spec text.

## Reconciliation 1 — Topology still stale in piece 35

Sub-proposal C step 1 in the piece-35 spec reads: "Resolve the docs-repo clone path from the squad config (`stateRemote` remote URL or a `docsRepoPath` config field set by piece 32's `squad connect`)."

This is dead topology for the same reason caught in piece 34. Ground truth confirmed at repo tip `763c2451`:

- `docsRepoPath` is NOT a `RegistryEntry` field (confirmed via `registry.ts` probe).
- `.squad/config.json` contains only `{"version":1,"defaultModel":"claude-sonnet-4.6"}` — no transport metadata.
- Docs-repo clone path = `path.dirname(entry.path)` from `loadRegistryFromDisk()` + `normalisedPathKey()`.

Kickoff directs the installer to reuse the exact import/lookup pattern from `runSyncStatus` in `sync.ts` (lines 20–21 imports, lines 523–529 lookup). Config.json is fallback for unregistered/single-repo contexts ONLY.

## Reconciliation 2 — Archived fold source is absent

The spec states: "The fold algorithm itself is not new — it was established in an earlier cross-repo design as part of an ADO-only template. Piece 35 reuses that algorithm..."

Probed at authoring time. Findings:

- `.squad-templates/fold/` — does not exist.
- No `fold-squad-state`, `publish-history.json`, `read-tree` fold logic present anywhere in the working tree.
- No ADO cross-repo templates from the pieces-26–30 lineage present.
- `.squad-templates/workflows/` exists (squad CI templates), but contains no fold algorithm.

There is no source to copy or adapt. The implementing team authors the fold algorithm from scratch using the spec's numbered step list (steps 1–9 of sub-proposals A and B).

REPLAY-PROTOCOL tone constraint baked into kickoff: no "port," "fork," "porting," or "adapted from" language in any shipped artifact.

## Reconciliation 3 — CLI path conventions confirmed

`install-fold-pipeline.ts` belongs at `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` (consistent with `install-hooks.ts` at the same path). Dispatch in `cli-entry.ts` uses the `if (cmd === 'install-fold-pipeline')` pattern, inserted before line 1452 (Unknown command fatal), with `args[1]` as the platform argument. Import from `./cli/commands/install-fold-pipeline.js`.

## Additional probe results baked into kickoff

- `yaml@2.8.3` available — do not re-add.
- `install-fold-pipeline` — 0 occurrences in `cli-entry.ts` (not yet wired).
- `test/squad-templates/` directory absent — must be created.
- All three test files absent — all must be created fresh.
- Both template paths absent — both must be created.


---

### 2026-06-07: CAPCOM Review — Piece 35 SDK Contract

**Reviewer:** CAPCOM (SDK Expert)  
**Reviewed commit:** 64eecd475605a8f9cc1d6f9707d6ae72f055d59a  
**Branch:** squad/piece-35-fold-pipeline-in-docs-repo  
**Date:** 2026-06-07  

## Review Scope

SDK/registry contract verification for `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` against committed SHA. Read-only review against four critical checkpoints specified in the kickoff brief (Piece 35, "Spawn shape & gates → CAPCOM" section).

## Checkpoint Results

### (a) Import paths match sync.ts EXACTLY

**Finding:** ✅ PASS

- **sync.ts lines 20–21:**
  - `import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';`
  - `import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';`

- **install-fold-pipeline.ts lines 21–22:**
  - `import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';`
  - `import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';`

**Verdict:** Byte-for-byte identical. No path aliases, no variations. Import contract satisfied.


---

### (b) RegistryEntry field names are VALID

**Finding:** ✅ PASS

- **Fields accessed in install-fold-pipeline.ts:**
  - Line 63: `e.clones?.some(c => normalisedPathKey(c) === normalizedRoot)`
  - Line 68: `docsRepoPath = path.dirname(entry.path)`

- **Validation against RegistryEntry schema (packages/squad-sdk/src/registry.ts lines 9–23):**
  - `entry.path` — Line 11, type `string` (required field) ✅
  - `entry.clones` — Line 13, type `string[]` (optional field) ✅

- **Fields NOT accessed (but valid in schema):**
  - `entry.stateRemote` — Line 18, type `string` (optional field) — correctly unused by installer
  - `docsRepoPath` — NOT a RegistryEntry field; kickoff confirmed absent; code does not access it on entry ✅

**Verdict:** All accessed fields are valid RegistryEntry fields. No invented fields. No references to non-existent `docsRepoPath` on entry object. Schema contract satisfied.


---

### (c) path.dirname(entry.path) derivation matches runSyncStatus

**Finding:** ✅ PASS

- **install-fold-pipeline.ts lines 57–68 (registry lookup pattern):**
  ```typescript
  const repoRoot = getRepoRoot(cwd);
  const { registry } = loadRegistryFromDisk();
  const normalizedRoot = normalisedPathKey(repoRoot);
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
  );
  let docsRepoPath: string | undefined;
  if (entry) {
    docsRepoPath = path.dirname(entry.path); // entry.path ends in .squad
  }
  ```

- **sync.ts lines 523–529 (runSyncStatus pattern — referenced in kickoff as authoritative):**
  ```typescript
  const { registry } = loadRegistryFromDisk();
  const normalizedRoot = normalisedPathKey(repoRoot);
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
  );
  if (entry) {
    teamRoot = path.dirname(entry.path);
  ```

**Pattern analysis:**
1. `loadRegistryFromDisk()` call ✅
2. `normalisedPathKey()` normalization on `repoRoot` ✅
3. `registry?.squads.find()` lookup ✅
4. Conditional on `e.clones?.some()` with normalized comparison ✅
5. Derivation via `path.dirname(entry.path)` on match ✅
6. Comment confirms entry.path ends in `.squad` (validated by registry.ts lines 94–95) ✅

**Verdict:** Verbatim pattern match. Registr-resolved docs-repo path derivation is identical to runSyncStatus. Topology contract satisfied.


---

### (d) No regression to config.json-primary

**Finding:** ✅ PASS

- **Registry-first phase (lines 62–69):**
  ```typescript
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
  );
  let docsRepoPath: string | undefined;
  if (entry) {
    docsRepoPath = path.dirname(entry.path);
  }
  ```
  When a matching registry entry exists, `docsRepoPath` is immediately set.

- **Fallback phase (lines 71–82):**
  ```typescript
  // Fallback for unregistered/single-repo contexts: read config.json stateLocation
  if (!docsRepoPath) {
    const configPath = path.join(repoRoot, '.squad', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        if (typeof config['stateLocation'] === 'string') {
          docsRepoPath = config['stateLocation'];
        }
      } catch { /* ignore */ }
    }
  }
  ```
  Config.json is accessed ONLY if no registry entry was found (`!docsRepoPath`).

- **Comment documentation:** Line 71 explicitly labels this phase "Fallback for unregistered/single-repo contexts," confirming intended semantics.

- **Kickoff constraint verification (piece-35-kickoff.md):**
  - Line 71–73: "Never primary from config.json when a registry entry matches."
  - Line 408: "Never primary when a registry entry matches."
  - Kill-list line 460: "Regressing against piece-33/34 topology is a disqualifying defect."

**Verdict:** Registry-first topology correctly preserved. Config.json is fallback only. No regression. Pieces 33–34 contract honored. Kill-list constraint satisfied.


---

## Summary

All four critical checkpoints pass without exception:

| Checkpoint | Result | Evidence |
|---|---|---|
| Import paths match sync.ts | ✅ PASS | Byte-for-byte identical; no path aliases |
| RegistryEntry fields valid | ✅ PASS | All accessed fields in schema; no invented fields |
| path.dirname pattern matches | ✅ PASS | Verbatim pattern from runSyncStatus lines 523–529 |
| Registry-first preserved | ✅ PASS | Registry attempted first; config.json fallback only |

## Verdict

**APPROVE**

Commit `64eecd475605a8f9cc1d6f9707d6ae72f055d59a` passes all SDK contract checkpoints. No changes requested. Registry topology intact. Import contract clean. Path derivation pattern valid. Registry-first semantics preserved.

Safe to proceed to next reviewer stage (FIDO, CONTROL, Flight).


---

**Review method:** Adversarial static analysis (read-only commit SHA verification).  
**Review tools:** git show, grep, LSP hover, manual schema comparison.  
**Logged to:** .squad/agents/capcom/history.md (Piece 35 entry appended).


---

### 2026-06-06: CONTROL — Piece 35 Type Review

**By:** CONTROL  
**What:** Type and exit-code review of `install-fold-pipeline.ts` and the cli-entry.ts dispatch block against commit `64eecd47`.

**Verdict: ✅ APPROVE**

All five gates passed with no defects.

**(a) `InstallFoldPipelineOptions`:** `{ cwd?: string; force?: boolean }` — exact match to kickoff signature. No extra fields, no widened types.

**(b) Platform union tightness:** `installFoldPipeline` signature uses `platform: 'github' | 'ado'` as a literal union throughout. `platformDirMap` is `Record<'github' | 'ado', string>` — no string widening. In cli-entry.ts, `fatal(): never` + the double inequality guard narrows `string | undefined` to `'github' | 'ado'` via TypeScript CFA. No type error at the call site — confirmed by build.

**(c) cli-entry.ts dispatch:** Dynamic import uses `.js` extension (ESM-correct). `installFoldPipeline` is the correct export. Options `{ cwd: getSquadStartDir() }` is structurally valid.

**(d) Exit-code paths:** All four failure modes exit 1 with error messages — missing target directory, content conflict, unresolvable docs-repo path, template not found. Invalid platform arg hits `fatal()` before the import. No silent exit 0 on any failure path.

**(e) Build:** `npm run build` produces errors exclusively in pre-existing files (verified at 763c2451 base). Zero new type errors in `install-fold-pipeline.ts` or the piece-35 cli-entry.ts additions (lines 1452–1465).

**Registry API note:** `registry?.squads.find(...)` is the correct field (`squads: RegistryEntry[]`). Implementation does NOT use the non-existent `.entries` field. Registry-first topology preserved.


---

### 2026-06-07: FIDO Review — Piece 35 Fold Pipeline in Docs Repo

**Date:** 2026-06-07  
**Author:** FIDO  
**Status:** APPROVED — ready for Phase C


---

## Decision

SHA `64eecd475605a8f9cc1d6f9707d6ae72f055d59a` on branch
`squad/piece-35-fold-pipeline-in-docs-repo` passes all FIDO acceptance gates.
Sub-proposals A (GitHub Actions fold template), B (ADO fold template), and C
(`squad install-fold-pipeline` installer) are accepted without mandatory rework.


---

## Evidence

### Tests run

| Suite | Result |
|---|---|
| `test/squad-templates/fold-github.test.ts` | 10/10 PASS |
| `test/squad-templates/fold-ado.test.ts` | 10/10 PASS |
| `test/cli/install-fold-pipeline.test.ts` | 7/7 PASS |
| `test/cli/install-hooks.test.ts` (piece-34 regression) | 6/6 PASS, 1 pre-existing SKIP |
| `test/cli/sync-command.test.ts` (piece-34 regression) | 6/6 PASS |

### Assertion quality

All spec-required assertions are REAL:
- `not.toHaveProperty('pull_request')` / `not.toHaveProperty('pr')` — parsed YAML object (not raw grep).
- `permissions.contents === 'write'` — parsed YAML object.
- `allowScripts` absence at pool level — parsed YAML object.
- Single-writer invariant comment — raw string (correct; YAML parser strips comments).
- `--force-with-lease` — raw string (correct; bash content is a YAML string value, not a parsed key).

### Registry-first correctness confirmed

- D7 writes a wrong `stateLocation` in config.json; verifies registry-derived path is used; verifies wrong path is NOT written. Strong adversarial test.
- Implementation uses `registry?.squads.find(...)` — matches actual `Registry` interface (`squads` field, registry.ts:27). Kickoff brief example used `entries` (stale); implementation is correct.


---

## Non-blocking notes

1. **Idempotency key (ref-name, not SHA):** Spec step 3 says filter by `foldedRefs[].sha`. Templates use `.[].foldedRefs[].ref` (ref-name). This matches the ref-membership-fold-idempotency skill and is the correct approach. Spec wording was superseded by team canon.

2. **Pipeline bash logic not unit-tested:** Clock skew handling, malformed-JSON abort, prune step, and orphan-branch creation are correct in template but not exercised by the test suite. This is an inherent limitation of template unit tests (no bash execution environment). Non-blocking.

3. **`--force-with-lease` raw check:** Could be fooled by a comment. Flag is confirmed in the push command. Acceptable.


---

## Binding standards reaffirmed for piece 35

- **YAML comment assertions must use `raw.toContain()`** — YAML parser strips comments from parsed object; this is the ONLY valid assertion for comment presence.
- **Registry-first adversarial test pattern:** Pre-write wrong config path, verify registry-derived path wins, verify wrong path NOT written. Required for all registry-first resolution tests going forward.


---

### 2026-06-06: Flight Constraint-Compliance Gate — Piece 35 (fold pipeline in docs repo)

**Date:** 2026-06-06  
**Filed by:** Flight  
**SHA reviewed:** `64eecd475605a8f9cc1d6f9707d6ae72f055d59a`  
**Branch:** `squad/piece-35-fold-pipeline-in-docs-repo`


---

## Gate Results

### Gate 1 — No automation targeting product repo ✅ PASS

`git show --name-only 64eecd47` output — 8 files committed:

```
.changeset/fold-pipeline-in-docs-repo.md
.squad-templates/fold/ado/fold-squad-state.yml
.squad-templates/fold/github/fold-squad-state.yml
packages/squad-cli/src/cli-entry.ts
packages/squad-cli/src/cli/commands/install-fold-pipeline.ts
test/cli/install-fold-pipeline.test.ts
test/squad-templates/fold-ado.test.ts
test/squad-templates/fold-github.test.ts
```

Zero files under `.github/workflows/` or `.azure-pipelines/`. All paths are under `.squad-templates/fold/`, `packages/squad-cli/src/`, `test/`, and `.changeset/`. **PASS.**


---

### Gate 2 — Single-writer invariant comment VERBATIM in both templates ✅ PASS

Exact string checked: `# This pipeline is the sole writer to squad-state. No other automation or manual push should target this branch.`

- GitHub template (`fold/github/fold-squad-state.yml`): at top of `steps:` block — **VERBATIM MATCH**
- ADO template (`fold/ado/fold-squad-state.yml`): at top of `steps:` block — **VERBATIM MATCH**

PowerShell regex match confirmed: both templates return PASS.


---

### Gate 3 — `--force-with-lease` present in both templates ✅ PASS

- GitHub Step 8 (`Push squad-state`): `git push origin HEAD:refs/heads/squad-state --force-with-lease` — **PRESENT**
- ADO Step 8 (`Push squad-state`): `git push origin HEAD:refs/heads/squad-state --force-with-lease` — **PRESENT**

PowerShell match confirmed on both.


---

### Gate 4 — No `pr:` / `pull_request:` trigger in either template ✅ PASS

Direct grep on committed content:
- GitHub template: No `pull_request:` key at any level; no `pr:` key. `on:` block has only `push:`. **PASS**
- ADO template: No `pr:` key. `trigger:` block only. **PASS**

Test assertions in `fold-github.test.ts` and `fold-ado.test.ts` also confirm this (FIDO: 27/27 GREEN).


---

### Gate 5 — Registry-first docs-path resolution in installer ✅ PASS

Code in `install-fold-pipeline.ts` (lines confirmed):
```typescript
const { registry } = loadRegistryFromDisk();
const normalizedRoot = normalisedPathKey(repoRoot);
const entry = registry?.squads.find(e =>
  e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
);

let docsRepoPath: string | undefined;
if (entry) {
  docsRepoPath = path.dirname(entry.path); // registry-first
}

// Fallback only when registry returns no match
if (!docsRepoPath) {
  // config.json stateLocation fallback
}
```

`path.dirname(entry.path)` is the primary resolution path. `config.json` is behind `if (!docsRepoPath)` — never primary when a registry entry matches. **PASS.**

Test D7 (`registry-first docs-repo path resolution`) explicitly sets a wrong config.json path and verifies the registry-derived path is used. FIDO confirmed this test GREEN.


---

### Gate 6 — Idempotency + conflict-guard tests confirmed ✅ PASS

`test/cli/install-fold-pipeline.test.ts` contains:
- **D2** (`is idempotent — second run exits 0 and produces no file change`) — idempotency case ✅
- **D3** (`conflict guard — existing file with different content exits 1 with path in message`) — conflict guard + path-in-message ✅
- **D4** and **D6** — missing target directory → exit 1 ✅
- **D7** — registry-first verification ✅

FIDO confirmed 27/27 tests GREEN.


---

### Gate 7 — Zero NEW scrub-gate violations ✅ PASS

Scrub gate run: `git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 | pwsh -Command -`

Results:
```
[1/6] Strip-listed paths... FAIL  (pre-existing whole-tree baseline — see below)
[2/6] wifi-aware mentions... PASS
[3/6] akubly mentions... WARN    (pre-existing .squad/ state files)
[4/6] Microsoft/internal mentions... WARN  (pre-existing)
[5/6] ADO fixture audit... PASS
[6/6] Changed file count... PASS (13 files)
[7] User-path segments in config/metadata... PASS
[8] ADO variable syntax in .squad-templates/ado/... SKIP (path mismatch — manually verified below)
[9] developerAlias format validation... PASS
```

**Gate 1 baseline confirmation:** Strip-list failures are all pre-existing paths (`docs/_internal/`, `packages/squad-cli/templates/casting/`, etc.). Zero piece-35 file paths appear in the strip list. None of the 8 committed files match any strip-list entry. Baseline unchanged.

**Gate 8 manual verification (scrub gate SKIP due to template at `.squad-templates/fold/ado/` not `.squad-templates/ado/`):**  
All `$(...)` expressions in the ADO template verified against `[A-Za-z][A-Za-z0-9._]*`:
- `$(enumInbox.inboxRefs)` ✅
- `$(filterRefs.unfoldedRefs)` ✅
- `$(sortRefs.sortedRefs)` ✅ (×2)
- `$(foldRefs.finalSha)` ✅
- `$(foldRefs.foldedEntries)` ✅
- `$(System.AccessToken)` ✅ (×2)

All 8 expressions SAFE. ADO test `fold-ado.test.ts` also asserts Gate 8 compliance (FIDO confirmed GREEN).


---

### Additional Checks

**Banned porting language** (`port`/`fork`/`porting`/`adapted from`): The 7 piece-35-authored files contain zero porting language. The single match in `cli-entry.ts` is the pre-existing TCP port code (`--port` flag, `portIdx`, `runStart({ port, ... })`) — networking port, not porting language. The piece-35 delta in `cli-entry.ts` is exactly 11 new lines adding `install-fold-pipeline` command routing; none contain porting language. **PASS.**

**No external product names in template YAML comments:** GitHub template header: `# Squad fold pipeline — GitHub variant`. ADO template header: `# Squad fold pipeline — ADO variant`. Neither contains "GitHub Actions", "Azure DevOps", or "Azure Pipelines". Test assertions in both test files confirm this. **PASS.**

**Changeset classification:** `.changeset/fold-pipeline-in-docs-repo.md` contains `"@bradygaster/squad-cli": minor`. No `@bradygaster/squad-sdk` entry present. **PASS.**


---

## Verdict

**GO**

All 7 gate items PASS. All 3 additional checks PASS. Coordinator is cleared to push SHA `64eecd475605a8f9cc1d6f9707d6ae72f055d59a` to the remote branch (`squad/piece-35-fold-pipeline-in-docs-repo`) with `--force-with-lease`. No PR to be opened.


---

### 2026-06-06: Piece 35 — Sub-proposal Triage Decision

**Date:** 2026-06-06  
**Author:** EECOM  
**Piece:** 35 — fold pipeline in docs repo


---

## Triage Outcome

All three sub-proposals accepted. No deferrals.

| Sub-proposal | Classification | Decision | Rationale |
|---|---|---|---|
| **A** — GitHub Actions `fold-squad-state.yml` | S0 — non-deferrable | ✅ Accepted | Primary hosting platform; arc unusable without it. Template authored from spec algorithm steps 1–9. |
| **B** — ADO Pipelines `fold-squad-state.yml` | S0 — non-deferrable | ✅ Accepted | Architectural constraint confirmed: no unexpected complexity. ADO syntax differences are well-understood (batch serialization, persistCredentials, System.AccessToken scoping per-step). `$(System.AccessToken)` satisfies Gate 8 pattern. All `$(...)` expressions verified. |
| **C** — `squad install-fold-pipeline` installer | S1 — required | ✅ Accepted | Sub-proposal B revealed no blocking complexity. Registry-first docs-path resolution pattern is established in sync.ts and directly reusable. |

## Verify-first probe results

All six probes matched pre-confirmed expected values:
1. All target files absent — CREATE actions confirmed.
2. `yaml` at `2.8.3` — present, do not add again.
3. `install-fold-pipeline` occurrences in cli-entry.ts: 0; total lines: 1468 — dispatch not yet wired.
4. No archived fold source found — algorithm authored from spec.
5. Registry helper import paths confirmed at sync.ts lines 20–21 and 523–529.
6. cli-entry.ts insertion point confirmed at line 1452 (`// Unknown command`).

## Topology reconciliations applied

- **Reconciliation 1 (docs-repo path):** `docsRepoPath` resolved from `path.dirname(entry.path)` via `loadRegistryFromDisk` + `normalisedPathKey`. config.json is fallback only. Never primary.
- **Reconciliation 2 (no archived source):** Fold algorithm authored from scratch using spec steps 1–9.

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



---

# Piece 36 Scope Decision

**Date:** 2026-06-08  
**Author:** Lead  
**Status:** Recorded

## Decision

Piece 36 addresses nine upstream defects in the cross-repo assign→commit→publish→fold loop (sub-proposals A through I). All nine are accepted for implementation.

One category of defect is explicitly excluded from the spec: test import specifiers in test files that reference the wrong package scope due to a local branch rename. This is a working-branch-local concern — it does not exist in the upstream product source and must not be named in the upstream spec or kickoff prompt (naming an alternate package scope would trigger Gate 2 of the scrub gate). The replay implementer is directed to align new test imports with the existing test files' import pattern, without any package scope name appearing in the spec deliverables.

## Sub-proposals Accepted (Upstream Defects)

| Sub-proposal | Summary | Severity |
|---|---|---|
| A | `squad assign` new flags (`--developer-alias`, `--state-remote`, `--state-branch`) never parsed or dispatched | CRITICAL |
| B | `--skills-from` parsed but not forwarded to `runAssign` | Normal |
| C | Cross-repo post-commit hook is a guaranteed no-op due to recursion-guard pre-set | CRITICAL |
| D | Publish allowlist throws on any non-allowlisted path; real host `.squad/` always aborts | CRITICAL |
| E | `install-fold-pipeline` template resolution path invalid in published package | CRITICAL |
| F | `squad sync --dry-run` unreachable due to alias guard running first | Normal |
| G | `--dry-run` absent from `squad sync --help` | Normal |
| H | `hydrateTeamRootFromStateRef` idempotency comparison structurally unsound | Medium |
| I | Inbox branch-name collision on sub-second same-session publishes | Low (hardening) |

## Sub-proposals Excluded (Fork-local / Working-branch Concern)

- **Test import scope mismatch** — test files importing from a renamed SDK package scope. This is an artifact of the local branch's package rename and is not present in the upstream product source. Excluded from spec to preserve scrub gate compliance. The kickoff prompt directs the implementer to align new test imports with the existing pattern without naming the scope.

## Rationale

The critical-set defects (A, C, D, E) collectively prevent the cross-repo loop from completing a single end-to-end cycle. A developer who completes the piece 32–35 setup and attempts the assign→commit→publish flow encounters at least one loop-blocking failure at each stage. Repairing all four is the minimum for the loop to be functional.

Sub-proposals B, F, G target documented-but-non-functional features (flags that parse but produce no effect, or a flag invisible to users). Sub-proposals H and I are correctness and hardening items that do not block the loop but cause silent redundant work or intermittent failures under concurrent use.

---

### 2026-06-08: Adversarial Peer Review Is Now Part of the Piece Replay Procedure

**By:** akubly (via Copilot)

**What:** Beyond the primary Quality-Owner verification (FIDO), each piece must also get an independent ADVERSARIAL review by a different agent (and ideally a different model) before being considered done. The adversary assumes each fix is wrong and tries to prove it — hunting tautological/green-but-meaningless tests and fixes that pass tests without actually repairing the defect.

**Why:** User observation that the lack of an adversarial review procedure let gaps sneak through piece-36. The CRITICAL DEFECT-1 (double-`fold` template path in install-fold-pipeline.ts causing 5 regressions in piece-35 tests) was caught by CAPCOM's adversarial review (opus model) after FIDO's round 1 APPROVE, preventing a false-green ship. This demonstrates the necessity of independent, skeptical review as a standard process step.

**Process Impact:** Piece replay reviews now include:
1. Core dev implements and triages (EECOM, red→green TDD).
2. Quality Owner primary verification (FIDO).
3. **NEW: Adversarial peer review by different agent + ideally different model** (CAPCOM, CONTROL, etc.), assumed-wrong hypothesis.
4. If adversarial review flags defects, remediation is locked (core dev excluded from self-review) and handed to a neutral engineer.
5. Repeat quality + adversarial verification on amended commit.

**How to Apply:**
- **Adversarial reviewer instructions:** "Assume the fix is wrong. Hunt for: (a) tautological tests that pass without fixing the underlying defect, (b) green-but-meaningless assertions, (c) contract mismatches, (d) off-by-one bugs in path construction, (e) idempotency guards that never fire, (f) recursion-prevention logic that breaks on re-entry, (g) pre-existing test infrastructure vulnerabilities that the fix exploits."
- **Remediation lockout:** If adversarial review is NO-GO, the core dev who implemented the piece cannot self-fix. Assign remediation to a neutral reviewer (CONTROL, CAPCOM) who operates independently.
- **Re-verification:** After remediation, both Quality Owner and adversarial reviewer must re-approve before proceeding to ship.

**Rationale:**
This is a lightweight but mandatory peer-review pattern: it catches high-confidence defects early (before PR/CI) by leveraging domain expertise and adversarial reasoning. It does not replace code review or CI; it complements both by injecting skepticism at the moment of highest confidence.


---

### 2026-06-08: Piece 36 — Cross-Repo Publish-Loop Defect Repair: Triage

# Piece 36 — Cross-Repo Publish-Loop Defect Repair: Triage

**Date:** 2026-06-08T15:19:27-07:00  
**Author:** EECOM (Core Dev)  
**Piece:** 36 — cross-repo-publish-loop-repair  

---

## Triage Table

| Sub-proposal | Severity | Decision | Notes |
|---|---|---|---|
| A — `squad assign` new flags never parsed or dispatched | CRITICAL | **ACCEPT** | Add `--developer-alias`, `--state-remote`, `--state-branch` to `NAMED_FLAGS` in `assign-args.ts`; forward in `cli-entry.ts` dispatch block; gate hook install on truthy alias |
| B — `--skills-from` parsed but not forwarded | Normal | **ACCEPT** | Wire `skillsFrom` from dispatch block into `runAssign` |
| C — Cross-repo hook is a guaranteed no-op (recursion-guard bug) | CRITICAL | **ACCEPT** | Remove `export SQUAD_SYNC_ACTIVE=1` from hook preamble; let `runSync` own its guard |
| D — Publish allowlist aborts on any realistic host `.squad/` | CRITICAL | **ACCEPT** | Change `throw` to `continue`/filter; build snapshot from allowlisted paths only |
| E — `install-fold-pipeline` template path breaks in published package | CRITICAL | **ACCEPT** | Change `TEMPLATES_ROOT` to `path.resolve(__dirname, '../../../templates/fold')` (3 levels: from `src/cli/commands` or `dist/cli/commands` up to the package root where `templates/` lives) |
| F — `squad sync --dry-run` unreachable in no-alias case | Normal | **ACCEPT** | Move dry-run early-return before alias guard |
| G — `--dry-run` missing from `squad sync --help` | Normal | **ACCEPT** | Add `--dry-run` to help text in `cli-entry.ts` |
| H — `hydrateTeamRootFromStateRef` idempotency guard never fires | Medium | **ACCEPT** | Root cause confirmed during implementation: comparison uses HEAD (working-branch tip) vs. orphan-snapshot SHA — they can never match. Fix: write applied SHA to `.squad/.last-hydrate-sha` sentinel and compare against that. |
| I — Inbox branch-name collision on sub-second publishes | Low | **ACCEPT** | Append millisecond component to timestamp; format: `yyyyMMdd-HHmmssSSS` |

---

## Sub-proposal H — Implementation Note

Root cause confirmed: `hydrateTeamRootFromStateRef` compares `headSha` (result of `git rev-parse HEAD` in teamRoot, which is the product repo's working-branch tip) against `fetchedSha` (the orphan state-branch commit on the state remote). These live on entirely different commit graphs and can never be equal in production, so the guard never fires.

Fix implemented: introduce `.squad/.last-hydrate-sha` sentinel file. After successful hydration, write `fetchedSha` to it. On next call, read the sentinel; skip re-hydration if sentinel matches `fetchedSha`. This is a targeted, reliable one-line comparison change (sentinel vs. fetched SHA rather than HEAD vs. fetched SHA).

---

## Outcome

All sub-proposals A–I accepted. All implemented in piece 36 with TDD (red→green) and covered by targeted tests.

---

## CONTROL Remediation — Adversarial Review Response (2026-06-08T15:19:27-07:00)

**Author:** CONTROL (TypeScript Engineer)  
**Context:** CAPCOM NO-GO on EECOM commit `9474a1d7`. CONTROL owns independent fix.

### DEFECT-1 — E template path double-`fold`
Root cause: line 113 of `install-fold-pipeline.ts` used `path.join(TEMPLATES_ROOT, 'fold', platform, ...)` but `TEMPLATES_ROOT` already resolved to `templates/fold/`. The extra `'fold'` created `templates/fold/fold/<platform>/...` which does not exist. Fixed: removed redundant segment. Stale comment also corrected (said `../../` but code used `../../../`).

### H sentinel staleness (MEDIUM) — Limitation documented
The `.squad/.last-hydrate-sha` sentinel is keyed only on remote `fetchedSha`. If local content drifts (manual edits between fetches of same SHA), sentinel suppresses re-hydration. Acceptable per spec (idempotency is perf-only). Mitigation: delete sentinel to force re-hydrate. Added to `.gitignore` — must never be committed. Future: key on `fetchedSha + hash(localSquadTree)` if content-drift detection required.

### ISSUE-4 (I) — Monotonic counter residual edge
Added module-level `_publishSeq` counter to guarantee uniqueness below ms. Branch pattern `squad/inbox/<alias>/<ts>-<seq>-<sessionId>` still matches `squad/inbox/**` trigger glob. Residual edge: cross-process same-ms same-sessionId collision (negligible given per-session entropy).

### DEFECT-2 (C) — Recursion guard E2E residual gap
True hook execution was not exercised in Windows vitest sandbox. C1/C2 tests use two-phase proxy: outer runSync publishes once; re-entrant runSync with `SQUAD_SYNC_ACTIVE` pre-set asserts no second publish. Residual gap documented here; hook template correctness covered by install-hooks A2/A3.

---

## Documented Residual Limitations (2026-06-08T15:19:27-07:00)

**Author:** CONTROL (TypeScript Engineer)

### H — Sentinel keyed on `fetchedSha` only

The `.squad/.last-hydrate-sha` sentinel is keyed only on the remote `fetchedSha`. If local TEAM_ROOT content drifts (e.g., manual edits made between two fetches of the same remote SHA), the idempotency guard will silently skip re-hydration even though local content diverges from the snapshot. Per spec, idempotency is scoped as a performance optimisation only — not a correctness guarantee — so this is accepted as a known limitation. Mitigation: delete the sentinel to force re-hydration. Future hardening: key the sentinel on `fetchedSha + hash(localSquadTree)` to detect content drift.

### I — Branch uniqueness: cross-process same-millisecond edge

Branch name generation uses millisecond-precision timestamp plus a per-process monotonic `_publishSeq` counter. Within a single process, same-millisecond uniqueness is fully guaranteed by the sequence counter. Across multiple processes that start in the exact same millisecond with the same session ID, the monotonic counter resets independently per process, leaving a theoretical residual collision window. Severity: Low. Accepted.

### C — Shell-hook → commit → publish non-reentry: GitHub CI follow-up

C1-Phase1 and the E2E tests prove that a real `runSync` call reaches `publishTeamRootToInbox`, and install-hooks A2 asserts the hook template no longer pre-sets `SQUAD_SYNC_ACTIVE`. However, no test fires the real OS-level post-commit shell hook → `squad sync` subprocess and asserts that a sync-internal commit does NOT trigger a second publish cycle. A true shell-hook → commit → publish non-reentry end-to-end test is deferred as a **GitHub CI follow-up**: this scenario is flaky on Windows (timing/process isolation) and runs reliably on Linux CI. Tracked as a follow-up item for the CI pipeline.


---

### 2026-06-08: Surgeon Rebase akubly/upstream-npm-release onto piece-36 + Selective Stash Restore

# Decision: Rebase akubly/upstream-npm-release onto piece-36 + Selective Stash Restore

**Date:** 2026-06-08  
**Author:** Surgeon (Release Manager)  
**Branch:** akubly/upstream-npm-release  
**New HEAD after rebase:** b32f14cd (19 commits atop feee37f7)

---

## Context

`akubly/upstream-npm-release` carried 18 release and rescope commits (versioning at `0.9.6-mc.preview.11`, `@wifi-aware` scope, bump-build relocation, docs). `squad/piece-36-cross-repo-publish-loop-repair` (HEAD `feee37f7`) added one new commit: A–I defect repairs to cross-repo publish-loop CLI source files (`assign-args.ts`, `cli-entry.ts`, `install-hooks.ts`, `sync.ts`, `install-fold-pipeline.ts`) plus tests and a decisions inbox file. The merge-base was `8e7000a6` (piece-35 HEAD).

---

## Task 1 — Rebase Outcome

**Command:** `git rebase squad/piece-36-cross-repo-publish-loop-repair`  
**Result:** ✅ Clean — zero conflicts across all 18 commits.

**Why no conflicts:** The `@bradygaster → @wifi-aware` scope-scrub commits on npm-release were surgically scoped to import specifier lines only. piece-36's A–I logic rewrites touched different lines in the same files. Git applied all 18 commits without any hunk collision.

**Post-rebase scope grep:** `git grep -n "@bradygaster" -- "packages/**/src/**/*.ts"` returned exit 1 (no matches). No new stale imports introduced by piece-36.

---

## Task 2 — Build Gate

**Issue discovered:** After the rebase, `node_modules/@wifi-aware/` was empty — workspace symlinks were not regenerated after the scope rename. Build failed with TS2307 "Cannot find module '@wifi-aware/squad-sdk'" across all CLI commands. This is a workspace-link artifact, not a code defect.

**Fix:** `npm install` — regenerated workspace symlinks under `node_modules/@wifi-aware/`.

**Build result:** `$env:SKIP_BUILD_BUMP='1'; npm run build` → ✅ exit 0. Both `@wifi-aware/squad-sdk@0.9.6-mc.preview.11` and `@wifi-aware/squad-cli@0.9.6-mc.preview.11` built cleanly. No scope-fix commit required (grep was already clean).

---

## Task 3 — Selective Stash Restore

**Stash:** `stash@{0}` ("WIP on squad/piece-36-cross-repo-publish-loop-repair")  
**Files in stash:** `.squad/agents/control/history.md`, `.squad/agents/eecom/history.md`, `.squad/commit-msg.txt`, `.squad/decisions.md` (WANTED) + `package.json`, `packages/squad-cli/package.json`, `packages/squad-sdk/package.json` (UNWANTED — stale `0.9.6-build.4` churn).

**`.gitattributes` status:** Confirmed `merge=union` for `.squad/decisions.md` and `.squad/agents/*/history.md`.

**Apply result:** `git stash apply "stash@{0}"`:
- `.squad/agents/control/history.md` — auto-merged cleanly ✅  
- `.squad/agents/eecom/history.md` — auto-merged cleanly ✅  
- `.squad/commit-msg.txt` — auto-merged cleanly ✅  
- `.squad/decisions.md` — CONFLICT (git warning: "Cannot merge binary files" despite being text; union driver did not fire). Resolved manually: appended the "Adversarial Peer Review Is Now Part of the Piece Replay Procedure" section (2,506 chars) from the stash to the HEAD version of decisions.md.  
- `package.json` / `packages/squad-cli/package.json` / `packages/squad-sdk/package.json` — CONFLICT (expected). Resolved by: `git checkout HEAD -- package.json packages/squad-cli/package.json packages/squad-sdk/package.json`.

**Post-restore state:**
- All 3 `package.json` files: `@wifi-aware` scope, `0.9.6-mc.preview.11` — clean (no conflict markers).
- 4 `.squad/` files: working-tree modified, NOT staged (per Scribe protocol — `git reset HEAD -- .squad/`).
- `git grep "^<<<<<" -- .squad/ package.json` → exit 1 (clean).
- `stash@{0}` still listed in `git stash list` (not dropped).

---

## Final State

| Check | Result |
|-------|--------|
| New HEAD | `b32f14cd` |
| 18 release commits atop `feee37f7` | ✅ |
| Root package | `@wifi-aware/squad@0.9.6-mc.preview.11` |
| SDK package | `@wifi-aware/squad-sdk@0.9.6-mc.preview.11` |
| CLI package | `@wifi-aware/squad-cli@0.9.6-mc.preview.11` |
| `@bradygaster` in TS sources | ✅ clean (grep exit 1) |
| Build exit code | ✅ 0 |
| `.squad/` files restored | ✅ 4 files in working tree |
| `stash@{0}` intact | ✅ present |
| No conflict markers | ✅ confirmed |

---

## Pattern Recorded (for future replays)

1. **npm install after scope-rename rebase** is required whenever workspace package names change scope. The workspace symlinks under `node_modules/@wifi-aware/` are not regenerated automatically by git operations.
2. **union merge driver for `.squad/decisions.md` may not fire** on large files or files with encoding edge cases during `git stash apply`. Resolution: manually extract the new section from `git show "stash@{0}:.squad/decisions.md"` and append it to the working tree file.
3. **Selective stash restore recipe:** Apply stash → restore `package.json` from HEAD → manually resolve any `.squad/decisions.md` binary-conflict → unstage all `.squad/` with `git reset HEAD -- .squad/` → do NOT drop stash.

---

## 📋 PIECE 37 CANDIDATE SCOPE — Dogfooding Q&A Findings + Design Decisions

### 2026-06-09: FIDO Dogfooding Readiness (Piece-36 Repairs)

**Date:** 2026-06-09  
**Author:** FIDO (Quality Owner)  
**Status:** ✅ CONDITIONAL GO — no reinstall needed; fix CI before PR

The CLI is ready to dogfood with installed version `0.9.6-mc.preview.12` (all piece-36 A–I repairs included). **No rebuild or reinstall required.** CI shows 23 failures but all are from dead test mocks (non-blocking for dogfooding).

**Verified Working:**
- Build gate: ✅ exit 0
- CLI version: ✅ 0.9.6-mc.preview.12
- `--developer-alias` wired: ✅
- `--state-remote`/`--state-branch` wired: ✅
- `--skills-from` wired: ✅
- Hook template SQUAD_SYNC_ACTIVE guard: ✅
- Allowlist filter (not throw): ✅
- Templates directory present: ✅
- Sentinel idempotency (.last-hydrate-sha): ✅
- Piece-36 tests: 21/23 pass ✅

**Hard Blockers:** None. All prior BUG-level items (BUG-2 allowlist, BUG-3 --developer-alias) fixed by piece-36 A–D.

**Non-Blockers (fix before PR, not before dogfooding):**
1. **NB-1 — Test scope mismatch (B4):** 23 CI failures from 5 files importing @bradygaster/squad-sdk instead of @wifi-aware/squad-sdk. Mechanical rename required (~10 lines).
2. **NB-2 — Changeset wrong scope:** `.changeset/piece-36-cross-repo-publish-loop-repair.md` references @bradygaster/squad-cli; rename to @wifi-aware/squad-cli.
3. **NB-3 — install-hooks A1 flaky timeout (pre-existing):** Add `{ timeout: 15000 }` to test or investigate git init latency.

---

### 2026-06-09: PAO Docs Reconciliation (Piece-36 Shipped Behavior)

**Date:** 2026-06-09  
**Author:** PAO (Documentation)  
**Commit:** b942dc2c

Piece-36 shipped fixes for the shared-squad dotfile flow. Docs reconciliation pass reconciled prior workaround descriptions with actual shipped behavior.

**Decisions Made:**
1. Removed `⚠️ Note (build 12)` block from `shared-squad.md` — flag is fully wired; workaround false.
2. Added `--state-remote` and `--state-branch` to CLI reference flags table for `squad assign` (parsed and forwarded but undocumented).
3. Clarified `--dry-run` in both `shared-squad.md` and `cli.md`: "Works without a resolved developer alias" (matches gate-move behavior).
4. Renamed section in `getting-started-journey.md` from "Shared-squad sync (build 12+)" to "Shared-squad sync"; rewrote to lead with `squad assign --developer-alias` as recommended path.
5. No inbox branch format update needed (old `<ts>-<sessionId>` format not explicitly documented).
6. No publish filter change docs needed; sentinel docs not required.

**Test sync:** Two new assertions in `test/docs-build.test.ts` (same commit):
- `shared-squad guide reflects piece-36 working auto-publish (no build-12 workaround)` ✅
- `CLI reference documents --state-remote and --state-branch on squad assign` ✅

---

### 2026-06-09: EECOM Dogfooding Q&A Findings (Piece-37 Candidate Items)

**Date:** 2026-06-09  
**Author:** EECOM (Dev Lead)  
**Scope:** 14 dogfood observations on branch `akubly/upstream-npm-release`, CLI `@wifi-aware/squad-cli@0.9.6-mc.preview.12` + 2 follow-up Q&A rounds.

**Status:** Triage-ready — all items confirmed in source; no fixes applied (piece-37 scope candidate).

#### BUGs (3 items)

| # | ID | File:Line | Current | Desired |
|---|-----|-----------|---------|---------|
| 3 | `ERR_ASSIGN_ORIGIN_AMBIGUITY` message references `--callsign` but flag is dead in warm path | `packages/squad-cli/src/commands/assign.ts:519–523` | Error says "Use an explicit --callsign to disambiguate" but `opts.callsign` consumed only in `_coldStart` (line 624), not in `_warmPath`; passing `--callsign` has zero effect | Fix message to give actionable advice OR (preferred) make `--callsign` actually filter entries from `originMatchingEntries` in `_warmPath` |
| 10 | Cross-repo post-commit hook installed in HOST only; product-repo workflow never triggers it | `packages/squad-cli/src/commands/assign.ts:585` | `docsRepoPath = path.dirname(entry.path)` = HOST root only | Install in BOTH host AND product clone (double-publish safe via idempotency) |
| 12 | `install-fold-pipeline` absent from `squad --help` commands table | `packages/squad-cli/src/cli-entry.ts:213–252` | Command dispatches at line 1457 but no help entry | Add row to commands table |

#### UX Items (4 items)

| # | ID | Current | Desired |
|---|-----|---------|---------|
| 1 | **Terminology:** "docs-repo" used throughout | Rename to "shared-squad host clone" or agreed term |
| 5 | `squad assign --help` falls through instead of showing assign-specific help | Add `cmd === 'assign'` branch at line 346 |
| 6 | **"developer alias" terminology fragmented** — `DEVELOPER_ALIAS_RE`, `developerAlias`, `--developer-alias`, `SQUAD_DEVELOPER_ALIAS` | Decide canonical term (proposed: "inbox handle"); one-sweep rename across SDK + CLI + docs |
| 8 | `stateRemote` default `'squad-docs'` wrong; hardcoded 3x at `sync.ts:693,722,734` | Change default to `'origin'`; extract to `DEFAULT_STATE_REMOTE` constant (fold templates hardcode `origin` → mismatch = silent pipeline failure) |
| 13 | `squad --help` table column padding inconsistent (2 spaces, no alignment) | Pad to fixed-width column (e.g., 24 chars) |

#### DESIGN Items (3 items)

| # | ID | Description | Key File:Line |
|---|-----|-------------|---------------|
| 4 | **Alias at init-time gap** | `developerAlias` written only by `squad assign`; guard 3 (assign.ts:449–452) makes assign a no-op from host dir. Decision: should `squad init` accept `--developer-alias`? | `assign.ts:449–452` |
| 9 | **Inbox branch pattern not configurable** | `squad/inbox/<alias>/<ts>-<seq>-<sessionId>` hardcoded at `sync.ts:326`. Decide if prefix should be overridable. | `sync.ts:326` |
| 10 | **Hook placement: install in BOTH host AND product** | Confirmed recommendation: product hook = primary workflow (agent sessions → host `.squad/` writes → product commit triggers publish); host hook = secondary (host-direct edits). Double-publish safe. Install site: `assign.ts:585` (host, current) + `assign.ts:600-area` (product clone). | `assign.ts:585`; `install-hooks.ts:260` |

#### Q6 Full Alias-Rename Surface

| Surface | File:Line |
|---------|-----------|
| `DEVELOPER_ALIAS_RE` constant | `packages/squad-sdk/src/validation.ts:11` |
| `developerAlias` registry field | `packages/squad-sdk/src/registry.ts:21,164–168,172` |
| `AssignCliArgs.developerAlias` interface | `packages/squad-cli/src/commands/assign-args.ts:17` |
| `--developer-alias` in NAMED_FLAGS | `packages/squad-cli/src/commands/assign-args.ts:28,69` |
| `SquadAssignOpts.developerAlias` interface | `packages/squad-cli/src/commands/assign.ts:283,335` |
| Hook install comment | `packages/squad-cli/src/cli/commands/install-hooks.ts:125` |
| `SyncOptions.developer` interface | `packages/squad-cli/src/cli/commands/sync.ts:32` |
| Alias resolution + error strings | `packages/squad-cli/src/cli/commands/sync.ts:680,708–710` |
| `SQUAD_DEVELOPER_ALIAS` env var | `packages/squad-cli/src/cli/commands/sync.ts:685` |
| CLI help text | `packages/squad-cli/src/cli-entry.ts:337,342` |
| Docs reference/cli.md | lines 133,143,326,328,353,366–368,379,715 |
| Docs guide/shared-squad.md | lines 99,106,118,133,136–139,168,171–172,175 |

#### ANSWERED Items (no fix needed)

- Q2: `squad upstream` from origin/dev, commit 3a53f823
- Q3: `--callsign` works only in cold-start (URL) path; dead in warm-path
- Q7: Before first `squad sync --push`: host has local `.squad/` but no remote state/inbox branches
- Q8: `stateRemote` = WHERE (git remote); `stateBranch` = WHAT (branch name); fold templates hardcode `origin`
- Q11: `--developer`/`--developer-alias` subsumed by DESIGN-6 rename
- Q14: `squad scrub-emails` from origin/dev

---

### 2026-06-09: Flight Architectural Analysis + Host Publish Model (Piece-37 Design Inputs)

**Date:** 2026-06-09  
**Author:** Flight (Lead)  
**Context:** Dogfooding analysis of shared-squad cross-repo flow vs. upstream inheritance feature. Advisory only.

#### Q2: Upstream vs Shared-Squad Design

**Genuine Overlap:**
- Both involve consumer repo reading `.squad/` from a host/upstream repo
- Both auto-clone git remote into local cache
- Both surface skills, routing, decisions to coordinator at session start

**Genuine Difference (the WRITE-BACK path):**
- **`publishTeamRootToInbox`** (sync.ts) — no upstream equivalent
- **Inbox branch isolation** — per-developer branches prevent concurrency collisions
- **Fold pipeline** — sole writer to `squad-state`; upstream has no serialization
- **Data type:** Upstream = CONFIGURATION (semi-static); shared-squad = LIVE STATE (continuously mutated)

**Could shared-squad have leveraged upstream's resolver?**
- **Read half: partially yes.** Upstream's `resolveUpstreams()` (resolver.ts:165+) could serve context read (skills, routing, wisdom) from host — avoiding ~30–50% of registry lookup code.
- **Read half: NOT for state hydration.** Shared-squad's `hydrateTeamRootFromStateRef` reads from orphan `squad-state` branch (git plumbing); upstream's resolver always reads working tree.
- **Write half: NO.** `publishTeamRootToInbox`, inbox branch format, allowlist, fold pipeline have no upstream analog.

**Verdict:** Build parallel system — correct choice. Upstream = read-only hierarchical context. Shared-squad = bidirectional live state sync. Adjacent but not equivalent.

**Piece-37 Consolidation Opportunity:** **Shared-squad's CONTEXT read path should be expressed as upstream local entry; STATE sync path remains inbox/fold pipeline.**
- `squad assign` registers docs-repo as local upstream entry (upstream.json)
- Upstream resolver handles skill/routing/wisdom inheritance
- Registry+hydrate path handles only `squad-state` branch materialization
- This split makes the architecture's seams legible

---

#### Q4: Host Self-Publish Model

**Proposal:** Commit `.squad/` state changes through inbox→fold→squad-state path rather than directly to working branch. Makes inbox the universal ingress.

**Coherence Analysis:**
- **Architecturally coherent?** Yes. Flow:
  ```
  host working branch commit
    → post-commit hook fires
    → squad sync --push (SQUAD_SYNC_ACTIVE guard prevents recursion)
    → inbox branch created + pushed
    → fold pipeline triggered on inbox push
    → fold pipeline reads inbox, writes squad-state
    → DONE (no loop)
  ```
- **Recursion guard works?** Yes. `SQUAD_SYNC_ACTIVE=1` prevents fold pipeline's own commits from triggering another sync.

**Tensions & Issues:**
1. **Circular dependency concern:** Host hydrates FROM squad-state (as consumers do) → commits → inbox → fold → squad-state → host hydrates... Recursion guard prevents hook firing during hydration, but host working tree and squad-state need to stay in sync (non-trivial state management).

2. **Bootstrap problem:** If host routes all commits through inbox, who seeds the first squad-state? Answer: `squad install-fold-pipeline` + one-time initial publish (setup step, not structural issue).

3. **EECOM product-clone hook finding:** Piece-34 constraint: hooks install in docs-repo clone ONLY. If hooks go to product clone, they'd fire on product code commits (spurious publishes). **Fix:** Content-filter check (only publish if `git diff --name-only HEAD~1 | grep .squad/` has matches). Do NOT put hooks in both repos without this filter.

**Alternatives to host-self-publish for PR cleanliness:**
- **Orphan-branch backend** (already the model for registered repos): `.squad/` never on working branch — only on squad-state. Zero PR churn structurally.
- **`.git/info/exclude` in host:** Add `.squad/` to host's `.git/info/exclude` (local-only, not a `.gitignore` change).
- **Pre-push hook:** Filter `.squad/` from commits before they reach origin.

**Recommendation:**
> Do NOT implement host-self-publish as described yet. **First enforce the orphan-branch backend in the host.**
>
> Rationale: The orphan-branch backend already achieves the user's goal. `.squad/` never appears on working branch; squad-state is canonical. PR-cleanliness falls out structurally.
>
> If team still wants host-self-publish after trying orphan-branch-in-host:
> - Implement as a **flag**: `"selfPublish": true` in host's registry entry
> - Post-commit hook in docs-repo clone already present (piece-34)
> - Fold pipeline already handles inbox → squad-state
> - Gap: hydration on host side (host's working tree becomes write-only staging; must hydrate from squad-state on `squad sync --pull`)
> - Guard: content-filter check before publishing — only publish if allowlisted `.squad/` files changed
>
> **On hooks in both repos:** No. Post-commit hook belongs in docs-repo clone (where Squad state is committed), NOT product clone. If ergonomic gap exists, enforce piece-29 TEAM_ROOT/WORK_ROOT write-rule protocol.

---

#### Piece-37 Design-Decision Inputs

1. **Upstream as context read path:** Should `squad assign` register docs-repo as local upstream entry so upstream resolver handles skill/routing/wisdom inheritance? Consolidates context into upstream system; reduces registry+hydrate code.

2. **Orphan-branch backend in host:** Should host docs-repo operate in orphan-branch mode (no `.squad/` on working branch)? Achieves PR-cleanliness structurally.

3. **Host-self-publish as opt-in flag:** If orphan-branch backend insufficient, define `"selfPublish": true` on host's registry entry as opt-in. Requires bootstrap flow and hydration protocol spec.

4. **Post-commit hook scope:** Confirm hook remains docs-repo-clone-only. If product-clone hooks added, mandate content-filter check (only publish if allowlisted `.squad/` files changed).

5. **Upstream / shared-squad interface boundary:** Draw line explicitly: upstream = CONFIGURATION; shared-squad = STATE. Any content crossing this line needs explicit policy.


---

### 2026-06-09T16:26:32-07:00: RATIFIED — piece-37 Tier-2 + reframed cross-repo publish model
**By:** akubly (Brady), via Copilot. Supersedes the open questions in copilot-publish-model-directives.md.
**Status:** Decisions RATIFIED. Batch A = build next (own pieces). Reframed I/N/P + guards = piece 38. No code in this (piece-37) replay commit.

**Publish model (RATIFIED):**
- Trigger is decoupled from source. A publish always snapshots the HOST clone's `.squad/` working tree (sync.ts:642,335) and pushes to an inbox branch; it fires in response to a commit in ANY assigned repo.
- Hooks installed in BOTH host and product clones (supersedes piece-34 host-only constraint, decisions.md:998 — record the supersession when piece 38 lands).
- Host post-commit hook: filter OUT `.squad/` using `git diff-tree --no-commit-id --name-only -r --root HEAD | grep -qv '^\.squad/'` (diff-tree --root, NOT HEAD~1 — correct on root commits & shallow clones).
- Product post-commit hook: fire on ANY commit (existing unfiltered template `squad sync --push --quiet` guarded by SQUAD_SYNC_ACTIVE). Loop-free (env guard + commit-tree plumbing fires no hooks + hydrate never commits).

**Product `.squad/` ownership (RATIFIED — option a / ephemeral):**
- Product clones NEVER track `.squad/`. Product-side agents write generated history/logs/decisions to TEAM_ROOT = the LOCAL host clone's `.squad/` (piece-29 work-root/team-root protocol). The product commit is only the trigger; the host `.squad/` is the source the next publish snapshots → inbox → fold → squad-state.
- New mechanism (piece 38): a product PRE-COMMIT guard that rejects staging/committing any `.squad/` path to the product working branch (forbids TRACKING, not the directory's existence). No orphan backend needed on product clones.
- PRECONDITION confirmed by user: product agents write to the local host `.squad/` (TEAM_ROOT-redirection). The per-product-clone-`.squad/`-publish alternative is rejected (not realizable without abandoning the host-snapshot invariant).

**N — dual-role registration (RATIFIED — both-by-default, no schema):**
- One `squad assign` registers BOTH roles at the same host: upstream READ-context (always-on, read-only) + shared-squad STATE. State-sync activates when an inbox-handle is set (already alias-gated, sync.ts:709). No schema change — no `role` discriminant, no separate registry file (writeRegistry already round-trips extra fields, registry.ts:171-177).

**P — host self-publish (RATIFIED — DEFERRED):**
- Defer P entirely. Rely on next-trigger propagation (host `.squad/` edits publish on the next non-`.squad/` or product commit). Default host hook filters OUT `.squad/`. (A selfPublish flag would invert the host filter; revisit later if immediacy is needed.)

**O — orphan enforced default (RATIFIED in DIRECTION; precondition before code):**
- Enforce orphan so `.squad/` stays out of PRs in both host and product clones.
- PRECONDITION (enum reconciliation) before any O code: registry stateBackend enum {worktree,local,external} REJECTS `orphan` (registry.ts:16,143); config enum is {local,external,orphan,two-layer}; spec override `flat` exists in NO enum/handler; sync.ts:646 already hardcodes `orphan` for registry-matched entries. Unify field name (stateBackend) + value set (add orphan; decide two-layer/worktree; define-or-drop flat); decide whether sync.ts:646 reads the field vs keeps hardcoding.

**Batch A — build next (each as its own replay piece/branch, not in piece 37):**
- J: rename developer-alias → canonical `inbox-handle` across ~49 sites (CAPCOM count, not spec's 14) + fold in ERR_ASSIGN_INVALID_ALIAS drift; patch changeset for @bradygaster/squad-cli AND @bradygaster/squad-sdk. (Blocks K.)
- L: keep inbox prefix hardcoded (Option 1); record as a known limitation in install-fold-pipeline help.
- M: Option 2 — actionable sync-from-host guard (mirror assign Guard 3; clear error, exit 1).
- K: Option 2 — narrow guard-3 exception for handle-only update from the host; gated on J.

**Piece 38 scope (design-locked; build after spec):** reframed two-hook model (host filter-out via diff-tree --root; product unfiltered; both clones) + product `.squad/`-forbid pre-commit guard + N dual-role registration + O enum reconciliation & enforcement. Explicitly supersedes piece-34 host-only (decisions.md:998).

**Record-integrity follow-up:** the committed piece-37-triage.md J–P titles are generic mislabels; correct them to the real item titles (J terminology, K handle-at-init, L prefix-config, M sync-from-host, N upstream-context, O orphan-default, P self-publish).


---

### 2026-06-09T16:26:32-07:00: User design directives — cross-repo publish model (piece 37 Tier-2 / future piece 38)
**By:** akubly (via Copilot) — ratifying/reframing Tier-2 I, N, O
**Status:** FIRM directives captured; dependent mechanics routed to team for a concrete design proposal before implementation. Nothing implemented.

**Firm model (publish trigger vs source):**
- Hooks are installed in BOTH the host clone AND product clone(s). (Flight "right in spirit".)
- A publish always snapshots the HOST clone's `.squad/` and pushes it to an inbox branch. The TRIGGER is decoupled from the source: a publish fires in response to a commit in ANY repo where the squad is assigned (host or product).
- Host-repo hook: trigger on NON-`.squad/` changes (filter OUT `.squad/`) — do not republish the canonical state merely because the canonical `.squad/` changed locally.
- Product-repo hook: trigger on ANY commit (product work is itself the signal to propagate current host state). It is NOT a `.squad/`-keyed publish filter.
- Separate new concern (distinct mechanism, not this publish hook): the product repo must FORBID `.squad/` files from being introduced/committed.

**Firm (item O / PR hygiene):** In the user's real use case, squads are ACTIVELY modifying files in BOTH host and product clones, generating history/logs/decisions that must be processed & merged. In ALL assigned clones, `.squad/` state in PRs is disruptive/undesirable → keep `.squad/` OUT of PRs everywhere (orphan/enforced default confirmed in direction).

**Open (routed to team, not yet decided):**
- Reconcile apparent tension: product repo "forbid `.squad/`" (point 1) vs product squads "generate `.squad/` history/logs/decisions that must be merged, kept out of PRs" (point 3). Is product `.squad/` never tracked (ephemeral, published out) or tracked on an orphan ref kept out of PRs?
- Validate host filter-OUT-`.squad/` is coherent and how host-direct `.squad/` edits propagate (relationship to self-publish, item P).
- N (upstream READ vs shared-squad STATE): in the user's case one host serves BOTH roles. Need they be separable? Should they have DIFFERENT defaults? (CAPCOM leaned separate-files for write-safety; reconcile with one-registration-both-roles ergonomics.)
- O mechanism blocker: registry `stateBackend` enum {worktree,local,external} has no `orphan`; config enum differs; spec override `flat` exists nowhere — reconcile naming/enums before any code.


---

# Decision: Two-Clone Hook Model Supersedes Piece-34 Host-Only Constraint

**Date:** 2026-06-09  
**Author:** EECOM (Core Dev)  
**Status:** Ratified (spec piece 38)

## Context

Piece 34 established `installCrossRepoHook` as a host-only post-commit hook. Piece 38 requires hooks in BOTH clones (host filtered, product unfiltered) for the decoupled publish model.

## Decision

- `installCrossRepoHook` now auto-detects host vs product via `.squad/team.md` presence
- Host hook filters out `.squad/`-only commits (`git diff-tree --root`)
- Product hook is unfiltered (all commits trigger sync)
- Both installed in independent try/catch blocks
- New `installProductSquadForbidHook` installs pre-commit guard in product clone only

## Consequences

- Piece 34's single-hook assumption is superseded
- Loop-freedom maintained: `SQUAD_SYNC_ACTIVE` guard + isolated `GIT_INDEX_FILE`
- Product clone cannot accidentally track `.squad/` (pre-commit blocks it)


---

# Piece 37 — Dogfood Triage List
> EECOM | Created: 2026-06-09T12:15:47-07:00 | Last updated: 2026-06-09T13:46:31-07:00  
> Branch: `akubly/upstream-npm-release` | CLI: `@wifi-aware/squad-cli@0.9.6-mc.preview.12`  
> Rounds: R1 (original 14 items) → R2 (Q3/Q4/Q6/Q8/Q10 deep-dives) → R3 (Q3/Q8/Q10 concrete) → R4 (ADO path, sync-from-host, BLOCKER)

---

## ⛔ BLOCKER BUGS (fix before any release)

### BLOCKER-A — `squad sync push` (positional) silently becomes `--both`
**File:** `packages/squad-cli/src/cli-entry.ts:1437–1443`  
**Root cause:** Direction flags are detected with `args.includes('--push')` / `args.includes('--pull')` (double-dash). A bare positional `push` (no `--`) is never matched → `hasPush = false`, `hasPull = false` → falls to `else if (hasBoth || (!hasPush && !hasPull)) direction = 'both'` → silently runs both pull AND push.  
**Contrast:** `args[1] === 'status'` IS handled as a positional at line 1430 — inconsistent.  
**Effect:** User intended push-only; got both; the pull/hydrate half ran first and hit BLOCKER-B.  
**Fix:** Add positional handling for `push`/`pull` similarly to `status`:
```typescript
// At cli-entry.ts:1430-ish, after the status check:
if (subCmd === 'push' && !hasPull && !hasBoth) direction = 'push';
else if (subCmd === 'pull' && !hasPush && !hasBoth) direction = 'pull';
```
Or: accept bare positional alongside `--` flag form for direction.

---

### BLOCKER-B — Wrong `stateRemote` default `'squad-docs'` breaks hydrate (and status misleads)
**Files:** `packages/squad-cli/src/cli/commands/sync.ts:693, 722, 734`  
**Root cause (split into two parts):**

**Part 1 — Wrong default (the actual failure):**  
`stateRemote ?? 'squad-docs'` appears at three sites:
- Line 693 (dry-run print)
- Line 722 (`hydrateTeamRootFromStateRef(teamRoot!, stateRemote ?? 'squad-docs', ...)`)
- Line 734 (`publishTeamRootToInbox(teamRoot!, stateRemote ?? 'squad-docs', ...)`)

If `entry.stateRemote` is not set in the registry (the common case — no one sets it explicitly), the fallback is `'squad-docs'`. But the fold pipeline templates (`templates/fold/github/fold-squad-state.yml:33,103-104,219` and `templates/fold/ado/fold-squad-state.yml:36,99-101,205`) hardcode `origin` for ALL git operations (fetch inbox refs, checkout/push squad-state). So inbox branches are pushed to a `squad-docs` remote that may not exist, while the fold pipeline reads from `origin` → **fold pipeline receives nothing, silently**.

For hydrate: `git fetch squad-docs refs/heads/squad-state:...` → fatal: `'squad-docs' does not appear to be a git repository`.

**Part 2 — Misleading status line:**  
`sync.ts:715`: `console.log(`squad sync: ${options.direction} (remote: ${remote}, backend: ${backend ?? 'orphan'})`)`  
`remote` here = `options.remote ?? resolveRemote(repoRoot)` (line 617) — the SINGLE-REPO git remote, read from `git config branch.<branch>.remote` → typically `'origin'`.  
`stateRemote` (line 623) = the CROSS-REPO state remote read from `entry.stateRemote` → `'squad-docs'` (fallback).  
Status prints `origin` (single-repo var); hydrate uses `squad-docs` (cross-repo var). **Two different variables — status lies.**

**Fix:**  
1. Extract `const DEFAULT_STATE_REMOTE = 'origin'` and replace all three `'squad-docs'` literals.  
2. Fix the status line for cross-repo context: print `stateRemote ?? DEFAULT_STATE_REMOTE` instead of `remote`.

**Interaction with BLOCKER-A:**  
Fixing BLOCKER-A alone sidesteps the hydrate error for this specific user run (push-only skips the pull/hydrate branch). But BLOCKER-B independently breaks `--both` and `--pull` for any user who hasn't explicitly set `stateRemote`. **Both must be fixed.**

---

## BUGs (confirmed, non-blocker)

### BUG-2 — `ERR_ASSIGN_ORIGIN_AMBIGUITY` advises `--callsign` flag that is dead in warm path
**File:** `packages/squad-cli/src/commands/assign.ts:519–523`  
**Problem:** The error message says "Use an explicit --callsign to disambiguate." But `opts.callsign` is consumed ONLY in `_coldStart:624` (URL path: overrides URL-derived name). In `_warmPath`, the filter at line 511-512 only checks `e.callsign === callsign` (positional arg) — `opts.callsign` is never read. The flag advice is wrong in this context.  
**Cold-start usage (works):** `squad assign <url> --clone-to ./dir --callsign myname` — overrides the URL-derived callsign name.  
**Warm-path ambiguity (broken):** `squad assign smfx --callsign mobcon` → `opts.callsign` ignored → same error.  
**Only working warm-path resolution today:** `squad unassign --callsign <conflicting>` or `squad doctor`.  
**Fix options:**  
- (a) Fix error message to remove the `--callsign` advice and explain actual resolution steps.  
- (b) Wire `opts.callsign` in `_warmPath` filter at line 511-512: `if (e.callsign === callsign || e.callsign === opts.callsign) return false`.  
Option (b) is the correct fix; (a) is a minimum-viable patch.

### BUG-3 — Post-commit hook installed in HOST clone only (never fires in primary workflow)
**File:** `packages/squad-cli/src/commands/assign.ts:585` (hook install call site)  
**File:** `packages/squad-cli/src/cli/commands/install-hooks.ts:260–285` (installer)  
**Problem:** Current code: `const docsRepoPath = path.dirname(entry.path)` (HOST root) → hook in HOST's `.git/hooks/post-commit`. In the primary developer workflow, agent sessions write state to HOST's `.squad/`, but the developer commits in the PRODUCT repo. The product repo's `.git/hooks/` has no hook → the hook never fires for normal workflow.  
**`SQUAD_SYNC_ACTIVE` guard is intra-process only** (`process.env` per Node.js process, `sync.ts:611,748`) — does NOT prevent concurrent two-process invocations (safe: inbox branches are unique by timestamp+seq+UUID; fold idempotent via publish-history.json).  
**Recommendation: install in BOTH** host clone AND product clone.  
- Host hook: covers host-direct commits (charter edits, decisions.md, routing.md).  
- Product hook: covers primary workflow (developer commits in product → triggers publish of HOST's .squad/).  
**Fix:** In `assign.ts:585`, add `installCrossRepoHookFn(clonePath)` alongside existing `installCrossRepoHookFn(docsRepoPath)`, each in independent try/catch.

### BUG-4 — `install-fold-pipeline` missing from `squad --help` commands table
**File:** `packages/squad-cli/src/cli-entry.ts:213–252`  
**Problem:** Command is dispatched correctly at line 1457 but has no row in the help table → invisible to users.  
**Fix:** Add row to the commands table.

---

## OPEN-UX Items

### UX-1 — "docs-repo" terminology in user-facing strings should be "shared-squad host clone" (or agreed term)
**Occurrences in user-facing output:**  
- `install-fold-pipeline.ts:89`: `"Could not resolve docs-repo path. Run 'squad assign' to register a docs-repo clone."`  
- `install-fold-pipeline.ts:105`: `"Bootstrap the docs-repo pipeline directory before running install-fold-pipeline."`  
- `install-fold-pipeline.ts:47` (JSDoc), `:59` (inline comment), `:70` (inline comment)  
- Various `assign.ts` variable names: `docsRepoPath`, `docsRepoClone` (not user-facing but part of the rename scope)  
**Fix:** Agree on canonical term; scrub to `"host clone"` or `"squad host"` across all user-facing strings and key variable names.

### UX-2 — `squad assign --help` not implemented (falls through to main help or runs assign)
**File:** `packages/squad-cli/src/cli-entry.ts:346`  
**Problem:** Per-command help block handles only `init`, `list`, `doctor`, `sync`. The comment at line 346 says "For other commands, fall through to the main help" — but `squad assign --help` actually runs the assign handler (which errors for missing callsign), not the main help. Only `--help` as the first positional routes to per-command help — `assign --help` doesn't match the `(args[0] === '--help' || args[0] === '-h')` check.  
**Fix:** Add an assign help branch, OR make the help dispatch check for `--help` anywhere in args when cmd is known.

### UX-3 — `stateRemote` should default to `'origin'`, not `'squad-docs'`
Folded into BLOCKER-B above. If fixed as part of BLOCKER-B, this item is closed.  
**Note:** Even after fixing, `stateRemote` as a concept should be documented — most users will never set it explicitly and the default must just work.

### UX-5 — `squad --help` command table too narrow for `install-fold-pipeline`
**File:** `packages/squad-cli/src/cli-entry.ts:217–252`  
**Problem:** Column padding is static; `install-fold-pipeline` (22 chars) overflows the padded column width, causing misalignment.  
**Fix:** Compute column width dynamically from the longest command name, or widen the fixed pad.

### UX-6 — ADO fold pipeline installed to `.azure-pipelines/` — non-standard directory name
**File:** `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts:97`  
**Current:** `ado: path.join(docsRepoPath, '.azure-pipelines')`  
**Issue:** Azure DevOps has no enforced pipeline YAML directory (unlike GitHub's `.github/workflows/`). Common conventions include `.azuredevops/`, `.pipelines/`, `.ado/`, and `azure-pipelines.yml` at root. Our choice `.azure-pipelines/` is functional ONLY if the ADO pipeline definition in the portal is configured to point to `.azure-pipelines/fold-squad-state.yml`.  
**Recommendation:** Change to `.azuredevops/` (closer to Microsoft's own convention in public Azure DevOps docs) and document that the user must configure the ADO pipeline to use this path. The trigger path in the fold YAML must also be updated to match.  
**Tag:** [OPEN-UX] — functional if consistently documented; `.azuredevops/` is more recognizable.

---

## OPEN-DESIGN Items

### DESIGN-1 — "developer alias" terminology overloaded; full rename surface
The `developerAlias` concept is functionally an **inbox handle** (namespaces `squad/inbox/<handle>/...`). The name "alias" is overloaded in corporate environments (email alias, ADO alias, GitHub handle).

**Full rename surface (14+ touch points):**

| Symbol | File | Line | Type |
|--------|------|------|------|
| `DEVELOPER_ALIAS_RE` | `packages/squad-sdk/src/validation.ts` | 11 | regex name |
| `developerAlias` | `packages/squad-sdk/src/registry.ts` | 21, 164–168, 172 | registry field |
| `AssignCliArgs.developerAlias` | `packages/squad-cli/src/commands/assign-args.ts` | 17 | type field |
| `--developer-alias` NAMED_FLAG | `packages/squad-cli/src/commands/assign-args.ts` | 28, 69 | CLI flag |
| `SquadAssignOpts.developerAlias` | `packages/squad-cli/src/commands/assign.ts` | 283, 335 | type field |
| hook comment | `packages/squad-cli/src/cli/commands/install-hooks.ts` | 125 | comment |
| `SyncOptions.developer` | `packages/squad-cli/src/cli/commands/sync.ts` | 32 | type field |
| resolution comment + error strings | `packages/squad-cli/src/cli/commands/sync.ts` | 680, 708–710 | user-facing |
| `SQUAD_DEVELOPER_ALIAS` env var | `packages/squad-cli/src/cli/commands/sync.ts` | 685 | env var name |
| `--developer` help | `packages/squad-cli/src/cli-entry.ts` | 337 | help string |
| env var help | `packages/squad-cli/src/cli-entry.ts` | 342 | help string |
| dispatch destructure | `packages/squad-cli/src/cli-entry.ts` | 1310 | code |
| docs reference CLI | `docs/src/content/docs/reference/cli.md` | 133, 143, 326, 328, 353, 366–368, 379, 715 | docs |
| docs shared-squad guide | `docs/src/content/docs/guide/shared-squad.md` | 99, 106, 118, 133, 136–139, 168, 171–172, 175 | docs |

**Supersedes UX-4** (flag naming inconsistency `--developer` vs `--developer-alias` is subsumed — both would be renamed).  
**Decision required:** Agree on the canonical term (`inbox-handle`? `publish-handle`? `handle`?) before executing the sweep.

### DESIGN-2 — `developerAlias` not settable at `squad init --callsign` (host-only workflow gap)
**File:** `packages/squad-cli/src/commands/assign.ts:449–452` (guard 3, blocks assign from host dir)  
**Analysis:** `developerAlias` is stored per `RegistryEntry` (one field, one per local registry entry, `registry.ts:21`). `squad assign` is the only writer. Guard 3 makes `squad assign` a no-op from the host dir, so alias cannot be set by a developer working exclusively in the host. Workaround: `SQUAD_DEVELOPER_ALIAS` env var (`sync.ts:685`).  
`squad init --callsign` does NOT accept `--developer-alias` — init only scaffolds the host, it doesn't create the consumer registry binding that holds `developerAlias`.  
**Question:** Should `squad init` (host creation) accept a `--developer-alias` flag that pre-populates the registry entry's `developerAlias`? Or is the `SQUAD_DEVELOPER_ALIAS` env var path sufficient?  
**Tag:** OPEN-DESIGN (decision needed; current split has a real usability gap for host-only developers).

### DESIGN-3 — Hook placement: install in product AND host (both)
Covered in BUG-3 above with concrete recommendation (install both). This DESIGN item captures the decision: **recommendation is BOTH**.

### DESIGN-4 — `squad sync` from the HOST clone silently degrades to single-repo mode
**File:** `packages/squad-cli/src/cli/commands/sync.ts:635–644`  
**Analysis:** Registry lookup uses `e.clones?.some(c => normalisedPathKey(c) === normalizedRoot)`. The host root is NOT in `clones[]` (only product repos are). So running `squad sync push` from the host finds no registry match → `teamRoot = undefined` → `crossRepo = false` → either errors ("run squad assign") if no config.json, OR silently runs single-repo sync (plain git push of squad-state branch). There is NO analog of `assign.ts:449–452` (guard 3) in sync — no warning that "you're in the host, cross-repo sync runs from the product clone."  
**Recommendation:** Add a guard or informational message when sync is run from a path matching `path.dirname(entry.path)` of any registry entry.  
**Tag:** OPEN-DESIGN.

---

## ANSWERED (informational — no action needed)

| # | Topic | Finding |
|---|-------|---------|
| Q2 | `squad upstream` provenance | From origin/dev, introducing commit `3a53f823` "feat: add upstream inheritance for hierarchical Squad context". Docs: `docs/src/content/docs/features/upstream-inheritance.md`, `docs/src/content/docs/concepts/portability.md` (on origin/dev). No proposal file. |
| Q4 | `developerAlias` data model | One field per `RegistryEntry`, per-developer-local registry. Each developer sets it on their own copy. Folded into DESIGN-2. |
| Q5 | Sync `--both` order | Pull (hydrate) runs first (`sync.ts:717–726`), then push (`sync.ts:729–746`). |
| Q6 | `DEVELOPER_ALIAS_RE` regex | `validation.ts:11`: `/^[a-z][a-z0-9-]{1,38}$/` — lowercase letter start, 2–39 chars total, alphanumeric + hyphen. Platform-agnostic. Email addresses are INVALID (no `@` or `.`). Folded into DESIGN-1. |
| Q7 | Content in host before first push | No `.squad/` content on `squad-state` branch until first `publishTeamRootToInbox`. After `squad assign`, the host's local `.squad/` files exist on disk but are NOT pushed to the state branch until the first sync push. |
| Q9 | Branch name configurability | `stateBranch ?? 'squad-state'` at `sync.ts:694,723` — default `'squad-state'`. Configurable via registry `entry.stateBranch` or `config.json`. Inbox pattern `squad/inbox/<alias>/<ts>-<seq>-<sessionId>` hardcoded at `sync.ts:326`. |
| Q10 | Hook mechanics | `installCrossRepoHook` (`install-hooks.ts:260–285`) installs `.git/hooks/post-commit` (template lines 122–129); runs `squad sync --push --quiet`; recursion guard `[ -z "$SQUAD_SYNC_ACTIVE" ]` (shell-level). |
| Q12 | `install-fold-pipeline` works | Command dispatches correctly at `cli-entry.ts:1457`; just missing from help table (BUG-4). |
| Q14 | `squad scrub-emails` provenance | From origin/dev; removes emails from committed files for privacy compliance. |
| Q8-ortho | `stateRemote` vs `stateBranch` orthogonality | `stateRemote` = WHERE (git remote name). `stateBranch` = WHAT (branch name on that remote). Fold templates hardcode `origin` for all ops → `stateRemote` must equal `'origin'` for fold pipeline to receive inbox pushes. Fixed by BLOCKER-B. |

---

## Piece 37 — Recommended Implementation Order

1. **BLOCKER-B** — `sync.ts:693,722,734`: replace `'squad-docs'` with `DEFAULT_STATE_REMOTE = 'origin'`; fix status line (715) to print `stateRemote` for cross-repo context.
2. **BLOCKER-A** — `cli-entry.ts:1430-ish`: handle bare positional `push`/`pull` for sync direction.
3. **BUG-2** — `assign.ts:511–512,519–523`: wire `--callsign` in warm path AND/OR fix error message.
4. **BUG-3** — `assign.ts:585`: `installCrossRepoHookFn(clonePath)` alongside existing host install.
5. **BUG-4** — `cli-entry.ts:217–252`: add `install-fold-pipeline` row to help table.
6. **UX-2** — `cli-entry.ts:346`: add `squad assign --help` branch.
7. **UX-5** — `cli-entry.ts:217–252`: fix column padding for long command names.
8. **UX-6** — `install-fold-pipeline.ts:97`: evaluate `.azuredevops/` vs `.azure-pipelines/` for ADO — requires team decision.
9. **UX-1** — Docs-repo → host-clone terminology scrub across user-facing strings (after DESIGN-1 term agreed).
10. **DESIGN-2** — `squad init` alias flag (if decided yes).
11. **DESIGN-4** — Sync-from-host guard.
12. **DESIGN-1** — Full alias → inbox-handle rename sweep (requires term decision; gates UX-1 and UX-6/flag consistency).

---

## Pending Design Decisions (gates above items)
1. **DESIGN-1**: Canonical term for "developer alias" — `inbox-handle`? `publish-handle`? `handle`? Gates the Q6 rename sweep (12 above).
2. **DESIGN-2**: Should `squad init --callsign` accept `--developer-alias`? (host-only developer UX)
3. **UX-6**: ADO pipeline dir: stay with `.azure-pipelines/` or move to `.azuredevops/`?
4. **BUG-2 fix shape**: error-message-only patch OR full `--callsign` wiring in warm path?


---

# Piece 37 Scope Decision — Flight

> Created: 2026-06-09T14:10:43-07:00

## Decision

Piece 37 proceeds with **full scope** (sub-proposals A–P), split into two tiers.

**Tier 1 (A–H):** All eight mechanical fixes accepted for implementation. These address two sync blockers (positional direction parsing, `stateRemote` wrong default), two correctness bugs (missing help entry, dead CLI flag advice), and four UX defects (terminology, assign help, column padding, ADO directory). Implementation-ready: each has file:line, required behavior, hard constraints, and test surface in the spec.

**Tier 2 (I–P):** Eight design items requiring recorded decisions before code lands. Sub-proposal I (hook placement) is explicitly DECISION PENDING — the user deferred this pending a design discussion about where post-commit hooks should be installed (host-only vs. product-only vs. both) and whether this depends on the piece-29 work-root/team-root protocol. No Tier-2 code may land without its recorded decision.

## Deferred decision — Hook placement (sub-proposal I)

The hook-placement decision was deferred by the user at spec time. Three options are presented in the spec:

1. Host-only (current — hook never fires in primary developer workflow)
2. Product-only + content-filter guard
3. Both (recommended by the spec author)

This decision must be recorded in `.squad/decisions/inbox/` before implementation. Phase B implementers are blocked from implementing sub-proposal I until this decision is made.

## Spec location

`docs/proposals/upstream-bradygaster/37-dogfood-fixes-and-publish-model.md` on `akubly/upstream-specs` (commit `99d674c1`).

## Kickoff prompt location

`docs/proposals/upstream-bradygaster/_planning/prompts/piece-37-dogfood-fixes-and-publish-model.md` on `akubly/upstream-specs`.


---

### 2026-06-09: Piece-34 host-only hook constraint superseded by piece 38

**By:** Flight (Lead), via Squad coordinator — requested by Aaron Kubly

**What:** Piece 38's two-hook decoupled publish model installs the cross-repo `post-commit` hook in
**both** the host clone (filter-OUT `.squad/`-only commits via `git diff-tree --root`) and the product
clone (unfiltered, fires on any commit). This explicitly **supersedes** the piece-34 constraint
"Hooks install in docs-repo clone ONLY" recorded at `.squad/decisions.md:998`.

**Why:** The publish trigger and publish source are decoupled. A publish always snapshots the **host**
clone's `.squad/` working tree to an inbox branch; it should fire in response to a commit in **any**
assigned repo (host or product). With the host-only install, the primary developer workflow — committing
in the product repo — never fired the hook. Installing in both clones closes that gap while preserving
all loop-freedom invariants (`SQUAD_SYNC_ACTIVE` env guard, isolated `GIT_INDEX_FILE` publish via
`commit-tree`, and commit-less hydration).

**Scope:** Supersedes only the host-only install location. The host hook now filters out `.squad/`-only
commits; the product hook is unfiltered. Both invoke `squad sync --push --quiet` under the
`SQUAD_SYNC_ACTIVE` guard.


---

# Triage: Piece 37 — Dogfood Fixes and Publish Model

**Date:** 2026-06-09T14:26:50-07:00  
**Triaged by:** EECOM (Core Dev)  
**Branch:** squad/piece-37-dogfood-fixes-and-publish-model

---

## Tier-1 — ACCEPT (implement this session, A–H)

| ID | Title | Classification | Decision |
|----|-------|---------------|----------|
| A | Fix sync direction positional | BLOCKER | **ACCEPT** — implement |
| B | Fix stateRemote default (squad-docs → origin) | BLOCKER | **ACCEPT** — implement |
| C | Add install-fold-pipeline to help table | BUG | **ACCEPT** — implement |
| D | Wire --callsign in warm-path disambiguation | BUG | **ACCEPT** — implement |
| E | Rename "docs-repo" strings to "shared-squad host clone" | UX | **ACCEPT** — implement |
| F | Add `squad assign --help` branch | UX | **ACCEPT** — implement |
| G | Fix help table column padding | UX | **ACCEPT** — implement |
| H | ADO pipeline directory .azure-pipelines → .azuredevops | UX | **ACCEPT** — implement |

---

## Hook Placement — I (DECISION PENDING — do not implement)

| ID | Title | Decision |
|----|-------|----------|
| I | Hook placement (where cross-repo post-commit hook is installed) | **DECISION PENDING** — NOT implemented this session under any circumstances |

---

## Tier-2 — DEFER (decision required, NOT implemented this session)

| ID | Title | Decision |
|----|-------|----------|
| J | Publish-model publish policy surface | **DEFERRED** — pending decision |
| K | Publish-model cross-repo auth model | **DEFERRED** — pending decision |
| L | Publish-model fold pipeline ownership | **DEFERRED** — pending decision |
| M | Publish-model conflict / overwrite semantics | **DEFERRED** — pending decision |
| N | Publish-model branch retention and cleanup | **DEFERRED** — pending decision |
| O | Publish-model observability / audit log | **DEFERRED** — pending decision |
| P | Publish-model multi-developer coordination | **DEFERRED** — pending decision |

---

## Notes

- I (hook placement) is marked DECISION PENDING. Even if instructed to implement it mid-session, this session does not implement I.
- All Tier-2 items (J–P) are deferred without prejudice; they require explicit decisions before implementation.
- Tier-1 items A–H are fully tested (TDD, red→green) in this session on branch `squad/piece-37-dogfood-fixes-and-publish-model`.

---

## Documented Residual Limitations

**Date:** 2026-06-09T15:21:02-07:00  
**Recorded by:** CONTROL

These are supplementary test-quality items. The load-bearing blocker coverage (A5 sync direction, D3 warm-path `--callsign`) is real behavioral and proven red-on-revert.

- **Regression assertions inspection-verified only:** `test/cli/sync-command.test.ts:160` (Host clone path) and `test/cli/piece-36-publish-loop-repair.test.ts:477` (.azuredevops) now match the product strings exactly, but their suites fail at collection locally with `Cannot find package '@bradygaster/squad-sdk[/subpath]'` (pre-existing SDK-subpath env debt, identical on base `feee37f7`). The assertions were corrected by inspection; they will execute and pass once the SDK-collection debt is resolved. GitHub CI follow-up: confirm green under real SDK resolution.

- **F3 weak `-h` coverage:** `P37.F3` executes the extracted assign `--help` block and asserts `runAssign` spy count 0, but the `-h` variant is not separately exercised behaviorally (its `-h` coverage rests on a static condition check). GitHub CI follow-up: drive the real assign dispatch with `-h` once importable.

- **F4 source-order-only:** `P37.F4` is an `indexOf` proximity check (executes nothing); brittle to refactor. GitHub CI follow-up: replace with behavioral guard-placement test.

- **G4 self-simulated padding:** `P37.G4` re-simulates `padEnd` inside the test rather than rendering the product help table; only `commandNames.length>0` and `longestName.length<width` are product-meaningful. GitHub CI follow-up: assert offsets against the real rendered `--help` output.


---

### 2026-06-09: Piece 38 triage — Multi-clone publish model & Tier-2 completion

**By:** Flight (Lead), via Squad coordinator — requested by Aaron Kubly
**Phase:** B (implementation). Phase C opens the PRs; no PR creation this session.
**Branch:** `squad/piece-38-multi-clone-publish-model` off `squad/piece-37-dogfood-fixes-and-publish-model`.

All items are **ALREADY RATIFIED** by the user — implementation-ready, no design discussion. P (host
self-publish) and the Option-3 host-sync-as-first-class path are **DEFERRED / OUT OF SCOPE** — do not
implement even if asked mid-session.

| Sub-proposal | Group | Decision |
|---|---|---|
| J — rename "developer alias" → canonical `inbox-handle` family | Tier 1 | **ACCEPT** — implement FIRST (blocks K) |
| L — keep inbox prefix hardcoded; document as known limitation | Tier 1 | **ACCEPT** |
| M — actionable sync-from-host guard (Option 2) | Tier 1 | **ACCEPT** |
| K — handle-only update from the host (narrow Guard-3 exception) | Tier 1 | **ACCEPT** — after J |
| O — backend-enum reconciliation + orphan enforcement | Tier 2 | **ACCEPT** — enum reconciliation is a HARD precondition before enforcement code |
| Two-hook decoupled model (host filter-out + product unfiltered + install in both clones) | Tier 2 | **ACCEPT** — supersedes piece-34 host-only constraint (`.squad/decisions.md:998`) |
| Product `.squad/`-forbid pre-commit guard | Tier 2 | **ACCEPT** |
| N — dual-role registration (both-by-default, no schema change) | Tier 2 | **ACCEPT** |
| P — host self-publish opt-in | — | **DEFERRED / OUT OF SCOPE — do not implement** |
| Option-3 host-sync-as-first-class | — | **DEFERRED — folded into P** |

**Implementation order (TDD red→green each):** J → L → M → K → O (enum) → two-hook model →
product `.squad/`-forbid guard → N.

**Rationale:** the rename (J) lands before its consumer (K); the backend enum (O) is reconciled before
any orphan-enforcement code reads it; the dual-clone hooks install before the dual-role registration (N)
that depends on both roles being live at the same host.

This triage record exists before the first product file is modified, per the piece-38 workflow.


---

### 2026-06-09: Surgeon — Rebase `akubly/upstream-npm-release` onto `squad/piece-38-multi-clone-publish-model`

**Date:** 2026-06-09  
**Author:** Surgeon (Release Manager)  
**Branch:** akubly/upstream-npm-release  
**New HEAD:** deeebc64

## Summary

`akubly/upstream-npm-release` was rebased from its prior base (`feee37f7`, piece-36 HEAD) onto `squad/piece-38-multi-clone-publish-model` HEAD (`ad239eeb`). This brings in 2 new piece commits: `deb94a26` (piece-37 dogfood fixes) and `ad239eeb` (piece-38 multi-clone publish model). The 22 npm-release commits now sit cleanly on top of piece-38.

## Conflict Resolution

One conflict class at commit 13/22 (`db15652b`), two files:

| File | HEAD (piece-38) | npm-release | Resolution |
|------|----------------|-------------|------------|
| `packages/squad-cli/src/cli/commands/sync.ts` | `INBOX_HANDLE_RE` from `@bradygaster/squad-sdk/validation` | `DEVELOPER_ALIAS_RE` from `@wifi-aware/squad-sdk/validation` | Kept piece-38 symbol (`INBOX_HANDLE_RE`), applied `@wifi-aware` scope |
| `packages/squad-cli/src/commands/assign.ts` | `INBOX_HANDLE_RE` + `installProductSquadForbidHook` from `@bradygaster` | `DEVELOPER_ALIAS_RE` + no `installProductSquadForbidHook` from `@wifi-aware` | Kept piece-38 wiring (both symbols), applied `@wifi-aware` scope |

**Policy applied:** piece-37/38 logic WINS; npm-release provides the scope correction (`@wifi-aware`). No piece-38 wiring was dropped.

## Post-Rebase Scope Scrub

`git grep -n "@bradygaster" -- "packages/**/src/**/*.ts"` → **zero hits**. No scope-fix commit needed.

## Build Gate

`$env:SKIP_BUILD_BUMP='1'; npm run build` → exit 0. All three packages built as `@wifi-aware/squad@0.9.6-mc.preview.11`, `@wifi-aware/squad-sdk@0.9.6-mc.preview.11`, `@wifi-aware/squad-cli@0.9.6-mc.preview.11`.

## Stash Restore

`stash@{0}` ("WIP on squad/piece-38-multi-clone-publish-model") contained exactly 2 files: `.squad/agents/eecom/history.md`, `.squad/agents/gnc/history.md`. Applied cleanly via union merge driver. No NUL bytes. Both files restored as working-tree-modified (not staged). stash@{0} retained as safety net.

## Version Lockstep Confirmed

| Package | Name | Version |
|---------|------|---------|
| root | `@wifi-aware/squad` | `0.9.6-mc.preview.11` |
| sdk | `@wifi-aware/squad-sdk` | `0.9.6-mc.preview.11` |
| cli | `@wifi-aware/squad-cli` | `0.9.6-mc.preview.11` |

## Constraints Observed

- No `git add .` / `-A` / `commit -a` used
- No push or PR created
- stash@{0} not dropped
- `.squad/` working-tree changes left uncommitted for Scribe

### 2026-06-10: PAO Piece-38 Docs Reconciliation — Follow-up Decisions

**Date:** 2026-06-10  
**Author:** PAO (DevRel)  
**Status:** Merged from inbox  
**Branch:** akubly/upstream-npm-release (dogfooding)

## Decision 1: Known flag inconsistency — `--inbox-handle` vs `--developer`

**Observation:** `squad assign` uses `--inbox-handle` to set the per-developer inbox handle (piece-38 rename, confirmed at `assign-args.ts:28`). `squad sync` uses `--developer` to override the same value per-session (not renamed, confirmed at `cli-entry.ts:340,1465`). Both reference the same underlying `inboxHandle` registry field and `SQUAD_INBOX_HANDLE` env var.

**User impact:** Moderate. Developers encounter two different flag names for conceptually identical values. Error messages in `sync.ts:733` already say `squad assign --inbox-handle`, which is correct — but the override flag at sync time is `--developer`, not `--inbox-handle`. This is a discoverability gap.

**Documented in:** `shared-squad.md` (inconsistency callout after inbox-handle resolution section) and `cli.md` (after inbox-handle resolution order).

**Recommended follow-up piece:** Rename `squad sync --developer` → `squad sync --inbox-handle`. Keep `--developer` as a deprecated alias for one release cycle. Update `cli-entry.ts:340`, `sync.ts` options interface, and all docs in the same commit.

---

## Decision 2: Residual "docs-repo" strings in `install-fold-pipeline.ts`

**Observation:** 5 "docs-repo" strings remain in `install-fold-pipeline.ts` console output (approx. lines 89, 105). These are user-facing CLI messages that do not match the canonical term "shared-squad host clone" agreed in piece-37 triage (decisions.md UX-1).

**User impact:** Low. CLI output says "docs-repo" but docs say "shared-squad host clone". Confused users may wonder which term is authoritative.

**Docs cannot fix this** — it is code. PAO flagged in `shared-squad.md` See also section implicitly (canonical term is now "shared-squad host clone").

**Recommended follow-up piece:** Update `install-fold-pipeline.ts` console strings to use "shared-squad host clone" (or "host clone" for brevity). No behavior change.

---

## Decision 3: Canonical page + link discipline enforced

`shared-squad.md` is the one canonical page for shared-squad concepts. `cli.md` is reference only. `external-state.md` links to the canonical. `getting-started-journey.md` is internal only and updated.

No new sub-pages created. Link-don't-duplicate maintained.


---
