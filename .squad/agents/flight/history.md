# Flight — Project History

> Knowledge accumulated through leading Squad development.

---

## Archive

See history-archive.md for learnings prior to Piece 22 (wave 1-phase B pilots, pieces 02-21, Q1-Q2 2026).

---

## 📌 Team Updates — Recent

**2026-05-27 Piece 23 Revision Complete + Piece 24 Spec Ready:** EECOM completed piece 23 revision with all nits addressed (F1–F4 applied, F2 false-positive documented, ~+30 LOC). All gates green. Flight authored piece 24 spec + handoff (SDK adapter + OTel typing, D-6/D-8/D-9/D-16 cluster, ~51 net LOC). Risk surfaced: `_noopTracer.startActiveSpan` variadic may require eslint-disable. Decisions merged, orchestration logs prepared.

---

## Learnings

### Piece 22 Scope Decision (2026-05-22)

**Mechanical vs. enriched unification:** Chose mechanical-only scope for piece 22. The `DoctorFinding` type includes an optional `repair` field but piece 22 will NOT populate it — that's semantic enrichment for a later piece. Rationale: the dual-doctor debt has existed since piece 18 (4 pieces of compounding); the minimum viable fix is type unification + single renderer. Adding repair commands or correlated findings would triple the PR size and require new test infrastructure.

**Scope expansion decision:** Included D-4, D-7, D-12, D-15 in piece 22 because they are ≤5 LOC each, touch files already being modified, and avoid four separate PRs. Set a 200 LOC production-code ceiling as the expansion gate.

### Ship-Debt Sniff Methodology (2026-05-22)

Developed a systematic methodology for identifying technical debt across a multi-piece project:
1. Decision ledger walk (look for "deferred", "follow-up", conditional approvals)
2. Orchestration log scan (deferral keywords)
3. Literal markers (TODO/FIXME grep)
4. Escape hatches (eslint-disable, @ts-expect-error, @ts-ignore)
5. @internal audit (forced exposure vs legitimate encapsulation)
6. Duplication detection (same constant/function in 2+ files)
7. Resolver sprawl (same SDK function wrapped differently per file)
8. Silent returns (functions that return early without caller signal)

**Key finding:** 18 debt items across pieces 1–21. Severity breakdown: 8S, 7M, 3L (but 2 of the L's are "won't fix"). The dual-doctor (D-1) was the only L-severity item requiring its own proposal. Most debt is M-severity single-file refactors that cluster into "typing hygiene" (piece 23) and "OTel hardening" (piece 24) themes.

### Pattern: Ship-speed debt concentrates at integration boundaries

The highest-severity debt items (D-1, D-5, D-18) all occur where a new piece added a module that interfaces with existing code through a seam rather than by extending the existing module. This is the "parallel module" anti-pattern — it's the fastest way to ship without breaking existing tests, but compounds into resolver confusion and type fragmentation. Future pieces should flag this pattern in adversarial review.

---

## Piece 22 — Dual-Doctor Unification (2026-05-22)

**Branch:** `squad/piece-22-unify-doctors` | **LOC:** 165 diff lines (126 added + 39 removed in production src, +35 for new `doctor-types.ts`). Net production delta: ~87 LOC. Well under 200 LOC ceiling.

### Key decisions

**Architecture:** `runUnifiedDoctor` lives in `cli/commands/doctor.ts` (the legacy layer) rather than a new file. This keeps the cli-entry.ts import surface minimal — one import, one function. The registry `runDoctor` (in `commands/doctor.ts`) stays unchanged as an internal helper; its tests pass with zero modifications.

**Exit-code change:** `error → 2` (was `error → 1`). Rationale: piece 14 established `process.exit(2)` as the convention for "operation blocked by state" errors. Using 1 only for unexpected/catch-block failures. The old exit-1 on registry doctor error was inconsistent with this convention. Noted in PR description and changeset.

**Test seam:** `runUnifiedDoctor` inherits the `copilotHome` option from the registry doctor opts so tests can pass a fake home directory and avoid reading the user's real `.copilot` directory. This seam is essential — the real `.copilot` directory may contain invalid callsigns (e.g., "gethelp.app") that cause `diagnoseCopilotPayload` to throw.

**Registry finding severity:** Used batch severity (the global `RunDoctorResult.severity`) applied uniformly to all registry findings. This is "existing behavior preserved" per spec §2.2. Per-finding severities in the registry doctor would require a deeper refactor deferred to a later piece.

### Spec contradictions found

**None.** The spec migration table was accurate for all 5 TODO-marked checks. The test migration guidance in spec §5 assumed `runDoctor` would be removed; instead it's kept as a deprecated export so existing tests work without assertion changes. This is a valid deviation — removing the export would have required a large test migration with zero behavior change.

### Acceptance checklist

- [x] `DoctorFinding` type in `cli/commands/doctor-types.ts`
- [x] All 5 `TODO(piece-22)` markers removed (grep confirms zero)
- [x] `cli-entry.ts` dual-banner block replaced with single unified pass
- [x] Exit code: error → 2, else 0
- [x] `passCount` in summary line
- [x] All existing doctor tests pass
- [x] New tests: source grouping, passCount, empty-findings, error finding shape
- [x] `DoctorCheck` marked `@deprecated`
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] No new `eslint-disable` or `@ts-expect-error`
- [x] `.changeset/piece-22-unify-doctors.md` present (patch bump)

