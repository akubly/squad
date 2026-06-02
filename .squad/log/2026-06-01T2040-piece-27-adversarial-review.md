# Session: Piece 27 Adversarial Review (3 Independent Reviewers)

**Session ID:** 2026-06-01T2040-piece-27-adversarial-review  
**Date:** 2026-06-01  
**Time:** ~20:40 UTC  
**Mode:** Background (3 independent reviewers in parallel)  
**Requested By:** akubly

## Piece Summary

- **Branch:** squad/piece-27-explicit-sync-command
- **Commit:** 31177e72
- **Scope:** Explicit sync command implementation (ensureStateRemote, runSync, hook installation)
- **Test Coverage:** 18 sync tests + 15 install-hooks tests all GREEN

## Reviewer Verdicts (All APPROVE-WITH-NITS)

### FIDO (Quality Owner)

**Verdict:** ⚠️ APPROVE-WITH-NITS

**Key Findings:**
- All 18 sync tests + 15 install-hooks tests pass GREEN
- Recursion guard (SQUAD_SYNC_ACTIVE) present in all 4 hook templates and `runSync()` — PASS
- Spec functionality sound and tested
- Two functional defects found via adversarial probing

**Mandatory Nits:**
1. **N1: Whitespace-only alias bypasses empty-alias guard** (critical defect)
   - `if (!alias)` falsy check misses spaces, tabs, newlines
   - Fix: `if (!alias || !alias.trim())`
   
2. **N2: `installHook()` force-reinstall duplicates squad section**
   - `cleaned` variable computed but never used; falls through to append
   - Each `--force` invocation doubles hook content
   - Fix: use `content` directly when force=true, remove old section first

**Non-Blocking Nits:** N3 (no flag precedence tests), N4 (empty `--remote` ignored), N5 (no test for absent stateRemote + --both)

**Baseline Validation:** PASS (43 pre-existing errors, zero new)

**Spec Conformance:** 17/19 criteria pass (empty-alias guard partial, force-reinstall partial)

**Recommendation:** If N1/N2 block: assign to EECOM (implementer). Flight locked out.

### CONTROL (TypeScript Engineer)

**Verdict:** ⚠️ APPROVE-WITH-NITS

**Key Findings:**
- Type design sound; `SyncOptions.direction` correctly typed as literal union
- `SyncGitOps` injection interface clean; remote resolution precedence correct
- ESM correctness validated (all imports use `.js` extensions)
- Zero new tsc errors vs. parent (43 pre-existing on both)
- Zero new suppressions

**Mandatory Nits:**
1. **N1: Untyped config reads bypass SDK interface** (critical design issue)
   - `readStateRemoteFromConfig` and `readDeveloperAliasFromConfig` hand-roll `JSON.parse` → `any`
   - Should use SDK's typed `loadDirConfig(): SquadDirConfig | null`
   - Currently: field-name renames fail at runtime only
   - Fix: Replace with single `loadDirConfig()` call, read typed `config?.stateRemote` and `config?.developerAlias`

**Non-Blocking Nits:** N2 (empty alias type contract), N3 (SCREAMING_SNAKE_CASE function), N4 (falsy vs nullish OR), N5 (flag precedence undocumented)

**Build/tsc Status:** 43 errors (pre-existing, stale SDK in node_modules)

**Public API Surface:** All additive, no removals. `SyncOptions.direction` expanded (no breakage).

**Recommendation:** If N1 blocks: assign to EECOM. Flight locked out.

### RETRO (Security)

**Verdict:** ⚠️ APPROVE-WITH-NITS

**Key Findings:**
- All git subprocess calls use `execFileSync` with array args — shell injection defense holds
- Remote injection surface closed: `remotes.includes()` validates before any git invocation
- Hook templates quote variables correctly (`"$REMOTE"`); no command substitution re-evaluation
- Recursion guard present and scoped correctly

**Critical Findings:** None

**High Findings:**
1. **H1: Whitespace-only alias bypasses spec contract** (mandatory fix)
   - `if (!alias)` misses whitespace; `developer: ' '` passes through
   - Spec: "If developer value is empty, exit 1"
   - Fix: `if (!alias || !alias.trim())`
   - Probe: `--developer ""` exits correctly; `--developer " "` incorrectly proceeds

