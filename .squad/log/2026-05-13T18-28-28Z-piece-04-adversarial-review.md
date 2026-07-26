# Session Log: Piece 04 Adversarial Review Cycle

**Date:** 2026-05-13T18:28:28Z  
**Branch:** akubly/upstream-04-path-utils-upsert-rename  
**Cycle:** Implementation → 3-way adversarial review → REJECT → revision → re-verify → APPROVE

## Agents and Verdicts

### Round 1: Parallel 3-Way Review
- **FIDO (Quality Owner):** VERDICT REJECT
  - CRITICAL: Missing S9b cross-case dedup integration test
  - MAJOR: S14b calling registerEntry instead of upsertEntry
  - 4 minor findings deferred
  - Findings are binding under strict-lockout protocol

- **CAPCOM (Architecture):** VERDICT APPROVE with findings
  - MAJOR: Spurious @bradygaster/squad-cli changeset bump
  - MINOR: normalisedPathKey re-exported from resolution-v2.ts (scope creep)
  - MINOR: S14b calling registerEntry (independent corroboration)
  - Other minors deferred to piece 05

- **RETRO (Security):** VERDICT APPROVE
  - Trust boundary secure: all inputs pass validateEntry first
  - 3 MINOR/NIT findings deferred
  - Established path-safety standard for pieces 05+ (symlink identity audit, trust boundary declaration, write-path documentation)

### Coordinator Decision After Round 1
FIDO's REJECT is binding (Quality Owner go/no-go authority). CONTROL locked out per strict-lockout protocol. Brady chose "revise in this session, limited scope" — address only the two cross-corroborated blockers (S9b + S14b). Deferred findings for follow-up pieces.

### Round 2: EECOM Revision
- **Findings Addressed:**
  - S9b: Added platform-gated integration test (implementation was already correct; gap was test coverage)
  - S14b: Updated test to call upsertEntry; renamed label to clarify write-preparation semantics
  
- **Work Products:**
  - Amended packages/squad-sdk/test/registry-schema.test.ts
  - Interactive rebase: 1eae929a → c971b743
  - Scribe housekeeping: → 2a444c91
  - After-work docs: → 952050b3
  - Force-push-with-lease to origin succeeded
  - 30/30 registry-schema tests pass
  - Gates 2–6 remain green

### Round 3: FIDO Re-Verify
- **VERDICT: APPROVE**
  - Both findings resolved with real assertions and correct platform semantics
  - No scope creep; zero additional registerEntry call sites (only BC artifacts)
  - All 30 targeted tests GREEN
  - Branch approved for PR submission (Phase C)

## Deferred Findings (For Follow-Up Pieces or Explicit Brady Direction)

- **CAPCOM MAJOR:** Spurious @bradygaster/squad-cli patch changeset
- **CAPCOM MINOR:** normalisedPathKey re-export from resolution-v2.ts (scope creep, registry primitive on resolver surface)
- **CAPCOM MINOR:** Wrapper-style registerEntry alias vs. const re-export (drift risk on signature changes)
- **CAPCOM MINOR:** @deprecated tag missing removal version/milestone
- **RETRO MINOR:** Symlink-pair duplicate bypass (validateRegistry could onWarn on realpath collisions)
- **RETRO MINOR:** upsertEntry JSDoc gap (validates but does not persist — caller must call writeRegistry)
- **RETRO NIT:** normalisedPathKey @remarks on public barrel
- **FIDO MINOR:** Degenerate-input coverage for normalisedPathKey (empty string, trailing/repeated separators)
- **FIDO MINOR:** clonesMatch relative-cwd documentation test

## Standards Established

1. **Integration-test mandate for path-normalizing functions:** Any piece wiring path normalization into validation MUST include platform-gated cross-case test (S9b pattern)
2. **Rename PR grep discipline:** Any API rename PR must include full-suite grep sweep with documented residuals
3. **Path-safety standard for pieces 05+:** Symlink identity audit, trust boundary declaration, write-path documentation

## Final State

- **Branch tip:** akubly/upstream-04-path-utils-upsert-rename commit 952050b3
- **Status:** APPROVED by FIDO under strict-lockout protocol
- **Phase:** B (housekeeping, no PR yet — Phase C handles PR submission)
- **Next:** Brady to push when ready; Phase C initiates PR submission and merge gate
