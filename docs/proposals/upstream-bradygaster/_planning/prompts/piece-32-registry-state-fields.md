@Lead and Team, this is the Phase B replay session for piece 32 of the upstream-bradygaster effort.
Phase A staged piece 32 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 32 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: `squad/piece-25.5-doctor-cleanup-test-regression-repair` — **confirm the exact branch name at runtime** (`git branch --show-current`) and use that name in the checkout command below. The branch may be named `akubly/upstream-25.5-doctor-cleanup-test-regression-repair` depending on how piece 25.5 was pushed; use whichever name resolves locally.
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/32-registry-state-fields.md
```

If `32-registry-state-fields.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment asking Procedures to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. No comparison framing, no version leaks, no fork residue.

---

## Piece 32 — Registry state fields

Piece 32 extends the squad registry entry with three optional cross-repo state metadata fields and wires them into `squad assign`. It is purely additive: no existing registry entries require migration, no existing tests require modification except by extension.

### Scope (sub-proposals A–C)

- **A** — Add `stateRemote?: string`, `stateBranch?: string`, `developerAlias?: string` to `RegistryEntry` in `packages/squad-sdk/src/registry.ts`.
- **B** — Add `--state-remote <name>`, `--state-branch <name>`, `--developer-alias <alias>` flags to `squad assign`; persist all three through both the warm path and cold-start path to `writeRegistry`.
- **C** — Extract `DEVELOPER_ALIAS_RE` (`/^[a-z][a-z0-9-]{1,38}$/`) into a named export from a stable shared module (create `packages/squad-sdk/src/validation.ts` if no suitable home exists); validate `--developer-alias` at assign time before any registry read; throw `SquadAssignError` with code `INVALID_ALIAS` on mismatch.

### Verify-first probe (MANDATORY — do this before implementing anything)

Before writing a single line of implementation, confirm `DEVELOPER_ALIAS_RE` is not already exported from any source module:

```
grep -r "DEVELOPER_ALIAS_RE" packages/squad-sdk/src packages/squad-cli/src
```

If it resolves to a TypeScript source file (not a template SKILL.md), use that module as the export home for sub-proposal C. If not found in source, create `packages/squad-sdk/src/validation.ts` and export from there.

This probe is non-negotiable. Sub-proposal C's file choice depends on it.

---

### Workflow

**a.** Confirm piece 25.5 branch tip and create the piece 32 branch:

```
git fetch origin
git checkout <piece-25.5-branch>   # confirm name with git branch --show-current
git pull origin <piece-25.5-branch>
git checkout -b squad/piece-32-registry-state-fields
```

**b.** Run the verify-first probe (see above). Record your finding (where `DEVELOPER_ALIAS_RE` lives or that it does not exist in source) — this is the `validation.ts` / existing-module decision point.

**c.** Triage sub-proposals A–C: all three are deterministic and should be accepted. If any dependency conflict surfaces during triage, record a decision in `.squad/decisions/inbox/copilot-piece-32-triage.md` with rationale before proceeding.

**d.** Implement TDD — tests first, then implementation, one commit:

  - Write failing tests in `test/registry.test.ts`, `test/cli/assign.test.ts`, and (if `validation.ts` is new) `test/sdk/validation.test.ts` that capture the acceptance criteria from the spec.
  - Confirm tests are RED.
  - Implement sub-proposals A, B, C to make them GREEN.

  Key implementation sites (verify line numbers against current branch before editing — they may have shifted):

  - **A**: `packages/squad-sdk/src/registry.ts` lines 9–18 — insert `stateRemote?: string`, `stateBranch?: string`, `developerAlias?: string` before the `[key: string]: unknown` index signature. Do NOT remove the index signature.
  - **B**: `packages/squad-cli/src/commands/assign.ts` — extend `SquadAssignOpts` (near line 249); propagate all three fields through `runAssignToCopilot` warm path (near line 140–147) and `_coldStart` cold path (near line 680–703). Preserve existing values on re-assign when flags are omitted.
  - **C**: Export module (per probe result); `runAssign` entry point (near line 312) — add `DEVELOPER_ALIAS_RE` import; add validation guard before registry read; define `INVALID_ALIAS` in the `SquadAssignErrorCode` union (near line 208).

**e.** Run the scrub gate after all tests pass:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 | pwsh -Command -
```

All gates must pass. Do not bypass.

**f.** Add a changeset for both affected packages:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-sdk` and `@bradygaster/squad-cli`.

**g.** Single squashed commit:

```
git commit -m "feat(sdk,cli): registry state fields and assign flags (piece 32)

Sub-proposals accepted: A (RegistryEntry extension), B (assign flags), C (alias validation)

Closes #<issue-number-if-known>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

The commit body must state which sub-proposals were included and whether any were deferred, with one-line rationale.

**h.** Push and STOP:

```
git push -u origin squad/piece-32-registry-state-fields
```

Do NOT open a PR. Phase B is one piece per session. Phase C handles PR opening.

---

### Acceptance criterion

`npm test` (or `npx vitest run`) exits with:
- All new piece-32 tests GREEN (assign flag persistence, alias validation, registry round-trip).
- All piece-25.5 baseline tests still GREEN — zero regressions from the 25.5 tip.
- The only allowable failures are the 5 acknowledged upstream-inherited failures documented in the piece 25.5 spec.
