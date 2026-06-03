# Piece 30 Adversarial Review — FIDO (Quality/Tests)

**Verdict:** APPROVE-WITH-NITS
**Mandatory findings:** 1
**Non-blocking findings:** 4

---

## Summary

The piece-30 test suite is structurally sound: the `yaml` package is correctly wired, the no-PR-trigger gate is robust against realistic mutations, sole-writer comment is machine-asserted, and all 9 mirror files are byte-compared against canonical. One mandatory gap remains: `bootstrap-cross-repo.ps1` idempotency is claimed via source reading only — no test ever executes the script. Four non-blocking findings cover trigger structural fidelity, guard ordering, a step-level invariant gap, and URL validation scope.

---

## Mandatory (M1)

### M1 — No execution-based idempotency test for `bootstrap-cross-repo.ps1`

**Where:** `test/cli/ado-templates.test.ts` (entire test file for bootstrap)

**What:** The commit message states "Idempotency guards confirmed" for all five mutation points (clone, bind, remote add, refspecs, exclude entries). The tests for the bootstrap script are two regex scans of the raw `.ps1` source text — they verify that the guard pattern **exists** in the file, but do not execute the script against a real or mock git repository. No test runs the script once, runs it again, and asserts absence of duplicate remote entries or duplicate exclude lines.

**Why it blocks:** The spec mandates idempotent behavior as a first-class correctness requirement: "The script must tolerate being run against an already-bootstrapped WORK_ROOT without overwriting existing config or duplicating exclude entries." Source-reading tests can miss subtle bugs in the idempotency logic:
- The exclude-file regex uses `[regex]::Escape($entry)` wrapped in a multi-line pattern `"(^|\n)${escapedEntry}(\r?\n|$)"`. A bug in that pattern (e.g., wrong EOL handling on Windows `\r\n` files) would not be caught.
- The refspec idempotency relies on `$existingRefspecs -contains $StateRefspec` — an exact string match. A minor variation in how git normalizes refspec strings could defeat it silently.

**Suggested fix:** Add a Vitest test using `execSync`/`spawnSync` in a temp sandbox git repo (following the `withSyncSandbox` pattern already in `template-sync.test.ts`). Run the script twice (or simulate the two runs by pre-seeding the expected outputs of step 1 and step 2), then assert that `git remote -v` output contains exactly one `squad-docs` entry and that the `.git/info/exclude` file contains each exclusion pattern exactly once.

---

## Non-blocking (N1–N4)

### N1 — Guard-ordering assertion is text-presence-only; position is not verified

**Where:** `test/cli/ado-templates.test.ts:107–117`

**What:** The test checks that `IsNullOrWhiteSpace($DeveloperAlias)` (or an equivalent pattern) appears **somewhere** in the script text. It does not verify that the guard appears **before the first write operation** (`git clone` on line 84 of the PS1). A future edit that moves the guard below the clone would not trip the test. The spec explicitly requires "before any write operation."

**Why non-blocking:** The current implementation IS correctly ordered. A reordering would produce a git error (`git clone ""`) before any state corruption, halting the script via `$ErrorActionPreference = 'Stop'`. The UX would degrade (opaque git error vs. clear guard message) but no silent damage would occur.

**Suggested improvement:** Add a line-number assertion: find the line index of the guard match and the line index of the first git/squad write call, and assert `guardLineIndex < firstWriteLineIndex`.

---

### N2 — Trigger structural fidelity gap in `publish-inbox.yml` and `fold-squad-state.yml`

**Where:** `test/cli/ado-templates.test.ts:55–62`, `test/cli/ado-templates.test.ts:82–91`

**What:** Both trigger assertions use `JSON.stringify(trigger)` and `toContain('squad/inbox')`. This catches removal of the `squad/inbox` value but misses YAML **key-name mutations**. If the `include:` key were renamed to `Include:` or `include_branches:`, the `squad/inbox/**` value would still appear in the JSON dump and the test would pass — even though ADO would not recognize the key and the pipeline would trigger on all pushes.

**Mutation evidence (by reading):**

| Mutation | Prediction | Result |
|---|---|---|
| Remove `squad/inbox/**` from include | `toContain` fails | ✓ Gate trips |
| Change `include:` → `Include:` | value `squad/inbox/**` still in JSON | ✗ Gate misses |
| Add `pr: none` | `toHaveProperty('pr')` = true | ✓ Gate trips |
| Add `pr: { branches: [main] }` | `toHaveProperty('pr')` = true | ✓ Gate trips |
| Add `pr: []` | `toHaveProperty('pr')` = true | ✓ Gate trips |
| Add `# pr: none` (comment only) | YAML parser strips comment; no `pr` key | ✓ Correct non-trip |

