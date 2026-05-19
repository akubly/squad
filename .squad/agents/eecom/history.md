# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** Piece 04 centralized path-utils as the single source of truth for OS-aware path comparison logic. All 137 targeted tests passed. Decision merged to decisions.md. Future pieces (init fail-fast, assign, unassign, doctor) import from the centralized path-utils module.

## Learnings — Active

### Piece 17 — fuzzy-match utility (2026-05-18T18:13:35-07:00)

**Implemented:** `packages/squad-cli/src/utils/fuzzy-match.ts` — two-function pure utility: `levenshteinDistance` (two-row DP, Unicode-safe via `Array.from()`) and `suggestSimilar` (linear scan, stable tie-breaking, configurable threshold, default 2).

**Key patterns:**
- Two-row DP: one `prev` array initialized to `[0,1,…,bLen]`, one `curr` array per outer loop iteration. O(|a|·|b|) time, O(|b|) space. No third array.
- `Array.from(str)` before both DP loops so multi-byte code points (accented characters, emoji) count as single units.
- `suggestSimilar` tracks only `bestCandidate`/`bestDistance` — no array accumulation. Sentinel `maxDistance + 1` ensures the first candidate within threshold always wins the initial comparison cleanly.
- Strict `<` (not `<=`) in the comparison guarantees first-in-input-order tie-breaking with no extra bookkeeping.
- `vitest.config.ts` required a new `include` glob for `packages/squad-cli/src/utils/__tests__/**/*.test.ts` — the existing config only covered `commands/__tests__`.

**Test surface:** 24 tests (10 `levenshteinDistance` + 14 `suggestSimilar`), covering all 10 spec-required scenarios plus explicit symmetry, deletion/insertion/substitution, and boundary cases.

**Gotchas:** The vitest root config restricts `include` by path — new utility test directories must be added to `vitest.config.ts` or tests silently produce "no test files found, exit 1" which looks like a path error but is actually a config omission.

### Piece 15 — squad unassign (2026-05-18T15:41:51-07:00)

**Implemented:** `runUnassign` with demote-not-delete semantics. Removing the last clone path from a registry entry sets `status: 'inactive'` and preserves `callsign`, `path`, `initUri`, and all unknown forward-compatible fields. The entry stays in the registry; `squad assign <callsign>` reactivates it.

**Key patterns:** Origin refcounting uses `normalizeRemoteUrl` on both the removed clone's URLs and the remaining clones' URLs — remove an origin only when no remaining clone still reports it. The host-path guard triggers when `normalisedPathKey(targetDir) === normalisedPathKey(path.dirname(entry.path))` (the `.squad/` parent, not `.squad/` itself). Ambiguous scan (target dir in multiple entries without `--callsign`) exits with code 3.

**Gotchas:** Gate 1 and Gate 2 scrub failures are pre-existing baseline contamination accepted for all Phase B pieces — not introduced by this piece. Verify this on each new piece by checking that the diff surface contains no new strip-listed paths or legacy fork-name residue.

**Revision (2026-05-18T16:19:28-07:00):** Applied findings F1–F8 from the adversarial pass. Extracted shared `findCloseMatch` helper to `packages/squad-cli/src/lib/close-match.ts` (F7). Wired `collectCwdRemoteUrls` as the production default for `getRemoteUrls` (F1). Added `parseUnassignArgs` to `assign-args.ts` and wired it in CLI entry to handle `--flag=value` forms (F2). Added payload cleanup TODO comment at the correct insertion point (F4). Entry ordering now uses `map` to preserve original position (F8). U7 asserts `alpha.status === 'inactive'` after last-clone removal (F5). New U13 test covers double-call idempotency explicitly (F6). Rewrote Gate 2 history note to use neutral language (F3). Test count: 13 unassign + 25 assign-args + 29 assign = 67 total, all GREEN.



**Implemented:** `scripts/sync-templates.mjs` now refreshes unsuffixed package-local `squad.agent.md` mirrors when those files exist for runtime packaging, while keeping the tracked `.template` mirrors as the default package payload.

