# Decisions

> Team decisions that all agents must respect. Managed by Scribe.


---

### 2026-05-22: Piece 22 — Exit Code 2 for Doctor Errors

`squad doctor` now exits with code **2** when any finding has `severity: 'error'`. Previously, the registry doctor exited with code **1** on error and the system doctor always exited **0**.

**Rationale:**
- Piece 14 established exit code 2 as "operation blocked by state" (used in `assign`, `init` conflict cases).
- Exit code 1 is reserved for unexpected errors caught by the top-level catch block.
- Doctor error findings are state-based ("callsign not in registry", ".squad/ missing") — they match the exit-2 semantic.
- The old exit-1 from registry doctor was inconsistent with the codebase-wide convention.

**Impact:**
- No CI scripts were found parsing `squad doctor` exit codes directly (doctor is a diagnostic tool, not a gate).
- Any automation that relied on `exit 1` from `squad doctor` on error should be updated to check for `exit 2`.
- The changeset entry `.changeset/piece-22-unify-doctors.md` calls this out.

---

### 2026-05-22: Piece 22 Scope + Ship-Debt Priority

**Author:** Flight (Lead)  
**Date:** 2026-05-22  
**Status:** Proposed

---

## Decision A: Piece 22 Scope — Mechanical Unification Only

**Context:** FIX-8 was deferred from piece 21 to piece 22 with TODO markers. The question is whether piece 22 should be "just" the dual-doctor unification or expand to include related debt cleanup.

**Decision:** Piece 22 is mechanical unification of the dual-doctor implementations plus four trivial co-located fixes (D-4, D-7, D-12, D-15). It does NOT include semantic enrichment (repair commands, correlated findings, new checks).

**Boundary:** ≤200 LOC production code net change (excluding tests). If the PR exceeds this, split D-15 (workflow stub deduplication) into piece 23.

**Rationale:** Piece 21's ship gate taught us that bundling "just one more fix" compounds scope. Mechanical-only means the reviewer can approve on type-correctness alone without evaluating behavioral changes.

---

## Decision B: Ship-Debt Priority Queue

| Priority | Piece # | Theme | Debt Items |
|---|---|---|---|
| 1 | 22 | Doctor unification + trivial cleanup | D-1, D-2, D-4, D-7, D-12, D-15 |
| 2 | 23 | Typing hygiene + convention decisions | D-3, D-5, D-11, D-13 |
| 3 | 24 | OTel hardening + SDK adapter typing | D-6, D-8, D-9, D-14, D-16 |
| 4 | 25 | SDK naming cleanup (breaking) | D-18 |
| — | — | Won't fix | D-10, D-17 |

**Rationale:** Priority follows dependency order. Piece 22 removes the type fragmentation that blocks 23's cross-cutting cleanup. Piece 24 is SDK-internal and can proceed independently. Piece 25 requires a deprecation strategy decision (potential major version bump).

---

## Applies To

All squad agents working on pieces 22–25. Coordinators should use this priority when routing work.

## Consequences

- Pieces 23–25 are not urgent but should be scheduled before any piece that adds NEW doctor checks or OTel instrumentation
- The "won't fix" items (D-10, D-17) should not appear in future debt audits — they are explicitly accepted

---


### 2026-05-27: EECOM — Piece 23 Rev: F2 False-Positive Call

# EECOM — Piece 23 Rev: F2 False-Positive Call

**Date:** 2026-05-27  
**Author:** EECOM (Core Dev)  
**Re:** FIDO F2 nit on `flight-piece-23-options-bag-seam.md` naming

## Decision

**Do NOT rename `flight-piece-23-options-bag-seam.md`.** FIDO's F2 finding is a false positive.

## Rationale

Two distinct naming conventions exist for `.squad/decisions/inbox/` files:

| Convention | Pattern | Who uses it |
|---|---|---|
| Coordinator-captured directives | `copilot-{brief-slug}.md` | `.copilot-instructions.md` §Decisions |
| Agent drop-box writes | `{agent}-{brief-slug}.md` | `.squad/decisions.md` spawn template |

The `.copilot-instructions.md` rule (`copilot-{brief-slug}.md`) applies when the **Coordinator** is capturing a directive into the inbox as part of its Decisions workflow. It does **not** apply when an agent writes directly to the drop-box.

