# Session Log — Dogfood and ADO Playbooks

**Date:** 2026-06-02T23:19:38-07:00  
**Agents:** booster-2 (Booster), handbook (Handbook)  
**Duration:** Session window (background execution)  
**Status:** ✅ Complete | ⚠️ **CRITICAL FINDINGS**

---

## Executive Summary

Two background agents completed their assigned work:
- **Booster:** ADO setup playbook (567 lines, 13 gotchas) ✓ production-ready
- **Handbook:** Local dogfood runbook (806 lines, 4 scenarios) ✓ complete

During runbook authorship, Handbook performed static code analysis of the CLI implementation (bind.ts, sync.ts, cli-entry.ts) and discovered **5 real shipping defects** that invalidate pieces 26–28's CLI integration despite unit tests passing.

**The most critical finding:** Piece 28's `publishTeamRootToInbox` function exists, is exported, is tested at the unit level, and has zero bugs. However, it is never called from the CLI dispatch layer. The workflow `squad sync --push` routes to `syncPush` (which pushes squad-state branches), not to the inbox-publish flow. **Result: Cross-repo inbox publishing is dead code.**

---

## Five Shipping Defects (Priority Order)

### 🔴 S0 (CRITICAL) — publishTeamRootToInbox unreachable from CLI

**Files:** packages/squad-cli/src/cli/commands/sync.ts (lines 425–497, 812–926)  
**Status:** Piece 28 function exists and is tested; pieces 27 + 30 assume it works.