**Suggested improvement:** Assert `parsed.trigger.branches.include` is an array containing a value matching `squad/inbox` rather than string-scanning `JSON.stringify(trigger)`.

---

### N3 — No assertion that `publish-inbox.yml` steps do not write to `squad-state`

**Where:** `test/cli/ado-templates.test.ts` (missing)

**What:** The spec states: "Does not write to `squad-state` at any step." The current tests for `publish-inbox.yml` verify: valid YAML, no `pr:` trigger, trigger includes `squad/inbox`. There is no machine-checkable assertion that none of the `script:` steps push to `squad-state`. The test verifies the trigger and trigger-absence properties but not the step invariant. A future editor who adds `git push origin HEAD:squad-state` to a `publish-inbox.yml` step would not be caught.

**Suggested improvement:** Add `expect(raw).not.toMatch(/push.*squad-state|squad-state.*push/)` or check that no step's `script:` field contains `squad-state` combined with a push verb.

---

### N4 — `$DocsRepoUrl` receives no URL-format validation; `file://` and malformed URLs accepted

**Where:** `.squad-templates/ado/bootstrap-cross-repo.ps1:55–58`

**What:** The guard for `$DocsRepoUrl` is `[string]::IsNullOrWhiteSpace` only. A `file:///etc/passwd` URL, a `javascript:` scheme, or a completely malformed string all pass the guard and reach `git clone`. `$ErrorActionPreference = 'Stop'` ensures the script halts on clone failure, so no silent damage occurs. However, the failure mode is an opaque git error rather than a descriptive guard message.

**Predicted hostile-input behavior:**

| Input | Behavior |
|---|---|
| `""` (empty) | IsNullOrWhiteSpace catches → `exit 1`, descriptive message ✓ |
| `"   "` (whitespace) | IsNullOrWhiteSpace catches → `exit 1` ✓ |
| `$null` | Cast to `[string]` = empty → IsNullOrWhiteSpace catches ✓ |
| `"file:///C:/local"` | Passes guard, reaches `git clone` — succeeds or fails depending on path. Not rejected. |
| `"not-a-url"` | Passes guard, git clone fails with git error, script halts. |
| `"https://malformed url"` | git clone fails; script halts. No silent continuation. |

**Why non-blocking:** In the intended pipeline use case, `$(docsRepoUrl)` is set by a pipeline admin. An empty or whitespace value is the primary accidental error; the guard handles it. The `file://` and malformed-URL cases produce visible failures. No injection vector exists because PowerShell parameter binding does not invoke a shell.

---

## Mutation Tests Run

> Method: code-reading inference (script not executed). Templates and test file read via `git show 10168051`.

### `publish-inbox.yml` mutations

| Mutation | Predicted gate behavior |
|---|---|
| Remove `squad/inbox/**` from `include:` | `toContain('squad/inbox')` fails — gate trips ✓ |
| Add `pr: none` at root | `.not.toHaveProperty('pr')` — gate trips ✓ |
| Add `pr: { branches: [main] }` | `.not.toHaveProperty('pr')` — gate trips ✓ |
| Add `pr: []` at root | `.not.toHaveProperty('pr')` — gate trips ✓ |
| Add `# pr: none` (YAML comment) | YAML strips comment; no `pr` key; gate does NOT trip ✓ (correct) |
| Remove `trigger:` section entirely | `toBeDefined()` on trigger fails — gate trips ✓ |
| Change `squad/inbox/**` → `squd/inbox/**` | `toContain('squad/inbox')` fails — gate trips ✓ |
| Rename `include:` → `Include:` (case) | value still in JSON dump; gate does NOT trip ✗ (N2 gap) |

### `fold-squad-state.yml` mutations

| Mutation | Predicted gate behavior |
|---|---|
| Remove `# SOLE WRITER INVARIANT` comment | `toContain('SOLE WRITER INVARIANT')` fails — gate trips ✓ |
| Change `SOLE WRITER INVARIANT` → `SOLE-WRITER INVARIANT` | fails — gate trips ✓ |
| Add `pool: { allowScripts: true }` | `.not.toHaveProperty('allowScripts')` — gate trips ✓ |
| Add top-level `allowScripts: true` | top-level check fails — gate trips ✓ |
| Remove `squad/inbox/**` from trigger | `toContain('squad/inbox')` fails — gate trips ✓ |
| Move `env: SYSTEM_ACCESSTOKEN` to pool level | not checked (step-level env is out of scope for the pool-level OAuth gate); gate does NOT trip — acceptable per spec ✓ |

