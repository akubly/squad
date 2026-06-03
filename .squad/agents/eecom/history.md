# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

## Recent Pieces — Phase B Active (Summary)

📌 **Team update (2026-06-03 — Piece 30 Follow-On Revision):** Led piece-30 follow-on revision after Flight + Booster lockout; addressed CAPCOM M_NEW_1 (fold timestamp→ref-membership) + RETRO M_NEW_1 (clone stderr redaction); commit 3c6c9edf pushed to origin/squad/piece-30-ado-cross-repo-templates; 196→200 tests; Gate 8 net +2 (bash `$()` in fold script); mirrors byte-identical across 4 locations.

📌 **Team update (2026-06-02T21:55:00Z — Piece 30 ADO Templates Complete):** bootstrap-cross-repo.ps1 idempotency pattern: every mutation guarded with existence check (Test-Path, git config --get-all -contains, pre-computed $escapedEntry). sync-templates.mjs auto-picks up ado/ subdir recursively — no script changes needed. Gate 8 fixed in session: pre-computed variable instead of PowerShell subexpression.

📌 **Team update (2026-06-02T20:51:32Z — Piece 29 Adversarial Review Complete):** Piece 29 adversarial review (4 parallel reviewers: Flight, FIDO, RETRO, PAO) verdict APPROVE-WITH-NITS. Three convergent mandatory themes: (1) Explore agent spawn omits WORK_ROOT; (2) WORK_ROOT resolution undocumented at session start; (3) Single-repo degenerate case unaddressed. Procedures locked out. Candidate revision authors: EECOM, Flight, or CONTROL. Awaiting user decision on revision dispatch.

📌 **Team update (2026-06-02T19:27:39Z — Piece 28 Revision R2 Complete):** Your adversarial findings (CRITICAL allowlist, traversal guards, atomic metadata, fail-closed behavior) were addressed in CONTROL R2 commit aff12874. Flight gate approved all 23 items; both mutation guards confirmed live.

📌 **Team update (2026-06-02T19:27:39Z — Piece 28 Revision R2 Complete):** Piece 28 revision landed: all 8 CONTROL code items + 7 test items merged; Flight gate approved commit aff12874. EECOM lockout closed. Ready for next scheduled work.

**Pieces 15–24:** SDK lifecycle, registry health/doctor/fuzzy-match, init/unassign/bind refactors, Copilot payload orchestration, OTEL typing. All gate-cleared; revisions closed. Archive: pieces 1–14 in `history-archive.md`.

### Piece 09/10 Revisions (2026-05-15)
Piece 09: moved `resolveWatchStartupSquadDir` to startup.ts. Piece 10: addressed 6 blocking test gaps + 3 guard gaps. Both gates clean, 28/28 tests GREEN.

## Team Updates — Recent

📌 **Pieces 23–24 Rev Complete (2026-05-27–28):** Piece 23: F1–F4, N1–N2 addressed (env seam, qrcode typedef). Piece 24: N1–N4 OTEL typing closures (OTelSpanLike covariance, Meter/Tracer unions). Both gate-clean. Piece 25 (resolver rename) approved EECOM revision, all nits folded.

📌 **Piece 21 Ship Gate Cleared (2026-05-22):** Post-stack-review all five required fixes shipped. Follow-up (FIX-6/7/8) deferred to piece 22.

## Learnings

### Piece 30 Follow-On Revision — 2 Mandatory Fixes (2026-06-02)

**Ref-membership idempotency for fold pipelines:**
The correct idempotency key for a fold pipeline is the *ref name* recorded in the history file (`.[].inboxRef`), not a scalar timestamp. Timestamp-based cutoffs (`publishedAt > lastFoldedAt`) cause permanent silent data loss on clock skew and same-second ties — a realistic failure mode in multi-developer teams. The ref-name membership approach (`grep -qxF "$REF"`) is immune to all timing artifacts: re-running against an already-folded ref is a provable no-op. Pattern:

```bash
FOLDED_REFS=$(jq -r '.[].inboxRef // empty' "$HISTORY_FILE" 2>/dev/null || true)
if [ -n "$FOLDED_REFS" ] && printf '%s\n' "$FOLDED_REFS" | grep -qxF "$REF"; then
  echo "  Skipping $REF (already recorded in publish-history.json)"
  continue
fi
```

Malformed JSON guard is required alongside this pattern: if `$HISTORY_FILE` is corrupt, abort before any fold work to prevent data loss or partial states.

