# PAO — History Archive

> Older learnings (pre-2026-05-13), archived from history.md for reference.

## Archived Learnings

### Discussion Triage Patterns (2026-03-23 Release Incident)
**Context:** v0.9.1 release completed; 15 open discussions analyzing whether community response patterns matched feature releases.

**Pattern identified:** Feature releases without follow-up discussion closes = missed trust opportunity. When you ship features (personal squad, worktrees, economy mode, rate limiting), search discussions for matching feature-requests → respond + close proactively. This signals to community that you listen.

**Triage workflow:**
1. Map new features to open discussions (which discussions are solved by this release?)
2. Respond: "This feature is now available in v0.9.1. See docs link."
3. Close as resolved
4. Consolidate: if discussion #463 is duplicate of #402, merge responses into #402, close #463
5. Convert: if discussion reveals a bug or roadmap item, convert to issue with label (e.g., squad:eecom)
6. Keep: if discussion is feedback or edge case, keep open; respond substantively

**For v0.9.1 release:** 4 closed, 1 consolidated, 2 converted to issue, 8 kept. Result: community sees responsiveness; discussions become productivity tool, not backlog.

**Critical finding:** Teams MCP docs need urgent update — Office 365 Connectors deprecated Dec 2024. Docs must purge old connector references and document Power Automate Workflows path (new successor).

