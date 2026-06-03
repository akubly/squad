# Procedures

> Standard Operating Procedures & Spec Writer

## Learnings

### Four-Path Working Directory Model (2026-06-02)

📌 **Adversarial Review Outcome (2026-06-02T20:51:32Z):** Piece 29 adversarial review completed by Flight, FIDO, RETRO, PAO (4 parallel reviewers). Verdict: APPROVE-WITH-NITS. Three convergent mandatory themes: (1) Explore agent spawn omits WORK_ROOT (Flight N1 + PAO N1); (2) WORK_ROOT resolution procedure undocumented at session start (Flight N2); (3) Single-repo degenerate case unaddressed (PAO N2). You are locked out per strict reviewer rejection lockout. Candidate revision authors: EECOM, Flight, or CONTROL. Decisions merged to `.squad/decisions.md`. No code changes this session.

📌 **Nit Revision Complete (2026-06-02T21:16:49Z):** Flight executed same-branch revision (piece-27 precedent). All 3 mandatory nits resolved: M1 (spawn pattern five-variable contract), M2 (WORK_ROOT resolution procedure), M3 (single-repo case callout). Lockout protocol honored (you remained locked throughout). Revision SHA b7ff4f99 pushed to origin. Tests: 223/223 green (+45 assertions). Scrub-gate zero new violations. Ready for downstream Phase C.

Piece 29 replaces the single-root coordinator contract with four explicit path variables: `TEAM_ROOT` (Squad state sidecar), `TEAM_SQUAD_DIR` (`{TEAM_ROOT}/.squad`), `WORK_ROOT` (product repo), `WORK_SQUAD_DIR` (`{WORK_ROOT}/.squad`, read-only projection only). The write rules are: Scribe and directive capture write only to `TEAM_SQUAD_DIR`; non-Scribe agents must not touch `WORK_SQUAD_DIR`; product git operations (branches, PRs, builds, tests) run against `WORK_ROOT`; state publication goes via `squad sync --push` against `STATE_REMOTE`.

The five mandatory spawn-contract variables — `TEAM_ROOT`, `WORK_ROOT`, `STATE_REMOTE`, `STATE_BRANCH`, `DEVELOPER_ALIAS` — must appear in every spawn prompt with no optional omissions. Previously the template used `TEAM ROOT:` (space, not underscore) and omitted the other four; this was corrected across all spawn templates (full, lightweight, Scribe).

Pitfalls:
- **Scrub gate scans ALL tracked files, not just the diff.** Gate 1 (`git ls-files`) will fail on pre-existing strip-listed paths (Squad's own `/casting/`, `/identity/`, `orchestration-log` template directories) regardless of what the piece touches. Verify your specific changes add zero new strip-listed paths rather than expecting a clean gate run.
- **sync-templates.mjs requires direct invocation** (no `--sync` flag needed when invoked as `node scripts/sync-templates.mjs` directly — the guard only activates when the script receives non-direct arguments without flags).
- **TDD against the canonical template works cleanly**: write substring/regex assertions against `.squad-templates/squad.agent.md`, confirm red, edit canonical, run sync, confirm green across all 5 copies. The existing `template-sync.test.ts` pre-sync parity gate will catch any mirror copies not regenerated before commit.
- **Commit message with newlines + backticks**: use `create` tool to write message to file, then `git commit -F` — avoids PowerShell double-quote/backtick hazard entirely.



Spawn-template file writes must be anchored at TEAM_ROOT (or a derived SQUAD_DIR). Bare `.squad/` paths resolve against agent CWD, which can be a shared-squad consumer repo instead of the owning team root.

### Phase A staging pattern for fix pieces — piece 31 (2026-06-03)

**Situation handled:** The `akubly/upstream-specs` branch had diverged from the local clone's knowledge of it. The local branch was at `e31b1b92`; the remote had `80cdcfc0` (a spec at the same path, staged by a prior session). The worktree-based staging workflow surfaced this via a non-fast-forward push rejection.

**Resolution pattern:** Reset the worktree to the remote's HEAD, inspect the remote spec for gaps against the Phase B handoff requirements, then commit only the delta as a forward-only amendment. Do not overwrite the remote spec wholesale — other sessions may have started reading it. Commit the amendment as a separate commit with a clear message distinguishing it from the original staging commit.

**Verify-first probe as mandatory spec element:** The Phase B handoff contract requires a verify-first probe block. If the pre-existing remote spec lacks it, the amendment must add it. The probe block must match the handoff exactly — do not paraphrase or summarize it.

**Acceptance criteria subsections are Phase B navigation aids:** Phase B agents triage sub-proposals before implementation. Each sub-proposal needs an explicit "Acceptance criteria" block so the agent can verify its own work without re-reading the full problem statement. If the remote spec omits these, the amendment must add them.

**Worktree cleanup:** `git worktree remove ../squad-replay-specs` succeeds cleanly after push. No stale worktree entries remain.



Fix pieces differ from feature pieces in authoring discipline:

**Tone translation:** Source findings arrive as "defects" with sev tags. The spec must reframe as "surfaces not yet reachable from the CLI" or "not yet enforced at the correct boundary." Never use "defect," "bug," "dogfood," or sev labels in spec text.

**Sub-proposal non-deferability:** When a finding is S0 (or the entire fix piece is blocked without it), the spec must state the non-deferability constraint AND the kickoff prompt must repeat it explicitly. The triage block in the prompt must name the non-deferrable sub-proposal and say "accept only, no defer/reject path."

**Verify-first probe as spec contract:** For S0 sub-proposals, encode a concrete verify-first probe (e.g., a `node -e` one-liner) that the implementer runs before writing any code. This confirms the finding is still accurate and the line numbers haven't shifted. The probe is part of the spec's value — it makes the finding falsifiable at execution time.

**Integration-level test requirement:** Unit tests that call library functions directly cannot catch CLI dispatch regressions. Fix pieces that wire library functions into CLI dispatch must require an integration-level test that goes through the exported function (e.g., `runSync`) — not the internal helper. State this constraint explicitly in each relevant sub-proposal.

**Temporary workaround archaeology:** When the implementation contains a workaround (temporary write/restore, environment override, etc.) that a fix sub-proposal supersedes, name it explicitly in the spec so the implementer knows to remove it. Otherwise it silently persists.

**Line number verification before encoding:** Always verify cited line numbers against the actual shipped code before writing the spec. Line numbers shift between session and authorship. Note any shifts in a triage note; don't carry forward stale refs.

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
