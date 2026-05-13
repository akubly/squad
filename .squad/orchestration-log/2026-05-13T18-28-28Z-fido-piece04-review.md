# Orchestration Log: FIDO Round 1 Review — Piece 04

**Session:** Adversarial review cycle, piece 04 (path-utils-upsert-rename)  
**Date:** 2026-05-13T18:28:28Z  
**Agent:** FIDO (Quality Owner)  
**Mode:** background, parallel with CAPCOM + RETRO

## Why Chosen

FIDO is the Quality Owner. Piece 04 introduces a data-structure validation change (path deduplication) with platform-specific semantics. An adversarial review requires the highest scrutiny for integration testing and cross-case coverage.

## Files Authorized to Read

- Spec from akubly/upstream-specs: REPLAY-PROTOCOL.md, 04-path-utils-upsert-rename.md
- Diff: piece-03..HEAD
- Implementation files: packages/squad-sdk/src/path-utils.ts, packages/squad-sdk/src/registry.ts, packages/squad-sdk/test/registry-schema.test.ts
- Changesets: .changeset/

## Files Produced

Decision file dropped to `.squad/decisions/inbox/fido-piece-04-review-normalisedpathkey-integration.md`:
- VERDICT: REJECT (reassign → EECOM)
- CRITICAL finding: Missing S9b cross-case dedup integration test
- MAJOR finding: S14b still calling registerEntry instead of upsertEntry
- 4 minor findings (see decision file)

## Outcome

**VERDICT: REJECT** — Findings are binding under strict-lockout protocol. Reassigned to EECOM for revision.
