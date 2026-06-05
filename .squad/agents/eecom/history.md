# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Current Status (as of 2026-06-05)

**Active Phase:** Phase B, Pieces 21-35 arc  
**Latest completion:** Piece 25.5 (Doctor cleanup, test regression repair) — Commit `e3456eb2`  
**Next piece:** Piece 26+ (Registry state + client-side publish triggers staged on akubly/upstream-specs)  
**Key dependencies:** Resolver rename (Piece 25), test isolation, platform-adapter fallback patterns

**Core patterns maintained:**
- Registry module = schema+disk-I/O boundary; resolver logic deferred downstream
- Template sync excludes `.copilot/skills/` — manual propagation required
- Cherry-picks from insider branches require dropping insider-only module references

**Scrub-gate baseline:** Pre-existing failures acknowledged (Squad's own `/casting/`, `/identity/`, `orchestration-log` templates match strip-list pattern; accepted per decisions-archive.md)

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

## Recent Pieces — Phase B Active

### Piece 25.5 — Doctor-cleanup test regression repair (2026-06-04)

**Branch:** `akubly/upstream-25.5-doctor-cleanup-test-regression-repair.md`  
**Commit:** `e3456eb2` (amended from 515ade7a for version drift)

Six sub-proposals shipped (A–G) fixing test regressions and upstream-divergence issues. Key decisions: fix-code over adjust-test (assign.ts error message, removing stale `squad register` substring that collided with test exclusion regex); adjust-test when tests tracked fork-introduced bugs (platform-adapter fallback from 'unknown' to 'github'); test quality fix (consult.test.ts registry isolation guard). Build green, gates baseline-only (pre-existing failures verified, no new violations). See `.squad/decisions.md` → 2026-06-04 for full patterns.

### Piece 25 — Resolver rename and CLI hardening (2026-05-28)

**Commit:** `185617e51e215dfbf59415a688ff9e1b9fd9a9af` (EECOM revision)

Folded approved nits: CONTROL N1 typed internal `resolveSquad` alias as `typeof resolveSquadDir`; FIDO N2 added `@ts-expect-error` renderFinding exhaustiveness regression; FIDO N3 refreshed stale comments. Gates green after controlling known nested SDK dependency skew; test baseline matches piece-25 review. Revision complete; EECOM locked out by Flight.

### Piece 24 — SDK adapter OTel typing (2026-05-27)

**Commit:** `0325a335` (FIDO nit resolution)

Addressed N1–N4: setAttribute/isRecording assertions; startActiveSpan arity coverage (2,3,4-arg forms); restored Tracer/Meter type annotations by widening OTelSpanLike surface; fixed lifecycle.ts indent. Key surprise: TypeScript covariant return type check catches recordException → OTelSpanLike vs real Span → void. Final: ~+53 net LOC. Gates: all pass.

### Piece 23 Revision (2026-05-27)

Addressed F1, F4, N1, N2: Added `.git`-absent test; renamed `hasCopilot` → `agentEnabled`; fixed qrcode-terminal.d.ts export; added env seam to `resolveSquadDir`. Skipped F2 (false-positive on filename convention) and F3 (audit-trail churn not worth cosmetic gain). Final: ~+30 net LOC.

## Team Updates — Recent

📌 **2026-05-27 Piece 23 Revision Complete + Piece 24 Spec Ready:** EECOM completed piece 23 revision with all nits addressed (F1–F4 applied, F2 false-positive documented). All gates green. Flight authored piece 24 spec + handoff. Decisions merged, orchestration logs prepared.

📌 **2026-05-19 Piece 18 Revision Complete:** CONTROL completed piece 18 revision under Strict Lockout Protocol (EECOM locked out). Applied F1–F7 fixes + N1–N5 nits. 33 unit + 7 CLI tests GREEN. Build CLEAN. Re-verify flight for Flight (architecture) and FIDO (test/build/scrub).

📌 **2026-05-18 Piece 14 Revision Complete:** All findings addressed (git `--` separator, typed error codes, CLI `--flag=value` parsing, exhaustiveness guards). Build CLEAN, 47 tests GREEN. Branch ready for Phase C.

📌 **2026-05-15 Piece 09/10 Revisions:** Both completed independent revision cycles post-rejection. All blocking gaps closed. Decisions merged.

## Learnings

### Recent Pieces Summary (Pieces 23-32)

**Piece 32 (2026-06-05) — Registry state fields** ✅  
- 3 sub-proposals shipped: A (RegistryEntry interface extension with stateRemote/stateBranch/developerAlias), B (assign flags --state-remote/--state-branch/--developer-alias with warm+cold path persistence and additive re-assign merge), C (DEVELOPER_ALIAS_RE validation module, INVALID_ALIAS error code)
- Key structural decision: thread `writeRegistryFn` injectable through `_warmPath` (same discipline as `_coldStart`) to enable test interception of warm path writes; previously warm path called `writeRegistry` directly
- Validation module location: `packages/squad-sdk/src/validation.ts` — avoids circular dependency; importable from CLI via `@bradygaster/squad-sdk/validation` subpath export added to SDK package.json exports map
- Alias validation fires at top of `runAssign` before any registry read — fail-fast pattern preserves no-side-effect guarantee on bad input
- Additive merge via conditional spread: `...(opts.stateX !== undefined ? { stateX: opts.stateX } : {})` — cleanest way to omit fields explicitly vs writing `undefined`
- Commit `f35fa9b5`; 25 new tests GREEN; scrub gate: Gates 2–9 PASS, Gate 1 baseline-only (pre-existing strip-listed paths)

**Piece 25.5 (2026-06-04) — Doctor cleanup** ✅  
- 6 sub-proposals shipped; fix-code over adjust-test pattern applied
- Registry isolation in spawn-based tests; stale local node_modules detection; unwired-command defect prevention
- Commit `e3456eb2` (amended from 515ade7a for version drift); build clean, gates baseline-only

**Piece 25 (2026-05-28) — Resolver rename + CLI hardening** ✅  
- Renamed `resolveSquad` → `resolveSquadDir` per D-18; public API via `typeof` alias; SDK + CLI tsc clean
- FIDO nit N2 added `@ts-expect-error` renderFinding exhaustiveness regression guard
- CONTROL N1 typed internal alias as `typeof resolveSquadDir`; gates green after controlling nested SDK dependency skew

**Piece 24 (2026-05-27) — SDK adapter OTel typing** ✅  
- Added `setAttribute`/`isRecording` assertions; 3-arity `startActiveSpan` coverage (2, 3, 4-arg forms)
- Restored Tracer/Meter type annotations by widening OTelSpanLike (recordException return type, addEvent params)
- Nit N4: fixed lifecycle.ts indent; final ~+53 net LOC; gates all pass

**Piece 23 (2026-05-27) — Options-bag seam + Nit follow-up** ✅  
- Added `.git`-absent test boundary; renamed `hasCopilot` → `agentEnabled` (4 sites in watch/index.ts)
- Fixed qrcode-terminal.d.ts export idiom; added env seam to `resolveSquadDir` for future-proofing
- Final ~+30 net LOC; gates clean

**Piece 21 (2026-05-22) — Ship gate cleared** ✅  
- All 5 required FIX-* items shipped; FIX-6, FIX-7, FIX-8 deferred to piece 22

### Pattern Learnings — Core Stack

## Archive

Older context (pieces 9–19, Q1–Q2 2026) archived to `history-archive.md`: Copilot payload orchestration, doctor enhancements, fuzzy-match utility, squad init refactor, squad unassign, and pre-Phase B lifecycle patterns.

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

---

**Piece 24 Rev Complete — All FIDO Nits Closed (2026-05-27T22:35Z)**  
✅ All items (N1–N5) addressed. Stack ready for Brady flow. See `.squad/decisions.md` → 2026-05-27 EECOM entry for full details. Commit `0325a335` passed all gates. Lockout on piece-24 lapses when this rev is accepted.

📌 **2026-06-04 Piece 25.5 Complete — Doctor-Cleanup Test Regression Repair**  
✅ Six sub-proposals shipped (A–G). Explicit decisions documented: fix-code over adjust-test (assign.ts error message, correcting stale substring that collided with test exclusion regex); adjust-test when tests tracked fork-introduced bugs (platform-adapter fallback from 'unknown' to 'github'); test quality fix (consult.test.ts registry isolation guard). Commit `e3456eb2` (amended from 515ade7a for version drift). Build green, gates baseline-only. See `.squad/decisions.md` → 2026-06-04 for full decision patterns.

📌 **2026-06-05: Specs 32-35 staged on akubly/upstream-specs (commit 211102b4). New cross-repo arc kickoff is piece 32 (off piece 25.5). Replaces archived pieces 26-31. See upstream specs for design + prompts at _planning/prompts/.**

📌 **2026-06-05 Piece 32 Complete — Registry State Fields**  
✅ All three sub-proposals shipped (A: RegistryEntry interface extension with stateRemote/stateBranch/developerAlias; B: squad assign flags with warm+cold path persistence and additive re-assign merge discipline; C: DEVELOPER_ALIAS_RE validation module with subpath export). Key structural decision: thread writeRegistryFn injectable through _WarmCtx to enable test interception of warm path writes (same discipline as _coldStart, additive with no production behavior change). Alias validation fires at top of runAssign before registry read — fail-fast pattern. Additive merge via conditional spread `...(opts.stateX !== undefined ? { stateX: opts.stateX } : {})` preserves no-undefined-in-JSON guarantee. Commit `f35fa9b5` — 25 new tests GREEN (P32.R1–R3, P32.V1–V10, P32.A1–A9 + P32.B1–B3). Scrub gate: Gates 2–9 PASS, Gate 1 baseline-only (pre-existing strip-listed paths, byte-for-byte identical on baseline commit 92139e5b). FIDO verification complete: zero real regressions (22 apparent regressions confirmed as resource contention via isolation spot-checks). Verdict: APPROVE-WITH-NITS (two cosmetic cleanup nits flagged, do not block). Phase B protocol followed (commit + push, no PR). Piece 32 gate-cleared and ready for stack progression.
