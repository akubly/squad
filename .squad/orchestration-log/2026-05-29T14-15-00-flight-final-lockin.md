# Flight Orchestration — Final Lock-In & Plan Amendment

**Date:** 2026-05-29  
**Agent:** flight-7  
**Session:** Cross-repo-staged-plan final lock-in and amendment

**Outcome:** ✅ COMPLETE

**Actions:**
1. All 5 Flight open questions resolved (Q1–Q5)
2. Decisions locked at top of `.squad/plans/cross-repo-staged-plan.md`
3. Per-piece decision annotations added to each piece entry
4. New piece 30.5 (gate-audit + three gate rules) introduced
5. Scrub-gate flavor rule (replay-private vs upstream-bound) captured as binding directive
6. §E (Resolutions) section replaced with final outcomes

**Decisions Locked:**
- Piece 26: single-session (Q1 = A)
- Piece 28: sourceWorkRoot `{ repo, pathHash }` (Q2 = C)
- Piece 29: banner-only restart (Q3 = A)
- Piece 30: behavioral test validation (Q4 = D); NEW devDep: `yaml`
- Piece 30.5: hybrid gate evolution (Q5 = C); three new gate rules tagged `[upstream-bound]`
- Scrub-gate bifurcation directive: replay-private vs upstream-bound flavors (binding for all future gate work)

**Staged Plan Status:** Linear chain 26 → 27 → 28 → 29 → 30 → 30.5 frozen for execution. No per-piece prompts modified (owned by Procedures).

**Duration:** Session final lock-in. All decisions propagated to Scribe inbox.

**Next Step:** Merge Scribe inbox → decisions.md; commit orchestration + session logs; staged plan ready for Phase B execution.
