# Adversarial Code Review — Piece 13: Hard-remove `register`

**Branch:** `akubly/upstream-13-hard-remove-register`  
**Commit:** `01ae3060 feat(cli)!: hard-remove squad register command`  
**Predecessor:** `akubly/upstream-12-platform-adapter` (commit `6cb64205`)  
**Spec:** `akubly/upstream-specs:docs/proposals/upstream-bradygaster/13-hard-remove-register.md`  
**Reviewer:** Flight (Copilot Code Review Agent)  
**Requested by:** Aaron Kubly  
**Date:** 2026-05-18T11:45:05.115-07:00  

---

## Verdict

**REJECT — RETURN TO IMPLEMENTER**

**Critical blocker:** Commit message contains a severe typo ("egister subcommand" and "ssign") that will ship to the upstream Git history. This violates basic quality standards and requires a commit re-write.

**Additional findings:** 3 non-blocking issues noted for improvement.

---

## Spec Parity Audit

| Spec Contract | Satisfied | Evidence | Comment |
|--------------|-----------|----------|---------|
| Teaching error exits with code 2 | ✅ YES | `test/cli/register.test.ts:66` | PASS |
| Teaching error includes `ERR_SQUAD_REGISTER_REMOVED` | ✅ YES | `test/cli/register.test.ts:67` | PASS |
| Teaching error includes `squad assign <callsign>` | ✅ YES | `test/cli/register.test.ts:69` | PASS |
| Teaching error includes `squad init --callsign` | ✅ YES | `test/cli/register.test.ts:70` | PASS |
| Teaching error includes `squad list` | ✅ YES | `test/cli/register.test.ts:71` | PASS |
| Teaching error does not suggest `register` | ✅ YES | `test/cli/register.test.ts:84-95` | PASS |
| Teaching error ignores additional flags | ✅ YES | `test/cli/register.test.ts:74-86` | PASS |
| Does not create registry file | ✅ YES | `test/cli/register.test.ts:85` | PASS |
| Dispatch before unknown-command | ✅ YES | `cli-entry.ts:897` | PASS |
| `squad help` excludes `register` | ✅ YES | `test/cli/register.test.ts:108-114` | PASS |
| `squad --help` excludes `register` | ✅ YES | `test/cli/register.test.ts:116-120` | PASS |
| `squad help register` no subcommand help | ✅ YES | `test/cli/register.test.ts:122-128` | PASS |
| Package export removed | ✅ YES | `test/cli/register.test.ts:132-138` | PASS |
| Module file deleted | ✅ YES | `test/cli/register.test.ts:140-143` | PASS |
| Stale guidance cleanup | ⚠️ PARTIAL | `test/cli/register.test.ts:148-159` | Static assertions only |
| No `runRegister` imports | ✅ YES | `test/cli/register.test.ts:162-168` | PASS (static) |
| Success tests replaced | ✅ YES | Git diff shows 3 deleted, 1 rewritten | PASS |
| Major changeset | ✅ YES | `.changeset/remove-register-command.md` | PASS |
| SDK not bumped | ✅ YES | Only CLI in changeset | PASS |
| Error to stderr | ✅ YES | `test/cli/register.test.ts:67,188` | PASS |
| Exact error text | ✅ YES | `cli-entry.ts:903-906` matches spec | PASS |

**Summary:** 19/20 contracts fully satisfied, 1 partial (static vs behavioral tests).

---

## Findings

### 1. BLOCKER — Commit Message Typos

**Severity:** BLOCKER  
**Category:** Quality  
**File:** Commit message (01ae3060)  

**Problem:**

Two typos in commit message that will ship to upstream Git history:

Line 3: `The egister subcommand` → should be `The register subcommand`  
Line 17: `covered by ssign` → should be `covered by assign`

**Why it matters:**

This will be visible in upstream Git history and release notes, undermining credibility.

**Suggested fix:**

```bash
git commit --amend  # fix typos in editor
git push --force-with-lease origin akubly/upstream-13-hard-remove-register
```

---

### 2. HIGH — Scrub Gate Baseline Contamination

**Severity:** HIGH (documented, not blocking)  
**Category:** Scrub Gate  

**Problem:**

