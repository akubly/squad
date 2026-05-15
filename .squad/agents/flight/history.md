# Flight — Project History

> Knowledge accumulated through leading Squad development.

---

## Core Context

Three-branch model (main/dev/insiders). Apollo 13 team, 3931 tests. Boundary review heuristic: "Squad Ships It" — if Squad doesn't ship the code, it's IRL content. Proposal-first: meaningful changes need docs/proposals/ before code. Two-error lockout policy: agent locked out after 2 errors in a session. Test name-agnosticism: framework tests must never depend on dev team's agent names.

## Learnings

### Piece 08c Review — APPROVE (2026-05-14)

📌 **VOX lifecycle command migration approved without blockers.**

VOX's 08c implementation correctly threads `resolvedForStart.path` / `resolvedForRc.path` as `squadDir: string` into runners, defers dynamic imports until after the guard, and separates process CWD from squad metadata path. Two minor findings deferred: (1) resolver throws propagate to top-level handler instead of local `fatal()` — consistent with 08b but produces raw stack trace on non-SquadError; (2) no `start throws` dispatch test (only null test exists, throw test exists only for rc). Neither blocks Phase C.

**Pattern confirmed:** For runners that only need the resolved path (not callsign or registry metadata), threading `squadDir: string` is acceptable. Full-struct threading (`resolved: guardResult`) reserved for runners needing richer resolver context (e.g., assign).

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

### Piece 05 Deadlock Arbitration (2026-05-13)
EECOM + CONTROL locked out. Flight arbitrated: latent vitest concurrency race from added worker load (not logic regression). Root cause: `journey-error-handling` timing-sensitive under pool pressure. Verdict: APPROVE piece 05 for PR. Concurrency optimization deferred.

### Piece 02 Adversarial Review (2026-05-12)
APPROVE WITH CONDITIONS. Established SDK naming policy (no `-v2` in permanent names; rename post-piece-11a) and error model (typed ResolveErrorCode for downstream CLI branching). 17 → 28 tests, all green.

### Piece 03 Adversarial Review (2026-05-13)
APPROVE. 94 tests GREEN, spec-parity confirmed across all 21 test-surface bullets. Heuristic: URL canonicalization audits verify both directions (distinct forms → same, similar → distinct).

### Piece 06 Adversarial Review — Dispatch Coverage (2026-05-14)
Source-sniff tests can mask CLI dispatch gaps; require behavioral assertions for flag handling and real child-process spawning to catch entry-point arg parsing errors.

### Piece 08b Adversarial Review — Guard Location & Resolver Consistency (2026-05-14)
📌 **Flight verdict: APPROVE WITH NITS**

Piece 08b mixes dispatch-level guards (consult/link) with module-internal (assign), creating ambiguous precedent. Pattern: if one command guards at dispatch, ALL must. Dual resolver imports compound confusion. **Non-blocking nits:** reconcile resolver import path and move assign guard to dispatch level before 08c. FIDO REJECT (test gaps) overrides; Sims assigned revision owner.

