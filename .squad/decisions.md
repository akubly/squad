# Decisions

> Team decisions that all agents must respect. Managed by Scribe.


---

### 2026-05-28: User directive — push policy

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
