# Flight — Project History

> Knowledge accumulated through leading Squad development.

---

## Core Context

Three-branch model (main/dev/insiders). Apollo 13 team, 3931 tests. Boundary review heuristic: "Squad Ships It" — if Squad doesn't ship the code, it's IRL content. Proposal-first: meaningful changes need docs/proposals/ before code. Two-error lockout policy: agent locked out after 2 errors in a session. Test name-agnosticism: framework tests must never depend on dev team's agent names.

## Learnings

### Piece 08b Revision — Sims Folded Flight Nits (2026-05-14)

📌 **Flight nits folded into Sims revision as non-blocking tech debt.**

Flight's APPROVE WITH NITS identified dual resolver imports and inconsistent guard placement across consult/link/assign commands. These were architectural nits (non-blocking for 08b), but valuable for follow-up cleanup.

**Sims resolution:**
- **Dual imports:** Harmonized to single import source. `resolveSquadV2` alias in `cli-entry.ts` for namespace collision avoidance; direct import `resolveSquad` in `assign.ts` fallback for programmatic callers. Clear pattern documented.
- **Guard placement:** All three commands now use dispatch-level guards in `cli-entry.ts` as primary protection. `assign.ts` retains internal fallback guard (`opts.resolved ?? resolveSquad(...)`) for non-CLI direct API use. Consistent: dispatch is the authority for CLI invocations; internal resolution is safety net for programmatic callers.

**Pattern established:** Dispatch guards are the primary CLI protection layer. Module-internal guards are fallbacks for non-CLI code paths. Future pieces (08c+) should follow this pattern.

### Piece 06 Adversarial Review — Dispatch Coverage (2026-05-14)

Source-sniff tests can mask CLI dispatch coverage gaps; require behavioral assertions for flag handling and real child-process spawning to catch entry-point arg parsing errors.

### Resolver piece reviews require chain-precedence coverage (2026-05-13)

Piece 03 introduces five new resolver chain steps (clones, origins, platform, worktree, init-guard). Pairwise precedence tests are acceptable when the resolver is sequential (no branching between steps). A single 8-step test would be ideal documentation but is not a blocking requirement. Future resolver pieces that introduce conditional branching between steps MUST include a single comprehensive chain test.

### Resolver test coverage pattern for platform-specific behavior (2026-05-13)

When a path-comparison function uses `process.platform` directly (no platform parameter injection), tests for platform-specific branches can only run on the matching host. Any test that cannot fully execute on the current platform must do one of:
1. **Conditional real assertion**: `if (process.platform === 'win32') expect(result).toBe(true)` — not `expect(typeof result).toBe('boolean')`.
2. **Skip clearly**: `if (process.platform !== 'linux') return;` with a comment explaining why.
3. **Inject platform**: Refactor the function to accept `platform?: NodeJS.Platform` so tests can override it.

Placeholder assertions that pass trivially are worse than no test — they give false confidence.

## Archive

See `history-archive.md` for learnings prior to 2026-05-13 (crash recovery, triage sessions, release crisis, Wave 1 personal squad, adoption tracking, issue triage patterns, PR review pipeline, personal squad architecture, community PR batches, etc.).

### Piece 05 deadlock arbitration (2026-05-13)

**Context:** EECOM locked out (original author). CONTROL locked out (revision rejected by FIDO). Flight arbitrates as uninvolved third agent.

**Attribution procedure for `test/journey-error-handling.test.ts`:**

1. **Solo on piece-05 branch:** 21/21 passed (25.42s).
2. **Solo on piece-04 branch:** 21/21 passed (25.85s).
3. **Full suite on piece-04:** passed baseline (not in pre-piece-05 failed-files list).
4. **CONTROL modified test file?** No.
5. **Test touches piece-05 code?** No (tests shell rendering, not CLI dispatch).

**Root cause:** Piece 05 adds 8 new test files, increasing vitest worker pool pressure. `journey-error-handling` uses timed `tick()` waits (80ms) for React/Ink render cycles. Under heavy concurrency, timing assumptions become fragile.

**Verdict:** APPROVED. Latent race exposed by added worker load, no causal link to piece-05 logic. Classified as **accepted-concurrency-flake** (may fail non-deterministically in full-suite runs but not a blocker).

**Policy:** Recommend piece 06+: reduce `poolOptions.threads.maxThreads`, isolate timing-sensitive files with `{ sequence: { concurrent: false } }`, or increase `TICK` constants.

**Status:** Piece 05 APPROVED FOR PR. Phase B complete.

2. **Solo on piece-04 branch:** 21/21 passed (25.85s).
3. **Full suite on piece-04:** `journey-error-handling` PASSED (listed as ✔ with 21 tests in 22214ms). Piece-04 full suite had 7 other failing files (all unrelated concurrency/env flakes).
4. **CONTROL did not modify this file:** `git log 3d9b4bbb..366dd6c8 -- test/journey-error-handling.test.ts` returns empty.
5. **Test scope:** Exercises shell rendering components (App, ErrorBoundary, ShellRenderer, SessionRegistry) — SDK/shell internals, not CLI dispatch paths that piece-05 modified.