Gate 1 fails with 93+ strip-listed paths (`.squad/orchestration-log/`, `.squad/casting/`, `docs/_internal/`, etc.).

**Evidence:**

Piece 13 diff adds ZERO new strip-listed paths (verified). All failures are pre-existing baseline contamination from prior pieces.

**Disposition:**

Per `.squad/decisions.md` precedent (pieces 04, 07, 08a, 10), baseline contamination is accepted as upstream's cleanup responsibility, not this piece's. Documented here for transparency.

---

### 3. MEDIUM — Stale Guidance Tests Use Static Assertions

**Severity:** MEDIUM  
**Category:** Test Rigor  
**File:** `test/cli/register.test.ts:146-169`  

**Problem:**

Stale guidance cleanup tests read source files and regex-match, rather than spawning CLI and asserting runtime output.

**Why it matters:**

Static tests miss runtime-conditional stale guidance (env vars, error paths).

**Suggested fix:**

Add behavioral tests:

```typescript
it('`squad list` does not mention register', async () => {
  const result = await runCli(['list'], { SQUAD_REGISTRY_PATH: tempRegistry() });
  expect(result.stdout).not.toMatch(/squad register/);
});
```

**Disposition:** Not blocking (spec doesn't require behavioral tests for this).

---

### 4. LOW — Missing Test for `squad register --help`

**Severity:** LOW  
**Category:** Test Coverage  

**Problem:**

No explicit test that `squad register --help` returns teaching error (exit 2) rather than help text.

**Evidence:**

Implementation is correct (verified by dispatch trace), but test coverage could be more explicit.

**Suggested fix:**

```typescript
it('`squad register --help` returns teaching error', async () => {
  const result = await runCli(['register', '--help']);
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain('ERR_SQUAD_REGISTER_REMOVED');
});
```

**Disposition:** Not blocking (implicit coverage via dispatch ordering).

---

## Tone & Record Audit

**Result:** CLEAN

- `git grep -i 'wifi.aware'` → 0 hits ✅
- No fork-history language ✅
- No porting/preview-channel references ✅
- Changeset uses neutral upstream language ✅
- `.squad/` state correctly excluded from code commit ✅

---

## Scope Assessment

**16 files changed** (under 30-file limit):

| File Category | Count | Authorized? |
|---------------|-------|-------------|
| Spec manifest files | 7 | ✅ YES |
| Command modules (stale guidance) | 3 | ✅ YES |
| Test files | 1 | ✅ YES |
| Template files | 5 | ⚠️ PARTIAL |

**Template scope expansion:** 5 template files updated to remove stale `squad register` guidance. Not explicitly in spec's "Expected files" list, but defensible as part of user-facing guidance surface.

**Recommendation:** Note in PR description.

---

## Test Rigor Assessment

- **6 BEHAVIORAL tests** (spawn CLI, assert output/exit) ✅
- **4 STATIC tests** (read source, assert content) ⚠️
- **0 REDUNDANT tests** ✅

**Overall:** GOOD. Primary contracts have behavioral coverage.

---

## Additional Verification

### Dispatch Ordering

Traced `cli-entry.ts` line-by-line:

- Line 897: `if (cmd === 'register')` fires BEFORE unknown-command
- Line 908: `process.exit(2)`
- `squad register --help` falls through to teaching error (NOT intercepted by per-command help at line 249)

**Verdict:** CORRECT ✅

### Exit Code Contract

All paths exit 2:
- Bare `register` ✅
- `register --callsign ...` ✅
- `register --help` ✅ (traced, not explicitly tested)

### Squad State Separation

`git show --stat 01ae3060 | grep '.squad/'` → empty ✅

Working tree has modified `.squad/agents/*/history.md` but NOT in commit (correct per Phase B protocol).

---

## Summary

**Required fix:** Amend commit message to correct typos.

**Recommended fixes:** Add behavioral tests for stale guidance and `--help` edge case.

**Implementation quality:** Excellent. Code, tests, and changeset are all spec-compliant.

---

## Lockout & Assignment

Per Reviewer Rejection Protocol, original implementer is locked out.

**Recommended revision agent:** SURGEON (Git surgery specialist) or CONTROL (Senior Dev).

**Task:** Amend commit message, force-push.

---

**Report prepared by:** Flight  
**Review completed:** 2026-05-18  
