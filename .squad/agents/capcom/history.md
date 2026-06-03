# CAPCOM — History

> Knowledge base for the SDK Expert. Append-only, union-merged across branches.

## Summary

This history tracks SDK architecture review, contract validation, and cross-repo patterns for pieces 19–30 and Phase B foundational work. Key learnings: template-only pieces need behavioral test assertions for CLI command existence and trigger-repo alignment; fold pipeline pattern requires set-membership for idempotent enumeration, not timestamp comparison; canonical callsign validation must be shared through SDK barrel, not copied inline.

For historical archive (Phase A, pieces 1–18): see `.squad/agents/capcom/history-archive.md`.

## Recent Team Updates

📌 **Team update (2026-06-02 — Piece 30 Revision-3 Review):** CAPCOM reviewed EECOM's revision (commit 3c6c9edf). Verdict: APPROVE-WITH-NITS. M_NEW_1 fully resolved. Prior N2 (sort tie-breaker) also resolved as a side-effect. Prior N1 (foldCommit wrong SHA) and N3 (prune-all-refs scope) persist as non-blocking carry-forward; not re-escalated. Zero new mandatory findings. See `.squad/reviews/piece-30-revision3-capcom.md`.

📌 **Team update (2026-06-03 — Piece 30 Follow-On Revision):** Piece-30 follow-on findings addressed in commit 3c6c9edf by EECOM. M_NEW_1 (fold timestamp→ref-membership) fixed; ref-name membership now checks `.[].inboxRef` in publish-history.json, eliminating drop-on-tie defect.

📌 **Team update (2026-06-02 — Piece 30 Revision Follow-On Review):** CAPCOM participated in 3-reviewer follow-on adversarial review of Booster's revision (commit a9da5453). Verdict: REJECT. 1 new mandatory finding: inline fold script uses timestamp-based skip logic that silently drops inbox refs on clock skew or same-second ties — fix requires ref-name membership check against publish-history.json instead of timestamp comparison. Prior M1 + M2 fully RESOLVED. 3 new non-blocking findings noted.

📌 **Team update (2026-06-03 — Piece 30 Revision, commit a9da5453):** Booster (revision implementer) addressed all 9 mandatory findings from 5-reviewer panel, including CAPCOM's 2 findings on missing `squad fold` CLI and unreachable publish trigger. Both fixed: fold logic inlined (150-line bash+jq) in fold-squad-state.yml, publish trigger corrected (removed erroneous `include:` clause). 196 tests pass; scrub Gate 1 pre-existing baseline; ready for merge.

📌 **Team update (2026-06-02T22:35:00Z — Piece 30 Adversarial Review):** CAPCOM conducted architecture-focused adversarial review of piece 30 ADO templates (commit 10168051); verdict: REJECT. Identified 2 mandatory findings: (1) `squad fold` CLI command missing — fold pipeline non-functional at runtime, (2) `publish-inbox.yml` trigger unreachable in product repo (inbox branches created in TEAM_ROOT, not WORK_ROOT). Additional 3 non-blocking observations on variable documentation and parameterization. Consolidated to REJECT verdict by Flight due to convergent mandatory findings across 5 reviewers.

## Learnings — Phase B (Pieces 19–30)

### Piece 30: Cross-Repo Pipeline Patterns (2026-06-02+)

**Timestamp-based skip logic is a data loss bug.** The inline fold script reads `LAST_PUBLISHED_AT = jq '.[-1].publishedAt'` from publish-history.json and skips any inbox ref whose publishedAt is ≤ that value. This is fragile: developer machine clock skew causes a ref with an older timestamp to be permanently skipped even though it was never folded; same-second ties get silently dropped. The correct fix is set-membership by `inboxRef` name in history, not timestamp comparison.

**Fold pipeline pattern learned:** When implementing idempotent enumeration over a set of refs, the skip predicate must use a stable, unique identifier for each item (ref name, commit SHA) — never a shared mutable scalar like a timestamp. Timestamps are correct for sort ORDER, but wrong for skip MEMBERSHIP.

**`foldCommit` field naming trap:** The history entry's `foldCommit` field should store the commit SHA produced on `squad-state` (captured after `git commit`), not the source inbox ref's commit SHA (captured before). Always capture `git rev-parse HEAD` AFTER the fold commit to get the correct fold provenance.

**Template-only pieces need command-existence assertions.** Pipeline templates that call `squad <command>` must be validated against the actual registered command set in `cli-entry.ts`. `squad fold` did not exist; template behavioral tests do not catch missing-command defects. Pattern: add an assertion verifying each CLI command the pipeline calls is registered in cli-entry.ts.