**Medium/Low Findings:**
- M1: Push errors may expose git URLs with embedded tokens (requires already-misconfigured creds)
- M2: Force-reinstall duplicates hook (correctness, not security)
- M3: No charset allowlist on `--remote` or `stateRemote` (defence-in-depth hardening)
- M4: Alias lacks charset validation (future injection surface — apply piece 30.5's `[a-z][a-z0-9-]{0,38}` allowlist now)
- L1: Hook templates lack `set -eu` strict mode (low risk, visibility improvement)
- L2: Missing `--push` and `--both` handlers in dispatch (correctness gap)

**Attack Surface Status:**
- `--developer`: partial (empty exits; whitespace passes; no charset)
- `--remote`: pass (precheck + array args)
- Config-driven attacks: pass (quoted variables, no re-evaluation)
- Refspecs: pass (force-prefix scoped, local-branch gate)
- Hook safety: partial (guard correct, `set -eu` absent, force-reinstall incomplete)
- Secret/PII: partial (no env reads/creds to commits; URLs with tokens may surface in errors)

**Recommendation:** If H1 contested: assign to EECOM or CONTROL. Flight locked out.

## Cross-Reviewer Convergence

**Critical Alignment:** All three reviewers independently identified the whitespace-alias bypass as a defect:
- **FIDO N1:** "Whitespace-only alias bypasses the empty-alias guard"
- **CONTROL:** N2 non-blocking ("type system does not enforce non-empty"), but N1 covers config reads
- **RETRO H1:** "Whitespace-only alias bypasses spec contract" (H1 severity — mandatory before PR)

This convergence validates the finding as a material defect with real user impact.

**Secondary Alignment:** Force-reinstall duplication
- **FIDO N2:** "installHook() with force: true duplicates the squad section"
- **RETRO M2:** "force-reinstall logic incomplete — double-appends"

Both independent observations of same bug.

## Lockout State

**EECOM (Implementer):** Locked out from revising piece 27 per strict protocol (original implementer may not revise).

**Reviewer Rejection Lockout:** None. All three reviewers are APPROVE-WITH-NITS (not REJECT).

**Recommended Revision Author:** EECOM (if nits become blocking during revision decision). If EECOM unavailable, fallback to CONTROL (TypeScript expertise for N1) or Sims (per piece-10 precedent).

## Pending Mandatory Nits

**Total Count:** 3

1. **Whitespace-alias bypass** (FIDO N1, RETRO H1, CONTROL partial)
   - Identical fix: `if (!alias || !alias.trim())`
   - Add tests: `developer: ' '`, `developer: '\t'`

2. **Force-reinstall duplication** (FIDO N2, RETRO M2)
   - Use `content` directly when force=true and marker found
   - Add test: run `installHooks` twice with force: true; assert marker appears once

3. **Untyped config reads** (CONTROL N1, implied by RETRO M4 charset validation gap)
   - Replace `readStateRemoteFromConfig` and `readDeveloperAliasFromConfig` with typed `loadDirConfig()` call
   - Enables future charset validation without runtime surprises

## Acceptance Criteria Status

**Piece 27 Spec Conformance:** 17/19 pass (2 partial)

- ✅ explicit CLI command (squad sync)
- ✅ direction enum (pull, push, both, hydrate-only, publish-only)
- ✅ remote resolution precedence
- ✅ ensureStateRemote validation
- ✅ CLI dispatch wiring in cli-entry.ts
- ✅ All 4 hook templates exist and have recursion guard
- ✅ install-hooks implementation and tests
- ✅ ESM imports with .js extensions
- ✅ Git subprocess uses execFileSync with array args
- ✅ Hook idempotency on repeated install (except force=true duplication)
- ✅ Hook installation on TEAM_ROOT/.git/hooks/
- ✅ Refspec scoping to remote-tracking refs
- ✅ Null-check on config reads
- ⚠️ **Empty-alias guard:** falsy-check misses whitespace (CRITICAL N1)
- ⚠️ **Force-reinstall logic:** dead code, duplicates instead of replaces (CRITICAL N2)
- ✅ Remote validation precheck (remotes.includes)
- ✅ Config read fallback chain
- ✅ test/sync.test.ts comprehensiveness
- ✅ Recursion environment variable scoping

## Notes

All three reviewers were spawned in parallel, executed independently, and produced findings converging on identical defects (whitespace bypass, force-reinstall duplication). This high-confidence alignment strengthens the credibility of the mandatory fixes.

No reviewer rejection lockout is imposed — all verdicts are APPROVE-WITH-NITS, indicating move forward to revision phase.

EECOM is locked out from performing the revision per strict squad protocol (implementer may not revise own work). Recommended alternate: CONTROL (TypeScript N1) or EECOM if override is negotiated.
