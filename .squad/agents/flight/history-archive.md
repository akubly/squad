# Flight — Project History Archive

> Older learnings (pre-2026-05-13), archived from history.md for reference.

## Archived Team Updates

### 2026-03-26T06:41:00Z — Crash Recovery Execution Complete

Post-CLI crash recovery executed in 3 rounds. Round 1: Flight audited PR/issue state; FIDO verified baseline (5,038 tests ✅ green); Scribe merged stale inbox. Round 2: Flight closed 3 duplicate PRs with rationale; Procedures rebased PR #619 onto dev, resolved 3 merge conflicts, merged; FIDO reviewed 9 community PRs. Round 3: Coordinator merged 3 approved PRs. **10 PRs merged total**. **3 PRs closed** as duplicates. **6 PRs awaiting author revisions**. Dev branch green.

### 2026-03-25T15:23Z — Triage Session & PR Review

Flight triaged 14 untriaged GitHub issues, created prioritized work session plan. Identified high-value quick wins (P1): #610 (docs broken link, 5-min fix), #590 (getPersonalSquadRoot bug, P0), #591 (hiring wiring docs). Deferred community feature contributions pending PR review. FIDO reviewed 10 open PRs, identified 3 duplicate/overlap pairs (6 PRs consolidate to 4).

### 2026-03-23T22:00Z — Release Crisis Recovery

v0.9.0→v0.9.1 incident resolved. Released v0.9.1 stable on npm after 8-hour debugging marathon. Root causes: dependency validation gap, GitHub workflow cache race, npm workspace publish automation broken, coordinator decision-making under pressure, no pre-publish verification. Created comprehensive retrospective with 5 root causes and 6 action items. Filed 9 GitHub issues documenting release process improvements. 10 community PRs merged. All 15 discussions fully triaged.

### 2026-03-22T09:35Z — Wave 1 Personal Squad

Ambient personal squad design validated and 19-task implementation plan authored across 4 PRs. MVP = PR #1 + PR #3. EECOM executing Phase 1–2 (SDK + CLI), Procedures executing Phase 3 (governance). All design gaps resolved; dependency graph established.

## Archived Learnings

### Issue Filing Patterns (2026-03-23 Release Incident)
When a major incident occurs, file 9+ GitHub issues documenting root causes and improvements. Pattern: one issue per root cause + one per action item. Let team pick up issues in priority order. This accelerates fixes and creates accountability.

### Release Governance Directives (2026-03-23)
Brady established strict release governance: (1) Surgeon owns all publishing; (2) strict adherence to playbook; (3) document problems so they don't recur; (4) CI/CD is top priority; (5) written playbooks for everything; (6) no improvisation.

### Adoption Tracking Architecture
Three-tier opt-in system: Tier 1 (aggregate-only, `.github/adoption/`) ships first; Tier 2 (opt-in registry) designed next; Tier 3 (public showcase) launches when ≥5 projects opt in.

### Remote Squad Access
Three-phase rollout: Phase 1 — GitHub Discussions bot with `/squad` command (1 day); Phase 2 — GitHub Copilot Extension via Contents API (1 week); Phase 3 — Slack/Teams bot (2 weeks).

### Content Triage Skill
"Squad Ships It" litmus test codified into reusable workflow. Content labels: `content:blog`, `content:sample`, `content:video`, `content:talk`.

### Distributed Mesh Integration
Zero code changes. Skill files in templates/skills/, scripts in scripts/mesh/, docs in features/. Convention-first additive layer — invisible if unused.

### Sprint Prioritization Pattern
Rank by: (1) bugs with active user impact, (2) quality/test gaps blocking GA, (3) high-ROI features unblocking downstream work. Interleave stability with velocity across sprint capacity.

### Issue Triage Patterns (2026-03-22–2026-03-23)
Identified 10 unlabeled issues requiring squad assignment. SDK issues → squad:eecom + squad:capcom. Personal squad → squad:flight. A2A protocol → squad:flight + domain experts. Tooling layers → squad:eecom + squad:procedures. Manual label application needed by repo owner.
