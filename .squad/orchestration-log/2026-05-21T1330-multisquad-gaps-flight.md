# Flight Proposal Integration + Decision Drops — 2026-05-21T13:30

**Agent:** Flight (via Copilot, Sonnet)  
**Mode:** Background spawn (1 task)  
**Task:** Integrate three P0 gap decisions into authoritative proposal + write decision drop files

## Execution Summary

Flight folded the three finalized P0 gap decisions into the authoritative proposal at `.squad/decisions/multisquad-design/flight-multisquad-proposal-and-spec.md`, adding:
- **§4a subsections:** "Current implementation status" (what's done) + "Required follow-on work" checklist (three gaps)
- **§5 Non-goals extended:** Documented accepted limitations (--no-verify bypass, CI guard discretionary, history scrubbing recipe-only)

Flight also wrote three decision drop files for Scribe to merge:

1. **flight-p0-gap1-state-leak-guard.md** — State Leak Guard (Options B + C combined)
2. **flight-p0-gap2-hook-bootstrap.md** — Hook Bootstrap (Reframed: rides with init/assign)
3. **flight-p0-gap3-post-migration-cleanup.md** — Post-Migration Cleanup (Option D: auto-remove + .gitignore)

## Proposal Changes

### Added to §4 Requirements Table
New P0 row: "Transparent state isolation — mutable state must not pollute developer PRs in org settings"

### Added to §4a How Transparent State Isolation Works
- File classification (product changes, static config, mutable state)
- Backend mechanism comparison (orphan vs two-layer vs git-notes)
- Ownership matrix (SDK, CLI, Scribe, org policy, developer)

### Extended §5 Non-Goals
- `--no-verify` bypass accepted as developer workaround
- CI-side state-diff guard is org-discretionary, not SDK-shipped
- History scrubbing out of scope; recipe-only for compliance orgs

### Updated Glossary (§26) and Appendices (§27, §29)
Added cross-references and new vocabulary for state backend clarity

## Rationale for P0 Elevation

Without transparent state isolation, org-deployed Squad fails basic developer-experience hygiene. PR diffs generate noise reviewers cannot evaluate, potentially blocking merge through branch-protection policies. Treating this as post-launch hardening would actively undermine Squad adoption in org settings where multi-squad management is most valuable.

## Dependencies and Sequencing

All three gaps decided as required follow-on work. No implementation sequencing required — all three activate only when `stateBackend` is `orphan` or `two-layer` (not affected by single-squad default behavior).

## Artifacts Produced

- Updated proposal: `.squad/decisions/multisquad-design/flight-multisquad-proposal-and-spec.md`
- Decision drop files: `.squad/decisions/inbox/flight-p0-gap*.md` (3 files, now merged by Scribe)
