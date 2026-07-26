# SURGEON

> Flight Surgeon

## Learnings

### Release Governance Rules (2026-03-23 v0.9.0→v0.9.1 Incident)
**Context:** v0.9.0 published with critical defect (CLI package had local monorepo reference instead of registry version). v0.9.1 hotfix prepared in minutes; publish workflow infrastructure collapsed (GitHub cache race + npm automation issue + 2FA hang), extending 10-minute fix to 8-hour incident.

**Governance rules established:**
1. **Surgeon owns all publishing.** Not Coordinator, not user. All release work routed to Surgeon. Coordinator escalates on failures.
2. **Strict process adherence.** Same playbook every time. No improvisation. Written checklists mandatory.
3. **Document to prevent recurrence.** If same problem happens twice, documentation failed. Root cause analysis + action items for every incident.
4. **CI/CD is top priority.** Release quality determines team effectiveness. Invest in automation, testing, pre-flight validation.
5. **Pre-flight gates mandatory.** Before any release tagging: validate dependencies, run smoke tests, verify versions, check 2FA settings, run dry-run installs.
6. **Escalation protocol.** If workflow fails twice, switch to local publish immediately. Two fallback paths: primary (CI/CD) + fallback (local), both documented.

**Action items (A1–A6):**
- A1: Dependency validation in publish workflow (scan for `file:` refs, npm install dry-run)
- A2: npm workspace publish policy (never `-w` for publish; 2FA auth-only)
- A3: GitHub workflow cache mitigation (15+ min wait documented, escalation runbook)
- A4: Publish fallback protocol (switch to local on 2nd failure)
- A5: Release readiness checklist (pre-flight validation before tagging)
- A6: Post-publish smoke test (mandatory global install verification)

**Release process skill created:** `.squad/skills/release-process/SKILL.md` documents all patterns and procedures.