- `runSync` dispatches `--push` and `--both` to `syncPush` (fast-forward squad-state branches).
- `publishTeamRootToInbox` (piece 28's core inbox flow) exists but has zero entry points from CLI dispatch.
- ADO pipeline `publish-inbox.yml` executes `squad sync --push`, which will never create `squad/inbox/*` refs.
- Tests pass because piece 28 tests `publishTeamRootToInbox` directly; CLI wiring test sees it as "exported but never called."

**Reproduction:**
```bash
squad sync --push --developer dev1
# Expected: squad/inbox/dev1/* ref created on STATE_REMOTE
# Actual: nothing; only squad-state branches pushed (if any)
```

**Impact:** Phase C dogfood will fail to create inbox branch artifacts. Coordinator cannot hand off work. Full replay cycle cannot execute.

**Fix scope:** piece 27/28 revision required. `runSync` must call `publishTeamRootToInbox` when direction is `'push'` or `'publish-only'`.

---

### 🟠 S1a (HIGH) — stateBackend not written by runBind

**Files:** bind.ts (config write), sync.ts:170–177 (detectBackend check)  
**Status:** Piece 26 config builder omits the field; piece 27 sync bails on null.

- `runBind` builds a `SquadDirConfig` without `stateBackend` field.
- `detectBackend()` returns `null` when `config.stateBackend` is absent.
- `runSync` bails early with "no remote sync needed" and never attempts git operations.

**Reproduction:**
```bash
squad bind <docs-repo-url> --state-remote squad-docs
squad sync --pull
# Observe: "backend is 'local' — no remote sync needed"
# No hydration occurs
```

**Impact:** Cross-repo sync is inert even after successful bind. Second-session user sees no effect from piece 26 binding.

**Fix scope:** piece 26 revision. Write `stateBackend: 'orphan'` to config.json when `teamRepoUrl` is provided.

---

### 🟠 S1b (HIGH) — hydrateTeamRootFromStateRef never called

**Files:** sync.ts (lines 477–490 pull path, 708–748 hydration func)  
**Status:** Piece 27/28 function exists; never invoked from dispatch.

- `syncPull` fast-forwards squad-state branches in WORK_ROOT.
- `hydrateTeamRootFromStateRef` (piece 28's projection seeder) exists but has zero entry points.
- After `squad sync --pull`, the sidecar directory remains empty.

**Impact:** TEAM_ROOT/WORK_ROOT split is broken at runtime. Sidecar reads always miss. Projection strategy fails.

**Fix scope:** piece 27 revision. Add call to `hydrateTeamRootFromStateRef` in `runSync` pull path.

---

### 🟠 S1c (HIGH) — SQUAD_DEVELOPER_ALIAS env var ignored

**Files:** sync.ts:453–466, publish-inbox.yml:58  
**Status:** Pipeline sets env var; sync ignores it.

- ADO pipeline (`publish-inbox.yml`) exports `env: SQUAD_DEVELOPER_ALIAS=$(developerAlias)`.
- `runSync` resolution chain: CLI `--developer` → config.json `developerAlias` → (missing: env var) → error.
- Pipeline runs without explicit `--developer` flag will fail with "developer alias required" even though `SQUAD_DEVELOPER_ALIAS` is set.

**Impact:** Piece 30 pipeline automation cannot pass developer identity to piece 28's publish flow. Manual override required or pipeline fails.

**Fix scope:** piece 27 revision. Add env var as third fallback in alias resolution.

---

### 🟡 S2 (MEDIUM) — developerAlias not validated at bind time

**Files:** bind.ts (config write), sync.ts:504 (validation regex)  
**Status:** Piece 26 accepts any string; piece 28 rejects invalid ones.

- `runBind` accepts any string for `--developer-alias` without validation.
- Alias like `DEV_1` or `MyAlias` persists to config.json.
- Validation error only surfaces later when `publishTeamRootToInbox` is called (which it never is — see S0).
- No indication that the alias came from config.json or bind.

**Impact:** Invalid aliases silently saved. First-order defect hidden by second-order defect (S0). Once S0 fixed, S2 becomes a user-facing failure during publish attempt.

**Fix scope:** piece 26 revision. Validate alias against `DEVELOPER_ALIAS_RE` before config write.

---

## Root Cause Analysis

All five defects stem from incomplete CLI dispatch wiring between pieces 26–28. The individual components (bind config builder, sync hydration, inbox publish) are correctly implemented and test-pass at the unit level. The integration— routing from CLI dispatch to the cross-repo orchestration — was never implemented.

This is a **test-vs-runtime integration gap**, not a specification misread or implementation bug in any single function. Unit tests for each piece pass because they exercise the functions directly, not through the CLI dispatch layer that would have caught these gaps.

---

## Handbook's Static Analysis Methodology

Handbook identified all 5 defects by:
1. Reading the spec for pieces 26–28 to understand intended workflows
2. Tracing code paths from CLI dispatch (`squad sync --push`) through to expected side effects (inbox ref creation, sidecar hydration, developer identity threading)
3. Identifying gaps where expected functions were never called
4. Validating each gap against both the code and the test structure

No dynamic execution, no test runs. Static analysis alone surfaced production-critical issues before any ops team attempts to use the features.

---

## Decision Required

**Brady:** These defects must be fixed before pieces 26–28 are merged upstream. The questions:
1. Should fixes be folded into the existing revision flow for pieces 26–28, or land as new revision pieces?
2. Should piece 30 (ADO templates) proceed as-is (waiting for pieces 26–28 fixes) or be split?

Booster's playbook is unaffected and ready for Phase C ops team immediately upon resolution of these wiring gaps.

---

## Next Steps

1. ✅ Handbook findings recorded in `/inbox/handbook-dogfood-findings.md` (merged to decisions.md)
2. ✅ Booster playbook ready (session-state files dir)
3. ⏳ Await Brady decision on revision sequencing
4. ⏳ Pieces 26–28 revisions (F/E to be assigned)
5. ⏳ Piece 30 ADO templates proceed once 26–28 CLI wiring is solid

---

## Files Attached

- **Handbook dogfood findings:** `.squad/decisions.md` (merged from inbox, dated 2026-06-02)
- **Booster ADO playbook:** session-state files dir (567 lines, ready for copy-paste to ops wiki)
- **Handbook dogfood runbook:** session-state files dir (806 lines, 4 scenarios + 32+ probes)
