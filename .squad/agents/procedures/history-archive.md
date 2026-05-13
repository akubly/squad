# Procedures — History Archive

> Older learnings (pre-2026-05-13), archived from history.md for reference.

## Archived Learnings

### Deterministic Skill Pattern (2026-03-10)

**Problem:** Skills were too loose. The distributed-mesh skill was tested in a real project (mesh-demo), and agents generated 76 lines of validator code, 5 test files with 43 tests, regenerated sync scripts that should have been copied from templates, and left decision files empty.

**Solution:** Rewrite skills to be fully deterministic:

1. **SCOPE section** (right after frontmatter, before Context)
   - ✅ THIS SKILL PRODUCES — exact list of files/artifacts
   - ❌ THIS SKILL DOES NOT PRODUCE — explicit negative list

2. **AGENT WORKFLOW section** — Step-by-step deterministic instructions
   - ASK: exact questions to ask the user
   - GENERATE: exactly which files to create, with schemas
   - WRITE: exactly which decision entry to write, with template
   - TELL: exact message to output to user
   - STOP: explicit stopping condition, with negative list

3. **Fix ambiguous language**
4. **Decision template** — inline markdown showing exactly what to write

### Issue Triage (2026-03-22)

Flight triaged 6 unlabeled issues and filed 1 new issue.

Procedures assigned:
- **#485 (Agent Specification PRD)** → squad:flight + squad:procedures (architecture decision + formal spec structure)

Pattern: Agent specification gap identified. Procedures owns formal spec structure and documentation; Flight owns architecture decisions.

### Crash Recovery & Model Catalog Merge (2026-03-26)

Procedures executed Round 2 PR merge action: rebased PR #619 (model catalog refresh, issue #588) onto dev branch from main, resolved 3 merge conflicts, and successfully merged. Model catalog now current.

### Wave 1 Personal Squad & Economy Mode (2026-03-22)

Economy mode governance proposal and personal squad consult-mode governance proposal authored for squad.agent.md — both DRAFT, awaiting Flight review. Economy mode adds Layer 3 table + spawn convention. Personal squad adds consult mode detection, path reference table, spawn guidance. Proposed new skill: `.squad/skills/consult-mode/SKILL.md`.