---

## 🔴 Piece 22 Adversarial Review — Doctor Unification (2026-05-22)

**Status:** 🛑 REJECTED (2 blockers)

**Commit:** `ef09d3d3` on `squad/piece-22-unify-doctors`  
**Verdict:** REJECTED — Flight locked out per strict protocol  
**Revision candidate:** CONTROL (recommended)

**Blockers:** 
1. **cli-entry.ts warn-to-stdout bug:** Spec §2.3 requires "warn → 0 (warnings to stderr)". Implementation uses `console.log` for all severities. Comment contradicts code. Fix: route `f.severity === 'warn'` to `console.error()` or `process.stderr.write()`.
2. **Missing cross-source severity escalation test:** Spec §5 mandates: "A test where system doctor produces `warn` and registry doctor produces `error` → overall exit code is 2." Core behavioral claim of unification. All 5 new tests run against a healthy scaffold (zero errors). Fix: add a test scenario mixing `warn` and `error` findings from both sources.

**Non-blocking:** list-doctor tests, native registry migration, per-finding granularity, weak pre-existing gate.

**Pattern learned:** Warn-to-stderr contracts require verifying BOTH exit code AND stream routing in the renderer. Comment intentions ≠ code. Always grep for `console.log` in severity-keyed render helpers.

**Learnings for CONTROL revision:**
- Directive 1: Exit-code derivation needs a `never`-guarded helper, not inline `.filter()`.
- Directive 2: `DoctorSource` grouping needs exhaustiveness assertion or Map-based dispatch.
- Directive 3: `DoctorFinding` fields should be `readonly` to enforce immutability of value objects.

---

## 📌 Piece 22 Revision Approved — Flight Lockout Lapsed

**Date:** 2026-05-22  
**Revision commit:** `78297559`  
**Revision author:** CONTROL  

The artifact `squad/piece-22-unify-doctors` (commit ef09d3d3) that was locked out from Flight following rejection has now been approved on CONTROL's revision (commit 78297559). Both blockers resolved:
1. warn→stderr routing fixed in `renderFinding()`
2. Cross-source escalation test added with full gate coverage

All gates green: build CLEAN, lint CLEAN, 53/53 doctor tests, 159/200 LOC budget, no .squad/ leaks. FIDO re-verdict: ✅ APPROVE. Lockout for this artifact has lapsed.

---

## Piece 23 — Shared CLI Conventions Spec + Handoff (2026-05-22)

### Item selected: D-3, D-5, D-11, D-13 (the full "typing hygiene + convention decisions" cluster)

**Spec:** `docs/proposals/piece-23-shared-cli-conventions.md`  
**Handoff:** session-state `41b7998d.../files/piece-23-shared-cli-conventions-handoff.md`  
**Expected LOC:** ~22 net production LOC (~90 gross). Well under 200 LOC ceiling.