### v0.9.0 CHANGELOG Organization (2026-03-23)
v0.9.0 is MAJOR minor bump (0.8.25 → 0.9.0) justified by 40+ commits, 6+ major features, governance layer, breaking behavioral changes. Organized by feature cluster (not chronological):
- Personal Squad, Worktree, Machine Capability Discovery, Rate Limiting, Economy Mode, Telemetry, Templates, Skills, Docs, ESLint patterns
- 12 feature sections + 5 fix categories
Strict format adherence: matched existing CHANGELOG headers, `### Added` pattern, PR refs (#NNN), grouped by domain. No npx, no "agency" terminology.

### Release History
v0.8.24 released successfully. npm packages: @bradygaster/squad-sdk@0.8.24, @bradygaster/squad-cli@0.8.24. publish.yml triggers on `release: published` (NOT draft). Test baseline at release: 3,931 tests, 149 files.

### Version Mutation Bug (P0)
bump-build.mjs mutates versions during local builds despite SKIP_BUILD_BUMP=1 and CI=true env vars. Workaround: set versions with `node -e` script and commit IMMEDIATELY before building. This is a P0 fix item in docs/proposals/cicd-gitops-prd.md.

### Known Incidents
v0.8.22: 4-part version 0.8.21.4 mangled by npm to 0.8.2-1.4. v0.8.23: versions reverted from 0.8.23 to 0.8.22 during build despite env vars. Both resolved with the node -e script + immediate commit workaround.

### v0.9.0 CHANGELOG Written
**Date:** 2026-03-23

v0.9.0 is a MAJOR minor version bump (0.8.25 → 0.9.0) justified by 40+ commits spanning 6+ major features and governance-layer additions. CHANGELOG organized across 12 feature sections + fixes:

**Feature Categories:**
- Personal Squad (governance layer + ambient discovery)
- Worktree Spawning & orchestration
- Machine Capability Discovery
- Cooperative Rate Limiting & circuit breaker
- Economy Mode (cost-conscious model selection)
- Auto-wire Telemetry
- Issue Lifecycle & KEDA templates
- Session Recovery skill
- GAP analysis verification loop
- GitHub Auth Isolation skill
- Astro docs site improvements (10 items)
- Skill migrations (.squad → .copilot)
- ESLint runtime anti-pattern detection

**Fixes:**
- CLI terminal rendering (scroll flicker, Ink remounting)
- Upgrade path & installation (P0 gaps, EPERM handling, template alignment)
- ESM compatibility (Node 22/24 vscode-jsonrpc fixes)
- Runtime stability (signal handling, race conditions, timeouts, memory safety)
- GitHub integration (CI hardening, casting alignment)

**Documentation:** Maintained strict format rules (no npx refs, no "agency" terminology, matched existing CHANGELOG style, grouped by feature subsections). CLI Terminal Rendering fixes kept from [Unreleased] as part of 0.9.0.

### v0.9.0 → v0.9.1 Release Retrospective
**Date:** 2026-03-23

**Executive Summary:** v0.9.0 published with critical defect—CLI package.json contained `"@bradygaster/squad-sdk": "file:../squad-sdk"` (local monorepo reference instead of registry version). Package broken on global install. v0.9.1 hotfix prepared in minutes but publish workflow infrastructure failures extended resolution to 8 hours (should have been 10 minutes).

**Root Causes:**
1. **Dependency Validation Gap** — No pre-publish check for `file:` references. npm workspaces automatically rewrite `"*"` → `"file:../path"` during development; this persisted in published package.
2. **GitHub Actions Workflow Cache Race Condition** — After deleting `squad-publish.yml`, GitHub workflow index didn't refresh for 10+ minutes. `workflow_dispatch` returned 422 error that persisted despite file deletion.
3. **npm Workspace Publish Broken** — `npm -w packages/squad-sdk publish` hung indefinitely (2FA auth issue on machine without authenticator app).
4. **Coordinator Decision-Making** — Retried broken `workflow_dispatch` 4+ times instead of escalating to local publish fallback sooner.

**Key Action Items:**
- A1: Add dependency validation to publish workflow (scan for `file:` refs, dry-run npm install)
- A2: Establish npm publish policy (never use `-w` for publishing; always `cd` into package directory)
- A3: Mitigate GitHub Actions cache race condition (document 15-min wait; escalate to local publish on 2nd failure)
- A4: Define publish fallback/escalation protocol (2nd workflow failure → immediate local publish)
- A5: Pre-release readiness checklist (dependency scan, CHANGELOG, tests, 2FA verify)
- A6: Post-publish smoke test (run global install; rollback if fails)

**Process Changes:**
- Change-1: Pre-publish validation mandatory (before tagging)
- Change-2: Simplified publish flow (remove manual `workflow_dispatch`; let tag trigger workflow)
- Change-3: Explicit runbook in PUBLISH-README.md (no tribal knowledge)
- Change-4: Escalation to fallback (fail-fast instead of retry loops)
- Change-5: Package validation in CI (ESLint rule to reject `file:` refs)

**Documentation:** Full retrospective in `.squad/decisions/inbox/surgeon-v091-retrospective.md` and `.squad/log/2026-03-23-v091-retrospective.md`.

**Status:** Approved for implementation. v0.9.1 published successfully (both packages verified live on npm).

---

### Release Playbook & CI Improvement Plan (2026-03-23)

Prepared comprehensive release playbook and CI improvement plan for Brady's review:

1. **Release Playbook** — Full step-by-step release procedure covering:
   - Pre-release checklist (dependency validation, tests, CHANGELOG, versions, npm auth)
   - Release execution (12 numbered steps from version bump to smoke test)
   - Fallback procedures (422 errors, 2FA timeouts, deployment failures, rollback)
   - Post-release verification checklist
   - Non-negotiable rules (no improvisation, no draft releases, no 4-part versions, etc)
   - Known gotchas (npm workspaces auto-rewrite, workflow cache TTL, 2FA hanging)

2. **CI Improvement Plan** — 7 GitHub issues + 4 CI cleanup actions:
   - Issue A: Dependency validation gate (scan for `file:` refs before publish)
   - Issue B: npm publish policy (never use `-w`, always `cd` + `--ignore-scripts`)
   - Issue C: Workflow cache mitigation (15-min wait, escalation policy)
   - Issue D: squad-promote workflow (dev → preview → main automation)
   - Issue E: squad-preview validation (forbidden files, versions, dependencies)
   - Issue F: squad version command fix (show correct CLI version)
   - Issue G: Escalation policy documentation (2nd failure → local publish)
   - CI cleanup: Delete ghost workflows, add pre-commit hooks, verify SKIP_BUILD_BUMP, audit NPM_TOKEN

3. **Session Log Cleanup** — Deleted 17 files from today's session logs:
   - 15 files from `.squad/orchestration-log/`
   - 2 files from `.squad/log/`
   - Preserved retro findings in `.squad/decisions/inbox/` (surgeon-v091-retrospective.md)
   - No agent history.md files deleted

**Key Lessons Learned:**
- Release playbook must be exhaustively detailed with no room for improvisation
- Fallback procedures are critical (workflow failures happen; escalate fast)
- Pre-release validation prevents 90% of publish issues
- Culture: "If the same problem happens twice, the playbook failed"
- Documentation must be user-first (Brady's perspective, not technical jargon)

---

### Phase B Piece 10 Finalization: Squash + Scrub + Force-Push (2026-05-15)

**Task:** Finalize `akubly/upstream-10-init-fail-fast` by squashing revision commits, running scrub gate, and force-pushing.

**Branch state at start:**
- a07608df: EECOM original impl (fail-fast guards)
- e6efb366: Scribe state merge
- 9982249a: Scribe adversarial review closure
- 61f718ba: CONTROL fix (unified init path + lstat)
- cd7da677: Sims tests

**Strategy Applied:** Strategy B (soft reset + recommit)
- Soft reset to piece-09 base
- Staged only product files (packages/squad-cli/src/, test/cli/, .changeset/)
- Left .squad/ state files unstaged for Scribe regeneration
- Single commit: 331894e8 (feat: init fail-fast guards...)

**Scrub Gate Results:**
- Gate 1 FAIL: Pre-existing baseline contamination (orchestration-log, casting, identity, _internal) — documented as accepted per prior Phase B pieces
- Gate 3 WARN: akubly mentions in .squad/ state files — expected, Scribe responsibility
- Gate 4–6: PASS — no new strip-listed paths introduced by piece-10; no Microsoft internal refs; 5 product files changed (well under 30-file limit)

**Verification:**
- Targeted tests: 43 GREEN (init-scope + init-v2)
- Build: clean (tsc + postbuild)
- Changeset intact: .changeset/init-fail-fast.md present in commit
- Commit message: REPLAY-PROTOCOL compliant (no comparison framing, no version leaks, Co-authored-by trailer included)

**Push Result:**
- Force-push with `--force-with-lease` succeeded
- Branch advanced from cd7da677 → 331894e8
- No concurrent modifications detected

**Key Decision:** Baseline scrub gate failures are piece-diff-scoped and non-blocking per established Phase B protocol. All gates that could be introduced by piece-10 passed; pre-existing contamination from upstream baseline is a separate concern.

### PowerShell Backtick Hazard in Commit Messages (2026-05-18)

**Context:** Piece 13 commit (01ae3060) rejected by Flight (BLOCKER) due to corrupted commit message. PowerShell double-quoted heredocs parse backtick (`) as escape sequences, silently consuming the backtick AND the following character. Result: "The `register`" became "The egister", "covered by `assign`" became "covered by ssign", all code spans lost backticks + first letter, and all newlines collapsed to single line.

**Root Cause:** Double-quoted PowerShell Here-String or heredoc used to write multi-line commit message containing backticks. PowerShell's backtick-escape parsing ran before git commit received the message.

**Fix Applied:** 
- Used `create` tool to write corrected message to `C:\Users\akubly\AppData\Local\Temp\2\piece13-commit.txt` (file write avoids PowerShell quoting entirely)
- Verified `git diff --cached` empty (nothing staged)
- Amended commit with `git commit --amend --only -F <file>` (message-only amend, tree unchanged)
- Verified all backticks, newlines, code spans present and correct
- Force-pushed with `--force-with-lease` (SHA changed from 01ae3060 → 9a9c7b06)
- Confirmed trailer `Co-authored-by: Copilot` survived amend

**Safe Patterns for Commit Messages with Backticks:**
1. **Best:** Use `create` tool with `file_text` parameter (avoids all shell quoting)
2. **Alternative:** Single-quoted PowerShell Here-String: `$msg = @'...'@` (no escape processing in single quotes)
3. **Fallback:** `git commit --amend` with editor (EDITOR env var or `--allow-empty-message -e`)
4. **Never:** Double-quoted heredocs with backticks — backtick-escape parsing is silent and destructive

**Skill Created:** `.squad/skills/commit-message-quoting/SKILL.md` with full pattern, verification steps, and safe examples.

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.
