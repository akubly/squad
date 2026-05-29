# 30 — ADO cross-repo pipeline templates

## Summary

Ship three canonical ADO pipeline assets at `.squad-templates/ado/`: `bootstrap-cross-repo.ps1` (developer workstation and pipeline agent bootstrap), `publish-inbox.yml` (inbox branch publisher), and `fold-squad-state.yml` (state serializer). Mirror all three to the four template mirror locations via `scripts/sync-templates.mjs`. Add three docs pages covering enterprise setup, state backends, and team-state storage scenarios.

Stack position: Part 30 of the cross-repo arc. Depends on pieces 26–29. Template, script, and docs only — no `packages/*/src/` changes.

## Problem

Piece 28 defines the publish/fold contract and piece 29 updates the coordinator protocol, but neither ships automation. Without canonical templates, every team must author its own pipelines and bootstrap script, with no reference for trigger shape, permission model, fold ordering, or the "no squad-state writes from developer machines" invariant.

Three specific gaps:

- No supported bootstrap script means first-time setup requires reading multiple docs pages and hand-assembling `squad bind` invocations.
- No canonical publish pipeline means teams invent their own trigger rules, risking pipelines that write to `squad-state` directly or trigger on PR events.
- No canonical fold pipeline means each deployment has its own merging logic, creating divergent `publish-history.json` formats and potential concurrency defects.

## Proposed change

Ship exactly these three assets under `.squad-templates/ado/`. Mirror each to `templates/ado/`, `packages/squad-cli/templates/ado/`, and `packages/squad-sdk/templates/ado/` via `scripts/sync-templates.mjs`.

### `bootstrap-cross-repo.ps1`

Developer workstation and pipeline agent bootstrap. Accepts two mandatory parameters (`$DocsRepoUrl`, `$DeveloperAlias`) and two optional ones (`$DocsRemoteName` defaulting to `squad-docs`, `$StateBranch` defaulting to `squad-state`).

Behavior (must be fully idempotent):

1. Fail fast if `$DeveloperAlias` or `$DocsRepoUrl` is empty or absent — before any write operation.
2. Create or update the TEAM_ROOT sidecar clone from `$DocsRepoUrl`.
3. Run `squad bind` with the resolved roots and config fields.
4. Configure the `$DocsRemoteName` remote and refspecs in WORK_ROOT.
5. Append `.squad/` and `.github/agents/squad.agent.md` to `WORK_ROOT/.git/info/exclude` (idempotent append — do not duplicate entries).
6. Run an initial `squad sync --pull`.

The script must tolerate being run against an already-bootstrapped WORK_ROOT without overwriting existing config or duplicating exclude entries.

### `publish-inbox.yml`

ADO pipeline for the product repo (or a platform-admin infra repo tied to it). Triggered by branch pushes only.

Constraints:

- **No `pr:` trigger.** No trigger on `squad-state`, `main`, or `dev` branches.
- Installs Node and Squad CLI.
- Runs bootstrap if `.squad/config.json` is absent.
- Publishes TEAM_ROOT snapshot to `squad/inbox/<alias>/<session>` via `squad sync --push`.
- Does not write to `squad-state` at any step.

### `fold-squad-state.yml`

ADO pipeline for the docs/specs repo. Triggered by pushes to `squad/inbox/*`. The sole writer to `squad-state`.

Behavior:

1. Check out the docs repo with full fetch depth.
2. Enumerate newly pushed inbox refs since the last recorded fold commit in `.squad/publish-history.json`.
3. Fold them in deterministic order: lexicographic by `publishedAt` timestamp, then by `developerAlias`.
4. Update `.squad/publish-history.json` with fold provenance (folded refs, fold commit SHA, fold timestamp).
5. Fast-forward `squad-state`.
6. Optionally delete folded inbox refs after a successful fast-forward (controlled by a pipeline variable, default off).

Permissions: pipeline identity must be repo-scoped. OAuth token access scoped to the fold step only — no broad `allow scripts to access OAuth token` at pool level.

### Mirror locations

`scripts/sync-templates.mjs` mirrors all three assets to:

| Mirror path | |
| --- | --- |
| `templates/ado/bootstrap-cross-repo.ps1` | Mirror 1 |
| `templates/ado/publish-inbox.yml` | Mirror 1 |
| `templates/ado/fold-squad-state.yml` | Mirror 1 |
| `packages/squad-cli/templates/ado/bootstrap-cross-repo.ps1` | Mirror 2 |
| `packages/squad-cli/templates/ado/publish-inbox.yml` | Mirror 2 |
| `packages/squad-cli/templates/ado/fold-squad-state.yml` | Mirror 2 |
| `packages/squad-sdk/templates/ado/bootstrap-cross-repo.ps1` | Mirror 3 |
| `packages/squad-sdk/templates/ado/publish-inbox.yml` | Mirror 3 |
| `packages/squad-sdk/templates/ado/fold-squad-state.yml` | Mirror 3 |

Verify that `scripts/sync-templates.mjs` handles subdirectories under `.squad-templates/` before adding the `ado/` subdirectory. Extend the script if it does not already recurse into subdirectories.