### `bootstrap-cross-repo.ps1` mutations

| Mutation | Predicted gate behavior |
|---|---|
| Replace `IsNullOrWhiteSpace` with `IsNullOrEmpty` | None of the three accepted patterns match — gate trips ✓ |
| Remove `if ([string]::IsNullOrWhiteSpace($DeveloperAlias))` block | Regex match fails — gate trips ✓ |
| Move guard block to after `git clone` line | Guard text still present; regex still matches — gate does NOT trip ✗ (N1 gap) |
| Replace valid alias check with always-true condition | Pattern still matches `IsNullOrWhiteSpace`; gate does NOT trip ✗ (not tested) |

---

## Hostile-Input Probes

### `$DeveloperAlias` inputs

| Scenario | Behavior |
|---|---|
| `""` (empty string) | `IsNullOrWhiteSpace` catches → `Write-Error` + `exit 1` |
| `"   "` (spaces only) | `IsNullOrWhiteSpace` catches → `exit 1` |
| `$null` | Cast to `[string]` yields `""`; `IsNullOrWhiteSpace` catches → `exit 1` |
| `"alice smith"` (space in alias) | Passes IsNullOrWhiteSpace; format regex `^[a-z][a-z0-9-]{0,38}$` rejects (space not in char class) → `Write-Error` + `exit 1` ✓ |
| `"alice/smith"` (slash) | Format regex rejects → `exit 1` ✓ |
| `"alice;rm -rf"` (semicolon) | Format regex rejects → `exit 1`. No injection: PowerShell quoted strings; `;` is not a command separator inside `"..."`. ✓ |
| `"ALICE"` (uppercase) | Format regex rejects (requires `[a-z]` start) → `exit 1` ✓ |
| `"a"` (minimal valid) | Passes both guards. ✓ |
| `"a" * 40` (too long) | Format regex `{0,38}` allows max 39 total chars; 40-char alias rejected ✓ |

### `$DocsRepoUrl` inputs

| Scenario | Behavior |
|---|---|
| `""` | `IsNullOrWhiteSpace` catches → `exit 1` ✓ |
| `"   "` | `IsNullOrWhiteSpace` catches → `exit 1` ✓ |
| `$null` | Cast to empty string; `IsNullOrWhiteSpace` catches → `exit 1` ✓ |
| `"file:///C:/local-repo"` | Passes guard; git clone attempts from local path — works or fails depending on path; no injection. No security risk in pipeline context. |
| `"https://mal formed url"` | Passes guard; git clone fails with git error; `$ErrorActionPreference = 'Stop'` halts script. No silent continuation. |
| `"https://dev.azure.com/nonexistent"` | Passes guard; git clone fails with authentication or 404 error; script halts. ✓ |
| `"; git push origin --all"` | Format validation does NOT apply to `$DocsRepoUrl`. However, PowerShell string interpolation in `git clone "$DocsRepoUrl"` passes it as a single quoted argument — no shell injection path exists. ✓ |

---

## Test-Count Verification

**Commit claim:** "190 tests pass (9 ado-template behavioral + 181 template-sync including 12 new ADO mirror assertions)"

**Actual run (2026-06-02, branch `squad/piece-30-ado-cross-repo-templates`, commit `10168051`):**

```
npx vitest run test/cli/ado-templates.test.ts test/template-sync.test.ts --no-coverage
✓ test/cli/ado-templates.test.ts  (9 tests)   20ms
✓ test/template-sync.test.ts      (181 tests) 1789ms
Tests  190 passed (190)
```

**Verdict:** Count **verified**. 9 + 181 = 190. No discrepancy.

**Full suite note:** The full `npx vitest run` suite shows pre-existing failures (161 failed / 6874 passed across 247 test files). None of the failures are in the two piece-30 files. Pre-existing failure baseline is consistent with history.

---

## Dynamic Enumeration Coverage Note

`test/template-sync.test.ts` section 2 (`dynamic template enumeration`) uses `collectFiles(SOURCE_DIR)` which recursively collects all files under `.squad-templates/` — including the new `ado/` subdirectory. `MIRROR_TARGETS` covers all three mirror directories (`templates`, `packages/squad-cli/templates`, `packages/squad-sdk/templates`). The explicit section 8 ADO assertions are therefore belt-and-suspenders, providing named-file error messages on top of the dynamic coverage. Both layers pass.

---

_Review date: 2026-06-02. Reviewed by FIDO (Quality Owner). Commit: 10168051 on `squad/piece-30-ado-cross-repo-templates`._