**Finding:** The test passes solo on both branches and passes in piece-04's full suite. When it fails in piece-05's full suite, it's due to increased worker pool pressure from piece-05's additional test files exercising CLI command stubs. This is a latent vitest concurrency race, not a logic regression.

**Verdict:** APPROVE piece 05. Decision matrix row 2 — latent race exposed by added worker load. Concurrency budget tracked as follow-up concern (vitest `--pool-concurrency` or test isolation). Not a piece-05 blocker.

**Final piece-05 status:** APPROVED FOR PR (Phase B complete, entering Phase C territory).
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

### Piece 02 adversarial review (2026-05-12T23:06:58-07:00)

**Verdict:** APPROVE WITH CONDITIONS (2 architectural concerns, 3 should-fix items; all decisions captured)

**Architectural concerns requiring policy decisions:**

1. **Module naming — `-v2` in permanent SDK module names** — Piece 02 introduces `resolution-v2.ts` exposed at the `./resolution-v2` subpath. The 20-piece stack has no scheduled rename. Decision: Establish team policy that permanent SDK filenames MUST NOT carry version suffixes. Defer the rename to a later piece (suggested after piece 11a) when the old `resolution.ts` is fully retired. Policy documented in decisions.md.

2. **Error model opacity** — Piece 02 originally threw `SquadError` with category `CONFIGURATION` for four distinct failure modes. Downstream CLI pieces (05+) need typed reason codes for remediation branching. Decision: Implement typed error codes on `SquadError` metadata (EMPTY_CALLSIGN, REGISTRY_MISSING, UNKNOWN_CALLSIGN, STALE_PATH). Export `ResolveErrorCode` union from SDK barrel. Implemented in remediation commit `05bd332f`.

**Should-fix items — deferred or in-flight:**

1. **Closed `source` union** — Piece 02 leaves resolver source type open (string | SourceType union). Proposal: close to specific named types in pieces 08a–c during new-SDK migration. Deferred.
2. **`matchedOrigin: string | null` permanence** — Currently `null` when origin cannot be determined. Proposal: formalize contract (when is it null? what does null mean for downstream?). Deferred to piece 03 spec clarity.
3. **Barrel co-tenancy with old `resolveSquad`** — SDK barrel exports both `resolveSquad` (piece 01) and new `resolveSquad` (piece 02). No collision today; eventual rename hides the distinction. Deferred to pieces 08a–c migration.

**Test count:** 17 → 28 (11 new tests added in remediation). All green. FIDO conditional approval gates on acceptance of architectural decisions (error model + naming policy).

### Piece 03 adversarial review (2026-05-13)

**Verdict:** APPROVE — 94 tests all green, spec-parity confirmed across all 21 test-surface bullets and all mechanism requirements. Implementation is comprehensive and correct.

**Review heuristic captured:** URL canonicalization audits benefit from verifying both directions: that distinct URL forms for the same repo canonicalize identically, AND that similar-looking URLs for different repos remain distinct. The ADO 4-form equivalence test (N.13) is the gold standard pattern.

### Piece 08b Adversarial Review — Guard Location & Resolver Consistency (2026-05-14)

📌 **Flight verdict: APPROVE WITH NITS**

When a single commit migrates multiple commands to a shared resolver pattern, guard placement must be uniform. Piece 08b mixes dispatch-level guards (`cli-entry.ts` for consult/link) with module-internal guards (`assign.ts` for assign-to-copilot). This creates an ambiguous precedent for 08c+ pieces. The spec's "outermost command boundary" rule should be enforced mechanically: if one command in the commit guards at dispatch, ALL commands must. Dual resolver imports (`resolveSquadV2` vs `resolveSquad` from different SDK paths) compound the confusion.

**Recommendation:** Harmonize resolver import path to single source and move assign's guard to dispatch level before 08c lands. Non-blocking for 08b (side-effect contract holds regardless), but tech debt to clear post-review.

**Additional findings:**

- **Finding 3 (Low):** Dead `resolved` variable at dispatch — computed for guard check but never passed to runners. If runners re-resolve independently, guard+runner can diverge on cwd/env/registry. Acceptable for this piece but weaker pattern than spec envisions.
- **Finding 4 (Nit):** `assign` short alias added. Net-new or existing? Needs documentation in command surface inventory.
- **Finding 5 (Correct):** `--status` exemption spec-compliant and tested.
- **Finding 6 (Correct):** Coordinator install coupling with best-effort escape hatch is correct scope.

**FIDO rejection:** FIDO's REJECT (4 blocking test gaps) overrides approval; Sims assigned as revision owner. Flight nits deferred to post-08b cleanup phase.

