# Decision: Piece 07 Revision — Register Merges Clones/Origins

**Author:** CONTROL  
**Date:** 2026-05-15  
**Context:** Post-rejection revision of piece 07 after all three reviewers (Flight, FIDO, CONTROL) issued REJECT verdicts on EECOM's commit `a1e82411`.

---

## Decisions Made

### 1. "Already registered" wording kept

FIDO's B3 fix required updating the test assertion from `/already active/i` to `/already registered/i`. This confirmed the current error wording (`already registered`) is the canonical form. Decision: do NOT revert to "already active". "Already registered" is more precise — the concept is registry membership, not activation state.

### 2. Both dead values removed from `RunRegisterOutcome`

After B2 guard was added (different callsign + same path → throws), the `'reactivated'` branch became unreachable. `'already-active'` was already unreachable before piece 07. Both were removed. `RunRegisterOutcome` is now `'registered' | 'merged'` — two values, strict exhaustiveness.

### 3. Spread-copy chosen over in-place mutation for `--origin`/`--clone` append modes

EECOM's implementation mutated the `entry` object in-place (`entry.origins.push(...)`). Both approaches are technically correct since `entry` is a reference into `existing[]`. CONTROL chose spread-copy (`{ ...entry, origins: [...] }` with `filter + spread` replacement) to match the `mergeGitContext` pattern already established in the codebase.

### 4. Gate 1 pre-existing failure acknowledged, not fixed

Scrub gate Gate 1 (casting, identity, orchestration-log template files from pieces 01–06) was failing before piece 07 began and is not caused by piece 07 changes. Documented in commit message. No action taken — this is a pre-existing condition outside piece 07 scope.

### 5. B1 rebuild technique: reset + selective checkout + cherry-pick

Used `git hard-reset` to piece 06 base, then `git checkout <sha> -- <files>` to restore exactly the 7 product files without `.squad/` paths, then cherry-picked Scribe commits on top. Did not use interactive rebase. This technique is simpler when the goal is stripping a single file from a commit.

---

## All Blockers Resolved

| Blocker | Raised by | Status |
|---------|-----------|--------|
| B1: `.squad/` in product commit | Flight | ✅ Resolved — product commit `9c3f0885` has zero `.squad/` paths |
| B2: No path-uniqueness guard | Flight | ✅ Resolved — guard added, test added, confirmed RED→GREEN |
| B3: 3 failing dispatch-help tests | FIDO | ✅ Resolved — 28/28 tests GREEN |
| B4: `--help` text incorrect | CONTROL | ✅ Resolved — usage line optional, `--origin`/`--clone` documented |
| B5: Nits | CONTROL | ✅ Resolved — all nits applied |

---

## Handoff State

Branch: `akubly/upstream-07-register-merge-clones-origins`  
Force-pushed after revision — Brady to review before Phase C.  
No PR opened (Phase B rules).
