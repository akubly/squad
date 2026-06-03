# Piece 30 Revision-3 Follow-on Review — FIDO (Quality/Tests)

**Reviewing:** commit 3c6c9edf (EECOM's revision)
**Scope:** 4 new regression guards (mutation testing) + suite re-run + mirror byte-identity
**Date:** 2026-06-02

**Overall verdict on revision-3:** APPROVE
**New mandatory findings:** 0
**New non-blocking findings:** 3

---

## Summary

EECOM's 4 new regression guards (assertions 15–18) all run live and pass. The full suite returns
200 tests across the three ADO-specific files, matching the claimed count. Mirror byte-identity is
perfect across all 4 locations for both changed files. Three non-blocking weaknesses found in gate
design — none block merge.

---

## New mandatory findings

None.

---

## New non-blocking findings

### NB1 — Gate 15 false-positive risk: plain `not.toContain` tripped by comments

**Gate:** `fold-squad-state.yml does NOT contain LAST_PUBLISHED_AT`
**Where:** `test/cli/ado-templates.test.ts:155–162`

`expect(raw).not.toContain('LAST_PUBLISHED_AT')` is a raw string scan of the entire file, including
comment lines. A future developer adding a historical context comment such as:

```yaml
# Step 2: Replaced LAST_PUBLISHED_AT timestamp comparison with ref-name membership (CAPCOM M_NEW_1).
```

would cause the test to fail on a perfectly valid file. The guard cannot distinguish functional
occurrences from documentation.

**Suggested fix:** Narrow the scan to non-comment lines:
```typescript
const nonCommentLines = raw.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
expect(nonCommentLines).not.toContain('LAST_PUBLISHED_AT');
```

---

### NB2 — Gate 16 comment-bypass: positive `toContain` satisfied by commented-out code

**Gate:** `fold-squad-state.yml uses .[].inboxRef membership check`
**Where:** `test/cli/ado-templates.test.ts:164–170`

`expect(raw).toContain('.[].inboxRef')` passes if the string appears anywhere — including inside a
YAML `#` comment. A future revision that replaces the jq filter with a different idiom
(`.[] | .inboxRef`, `map(.inboxRef)[]`) while leaving a comment like
`# previously: .[].inboxRef` would continue to satisfy this guard even though the functional
code no longer uses the pattern. The guard also does not catch semantic-equivalent jq forms
(`.[] | .inboxRef` does not contain `.[].inboxRef` as a substring, so that mutation DOES trip
the guard — this is actually acceptable; see mutation table below).

**Suggested fix:** Same comment-filter approach as NB1, or assert with a more specific regex
that anchors the occurrence to a script line (not a comment):
```typescript
expect(raw).toMatch(/[^#\n]*\.\[\]\s*\.\s*inboxRef/);
```

---

### NB3 — Gate 18 correctness bypass: variable existence ≠ variable used in error path

**Gate:** `bootstrap-cross-repo.ps1 applies URL redaction to captured clone error output`
**Where:** `test/cli/ado-templates.test.ts:222–235`

The gate asserts two facts:
1. `/\$cloneOutput\s*=/` — `$cloneOutput` is assigned somewhere in the file.
2. `/\$redactedOutput/` — `$redactedOutput` appears somewhere in the file.

Neither assertion verifies that `$redactedOutput` is the variable actually emitted in the
`Write-Error` call. A future regression like:

```powershell
$cloneOutput = & git clone -- $DocsRepoUrl $TeamRoot 2>&1
$redactedOutput = ($cloneOutput | Out-String) -replace '://[^@/\s]+@', '://***@'
Write-Error "[1/5] git clone failed. Output: $cloneOutput"   # ← PAT still leaked!
```

would pass both assertions (both variables exist) but the PAT remains in the emitted error.

**Suggested fix:** Assert that the `Write-Error` line references `$redactedOutput` (not
`$cloneOutput`):
```typescript
expect(raw).toMatch(/Write-Error[^\n]*\$redactedOutput/);
```

---

## Mutation tests run

### Gate 15 — `fold-squad-state.yml` does NOT contain `LAST_PUBLISHED_AT`

**Assertion:** `expect(raw).not.toContain('LAST_PUBLISHED_AT')`

| Mutation | Guard prediction | Verdict |
|---|---|---|
| Revert fix: reintroduce `LAST_PUBLISHED_AT=…` variable | `not.toContain` fails → gate TRIPS | **Strong** |
| Alternative regression: rename to `LAST_TS` or `PREV_TIMESTAMP` | No occurrence of `LAST_PUBLISHED_AT` → gate PASSES (miss) | **Bypass** (variant name) |
| jq timestamp comparison: `select(.publishedAt > $cutoff)` without `LAST_PUBLISHED_AT` | Gate PASSES (miss) | **Bypass** (concept, different form) |
| Add comment: `# Replaced LAST_PUBLISHED_AT comparison` | `not.toContain` fails → gate TRIPS (false positive) | **False-positive risk** (see NB1) |

**Overall gate strength: Moderate.** Catches the exact named regression. Misses renamed or jq-based variants. False-positive risk from comments.

---

### Gate 16 — `fold-squad-state.yml` uses `.[].inboxRef` membership check

**Assertion:** `expect(raw).toContain('.[].inboxRef')`

| Mutation | Guard prediction | Verdict |
|---|---|---|
| Remove jq filter entirely (`FOLDED_REFS=""` always) | String absent → gate TRIPS | **Strong** |
| Replace with `.[] \| .inboxRef` (space-pipe form) | Does NOT contain `.[].inboxRef` substring → gate TRIPS | **Strong** (syntactic variants also caught) |
| Replace with `map(.inboxRef)[]` | String absent → gate TRIPS | **Strong** |
| Leave comment `# .[].inboxRef` but remove functional code | String present in comment → gate PASSES (miss) | **Comment-bypass** (see NB2) |

**Overall gate strength: Moderate-strong.** Catches removal and common jq rewrites; vulnerable to comment-only presence.

---

### Gate 17 — `bootstrap-cross-repo.ps1` git clone captures stderr with `2>&1`

**Assertion:** `expect(raw).toMatch(/git\s+clone\b[^\n]*2>&1/)`

| Mutation | Guard prediction | Verdict |
|---|---|---|
| Remove `2>&1` from the clone line | Regex fails → gate TRIPS | **Strong** |
| Move `2>&1` to a continuation line (wrap line break) | `[^\n]*` won't cross the newline → gate TRIPS | **Strong** |
| Replace with PowerShell `*>&1` stream merge | String `2>&1` absent → gate TRIPS | **Strong** (but could argue `*>&1` is valid PS7 alternative) |
| Add `git clone` in a comment with `2>&1` later | Comment on same line with `2>&1` → gate PASSES (comment bypass) | **Low-risk false positive** |

**Overall gate strength: Strong.** Regex is tight enough to catch nearly all real mutations.

---

### Gate 18 — `bootstrap-cross-repo.ps1` applies URL redaction to captured output

**Assertions:**
- `/\$cloneOutput\s*=/.test(raw)` → `$cloneOutput` assigned
- `/\$redactedOutput/.test(raw)` → `$redactedOutput` appears anywhere

| Mutation | Guard prediction | Verdict |
|---|---|---|
| Remove `$cloneOutput = & git clone ... 2>&1`; use bare `git clone` | First assertion fails → gate TRIPS | **Strong** |
| Remove all `$redactedOutput` references | Second assertion fails → gate TRIPS | **Strong** |
| Keep `$redactedOutput` assigned but emit `$cloneOutput` in Write-Error | Both variables present → gate PASSES (PAT still leaked) | **Correctness bypass** (see NB3) |
| Rename `$cloneOutput` to `$gitOut` (keep redaction logic) | First assertion fails → gate TRIPS | **Strong** |

**Overall gate strength: Weak on the correctness dimension.** Structural presence checks pass;
end-to-end correctness (redacted var actually emitted) is not verified by the gate.

---

## Bypass / false-positive probes

| Gate | Bypass scenario | Guard catches? | False-positive scenario | Guard trips? |
|---|---|---|---|---|
| 15 (no LAST_PUBLISHED_AT) | Rename variable to `PREV_TIMESTAMP`, same semantics | ❌ Miss | Comment: `# old: LAST_PUBLISHED_AT` | ✅ False trip (NB1) |
| 15 (no LAST_PUBLISHED_AT) | jq `select(.publishedAt > $cutoff)` without variable | ❌ Miss | — | — |
| 16 (.[].inboxRef present) | Remove functional code, keep in comment | ❌ Miss (comment satisfies guard) | — | N/A (positive assertion) |
| 17 (git clone 2>&1) | PowerShell `*>&1` instead of POSIX `2>&1` | ✅ Trips (misses semantically equiv form) | `git clone` comment line with `2>&1` | Low risk |
| 18 ($cloneOutput, $redactedOutput) | Assign `$redactedOutput` but emit `$cloneOutput` in Write-Error | ❌ Miss (PAT leaks silently) | — | N/A |

---

## Suite re-run

**Prior passing counts (context):**
- Booster's revision (a9da5453): 196 (14 ado-templates + 181 template-sync + 1 idempotency)
- EECOM's claimed delta: +4 (18 ado-templates) → 200 total for three ADO files; 212 grand total

**Actual run result (2026-06-02T22:41:05Z, vitest v3.2.4):**

| Suite | Tests passing | Notes |
|---|---|---|
| `test/cli/ado-templates.test.ts` | **18** | +4 vs prior 14; all 4 new gates live |
| `test/template-sync.test.ts` | **181** | Unchanged |
| `test/cli/ado-bootstrap-idempotency.test.ts` | **1** | Passed in 32.3 s via real pwsh execution |
| **ADO-suite subtotal** | **200** | Matches EECOM's claimed 200 ✓ |
| `test/docs-build.test.ts` | 12 pass + 16 skip | Astro pre-existing failure; unchanged |
| **Grand total passing** | **212** | Matches EECOM's claimed 212 ✓ |

**docs-build failure** is the pre-existing Astro-not-installed baseline. No new failures introduced.

---

## Mirror byte-identity

**SHA-256 hashes (Get-FileHash, 2026-06-02T22:41Z):**

| File | Canonical (`.squad-templates/ado/`) | `templates/ado/` | `packages/squad-cli/templates/ado/` | `packages/squad-sdk/templates/ado/` | Result |
|---|---|---|---|---|---|
| `fold-squad-state.yml` | `65223D35…FBFB5` | ✓ identical | ✓ identical | ✓ identical | **PASS** |
| `bootstrap-cross-repo.ps1` | `FD6B5FD7…CBEA` | ✓ identical | ✓ identical | ✓ identical | **PASS** |

All 8 mirror locations byte-identical to canonical. sync-templates.mjs working correctly. ✓

---

## Idempotency test status

**Passed.** `test/cli/ado-bootstrap-idempotency.test.ts` ran in 32.3 seconds via real `pwsh`
execution (spawnSync). All prior assertions intact (run2 exits 0, exclude entries deduplicated,
remote count ≤ 2). RETRO's stderr-capture additions in bootstrap-cross-repo.ps1 did not break
idempotency behavior. pwsh available in this environment so `describe.skipIf` did not suppress
the test.

---

_Review date: 2026-06-02. Reviewed by FIDO (Quality Owner). Commit: 3c6c9edf on `squad/piece-30-ado-cross-repo-templates`._
