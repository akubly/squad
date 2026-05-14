# PAO

> Public Affairs Officer

## Core Context

Docs live in docs/ with blog/, concepts/, cookbook/, getting-started/, guide/, features/, scenarios/ sections. Blog tests use filesystem discovery (dynamic); other sections use hardcoded expected arrays. Microsoft Style Guide enforced: sentence-case headings, active voice, second person, present tense. Docs format: plain markdown, H1 title, experimental warning, "Try this" code blocks, overview, HR, H2 content sections. Scannability framework: paragraphs for narrative, bullets for scannable items, tables for comparisons.

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

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. PAO owns GitHub auth docs (#488), REPL documentation gate (#478), and Guide v0.4.1 refresh (#476). High community value on Guide update. Ready to begin documentation work on next sprint.
