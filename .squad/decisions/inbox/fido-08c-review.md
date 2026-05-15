# FIDO Review — 08c Lifecycle Command Resolver Migration

**Date:** 2026-05-14T17:54:18.903-07:00
**Branch:** `akubly/upstream-08c-migrate-lifecycle-commands`
**Commit:** `3c2528d4`
**Author:** VOX

---

```
VERDICT: APPROVE_WITH_FOLLOWUPS
```

## Summary

All 6 spec-mandated tests exist, pass GREEN (23/23), and exercise the correct code paths. The resolver integration is structurally sound — `resolveSquadV2` runs before any long-lived process state for both `start` and `rc`, the `squadDir` option threads correctly through runner constructors, and mock seams prevent real tunnels/spawns. Two assertion weaknesses and one missing negative-path test warrant followup hardening but are not blockers.

---

## Findings

### 1. Weak assertion on resolver-throw path
- **Severity:** major
- **What:** `cli-entry lifecycle > rc does not start bridge when resolution throws` (line ~631)
- **Why:** Only asserts `timedOut === false`. Does NOT verify the resolver error is surfaced in stdout/stderr. The spec requires "Resolver errors are surfaced before runRC() is imported or invoked." The test would still pass if the process crashed silently with exit code 1 and no user-facing message.
- **Fix:** Add `expect(result.stdout + result.stderr).toMatch(/registry|invalid|error/i)` to prove the error text reaches the user.

### 2. Passthrough args test exercises runner, not dispatch
- **Severity:** major
- **What:** `cli-entry lifecycle > start preserves Copilot passthrough args` (line ~670)
- **Why:** Uses `vi.doMock` + direct `import('start.ts')` — proves the runner passes args to PTY, but does NOT exercise the dispatch layer's `copilotArgs` filtering logic (cli-entry.ts line 887-888). The spec says "Resolver migration does not consume Copilot arguments that are not Squad flags." A bug in the squadFlags filter at dispatch would pass this test.
- **Fix:** Add a dispatch-level variant using `runCliShort(['start', '--extra-copilot-flag'], ...)` with a registered fixture, verifying the flag appears in output or PTY args. Alternatively, reframe the existing test name to clarify it's runner-level.

### 3. Missing symmetric test: `start` resolver-throw path
- **Severity:** minor
- **What:** No test for `start` when resolver throws (only null is tested)
- **Why:** The implementation at cli-entry.ts:872 calls `resolveSquadV2` without try-catch. If the resolver throws on corrupt registry, the error goes through `main().catch()`. This works, but there's no test proving `start` surfaces the error just as `rc` does. Asymmetric coverage.
- **Fix:** Add `it('start does not start bridge when resolution throws', ...)` mirroring the rc variant — write invalid JSON to registry, invoke `start` from a registered consumer, assert `timedOut === false` and error message visible.

### 4. No deprecation notice assertion
- **Severity:** minor
- **What:** None of the 6 new tests verify the deprecation notice is still printed
- **Why:** The spec notes "Keep deprecation notices unchanged." The implementation prints deprecation BEFORE the resolver call (line 870-871), which is correct, but there's no regression gate if someone reorders or removes it.
- **Fix:** Add `expect(result.stdout + result.stderr).toMatch(/deprecated/i)` to one of the dispatch-level tests (e.g., the null-resolution test already captures output).

### 5. Timing-sensitive mock assertions
- **Severity:** minor
- **What:** Runner-level tests (`start resolves...`, `rc resolves...`, `start preserves...`) use `await new Promise(r => setTimeout(r, 150))`
- **Why:** Race condition if CI runner is under load and async mock setup takes >150ms. Unlikely but not impossible. Better pattern: await a deterministic signal (e.g., mock function was called).
- **Fix:** Replace fixed timeout with `vi.waitFor(() => expect(remoteBridgeCtor).toHaveBeenCalled())` or poll on the mock capture.

### 6. Snapshot drift is pre-existing CRLF noise
- **Severity:** nit
- **What:** `test/__snapshots__/parser-contracts.test.ts.snap` shows as modified (unstaged)
- **Why:** Only CRLF line-ending normalization on Windows checkout. Not caused by 08c. No content changes.
- **Fix:** No action needed for this PR. Optionally add `.gitattributes` rule for `.snap` files.

### 7. `runCli` helper (08a/08b) does not strip SQUAD_CALLSIGN
- **Severity:** nit
- **What:** The older `runCli` helper (line 44) passes `...process.env` without omitting `SQUAD_CALLSIGN`
- **Why:** Pre-existing from 08a/08b, not 08c's fault. The new `runCliShort` correctly uses destructure-omit. If a dev has `SQUAD_CALLSIGN` set, older tests could behave unexpectedly.
- **Fix:** Out of scope for 08c. File as tech-debt for SIMS to backfill.

---

## Mock Seam Assessment

✅ `RemoteBridge` — constructor captured, no real bridge started
✅ `rc-tunnel.js` — fully mocked, `isDevtunnelAvailable` returns false
✅ `node-pty` — spawn mocked, returns inert object
✅ `node:child_process` — spawn mocked for rc
✅ afterEach cleans TEST_ROOT and restores mocks — no leaked state
✅ `runCliShort` kills child on timeout — no leaked processes

## SQUAD_CALLSIGN Handling

✅ `runCliShort` uses destructure-omit: `const { SQUAD_CALLSIGN: _omit, ...inheritedEnv } = process.env`
✅ No test passes `SQUAD_CALLSIGN: ''` (correct)

## Cross-Platform

✅ Path comparisons use `join()` on both sides (platform-native)
✅ Deep nested TEST_ROOT exercises long paths (Windows MAX_PATH adjacent)
⚠️ No explicit posix-vs-win normalization in assertions — acceptable since both sides use same `join()`

## CI Gate Readiness

✅ Tests pass locally in 21.9s (within 60s timeout)
⚠️ 150ms timing windows (finding #5) could theoretically flake under extreme load
