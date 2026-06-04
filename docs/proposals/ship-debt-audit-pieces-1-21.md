# Ship-Debt Audit: Pieces 1–21

**Author:** Flight (Lead)  
**Date:** 2026-05-22  
**Status:** Complete  
**Method:** Decision ledger walk + orchestration log review + codebase grep (TODO/FIXME/eslint-disable/@ts-expect-error/@ts-ignore) + commit history cross-check

---

## Debt Table

| Debt # | Piece(s) | Signal | Symptom | Severity | Recommended Remedy | Suggested Piece # |
|---|---|---|---|---|---|---|
| D-1 | 18 | Parallel module instead of refactoring | Two independent doctor implementations with incompatible result types (`DoctorCheck` vs `RunDoctorResult`); sequential calls in `cli-entry.ts:1052–1086` | **L** | Unify via `DoctorFinding` type (see piece-22 proposal) | **22** |
| D-2 | 21 (FIX-3/FIX-9) | TODO markers as debt IOU | Five `// TODO(piece-22): merge into unified doctor` markers at `cli/commands/doctor.ts:291,319,347,384,401` | **S** | Remove markers as part of piece-22 unification | **22** |
| D-3 | 18+ | Heuristic string check instead of structured config | `teamContent.includes('🤖 Coding Agent')` used as detection heuristic (`cli/commands/doctor.ts:390`, `cli/core/team-md.ts:37`, `cli/core/upgrade.ts:709`, `cli/commands/watch/index.ts:765`) — fragile if emoji or label changes | **M** | Extract `hasCodingAgent(content: string): boolean` to `squad-file-conventions.ts` with constant + regex; add team.md schema field in future | **23** |
| D-4 | 21 (FIX-3) | Constants extracted only when forced | `GITATTRIBUTES_RULES` and `GITIGNORE_ENTRIES` extracted to `cli/core/squad-file-conventions.ts` (FIX-3). Other convention constants remain inline: `PROJECT_TYPE_SENSITIVE_WORKFLOWS` is duplicated between `cli/core/upgrade.ts:141` and `cli/core/workflows.ts:8` | **S** | Deduplicate `PROJECT_TYPE_SENSITIVE_WORKFLOWS` — export from `workflows.ts`, import in `upgrade.ts` | **22** (trivial, no type change) |
| D-5 | 14 | Dual resolver import confusion | `cli-entry.ts:93` imports `resolveSquad as resolveSquadV2` from SDK; multiple command files (`config.ts:15`, `cross-squad.ts:16`, `economy.ts:18`) independently wrap it in local `resolveSquadDir()` helpers. No shared utility. | **M** | Extract `resolveSquadDir(cwd)` as a shared utility in `cli/core/`; replace per-file wrappers | **23** |
| D-6 | 12 | `eslint-disable` escape hatches in adapter layer | `adapter/client.ts` has 4× `eslint-disable-next-line @typescript-eslint/no-explicit-any` (lines 66, 70, 101, 112) wrapping the untyped Copilot SDK session object | **M** | Type the Copilot SDK session with a minimal interface (`CopilotSessionLike`) and remove `any` casts | **24** |
| D-7 | ~8 | `eslint-disable` in resolution module | `resolution.ts:118,174` — `eslint-disable-next-line no-constant-condition` for intentional `while(true)` loops | **S** | Replace with `for (;;)` idiom (no lint suppression needed) or add `.eslintrc` exception for this pattern | **22** (trivial) |
| D-8 | — (SDK runtime) | Wholesale `eslint-disable` block | `runtime/otel-api.ts:30` — blanket `/* eslint-disable @typescript-eslint/no-explicit-any */` covering entire file (90+ lines) | **M** | Type the OpenTelemetry no-op shims properly; the `any` surface is bounded and can be typed with generics | **24** |
| D-9 | — (SDK runtime) | Multiple `any` in otel initialization | `runtime/otel.ts:46,75,76` — `any` for dynamic imports of OTel SDK classes | **S** | Type with `typeof import(...)` patterns or add a `otel-imports.d.ts` | **24** |
| D-10 | — | `@ts-expect-error` in cli-entry.ts bootstrap | `cli-entry.ts:17` — narrowing `process.emit` signature for warning suppression | **S** | Acceptable technical debt; the monkeypatch is documented and intentional. Leave as-is with comment. | — (won't fix) |
| D-11 | — | `@ts-ignore` for optional dependencies | `cli/commands/rc.ts:264` and `cli/commands/start.ts:141` — `qrcode-terminal` optional dep | **S** | Add `qrcode-terminal.d.ts` ambient declaration or `import type` guard | **23** |
| D-12 | 14 | `@internal` export for name-collision avoidance | `commands/doctor.ts:19` imports `validateEntry` from `@bradygaster/squad-sdk/registry`; `registry.ts:71` marks it `@internal` — exposed specifically because the registry doctor needed per-entry validation that `parseRegistry` doesn't surface | **S** | Promote to public API with JSDoc (it IS the public API de facto) or add a `diagnoseEntry()` wrapper | **22** |
| D-13 | 21 (FIX-2) | Ad-hoc test seam | `copilotPayloadInstaller` seam in `cli/core/upgrade.ts:47,69` — injectable override for testing. Compare to FIX-1's SDK-level `getGitRoot`/`getRemoteUrls` seams in `assign.ts:270–273` and `unassign.ts:47`. Three different injection patterns across three files. | **M** | Establish a single injection convention: either options-bag seams (current dominant pattern) or a DI container. Document in decisions.md. | **23** |
| D-14 | — (SDK) | Deferred span propagation | `tools/index.ts:129` — `// TODO: Parent span context propagation — tool spans should be children of agent.work spans` | **M** | Implement span parenting when agent lifecycle spans are complete | **24** (OTel hardening piece) |
| D-15 | 21 (FIX-9) | Workflow stub duplication | `cli/core/upgrade.ts:152` and `cli/core/workflows.ts:19` both define `generateProjectWorkflowStub` with identical logic. `upgrade.ts` has its own copy of `PROJECT_TYPE_SENSITIVE_WORKFLOWS` (line 141) duplicating `workflows.ts:8` | **M** | `upgrade.ts` should import from `workflows.ts` instead of re-implementing. Blocked until both files are confirmed to have the same signature (they do — verified). | **22** |
| D-16 | 12 | `@internal` on lifecycle method | `agents/lifecycle.ts:438` — `markIdle()` is `@internal` but is the only way the lifecycle manager communicates state; no public equivalent | **S** | Rename to public `setIdle()` or document the lifecycle manager pattern | **24** |
| D-17 | — | `@internal` on copilot-payload helper | `copilot-payload.ts:567` — `_rewriteFrontmatterName` marked internal, exposed only for unit testing | **S** | Acceptable; test-only exposure via subpath. Leave as-is. | — (won't fix) |
| D-18 | ~8 | Legacy `resolveSquad` (v1) still exported | SDK exports both `resolveSquad` (v1, simple path walk) at `resolution.ts:115` and the new `resolveSquad` (v2, registry-aware) — consumers must alias (`resolveSquadV2`) to avoid collision | **M** | Rename v1 to `resolveSquadDir` (its actual semantic), deprecate the old name. Requires SDK major or deprecation period. | **25** |

---

## Signal Categories Summary

| Signal Pattern | Count | Debt #s |
|---|---|---|
| Parallel module instead of refactoring | 1 | D-1 |
| TODO/FIXME markers as explicit debt | 3 | D-2, D-14, D-15 |
| Heuristic check instead of structured config | 1 | D-3 |
| `eslint-disable` / `@ts-expect-error` escape hatches | 5 | D-7, D-8, D-9, D-10, D-11 |
| `@internal` exports (collision avoidance or test-only) | 3 | D-12, D-16, D-17 |
| Inconsistent test seam patterns | 1 | D-13 |
| Duplicated constants/logic | 2 | D-4, D-15 |
| Naming collision / dual-export confusion | 1 | D-18 |

---

## Piece 22+ Roadmap

### What naturally belongs in Piece 22 (mechanical, no new semantics)

| Debt # | Rationale for inclusion |
|---|---|
| D-1 | Primary purpose of piece 22 |
| D-2 | TODO markers removed as part of D-1 |
| D-4 | One-line import change; same file family as D-1 |
| D-7 | Two-line fix in resolution.ts; zero risk |
| D-12 | JSDoc change only; touched by doctor unification |
| D-15 | Same file (`upgrade.ts`) already being modified for doctor changes |

### What needs its own piece

| Debt # | Suggested Piece | Rationale |
|---|---|---|
| D-3 | 23 | Cross-cutting (4 files); needs new constant + convention decision |
| D-5 | 23 | Cross-cutting (5+ files); straightforward but scope-creep risk if bundled with 22 |
| D-11 | 23 | Type declaration addition; pairs with D-3 as "typing hygiene" batch |
| D-13 | 23 | Convention decision + documentation; no code change required immediately |
| D-6 | 24 | SDK adapter layer; unrelated to CLI doctor |
| D-8 | 24 | SDK runtime layer; pair with D-9 and D-14 as "OTel typing hardening" |
| D-9 | 24 | Pairs with D-8 |
| D-14 | 24 | OTel span propagation; requires lifecycle work |
| D-16 | 24 | SDK lifecycle; pairs with D-14 |
| D-18 | 25 | Breaking rename; needs deprecation strategy |
| D-10 | — | Won't fix; documented intentional |
| D-17 | — | Won't fix; acceptable test exposure |

---

## Should Piece 22 Absorb Related Debt?

### Argument FOR expanding scope (include D-4, D-7, D-12, D-15)

- All four are **trivially small** (≤5 LOC each)
- D-4 and D-15 touch `upgrade.ts` which piece 22 already modifies (reducing future merge conflicts)
- D-7 and D-12 are in files the reviewer will already be reading
- Combined overhead: ~20 LOC additional, zero new test files needed
- Keeps piece 22 as "the cleanup piece" — cleaner narrative

### Argument AGAINST expanding scope

- Piece 22 proposal says "mechanical unification only" — scope creep sets a bad precedent
- Each additional change needs test verification
- If any of D-4/D-7/D-12/D-15 introduces a regression, it's harder to bisect which change caused it
- The "minimum viable PR" principle from piece 21's ship gate experience argues for tight scope

### Flight's Decision

**Include D-4, D-7, D-12, D-15 in piece 22.** Rationale: all four are mechanical, none introduce new types or change behavior, and bundling them avoids four separate PRs for one-line changes. The piece 22 PR stays under 200 LOC net change (excluding test updates). If it exceeds 200 LOC production code, split D-15 out.

---

## Methodology: Ship-Debt Sniff

The audit used these signal detectors:

1. **Decision ledger walk** — Read `.squad/decisions.md` for "deferred to" language and conditional approvals
2. **Orchestration log scan** — Look for "deferral", "won't fix", "follow-up" keywords
3. **Literal debt markers** — `grep -rn 'TODO\|FIXME'` under `packages/*/src`
4. **Escape hatches** — `grep -rn 'eslint-disable\|@ts-expect-error\|@ts-ignore'`
5. **`@internal` audit** — Every `@internal` export is either (a) legitimate encapsulation or (b) a smell of forced exposure due to design gap
6. **Duplication detection** — Same constant/function defined in 2+ files
7. **Resolver sprawl** — Same SDK function wrapped with different local names across files
8. **Silent returns** — Functions that return early without signaling to the caller

This methodology is generalizable to any multi-piece project. Extracted as a reusable skill.

---

## References

- Decision ledger: `.squad/decisions.md`
- Orchestration logs: `.squad/orchestration-log/2026-05-21T17-10-56Z-flight.md`, `20260522T210632Z-flight.md`
- Legacy doctor source: `packages/squad-cli/src/cli/commands/doctor.ts`
- Registry doctor source: `packages/squad-cli/src/commands/doctor.ts`
- CLI entry: `packages/squad-cli/src/cli-entry.ts:1052–1086`
- SDK resolution: `packages/squad-sdk/src/resolution.ts:115–153`
- SDK adapter: `packages/squad-sdk/src/adapter/client.ts:60–115`
- SDK OTel: `packages/squad-sdk/src/runtime/otel-api.ts`, `otel.ts`
- Conventions file: `packages/squad-cli/src/cli/core/squad-file-conventions.ts`
- Workflows duplication: `packages/squad-cli/src/cli/core/workflows.ts:8` vs `upgrade.ts:141`