### Docs additions

| Path | Content |
| --- | --- |
| `docs/src/content/docs/guide/shared-squad.md` | End-to-end enterprise setup: run `bootstrap-cross-repo.ps1`, verify remote and exclude entries, first sync, normal dev loop. |
| `docs/src/content/docs/features/state-backends.md` | ADO-hosted `squad-state` as a supported backend; orphan branch layout, fold pipeline identity, branch policy recommendations. |
| `docs/src/content/docs/scenarios/team-state-storage.md` | Enterprise mono-repo scenario: docs repo layout, inbox branches, fold pipeline, first-sync verification, concurrent-developer considerations. |

## Validation strategy

This piece adds `yaml` as a new devDependency (lightweight, no transitive dependencies). No ADO schema vendoring.

New test file `test/cli/ado-templates.test.ts` with behavioral assertions against the parsed YAML files and the PS1 script text. Assertions:

| Assertion | Pass condition |
| --- | --- |
| `publish-inbox.yml` is valid YAML | File parses without error using the `yaml` package |
| `publish-inbox.yml` has no `pr:` key | Top-level parsed object has no `pr` property |
| `fold-squad-state.yml` is valid YAML | File parses without error |
| `fold-squad-state.yml` trigger includes `squad/inbox/*` | Trigger include patterns contain the string `squad/inbox/*` |
| `fold-squad-state.yml` has no broad OAuth scope | Parsed YAML has no pool-level `allowScripts` or equivalent broad OAuth grant |
| `bootstrap-cross-repo.ps1` has alias-empty guard | Script text matches `if\s*\(\s*!\s*\$DeveloperAlias` or a functionally equivalent null/empty check before the first write operation |

Extend `test/template-sync.test.ts` to assert that all three ADO templates appear in all four locations (canonical `.squad-templates/ado/` plus three mirrors). Missing a mirror target is a silent failure — the assertion makes it loud.

## Test surface

| Test file | Coverage |
| --- | --- |
| `test/cli/ado-templates.test.ts` (new) | Six behavioral assertions above. |
| `test/template-sync.test.ts` (existing, extended) | `ado/bootstrap-cross-repo.ps1`, `ado/publish-inbox.yml`, `ado/fold-squad-state.yml` present at all four locations. |

Validation commands:

```powershell
npm install
npm run build
npm test -- test/cli/ado-templates.test.ts
npm test -- test/template-sync.test.ts
npm test
```

## Files

| Path | Role |
| --- | --- |
| `.squad-templates/ado/bootstrap-cross-repo.ps1` | Canonical bootstrap script |
| `.squad-templates/ado/publish-inbox.yml` | Canonical publish pipeline template |
| `.squad-templates/ado/fold-squad-state.yml` | Canonical fold pipeline template |
| `templates/ado/bootstrap-cross-repo.ps1` | Mirror 1 |
| `templates/ado/publish-inbox.yml` | Mirror 1 |
| `templates/ado/fold-squad-state.yml` | Mirror 1 |
| `packages/squad-cli/templates/ado/bootstrap-cross-repo.ps1` | Mirror 2 |
| `packages/squad-cli/templates/ado/publish-inbox.yml` | Mirror 2 |
| `packages/squad-cli/templates/ado/fold-squad-state.yml` | Mirror 2 |
| `packages/squad-sdk/templates/ado/bootstrap-cross-repo.ps1` | Mirror 3 |
| `packages/squad-sdk/templates/ado/publish-inbox.yml` | Mirror 3 |
| `packages/squad-sdk/templates/ado/fold-squad-state.yml` | Mirror 3 |
| `docs/src/content/docs/guide/shared-squad.md` | Setup guide update |
| `docs/src/content/docs/features/state-backends.md` | State backends feature doc update |
| `docs/src/content/docs/scenarios/team-state-storage.md` | Enterprise scenario guide |
| `test/cli/ado-templates.test.ts` | New behavioral assertions |
| `package.json` | Add `yaml` devDependency |

## Changeset

None required. No `packages/*/src/` changes. If `scripts/sync-templates.mjs` requires modification to support the `ado/` subdirectory, reassess — `scripts/` is not a changeset target regardless.

## Dependencies

Pieces 26 (config model), 27 (sync command), 28 (inbox publish flow and provenance schema), 29 (coordinator protocol). The bootstrap script wraps `squad bind`; the pipelines reference sync vocabulary, alias format, and `publish-history.json` schema from those prior pieces.

## Notes

Verify-first: probe `scripts/sync-templates.mjs` for whether it already handles subdirectories under `.squad-templates/`. Probe `test/template-sync.test.ts` for the current assertion pattern before adding new assertions.

`fold-squad-state.yml` is the sole writer to `squad-state`. This invariant is enforced by reviewer in Phase C and by the behavioral test asserting `publish-inbox.yml` does not write to `squad-state`. There is no runtime lock; the pipeline permission model (repo-scoped identity) is the enforcement mechanism.

Pipeline template comments must not reference external product names or version numbers. Use generic terms: "Squad state remote," "Squad fold pipeline," "Squad inbox branch."