### Why this cluster

D-3 was the clear primary pick: fragile emoji-string heuristic across 4 call sites, divergent variant in `watch/index.ts`, and a named home (`squad-file-conventions.ts`) already established by FIX-3. It compounds by making every future agent-detection feature use a tested, named function rather than an inline string check.

D-5 pairs naturally: the `resolveSquadDir` duplication is mechanically identical to the `hasCodingAgent` problem (copy-paste per-file, no shared utility). Extracting it to `cli/core/squad-resolver.ts` applies the same pattern at the resolver layer.

D-11 (qrcode types) is a 2-line removal plus a 12-line addition — trivially small, fits the "typing hygiene" theme, and removes two lint suppression comments.

D-13 (seam convention) generates a decision document with zero production LOC — it belongs in this piece because piece 24 (OTel hardening) will add injectable seams and needs the convention documented first.

### Items rejected for piece 23

- D-6, D-8, D-9, D-14, D-16 (OTel hardening + SDK adapter): SDK-internal, piece 24's scope.
- D-7, D-12: Absorbed into piece 22.
- D-10, D-17: Won't fix (intentional, documented).
- D-18 (resolveSquad v1/v2 rename): Breaking change, piece 25's scope.

### Tensions with piece 22 in-flight diff

`cli/commands/doctor.ts` is modified by both pieces: piece 22 changes check function return types; piece 23 updates one inline string check inside `checkGlobalAgent`. These are sequential edits on the same file — no conflict since piece 23 stacks on piece 22's branch. Spec §1.1 explicitly calls this out and instructs the implementer to locate `checkGlobalAgent` by function name.

