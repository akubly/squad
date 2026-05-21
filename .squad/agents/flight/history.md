# Flight — Project History Summary

> Knowledge accumulated through leading Squad development.

## SUMMARY: Casting & Team Identity

Apollo 13 team model (names drawn from NASA Mission Control). Scribe always Scribe, Ralph always Ralph. Three-branch model: main/dev/insiders. Test name-agnosticism enforced (framework tests must never depend on agent names). Two-error lockout policy prevents cascading failures.

## SUMMARY: Rally Integration Boundary

Rally is standalone CLI for git-worktree dispatch to GitHub issues/PRs (non-committable `.squad/` scenario). Responsibility split: Squad owns team identity/prompts/governance/runtime semantics/agent contract. Rally owns onboarding/worktrees/issue dispatch/session tracking/dashboard/trust/sandboxing. Product pattern: Rally treats terminal UX first-class (Ink/React dashboard for TTY, plain-text for non-TTY, docs from E2E tests). Boundary to preserve: Squad = committable in-repo, Rally = complementary external path. If Squad expands into Rally-style orchestration, must be explicit decision.

## SUMMARY: Release Governance & Incident Response

Surgeon owns all publishing (not Coordinator). Strict playbook adherence. Document problems for recurrence prevention. CI/CD top priority. Written playbooks for everything. No improvisation. Issue filing pattern: 9+ issues per major incident (one per root cause + action item). Accelerates fixes, creates accountability.

## SUMMARY: Adoption & Content Boundaries

Three-tier opt-in system: Tier 1 (aggregate-only, `.github/adoption/`) ships first, Tier 2 (opt-in registry) designs next, Tier 3 (public showcase) launches at ≥5 opt-in projects. `.squad/` for team state only; never list individual repos without consent. "Squad Ships It" litmus test: if Squad doesn't ship the code/config, it's IRL content. Content triage skill codifies boundary review pattern.

## SUMMARY: Remote Squad Access Rollout

Phase 1: GitHub Discussions bot with `/squad` command (1 day, zero hosting). Phase 2: GitHub Copilot Extension via Contents API (1 week). Phase 3: Slack/Teams bot (2 weeks). Constraint: any remote solution must solve `.squad/` context access.

## SUMMARY: Community & PR Strategy

Proposal-first discipline: meaningful changes require proposal in `docs/proposals/` before code. Tamir PRs explicitly require proposal framing. 14-issue triage identified 3 duplicate/overlap pairs consolidating 6 PRs to 4. Crash recovery: 3 rounds of issue audit/PR review/merging yielded 10 merged (6 merge-plan, 3 community, 1 legacy), 3 closed duplicates, 6 awaiting revisions. Dev branch green (5,038 tests).

## SUMMARY: SDK Architecture & Integration

SDK Init Shore-Up PRD consolidated 6 SDK issues into 3-phase initiative (root causes: config sync gap, built-in member exclusion, CastingEngine bypass). Phases: (1) fix gaps (P1), (2) wire CastingEngine (P1), (3) full test matrix (P2). 4-sprint estimate to 100% parity. Owners: EECOM + CAPCOM (phases 1–2), FIDO + CAPCOM (phase 3).

## SUMMARY: Distributed Mesh Integration

Zero code changes pattern: skill files in templates/skills/, scripts in scripts/mesh/, docs in features/. mesh.json stays separate from squad.config.ts. Convention-first additive layer (invisible if unused). 125:1 ratio: 30 lines script vs 3,756 lines deleted federation code.

## SUMMARY: Fork Relationship (2026-05-15)

Treat `tamirdresher/squad` as **incubation lane**, not alternate trunk. Fork converges on same problem selection (scheduler automation, persistent Ralph, cross-squad discovery, state backends) with divergence in delivery shape (Tamir packages whole loops; Brady productizes safer primitives). For overlapping capabilities, use mainline as reference. For new capabilities, treat as proposals first. Watchlist: `feat/upstream-auto-sync` for potential adoption.

---

📌 **Team update (2026-05-20T17:28:32Z — Multi-Squad Proposal Landing):** Flight led 4-turn proposal refinement (Flight-10–13) culminating in landed multi-squad management design. Proposal document finalized at `.squad/decisions/multisquad-design/flight-multisquad-proposal.md` with 6 user directives (identity, self-contained docs, zero-impact P0, rally exclusion, CLI stability, chain-of-command layering). 4 inbox decision files merged to decisions.md; 3 stale entries (>30 days) archived. decisions.md reduced 34.3KB→15.8KB via Tier 1 archive gate. Authoritative artifact ready for implementation phase. All prior versioned artifacts preserved in design-trail archive for historical context.

