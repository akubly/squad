# Session Log: Piece 40 Adversarial Review and Revision

**Date:** 2026-06-12
**Duration:** Session (coordinated by Flight)
**Topic:** Piece 40 (callsign-namespaced transport) — Adversarial review panel + non-author revision + landing
**Outcome:** APPROVE → landed as commit 5cf4f26f, force-pushed to squad/piece-40-callsign-namespaced-transport, no PR.

---

## Manifest

### Adversarial Review Panel (3 independent reviewers; author EECOM locked out)

**RETRO (Security)**
- Model: gemini → claude
- Verdict: **PASS**
- Findings: 1 MEDIUM (init unvalidated callsign) + 2 LOW
- Confirmed: CALLSIGN_RE anchored, no YAML injection, push-side fail-closed, no PII/ReDoS

**FIDO (Quality)**
- Initial verdict: **BLOCK** (4 findings: H assign-stateBranch default missing, M orphan branch, M substring tests, M INT1 cross-contamination)
- Post-revision verdict: **PASS**
- All findings addressed by CONTROL; quality baseline met

**Neutral Reviewer (Code Review, gpt-5.4)**
- Initial verdict: **BLOCK** (2 HIGH: H1 global fold enumeration, H2 assign cold-start no namespaced stateBranch)
- Post-H1-fix verdict: **RAISE FOLLOW-ON HIGH** (H3 URL-derived callsign bypass)
- Post-Option-B-guard verdict: **PASS** (all HIGH resolved by stateBranch regex validation)

### Flight Arbitration (Release Lead)

**Ruling:** Option B (guard stateBranch default on CALLSIGN_RE validity; no hard-throw, no regression)
- Root cause: stateBranch was not validated on initialization
- Mitigation: Guard defaults on regex check; fallback to `squad-state` (backward-compatible)
- Security boundary: Init-time callsign validation; derived callsign must pass CALLSIGN_RE
- Regression risk: None (single-squad path unchanged; fallback is safe)
- **Outcome:** APPROVE (all HIGH/MED issues resolved)

### CONTROL Revision (Non-author TypeScript Engineer; EECOM locked out)

**Revisions applied:**

1. **H1 — Fold enumeration scoping (both platforms):**
   - GitHub template: glob `squad/inbox/**` → `squad/inbox/{callsign}/**`
   - ADO template: ref pattern `refs/heads/squad/inbox/*` → `refs/heads/squad/inbox/{callsign}/*`
   - Fold target: `squad/state/{callsign}` (callsign-scoped)
   - Fallback: Absent `--callsign`, templates byte-identical to originals

2. **H2 — Assign stateBranch default guard:**
   - Guard: `if (CALLSIGN_RE.test(resolvedCallsign)) stateBranch = squad/state/{callsign}`
   - Fallback: Invalid callsign → retain `squad-state` (backward-compatible)

3. **M3 — Init callsign validation:**
   - Init flow: Validate callsign against CALLSIGN_RE before write

4. **M5 — Byte-identical template tests:**
   - GitHub + ADO: Verify output unchanged when `--callsign` absent

5. **M6 — INT1 cross-contamination assertion:**
   - Cross-squad sync test: Assert no state bleed between isolated callsigns

6. **Option-B implementation:**
   - H2-5: Derived callsign validation test (passes; regex check guards)
   - H2-6: Fallback to `squad-state` test (passes; backward-compatible)

**Re-review by panel:**
- RETRO: Security baseline maintained ✓
- FIDO: All 4 quality findings addressed ✓
- Neutral: All HIGH issues (H1/H2/H3) resolved ✓

### Surgeon Landing (Release Engineer)

**Actions:**
- Reset --mixed to ff86b81c
- Squashed 8 files to single commit 5cf4f26f
- Changeset: patch for @bradygaster/squad-cli + @bradygaster/squad-sdk
- Co-authored-by: EECOM (proposal) + CONTROL (revision)
- Force-push-with-lease: `git push --force-with-lease origin squad/piece-40-callsign-namespaced-transport`

**Verification:**
- Build: 0 errors
- Tests: 35 piece-40 + 16 cross-repo-sync = 51 green
- Scrub gate: 32 strip-paths baseline matched (Gate 2 PASS)
- No PR: Feature branch landing only

---

## Decision Record

**2026-06-12: Piece 40 Option B ruling**

Flight (Release Lead) arbitrated conflicting HIGH findings on piece 40 (callsign-namespaced transport). Neutral reviewer raised two architectural blocks:
- H1: Fold templates using global enumerations instead of callsign-scoped targets
- H2: Assign stateBranch not defaulting to namespaced form
- H3 (derived): URL-derived callsign could bypass scoped isolation

**Flight ruling:** **Guard stateBranch default on CALLSIGN_RE validity** (Option B).

**Rationale:**
1. Preserves backward compatibility (fallback to `squad-state` for unmigrated entries)
2. Scopes security boundary to initialization time (derived callsign validated at intake)
3. Mitigates bypass risk with no regression (single-squad path unchanged)
4. Simpler than Option A (no hard-throw; fail-safe by design)

**Consequences:**
- E (migration) remains deferred (no recorded decision; implementation gated)
- Piece 40 approved for landing
- No regression expected in cross-squad workflows

---

## Summary

| Phase | Outcome | Notes |
|---|---|---|
| **RETRO (Security)** | PASS | 1 MED + 2 LOW; security baseline viable |
| **FIDO (Quality) — Initial** | BLOCK | 4 findings (H/M/M/M); escalated |
| **Neutral (Code) — Initial** | BLOCK | 2 HIGH + follow-on H3; escalated |
| **Flight (Arbitration)** | APPROVE | Option B ruling; guarded stateBranch default |
| **FIDO (Quality) — Post-revision** | PASS | All 4 findings addressed |
| **Neutral (Code) — Post-revision** | PASS | All HIGH resolved by Option-B guard |
| **CONTROL (Revision)** | APPROVED | 6 fixes applied; re-reviewed by panel |
| **Surgeon (Landing)** | COMPLETE | Squashed to 5cf4f26f; force-pushed; no PR |

**Final status:** Piece 40 (callsign-namespaced transport) landed. Build green. Scrub clean. E deferred.