`flight-piece-23-options-bag-seam.md` was authored by Flight (Lead) and deposited directly to the drop-box. The correct pattern for agent-authored files is `{agent-name}-{brief-slug}.md` — which is exactly what Flight used. This matches the spawn template convention documented in `.squad/decisions.md`.

## Guidance for Future Reviewers

Before flagging a decision file name as violating `copilot-{brief-slug}.md`:

1. Check whether the file was written by the Coordinator (`copilot-`) or by a named team agent (`{agent}-`).
2. If a named agent wrote it, the `{agent}-{brief-slug}.md` pattern is correct.
3. Only Coordinator-captured entries must use the `copilot-` prefix.

## Scope of This Entry

This entry is informational — no file rename is required. It is written to prevent the same false-positive from surfacing in future review cycles.

---

### 2026-05-27: Decision — Piece 24 Scope (SDK Adapter and OTel Typing Hardening)

**Author:** Flight (Lead)  
**Date:** 2026-05-27  
**Status:** Approved

**Chosen Audit Items:** D-6, D-8, D-9, D-16 from `docs/proposals/ship-debt-audit-pieces-1-21.md`.

| Item | Severity | Description |
|---|---|---|
| D-6 | M | Remove 4 `eslint-disable-next-line @typescript-eslint/no-explicit-any` from `adapter/client.ts`; introduce `CopilotSessionLike` interface |
| D-8 | M | Remove blanket `any` block from `runtime/otel-api.ts`; type no-op OTel shims with local interfaces |
| D-9 | S | Remove 3 inline `any` suppressions from `runtime/otel.ts`; type dynamic OTel SDK constructor variables |
| D-16 | S | Rename `AgentHandleImpl.markIdle()` → `setIdle()`; remove misleading `@internal` annotation |

**D-14 excluded:** Feature/implementation work (span propagation) deferred; prerequisite unmet.

**LOC Budget:** Hard ceiling 200; estimated ~51 LOC (+76 added, −25 removed); headroom ~149 LOC.

**Package:** `@bradygaster/squad-sdk` — patch bump. No CLI changes.

**Spec:** `docs/proposals/piece-24-sdk-adapter-otel-typing.md`

---

### 2026-05-27: CONTROL Directive — Piece 24 §2.2 `startActiveSpan` Noop Typing Revision

**Author:** CONTROL (TypeScript Engineer)  
**For:** Flight (Lead) — fold into spec revision before piece-24 implementation  
**Status:** Approved (implemented in Flight piece-24 spec revision)

**Directive:** Replace the proposed variadic generic signature for `OTelTracerLike.startActiveSpan` with three concrete overloads. Extract the noop implementation as a standalone function. Both changes: zero-suppression, ~+8 LOC over baseline.

**Key Findings:**

1. **ESLint rule `@typescript-eslint/no-explicit-any` does not exist in the config** (`eslint.config.mjs` has only 3 rules). All suppressions in `otel-api.ts` are dead code. Flight's spec framing ("acceptable single eslint-disable") gestures at a suppression that would never fire. The motivation to eliminate written `any` is correct (type-system discipline), but the "acceptable suppression" is misleading.

2. **OTel's `Tracer.startActiveSpan` has 3 concrete overloads, not variadic rest.** Flight's proposed variadic generic is an approximation with inferior type inference. The real OTel API:
   ```typescript
   startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>;
   startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>;
   startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, context: Context, fn: F): ReturnType<F>;
   ```

**Recommended Change (§2.2):**

In `OTelTracerLike`, use 3 concrete overloads. Extract the noop as a standalone function with 4 signatures (3 overloads + 1 implementation). The `typeof callback !== 'function'` guard narrows `unknown` to `Function` via TypeScript type narrowing — no written `any`, no `as`, no `!`, no `@ts-*`. Compiles cleanly under `strict: true` + `noUncheckedIndexedAccess: true`.

**LOC Delta:** ~+8 over baseline; well within 149 LOC headroom.

**Confidence:** High. Verified against `node_modules/@opentelemetry/api/build/src/trace/tracer.d.ts` and TypeScript type narrowing semantics.

---

### 2026-05-27: Flight — Piece 24 Spec Revision Complete: Ready for Implementation Kickoff

**Author:** Flight (Lead)  
**Status:** Complete, approved by Brady (CONTROL directive incorporated)

**Outcome:** Piece 24 spec (`docs/proposals/piece-24-sdk-adapter-otel-typing.md`) has been revised per CONTROL's noop-tracer typing directive. All changes merged into both spec and handoff. Design is ready for implementation kickoff; no open design questions remain.

