# SURGEON — Archived Learnings

> Older entries archived 2026-06-08. Recent learnings kept in history.md.

---

## Release Governance Rules & v0.9.0 Retrospective (2026-03-23)

**Summary:** v0.9.0 published with critical defect—CLI package.json contained local monorepo reference instead of registry version, breaking global install. v0.9.1 hotfix prepared in minutes but infrastructure failures (GitHub cache race, npm 2FA hang) extended resolution to 8 hours.

**Governance rules established:**
1. Surgeon owns all publishing (not Coordinator).
2. Strict process adherence; written checklists mandatory.
3. Document to prevent recurrence.
4. CI/CD is top priority.
5. Pre-flight gates mandatory (validate dependencies, smoke tests, verify versions).
6. Escalation protocol: 2nd workflow failure → local publish fallback.

**Action items (A1–A6):** Dependency validation, workspace publish policy, GitHub cache mitigation, publish fallback protocol, release readiness checklist, post-publish smoke test.

**Release process skill created:** `.squad/skills/release-process/SKILL.md` documents all patterns and procedures.

**v0.9.0 CHANGELOG:** Organized MAJOR minor bump (0.8.25 → 0.9.0) across 12 feature sections + fixes (no "agency" terminology, matched existing style).

**Known incidents:** v0.8.22 (version mangled by npm), v0.8.23 (versions reverted during build). Workaround: `node -e` script + immediate commit.

---

## Release Playbook & CI Improvement Plan (2026-03-23)

**Release Playbook:** Step-by-step procedure covering pre-release checklist, release execution, fallback procedures, post-release verification, non-negotiable rules, known gotchas.

**CI Improvement Plan:** 7 GitHub issues + 4 cleanup actions (dependency validation gate, npm publish policy fix, workflow cache mitigation, squad-promote workflow, squad-preview validation, squad version command fix, escalation policy documentation).

**Session cleanup:** Deleted 17 old session log files; preserved retrospective findings in inbox.

---

## Phase B Piece 10 Finalization: Squash + Scrub + Force-Push (2026-05-15)

**Task:** Finalize `akubly/upstream-10-init-fail-fast` by squashing revision commits, running scrub gate, and force-pushing.

**Strategy:** Soft reset to piece-09 base, staged product files only, single commit 331894e8.

**Scrub gate:** Gate 1 FAIL (pre-existing baseline contamination), Gates 4–6 PASS (no new issues from piece-10).

**Verification:** 43 tests GREEN, clean build, changeset intact, REPLAY-PROTOCOL compliant commit.

---

## PowerShell Backtick Hazard in Commit Messages (2026-05-18)

**Issue:** Piece 13 commit rejected—PowerShell double-quoted heredocs parse backtick (`) as escape, silently consuming backticks.

**Fix:** Used `create` tool to write message to file, `git commit --amend --only -F` (message-only amend), force-pushed.

**Safe patterns:** (1) Use `create` tool, (2) Single-quoted heredocs, (3) git commit with editor, (4) Never double-quoted with backticks.

**Skill created:** `.squad/skills/commit-message-quoting/SKILL.md`.

---

## Piece 21 Ship Gate Cleared (2026-05-22)

**Event:** Post-stack-review gate clearance — all five required fixes shipped. Follow-up work (FIX-6 to FIX-8) deferred to piece 22.

---

*Archive created at 2026-06-08T01:17:37.137Z. Summarized learnings from 2026-03-23 through 2026-05-22.*