**git stderr redaction in PowerShell:**
When a git subprocess takes a URL with embedded credentials, `$ErrorActionPreference = 'Stop'` does NOT capture native command stderr — the raw URL leaks to pipeline logs on failure. Fix: capture `2>&1` into a variable, check `$LASTEXITCODE`, apply redaction before any `Write-Error`:

```powershell
$cloneOutput = & git clone -- $DocsRepoUrl $TeamRoot 2>&1
$cloneExitCode = $LASTEXITCODE
if ($cloneExitCode -ne 0) {
    $redactedOutput = ($cloneOutput | Out-String) -replace '://[^@/\s]+@', '://***@'
    $redactedOutput = $redactedOutput -replace [regex]::Escape($DocsRepoUrl), ($DocsRepoUrl -replace '://[^@/]+@', '://***@')
    Write-Error "git clone failed (exit $cloneExitCode). Sanitized output: $redactedOutput"
    exit 1
}
```

Apply to EVERY git invocation that accepts a `$DocsRepoUrl` parameter (clone, remote add, fetch). Defense-in-depth: both regex redaction AND literal URL replacement.

**Cross-trained fixes outside core CLI domain:**
Piece 30 follow-on required YAML pipeline editing (ADO fold logic) and PowerShell hardening — both outside the core CLI/SDK runtime domain that EECOM normally owns. These are small, well-specified surgical fixes. The key discipline: read the reviewer's exact suggested fix carefully before implementing; both CAPCOM and RETRO provided near-complete code samples that only needed minor adaptation to the actual script context.

**Scrub gate pre-existing baseline (piece 30):**
Gate 1: 32 strip-listed paths (pre-existing baseline; Squad's own `/casting/`, `/identity/`, `/orchestration-log` match the Wi-Fi Aware strip pattern incidentally). Gate 8: bash `$()` subexpressions in YAML script blocks trigger the ADO variable syntax check (pre-existing; all inline bash uses `$(...)` syntax that Gate 8 can't distinguish from ADO `$(Variable)` expressions). My revision added 2 new Gate 8 matches in fold-squad-state.yml step 3 (same type as pre-existing). No new Gate 1 paths introduced.

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

### Piece 27 Adversarial Review Lockout (2026-06-01T20:40:00Z)

Piece 27 (explicit sync command) completed adversarial review with three independent reviewers (FIDO, CONTROL, RETRO) all verdicts APPROVE-WITH-NITS. All three converged on identical defects: whitespace-only alias bypasses the empty-alias guard (H1/N1 across reviewers), and force-reinstall duplication in `installHook()` (N2/M2). Three mandatory nits identified: (1) whitespace-alias guard fix, (2) force-reinstall deduplication, (3) untyped config reads bypass SDK typed interface. EECOM (implementer) is locked out from performing the revision per strict squad protocol (implementer may not revise own work). Recommended revision author: CONTROL (TypeScript expertise for config-read typing) or EECOM if override negotiated. No reviewer rejection lockout — all three reviewers APPROVE-WITH-NITS. Session log: `.squad/log/2026-06-01T2040-piece-27-adversarial-review.md`.

### Piece 27 Nit Revision — Complete (2026-06-01T17:31:41Z)

📌 **Team update:** Flight (Lead) completed amendment commit `5d8509f4` addressing all three mandatory nits (N1/H1 whitespace-alias guard, N2 force-reinstall idempotency, N3 typed config loading via `loadDirConfig()`). EECOM locked out per reviewer protocol; Flight assigned as revision author. All tests PASS (sync-command 33/33, install-hooks 16/16, recursion guard PASS in all 4 hook templates). Branch `squad/piece-27-explicit-sync-command` push confirmed. Revision metadata synced to `.squad/decisions.md` and cross-agent histories.

## Archive

Older context (pieces 1–14, Q1 2026) in `history-archive.md`: template sync patterns, cherry-pick conflicts, loop command refactors, pre-Phase B lifecycle.

---
📌 **2026-06-02 Piece 29 Spawn-Contract Update — Five Variables Required (Commit b642f9cd):** Piece 29 replaces single TEAM_ROOT label with five-variable protocol (TEAM_ROOT, WORK_ROOT, STATE_REMOTE, STATE_BRANCH, DEVELOPER_ALIAS). All future agent prompts must include all five without optional omission. State reads/writes via TEAM_ROOT; product work in WORK_ROOT. Backward-compat projection at WORK_ROOT/.squad is read-only. Session restart required for any active sessions.
