@Lead and Team, this is the Phase B replay session for piece 37 of the upstream stack.
Phase A staged the piece 37 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted Tier-1 sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 37 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay` (clone of akubly/squad).
- Branch to create: `squad/piece-37-dogfood-fixes-and-publish-model` off `squad/piece-36-cross-repo-publish-loop-repair`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/37-dogfood-fixes-and-publish-model.md
```

If `37-dogfood-fixes-and-publish-model.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be staged before this session proceeds.

Piece 37 addresses dogfood-surfaced defects in the cross-repo sync workflow and a set of publish-model design decisions. The implementation in Phase B covers Tier-1 items only (A–H). Tier-2 items (I–P) require recorded decisions before any code lands; sub-proposal I (hook placement) is DECISION PENDING — do not implement it under any circumstances this session even if the user provides guidance mid-session. If the user asks about Tier-2 implementation during Phase B, note the decision gate and defer.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in `.squad/decisions/inbox/piece-37-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — `squad sync push`/`pull` positional silently becomes `--both` | **BLOCKER** | Accept |
| B — `stateRemote` defaults to nonexistent `'squad-docs'`; status misleads | **BLOCKER** | Accept |
| C — `install-fold-pipeline` absent from `squad --help` | BUG | Accept |
| D — `ERR_ASSIGN_ORIGIN_AMBIGUITY` advises `--callsign` dead in warm path | BUG | Accept |
| E — "docs-repo" → "shared-squad host clone" in user-facing strings | UX | Accept |
| F — `squad assign --help` falls through to main help | UX | Accept |
| G — `squad --help` command-table column not padded | UX | Accept |
| H — ADO fold pipeline installed to `.azure-pipelines/` (non-standard) | UX | Accept |
| I — Hook placement (DECISION PENDING) | DESIGN | **DECISION PENDING — do not implement until the user/Lead resolves it. If unresolved at implementation time, implement Tier-1 (A–H) only and defer Tier-2 entirely.** |
| J — "developer alias" → canonical inbox-handle terminology rename | DESIGN | Decision required — record in triage doc; defer implementation until canonical term is agreed |
| K — Handle setting at `squad init` / host-only workflow gap | DESIGN | Decision required — defer |
| L — Inbox branch prefix configurability | DESIGN | Decision required — defer |
| M — Sync-from-host guard | DESIGN | Decision required — defer |
| N — Upstream-as-context-read integration | DESIGN (architecture) | Decision required — defer |
| O — Orphan-backend as enforced host default | DESIGN (architecture) | Decision required — defer |
| P — Host-self-publish opt-in | DESIGN (architecture) | Decision required — defer (also blocked on O and I) |

Record accept/defer for each sub-proposal in `.squad/decisions/inbox/piece-37-triage.md` before writing any product code.

---

## Workflow for piece 37

**a.** Create the implementation branch off piece 36:

```
git fetch origin
git checkout squad/piece-36-cross-repo-publish-loop-repair
git checkout -b squad/piece-37-dogfood-fixes-and-publish-model
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-37-triage.md`. The triage document must exist before the first product file is modified.

**c.** For each accepted sub-proposal (A–H), implement TDD: write failing tests first, then implementation, red-to-green. Implement in the recommended order: B, A, D, C, F, G, E, H. Sub-proposals are ordered so that blockers land first (B and A), then correctness bugs, then UX items.

See implementation notes below for per-sub-proposal guidance.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate.ps1
pwsh scrub-gate.ps1
Remove-Item scrub-gate.ps1
```

All gates must pass. Address any failures introduced by your changes. Pre-existing WARN-level baseline items are not blocking.

**e.** Add a changeset — `packages/squad-cli/src/` is touched:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Repair dogfood-surfaced defects: fix sync direction positional, default state remote to origin, add install-fold-pipeline to help, wire --callsign in warm-path disambiguation, rename docs-repo strings, add assign help, fix help padding, standardize ADO pipeline directory."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body must list: sub-proposals accepted (A–H), triage outcomes, scrub gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-37-dogfood-fixes-and-publish-model
```

**h.** STOP. Do not open a PR. Phase C handles PR opening as a separate, deliberate workflow.

---

## Implementation notes

### Sub-proposal B — Fix `stateRemote` default (implement first)

Files: `packages/squad-cli/src/cli/commands/sync.ts:693, 715, 722, 734`.

Add `const DEFAULT_STATE_REMOTE = 'origin'` near the top of the function or module (wherever `stateRemote` is first used in the cross-repo path). Replace the three `'squad-docs'` literals at lines 693, 722, and 734 with `DEFAULT_STATE_REMOTE`. At line 715, change the status log from printing `remote` to printing the effective `stateRemote` in cross-repo mode: `stateRemote ?? DEFAULT_STATE_REMOTE`. In single-repo mode (`crossRepo = false`), the status line may continue to print `remote`.

Write three tests: (a) cross-repo push with `entry.stateRemote` unset resolves to `'origin'`; (b) cross-repo push with explicit `entry.stateRemote = 'upstream'` uses `'upstream'`; (c) status line in cross-repo mode prints `stateRemote ?? DEFAULT_STATE_REMOTE`, not the single-repo `remote` variable.

### Sub-proposal A — Fix sync direction positional (implement second)

File: `packages/squad-cli/src/cli-entry.ts:1430–1443`.

After the `status` positional check (~line 1430), add direction positional handling. The sub-command is already extracted into `subCmd` (or equivalent) at this point in the parse flow. Pattern:

```typescript
// After status positional check:
if (subCmd === 'push' && !hasPull && !hasBoth) direction = 'push';
else if (subCmd === 'pull' && !hasPush && !hasBoth) direction = 'pull';
```

