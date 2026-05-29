# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

## Recent Pieces — Phase B Active (Summary)

**Pieces 15–24:** SDK lifecycle, registry health/doctor/fuzzy-match, init/unassign/bind refactors, Copilot payload orchestration, OTEL typing. All gate-cleared; revisions closed. Archive: pieces 1–14 in `history-archive.md`.

### Piece 09/10 Revisions (2026-05-15)
Piece 09: moved `resolveWatchStartupSquadDir` to startup.ts. Piece 10: addressed 6 blocking test gaps + 3 guard gaps. Both gates clean, 28/28 tests GREEN.

## Team Updates — Recent

📌 **Pieces 23–24 Rev Complete (2026-05-27–28):** Piece 23: F1–F4, N1–N2 addressed (env seam, qrcode typedef). Piece 24: N1–N4 OTEL typing closures (OTelSpanLike covariance, Meter/Tracer unions). Both gate-clean. Piece 25 (resolver rename) approved EECOM revision, all nits folded.

📌 **Piece 21 Ship Gate Cleared (2026-05-22):** Post-stack-review all five required fixes shipped. Follow-up (FIX-6/7/8) deferred to piece 22.

## Learnings

### Piece 27 — Explicit sync command (2026-05-29T16:30:14.652-07:00)

**SyncGitOps injection seam:**
Same injectable-git-ops pattern from piece 26 (`BindGitOps`). `SyncGitOps` has three methods: `listRemotes(cwd)`, `getRefspecs(cwd, remote)`, `addFetchRefspec(cwd, remote, refspec)`. Default implementation uses `execFileSync`. Tests inject a `TrackedGitOps` stub that records all calls in a `calls[]` array. This pattern is now stable and should be reused for any future command wrapping git remote operations.

**async function for process.exit guard tests:**
Any function that calls `process.exit(1)` must be `async` if tests will use `await expect(fn()).rejects.toThrow(...)`. A synchronous `process.exit(1)` inside a non-async function throws synchronously, escaping the Promise chain. Making the function `async` wraps the throw as a rejection. Applied to `ensureStateRemote()`.

**workRoot injection seam vs cwd:**
When tests create fake repos without a full git database, `git rev-parse --show-toplevel` fails. Solution: add `workRoot?: string` to `SyncOptions`. When provided, `runSync` uses it directly instead of calling `getRepoRoot(cwd)`. This avoids requiring a real git repo in unit tests. Pattern: any command that calls git to resolve the repo root should expose `workRoot` as a test injection seam.

**stash-and-verify of pre-existing baseline:**
Before declaring build failures "pre-existing," verified by: `git stash` (saving piece-27 changes) → `npm run build` (same failures) → `git stash pop`. Stash pop failed due to package.json conflicts (build stamps version fields), forcing manual re-implementation. Lesson: do NOT use git stash to verify baseline when package.json is unstaged. Use `git diff HEAD -- <specific-file>` or `npx tsc --noEmit` targeted to changed files instead.

**Hook template STATE_REMOTE extraction:**
POSIX shell pattern for reading a JSON field without jq:
```sh
STATE_REMOTE=$(grep -o '"stateRemote"[[:space:]]*:[[:space:]]*"[^"]*"' "$REPO_ROOT/.squad/config.json" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"')
[ -z "$STATE_REMOTE" ] && { unset SQUAD_SYNC_ACTIVE; exit 0; }
```
This is dependency-free (no jq, no node), works in any POSIX shell, and handles whitespace around the colon. The skip guard (`[ -z "$STATE_REMOTE" ]`) ensures hooks are silent in repos that haven't run `squad bind`.

**Remote resolution order for sync:**
(1) CLI `--remote` flag, (2) `.squad/config.json stateRemote`, (3) hard default `'squad-docs'`. This mirrors the bind command's resolution: explicit CLI → config → sensible default. Do not inherit the push remote from git config — the state remote is a separate concern from the code remote.

**Developer alias guard placement:**
The `--developer` guard must fire BEFORE any git operations — including `ensureStateRemote`. This prevents any side effects on failure. Pattern: validate all required inputs at the top of the async function, before any await or subprocess call.



**Resolved-shape contract (for pieces 27+):**
- `workRoot` — product repo root, parent of `.squad/`
- `workSquadDir` — `{workRoot}/.squad` (the .squad/ dir in the product repo)
- `teamRoot` — team/sidecar repo root; equals `workRoot` in local (non-remote) mode
- `teamSquadDir` — `{teamRoot}/.squad` (the .squad/ dir in the team repo)
- In local mode: `workRoot === teamRoot`, `workSquadDir === teamSquadDir`
- In remote mode: `teamRoot` is resolved from `config.teamRoot` relative to `workRoot`
- Deprecated aliases: `projectDir` → `workSquadDir`, `teamDir` → `teamRoot` (NOT teamSquadDir)

**BindGitOps seam pattern:**
`bind.ts` accepts `gitOps?: BindGitOps` with four methods: `cloneOrFetch`, `addRemote`, `addRefspec`, `syncPull`. Default implementations use `execFileSync('git', ...)`. Tests inject stub implementations that record calls and return controlled output. This is the injectable-git-ops pattern for isolating commands that shell out to git. Reuse for any future command that wraps git operations.

**Deprecation warning mechanism (for pieces 27+):**
Module-level `_deprecationFired = { projectDir: false, teamDir: false }` (exported) ensures `console.warn` fires at most once per process per alias. `attachDeprecatedAliases()` uses `Object.defineProperties` with getter functions. Tests must reset `_deprecationFired.projectDir = false; _deprecationFired.teamDir = false` in `beforeEach`/`afterEach` for console.warn spies to work reliably. The export name `_deprecationFired` is the stable contract — use it for test resets in pieces 27+.

**New SquadDirConfig fields added:** `stateRemote`, `stateBranch`, `inboxBranchPrefix`, `developerAlias`, `teamCachePath`, `hydrateWorkRoot` — all optional, all parsed in `loadDirConfig()`.

### Piece 25 Rev — FIDO + CONTROL nits (2026-05-28)

Commit `185617e51e215dfbf59415a688ff9e1b9fd9a9af` folded the approved nits: CONTROL N1 typed the internal `resolveSquad` alias as `typeof resolveSquadDir`; FIDO N2 added the `@ts-expect-error` renderFinding exhaustiveness regression; FIDO N3 refreshed stale `resolveSquad` comments to `resolveSquadDir`. Gates: build/lint/SDK tsc/CLI tsc passed after controlling the known nested SDK dependency skew; `test/cli/doctor.test.ts` passed; full `npx vitest run` remained red with pre-existing failures (15 failed files / 225 passed / 1 skipped), matching the piece-25 review baseline. Revision complete; EECOM locked out by Flight.


## Archive

Older context (pieces 1–14, Q1 2026) in `history-archive.md`: template sync patterns, cherry-pick conflicts, loop command refactors, pre-Phase B lifecycle.

---
