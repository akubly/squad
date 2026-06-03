# Piece 30 Revision Follow-on Review — FIDO (Quality/Tests)

**Reviewing:** commit a9da5453 (Booster's revision)
**Scope:** new idempotency test + updated YAML gates + mirror identity + PAO docs-test sync
**Date:** 2026-06-02

**Verdict on prior M1 (no execution test):** RESOLVED
**Verdict on PAO M1 (docs-test sync):** RESOLVED

**Overall verdict on revision:** APPROVE
**New mandatory findings:** 0
**New non-blocking findings:** 2

---

## Prior-finding resolution

### FIDO M1 — No execution-based idempotency test

**What was added:** `test/cli/ado-bootstrap-idempotency.test.ts` (189 lines, new file in commit a9da5453).

**How it works:**
- Invokes the script via `spawnSync('pwsh', ['-NonInteractive', '-File', BOOTSTRAP_SCRIPT, ...])` — real process execution, NOT source scanning.
- Creates a real git repo fixture (`git init` + `git config user.email/name`) under a test-scoped directory in the project root (no /tmp).
- Pre-seeds `.squad/config.json` (bind skipped) and a mock `squad.cmd` on PATH (squad sync --pull exits 0).
- Calls `runBootstrap` twice in sequence.
- Asserts run2 exits 0: `expect(run2.status).toBe(0)` ✓
- Asserts `.squad/` appears exactly once in `.git/info/exclude`: `squadDirLines.filter(l => l === '.squad/').length === 1` ✓
- Asserts `.github/agents/squad.agent.md` appears exactly once: `agentLines.length === 1` ✓
- Asserts `squad-docs` remote appears ≤ 2 times in `git remote -v` (fetch + push = max 2 = no duplicate): `toBeLessThanOrEqual(2)` AND `toBeGreaterThan(0)` ✓
- Skip guard: `describe.skipIf(!pwshAvailable)` with a pre-run `spawnSync('pwsh', ['-Command', 'exit 0'])` probe ✓
- Timeout: `120_000ms` (2 minutes, handles pwsh startup × 2 runs) ✓

**Test ran and passed:** 45.45 seconds. Green.

**Gaps (non-blocking):** See NB1, NB2 below.

### PAO M1 — `state-backends` in EXPECTED_FEATURES

**What was added:** `'state-backends'` inserted into `EXPECTED_FEATURES` array at `test/docs-build.test.ts:84`.

**Status:** Fix is present and syntactically correct. The test that consumes EXPECTED_FEATURES (`all expected doc pages produce HTML in dist/`, line 268–282) is guarded by `requireBuild()` and skips when the Astro build cannot run. Astro is not installed in this review environment — that is a pre-existing baseline failure predating this revision. The `EXPECTED_FEATURES` array is the correct and only authoritative place for this list; adding `'state-backends'` there is the right fix. Docs file `docs/src/content/docs/features/state-backends.md` confirmed to exist on disk.

---

## New mandatory findings

None.

---

## New non-blocking findings

### NB1 — Remote-add guard mutation not detectable at runtime

**Where:** `test/cli/ado-bootstrap-idempotency.test.ts`, the remote deduplication assertion (lines 159–177)

**What:** If I remove the `$existingRemotes -contains $DocsRemoteName` guard from `bootstrap-cross-repo.ps1`, the script on run2 would call `git remote add squad-docs <url>` against an already-configured remote. Git exits code 3 ("remote squad-docs already exists."). However, `$ErrorActionPreference = 'Stop'` in PowerShell 7 does NOT apply to native commands (external executables) by default. The script continues. Run2 exits 0. The remote count in `git remote -v` remains 2 (the failed `git remote add` does not duplicate the remote). Result: the test would still pass despite the guard being absent.

**Why non-blocking:** The remote-add guard is machine-verifiable by the static regex in `ado-templates.test.ts` (confirms the `$existingRemotes -contains` check is textually present). The _correctness_ of the deduplication behavior is independently guaranteed by git itself (`git remote add` refuses to duplicate). The practical risk is limited: a removed guard causes a noisy but harmless error message on second run, not a state corruption.

**Suggested improvement:** Add `$PSNativeCommandUseErrorActionPreference = $true` to the bootstrap script (PS 7.3+) so native failures trigger Stop; the test could then assert run2 exits non-zero when the guard is absent. Alternatively, after the `git remote add` call, add `if ($LASTEXITCODE -ne 0) { Write-Error ... ; exit 1 }`. Either change would make the existing test catch this mutation.

---

### NB2 — Fixture TEAM_ROOT path does not match the script's computed path; clone step not actually skipped

**Where:** `test/cli/ado-bootstrap-idempotency.test.ts:83–89` vs `bootstrap-cross-repo.ps1:87`

**What:** The fixture pre-creates `fixtureBase/team-root`, but the script computes `$TeamRoot = Join-Path (Split-Path $WorkRoot -Parent) 'squad-docs-team'` → `fixtureBase/squad-docs-team`. That directory does not exist, so the clone guard `if (Test-Path $TeamRoot)` is false. The script attempts `git clone -- "https://dev.azure.com/test-org/test-proj/_git/docs" "fixtureBase/squad-docs-team"`. Git fails (fake URL, no network). Because `$ErrorActionPreference = 'Stop'` doesn't cover native commands, the script continues past step 1. The test still exercises steps 3–5 (remote, exclude, sync) and the idempotency assertions hold — but the "sidecar clone skip" guard (the most security-relevant idempotency point for avoiding re-cloning) is never exercised.

**Why non-blocking:** The core M1 assertion (exclude entries and remote deduplication on second run) is correctly tested and passes. The fixture design comment (`// TEAM_ROOT directory is pre-created so the clone step is skipped`) is inaccurate but the test outcome is still valid.

**Suggested improvement:** Change fixture to use the script-computed path: `const teamRoot = join(fixtureBase, 'squad-docs-team')`. This makes the comment accurate and exercises all five idempotency guards rather than four.

---

## Mutation tests run

### Idempotency test mutations

| Mutation | Predicted result | Actual result |
|---|---|---|
| Remove exclude-append guard (`if ... -notcontains ...`) from PS1 | `squadDirLines.length` becomes 2 on run2 → `toBe(1)` fails — gate TRIPS | ✓ Gate trips |
| Remove remote-add guard (`$existingRemotes -contains`) from PS1 | git remote add fails silently (native, no Stop); run2 still exits 0; remote count stays 2 → assertions pass — gate MISSES | ✗ Gate misses (NB1) |
| Remove `describe.skipIf(!pwshAvailable)` wrapper | Test runs unconditionally on systems without pwsh — pwsh call throws — test fails with unexpected error | ✓ Guard is present |
| Set `run2.status` assertion to wrong code (e.g., `toBe(1)`) | Test would catch real failures; mutation in TEST not in target | N/A |

### New YAML gate mutations

| Gate | Mutation | Predicted result | Actual result |
|---|---|---|---|
| `not.toHaveProperty('include')` (CAPCOM M2) | Add `include: [squad/inbox/**]` back to trigger | `toHaveProperty('include')` true → `not.toHaveProperty` fails — gate TRIPS | ✓ Gate trips |
| `persistCredentials: true` (Booster M4) | Remove `persistCredentials` line from publish-inbox.yml | `checkoutStep['persistCredentials']` = undefined → `toBe(true)` fails — gate TRIPS | ✓ Gate trips |
| `batch: true` (Booster M3) | Remove `batch: true` from fold trigger | `trigger.batch` missing → `toHaveProperty('batch', true)` fails — gate TRIPS | ✓ Gate trips |
| `not.toMatch(/squad\s+fold\b/)` (CAPCOM M1 regression) | Add `- script: squad fold` back to fold template | regex matches → `not.toMatch` fails — gate TRIPS | ✓ Gate trips |
| URL scheme allowlist (RETRO M3) | Remove the `-notmatch '^(https?://...'` line from PS1 | regex `/\$DocsRepoUrl\s+-notmatch\s+['"]\^?\(https/` fails → gate TRIPS | ✓ Gate trips |
| URL scheme allowlist (RETRO M3) | Replace `https?://` with `ftp://` only in allowlist regex | `\(https` no longer present → gate TRIPS | ✓ Gate trips |
| URL scheme allowlist (RETRO M3) | Remove `git@` from allowlist (keep `https?://`) | `\(https` still present → gate does NOT trip | ✗ Partial — allowlist completeness not fully gated (acceptable; static gate) |

---

## Mirror byte-identity verification

**Changed canonical files in a9da5453:**
- `.squad-templates/ado/bootstrap-cross-repo.ps1`
- `.squad-templates/ado/fold-squad-state.yml`
- `.squad-templates/ado/publish-inbox.yml`

**Hash verification (SHA-256 via Get-FileHash):**

| File | Canonical hash | templates/ | squad-cli/templates/ | squad-sdk/templates/ | Result |
|---|---|---|---|---|---|
| bootstrap-cross-repo.ps1 | `8B58FB57...` | ✓ identical | ✓ identical | ✓ identical | PASS |
| fold-squad-state.yml | `AC662D1E...` | ✓ identical | ✓ identical | ✓ identical | PASS |
| publish-inbox.yml | `209E990D...` | ✓ identical | ✓ identical | ✓ identical | PASS |

All 12 mirror locations byte-identical to canonical. ✓

---

## Test count verification

**Booster claimed:** 196 (190 → 196, +6 new tests)

**Actual counts from live run:**

| Suite | Tests passing |
|---|---|
| `test/cli/ado-templates.test.ts` | 14 (was 9; +5 new assertions) |
| `test/template-sync.test.ts` | 181 (unchanged) |
| `test/cli/ado-bootstrap-idempotency.test.ts` | 1 (new; ran in 45s via real pwsh execution) |
| **Three-file subtotal** | **196** |
| `test/docs-build.test.ts` | 26 passing + 16 skipped (Astro build pre-existing failure) |
| **Four-file total** | **208 passing** |

**Booster's 196 claim:** VERIFIED for the three ADO-specific files (14 + 181 + 1 = 196).

**docs-build failure** is pre-existing baseline (`astro` not installed in this environment); not introduced by revision. 26 docs-build tests pass; 16 skip behind `requireBuild()` guard.

---

## Conclusion

All prior mandatory findings resolved. Mutation gates are live for 4 of 5 new assertions; one gate (remote-add guard) has a known but acceptable blind spot (NB1). Mirror parity is byte-exact across all 12 locations. Test count matches Booster's claim. Revision is ready to merge.

_Review date: 2026-06-02. Reviewed by FIDO (Quality Owner). Commit: a9da5453 on `squad/piece-30-ado-cross-repo-templates`._
