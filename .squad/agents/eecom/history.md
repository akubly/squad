# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

## Recent Pieces — Phase B Active

### Piece 19 — Copilot payload orchestration (2026-05-19T22:30:35Z)
🔐 **Reviewer Lockout Applied.** EECOM authored piece 19 (Copilot payload load + callsign extraction + frontmatter rewriting). Adversarial review cycle: Flight ✅ (spec parity), FIDO ❌ (coverage gaps), CAPCOM ❌ (contract/security). GNC + CAPCOM (Round 2) completed revision under lockout. Blocker fixes: symlink-safe copy, `assertValidCallsign` guard, `CopilotPayloadError` wrapping, 3 FIDO test gaps. Final: `2377c3a8` (amended), 143/143 tests GREEN, build CLEAN. ✅ Ship approved to dev.

### Piece 18 — doctor enhancements (2026-05-19)
Extended `runDoctor` with registry health checks (empty clones, clone-path ambiguity, origin overlap); `runDoctorNormalize` for dedup; `runDoctorPurge` for removal. Key: `_pickSurvivor` (active status → clone count → registry order). Merge insertion preserves order. Tests 28/28 GREEN. Gotcha: normalize test dirs avoid case collisions on Windows.

### Piece 17 — fuzzy-match utility (2026-05-18)
`levenshteinDistance` (two-row DP, Unicode-safe) and `suggestSimilar` (linear scan, stable tie-break). Tests 24/24 GREEN. Gotcha: vitest config `include` glob must expand for new paths.

### Piece 16 — squad init refactor (2026-05-18)
Dropped URL positional; added `--target-dir`, `--registry-path`, `--no-register`. Reactivates inactive entries. Scaffold/symlink logic split. Tests 28/28 GREEN (10 unit + 26 integration). Gotcha: integration tests need `npm run build` first.

### Piece 15 — squad unassign (2026-05-18)
Demote-not-delete semantics. Last-clone removal → `status: 'inactive'`. Origin refcounting via `normalizeRemoteUrl`. Revision F1–F8 applied. Tests 67/67 GREEN.

### Piece 09 Revision (2026-05-15)
Moved `resolveWatchStartupSquadDir` to internal startup.ts. Build CLEAN, 5/5 tests GREEN.

### Piece 10 Revision (2026-05-15)
Addressed all 6 blocking test gaps + 3 guard gaps. Unified init validation routing. Build CLEAN, 28/28 tests GREEN.

## Team Updates — Recent

📌 **2026-05-19 Piece 18 Revision Complete:** CONTROL completed piece 18 revision under Strict Lockout Protocol (EECOM locked out). Applied F1–F7 fixes + N1–N5 nits. 33 unit + 7 CLI tests GREEN. Build CLEAN. Re-verify flight for Flight (architecture) and FIDO (test/build/scrub).

📌 **2026-05-18 Piece 14 Revision Complete:** All findings addressed (git `--` separator, typed error codes, CLI `--flag=value` parsing, exhaustiveness guards). Build CLEAN, 47 tests GREEN. Branch ready for Phase C.

📌 **2026-05-15 Piece 09/10 Revisions:** Both completed independent revision cycles post-rejection. All blocking gaps closed. Decisions merged.

## Learnings

### Phase B verify-first sub-proposals are real

When prior pieces already shipped the surface, the correct disposition is 'verified-already-green' with concrete test ID citations — not re-implementation. Sub-proposals that find the surface already in place should be marked verified and closed with a reference, not treated as unimplemented gaps.

### Build re-stamps package.json versions; never include those in a feature commit

`npm run build` automatically updates `package.json` and `packages/*/package.json` version fields. These are build artifacts, not source. Feature commits must use `git add -- <explicit path>` to exclude them. Staged files that include version changes will be reverted by the Coordinator.

### Scope hygiene: a feature commit MUST exclude .github/agents/squad.agent.md unless that file is actually being changed for the piece

The squad agent discovery file is governance infrastructure, maintained separately. If a piece does not explicitly modify it per spec, do not include it in the code commit. The Coordinator will remove it during cleanup.

## Known Issues

Gate 1 & 2 scrub-gate baseline contamination — pre-existing on all Phase B pieces. Accepted per coordinator directive in `.squad/decisions.md`.

## Archive

Older context (pieces 1–8, Q1 2026) in `history-archive.md`: template sync patterns, cherry-pick conflicts, loop command refactors, pre-Phase B lifecycle.
