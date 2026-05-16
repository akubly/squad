# EECOM

> Environmental, Electrical, and Consumables Manager

## Summary

EECOM owns SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils module). Path-utils centralized as single source of truth for OS-aware path comparison logic. All 137 targeted tests GREEN. Decision merged to decisions.md. Future pieces (init fail-fast, assign, unassign, doctor) import from centralized path-utils module.

## Learnings — Active

### Piece 11b — mirror sync (2026-05-15T23:49:57.391-07:00)

**Implemented:** `scripts/sync-templates.mjs` now refreshes unsuffixed package-local `squad.agent.md` mirrors when those files exist for runtime packaging, while keeping the tracked `.template` mirrors as the default package payload.

**Key patterns:** Keep `.squad-templates/squad.agent.md` as the only governance source. Use `test/template-sync.test.ts` to prove both tracked mirrors and optional package-local mirrors return to canonical bytes after sync runs.

**Gotchas:** `npm run build` runs both skill sync and template sync, so clean generated build fallout before staging. The repository-level scrub gate still reports strip-listed baseline paths outside the changed-file surface.

### Piece 11a — canonical template fail-shut chain (2026-05-15T17:02:37.675-07:00)

**Implemented:** The coordinator template now treats team-root lookup steps as probes, not gates. The final no-team path requires explicit negative evidence from CWD, git-root, registry, platform, and worktree probes before Init Mode can begin.

**Key patterns:** Update the canonical `.squad-templates/squad.agent.md` source first, then run the template sync script so root, package, and installed mirrors stay byte-for-byte aligned. Pair prompt governance changes with semantic template assertions in `test/template-sync.test.ts`, not only mirror parity.

**Gotchas:** The template sync test reads canonical content directly and also runs the sync script; assertions should allow Markdown formatting around step labels. The repository-level scrub gate still reports existing strip-listed state paths outside this change, so review the changed-file surface separately.

### Piece 10 — init fail-fast (2026-05-15) 🔴 REJECTED — Locked Out

**Session outcome:** REJECTED per strict lockout protocol. Adversarial review verdicts: Flight APPROVE (3 non-blocking notes), FIDO REJECT (6 blocking test gaps), RETRO APPROVE-WITH-FIXES (3 guard correctness gaps). 

**FIDO blocking findings:** guard-order untested, clone-collision untested, bare `toThrow()` assertions in 6 locations lack specificity, registry unchanged not verified on failure paths, scaffold weak (dirs checked but not files), inactive-entry test mislabeled.

**RETRO guard gaps:** no-flag init path bypasses callsign/clone checks (--no-register), symlink redirection risk (statSync follows symlinks—use lstat), concurrent init race. 

**Flight non-blocking notes:** exit-code 2 pattern scoping (record for future pieces), rollback compliance (spec-compliant), reactivation labeling (acceptable for current scope).

**Revision scope:** Address test discipline (all 6 FIDO gaps), guard implementation (symlink detection with lstat, registry checks on all registration paths, concurrency hardening). Decisions and findings merged to `.squad/decisions.md`. EECOM locked out for this cycle.

## Learnings — Archive

### Pieces 04-09 Summary

### Piece 09 (2026-05-15) - Summarized to Archive

### Piece 08 Series (2026-05-14) - Summarized to Archive

### Piece 07 (2026-05-14) - Summarized to Archive

### Piece 06 (2026-05-13) - Summarized to Archive

### Piece 05 (2026-05-13) - Summarized to Archive

### Piece 04 (2026-05-12) - Summarized to Archive

## Archive

Older learnings (prior to 2026-04-12) have been archived to history-archive.md for reference. See that file for Q1 2026 and earlier context including template sync patterns, cherry-pick conflicts, and loop command refactors.

### Piece 09 — watch/triage startup resolution (2026-05-15)

**State context contract:** `SquadStateContext` now carries the registry-aware `resolution` result. `resolveSquadState()` resolves squad identity first, then derives `paths` from `resolution.path` so both fields describe the same `.squad/` directory.

**Watch startup boundary:** `packages/squad-cli/src/cli/commands/watch/index.ts` uses `resolveWatchStartupSquadDir()` before platform adapter setup, monitor state paths, capability loading, and polling. The helper precedence is state context first, registry-aware resolver second, directory detection fallback last. Poll rounds reuse the captured `squadDirInfo` and do not resolve again.

