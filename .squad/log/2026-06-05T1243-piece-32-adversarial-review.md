# Session Log: Piece 32 Adversarial Peer Review

**Date:** 2026-06-05T12:43  
**Topic:** Adversarial review of piece 32 (registry state fields)  
**Branch:** `squad/piece-32-registry-state-fields`, commit `f35fa9b5`  
**Requested by:** akubly  

## Summary

Two independent adversaries (CAPCOM SDK Expert and CONTROL TypeScript Engineer) conducted parallel adversarial peer reviews of piece 32. Both verdicts converge on **APPROVE-WITH-NITS** with no blocking defects.

## What Was Reviewed

Piece 32 implementation: three new registry state fields (`stateRemote`, `stateBranch`, `developerAlias`) added to `RegistryEntry` interface. Both warm and cold paths persist fields via conditional spreads. New `DEVELOPER_ALIAS_RE` validation module with subpath export. Validation enforces regex at start of `runAssign`. Test count: 25 new tests all GREEN.

## CAPCOM Verdict: ⚠️ APPROVE-WITH-NITS

### Critical hypothesis — RE-ASSIGN PRESERVATION: CLEARED ✓
Both `_warmPath` and `_coldStart` entry construction spreads existing fields first (`...entry`), then overlays conditional spreads. Existing `stateRemote`/`stateBranch`/`developerAlias` values survive when options absent. Test P32.A5 verified as genuine disk round-trip (writeRegistry → loadRegistryFromDisk → validate).

### Findings
- **M1 — maintenance risk:** `package.json` brace indentation broken around `./validation` entry; valid JSON but visually suggests nesting
- **M2 — spec defect:** `INVALID_ALIAS` error code violates `ERR_ASSIGN_*` convention; recommend spec errata to rename `ERR_ASSIGN_INVALID_ALIAS` before piece 33/34 adoption
- **L3 — coverage gap:** No test for cold-start re-assign preservation with existing `stateRemote`; code is correct, test missing
- **L4 — doc placement:** `validation.ts` JSDoc misplaces stateRemote/stateBranch defaults; these are piece 33 consumer semantics

## CONTROL Verdict: ⚠️ APPROVE-WITH-NITS

### Critical hypothesis — REGEX STATEFULNESS: CLEARED ✓
Regex `/^[a-z][a-z0-9-]{1,38}$/` has no flags; repeated `.test()` calls return consistent results. No `lastIndex` advancement on success.

### Type & Build Status
- SDK tsc: exit 0, zero errors under strict+noUncheckedIndexedAccess
- CLI tsc: exit 2 but all failures pre-existing (stale node_modules); piece 32 introduces zero new type errors
- Build emit: both `dist/validation.js` and `dist/validation.d.ts` exist ✓
- All 79 SDK tests GREEN

### Findings
- **N1 — forward-risk:** Regex accepts trailing/consecutive hyphens; forward-risk for piece 33/34 branch naming (`squad/inbox/ab-/...` ambiguous); pieces 33/34 must sanitise or tighten
- **N2 — DRY:** Error message hardcodes regex source instead of `DEVELOPER_ALIAS_RE.source`
- **N3 — doc placement:** `validation.ts` JSDoc misplaces defaults (convergent with CAPCOM L4)
- **N4 — cosmetic:** `package.json` indentation inconsistency (convergent with CAPCOM M1)
- **N5 — coverage:** No test asserts trailing-hyphen acceptance as explicit contract

## Convergent Nits

Both reviewers independently flagged:
1. `package.json` indentation cosmetic (M1 / N4)
2. `validation.ts` JSDoc misplacement (L4 / N3)

CONTROL additionally flagged forward-risk N1 (trailing-hyphen branch naming) as most consequential for pieces 33/34.

## Deferred Decisions

**Regex trailing-hyphen tightening:** Binding-spec deviation deferred to piece 33/34. Pieces 33/34 must decide: sanitise at branch-name interpolation time, or tighten regex to `/^[a-z][a-z0-9]([a-z0-9-]*[a-z0-9])?$/` to prohibit trailing/consecutive hyphens.

## Hygiene Flag

**Scribe prior local commit 3b6892da (NOT pushed)** accidentally swept:
- `package-lock.json`
- root `package.json`
- `.github/agents/squad.agent.md`
- `test-fixtures/.gitignore` deletion

This hygiene item flagged for cleanup; no action in this run (commit exists locally only).

## Outcome

✅ **Piece 32 cleared for merge.** No blockers. Nits are cosmetic, spec-errata, or forward-risk — none require piece-32 rework. CAPCOM and CONTROL findings documented for spec errata and pieces 33/34 planning.

---

**Scribe note:** Decisions merged to `.squad/decisions.md`; orchestration logs written; cross-agent history appended.
