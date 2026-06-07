# FIDO

> Flight Dynamics Officer

## Core Context

Quality gate authority for all PRs. Test assertion arrays (EXPECTED_GUIDES, EXPECTED_FEATURES, EXPECTED_SCENARIOS, etc.) MUST stay in sync with files on disk. When reviewing PRs with CI failures, always check if dev branch has the same failures — don't block PRs for pre-existing issues. 3,931 tests passing, 149 test files, ~89s runtime.

## Current Session — Piece 34 Review Cycle (2026-06-06)

### Piece 34 Adversarial Review & A3 Test Standard

**Initial Review (Commit `b0045b27`):**
- A3 recursion-guard test asserts exit 0 but does not prove guard fired
- Test is not load-bearing; would pass if guard removed
- Verdict: REJECT until test corrected

**Reviewer-Rejection Lockout:**
- EECOM locked out; FIDO required to revise (owns test-standard)
- Implemented sh-function sentinel + marker-file approach
- Three-case structure with load-bearing guard-absent case (Case 3)
- Re-verification: APPROVE

**Binding Standard (for all future hook tests):**

> Any test claiming to verify a recursion guard MUST detect whether the guarded command was invoked, not merely whether the script exited 0.

Acceptable approaches:
1. Sentinel binary on PATH with exit code / marker file
2. Marker file approach
3. Stderr check (if guard path produces no stderr)

**Outcome:** FIDO owns this standard. All future recursion-guard test assertions must pass FIDO's invocation-detection check.

## Key Patterns

- Test suite timeout/contention produces 10–20× apparent regressions vs real failure count — always spot-check in isolation
- Observable-behavior regression guards (e.g., absence of refs on remote) provide protection but are mode-fragile vs spy-based NOT-called assertions
- Full idempotency checks comparing HEAD to orphan SHA are structurally broken unless HEAD is explicitly updated
- sessionId flows into git ref names — must validate for git-ref legality, not just alias/branch-name fields

## Archive

Older reviews (pieces 04–33) documented in `history-archive.md`.

Consequence: if the `if [ -z "$SQUAD_SYNC_ACTIVE" ]; then ... fi` guard were removed, the test assertion `expect(result.status).toBe(0)` would STILL PASS — `squad sync` would be called (and possibly fail), `unset` would run, script exits 0. The kill-list criterion requires "a test that would fail if the guard were removed." This test would not fail. The test is effectively a more expensive version of the template-grep pattern (A2 already checks the guard string is present).

A compliant A3 must detect INVOCATION of `squad sync`, not just exit code. Options: (a) write a sentinel `squad` script to a temp dir on PATH that exits non-zero, assert the hook exits non-zero without the guard; (b) write a sentinel `squad` script that creates a marker file, assert the marker does NOT exist after running with `SQUAD_SYNC_ACTIVE=1`; (c) assert the process's stderr is empty (no "squad: command not found" or squad output).

---

**A3 REVISION (FIDO owns this fix; reviewer-rejection lockout applies to EECOM)**

Applied fix in working tree (uncommitted). Design:

- **Approach:** sh function preamble. Define `squad() { printf "" > "$MARKER"; }` before the hook body. A sh function shadows any PATH entry, so `squad sync --push --quiet` always invokes our function. No PATH manipulation, no file-permission issues — identical behavior on Windows (MSYS2 sh.exe) and Unix.
- **Why not PATH injection:** git's sh.exe (MSYS2) does not ship `touch` on PATH. PATH-based sentinels require `chmod +x` which is a no-op on Windows NTFS from Node.js. Function preamble is unambiguous.
- **Three cases:**
  1. Guard active (`SQUAD_SYNC_ACTIVE=1`) → marker ABSENT ✓ (guard fires, if-block skipped)
  2. Guard inactive (unset) → marker PRESENT ✓ (if-block runs, `squad` function invoked)
  3. Guard-removal proof: strip `if [...]` and `fi` from a local copy of the hook body; run with `SQUAD_SYNC_ACTIVE=1`; assert marker PRESENT ✓ (proves Case 1 would FAIL if guard removed)

**Results after fix:** `install-hooks.test.ts` — 6/6 PASS (A1–A6), 1 SKIP (B). All assertions GREEN.

---

**NON-BLOCKING GAP — Single-repo push path has no piece-34 regression test**