**Key patterns:** Keep `.squad-templates/squad.agent.md` as the only governance source. Use `test/template-sync.test.ts` to prove both tracked mirrors and optional package-local mirrors return to canonical bytes after sync runs.

**Gotchas:** `npm run build` runs both skill sync and template sync, so clean generated build fallout before staging. The repository-level scrub gate still reports strip-listed baseline paths outside the changed-file surface.

### Piece 11b — mirror sync test hardening (2026-05-16T00:25:23.605-07:00)

**Implemented:** The parity test now proves package-local mirrors refresh only when a runtime path has already materialized them, and it proves absent package-local mirrors stay absent after sync.

**Key patterns:** Run mirror-mutation coverage inside an isolated sandbox so sync exercises real file refresh behavior without touching the checkout. Use one case for existing mirrors and a separate case for absent mirrors so both contracts stay explicit.

**Gotchas:** A present-vs-absent branch inside one assertion can collapse into a no-op. Keep the existing-mirror test on a real stale file so the parity gate fails when sync stops refreshing that runtime copy.

### Piece 11a — canonical template fail-shut chain (2026-05-15T17:02:37.675-07:00)

**Implemented:** The coordinator template now treats team-root lookup steps as probes, not gates. The final no-team path requires explicit negative evidence from CWD, git-root, registry, platform, and worktree probes before Init Mode can begin.

**Key patterns:** Update the canonical `.squad-templates/squad.agent.md` source first, then run the template sync script so root, package, and installed mirrors stay byte-for-byte aligned. Pair prompt governance changes with semantic template assertions in `test/template-sync.test.ts`, not only mirror parity.

**Gotchas:** The template sync test reads canonical content directly and also runs the sync script; assertions should allow Markdown formatting around step labels. The repository-level scrub gate still reports existing strip-listed state paths outside this change, so review the changed-file surface separately.

### Piece 16 — squad init refactor (2026-05-18)

**Implemented:** Major `squad init` refactor. Dropped the URL positional argument; added `--target-dir`, `--registry-path`, `--no-register` flags. Reactivates inactive registry entries instead of refusing them. Existing `.squad/` directories with sentinel files are registered without clobbering files (scaffold creation skipped, not errored).

**Key patterns:**
- `resolveScaffoldState` returns `'absent'|'present'` — only throws `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` for **symbolic links**. Existing directories proceed to registry logic unblocked.
- Callsign is always `path.basename(targetDir)` — removed git-root detection logic that was equivalent in practice.
- Reactivation writes `{ ...entry, status: 'active' }` spread to preserve all forward-compatible fields; active-at-same-path is idempotent (no write).
- URL rejection error message includes `--target-dir` migration guidance so the CLI teaching error matches the new flag names.

**Test discipline:** 10 unit tests (I1–I10) in `packages/squad-cli/src/commands/__tests__/init.test.ts` + 2 URL guard tests; 26 integration tests in `test/cli/init-scope.test.ts` (all GREEN). Guard-order tests updated to reflect that scaffold-present no longer short-circuits registration.

**Gotchas:** Integration tests in `test/cli/` import `@bradygaster/squad-cli/commands/init` which resolves to `dist/commands/init.js`. Must run `npm run build` in `packages/squad-cli` before running those tests or they run against stale compiled output. Unit tests in `packages/squad-cli/src/commands/__tests__/` use TypeScript source directly via vitest.

**Scrub gate:** Gates 1 and 2 are pre-existing baseline contamination — not introduced by this piece. Accepted per coordinator decision in `.squad/decisions.md`.



**Outcome:** The piece was rejected during adversarial review and reassigned for an independent revision cycle.

**Blocking findings:** guard-order coverage was missing, clone-collision coverage was missing, 6 `toThrow()` assertions lacked specific error matching, registry-unchanged assertions were missing on failure paths, scaffold verification checked directories but not files, and one inactive-entry test label was inaccurate.

**Guard gaps:** one registration path skipped callsign and clone checks, `.squad` symbolic-link handling needed `lstat`, and concurrent init remained unguarded.

**Non-blocking notes:** record the exit-code 2 scope for future pieces, rollback handling remained spec-compliant, and the current reactivation label stayed acceptable for this scope.

