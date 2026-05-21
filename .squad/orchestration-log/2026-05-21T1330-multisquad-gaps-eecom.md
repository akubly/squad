# EECOM Multi-Gap Analysis — 2026-05-21T13:30

**Agent:** EECOM (via Copilot, Haiku)  
**Mode:** 4 sync spawns (gap1, gap2, gap2-reframe, gap3)  
**Task:** Structured tradeoff analysis for three P0 gaps blocking transparent-state-isolation

## Execution Summary

EECOM conducted structured tradeoff analysis for three critical gaps in the transparent state isolation P0, working in sync spawns with Aaron as the decision-maker. Each gap received context-framing, options analysis with tradeoffs, and decision guidance.

### Gap #1 — State Leak Guard (1 spawn)

**Problem:** Code bypassing backend abstraction writes mutable state directly to `.squad/decisions.md` on working tree despite `orphan`/`two-layer` backend selection.

**Options Analyzed:** 3 options (A: warn-only, B: Scribe block-mode, C: git pre-commit hook)

**Decision:** Option B + C combined (both layers recommended for defense-in-depth)

**Rationale:** Warn-mode ignored under pressure; two layers provide coverage at different workflow points.

### Gap #2 — Hook Bootstrap Automation (2 spawns: gap2 + gap2-reframe)

**Problem:** Git hooks not automatically installed on new clones; CI/host runners lose hooks on runs.

**Initial Options:** 3 options (A: manual install docs, B: separate install command, C: reuse existing activation events)

**Aaron Reframe:** Hooks aren't a separate distribution problem — they should ride with `squad init` and `squad assign` (the same moments that activate Squad in the first place).

**Decision:** Reframe adopted. Activate on existing events (init + assign). CI guard demoted to org-discretionary.

**Rationale:** Cheaper, more reliable, consistent with Squad's additive design principle. Reusing existing delivery channels avoids inventing new activation events.

### Gap #3 — Post-Migration Cleanup (1 spawn)

**Problem:** Stale `.squad/` files remain on working tree after migration, creating confusion and potential re-adds.

**Options Analyzed:** 4 options (A: recipe-only, B: auto-remove files, C: auto-.gitignore, D: B + C combined)

**Decision:** Option D (auto-remove stale files AND append .gitignore entries). History scrubbing explicitly out of scope.

**Rationale:** P0 bar is "clean PR diffs going forward," not retroactive purity. Analogy: repos with legacy `.DS_Store` commits stop the bleeding and move on.

## Consolidated Recommendation

**All three gaps decided as required follow-on work blocking the P0 claim.** Folded into authoritative proposal at `.squad/decisions/multisquad-design/flight-multisquad-proposal-and-spec.md` (§4a subsections "Current implementation status" + "Required follow-on work" checklist; §5 Non-goals extended).

## Confidence Assessment

Analysis provided structured tradeoff guidance for each gap. Decisions have clear technical rationale and accepted limitations (e.g., `--no-verify` bypass).

## Next Steps for Implementation

- [ ] State Leak Guard: Hardened Scribe pre-check + git hook template
- [ ] Hook Bootstrap: Integrate hook install into `squad assign` completion path
- [ ] Post-Migration Cleanup: Auto-remove stale state + append .gitignore in `squad migrate-backend`
