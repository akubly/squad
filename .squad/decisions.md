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

# Decision: Piece 24 Scope — SDK Adapter and OTel Typing Hardening

**Author:** Flight (Lead)  
**Date:** 2026-05-27  
**Status:** Proposed — for Scribe to merge into `.squad/decisions.md`

---

## Chosen Audit Items

**D-6, D-8, D-9, D-16** from `docs/proposals/ship-debt-audit-pieces-1-21.md`.

| Item | Severity | Description |
|---|---|---|
| D-6 | M | Remove 4 `eslint-disable-next-line @typescript-eslint/no-explicit-any` from `adapter/client.ts`; introduce `CopilotSessionLike` interface |
| D-8 | M | Remove blanket `any` block from `runtime/otel-api.ts`; type no-op OTel shims with local interfaces |
| D-9 | S | Remove 3 inline `any` suppressions from `runtime/otel.ts`; type dynamic OTel SDK constructor variables |
| D-16 | S | Rename `AgentHandleImpl.markIdle()` → `setIdle()`; remove misleading `@internal` annotation |

**D-14 excluded:** Feature/implementation work (span propagation) with unmet prerequisite ("when agent lifecycle spans are complete"). Deferred to a follow-up piece.

## LOC Budget

**Hard ceiling:** 200 production LOC net change.  
**Estimated net:** ~51 LOC (+76 added, −25 removed).  
**Headroom:** ~149 LOC.

## Package Impacted

`@bradygaster/squad-sdk` — patch bump required. No CLI package changes.

## Owner

Open. CAPCOM is a natural fit (SDK typing experience from piece 22 revision). Any agent with SDK-layer knowledge can implement.

## Expected Start Branch

`squad/piece-23-shared-cli-conventions` (after EECOM rev lands) — or `dev` if pieces 22+23 have merged before piece 24 is picked up.

## Spec

`docs/proposals/piece-24-sdk-adapter-otel-typing.md`

## Deferred Items

- **D-14** (span propagation): dedicated follow-up piece (24b or later); prerequisite is confirmed agent lifecycle span completeness.
- **CONTROL N2** (source-grouping exhaustiveness, deferred from piece 22 revision): next CLI piece that opens `cli-entry.ts`.
- **CONTROL Directive 2** (resolver env seam): piece 25 per decisions.md.
- **D-18** (resolveSquad v1/v2 rename): piece 25.

---

