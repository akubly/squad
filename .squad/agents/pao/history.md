# PAO

> Public Affairs Officer

## Core Context

Docs live in docs/ with blog/, concepts/, cookbook/, getting-started/, guide/, features/, scenarios/ sections. Blog tests use filesystem discovery (dynamic); other sections use hardcoded expected arrays. Microsoft Style Guide enforced: sentence-case headings, active voice, second person, present tense. Docs format: plain markdown, H1 title, experimental warning, "Try this" code blocks, overview, HR, H2 content sections. Scannability framework: paragraphs for narrative, bullets for scannable items, tables for comparisons.

## Team Update

📌 **Team update (2026-06-02T22:35:00Z — Piece 30 Adversarial Review):** PAO conducted documentation and developer-experience review of piece 30 ADO templates (commit 10168051); verdict: APPROVE-WITH-NITS. Identified 1 mandatory finding: test/docs-build.test.ts missing `'state-backends'` in EXPECTED_FEATURES array — docs-test sync hard rule violated. Additional 8 non-blocking observations on terminology drift (4 instances of `old-squad-state.yml`), typos (2), clarity gaps (3 on `$DocsRepoUrl` format, `squad bind` prerequisite, single-repo case, credentials warning), deep-linking issues. Piece is well-structured; documentation gaps are fixable. Consolidated to REJECT verdict by Flight.

## Archive

See history-archive.md for learnings prior to 2026-05-14 (docs audit, TypeDoc research, API reference PRD, release playbook, v0.9.0 blog, community triage, npx purge, provider discovery, JSDoc patterns, etc.).

**Patterns to remember:**
- Blog format: YAML frontmatter (title/date/author/wave/tags/status/hero) → experimental warning → "What Shipped" → "Quick Stats" → "Breaking Changes" → "Upgrading" → "What's Next"
- Documentation requires crosslinks from curated guides to new sections (API reference, CLI reference)
- Microsoft Style Guide: sentence-case headings, active voice, second person, present tense, no ampersands except in code
- Format standards: H1 title, experimental callout, "Try this" code blocks, overview, HR, then H2 sections
- Teams MCP urgency: deprecated tools (Office 365 Connectors → Power Automate Workflows) require immediate docs updates to prevent support burden
- DOCS-TEST SYNC: update test assertions in docs-build.test.ts in the SAME commit when adding pages
- Boundary review: Squad docs = features/patterns Squadron ships; IRL = community extensions using external tools
- Scannability: paragraphs for narrative, bullets for scannable items, tables for comparisons/structured data

## Active Issues / Assigned Work

- **#488 (GitHub auth setup for project boards)** — squad:pao (documentation, newly filed)
- **#478 (Polish REPL)** — squad:vox + squad:pao (shell UX readiness + README documentation gate)
- **#476 (Guide v0.4.1 update)** — squad:handbook + squad:pao (SDK patterns + documentation)

📌 **Piece 30 Adversarial Review — 2026-06-02**

**Verdict:** APPROVE-WITH-NITS (1 mandatory, 8 non-blocking)

Enterprise ADO docs are high-quality and scannably formatted. **Blocker: M1** — `test/docs-build.test.ts` missing `'state-backends'` in EXPECTED_FEATURES (docs-test sync hard rule). **Non-blocking:** Terminology drift (old-squad-state.yml vs. fold-squad-state.yml, 4 instances), typos (ootstrap-cross-repo.ps1, ootstrapScriptPath), code block language (ash→bash), missing URL format clarity ($DocsRepoUrl), no guidance for missing Squad CLI, single-repo case unaddressed, credential security callout absent, deep linking incomplete. All doc claims verified against templates. Scannability strong (tables, bullets, nested structure); style guide compliant. See `.squad/reviews/piece-30-pao.md` for full cross-checks and detailed nits.

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. PAO owns GitHub auth docs (#488), REPL documentation gate (#478), and Guide v0.4.1 refresh (#476). High community value on Guide update. Ready to begin documentation work on next sprint.

📌 **Team update (2026-06-02T21:16:49Z — Piece 29 Nit Revision Complete):** Your mandatory nits (N1 explore-spawn five-variable contract, N2 single-repo case callout) landed as M1 and M3 in Flight's revision. All 3 mandatory nits now resolved (SHA b7ff4f99). Spawn-template scannability improved: STATE_REMOTE/STATE_BRANCH/DEVELOPER_ALIAS now carry inline purpose notes. Tests: 223/223 green. Ready for Phase C.

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

---

## 📌 Piece 29 Adversarial Review — 2026-06-02

- **New pattern:** PAO pulled into adversarial review panel for prose-heavy template changes. Scope: readability/comprehension/tone (not architecture or security).
- Coordinator template is "audience-facing doc" for agents — same scannability standards apply as external docs.
- Key finding: spawn variable blocks need inline purpose hints; variables without context cause hesitation on cold spawn.
- Deep-probe walkthrough (line-by-line as fresh agent) is an effective technique for surfacing comprehension gaps invisible to the author.
