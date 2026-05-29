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