📌 **Team update (2026-03-26T06:41:00Z — Crash Recovery Execution Complete):**Post-CLI crash recovery executed in 3 rounds. Round 1: Flight audited PR/issue state (found #617 merged, #619 conflicting, 3 dupes #605/#604/#602 open); FIDO verified baseline (5,038 tests ✅ green); Scribe merged stale inbox. Round 2: Flight closed 3 duplicate PRs with rationale; Procedures rebased PR #619 (model catalog) onto dev, resolved 3 merge conflicts, merged; FIDO reviewed 9 community PRs—approved 3 (#625/#603/#608), requested changes on 6 (package naming, file paths). Round 3: Coordinator merged 3 approved PRs. **10 PRs merged total** (6 merge-plan, 3 community, 1 legacy #592). **3 PRs closed** as duplicates. **6 PRs awaiting author revisions**. **Dev branch green** (5,038 tests). All merge-plan sequence complete. Draft #567 parked pending requirements. Decision inbox merged to decisions.md and deleted. Next: Monitor change-request PRs for author responses.

📌 **Team update (2026-03-25T15:23Z — Triage Session & PR Review):** Flight triaged 14 untriaged GitHub issues, created prioritized work session plan. Identified high-value quick wins (P1): #610 (docs broken link, 5-min fix), #590 (getPersonalSquadRoot bug, P0), #591 (hiring wiring docs). Deferred community feature contributions (#601–#595) pending PR review. Categorized maintenance (P2) and questions for community. FIDO reviewed 10 open PRs, identified 3 duplicate/overlap pairs (6 PRs consolidate to 4: merge #607/#603/#606, close #605/#604/#602). Work session priority: #610→PAO, #590→EECOM, #592/#611→Flight review, #588→Procedures. Established PR review strategy: Tamir PRs require proposal-first discipline before review. Merge-ready identified: #611 (blocked on #610), #592 (joniba wiring guide, high-quality). A2A protocol PRs remain shelved. All 14 issues fully categorized with squad assignments. Decision inbox merged to decisions.md. Session complete; team ready for execution.

📌 **Team update (2026-03-23T22:00Z — Release Crisis Recovery):** v0.9.0→v0.9.1 incident resolved. Released v0.9.1 stable on npm after 8-hour debugging marathon (should have been 10 min). Root causes: dependency validation gap (file: refs in packages), GitHub workflow cache race, npm workspace publish automation broken, coordinator decision-making under pressure, no pre-publish verification. Created comprehensive retrospective with 5 root causes and 6 action items (A1–A6). Filed 9 GitHub issues (#556–#564) documenting release process improvements. Pre-flight job added to publish pipeline (dependency scanning + semver validation). Surgeon charter hardened with release governance rules. 10 community PRs merged (#569, #570, #571, #555, #552, #568, #572, #513, #573, #574). Discussion board fully triaged (15 discussions: 4 closed, 1 consolidated, 2 converted to issue, 8 kept). Dark mode fix deployed to production. Release process skill created at `.squad/skills/release-process/SKILL.md`. 9 GitHub issues filed for release improvements. Team ready for next cycle.

📌 **Team update (2026-03-22T09-35Z — Wave 1):** Ambient personal squad design validated and 19-task implementation plan authored across 4 PRs (Phase 1 SDK, Phase 2 CLI, Phase 3 governance, Phase 4 tests). MVP = PR #1 + PR #3. EECOM executing Phase 1–2 (SDK + CLI), Procedures executing Phase 3 (governance) concurrently. All design gaps resolved; dependency graph established. Procedures wrote governance proposals for personal squad + economy mode — awaiting your review. Sims to execute Phase 4 after Phase 1+2 merge. Directive captured: bug #502 (node:sqlite, P1) to be picked up after Wave 1. No blocking issues — ready for execution.

## Core Context

Three-branch model (main/dev/insiders). Apollo 13 team, 3931 tests. Boundary review heuristic: "Squad Ships It" — if Squad doesn't ship the code, it's IRL content. Proposal-first: meaningful changes need docs/proposals/ before code. Two-error lockout policy: agent locked out after 2 errors in a session. Test name-agnosticism: framework tests must never depend on dev team's agent names.

📌 **Team update (2026-05-15T22:45:19Z — Rally Familiarization Complete & Decisions Merged):** Four-agent familiarization sprint on Rally completed. Flight analyzed Rally relationship to Squad (committable in-repo vs. non-committable external), EECOM documented technical integration (GitHub CLI host/agent split, `.worktrees/` patterns), Network analyzed distribution implications, PAO developed positioning strategy. Decisions drafted and merged to `.squad/decisions.md`: Rally Relationship, EECOM Technical Notes, Squad/Rally Positioning. Orchestration logs written (flight/eecom/network/pao). Session log created. All Rally learnings captured. Scribe archived inbox files and committed team state. Squadron ready for next cycle.

## Core Context

### Rally familiarization (2026-05-15T22:45:19-07:00)
- **What Rally is:** a standalone CLI that dispatches Squad teams to GitHub issues/PRs through isolated git worktrees. It is built for solo/open-source/shared-repo workflows where committing `.squad/` files into the target repo is not appropriate.
- **How it integrates with Squad:** Rally depends on `@bradygaster/squad-sdk`, sets up **consult mode** in each worktree, and can symlink `.squad/`, `.squad-templates/`, and `.github/agents/squad.agent.md` into onboarded repos. Rally is not a parallel agent system; it is an operator/orchestration shell around Squad.
- **Responsibility split:** Squad owns team identity, prompts, governance, runtime semantics, and the agent contract. Rally owns repo onboarding, worktree lifecycle, issue/PR dispatch, session tracking, dashboard UX, trust prompts, and optional sandboxing.
- **State model:** Rally stores its own operational state in `~/rally` (`config.yaml`, `projects.yaml`, `active.yaml`) with atomic writes and lock files. That keeps shared repos mostly clean while still letting each worktree carry local context/log files.
- **Safety model:** Rally prepends a read-only dispatch policy, denies `gh`, `git push`, and common network shells by default, and offers trust checks plus Docker sandboxing. Its posture is “analyze and prepare locally; human reviews/publishes.”
- **Product pattern worth noting:** Rally treats terminal UX as a first-class product surface — Ink/React dashboard for TTY, plain-text dashboard for non-TTY, and docs generated from E2E journey tests. This is a stronger operator-console stance than Squad’s in-repo team-state model.
- **Roadmap implication for Squad:** Rally now depends on **stable consult-mode + personal-squad semantics** from Squad SDK/CLI. Any Squad change to personal squad resolution, agent-file layout, or consult-mode behavior can break Rally’s external workflow.
- **Boundary to preserve:** Squad remains the committable, in-repo team framework; Rally is the complementary path for non-committable/shared-repo dispatch. If Squad ever expands into Rally-style external orchestration, that should be an explicit product decision, not accidental overlap.

### Issue Filing Patterns (2026-03-23 Release Incident)
When a major incident occurs, file 9+ GitHub issues documenting root causes and improvements. Pattern: one issue per root cause + one per action item. Use descriptive titles linking to specific improvements (e.g., "#556 Dependency validation in pre-publish checks"). Let team pick up issues in priority order. This accelerates fixes and creates accountability.

### Release Governance Directives (2026-03-23)
Brady established strict release governance: (1) Surgeon owns all publishing (not Coordinator); (2) strict adherence to playbook; (3) document problems so they don't recur; (4) CI/CD is top priority; (5) written playbooks for everything; (6) no improvisation. Captured for team memory and enforced in team decisions.

### Adoption Tracking Architecture
Three-tier opt-in system: Tier 1 (aggregate-only, `.github/adoption/`) ships first; Tier 2 (opt-in registry) designed next; Tier 3 (public showcase) launches when ≥5 projects opt in. `.squad/` is for team state only, not adoption data. Never list individual repos without owner consent.

### Remote Squad Access
Three-phase rollout: Phase 1 — GitHub Discussions bot with `/squad` command (1 day, zero hosting). Phase 2 — GitHub Copilot Extension via Contents API (1 week). Phase 3 — Slack/Teams bot (2 weeks). Constraint: any remote solution must solve `.squad/` context access.

### Content Triage Skill
"Squad Ships It" litmus test codified into reusable workflow. Triggered by `content-triage` label. Output: boundary analysis, sub-issues for PAO (doc extraction), IRL reference for Scribe. Content labels: `content:blog`, `content:sample`, `content:video`, `content:talk`.

### Distributed Mesh Integration
Zero code changes. Skill files in templates/skills/, scripts in scripts/mesh/, docs in features/. mesh.json stays separate from squad.config.ts. Convention-first additive layer — invisible if unused. 125:1 ratio (30 lines of script vs 3,756 lines of deleted federation code).

### Sprint Prioritization Pattern
Rank by: (1) bugs with active user impact, (2) quality/test gaps blocking GA, (3) high-ROI features unblocking downstream work. Interleave stability (bugs/quality) with velocity (features) across sprint capacity.

**Updated wisdom.md with 4 patterns + 2 anti-patterns from recent work:** Test name-agnosticism for team rebirths, dynamic filesystem discovery for evolving content, cli-entry.ts unwired command bug pattern, bump-build.mjs version mutation timing, invalid semver formats, git reset data loss.

**Issue triage attempted for 30 open issues:** Identified 10 unlabeled issues requiring squad assignment. Enterprise Managed User permissions blocked GitHub API label updates via `gh issue edit`. Triage analysis complete:
- SDK issues (#337, #342) → squad:eecom + squad:capcom (init flow + casting engine)
- Personal squad (#343, #344) → squad:flight (architecture territory)
- A2A protocol (#332-336) → squad:flight + domain experts (network, vox, retro, eecom)
- Tooling layers (#330) → squad:eecom + squad:procedures
Manual label application needed by repo owner.

**SDK Init Shore-Up PRD created:** Consolidated 6 SDK-related issues (#337-342, #340-341) into unified 3-phase initiative at `.squad/identity/prd-sdk-init-shoreup.md`. Root causes: config sync gap, built-in member exclusion (Ralph, @copilot), CastingEngine bypass. Solution: Phase 1 fixes gaps (P1), Phase 2 wires CastingEngine (P1), Phase 3 exercises full test matrix (P2). Estimated 4 sprints to 100% SDK feature parity. Owners: EECOM + CAPCOM (phases 1-2), FIDO + CAPCOM (phase 3).

📌 **Team update (2026-03-11T01:25:00Z):** Flight completed 30-issue triage + unified SDK Init Shore-Up PRD. CAPCOM + EECOM completed deep technical analysis + implementation roadmap. 5 decisions merged to decisions.md: Phase-based quality improvement program, CastingEngine canonical casting, squad.config.ts as source of truth, Ralph always-included, implementation priority order.

### Issue Triage & PR Pipeline (2026-03-22)

**Triaged 6 unlabeled issues:** Assigned to appropriate squad members per domain expertise and team capacity. Applied `next-up` label to 10 priority items (bugs, easy wins, docs improvements). All triaged issues now have clear ownership and next steps.

**PR Pipeline:** Reviewed and rebased 8 PRs across EECOM, GNC, and PAO. All merged successfully. Key patterns documented for team reuse:
- **az CLI timeouts** (PR #483): External CLI calls need explicit timeouts + fallback handling
- **History race conditions** (PR #480): File operations require mutex + atomic writes + exhaustive tests
- **Signal handling** (PR #486): SIGINT cleanup needs two-layer approach (parent + child cleanup)
- **ESM exports** (PR #474): Node 22 compatibility requires exports map + file existence validation
- **Broken docs links** (PR #487): Automated link validation should be CI gate

Test coverage expanded: 36 new tests (EECOM) + 4655+ total passing (GNC report).

**Coordinator actions:** Filed #488 (GitHub auth documentation), created `next-up` label, labeled 10 priority issues for next sprint focus.
📌 **Team update (2026-03-10T12-55-49Z):** Adoption tracking architecture finalized. Three-tier system approved: Tier 1 (aggregate-only, `.github/adoption/`) shipping with PR #326; Tier 2 (opt-in registry) designed for next PR; Tier 3 (public showcase) launches when ≥5 projects opt in. Append-only file governance rule enforced to prevent data loss. Microsoft ampersand style guide adopted for all user-facing documentation.

### PR #331 Review — Boundary Review Pattern Reinforced (2026-03-10)
Approved PR #331 ("docs: scenario and feature guides from blog analysis") for merge. PAO's boundary review (remove external infrastructure docs, reframe platform features to clarify scope, keep Squad behavior/config docs) was executed correctly. Key decisions: (1) ralph-operations.md and proactive-communication.md deleted — both document infrastructure around Squad, not Squad itself; (2) issue-templates.md reframed to clarify "GitHub feature configured for Squad" not "Squad feature"; (3) reviewer-protocol.md Trust Levels section kept — documents user choice spectrum within Squad's existing review system. Litmus test pattern: if Squad doesn't ship the code/config, it's IRL content. Docs-test sync maintained. Pattern reinforced as reusable boundary review heuristic for future doc PRs.

**Adoption tracking architecture — three-tier opt-in system:** `.squad/` is for team state only, not adoption data (boundary pattern). Move tracking to `.github/adoption/`. Never list individual repos without owner consent — aggregate metrics only until opt-in exists. Tier 1 (ship now) = aggregate monitoring. Tier 2 (design next) = opt-in registry in `.github/adoption/registry.json`. Tier 3 (launch later) = public showcase once ≥5 projects opt in. Monitoring infra (GitHub Action + script) is solid — keep it. Privacy-first architecture: code search results are public data, but individual listings require consent.

**Remote Squad access — three-phase rollout:** Phase 1 (ship first): GitHub Discussions bot with `/squad` command. Workflow checks out repo → has full `.squad/` context → answers questions → posts reply. 1 day build, zero hosting, respects repo privacy automatically. Phase 2 (high value): GitHub Copilot Extension — fetches `.squad/` files via GitHub API, answers inline in any Copilot client (VS Code, CLI, mobile). Works truly remote, instant, no cold start. 1 week build. Phase 3 (enterprise): Slack/Teams bot for companies. Webhook + GitHub API fetch. 2 weeks build. Constraint: Squad needs `.squad/` state (team.md, decisions.md, histories, routing) to answer intelligently. Any remote solution must solve context access. GitHub Actions workflows solve this for free (checkout gives full state). Copilot Extension uses Contents API. Discussions wins for MVP because it's async (perfect for knowledge queries), persistent (answers are searchable), and zero infra. Proposal-first: write `docs/proposals/remote-squad-access.md` before building.

### Content Triage Skill Codified (2026-03-10)
Created `.squad/skills/content-triage/SKILL.md` to codify the boundary heuristic from PR #331. Defines repeatable workflow for triaging external content (blog posts, sample repos, videos, talks) to determine what belongs in Squad's public docs vs IRL tracking. Key components: (1) "Squad Ships It" litmus test — if Squad doesn't ship the code/config, it's IRL content; (2) triage workflow triggered by `content-triage` label or external content reference in issue body; (3) output format with boundary analysis, sub-issues for PAO (doc extraction), and IRL reference entry for Scribe; (4) label convention (`content:blog`, `content:sample`, `content:video`, `content:talk`); (5) Ralph integration for routing to Flight, creating sub-issues, and notifying Scribe. Examples include Tamir blog analysis (PR #331), sample repo with ops patterns, and conference talk. Pattern prevents infrastructure docs from polluting Squad's public docs while ensuring community content accelerates adoption through proper extraction and referencing.

📌 **Team update (2026-03-11T01:27:57Z):** Content triage skill finalized; "Squad Ships It" boundary heuristic codified into shared team decision (decisions.md). Remote Squad access phased rollout approved (Discussions bot → Copilot Extension → Chat bot). PR #331 boundary review pattern established as standard for all doc PRs. Triage workflow enables Flight to scale as community content accelerates.

---

### Issue Triage — 6 Unlabeled Issues Routed (2026-03-20)

Triaged and labeled 6 unlabeled issues using routing table:

- **#485 (Agent Specification PRD)** → squad:flight + squad:procedures — Architecture decision (Flight) + formal spec structure (Procedures)
- **#481 (StorageProvider PRD)** → squad:control + squad:eecom — Type system abstraction (CONTROL) + runtime integration (EECOM)
- **#479 (history-shadow race condition)** → squad:eecom + squad:retro — Production data loss bug; mitigation through StorageProvider atomicity
- **#478 (Polish REPL)** → squad:vox + squad:pao — Shell UX readiness (VOX) + README documentation gate (PAO)
- **#477 (Code Quality Linting PRD)** → squad:fido — Monorepo async/promise quality, ESLint 9 PoC ready
- **#476 (Guide v0.4.1 update)** → squad:handbook + squad:pao — SDK patterns + documentation

Key pattern: PRDs cluster around three architectural gaps (agent spec, state abstraction, quality tooling) + one production bug (#479). Guide update high community value.
### Ambient Personal Squad Architecture Review (#329 + #344)

**Design validated:** The `flight-ambient-personal-squad.md` proposal is structurally sound. Key finding: `multi-squad.ts` already stores personal squad paths as direct dirs (`squads/{name}/`) with no nested `.squad/` subfolder — the "each team IS the squad root" convention is already the implementation, not a change needed.

**Five gaps found in the design doc:**
1. No `resolvePersonalAgents()` function signature — added in implementation plan (T2).
2. Scenario 9 contradiction: personal agents wrote to project orchestration log, violating ghost protocol. Resolution: coordinator writes audit trail (project state), not the personal agent.
3. `--team-root` scope was undefined. Decision: additive CLI flag on `squad init`, backward compat with existing `config.json` teamRoot.
4. `squad personal init` was missing — bootstrapping path for first-time users. Added as T6 subcommand.
5. `SQUAD_NO_PERSONAL` env var was in Open Questions but absent from phases. Added to T1.

**Architecture decision:** Need `ensureSquadPathTriple` in `resolution.ts` (T4) — personal agents write to a third root (personal squad dir). Without it, ghost protocol is advisory-only and not enforced by path guards in SDK.

**Phasing:** Four PRs. MVP = PR #1 (SDK Foundation) + PR #3 (Governance). Users see ambient cast immediately; `squad personal` commands are quality-of-life on top.

**Implementation plan written to:** `.squad/decisions/inbox/flight-329-344-implementation-plan.md`

📌 **Team update (2026-03-24):** Ambient personal squad design reviewed and approved with 5 gaps identified and resolved. Implementation plan broken into 4 PRs across EECOM (SDK + CLI), Procedures (governance), and Sims (tests). MVP path = SDK foundation + governance updates. Phased to avoid one giant PR.

### Session 2 Summary (2026-03-22)

Wave 1 architecture work on #329/#344: validated 20KB personal squad design doc, identified and patched 5 gaps, authored 19-task implementation plan spanning 4 future PRs. Implementation not yet started — deferred to future session. EECOM assigned Phase 1–2 (SDK + CLI), Procedures assigned Phase 3 (governance), Sims assigned Phase 4 (tests).

### Community PR Batch Review — July 2026

Five open community PRs reviewed:

- **#524 (diberry)** — Astro docs improvements (sitemap, RSS, schema fields, ToC component, robots.txt). ✅ Merge-ready. Flag: `robots.txt` Sitemap URL points to `squad.dev` while `astro.config.mjs` still uses `bradygaster.github.io` — minor URL inconsistency to address.
- **#523 (diberry)** — Worktree-aware `detectSquadDir` + `resolveWorktreeMainCheckout` + init guard. ✅ Merge-ready. Directly addresses the worktree gap flagged in #525. Clean implementation; interactive TTY prompt with sensible default.
- **#522 (tamirdresher)** — Rate limiting/circuit breaker watch integration. 🔄 Still a full rewrite of watch.ts. Brady's CHANGES_REQUESTED (additive patch, not full file replacement) has NOT been addressed. Same structural concern remains.
- **#513 (tamirdresher)** — Cross-machine-coordination SKILL.md. 🔄 Wrong directory (`.squad/skills/` is team-state; generic library content belongs in `templates/skills/`). Personal use case examples (voice cloning, DevBox) should be generalized. Needs `docs/proposals/` entry per proposal-first policy.
- **#507 (JasonYeYuhe)** — Chinese README translation. 🔄 Needs a community-maintained freshness disclaimer before merging. Translation quality looks solid; the maintenance burden concern is the only gate.

**Patterns noted:**
- Diberry (MSFT) is delivering consistent, architecturally-sound contributions — both PRs are merge-ready.
- Tamir's contributions are technically strong but need delivery discipline (full-rewrite vs. surgical patch, proposal-first for new primitives).
- Community translations are welcome but need a sustainability framing before merge.

### Worktree Gap Triage — #525 (2025-07-18)

Community contributor joniba filed #525 identifying that Squad has full worktree *detection* but zero worktree *creation* in the coordinator/spawn flow. Validated all 10 claims — analysis is accurate. The reading infrastructure (resolveSquad() worktree detection, .gitattributes merge=union, boundary tests) is ~95% complete. The gap: ralph-commands.ts hardcodes `git checkout -b` in all 3 platform adapters (lines 50/71/92), coordinator never creates worktrees before spawn, no WORKTREE_PATH in prompts, and issue-lifecycle.md is referenced in squad.agent.md but doesn't exist.

**Decision:** P2 — important but not v1-blocking. Broke into 5 sub-issues: (1) doc fix for missing issue-lifecycle.md (quick win → Procedures), (2) worktree variant in ralph-commands.ts (EECOM), (3) coordinator pre-spawn logic (Procedures + EECOM), (4) post-merge cleanup (EECOM), (5) architecture decision on heuristic (Flight). Sub-issue #1 ships immediately; #2–5 queue post-Wave-1 alongside SubSquads work where parallel execution becomes a hard requirement.

**Backlog priority recommendation:** Top 5 for v1 = #508 (Ambient Personal Squad), #498 (remove .squad/ from VCS), #485 (Agent Spec & Validation), #481 (Typed StorageProvider), #347 (shore up init --sdk). Quick wins: #525 doc fix, #347. Deprioritize: manual verification debt (#418–421), long-term exploratory. A2A (#332–336) stays shelved per existing decision.

### Release Hardening Plan — Finalized (2026-07-22)

Brady approved scope for remaining v0.9.1 incident hardening. Three issues to execute, three deferred into umbrella:

**DO:** #564 (rewrite PUBLISH-README.md as living playbook — absorbs #558, #559, #560), #557 (CI lint rule rejecting non-workspace `npm publish` in workflow YAML), #562 (delete ghost workflow `publish-npm.yml` ID 250121956).

**DEFERRED into #564:** #560 (pre-flight checklist → playbook section), #559 (fallback protocol → playbook section), #558 (422 race docs → playbook section).

**Key findings:**
- GitHub REST API has NO "Delete a workflow" endpoint. Ghost workflows only disappear when all their runs are deleted (GitHub GC). Procedure: `gh api` to list+delete all runs for workflow ID 250121956, then wait for GC.
- The lint rule goes in `squad-ci.yml` as a `publish-policy` job: scans `.github/workflows/*.yml` for `npm publish` without `-w` flag. Blocks PR merge if violated.
- PUBLISH-README.md playbook has 11 sections covering pre-flight, CI publish, manual fallback, 422 race conditions, insider channel, workspace policy, post-publish verification, and version bumping. Replaces the stale v0.8.22 stub entirely.

**Execution order:** #562 (Brady, manual API call) and #557 (FIDO/Procedures, CI change) run in parallel. #564 (Procedures+Surgeon, playbook) goes last so it can reference the lint rule.

Decision written to `.squad/decisions/inbox/flight-release-hardening-plan.md`.

### Issue Triage Session — 14 Untriaged Issues (2026-03-24)

**Triaged 14 issues + 10 PRs:** 3 docs issues, 6 community feature proposals, 3 bugs, 2 questions. Key findings:

**P0 Bug (immediate):**
- #590 (getPersonalSquadRoot) → squad:eecom — personal squad broken since v0.9.1, affects all `squad consult` on new repos

**P1 Quick Wins:**
- #610 (broken docs link) → squad:pao — 5-minute fix, unblocks diberry PR #611 CI
- #591 (hiring wiring docs) → squad:procedures — matches PR #592 (joniba), high-quality wiring guide ready to merge

**Community PRs (proposal-first enforcement):**
- Tamir PRs #602-607 (6 PRs) — high technical quality but missing proposal-first compliance. Need `docs/proposals/` entries before review.
- Joniba PR #592 — merge-ready, validates enforcement wiring gap
- Diberry PR #611 — blocked on #610 fix, then merge

**P2 Maintenance:**
- #597 (upgrade CLI docs) → squad:pao + squad:network
- #588 (model list update) → squad:procedures
- #554 (broken external links) → squad:pao

**Deferred/Questions:**
- #581 (ADO PRD) → P2, blocked until #341 SDK-first parity ships
- #589, #494 → community replies clarifying skill paths and model selection

**Pattern:** Tamir is a high-output contributor (6 PRs in 2 weeks) but needs proposal-first discipline. Joniba and diberry deliver MSFT-level quality.

Decision written to `.squad/decisions/inbox/flight-triage-session-plan.md`.

## Learnings

### Multisquad proposal refinement pass — muster + ambient personal squads (2026-05-18T14:40:48-07:00)
- Tightened `.squad/decisions/inbox/flight-multisquad-proposal.md` so **assign**, **muster**, and **report in** stay distinct, with `muster` now naming session-start squad loading.
- Extended the proposal’s personal-squad story with ambient discovery from squad home, manifest-declared scope, ledger force/suppress overrides, preserved `SQUAD_NO_PERSONAL` + Ghost Protocol behavior, and an explicit Phase 1/Phase 2 split for one-vs-many personal squads.

### Proposal polish pass for Aaron (2026-05-18T14:12:55-07:00)
- Polished `.squad/decisions/inbox/flight-multisquad-proposal.md` in place: added a Squad primer, tightened call-sign vs squad vocabulary, grounded the story in Contoso repos, restored Casey’s personal ancillary repo beat, and standardized `squad root` terminology.

### Self-contained multi-squad proposal rewrite (2026-05-18T00:03:16-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-proposal.md` as the authoritative self-contained proposal and functional specification for multi-squad management.
- Defined Squad-native vocabulary up front, integrated Casey's first-day narrative into Part I, centered the collaboration model on active-roster participation, and kept the SDK comparison primitive intentionally thin.

### Multi-squad collaboration model replacement (2026-05-17T22:41:30-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-collaboration-model.md` to replace the fallback framing with a collaboration model: union roster, jurisdiction-based routing, one session Scribe, per-squad decision ownership, and shared session logs.
- Downscoped drift/re-entry to a small SDK comparison primitive instead of a large upstream invariant surface.


### Proposal v1.2 revision — Casey narrative integration (2026-05-17T13:10:07-07:00)
- v1.2 of multisquad proposal — integrated PAO's finalized Casey narrative as Part I User Story.

### Proposal v1.1 revision — binding flexibility, layering, Rally boundary (2026-05-17T12:15:27-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-proposal-and-spec-v1.1.md` as the v1.1 revision of the multi-squad proposal and functional spec.
- Locked the position that Squad has **zero hard dependency on Rally**; Rally is one optional consuming host with its own `~/rally/` state directory rather than a required upstream dependency.
- Recast binding as a **pluggable binding-location lookup** and moved corp catalog discovery, enterprise auth flows, and managed-machine personal enforcement out of the SDK mechanism layer and into host policy.

### Fork familiarization — tamirdresher/squad (2026-05-15T22:57:50-07:00)
- Tamir’s fork is not wandering randomly; it is exploring a coherent operating model: durable autonomous ops (`persistent-ralph` + `squad-scheduler`), multi-squad mesh coordination (`cross-squad-orchestration`), inherited/shared context between squads (`upstream-auto-sync`), and Git-native state storage (`state-backend-global-996`).
- The strongest convergence signal is that Brady mainline now contains the same core primitives: `packages/squad-sdk/src/runtime/scheduler.ts`, `packages/squad-sdk/src/runtime/cross-squad.ts`, `packages/squad-cli/src/cli/commands/upstream.ts`, `packages/squad-sdk/src/state-backend.ts`, and the current docs for persistent Ralph / scheduler / cross-squad / state backends. Tamir’s fork is functioning as an incubation lane for ideas Brady is willing to productize.
- `feat/state-backend-global-996` is the clearest proof of adoption: compared to `bradygaster/squad` `dev`, it is now **behind only** (`aheadBy: 0`, `behindBy: 25`). Translation: the branch’s state-backend work has effectively been absorbed upstream and then advanced further.
- The main strategic divergence is **automation scope**. Tamir tends to push end-to-end systems (auto-propagation, heartbeat workflows, broad template + doc + runtime bundles), while Brady mainline narrows those ideas into safer primitives with clearer operator control and proposal/governance gates.
- `feat/upstream-auto-sync` is the branch Brady should keep watching. Mainline already has upstream inheritance, but Tamir’s branch is explicitly about bidirectional sync + propagation; that is a bigger collaboration model than today’s inheritance-focused implementation and could become important if Squad leans harder into fork/network workflows.
- Secondary watch item: the `persistent-ralph` + `squad-scheduler` pairing. Mainline has both primitives, but Tamir is using them as an always-on operations loop; if Squad wants stronger autonomous maintenance, that combined operational pattern is the next likely adoption surface.
- Flight takeaway: treat Tamir’s fork as a strategy probe, not merely a contributor fork. When evaluating future Tamir branches, ask whether they introduce a genuinely new primitive or just a more aggressive automation layer on top of capabilities Brady already adopted.

### Multi-squad strategy proposal (2026-05-15T23:06:53-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-strategy-proposal.md`.
- Headline recommendation: adopt an explicit **Source + Binding + Stack** model where the nearest binding selects one primary squad, org/team/personal layers overlay only where jurisdiction allows, and mutable runtime state stays project-local by default.
- Rally remains the external/shared-repo operator shell; Tamir’s pluggable state backends and Rally’s consult/worktree patterns fit as supporting primitives, not separate competing models.

### Multi-squad strategy convergence (2026-05-15T23:06:53-07:00)
- Read and converged the five Round 1 proposals from Flight, Procedures, EECOM, RETRO, and Network into `.squad/decisions/inbox/flight-multisquad-strategy-converged.md`.
- Canonical decision: **one primary authoritative squad per cwd, personal advisory overlay by default, one active write layer, explicit promotion for broader learnings, and inbox-only cross-squad grants**.
- Canonical storage/distribution decision: **use `%USERPROFILE%\\.squad\\` as the user-home registry/cache/personal store, keep repo/subdir bindings in repo space, use managed CLI + bootstrap manifest for org rollout, and do not create a new v1 tool**.

### Gap analysis vs PAO narratives (2026-05-15T23:54:07-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-strategy-gap-analysis.md` to diff the converged strategy against PAO’s three Casey onboarding narratives.
- Biggest gap: Round 2 under-modeled discovery/bootstrap, ambiguity handling, and host-consumable runtime contracts; the narratives require those as day-1 capabilities, not later polish.
- Biggest correction: `squad-cli` is justified as the first-party portable/reference host, but not as the universal primary host; Rally and org-built hosts need to be treated as first-class consumers of the same SDK contract.

### Solution-shape recommendation (2026-05-16T00:07:22-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-solution-shape-recommendation.md` to settle the Round 4 build-allocation question.
- Final recommendation: invest in **SDK contract work + squad-cli reference-host work + Rally host work**, and do **not** build a new first-party standalone host in v1.
- Most important line held: the SDK owns the invariant host contract (resolution, explanation, runtime contract, policy, materialization); hosts own onboarding, dashboarding, and environment-specific UX.

### Priority-framed plan (2026-05-16T00:14:13-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-priority-framed-plan.md` to re-frame the Round 4 recommendation under Brady’s explicit P0/P1/P1 ordering.
- Chosen execution path: **Path B — selective adoption**; reuse Tamir’s backend/global-state ideas and Rally’s operator shell, but shape the invariant as upstream SDK contract work plus minimal Rally integration.
- Key tension resolved: favor **upstream-shaped SDK/CLI surfaces** over wholesale fork adoption, while letting Rally keep host-local persistence in v1 to minimize custom churn.

### Final proposal + functional specification (2026-05-16T00:24:51-07:00)
- Wrote `.squad/decisions/inbox/flight-multisquad-proposal-and-spec.md` as the final consolidation across Rounds 1–5 for stakeholder proposal + implementation-ready functional spec.
- Final recommendation: **third path** — upstream the minimum invariant SDK kernel, keep catalog/policy/deployment/dashboard layers private, use Rally as a consumer shell, and treat Tamir’s fork as an idea source rather than a merge queue.
- Locked the pivot heuristic now: stay upstream-shaped by default, but flip to independence if the minimum kernel is projected to take more than ~12 weeks to land or if maintainers reject the SDK ownership boundary.

📌 **Team archive (2026-05-17T19:44:23Z):** Multi-squad design phase complete. All Round 1–7 working artifacts archived at .squad/decisions/multisquad-design/ — v1.1 spec is authoritative. See orchestration log for full details.
