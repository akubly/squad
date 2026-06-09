# Session Log: Piece 30 Follow-On Revision

**Date:** 2026-06-03  
**Session type:** Follow-on revision (commit 3c6c9edf atop bc6d0146)  
**Branch:** `squad/piece-30-ado-cross-repo-templates`  
**Implementer:** EECOM (Core Dev) — single-agent integrator after Flight + Booster locked out  
**Outcome:** SUCCESS

## Mandatory Findings Addressed

Two mandatory findings resolved from the 3-reviewer follow-on adversarial panel (CAPCOM REJECT + RETRO APPROVE-WITH-NITS + FIDO APPROVE):

### CAPCOM M_NEW_1: fold timestamp bug → ref-name membership check

**File:** `.squad-templates/ado/fold-squad-state.yml` + 3 mirrors  
**Change:** Replaced `LAST_PUBLISHED_AT` scalar timestamp comparison with `FOLDED_REFS` set-membership check against `.[].inboxRef` in `publish-history.json`.

Key properties:
- Naturally idempotent: re-running against any already-folded ref is a no-op.
- Immune to clock skew and same-second ties.
- Malformed JSON guard: aborts with `exit 1` if `publish-history.json` is not valid JSON.
- Missing metadata: skip-with-warning (one bad ref doesn't block others).
- Sort key updated to `publishedAt\tdeveloperAlias\tref` (spec §3 tie-breaker).

### RETRO M_NEW_1 (Medium): git clone stderr PAT leak

**File:** `.squad-templates/ado/bootstrap-cross-repo.ps1` + 3 mirrors  
**Change:** Wrapped `git clone` and `git remote add` with `2>&1` stderr capture, `$LASTEXITCODE` check, dual redaction (`://[^@/\s]+@` regex + `[regex]::Escape($DocsRepoUrl)` literal), and `Write-Error` with sanitized output on failure.

Redaction verified to handle:
- `https://user:PAT@host.com/repo.git` ✓
- `https://PAT@host.com/repo.git` ✓
- `https://user%40org:PAT@host.com/repo.git` ✓

## Test Results

**New assertions:** 4 regression guards added to `test/cli/ado-templates.test.ts` (assertions 15–18):
- 15: `fold-squad-state.yml` does NOT contain `LAST_PUBLISHED_AT`
- 16: `fold-squad-state.yml` contains `.[].inboxRef`
- 17: `bootstrap-cross-repo.ps1` has `git clone ... 2>&1`
- 18: `bootstrap-cross-repo.ps1` has `$cloneOutput` and `$redactedOutput`

**Test count delta:** 196 → 200 (net +4)  
**Grand total passing:** 212 (net +4)

## Scrub Gate

- Gate 1: 32 strip-listed paths (unchanged from baseline; Squad's `/casting/`, `/identity/`, `/orchestration-log` match Wi-Fi Aware pattern incidentally)
- Gate 8: bash `$()` subexpressions in YAML script blocks — pre-existing pattern; revision adds 2 new same-type entries (net baseline +2)
- Gates 2, 5–9: PASS
- Gates 3–4: WARN (akubly refs and internal mentions in `.squad/` state files, expected)
- Gate 6: PASS (11 files changed, under 30-file limit)

## Mirror Propagation

`node scripts/sync-templates.mjs --sync` propagated both changed files to 3 mirrors each.  
Byte-identity verified: 1 unique SHA-256 hash across all 4 locations for both files. ✓

## Lockout Enforcement

- Flight (original commit 10168051): **locked out** — remained excluded
- Booster (revision a9da5453): **locked out** — remained excluded
- EECOM: **owned this revision** under cross-trained scope grant (YAML pipeline + PowerShell hardening per task prompt expanded scope)

## Files Changed

- `.squad-templates/ado/fold-squad-state.yml` (canonical + 3 mirrors)
- `.squad-templates/ado/bootstrap-cross-repo.ps1` (canonical + 3 mirrors)
- `test/cli/ado-templates.test.ts` (test regressions: +4 assertions)

Total: 9 files changed

---

**Commit:** `3c6c9edf`  
**Push status:** Pushed to `origin/squad/piece-30-ado-cross-repo-templates`
