# CAPCOM — History Archive

> Cumulative learnings prior to 2026-06-02. Earlier history moved here for readability.

## Summary

Archive of CAPCOM's history from pieces 1–19 and foundational SDK review work (2025-01-25 to 2026-05-13). Covers SDK Init orphaned subsystems (CastingEngine, team sync), canonical validation patterns, resolver migrations, SDK boundary discipline, and first adversarial review cycles (pieces 04, 08a, 19).

### Key Decisions Recorded:
- Phase-based quality improvement (3-phase approach from pieces 04–08a)
- CastingEngine canonical casting policy
- squad.config.ts as source of truth
- Ralph agent always-included decision
- CLI platform research findings (Copilot CLI versions 1.0.5–1.0.11 impact)
- Canonical callsign validation convergence pattern

## Pattern Summary

When the same validation rule spans SDK reader paths, payload namespace code, and CLI maintenance commands, extract a shared helper in the SDK and make downstream packages import it through the barrel instead of copying regexes inline. The specific smell: writer/reader/doctor triple-divergence.