**Changes Made:**

1. **`OTelTracerLike.startActiveSpan`** — replaced the variadic generic approximation with OTel's 3 concrete overloads, matching `@opentelemetry/api` exactly.
2. **Standalone noop function** — `_noopStartActiveSpan` is now specified as a standalone function (4 signatures: 3 overloads + 1 implementation body); TypeScript narrowing via `typeof callback !== 'function'` eliminates any need for `any`/`as`/`@ts-*`.
3. **All eslint-disable concession language removed** — the "acceptable single targeted suppression" fallback is gone from §2.2, §6 risk table, and §9 acceptance criteria.
4. **LOC envelope updated** — from ~51 net to ~59 net (+8 per CONTROL's analysis); ceiling remains 200 (141 LOC headroom).
5. **§9 acceptance criteria** — lint criterion now requires zero `eslint-disable` or `@ts-*` of any kind; new criterion added requiring zero suppression in the typed noop surface.
6. **Handoff updated** — eslint-disable exception removed from constraints, Done When checklist tightened, Prior Context section notes the spec was revised before kickoff.
7. **Revision history** — appended to spec and to `flight/history.md`.

**Risk Assessment:**

No new risks surfaced by this revision. CONTROL's directive resolves the only Medium-rated risk in the original spec (the variadic typing risk is now closed). The revised design is strictly cleaner: it matches OTel's actual API, preserves `ReturnType<F>` inference, and imposes zero lint exceptions on the implementer.

The piece remains SDK-only, patch-bump, under 200 LOC ceiling. Cluster selection (D-6/D-8/D-9/D-16, D-14 deferred) is unchanged.

**Piece 24 is ready to assign to an implementer.**

---

### 2026-05-27: Flight — Piece 24 Implementation Complete

**Author:** Flight (Copilot CLI session `41b7998d-8288-47fe-b3d3-eee538d89231`)  
**Status:** Implementation complete; commit-only (no PR) per Brady's directive

**Summary:** Piece 24 (SDK adapter + OTel typing hardening, D-6/D-8/D-9/D-16) has been implemented and committed to local branch `squad/piece-24-sdk-adapter-otel-typing`. All gates passed; PR awaits piece-23 merge to dev.

**Implementation Details:**

| Field | Value |
|-------|-------|
| Branch | `squad/piece-24-sdk-adapter-otel-typing` |
| Commit | `b1a710fd` |
| Based on | `squad/piece-23-shared-cli-conventions` |
| Net production LOC | ~114 (ceiling 200 ✅; variance explained in Flight history) |
| Debt items addressed | D-6, D-8, D-9, D-16 |
| Debt items deferred | D-14 (span propagation, prerequisite unmet) |

**Gate Results:**

| Gate | Result |
|------|--------|
| tsc --noEmit | ✅ Clean |
| npm run build | ✅ Clean |
| npm run lint | ✅ Clean |
| vitest (88 tests) | ✅ All pass |
| Zero suppressions in typed surface | ✅ Clean |

**Files Modified/Created:**
- `packages/squad-sdk/src/otel/otel-types.ts` (new)
- `packages/squad-sdk/src/otel/otel-api.ts` (3-overload noop, 0 suppressions)
- `packages/squad-sdk/src/adapter/client.ts` (`CopilotSessionLike`, 4 `any` removed)
- `packages/squad-sdk/src/...otel.ts` (constructor typing, null guards)
- Rename callsites: `markIdle → setIdle`
- Tests in same commit (test discipline)
- `.changeset/piece-24-sdk-adapter-otel-typing.md` (new)
- `.squad/agents/flight/history.md` (appended)

**Chain Handoff:** Written to `~/.copilot/session-state/41b7998d-8288-47fe-b3d3-eee538d89231/files/stack-chain-piece-21-thru-24-handoff.md`. Contains stack state table, gate results, implementation decisions, next-session PR checklist.

**Next Steps:**
1. Verify piece-23 merged to dev
2. Rebase piece-24 onto dev
3. Push + open PR
4. Changelog gate will pass (`.changeset/piece-24-sdk-adapter-otel-typing.md` present)

**Mode:** Commit-only per Brady's directive. Stack now: piece-21 → 22 → 23 → 24, all on local branches awaiting Brady's merge cascade.

---