**Revision scope:** Address all blocking test gaps and harden guard implementation with symbolic-link-aware scaffold checks, complete registration-path validation, and concurrency hardening. Decisions and findings merged to `.squad/decisions.md`.

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

📌 **Team update (2026-05-15T23:15:56Z — Piece 10 Revision Complete):** Piece 10 completed its independent revision cycle after adversarial review found blocking test and guard gaps. The revision unified init validation routing, added an `lstat`-based symbolic-link sentinel, and applied registry checks across all registration paths. All 6 blocking test gaps and all 3 guard gaps were closed. Build CLEAN. 28/28 tests GREEN. Commit `331894e8` contains the squashed revision. Decisions merged: exit-code-2 scoping guidance for future error subclasses. Orchestration and session logs recorded. The lockout remained artifact-scoped.

📌 **Team update (2026-05-15T22:14:43Z — Piece 09 Revision Complete):** Piece 09 completed its independent revision cycle after adversarial review found boundary, coverage, and strictness gaps. The revision moved `resolveWatchStartupSquadDir()` to internal `startup.ts`, removed strictness violations, and strengthened command-boundary parity tests. Build CLEAN. 5/5 targeted tests GREEN. Gate 1 inherited baseline (110 hits) accepted per directive. Revised commit ready for Phase C merge. Phase C follow-ups remained E2E rehearsals and coverage hardening.

📌 **Team update (2026-05-15T16:06:47Z — Piece 10 Adversarial Review — Locked Out):** Piece 10 (init fail-fast guards) was rejected during adversarial review. Key findings for future reference: (1) guard-order coverage was missing and underspecified; (2) clone-collision coverage missed symbolic-link and relative-path edges; (3) 6 `toThrow()` assertions lacked specific error matching; (4) registry-unchanged assertions were missing on failure paths; (5) scaffold verification checked directories but not files; (6) one registration path skipped callsign and clone checks, symbolic-link handling needed `lstat`, and concurrent init still required hardening. Decisions merged to `.squad/decisions.md`: exit-code-2 pattern scoping limit and tightening recommendations for init guards. Orchestration logs and session log created. The lockout remained artifact-scoped.

📌 **Team update (2026-05-18T21:21:50Z — Piece 14 Adversarial Review Complete):** Piece 14 (`squad assign`, commit 971a9d0a) completed adversarial review with findings but no lockout. Two correctness bugs were flagged for follow-up: (1) git clone ran without `--` before the URL, enabling argument injection convergence, and (2) `--clone-to=./dest` was ignored and produced a misleading error. All findings were recorded in `.squad/decisions.md`. Orchestration logs and session log were created. No revision was assigned.

📌 **Team update (2026-05-16T06:30:00Z — Piece 11a Adversarial Review Complete, Parity Gate Fixed Under Lockout):** Piece 11a (`akubly/upstream-11a-canonical-template-failshut`) completed adversarial review with parity-gate follow-up under lockout. The parity fix implemented a pre-sync SHA-256 snapshot gate in `test/template-sync.test.ts` that fails if sync rewrites tracked mirrors. Commit `95a19a5a` passed all 158/158 tests. One major finding was dismissed per user directive because the spec explicitly authorized the governance edits. Spec fidelity was confirmed across all 7 acceptance criteria. All findings were recorded in `.squad/decisions.md`. Orchestration logs and session log were created. No PR was opened.

📌 **Team update (2026-05-18T21:50:32Z — Piece 14 Revision Session Complete):** Piece 14 completed its revision session with all required findings addressed: git subprocess `--` separator (S1), typed error codes (T1), CLI arg `--flag=value` parsing (T2), discriminated union exhaustiveness guards (T3), registry write atomicity (F1), origins dedup test coverage (F3), and early parse errors (F7). Two deferrals remained acceptable per spec: T8 (index-signature refactor) and F8 (branch fallback). Commits: `1a47e601` and `935e73b2`. Build CLEAN. 47 tests GREEN (28 assign + 18 assign-args + 1 new A27). Decisions, orchestration logs, and session log were recorded. Branch ready for Phase C. No lockout remained on this piece.