The `writeLastPublish(repoRoot)` call is inserted after `syncPush()` on the single-repo path. Risk is extremely low (`writeLastPublish` is try-catch wrapped and cannot throw), but no new test exercises the single-repo push path under piece-34. Pre-existing `cross-repo-sync.test.ts` B2 exercises the single-repo fallback but was written before `writeLastPublish` was added. Not a blocker given the non-throwing best-effort nature of `writeLastPublish`, but coverage is incomplete per FIDO scope item 5.

---

**Kill-list items assessed:**

| Kill-list constraint | Test | Status |
|---|---|---|
| Docs-repo clone ONLY; no CWD fallback | A1 (installs in docsRepo not productRepo) | ✅ |
| Recursion guard exercised behaviorally | A3 (sentinel function; invocation-detection; guard-removal proof) | ✅ (after fix) |
| Error (not warning) on non-git path | A4 (expects throw matching /not a git repository/i) | ✅ |
| Idempotent: marker appears exactly once | A5 (marker count = 1 after two calls) | ✅ |
| No hook from ensureHooksForBackend | A6 (calls ensureHooksForBackend; asserts no post-commit) | ✅ |
| B determination documented before commit | it.skip stub + decisions/inbox/piece-34-B-deferred.md | ✅ |
| --dry-run does NOT call publishTeamRootToInbox | C1 (spy asserts not.toHaveBeenCalled) | ✅ |
| squad sync status: all six fields | C2 (regex match for each field label + values) | ✅ |
| .last-publish read when present / "never" when absent | C3, C4 | ✅ |
| --quiet suppresses stdout, errors reach stderr | C6 (logSpy and publishSpy asserted) | ✅ |
| assign with developerAlias triggers hook install | P34.A1 | ✅ |
| assign gracefully degrades when hook throws | P34.A2 (warning in result.warnings) | ✅ |
| Registry-first topology preserved | All registry mock tests pass; config.json not primary | ✅ |

---

**Conditional APPROVE:** Fix must be folded into the product commit (`b0045b27`) before the branch is pushed. No other changes needed.

---

**Patterns learned:**

- **Exit-0 guard tests fail when the last shell command is a cleanup step.** When a hook template ends with `unset VARIABLE`, any intermediate command failure is masked. A behavioral guard test must detect invocation, not just exit code. Pattern to watch: any `unset`/`trap`/`exec` at the end of a hook template neutralizes exit-code-based guard assertions.
- **Recursion guard tests need a sentinel function or a failing-binary, not just exit-code.** Define `squad() { ... }` before the hook body to intercept invocations — sh functions shadow PATH entries, works on all platforms.
- **git's sh.exe (MSYS2) does not ship `touch` on PATH.** Use `printf "" > file` or `> file` (empty redirect) for cross-platform file creation in sh tests. Do not assume POSIX utilities beyond what git-bash guarantees.
- **Full-suite worker-timeout count fluctuates** but is always pre-existing IPC noise; isolated runs are the reliable signal.

---

## History Summary (2026-05-13 — 2026-06-05)

FIDO reviewed six pieces (24, 25, 32, 32-nits, 32-verify, 32.5) across May–June 2026. Key review patterns:

### Piece Outcomes
- **P24 (SDK Adapter):** APPROVE-WITH-NITS (three mandatory on testing/arity, one undisclosed return-type)
- **P25 (Resolver Rename):** APPROVE-WITH-NITS (dependency-mode control discovery; no blockers)
- **P32 (Registry State):** APPROVE-WITH-NITS (22 apparent test regressions = timeout contention, zero real failures)
- **P32 Nit-fix:** APPROVE (all nits verified; 27/27 GREEN)
- **P32.5 (Transport Helpers):** APPROVE (findings documented; implementation sound; 10/10 GREEN)

### Critical Learnings
- **Dependency-mode control required:** Clean npm install creates nested stale SDK; workspace-linked mode controls skew
- **Timeout contention cascades:** Full-suite runs produce 10–20× apparent regression count vs isolation; always spot-check before blocker
- **idempotency via orphan-SHA comparison is broken:** HEAD and snapshot commit SHAs can never match; three fix options documented
- **sessionId must validate for git-ref legality:** Caller strings flowing into ref names need pre-flight validation
- **Verify code presence before reviewing:** "not a function" errors indicate missing exports, not test logic issues

### Non-Blocking Patterns (All Pieces)
- Type-union return-type removals require explicit sign-off
- Multi-overload functions need 3+ tests per path for arity coverage
- Guard-order tests must simulate downstream behavior, not identity mock
- Test isolation needs pinned env vars across all test cases

Full details in entries above (Piece 32.5 entry contains adversarial findings re: idempotency, sessionId, PII-test robustness, boundary testing).
