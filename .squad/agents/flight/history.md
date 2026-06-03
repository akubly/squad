# Flight — Project History

> Knowledge accumulated through leading Squad development.

---

## Recent Actions

### 2026-06-03: Piece 30 Follow-On Revision Shipped (EECOM Author)

**Status:** Piece 30 follow-on revision session complete. Flight's original commit (10168051) followed by Booster's revision (a9da5453); both locked out per strict reviewer rejection lockout protocol. EECOM assigned as third-pass implementer for follow-on revision (CAPCOM M_NEW_1 + RETRO M_NEW_1). Revision commit: 3c6c9edf. Test coverage: 196 → 200. Scrub-gate: Gate 8 net +2 (pre-existing pattern). Ready for lead gate, merge, promotion.

### 2026-06-02: Piece 30 Revision Follow-On Review Complete

**Status:** Follow-on adversarial review closed. Booster's revision (a9da5453) reviewed by 3 independent reviewers in parallel (CAPCOM, RETRO, FIDO). Verdict: MIXED — CAPCOM REJECT (fold timestamp logic bug), RETRO APPROVE-WITH-NITS (clone stderr security), FIDO APPROVE (zero new mandatory). Booster locked out per protocol. Flight locked out since original commit. No PR opens until CAPCOM REJECT resolved. Candidate authors: EECOM, Procedures, PAO (all available).

### 2026-06-03: Piece 30 Revision Shipped (Booster, Locked-Out Author)

**Status:** Revision session complete. Flight's original commit (10168051) rejected by 5-reviewer panel with 9 mandatory findings. Booster assigned as sole revision integrator per strict reviewer rejection lockout; Flight remained locked out throughout. Booster completed all 9 findings across all domains (CI/CD, security, testing, docs). Revision commit: a9da5453. Test coverage: 190 → 196. Scrub-gate: 8 of 8 pass (Gate 1 pre-existing baseline). Ready for lead gate, merge, promotion to origin/dev. Flight will review final merge as part of standard lead-gate process.

### 2026-06-02: Piece 30 Consolidated Verdict

**Task:** Consolidate piece 30 adversarial review across 5 independent reviewers (CAPCOM, Booster, FIDO, RETRO, PAO)  
**Consolidated Verdict:** REJECT  
**Convergent mandatory themes:** 9  

Reviewed all 5 reviewer outputs and consolidated 9 convergent mandatory findings that block merge:
- CAPCOM: 2 findings (missing `squad fold` CLI command, unreachable publish trigger)
- Booster: 2 findings (no concurrency serialization, OAuth token loss)
- RETRO: 3 findings (1 High: PAT leak, 2 Medium: git-argument injection + no URL allowlist)
- FIDO: 1 finding (no execution-based idempotency test)
- PAO: 1 finding (docs-test sync broken)

**Verified runtime defect:** `squad fold` command referenced in `fold-squad-state.yml` does not exist in `packages/squad-cli/src/cli-entry.ts`. The fold pipeline is non-functional as shipped.

**Key learnings for future pieces:**
1. CLI command existence must be verified before shipping a pipeline that calls it.
2. `persistCredentials: true` is required on any ADO checkout where subsequent steps do authenticated git pushes.
3. `batch: true` is the correct ADO serialization primitive for pipelines that write to a shared branch.
4. Bootstrap scripts must not echo URL parameters to console or logs — PAT-in-URL is a credential leak path.
5. Docs-test sync (`EXPECTED_FEATURES`) must be updated in the same commit as any new docs page.

---

## Piece 28 R2 Gate

**Revision Commit:** `aff12874`  
**Verdict:** APPROVED  

All 23 acceptance-checklist items PASS. Both mutation tests confirm guards have real bite. Cross-repo-sync: 28/28 in isolation. Build clean, no new TypeScript errors. Full suite failure count artifact from test-isolation (new integration test file), not production regression.

**Key observations:**
1. **Commit message body must match diffs exactly** — do not claim SDK barrel additions that did not happen.
2. **process.exit(1) scope boundary** — track multiple process.exit calls in sync surface for future cleanup piece.
3. **Integration test isolation in full-suite runs** — use randomized fixture dirs and explicit afterAll cleanup to survive parallelism.

---

## Piece 29 Complete

**Commit:** `b642f9cd`  
**Status:** Coordinator contract update (5-variable spawn signature, TEAM_ROOT/WORK_ROOT split, session restart required).

**Key learnings:**
1. When templates declare "these N variables are mandatory," audit ALL spawn patterns including inline one-liners that predate the rule.
2. New spawn variables require both declaration AND resolution procedure — missing procedure creates ambiguity.
3. Hardcoded defaults (e.g., `STATE_BRANCH: squad-state`) should carry comments to prevent future divergence.

---

## Historical Archive

**Summary:** Flight leads Squad development from architecture design through specification authoring, implementation kickoff, revision oversight, and Phase C gating. Has managed 30-piece cross-repo arc (pieces 02–30) spanning foundation (registry validation, symlink defense), lifecycle management (init, sync, publish), CLI hardening, OTel integration, resolver refactoring, and ADO pipeline templates.

**Archived pieces:** Pieces 02–27 (archive-history.md), wave 1-phase B pilots, crash recovery, dual-doctor unification, shared CLI conventions (piece 23, 17 LOC), OTel typing hardening (piece 24, 114 LOC), resolver rename (piece 25, +23 LOC).

**Key decision patterns:** Mechanical vs. enriched scope split (pieces 22–25 wave), deprecation-strategy gating, vendor directive carry-forward protocol, integration test isolation, mutation testing for guard verification.

**Archive location:** Detailed learnings from pieces 02–27 available in history-archive.md (removed during summarization to keep active history focused on recent pieces and systemically important patterns).


📌 **Team update (2026-06-03 — Piece 30 Phase B Convergence):** Piece-30 converged on branch after round-3 adversarial review (CAPCOM + FIDO both approved). Both mandatory finding chains (CAPCOM M_NEW_1 + RETRO M_NEW_1) fully resolved by EECOM revision. No further revisions needed. Branch ready for Phase C (PR review).
