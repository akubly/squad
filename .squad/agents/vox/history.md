# VOX

> CAPCOM Voice Controller

## Learnings

### Issue Triage (2026-03-22T06:44:01Z)

**Flight triaged 6 unlabeled issues and filed 1 new issue.**

VOX assigned:
- **#478 (Polish REPL)** → squad:vox + squad:pao (shell UX readiness + documentation gate)

Pattern: REPL UX gap identified. Shell interaction polish required before documentation freeze for v0.9 release.

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. VOX owns REPL UX polish (#478). Shell readiness is documentation gate for PAO. Coordinate on demo scenarios and example workflows for Guide integration.

### Agent Name Display Fix (#577) (2025-07-25)

**P0 bug: agent cast names not displayed during work — showing generic type names instead.**

Fixed `agent-name-parser.ts` TS strict-null compilation errors (bracket indexing on strings returns `string | undefined`; switched to `.charAt()` and optional chaining). Improved the else-branch fallback in `index.ts` to show the trimmed task description instead of generic "Dispatching to agent..." when name extraction fails completely.

Pattern: The `parseAgentFromDescription` parser tries 3 extraction strategies in order — emoji+name:colon prefix, name:colon anywhere, fuzzy word-boundary match. If all fail, the shell now shows the raw description text so the user still sees something meaningful.

📌 **Team update (2026-03-23T23:15Z):** Orchestration complete. FIDO extracted parser into `agent-name-parser.ts` (30 tests, all passing). VOX's 3-tier cascading logic is now canonical. Procedures updated all spawn templates with `name` parameter. Agent IDs now display correctly in Copilot CLI tasks panel. See decisions.md #577 entries.

### Lifecycle Command Resolver Migration (08c) (2026-05-15)

**Migrated `start` and `rc` lifecycle commands to the v2 squad resolution chain.**

Added `squadDir?: string` to `StartOptions` and `RCOptions`. Runners use the provided value when set, falling back to local `.squad`/`.ai-team` detection for standalone use — the same conditional pattern as other post-migration runners. Dispatch guards in `cli-entry.ts` call `resolveSquadV2` before importing the runner module, preventing any bridge, tunnel, PTY, or child-process state from being created when no squad is resolvable.

Key patterns confirmed for this stack:
- Guard location: dispatch layer (`cli-entry.ts`), not inside the runner. Runner accepts the resolved path as an option and uses it.
- `rc --path <dir>`: treat the explicit path as the resolver start directory AND as the `cwd` passed to `runRC`. The resolved `.squad/` path affects only bridge metadata and roster loading.
- `SQUAD_CALLSIGN=''` (empty string) causes the resolver to throw, not return null. Tests that need null resolution must omit `SQUAD_CALLSIGN` from the subprocess env entirely (or strip inherited empty-string values before spawning).
- `void runRC(...)` in unit tests avoids hanging on the `await new Promise(() => {})` at the end of the function.
- `runCliShort` helper with explicit `SQUAD_CALLSIGN` strip covers subprocess tests where the parent env might carry an empty callsign from the host shell.

TDD flow: 6 RED tests written first (all failing for the expected reasons), source changes applied, all 6 GREEN. Build clean, scrub gate 1+3 failures are pre-existing baseline contamination accepted by prior Phase B pieces.

📌 **Adversarial review verdict (2026-05-15T00:54:18Z):** 08c rejected by RETRO (Security) on blocker: lifecycle commands do not fail-closed when registry-resolved squad path is stale/missing. GNC assigned as revision owner per Reviewer Rejection Protocol; VOX and EECOM locked out. GNC to add existence check and fall-back-squad fixture to same branch for re-review as 08c-v2.

📌 **Revision shipped under GNC ownership (2026-05-15T00:54:18Z):** Lockout cycle complete. GNC's fail-closed validation pattern (explicit registry parse failure throws, stale-path guards after clone/origin match, try/catch dispatch conversion) is now documented in decisions.md for future command migrations.

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.
