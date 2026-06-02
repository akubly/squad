# Procedures

> Standard Operating Procedures & Spec Writer

## Learnings

### Four-Path Working Directory Model (2026-06-02)

📌 **Adversarial Review Outcome (2026-06-02T20:51:32Z):** Piece 29 adversarial review completed by Flight, FIDO, RETRO, PAO (4 parallel reviewers). Verdict: APPROVE-WITH-NITS. Three convergent mandatory themes: (1) Explore agent spawn omits WORK_ROOT (Flight N1 + PAO N1); (2) WORK_ROOT resolution procedure undocumented at session start (Flight N2); (3) Single-repo degenerate case unaddressed (PAO N2). You are locked out per strict reviewer rejection lockout. Candidate revision authors: EECOM, Flight, or CONTROL. Decisions merged to `.squad/decisions.md`. No code changes this session.

Piece 29 replaces the single-root coordinator contract with four explicit path variables: `TEAM_ROOT` (Squad state sidecar), `TEAM_SQUAD_DIR` (`{TEAM_ROOT}/.squad`), `WORK_ROOT` (product repo), `WORK_SQUAD_DIR` (`{WORK_ROOT}/.squad`, read-only projection only). The write rules are: Scribe and directive capture write only to `TEAM_SQUAD_DIR`; non-Scribe agents must not touch `WORK_SQUAD_DIR`; product git operations (branches, PRs, builds, tests) run against `WORK_ROOT`; state publication goes via `squad sync --push` against `STATE_REMOTE`.

The five mandatory spawn-contract variables — `TEAM_ROOT`, `WORK_ROOT`, `STATE_REMOTE`, `STATE_BRANCH`, `DEVELOPER_ALIAS` — must appear in every spawn prompt with no optional omissions. Previously the template used `TEAM ROOT:` (space, not underscore) and omitted the other four; this was corrected across all spawn templates (full, lightweight, Scribe).

Pitfalls:
- **Scrub gate scans ALL tracked files, not just the diff.** Gate 1 (`git ls-files`) will fail on pre-existing strip-listed paths (Squad's own `/casting/`, `/identity/`, `orchestration-log` template directories) regardless of what the piece touches. Verify your specific changes add zero new strip-listed paths rather than expecting a clean gate run.
- **sync-templates.mjs requires direct invocation** (no `--sync` flag needed when invoked as `node scripts/sync-templates.mjs` directly — the guard only activates when the script receives non-direct arguments without flags).
- **TDD against the canonical template works cleanly**: write substring/regex assertions against `.squad-templates/squad.agent.md`, confirm red, edit canonical, run sync, confirm green across all 5 copies. The existing `template-sync.test.ts` pre-sync parity gate will catch any mirror copies not regenerated before commit.
- **Commit message with newlines + backticks**: use `create` tool to write message to file, then `git commit -F` — avoids PowerShell double-quote/backtick hazard entirely.



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

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.