`cli-entry.ts` has a local `resolveSquadDir` function (piece 23's target) AND was heavily modified by piece 22 for the unified renderer. Piece 23 only removes the local resolver function — completely orthogonal to piece 22's renderer changes.

### Discovery: economy.ts resolver is a manual walk

The audit stated economy.ts wrapped `resolveSquadV2` — it does not. It has a hand-written 10-level `FSStorageProvider` walk. Both approaches return the `.squad/` directory path (semantically equivalent), but the implementation difference is real. Spec §6 documents this as a Low-likelihood risk with a mitigation (test `runEconomy` happy path before committing).

---

## Piece 23 — Implementation (2026-05-23)

**Branch:** `squad/piece-23-shared-cli-conventions` | **Commit:** `fced6e99`

## Learnings

### Net Production LOC (Piece 23)

**~17 net production LOC.** Modified files: +26 added, -37 removed = -11. New files (squad-resolver.ts +16, qrcode-terminal.d.ts +12) = +28. Total net: +17. Well within the 200 LOC ceiling and close to the spec's ~22 estimate. 

### Economy.ts Smoke-Test Result: SEMANTIC DIVERGENCE DOCUMENTED — SAFE IN PRACTICE

The SDK resolver (`resolveSquadV2`) requires a `.git` marker to exist somewhere in the path tree. It calls `findGitRoot(cwd)` first, then checks for `.squad/` at that git root. The manual 10-level walk in `economy.ts` had no such requirement — it checked every directory for `.squad/` regardless of git presence.

**In practice: semantics matched.** All squad projects have `.git/`. The divergence only manifests in non-git temp directories (not a real usage scenario). The economy command test, which creates `.git/` + `.squad/` in a temp dir to mirror real usage, passed cleanly. The migration is safe.

**Documented divergence:** The SDK resolver is actually BETTER in two ways: (1) it handles git worktrees correctly, and (2) it won't accidentally "find" a `.squad/` directory in a parent non-squad project if the current project has a git boundary between them.

### Spec vs. Code Discrepancy: `checkGlobalAgent` vs. `checkCopilotInstructions`

The spec and problem statement said the inline `🤖 Coding Agent` check was in `checkGlobalAgent`. The actual code had it in `checkCopilotInstructions`. The handoff's instruction to "locate code by function name, not line number" was essential — the grep found the actual location. Always locate by grep, not by spec-stated function names.

### Decisions Deferred to Future Pieces

- D-18 (`resolveSquad` v1/v2 rename): Still deferred to piece 25. The SDK still exports both `resolveSquad` (v1, positional arg) and `resolveSquad as resolveSquadV2` (v2, opts object). Piece 23 added `squad-resolver.ts` which wraps v2, which is the right approach.
- OTel hardening (D-6, D-8, D-9, D-14, D-16): Deferred to piece 24.

### Tension with Piece 22 Pending Merge

Piece 23 stacks on `squad/piece-22-unify-doctors` which is pending Brady's local review. The stacking was clean — piece 23's diff on `doctor.ts` was a single line change in `checkCopilotInstructions`, orthogonal to piece 22's renderer and type unification changes. The 15 pre-existing test failures in the full suite (dispatch-help.test.ts, consult.test.ts, etc.) are all pre-existing on piece-22's branch — confirmed by stash/test/restore cycle.

---

## Piece 24 — SDK Adapter and OTel Typing Hardening (2026-05-27)

**Spec:** `docs/proposals/piece-24-sdk-adapter-otel-typing.md`  
**Handoff:** session-state `41b7998d.../files/piece-24-sdk-adapter-otel-typing-handoff.md`  
**Expected LOC:** ~51 net production LOC (~130 gross). Well under 200 LOC ceiling.

### Learnings

#### Item Selected: D-6, D-8, D-9, D-16 (SDK adapter + OTel typing cluster)

The audit grouped D-6, D-8, D-9, D-14, D-16 as "piece 24: OTel hardening + SDK adapter typing." Selected D-6, D-8, D-9, D-16 only. All four are pure typing / naming cleanup — predictable LOC, no runtime behavior change. D-8 and D-9 share the same new `otel-types.ts` file, making them nearly free to bundle after D-8 is done. D-16 is a 3-line rename that eliminates a misleading `@internal` annotation on a non-exported class.

#### Items Considered and Rejected for Piece 24

- **D-14** (span propagation, `tools/index.ts` TODO): Feature/implementation work — "implement span parenting when agent lifecycle spans are complete." Contains conditional language ("when complete") signaling an unmet prerequisite. Would require designing context propagation across the agent/tool boundary, adding new context API calls, and new test infrastructure. Potentially 100+ LOC on its own. Deferred to dedicated follow-up (24b or 25+).
- **D-18** (resolveSquad v1/v2 rename): Breaking SDK change; piece 25.
- **CONTROL N2** (source-grouping exhaustiveness): CLI-layer doctor fix, 3–5 LOC, not SDK scope. Deferred to the next CLI piece that opens `cli-entry.ts`.
- **D-10, D-17**: Won't fix — intentional, documented in the audit.

#### Key Heuristic: Feature vs. Cleanup Split Within an Audit Cluster

The audit's suggested piece groupings are not always coherent in work type. D-14 was grouped with typing debt (D-6, D-8, D-9, D-16) but is actually feature work with a conditional prerequisite. The Lead should split mixed-type clusters before authoring the spec: (a) all cleanup items go into this piece; (b) all feature/implementation items defer with explicit `prerequisite unmet` notation. Updated `ship-debt-selection/SKILL.md` with this heuristic.

#### CONTROL's N2 and Directive 2 — Not Binding for Piece 24

- **N2** (source-grouping exhaustiveness, deferred from piece 22 revision): Not piece-24-binding — no specific piece number assigned; CLI-layer concern orthogonal to SDK typing. Will be picked up in the next CLI piece that touches `cli-entry.ts`.
- **Directive 2** (resolver env seam): Explicitly filed for piece 25 in decisions.md. No conflict with piece 24's scope.

#### Tension with Piece 23 In-Flight Diff

Piece 23 (in `squad/piece-23-shared-cli-conventions`, EECOM rev pending) touches only CLI files. Piece 24 touches only SDK files (`packages/squad-sdk/src/`). Zero structural overlap. The stacking is clean; piece 24's branch should form from piece 23's tip regardless of whether EECOM's rev has landed. No spec design-around was required.
