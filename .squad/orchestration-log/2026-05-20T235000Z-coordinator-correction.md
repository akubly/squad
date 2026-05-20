# Coordinator Correction: Piece 21 Code Commit Cleanup

**Date:** 2026-05-20T23:50:00Z  
**Performed by:** Aaron Kubly (Coordinator)  
**Original commit:** initial EECOM submission  
**Final commit:** ed9f81fb  
**Correction method:** Selective staging + force-push  

## Out-of-Scope Files Removed

### 1. `.github/agents/squad.agent.md` (version stamp)

**What was reverted:** Line ~37 — version string updated from X to Y in the original EECOM commit.  
**Why:** `.github/agents/squad.agent.md` is not part of piece 21 scope. The file governs squad agent discovery and is maintained separately. Version stamps are applied by the release pipeline, not feature branches.  
**Impact:** None — piece 21 does not modify governance files per spec.

### 2. `package.json` (version regression)

**What was reverted:** Lines showing version downgrade from pre-phase-b state.  
**Why:** `package.json` is build-artifact re-stamped by `npm run build`. Including it in a feature commit creates merge conflicts and version confusion. Feature commits must not touch package versions.  
**Impact:** None — version management is centralized.

### 3. `packages/squad-cli/package.json` (version regression)

**What was reverted:** Package version downgrade.  
**Why:** Same root cause as above. Build re-stamps package versions; commits must exclude these.  
**Impact:** None — version management is centralized.

### 4. `test-fixtures/init-test/.gitignore` (unintended deletion)

**What was reverted:** File deletion included in the original commit.  
**Why:** `.gitignore` in test fixtures is pre-existing infrastructure, not part of piece 21 changes. The file should not be deleted; its removal was accidental.  
**Impact:** Test fixtures remain usable.

## Protocol Violation Removed

### 5. `.squad/agents/eecom/history.md` (state in code commit)

**What was reverted:** EECOM's session history entry merged into the code commit.  
**Why:** REPLAY-PROTOCOL §State Location mandates layer separation:
- **Code commit:** Only product source, tests, changesets, and governance edits.
- **State commit:** Only `.squad/` infrastructure (logs, histories, decisions, orchestration records).

EECOM's history entry belongs in a **separate state commit**, not mixed into the code commit. Phase C will cherry-pick only the code commit to the upstream PR.

**Impact:** Piece 21 code commit remains clean (5 files); state commit will be created by Scribe in this session.

## Correction Procedure

1. Reset to the original EECOM commit.
2. Selectively stage only the 5 in-scope code files.
3. Create a new commit with the clean code surface.
4. Force-push to `akubly/upstream-21-post-stack-review` to replace the original.

**Verification:** `git diff <original> <final> -- .github/ package.json packages/squad-cli/package.json test-fixtures/init-test/.gitignore .squad/agents/eecom/history.md` returns empty (no changes to these files in the final commit).

## State Commit (Scribe)

Scribe creates a separate commit containing:
- `.squad/agents/eecom/history.md` (EECOM's session entry)
- `.squad/orchestration-log/2026-05-20T235000Z-eecom.md` (this correction record)
- `.squad/orchestration-log/2026-05-20T235000Z-coordinator-correction.md` (this log)
- `.squad/log/2026-05-20T235000Z-piece-21-replay.md` (session summary)
- Merged decisions (if any inbox files exist)

The state commit is pushed to the same branch, following the code commit as a direct parent. Phase C will extract only the code commit for the upstream PR.

## Result

**Piece 21 ready for Phase C.** Code surface is clean; state is managed separately.