**Triage surface:** `packages/squad-cli/src/commands/triage.ts` re-exports the watch runner as `runTriage`, with package export wiring in `packages/squad-cli/package.json`.

**Test pattern:** `test/cli/watch-triage-migration.test.ts` exercises startup resolution through the helper instead of entering the long-lived watch loop. Use an invalid `SQUAD_REGISTRY_PATH` with a valid `stateContext` to prove the context path wins without invoking another registry read.

📌 **Team update (2026-05-15T23:15:56Z — Piece 10 Revision Complete):** Adversarial review returned split verdict (Flight APPROVE-3-notes, FIDO REJECT-6-gaps, RETRO APPROVE-WITH-FIXES). Per strict lockout protocol, EECOM locked out for this cycle. CONTROL + Sims assigned joint revision and delivered fix: unified init validation routing, added lstat-based symlink sentinel, registry checks now apply to all registration paths (not just explicit --callsign). All 6 FIDO test gaps closed; all 3 RETRO guard gaps addressed. Build CLEAN. 28/28 tests GREEN. Surgeon squashed both revision commits into `331894e8`. Decisions merged: exit-code-2 scoping guidance for future error subclasses. Orchestration and session logs recorded. Lockout is artifact-scoped; EECOM available for other pieces.

📌 **Team update (2026-05-15T22:14:43Z — Piece 09 Revision Complete):** Adversarial review returned split verdict (Flight APPROVE, FIDO BLOCK, CONTROL REJECT, Sims NEEDS-E2E). EECOM locked out per protocol. CONTROL assigned revision owner and shipped fixes: moved `resolveWatchStartupSquadDir()` to internal startup.ts (no longer public API), removed strictness violations, strengthened command-boundary parity tests. Build CLEAN. 5/5 targeted tests GREEN. Gate 1 inherited baseline (110 hits) accepted per directive. Revised commit ready for Phase C merge. Phase C follow-ups assigned to Sims (E2E rehearsals) and FIDO (coverage hardening).

📌 **Team update (2026-05-15T16:06:47Z — Piece 10 Adversarial Review — Locked Out):** EECOM's piece 10 implementation (init fail-fast guards) received adversarial review verdicts: Flight APPROVE (3 non-blocking notes), FIDO REJECT (6 blocking test gaps), RETRO APPROVE-WITH-FIXES (3 guard correctness gaps). Synthesized verdict: REJECT per strict lockout protocol. EECOM locked out for this revision cycle. Key findings for future reference: (1) guard-order untested and underspecified in original tests; (2) clone-collision detection untested (symlink/relative-path edges); (3) bare `toThrow()` assertions in 6 test locations lack specificity; (4) registry unchanged not verified on failure paths; (5) scaffold creation weak (dirs checked, files not); (6) RETRO found no-flag init path bypass (--no-register skips callsign/clone checks), symlink redirection risk (statSync follows symlinks — must use lstat), concurrent init race remains. Decisions merged to `.squad/decisions.md`: exit-code-2 pattern scoping limit and tightening recommendations for init guards. Orchestration logs and session log created. Lockout is artifact-scoped; EECOM available for other pieces.

📌 **Team update (2026-05-16T06:30:00Z — Piece 11a Adversarial Review Complete, Parity Gate Fixed Under Lockout):** Piece 11a (`akubly/upstream-11a-canonical-template-failshut`) received adversarial review verdicts: Flight APPROVE-WITH-NITS (0 blockers, 0 major, 1 minor forward-scope note), RETRO REQUEST-CHANGES (1 major dismissed per user directive), FIDO REQUEST-CHANGES (1 major, 1 minor). Booster fixed FIDO MAJOR under strict EECOM lockout: implemented pre-sync SHA-256 snapshot gate in `test/template-sync.test.ts` that fails if sync rewrites tracked mirrors. Commit 95a19a5a passed all 158/158 tests. RETRO MAJOR dismissed per Aaron's directive: when spec explicitly authorizes governance edits, team is authorized even for maintainer-write-only files. Spec fidelity confirmed across all 7 acceptance criteria. All findings recorded in `.squad/decisions.md`. Orchestration logs and session log created. No PR opened (workflow rule). EECOM knows parity-gate fix was made in absence.
