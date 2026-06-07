# FIDO — History Archive

> Pre-2026-06-06 session records. See history.md for current work (pieces 32-34).

## Pieces 24–33 Review Cycles (2026-05-27 to 2026-06-06)

### Piece 32 Adversarial Review — Registry State Fields (2026-06-05)

Test delta: Apparent 22 regressions due to timeout contention (confirmed via isolation spot-checks). Real regressions: 0.

**Verdict:** APPROVE-WITH-NITS (no blockers).

- Full-suite 169 failed, 6458 passed (28 failed files)
- Baseline 159 failed, 6475 passed (22 failed files)
- Spot-checked 5 regression files in isolation: ALL passed
- 25 new tests GREEN; P32.V11, P32.B4 confirmed load-bearing
- Scrub gate: Gates 2–9 PASS, Gate 1 pre-existing

**Patterns learned:**
- Full-suite timeout/contention produces apparent regressions at 10–20× real failure count
- `writeRegistryFn` injectable scope gap (warm vs cold path asymmetry) — pattern to watch
- Side-effect artifacts (version stamps, init-run outputs) must be excluded from commits

**Nit-Fix Re-Verification (2026-06-05T13:53Z):**
- Amended commit `26c17667` applied 4 nits (indentation, DRY error, JSDoc, tests)
- Origin isolation: 8 files exactly (3 source, 3 test, 1 changeset, 1 package.json)
- Tests 27/27 GREEN; P32.B4 cold-start soundness independently verified
- Build: SDK clean, CLI pre-existing failures reproduced on baseline
- Scrub gate: Zero new violations
- **Verdict:** APPROVE (nit-fix amend clean, zero regressions)

### Piece 32.5 Adversarial Review — State Transport Helpers (2026-06-05T22:14Z)

**Verdict:** REJECT (critical blocker — implementation not present in source)

- `publishTeamRootToInbox`, `hydrateTeamRootFromStateRef` functions missing from sync.ts
- 8/8 tests fail with "not a function"
- Test 6 idempotency assertion vacuous (HEAD vs orphan SHA structurally impossible to match)
- `sessionId` unvalidated for git-ref legality
- Test 4 PII check trivially satisfied in test environment
- Max-valid boundary for DEVELOPER_ALIAS_RE untested

**Required before re-review:**
1. Implement missing functions
2. Fix Test 6 with real idempotency check (spy on fs writes, mtime comparison, etc.)
3. Add sessionId git-ref validation
4. Strengthen Test 4 with synthetic user-dir path
5. Add boundary test for alias max-valid (39 chars accepted, 40 rejected)

### Piece 33 Adversarial Review — Sync-from-Registry (2026-06-06T11:22Z)

**Verdict:** APPROVE (with non-blocking gaps noted)

- B2 regression guard: Observable behavior protection exists, spy-based assertion absent (non-blocker)
- Single-repo pull: hydrateTeamRootFromStateRef NOT-called assertion absent (non-blocker)
- Exit message content unasserted in D4/A4 (non-blocker)
- C2 idempotency: Weak "stable state" assertion only (minor gap)
- Coverage gaps: `direction: 'both'` untested, `SQUAD_TEAM_ROOT + pull` untested

**Implementation verified correct:**
- Registry-first resolution wired correctly
- Cross-repo push → publishTeamRootToInbox, single-repo push → syncPush
- Cross-repo pull → hydrateTeamRootFromStateRef after syncPull
- 4-step alias chain implemented
- SQUAD_TEAM_ROOT bypasses registry (confirmed A3)
- config.json demoted to fallback

**Pattern reinforced:** Observable-behavior regression guards (absence of refs on remote) provide real protection but are mode-fragile. Spy-based NOT-called assertions survive mock topology changes better.

### Piece 25 Adversarial Review (2026-05-28)

**Verdict:** APPROVE-WITH-NITS

- Resolver rename: resolveSquad → resolveSquadDir (canonical), old kept as @deprecated alias
- SDK barrel exports both; changeset SDK minor/CLI patch
- Alias contract test proves equivalence
- Build/lint/tsc gates PASS with workspace SDK
- Full vitest: parent 42 failed files, e67 15 failed files (no new failures)

**Non-blocking nits:**
- No @ts-expect-error regression proof for hypothetical DoctorSource variant
- Internal resolution.ts alias lacks typeof annotation
- Dependency hygiene pre-existing (npm ci lock skew)

**Pattern learned — dependency-mode control:**
Clean `npm install` can create nested stale `squad-sdk@0.9.4`, causing CLI tsc wrong declarations. Record clean-install failures AND workspace-linked results for gate comparison.

**Revision (185617e):** EECOM folded approved nits (N1+N2+N3); all gates clean.

### Piece 24 Adversarial Review (2026-05-27)

**Verdict:** APPROVE-WITH-NITS (3 mandatory, 2 cosmetic)

**Mandatory nits:**
- N1: Missing smoke tests (setAttribute, isRecording)
- N2: Incomplete arity coverage for _noopStartActiveSpan (3 tests per overload)
- N3: Undisclosed return-type removal (getTracer/getMeter union); Brady must sign off

**Cosmetic:**
- N4: Indent variance (12-space vs 10-space)
- N5: Chain handoff date "2025-07" → "2026-05-27"

**Revision (0325a335):** EECOM addressed N1–N5. Type widening approach restores Tracer/Meter annotations. All gates green (tsc, build, lint, 34/34 otel tests).

## Core Learning Patterns

- **Guard-order tests** must simulate downstream guards; identity mocks miss ordering failures
- **Test isolation** requires pinned environment variables across all test cases
- **Fail-fast guards** need three assertions: error contract, no filesystem mutation, registry unchanged
- **Dispatch-level tests** using vi.doMock don't exercise glue code
- **Multi-payload ordering**, hyphenated callsigns, integration wiring need explicit coverage
- **.git-anchor resolver migrations** require regression test when .squad/ exists but .git/ does not
- **Arity coverage** for multi-overload functions requires runtime tests (FIDO 100%-on-critical-paths)
- **Dependency mode control** needed for gate comparisons (clean-install vs workspace-linked)
