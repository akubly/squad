# Procedures

> Standard Operating Procedures & Spec Writer

## Learnings

### TEAM_ROOT Write Discipline (2026-05-21)

Spawn-template file writes must be anchored at TEAM_ROOT (or a derived SQUAD_DIR). Bare `.squad/` paths resolve against agent CWD, which can be a shared-squad consumer repo instead of the owning team root.

### Agent Prompt Reachability (2026-05-21)

Decision triggers at the top of an agent prompt define the agent's reachability tree. Logic buried deeper in the file is unreachable for any path the top trigger short-circuits. Always reach-check top-down.


### Piece 04 Path-Utils Centralization (2026-05-13)

Path-utils centralized as single source of truth for OS-aware path comparison logic. All future pieces (init fail-fast, assign, unassign, doctor) import from centralized path-utils module. Cross-case dedup test pattern established (S9b: platform-gated assertions on case-variant paths).

### Doctor Upgrade Artifact Checks (2026-05-22)

Legacy doctor check functions use `checkName(cwdOrSquadDir, optionalTestSeam?): DoctorCheck | undefined`; return `undefined` only for intentional skips such as Coding Agent-specific checks. `runDoctor` aggregates by pushing mandatory checks and conditionally pushing optional results, so skip-capable checks must be filtered before insertion. Parent-pattern coverage is string-prefix based after stripping attributes/comments: `.squad/` covers `.squad/log/**` and `.squad/log/`, but not `.squad-workstream`. Global-agent verification uses `checkGlobalAgent(homeDir?)` so tests can inject a fake home and never touch the runner's real `~/.copilot/`.

## Archive

See history-archive.md for learnings prior to 2026-05-13 (deterministic skill pattern, issue triage, economy mode governance, model catalog refresh, VS Code routing, templating, protected files, etc.).

**Patterns to remember:**
- **Deterministic skill pattern:** SCOPE section (THIS SKILL PRODUCES / THIS SKILL DOES NOT PRODUCE) + AGENT WORKFLOW section (ASK/GENERATE/WRITE/TELL/STOP with step-by-step instructions)
- **Self-contained skills:** Resources live WITH the skill, not in separate template directories. Skills bundle scripts, examples, configs in their directory
- **Spawn template 
ame parameter:** Every 	ask tool spawn MUST include 
ame set to agent's lowercase cast name (e.g., 
ame: "flight"). Without it, platform defaults to generic slugs
- **Model catalog refresh pattern:** When platform adds/removes models, UPDATE ALL sections referencing models — not just the catalog list. Search for all model name strings
- **VS Code routing enforcement:** Dispatch language must be platform-neutral ("dispatch tool" not "	ask tool"). Routing constraints should appear at top/bottom of prompt (LLM attention bias)
- **Git rebase strategy:** Use git rebase --onto dev <parent-of-first-PR-commit> to cherry-pick only relevant commits, avoiding conflict noise from accumulated merge commits
- **Copilot instructions trimming:** Extract domain-specific reference content to skills (lazy-loaded on demand). Keep main instructions as routing/workflow document

## Active Issues / Assigned Work

- **#485 (Agent Specification PRD)** → squad:flight + squad:procedures (architecture decision + formal spec structure)

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. Procedures owns Agent Specification PRD structure (#485). Architecture decisions from Flight. Coordinate on formal spec format and standard structure for future agent definitions.

📌 **Team update (2026-03-26T06:41:00Z — Crash Recovery Execution & Model Catalog Merge):** Procedures executed Round 2 PR merge action: rebased PR #619 (model catalog refresh, issue #588) onto dev branch from main, resolved 3 merge conflicts, and successfully merged. Model catalog now current: default model bumped to claude-sonnet-4.6 (latest standard-tier Claude), specialist bumped to gpt-5.3-codex (latest code-writing specialist), fallback chains restructured to include new models (gpt-5.4, gpt-5.4-mini) and removed dead models (claude-opus-4.6-fast). All 6 original merge-plan PRs (#620, #627, #624, #611, #617, #619) now ✅ complete. Dev branch green (5,038 tests). Decision inbox merged to decisions.md and deleted. Next: Ready for follow-on feature PRs.
