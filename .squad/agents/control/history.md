# CONTROL

> Control System Engineer

📌 **Team update (2026-05-18T19:19:14Z — Piece 14 Complete):** Piece 14 squad assign (EECOM implementation + FIDO review, APPROVED) landed successfully. SDK registry schema extended: added `status`, `initUri`, `stateBackend` fields to RegistryEntry, plus unknown-field passthrough via `[key: string]: unknown`. Existing registry files forward-compatible. If you're working on registry-touching features (pieces 15+), the extended schema is now canonical.

## Current Session Learnings

### Piece 10 revision — init validation path (2026-05-15T23:15:56Z)

📌 **Team update — Piece 10 Revision Complete:** EECOM locked out per strict lockout protocol after adversarial review split verdict (Flight APPROVE-3-notes, FIDO REJECT-6-gaps, RETRO APPROVE-WITH-FIXES). CONTROL + Sims assigned joint revision. CONTROL unified init validation routing through `packages/squad-cli/src/commands/init.ts` so scaffold, callsign, clone path, and registry-source checks run before writes. Added `.squad` symbolic-link detection with `lstatSync` to prevent redirect escapes. Registry checks now apply to all registration paths (not just explicit --callsign), addressing RETRO's no-flag bypass gap. All 6 FIDO test gaps closed by Sims. Surgeon squashed both revision commits into `331894e8`. Build CLEAN. 28/28 tests GREEN. Decisions recorded: exit-code-2 scoping guidance for future error subclasses (register, clone). Ready for Phase C.

### Piece 09 revision — watch and triage startup resolution (2026-05-15T22:14:43Z)

**Scope:** Migrated read-only command paths to the structured squad resolver for registered clone checkouts.

**Files changed:** `cli-entry.ts`, `cross-squad.ts`, `config.ts`, `legacy-resolver-migration.test.ts`, `migrate-readonly-commands.md` changeset.

**Key decision:** Preserved pre-existing working-tree drift in local stash `pre-08a-stale-working-tree-drift` to avoid carrying unrelated changes into branch.

**Validation:** 5/5 migration tests GREEN. Build clean. Scrub gate: no new violations introduced.

## Learnings

### Piece 10 revision — init validation path

- Routed `squad init` through one validation module so scaffold, callsign, clone path, and registry-source checks run before writes.
- Added `.squad` symbolic-link detection with `lstatSync` so scaffold writes stay inside the selected target directory.
- Recorded test expectations for Sims covering plain init, environment-selected registries, default registries, and symbolic-link conflicts.

### Piece 09 revision — watch and triage startup resolution

- Moved the watch startup resolver to an internal source module so command declarations stay focused on supported watch APIs.
- Command-surface parity tests should invoke `runWatch()` and `runTriage()` with platform, auth, monitor, capability, and PID seams stubbed, then shut down after the first-round boundary.
- `SquadStateContext` checks in tests should narrow with explicit guards before reading required resolution fields.

## Cross-Agent Updates

### Piece 08a Revision Complete — CAPCOM (2026-05-14T21:38:40.349Z)

📌 **Revision logged:** CAPCOM completed piece 08a revision (commit 0e4f301e) under strict lockout. CONTROL remains locked out for 08a unless re-rejection cycle restarts. See `.squad/orchestration-log/2026-05-14T21-38-40Z-capcom.md` for full revision scope (SDK barrel routing, dispatch unification, CLI start-dir parity tests, action-command boundary strengthened). Full suite 6,308/6,432 PASS; build clean; scrub gates 2/4/5/6 PASS.

### Piece 08a Adversarial Review Outcome (2026-05-14T21:19:34Z)

📌 **Rejection & Lockout Notice:** Piece 08a (read-only command resolver migration, commit fcb0cf1a) received four independent reviews:
- **Flight (Lead):** APPROVE
- **FIDO (Quality):** REQUEST CHANGES (blocking: `--team-root` / `SQUAD_TEAM_ROOT` parity not tested; boundary test weak; full-suite gate unmet)
- **RETRO (Security):** APPROVE
- **CAPCOM (SDK Expert):** REJECT (boundary violation: CLI imports `resolveSquad` from subpath instead of SDK root barrel; dispatch inconsistency between v2 resolver and legacy `detectSquadDir`)

**Coordinator Verdict:** REJECTED — CAPCOM's REJECT + FIDO's blocking gaps → no approval.

**Lockout:** CONTROL (author) locked out per strict Reviewer Rejection Protocol. CAPCOM self-nominated and accepted as revision owner.

**Revision Scope (CAPCOM):**
1. SDK barrel export fix: expose stable registry-aware resolver through `packages/squad-sdk/src/index.ts`
2. CLI dispatch consolidation: all three paths (`cli-entry`, `config`, `cross-squad`, `delegateCommand`) consume single resolver surface
3. Test coverage (FIDO): `--team-root` / `SQUAD_TEAM_ROOT` parity test + stronger boundary-crossing tests
4. Full-suite gate: meet Piece 05 baseline agreement

See `.squad/decisions.md` for full findings and `.squad/orchestration-log/` for per-reviewer details.

### Piece 08a — Read-only command resolver migration (2026-05-14T13:16:21.972-07:00)

**Scope:** Migrated read-only command paths to the structured squad resolver for registered clone checkouts.

**Files changed:**
- `packages/squad-cli/src/cli-entry.ts` — `status` now uses structured resolution and reports registry-backed reasons.
- `packages/squad-cli/src/cli/commands/cross-squad.ts` — `discover` resolves the active squad through the structured resolver.
- `packages/squad-cli/src/cli/commands/config.ts` — `config model` resolves the active squad through the structured resolver.
- `test/cli/legacy-resolver-migration.test.ts` — added fixture coverage for clone-backed resolution and read-only command dispatch.
- `.changeset/migrate-readonly-commands.md` — patch changeset for CLI behavior.

**Working-tree decision:** Initial uncommitted version/template/generated-skill drift was preserved in a local stash named `pre-08a-stale-working-tree-drift` before branching. The drift was unrelated to piece 08a and was not carried into the branch.

**Validation:**
- RED check: new migration tests failed on `status` and `discover` before implementation.
- GREEN check: `npm run build` passed; `npm test -- test/cli/legacy-resolver-migration.test.ts` passed 5/5.
- Scrub gate: gates 2, 4, 5, and 6 passed. Gate 1 reported existing tracked strip-listed paths; gate 3 reported existing references requiring review. No new gate output was introduced by the piece 08a files.

## Cross-Agent Updates

### Piece 08a Adversarial Review Outcome (2026-05-14T21:19:34Z)

📌 **Rejection & Lockout Notice:** Piece 08a (read-only command resolver migration, commit fcb0cf1a) received adversarial reviews from Flight (APPROVE), FIDO (REQUEST CHANGES), RETRO (APPROVE), and CAPCOM (REJECT). CAPCOM's boundary-discipline rejection (CLI subpath imports, dispatch inconsistency) combined with FIDO's blocking test gaps resulted in **REJECTED** final verdict. CONTROL (author) locked out per strict Reviewer Rejection Protocol. CAPCOM self-nominated and accepted as revision owner. Revision scope: SDK barrel export fix + test coverage for `SQUAD_TEAM_ROOT` parity + full-suite gate compliance. See `.squad/decisions.md` for full findings and orchestration-log for per-reviewer details.
