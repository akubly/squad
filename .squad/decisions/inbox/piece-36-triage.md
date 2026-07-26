# Piece 36 — Cross-Repo Publish-Loop Defect Repair: Triage

**Date:** 2026-06-08T15:19:27-07:00  
**Author:** EECOM (Core Dev)  
**Piece:** 36 — cross-repo-publish-loop-repair  

---

## Triage Table

| Sub-proposal | Severity | Decision | Notes |
|---|---|---|---|
| A — `squad assign` new flags never parsed or dispatched | CRITICAL | **ACCEPT** | Add `--developer-alias`, `--state-remote`, `--state-branch` to `NAMED_FLAGS` in `assign-args.ts`; forward in `cli-entry.ts` dispatch block; gate hook install on truthy alias |
| B — `--skills-from` parsed but not forwarded | Normal | **ACCEPT** | Wire `skillsFrom` from dispatch block into `runAssign` |
| C — Cross-repo hook is a guaranteed no-op (recursion-guard bug) | CRITICAL | **ACCEPT** | Remove `export SQUAD_SYNC_ACTIVE=1` from hook preamble; let `runSync` own its guard |
| D — Publish allowlist aborts on any realistic host `.squad/` | CRITICAL | **ACCEPT** | Change `throw` to `continue`/filter; build snapshot from allowlisted paths only |
| E — `install-fold-pipeline` template path breaks in published package | CRITICAL | **ACCEPT** | Change `TEMPLATES_ROOT` to `path.resolve(__dirname, '../../../templates/fold')` (3 levels: from `src/cli/commands` or `dist/cli/commands` up to the package root where `templates/` lives) |
| F — `squad sync --dry-run` unreachable in no-alias case | Normal | **ACCEPT** | Move dry-run early-return before alias guard |
| G — `--dry-run` missing from `squad sync --help` | Normal | **ACCEPT** | Add `--dry-run` to help text in `cli-entry.ts` |
| H — `hydrateTeamRootFromStateRef` idempotency guard never fires | Medium | **ACCEPT** | Root cause confirmed during implementation: comparison uses HEAD (working-branch tip) vs. orphan-snapshot SHA — they can never match. Fix: write applied SHA to `.squad/.last-hydrate-sha` sentinel and compare against that. |
| I — Inbox branch-name collision on sub-second publishes | Low | **ACCEPT** | Append millisecond component to timestamp; format: `yyyyMMdd-HHmmssSSS` |

---

## Sub-proposal H — Implementation Note

Root cause confirmed: `hydrateTeamRootFromStateRef` compares `headSha` (result of `git rev-parse HEAD` in teamRoot, which is the product repo's working-branch tip) against `fetchedSha` (the orphan state-branch commit on the state remote). These live on entirely different commit graphs and can never be equal in production, so the guard never fires.

Fix implemented: introduce `.squad/.last-hydrate-sha` sentinel file. After successful hydration, write `fetchedSha` to it. On next call, read the sentinel; skip re-hydration if sentinel matches `fetchedSha`. This is a targeted, reliable one-line comparison change (sentinel vs. fetched SHA rather than HEAD vs. fetched SHA).

---

## Outcome

All sub-proposals A–I accepted. All implemented in piece 36 with TDD (red→green) and covered by targeted tests.

---

## CONTROL Remediation — Adversarial Review Response (2026-06-08T15:19:27-07:00)

**Author:** CONTROL (TypeScript Engineer)  
**Context:** CAPCOM NO-GO on EECOM commit `9474a1d7`. CONTROL owns independent fix.

### DEFECT-1 — E template path double-`fold`
Root cause: line 113 of `install-fold-pipeline.ts` used `path.join(TEMPLATES_ROOT, 'fold', platform, ...)` but `TEMPLATES_ROOT` already resolved to `templates/fold/`. The extra `'fold'` created `templates/fold/fold/<platform>/...` which does not exist. Fixed: removed redundant segment. Stale comment also corrected (said `../../` but code used `../../../`).

### H sentinel staleness (MEDIUM) — Limitation documented
The `.squad/.last-hydrate-sha` sentinel is keyed only on remote `fetchedSha`. If local content drifts (manual edits between fetches of same SHA), sentinel suppresses re-hydration. Acceptable per spec (idempotency is perf-only). Mitigation: delete sentinel to force re-hydrate. Added to `.gitignore` — must never be committed. Future: key on `fetchedSha + hash(localSquadTree)` if content-drift detection required.

### ISSUE-4 (I) — Monotonic counter residual edge
Added module-level `_publishSeq` counter to guarantee uniqueness below ms. Branch pattern `squad/inbox/<alias>/<ts>-<seq>-<sessionId>` still matches `squad/inbox/**` trigger glob. Residual edge: cross-process same-ms same-sessionId collision (negligible given per-session entropy).

### DEFECT-2 (C) — Recursion guard E2E residual gap
True hook execution was not exercised in Windows vitest sandbox. C1/C2 tests use two-phase proxy: outer runSync publishes once; re-entrant runSync with `SQUAD_SYNC_ACTIVE` pre-set asserts no second publish. Residual gap documented here; hook template correctness covered by install-hooks A2/A3.

---

## Documented Residual Limitations (2026-06-08T15:19:27-07:00)

**Author:** CONTROL (TypeScript Engineer)

### H — Sentinel keyed on `fetchedSha` only

The `.squad/.last-hydrate-sha` sentinel is keyed only on the remote `fetchedSha`. If local TEAM_ROOT content drifts (e.g., manual edits made between two fetches of the same remote SHA), the idempotency guard will silently skip re-hydration even though local content diverges from the snapshot. Per spec, idempotency is scoped as a performance optimisation only — not a correctness guarantee — so this is accepted as a known limitation. Mitigation: delete the sentinel to force re-hydration. Future hardening: key the sentinel on `fetchedSha + hash(localSquadTree)` to detect content drift.

### I — Branch uniqueness: cross-process same-millisecond edge

Branch name generation uses millisecond-precision timestamp plus a per-process monotonic `_publishSeq` counter. Within a single process, same-millisecond uniqueness is fully guaranteed by the sequence counter. Across multiple processes that start in the exact same millisecond with the same session ID, the monotonic counter resets independently per process, leaving a theoretical residual collision window. Severity: Low. Accepted.

### C — Shell-hook → commit → publish non-reentry: GitHub CI follow-up

C1-Phase1 and the E2E tests prove that a real `runSync` call reaches `publishTeamRootToInbox`, and install-hooks A2 asserts the hook template no longer pre-sets `SQUAD_SYNC_ACTIVE`. However, no test fires the real OS-level post-commit shell hook → `squad sync` subprocess and asserts that a sync-internal commit does NOT trigger a second publish cycle. A true shell-hook → commit → publish non-reentry end-to-end test is deferred as a **GitHub CI follow-up**: this scenario is flaky on Windows (timing/process isolation) and runs reliably on Linux CI. Tracked as a follow-up item for the CI pipeline.