**CI trigger/repo mismatch is a common template defect.** In a cross-repo architecture, each pipeline template must trigger on branches in the repo where the pipeline YAML lives. Inbox branches live in TEAM_ROOT; the publish pipeline lives in WORK_ROOT. Using `include: squad/inbox/**` in the product repo pipeline means the trigger can never fire. When reviewing cross-repo pipeline templates, trace: (a) which repo hosts the pipeline, (b) which repo receives the branch pushes that should trigger it, (c) whether those repos match.

### Piece 19: SDK Contract Error Handling

CAPCOM completed two-round adversarial cycle for piece 19 (Copilot payload). Round 1: Identified 3 blocking SDK contract issues (`CopilotPayloadError` surface leak, symlink vulnerability, missing callsign guard). Round 2: Wrapped error surface in both paths, demoted `rewriteFrontmatterName` to internal API, added all 3 FIDO test gaps, verified 143/143 tests pass. Final: single amended commit `2377c3a8`, build CLEAN. ✅ Ship approved. EECOM locked out per Reviewer Rejection Protocol — GNC + CAPCOM (Round 2) owned revision.

### Canonical Callsign Validation Convergence (2026-05-21)

When the same validation rule spans SDK reader paths, payload namespace code, and CLI maintenance commands, extract a shared helper in the SDK and make downstream packages import it through the barrel instead of copying regexes inline. The specific smell to watch for is writer/reader/doctor triple-divergence: once those three paths disagree, users get inconsistent acceptance rules and tests stop guarding the real contract.

**Context:** User reported "Request failed due to a transient API error" on Ubuntu WSL with Copilot CLI v1.0.4, eventually hitting rate limits.

**Investigation findings:**
- Squad SDK already implements robust retry logic with exponential backoff (1s → 2s → 4s)
- Retry logic in `adapter/client.ts:820-880` handles transient connection errors (ECONNREFUSED, ECONNRESET, EPIPE)
- Rate limit detection in `adapter/errors.ts:229-245` with retry-after awareness
- Error originates **upstream** from Copilot CLI/API platform, not Squad
- Copilot CLI v1.0.4 internal retry behavior triggers the rate limiting before Squad is invoked
- Squad only interacts with CLI via `@github/copilot-sdk` adapter after CLI is already running

**Key insight:** Squad SDK does NOT contribute to transient API errors or rate limiting issues. Our retry logic follows platform patterns and only applies to SDK connection errors, not upstream API instability.

**Outcome:**
- Confirmed this is an upstream platform issue (not a Squad bug)
- Recommended user check network connectivity, WSL configuration, and GitHub auth
- Created decision in `.squad/decisions/inbox/capcom-wsl-transient.md`
- Suggested documentation improvement: add WSL troubleshooting guide

**Pattern learned:** When investigating API errors, distinguish between:
1. **SDK adapter layer** (our retry logic) — handles connection errors only
2. **Copilot CLI layer** (upstream) — handles API communication and its own retries
3. **Copilot API platform** (upstream) — source of transient errors and rate limits

Squad operates at layer #1, so issues at layers #2-3 are outside our control.
## Core Context

- **Project:** Squad — AI agent orchestration framework
- **Role:** SDK Expert
- **Joined:** 2025-01-25

## Learnings

### 2025-01-25: SDK Init Implementation Deep Dive

Completed deep technical analysis of `squad init --sdk` code paths. Key findings:

**CastingEngine is orphaned** — The SDK has a full universe-based casting system (`packages/squad-sdk/src/casting/casting-engine.ts`) with themed characters (The Usual Suspects, Ocean's Eleven), personality traits, backstories, and role-matching algorithms. **But no code calls it.** The CLI bypasses it with a hardcoded `personalityForRole()` function that generates generic personalities based on role patterns.

**Config/team sync is one-way** — The REPL init flow generates team.md, routing.md, and registry.json when casting a team, but never updates squad.config.ts. Meanwhile, `squad init --sdk` generates squad.config.ts with only Scribe, missing Ralph and all other agents. The disconnect: CLI init writes a skeleton + prompt, REPL auto-cast generates the team, but the two paths never merge into a unified config.

**Built-in agents are inconsistent** — Ralph is added by the REPL casting flow (`cli/core/cast.ts:385-386`) but not by SDK init (`cli/core/init.ts:109-115`). @copilot is a pseudo-agent — a Markdown table row inserted via `team-md.ts:insertCopilotSection()`, not a real agent with charter/history files.

**Universe selection is a dead end** — The coordinator init prompt asks the LLM to pick a universe (line 52: "Pick a fictional universe for character names"), and the coordinator responds with `UNIVERSE: Alien`, which gets stored in `casting/history.json`... and then **nothing uses it**. There's no mapping from freeform universe names to CastingEngine templates.

**The fix path is clear** — Three priority levels:
- **P0 (trivial):** Add Ralph to SDK init agents array, guide coordinator to existing CastingEngine universes
- **P1 (small/medium):** Integrate CastingEngine into CLI casting, make REPL init write squad.config.ts
- **P2 (design-heavy):** Decide config sync strategy (config-as-source vs. bidirectional), decide if @copilot should be a real agent

Written full technical analysis to `.squad/identity/sdk-init-technical-analysis.md` with file/line references, complexity estimates, and actionable recommendations for Brady's PRD.

**SDK patterns observed:**
- `defineSquad()` / `defineAgent()` builder pattern is clean and works well
- `configFormat` enum supports 'sdk' | 'typescript' | 'json' | 'markdown' — flexible but undertested
- Init flow is two-phase (CLI writes skeleton, REPL auto-casts) — intentional design but creates sync issues
- Template system in SDK (`templates/` directory) is well-structured, used correctly by `initSquad()`

📌 **Team update (2026-03-11T01:25:00Z):** 5 SDK Init decisions merged to decisions.md: Phase-based quality improvement (3-phase approach), CastingEngine canonical casting, squad.config.ts as source of truth, Ralph always-included, implementation priority order. Full technical analysis informed Flight's unified PRD and EECOM's roadmap.

📌 **Team update (2026-03-25T18:11Z):** CLI platform research complete — identified Copilot CLI 1.0.5–1.0.11 (8 releases in 10 days) contain three high-impact changes affecting Squad routing: monorepo instruction discovery (1.0.11), idle subagent hiding (1.0.8), subagentStart hook context injection (1.0.7). SDK version pinning doesn't prevent CLI runtime auto-updates. Recommendations: clean up template naming, upgrade to SDK 0.2.0 customize mode, file CLI issue. Report in decisions inbox.

📌 **Team update (2026-05-13T18:28:28Z — Piece 04 Adversarial Review Complete):** Piece 04 (path-utils-upsert-rename) approved after revision cycle. Deferred architectural findings for piece 05+: spurious @bradygaster/squad-cli changeset bump, normalisedPathKey re-export scope creep on resolution-v2.ts (registry primitive on resolver surface), wrapper-style registerEntry alias drift risk, @deprecated tag missing removal timeline. See `.squad/decisions.md` "### 2026-05-13: CAPCOM Review" for full action items. Future pieces that re-export SDK primitives should apply same scope discipline.

### 2026-05-14T14:38:40.349-07:00: Piece 08a revision — SDK boundary and resolver parity

Revised the read-only resolver migration under reviewer rejection lockout as CAPCOM. The revision kept SDK access through the root barrel by adding an overload-compatible registry-aware `resolveSquad` wrapper in `packages/squad-sdk/src/index.ts`, then rerouted `packages/squad-cli/src/cli-entry.ts`, `packages/squad-cli/src/cli/commands/config.ts`, and `packages/squad-cli/src/cli/commands/cross-squad.ts` away from SDK subpaths.

The revision unified `discover` and `delegate` on v2 resolution, threaded `--team-root` / `SQUAD_TEAM_ROOT` into cross-squad discovery, and strengthened `test/cli/legacy-resolver-migration.test.ts` to cover SDK barrel import, override parity, delegate resolution, and the action-command boundary. `.changeset/migrate-readonly-commands.md` now records both CLI and SDK patch impact.

**Revision complete:** Commit 0e4f301e. Logged to `.squad/orchestration-log/2026-05-14T21-38-40Z-capcom.md`. Full suite 6,308/6,432 PASS; build clean; scrub gates 2/4/5/6 PASS. CONTROL locked out for further 08a revisions unless re-rejection cycle restarts.

### 2026-05-21: Canonical callsign validation convergence

When the same validation rule spans SDK reader paths, payload namespace code, and CLI maintenance commands, extract a shared helper in the SDK and make downstream packages import it through the barrel instead of copying regexes inline.

The specific smell to watch for is writer/reader/doctor triple-divergence: once those three paths disagree, users get inconsistent acceptance rules and tests stop guarding the real contract.


---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

### 2026-06-02: Piece 30 Adversarial Review (Architecture/Contract angle)

**Verdict:** REJECT — 2 mandatory, 3 non-blocking.

**M1 — Missing CLI command:** Pipeline templates that call `squad <command>` must be validated against the actual registered command set in `cli-entry.ts`. `squad fold` does not exist. The SDK exports functions that future fold logic can consume (e.g., `publishTeamRootToInbox`, `hydrateTeamRootFromStateRef` in sync.ts) but the CLI entry point never registers the command. Template behavioral tests (YAML parse, structural assertions) do not catch this — a command-existence check must be added to the test surface when shipping pipeline templates. Pattern: add an assertion that verifies each CLI command the pipeline calls is registered in cli-entry.ts.

**M2 — CI trigger/repo mismatch:** In a cross-repo architecture, each pipeline template must trigger on branches in the repo where the pipeline YAML lives. Inbox branches (`squad/inbox/**`) live in TEAM_ROOT (docs/specs repo); the publish pipeline lives in WORK_ROOT (product repo). Using `include: squad/inbox/**` in the product repo pipeline means the trigger can never fire. When reviewing cross-repo pipeline templates, always trace: (a) which repo hosts the pipeline, (b) which repo receives the branch pushes that should trigger it, and (c) whether those repos match. If they don't, the trigger is dead.

**General pattern:** Template-only pieces (no `packages/*/src/` changes) skip the changeset gate and the build gate, which means the only verification is test assertions. Behavioral tests for pipeline templates must cover not just YAML structure but also CLI command existence and trigger-repo alignment.

**Sync mirror story confirmed sound:** `sync-templates.mjs` `collectFiles()` recurses into subdirectories correctly. The `ado/` subdirectory mirror story required no script changes and produced byte-for-byte mirror parity at all three mirror targets. This is a stable pattern for future subdirectory additions under `.squad-templates/`.

**Pipeline variable documentation debt:** ADO pipeline templates that reference `$(variable)` expressions not in the `variables:` block should include a comment block listing all required external variables. Without this, teams get silent substitution with empty strings in ADO, which surfaces as confusing runtime errors rather than clear "variable not set" messages. This is a template authoring convention to enforce for all future ADO templates.

## Learnings — Piece 30 Revision-3 (EECOM's ref-membership pattern)

**Ref-membership pattern is correct and sufficient.** EECOM's `jq -r '.[].inboxRef // empty'` extraction followed by `grep -qxF "$REF"` membership guard is the right approach for idempotent fold enumeration. Key properties that make it correct: (1) `%(refname:short)` produces `origin/squad/inbox/<alias>/<session>` at both write time (when the fold records `inboxRef`) and read time (when `ALL_REFS` is populated), so the same string is compared in both directions; (2) `grep -qxF` requires a full-line exact match, preventing partial-path false positives; (3) the `[ -n "$FOLDED_REFS" ]` guard before the grep call handles the empty-set case without spawning a grep process over an empty string.

**`jq empty` as a malformed-JSON guard is the right validator.** `jq empty` exits non-zero for invalid JSON and produces no output for valid JSON. Running it before the extraction query (rather than combining them) is cleaner: the guard step is explicit and its intent is legible. Future fold-logic revisions should preserve this two-step pattern: validate first, extract second.

**The sort-key column-count must track the field count.** Booster's original used a two-field key and `cut -f2`; EECOM's addition of a third field (developerAlias) required updating to `cut -f3`. When adding fields to a tab-separated sort key, always update the `cut -f` index. This is a latent correctness trap in bash pipeline templates — the mismatch produces wrong results silently (it cuts the wrong field, not an error).

**`|| true` on membership extraction after a validated file is safe but noisy.** After `jq empty` succeeds (file is valid JSON), a `|| true` on the extraction line is defensive but misleading — it implies the extraction can fail in ways the validation doesn't catch. In practice it cannot for well-formed JSON. Acceptable as defense-in-depth (extraction failure → empty FOLDED_REFS → fold everything, which is the safe-side default), but reviewers should note the intent.

**foldCommit field naming remains unresolved (carry-forward).** The history entry's `foldCommit` field captures `git rev-parse "$REF"` (inbox commit SHA) rather than `git rev-parse HEAD` after the fold commit (squad-state commit SHA). This makes fold provenance tracing harder. The fix — capture HEAD after commit — is trivial. Should be addressed in a future cleanup piece before publish-history.json accumulates many entries with the wrong SHA type.