Flags take precedence over positionals — set flag booleans first, then apply positional only when no flag is set. This matches the existing `status` positional pattern.

Write four tests: (a) `squad sync push` (positional) → push-only; (b) `squad sync pull` (positional) → pull-only; (c) `squad sync --push` (flag) → push-only; (d) `squad sync status` → unaffected.

### Sub-proposal D — Wire `--callsign` in warm-path disambiguation

File: `packages/squad-cli/src/commands/assign.ts:511–512, 519–523`.

Modify the filter at `assign.ts:511–512` to also exclude entries where `e.callsign !== opts.callsign` when `opts.callsign` is provided:

```typescript
// Current: matches only positional
entries.filter(e => e.callsign === callsign)
// Required: also respect --callsign flag when provided
entries.filter(e => e.callsign === callsign && (!opts.callsign || e.callsign === opts.callsign))
```

Wait — the callsign positional and `opts.callsign` are different identifiers. Read the warm-path filter logic carefully during implementation. The intent is: if `opts.callsign` is provided, use it as an additional discriminator to narrow the ambiguous set.

Write one test: ambiguous warm-path assign (two registry entries share a callsign) disambiguated by providing `--callsign <name>` that matches only one entry; no error.

### Sub-proposal C — Add `install-fold-pipeline` to help table

File: `packages/squad-cli/src/cli-entry.ts:213–252`.

Add a row for `install-fold-pipeline` to the commands table. If sub-proposal G (column padding) is implemented first, use the padded format. Description: `"Install the fold pipeline YAML into the shared-squad host repository."` (adjust to match the style of neighboring rows).

Write one test: `squad --help` output contains `'install-fold-pipeline'`.

### Sub-proposal F — Add `squad assign --help` branch

File: `packages/squad-cli/src/cli-entry.ts:284–347`.

Add an `assign` branch to the per-command help dispatch block. The branch triggers when `cmd === 'assign'` and `args` includes `'--help'` or `'-h'`. Print usage for `squad assign` covering: positional `<callsign>`, flags `--developer-alias`, `--state-remote`, `--state-branch`, `--skills-from`, `--callsign`. Exit 0. Do NOT invoke `runAssign`.

Write two tests: (a) `squad assign --help` prints assign-specific usage and exits 0; (b) `squad assign --help` does NOT call `runAssign`.

### Sub-proposal G — Fix help table column padding

File: `packages/squad-cli/src/cli-entry.ts:217–252`.

Compute (or hardcode as a named constant) the column width from the longest command name in the table. Apply `.padEnd(COMMAND_COL_WIDTH)` to each command name in the table. Ensure `COMMAND_COL_WIDTH` is wide enough to accommodate `install-fold-pipeline` (22 chars) plus a minimum gap (2 spaces minimum → 24 chars). Use a named constant for the width.

Write one test: help output command-name column — all description strings begin at the same character offset (verify alignment).

### Sub-proposal E — Rename "docs-repo" strings

Files: `packages/squad-cli/src/commands/assign.ts:591`, `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts:88,106`, `packages/squad-cli/src/cli/commands/install-hooks.ts:272`, `packages/squad-cli/src/cli/commands/sync.ts:588`.

Replace `"docs-repo"` in user-facing string literals at these four locations with `"shared-squad host clone"` (or `"host clone"` if the full phrase is too long for a status line — be consistent across all four locations). Do not rename variables or function parameters.

Write four tests (one per file): assert the updated string does not contain `"docs-repo"` and does contain the new term.

### Sub-proposal H — ADO pipeline directory

Files: `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts:97`; `packages/squad-cli/templates/fold/ado/fold-squad-state.yml` (trigger path, if present).

Change `'.azure-pipelines'` to `'.azuredevops'` at `install-fold-pipeline.ts:97`. If the ADO fold template references `.azure-pipelines/` in any path string (e.g., a `path:` trigger), update that path to `.azuredevops/`. Add a log line noting that the ADO pipeline definition in the portal must be configured to point to `.azuredevops/fold-squad-state.yml`.

Verify idempotency: re-running `install-fold-pipeline` when `.azuredevops/fold-squad-state.yml` already exists must detect the conflict and exit 1 with the existing path in the message (same as the piece-35 idempotency behavior, now at the new path).

Write two tests: (a) ADO install writes template to `.azuredevops/fold-squad-state.yml`; (b) ADO install detects conflict at `.azuredevops/` and exits 1.

### Test import specifiers

When writing new tests, align import specifiers for the SDK package with the import pattern already established in the existing test files on the base branch. Check the existing `test/` files to confirm the expected specifier before writing new tests. Do not introduce a new package scope in test imports.

---

## Acceptance gate

Piece 37 (Tier-1) is complete when:

1. **Build exits 0.** `npm run build` completes without errors.

2. **Pre-existing tests pass.** All tests from pieces 26–36 pass without modification.

3. **Blocker regression tests present and green.** Sub-proposals A and B each have regression tests confirming corrected behavior.

4. **Per-sub-proposal coverage.** Each sub-proposal A–H has at least one targeted test.

5. **`squad sync push` is push-only.** Confirmed by test.

6. **`stateRemote` resolves to `'origin'` by default.** Confirmed by test.

7. **Changeset present.** `.changeset/*.md` records `patch` for `@bradygaster/squad-cli`.

8. **Scrub gate passes.** `pwsh docs/proposals/upstream-bradygaster/_scrub-gate.ps1` exits 0, all gates PASS or pre-existing WARN baseline unchanged.

9. **Tier-2 items deferred.** No Tier-2 code in the commit. `.squad/decisions/inbox/piece-37-triage.md` records each Tier-2 item as deferred pending decision, and sub-proposal I is marked DECISION PENDING.
