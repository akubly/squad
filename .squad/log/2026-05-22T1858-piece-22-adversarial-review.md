# Session Log — Piece 22 Adversarial Review

**Date:** 2026-05-22T18:58:00-07:00  
**Session:** Scribe merge of adversarial review outcomes for piece 22 (doctor unification)  
**Participants:** FIDO (Quality Owner), CONTROL (TypeScript Engineer)  
**Branch:** squad/piece-22-unify-doctors  
**Commit:** ef09d3d3

---

## Adversarial Review Outcomes

### FIDO Verdict: 🛑 REJECT

**Blockers (2):**
1. **Warn findings to stdout** — cli-entry.ts:200–204 uses `console.log` for all severities; spec requires warn → stderr
2. **Missing cross-source severity escalation test** — Spec §5 mandates test scenario where system produces warn + registry produces error → exit 2; none of 5 new tests cover this

**Rationale:** Both are mechanical fixes (5 lines code, 10 lines test). Architecture is sound; cannot ship without these fixes.

**Reassignment:** CONTROL (TypeScript Engineer) — has precedent in piece 10 revision for output-routing + test coverage gaps.

**Lockout:** Flight locked out per strict protocol — may not author the revision.

---

### CONTROL Verdict: ⚠️ APPROVE-WITH-NITS

**Type-design verdict:** APPROVE-WITH-NITS (advisory, no blockers)

**Directives (3 recommended follow-ups):**
1. **Exit-code derivation needs `never` guard** — Current `.filter(f => f.severity === 'error')` lacks exhaustiveness. Extract a typed `deriveExitCode` helper with severity switch + never default.
2. **Source grouping needs exhaustiveness assertion** — Two `.filter()` calls for 'system' and 'registry'. If a third source is added, findings silently disappear. Add post-grouping assertion or switch to Map-based dispatch.
3. **DoctorFinding fields should be readonly** — Value objects should enforce immutability. Add `readonly` to all interface fields.

**Assessment:** `tsc --noEmit` clean, type contract matches spec §2.1. Directives are non-blocking follow-up guidance for the revision.

---

## Lockout State

**Flight (author) is locked out per strict protocol.**

FIDO rejection + CONTROL's nit findings → Flight cannot author the revision. Revision ownership transfers to CONTROL.

---

## Revision Plan

**Revision scope (estimated ~20 LOC net):**
1. cli-entry.ts: Route warn severity to `console.error()` (5 lines)
2. test/cli/doctor.test.ts: Add cross-source severity escalation test (15 lines)

**Optional follow-ups (for CONTROL discretion):**
- Implement Directive 1 (exit-code helper with `never` guard)
- Implement Directive 2 (source grouping exhaustiveness)
- Implement Directive 3 (readonly fields)

**Success criteria:**
- Both blockers resolved
- All existing tests still pass
- `npm run build` clean
- Changeset updated if needed

---

## Decision Records Written

Three files written for team consumption:

1. **`.squad/orchestration-log/2026-05-22T1858-fido.md`** — FIDO's blocking findings + pattern learning
2. **`.squad/orchestration-log/2026-05-22T1858-control.md`** — CONTROL's type-design directives + non-blocking guidance
3. **`.squad/decisions.md`** — Merged and deduplicated entries:
   - `### 2026-05-22: Piece 22 Doctor Unification — FIDO Rejection & Reassignment`
   - `### 2026-05-22: Type-Design Directives — Piece 22 Doctor Unification`

---

## Cross-Agent Updates

**Flight history:** Updated with rejection + lockout state  
**FIDO history:** Will be updated by FIDO agent  
**CONTROL history:** Will be updated by CONTROL agent  

---

## Next Steps (Coordinator Action)

1. **Notify CONTROL:** Piece 22 revision owner; blockers documented; revision scope ~20 LOC
2. **Lock Flight:** No further work on piece 22 until CONTROL completes revision + resubmission
3. **Track revision:** Monitor `.squad/orchestration-log/` and decisions.md for CONTROL's revision progress

---

**Scribe:** Processed adversarial review outcomes, merged decision inbox, wrote orchestration logs.  
**Status:** READY FOR CONTROL REVISION

---

## Appendix — Full Blocking Issue Summaries

### Issue 1: Warn to Stdout

**Spec requirement:** §2.3 "warn → 0 (warnings to stderr)"

**Current implementation:**
```typescript
if (f.source === 'system') {
  console.log(`${prefix} ${f.label} — ${f.message}`);  // stdout
} else {
  console.log(`${prefix} ${f.message}`);               // stdout
}
```

**Comment contradiction:** Immediately above exit(2) block, comment says "Warnings go to stderr"

**Impact:** Piped tooling cannot distinguish warnings from info. Spec contract violated.

**Fix:** Use `console.error()` for `f.severity === 'warn'`

### Issue 2: Missing Unified Severity Test

**Spec requirement:** §5 "New Tests Needed" — "A test where system doctor produces a `warn` and registry doctor produces an `error` → overall exit code is 2"

**Core claim:** Cross-source severity escalation (the point of unification)

**Current test coverage:** 5 new tests, all use healthy scaffold (zero errors)

**Gap:** No scenario testing escalation logic

**Fix:** Add one test with:
- System findings: warn-severity
- Registry findings: error-severity  
- Assertion: exit code 2

**Estimated code:** ~15 lines test

---

**Scribe session:** 2026-05-22T18:58:00-07:00