### Chinese README Workflow (2026-03-23 Release Incident)
Community contributor (PR #572) provided Chinese README translation. Approved and merged as part of v0.9.1 release. Pattern: accept community translations; list contributors in CONTRIBUTORS.md; acknowledge in release notes.

### Teams MCP Urgency Pattern (2026-03-23)
External tool integrations deprecate. Office 365 Connectors retired Dec 2024. Docs mentioning deprecated tools create support burden and user confusion. Action: audit all external tool integration docs for deprecation; update with successor guidance (Power Automate Workflows for Teams).

### Blog Post Format
YAML frontmatter: title, date, author, wave, tags, status, hero. Body: experimental warning, What Shipped, Why This Matters, Quick Stats, What's Next. 200-400 words for infrastructure releases. No hype — explain value.

### Boundary Review Heuristic
"Squad Ships It" litmus test: if Squad doesn't ship the code/config, it's IRL content. Platform features used alongside Squad: clarify whose feature it is. Squad behavior/config docs stay. External infrastructure docs (ralph-operations, proactive-communication) → IRL.

### DOCS-TEST SYNC
When adding docs pages, update test assertions in docs-build.test.ts in the SAME commit. When rebasing doc PRs, main branch (already merged) takes priority.

### Contributor Recognition
CONTRIBUTORS.md tracks team roster and community contributors. Each release includes recognition updates. Append PR counts, don't replace.

### Skill Scope Documentation Pattern
Explicitly state what a skill produces and does NOT produce. Deterministic skills prevent agents from generating unnecessary code when templates exist.

### Teams MCP Audit
External tool integrations require explicit "where to get it" guidance. Placeholder paths need clarification that users must provide actual MCP server implementations.

### Cross-Org Authentication Docs
Problem/solution structure for multi-account auth: gh auth switch, Copilot instructions, Squad skill pattern. Cover credential helpers, EMU variations, common error messages. Cross-reference in troubleshooting and enterprise-platforms pages.

### Roster & Contributor Recognition (v0.8.25)
Squad moved to Apollo 13/NASA Mission Control naming scheme (Flight, Procedures, EECOM, FIDO, PAO, CAPCOM, CONTROL, Surgeon, Booster, GNC, Network, RETRO, INCO, GUIDO, Telemetry, VOX, DSKY, Sims, Handbook). CONTRIBUTORS.md tracks both team roster and community contributors; contributor table entries grow with PRs (append PR counts rather than replace, maintaining attribution history).

### Git Rebase for Doc Merges
When rebasing doc PRs with conflicts from other merged doc PRs, the main branch version (already merged) should generally take priority. For Node.js version references, maintain LTS terminology when present (e.g., `nvm install --lts` over specific version numbers like `nvm install 20`). Conflict resolution pattern: preserve new content from PR branch only where it doesn't duplicate or contradict already-merged changes. Use `git -c core.editor=true rebase --continue` to bypass interactive editor issues on Windows.

### Astro Docs Format (v0.8.26)
Squad docs use plain markdown without Astro frontmatter. Structure: title (H1), experimental warning callout, "Try this" code blocks at top, overview paragraph, horizontal rule, then content sections with H2 headings. Microsoft Style Guide enforced: sentence-case headings, active voice, second person ("you"), present tense, no ampersands except in code/brand names. Features and scenarios directories added to test coverage in docs-build.test.ts. Reference implementations linked where available (e.g., ralph-watch.ps1 for operational patterns).

### Proactive Communication Patterns (v0.8.26)
Two-way communication layer between Squad and work environment. Outbound: Teams webhook notifications (breaking, briefings, recaps, flashes) sent via Adaptive Cards — only when newsworthy. Inbound: WorkIQ/Playwright scanning of Teams channels and email → auto-create GitHub issues with teams-bridge label, anti-duplicate logic enforced. Loop: inbound creates issues → Ralph dispatches → agents work → outbound notifies results. Human stays informed on mobile. Prerequisites are enhancements, not requirements.

### PR #487 Review & Merge — CLI Docs Expansion (2026-03-22)
Reviewed and merged PR #487 (CLI documentation expansion + broken docs link fix). Improved CLI command reference coverage and fixed internal link validation.

### PR #482 Review & Merge — Pagefind Search Integration (2026-03-22)
Reviewed and merged PR #482. Search functionality integrated into docs site for improved discoverability.

### PR #484 Review & Merge — Sample READMEs (2026-03-22)
Reviewed and merged PR #484. Sample README templates added to improve consistency across documentation examples.

### PR Trust Model Documentation (v0.8.26)
Three trust levels for PR management: (1) Full review (default, team repos) — human gate on every merge; (2) Selective review (personal projects with patterns) — human reviews only critical paths; (3) Self-managing (solo personal repos only) — Squad merges own PRs, human reviews retroactively. Added to reviewer-protocol.md as new section. Important: self-managing ≠ unmonitored; use Ralph work monitoring and Teams notifications for awareness. Decision matrix included for when to use each level.

### Final Docs Review Pattern (v0.8.26)
Pre-PR quality reviews check: (1) Microsoft Style Guide compliance; (2) Tone consistency; (3) Technical accuracy; (4) Cross-reference integrity; (5) DOCS-TEST SYNC; (6) Privacy directive compliance.

### Squad vs IRL Boundary Review (v0.8.26)
Evaluated four docs pages from PR #331 against Squad-specificity criterion. Key distinction: Squad docs = "how the feature works + universal best practices" vs IRL = "how one person built an amazing setup." Pattern: if Squad doesn't ship the code, it's IRL content.

### Boundary Review Execution (v0.8.26)
Executed boundary review findings from PR #331: Deleted ralph-operations.md and proactive-communication.md; reframed issue-templates.md.

### Cross-Org Authentication Docs (v0.8.26)
Created docs/src/content/docs/scenarios/cross-org-auth.md covering GitHub personal + EMU multi-account auth. Three solutions documented.

### Scannability Framework (v0.8.25)
Format selection is a scannability decision, not style preference. Paragraphs for narrative. Bullets for scannable items. Tables for comparisons or structured reference data.

### Docs Catalog Audit (2026)
Full audit of the Astro-based docs site. Found 15 orphaned pages, stale content (whatsnew.md), duplicate/overlap pairs, content quality issues, structural issues, gaps.

### JSDoc API Reference Research (2026-03-23)
Completed research on generating JSDoc-based API reference documentation for Squad SDK. Recommended TypeDoc + typedoc-plugin-markdown. 5–22 hour effort estimate.

### Issue Triage (2026-03-22)
Flight triaged 6 unlabeled issues and filed 1 new issue. PAO assigned to GitHub auth docs, REPL documentation, and Guide v0.4.1 refresh.

### npx Purge + Agency Audit
Brady's distribution directive: `npm install -g @bradygaster/squad-cli` is the only supported install path. All historical context preserved in appropriate places.

### README Slimming + Upgrade Section (v0.8.x)
(Content truncated in archive — see full history.md for details)
