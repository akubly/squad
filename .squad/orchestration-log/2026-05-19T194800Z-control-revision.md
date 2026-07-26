# CONTROL — Piece 18 Revision

**Timestamp:** 2026-05-19T19:48:00Z  
**Branch:** `akubly/upstream-18-doctor-enhancements` (force-pushed)  
**Commit:** `b7d669a4` (amended)

## Status: ✅ COMPLETE

### Work Summary

Owned piece 18 revision after EECOM locked out per Strict Lockout Protocol. Applied all 7 fixes:

- **F1:** CRLF normalization
- **F2:** `--normalize` / `--purge` mutual exclusion
- **F3:** Removed dead `copilotHome` from `RunDoctorOpts`
- **F4:** `noRegistry` variant for missing/corrupt registry
- **F5:** 7 CLI-layer subprocess tests (CLI1–CLI7)
- **F6:** N03 origins dedup assertion
- **F7:** Clone-count tiebreaker N07

Plus nits N1–N5:
- Async prompt unified
- `_insertAt` drift fix
- `SQUAD_REGISTRY_PATH` honored in purge
- Callsign validation
- `--apply` error handling

### Test & Build Results

- 33 unit tests: ✅ GREEN
- 7 CLI tests: ✅ GREEN
- Build: ✅ CLEAN

### Handoff

Committed to `origin/akubly/upstream-18-doctor-enhancements` (force-pushed, amended commit `b7d669a4`). Re-verification spawned for Flight and FIDO.
