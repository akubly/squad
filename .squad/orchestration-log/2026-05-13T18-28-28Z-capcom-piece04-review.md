# Orchestration Log: CAPCOM Round 1 Review — Piece 04

**Session:** Adversarial review cycle, piece 04 (path-utils-upsert-rename)  
**Date:** 2026-05-13T18:28:28Z  
**Agent:** CAPCOM (Architectural Review)  
**Mode:** background, parallel with FIDO + RETRO

## Why Chosen

CAPCOM reviews architectural soundness, external interface impact, and changeset hygiene. Piece 04 renames a public SDK API and extracts a new module; architectural sign-off is required.

## Files Authorized to Read

- Spec from akubly/upstream-specs: REPLAY-PROTOCOL.md, 04-path-utils-upsert-rename.md
- Diff: piece-03..HEAD
- Implementation files: packages/squad-sdk/src/, packages/squad-sdk/test/registry-schema.test.ts
- SDK index barrels: packages/squad-sdk/src/index.ts, packages/squad-sdk/src/resolution-v2.ts
- Changesets: .changeset/

## Files Produced

Decision file dropped to `.squad/decisions/inbox/capcom-piece-04-review-path-utils-upsert-rename.md`:
- VERDICT: APPROVE with findings
- MAJOR: Spurious @bradygaster/squad-cli changeset bump (no CLI source changed)
- MINOR: normalisedPathKey re-exported from resolution-v2.ts (scope creep)
- MINOR: S14b calling registerEntry (independent corroboration of FIDO's finding)
- Other minors deferred to follow-up pieces

## Outcome

**VERDICT: APPROVE** — Implementation is functionally correct and spec-compliant. Deferred findings for piece 05.
