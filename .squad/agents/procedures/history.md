# Procedures

> Standard Operating Procedures & Spec Writer

## Learnings

### Pipeline-template piece pattern: dual-platform shipping and single-writer invariants (2026-06-05)

When a piece ships pipeline automation, always ship both GitHub Actions and ADO Pipelines variants in the same piece — never defer one platform to a follow-on. The fold algorithm is platform-agnostic; only trigger syntax, token model, and checkout task syntax differ. Place both templates in a subdirectory keyed by platform (`.squad-templates/fold/github/` and `.squad-templates/fold/ado/`) rather than in a flat directory. The single-writer invariant for any canonical state branch must be (a) stated as a verbatim comment at the top of the `steps:` block in every template, (b) asserted in the test suite by scanning for the comment string, and (c) called out in the spec's Special Scrutiny section so reviewers know to enforce it. Installer commands for pipeline templates must be idempotent (content-match check before copy) and must fail fast on conflict rather than silently overwriting. The `--force-with-lease` push guard is mandatory in every fold template even when branch protection is the primary serialization mechanism — it prevents silent data loss on concurrent pipeline runs that slip through.

### Automation-layer piece pattern: manual / git hook / IDE hook layering (2026-06-05)

When a new CLI command needs automatic invocation (not just manual), structure the spec as three ordered layers: (1) manual command (always available, wired in a prior piece); (2) git hook in the relevant repo's `.git/hooks/` (primary automagic — fires on commit); (3) IDE or tool post-tool hook (backup automagic — fires when sessions end without a commit). Each layer is a distinct sub-proposal. The git hook layer requires a recursion guard test fixture that demonstrates an infinite loop would occur without the guard. The IDE hook layer requires a verify-first probe at execution time because the external hook API may not be documented in the codebase; if the API is absent, the sub-proposal ships as a gap record and stub comment, not a failed implementation. All three layers must target only the correct repo (docs-repo clone, not product repo) and all must be tested independently.

### Registry Extension Pattern (2026-06-05)

When a `RegistryEntry` interface already carries `[key: string]: unknown`, additive optional fields slot in without migration — existing entries round-trip cleanly, and downstream consumers default `undefined` values. The index signature should be preserved after named fields are added, not removed. The verify-first probe for any new regex constant (`DEVELOPER_ALIAS_RE`) must confirm whether it already exists in source (not templates) before deciding whether to create a new shared module.

### TEAM_ROOT Write Discipline (2026-05-21)

Spawn-template file writes must be anchored at TEAM_ROOT (or a derived SQUAD_DIR). Bare `.squad/` paths resolve against agent CWD, which can be a shared-squad consumer repo instead of the owning team root.

### Agent Prompt Reachability (2026-05-21)

Decision triggers at the top of an agent prompt define the agent's reachability tree. Logic buried deeper in the file is unreachable for any path the top trigger short-circuits. Always reach-check top-down.


### Piece 04 Path-Utils Centralization (2026-05-13)

Path-utils centralized as single source of truth for OS-aware path comparison logic. All future pieces (init fail-fast, assign, unassign, doctor) import from centralized path-utils module. Cross-case dedup test pattern established (S9b: platform-gated assertions on case-variant paths).

### Doctor Upgrade Artifact Checks (2026-05-22)

Legacy doctor check functions use `checkName(cwdOrSquadDir, optionalTestSeam?): DoctorCheck | undefined`; return `undefined` only for intentional skips such as Coding Agent-specific checks. `runDoctor` aggregates by pushing mandatory checks and conditionally pushing optional results, so skip-capable checks must be filtered before insertion. Parent-pattern coverage is string-prefix based after stripping attributes/comments: `.squad/` covers `.squad/log/**` and `.squad/log/`, but not `.squad-workstream`. Global-agent verification uses `checkGlobalAgent(homeDir?)` so tests can inject a fake home and never touch the runner's real `~/.copilot/`.

### Wiring-fix relocation pattern (2026-06-05)

When a wiring-fix piece (e.g., piece 31 sub-proposals A/C/D) is authored against config.json-based resolution but the topology shifts to registry-first before implementation, the fix must be relocated into a dedicated registry-aware piece rather than layered on top of the config.json path. The pattern: (1) archive the original sub-proposals as context-only in the new spec's Problem section, (2) restate each fix against the new resolution source (registry entry fields replace config.json fields), (3) keep the verify-first probes from the original piece so the implementer can confirm function existence regardless of which parent branch landed it. This pattern prevents wiring fixes from silently reverting to a code path that no longer exists in the target topology.

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
