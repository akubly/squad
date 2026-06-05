# 35 — Fold pipeline in docs repo

## Summary

Ship two fold pipeline templates — GitHub Actions and ADO Pipelines variants — that install in the docs repo (the squad host). Each template triggers on pushes to `squad/inbox/<alias>/<ts>-<sessionId>` branches (published by piece 33's `publishTeamRootToInbox` and piece 34's automatic client-side triggers). The pipeline folds all unfolded inbox branches into the canonical `squad-state` orphan branch via fast-forward, serializing concurrent multi-developer publishes. The fold pipeline lives entirely in the docs repo; no automation of any kind resides in the product repo. An installer subcommand (`squad install-fold-pipeline`) copies the appropriate variant into the docs-repo clone and is idempotent on re-run.

Stack position: Part 35 of the new cross-repo arc. Branches off piece 34 (`squad/piece-34-client-side-publish-triggers`). Depends on pieces 32 (registry-first publication model), 33 (publishTeamRootToInbox wiring), and 34 (automatic client-side publish triggers). Closes the new cross-repo arc.

## Problem

Pieces 33 and 34 enable developers to publish state to per-developer inbox branches in the docs repo. Those inbox branches must be folded into the canonical `squad-state` branch so that other developers' `squad sync --pull` operations retrieve a consistent view of team state.

Three specific gaps remain after piece 34:

1. **No fold automation.** Inbox branches accumulate in the docs repo with no mechanism to promote them to `squad-state`. `squad sync --pull` fetches from `squad-state`, not from individual inbox branches, so unpromoted inbox pushes are invisible to other developers.

2. **Concurrent publish contention.** §9 NFR requires 9 concurrent developers to publish without direct push contention. If each developer pushed to `squad-state` directly, concurrent pushes would race — the second writer's push would fail because the first writer has advanced the ref. A pipeline that serializes writes eliminates the race: all developers push to their private inbox branch (no contention), and a single pipeline instance folds those branches in order.

3. **No single-writer invariant enforcement.** Without a designated fold pipeline, nothing prevents a developer from pushing to `squad-state` directly, which can corrupt fold ordering or overwrite another developer's state. The pipeline must be the sole writer to `squad-state`, and that invariant must be documented and enforceable via branch protection.

The fold algorithm itself is not new — it was established in an earlier cross-repo design as part of an ADO-only template. Piece 35 reuses that algorithm, adapts it to the current registry-first publication model from piece 32, and ships both a GitHub Actions and an ADO Pipelines variant, because piece 34's constraint 1 confirms that repos may be hosted on either platform.

## Proposed change

Three sub-proposals, all required for completeness. Accept all three before implementation begins.

### A. Ship `fold-squad-state.yml` for GitHub Actions

**File location:** `.squad-templates/fold/github/fold-squad-state.yml`

**Trigger:** `push` to ref pattern `squad/inbox/**`. No `pull_request:` trigger. No `workflow_dispatch:` trigger unless explicitly requested by a future spec.

**Permissions block:**

```yaml
permissions:
  contents: write   # required to push to squad-state
  actions: read
```

No other permissions. The `contents: write` scope is restricted to the fold step — do not grant it at the job level unless unavoidable. Prefer step-level token scoping via `github.token` on the push step.

**Algorithm (port exactly from the fold algorithm in the archived ADO template; adapt only the runtime syntax):**

1. Check out the docs repo with full fetch depth (`fetch-depth: 0`). The full history is required to compute ancestry for the ff-only push.
2. Enumerate all remote refs matching `refs/heads/squad/inbox/**` that are not already recorded as folded in `.squad/publish-history.json`. A ref is "already folded" if its SHA appears in `publish-history.json` under the `foldedRefs` array for any prior fold entry. Use `git ls-remote --heads origin 'squad/inbox/**'` to list current inbox refs.
3. Filter to refs not in the folded set. If no unfolded refs exist, exit cleanly (idempotent no-op).
4. Sort the unfolded refs deterministically: primary key = the timestamp segment of the branch name (`<yyyyMMdd-HHmmss>`), secondary key = the sessionId segment (lexicographic). Branch name format: `squad/inbox/<alias>/<yyyyMMdd-HHmmss>-<sessionId>`. Ties on timestamp are broken by sessionId lexicographic comparison.
5. Checkout the current `squad-state` tip.
6. For each inbox ref in sorted order: read the tree object (the `.squad/` directory snapshot), fold it into `squad-state` by applying the tree patch. The fold strategy is a read-tree merge of the inbox snapshot's `.squad/` tree on top of the current `squad-state` working tree, followed by a commit. The commit message records the inbox ref, the developer alias, and the timestamp. Do not use `git merge` — use `git read-tree` to apply only the `.squad/` subtree from the inbox snapshot, preserving `squad-state`'s own structure for all other paths.
7. After processing all unfolded refs, update `.squad/publish-history.json`: append a fold record with `{ foldTimestamp, foldedRefs: [{ ref, sha, developerAlias, publishedAt }], foldCommitSha }`. The `foldCommitSha` is the SHA of the new `squad-state` HEAD commit created in step 6.
8. Fast-forward push `squad-state` to origin: `git push origin HEAD:refs/heads/squad-state`. Use `--force-with-lease` to detect concurrent pipeline runs (should not happen if branch protection serializes the pipeline, but the guard prevents silent data loss).
9. Optionally delete folded inbox refs. Controlled by a workflow-level input variable `DELETE_FOLDED_REFS` (boolean, default `false`). When `true`, delete each folded inbox ref via `git push origin --delete <ref>`. Deletion failures are non-fatal — log and continue.

**Hard constraints:**

- No `pr:` key anywhere in the file (not even in a comment block that could be uncommented).
- No direct write to `squad-state` except via step 8's `--force-with-lease` push.
- Template comments must not reference external product names or version numbers. Use generic terms: "Squad fold pipeline," "Squad inbox branch," "Squad state branch."
- The template must contain a comment near the top of the `steps:` block asserting the single-writer invariant: `# This pipeline is the sole writer to squad-state. No other automation or manual push should target this branch.`

### B. Ship `fold-squad-state.yml` for ADO Pipelines

**File location:** `.squad-templates/fold/ado/fold-squad-state.yml`

**Trigger:**

```yaml
trigger:
  branches:
    include:
      - refs/heads/squad/inbox/*
```

No `pr:` trigger. No `schedules:` trigger.

**Algorithm:** Identical to sub-proposal A, adapted for ADO Pipelines syntax. The jq-based processing, deterministic sort, read-tree fold, `publish-history.json` update, ff-only push with `--force-with-lease`, and optional inbox ref pruning are all directly ported. Runtime differences only: `$(System.AccessToken)` replaces `${{ github.token }}`; ADO checkout task replaces GitHub Actions `actions/checkout`; `bash` inline steps replace GitHub Actions `run` blocks.

**Permissions:** OAuth token access scoped to the fold step only — no broad `allow scripts to access OAuth token` at pool level. The template must include a comment: `# OAuth token access is scoped to the push step only. Do not enable allowScripts at the pipeline or pool level.`

**Single-writer comment:** Same verbatim comment as sub-proposal A, placed at the same position (top of the `steps:` list).

**Hard constraint:** No `pr:` trigger. The test assertion for ADO YAML must confirm `pr:` is not a top-level key.

### C. Installer: `squad install-fold-pipeline <github|ado>`

**Command:** `squad install-fold-pipeline <platform>` where `<platform>` is `github` or `ado`.

**Behavior:**

1. Resolve the docs-repo clone path from the squad config (`stateRemote` remote URL or a `docsRepoPath` config field set by piece 32's `squad connect`).
2. Determine the target directory:
   - `github` → `<docsRepoPath>/.github/workflows/`
   - `ado` → `<docsRepoPath>/.azure-pipelines/`
3. Fail fast (exit 1, clear error message) if the target directory does not exist. Do not create missing parent directories — the docs repo must be bootstrapped before the pipeline is installed.
4. Compute the source template path: `.squad-templates/fold/<platform>/fold-squad-state.yml` relative to the product repo's `TEAM_ROOT` (or the CLI's bundled templates directory).
5. Check the destination file (`fold-squad-state.yml` in the target directory):
   - If absent: copy the template.
   - If present and content matches: exit 0 (idempotent no-op). Log: `fold-squad-state.yml already installed and up to date.`
   - If present and content differs: fail fast (exit 1) with message: `fold-squad-state.yml exists at <path> with different content. Review and delete it manually before re-running install-fold-pipeline.` Do not overwrite silently.
6. Log the installed file path on success.

**Where the installer lives:** Extend `cli-entry.ts` with a new `install-fold-pipeline` command dispatching to a new `installFoldPipeline(platform: 'github' | 'ado', options: InstallFoldPipelineOptions)` function in a new file `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts`.

**Idempotency contract:** Running the command twice with identical inputs must produce identical state. The content-match check (step 5) is the idempotency gate.

## Special scrutiny

### GitHub Actions AND ADO Pipelines (both required)

Piece 32's constraint 1 confirms that docs repos may be hosted on either GitHub or ADO. Both variants must ship in this piece. The fold algorithm is identical; only runtime syntax, trigger format, and token model differ. Shipping only one variant is not acceptable.

### Single-writer invariant for `squad-state`

The fold pipeline is the **only** writer to `squad-state`. This is not merely a convention — it is the correctness invariant for concurrent multi-developer publishing. Document it:

- In both template YAML files as a comment (see sub-proposals A and B).
- In this spec's test assertions (test must confirm no path in the pipeline directly writes to `squad-state` except the designated push step).
- In the docs content for the fold pipeline (user-facing documentation should describe the branch protection rule recommended to enforce this: set `squad-state` as a protected branch with "Restrict who can push" enabled, allowing only the pipeline identity).

Developer git credentials should never have direct write access to `squad-state`. Branch protection enforcement is outside the scope of this piece but must be called out as a deployment prerequisite.

### Deterministic fold ordering

Two independent pipeline runs on the same input set of unfolded inbox refs must produce the same `squad-state` tip SHA. The algorithm achieves this via:

1. Deterministic sort: primary key = timestamp segment (`<yyyyMMdd-HHmmss>`, UTC), secondary key = sessionId segment (ASCII lexicographic).
2. Idempotent fold: each inbox ref's SHA is recorded in `publish-history.json` before the next ref is processed. A run that is interrupted and retried resumes from the last unfolded ref in the sorted sequence.
3. No wall-clock timestamps in commit messages for intermediate fold commits — use the `publishedAt` value from the inbox branch's snapshot metadata, not the pipeline run time.

Document this algorithm precisely in the template's inline comments so that a manual operator can reconstruct the fold sequence from the `publish-history.json` audit trail.

### Inbox pruning is optional and configurable

After a successful fold, the pipeline MAY delete the folded inbox branch. Trade-offs:

| Option | Benefit | Risk |
|--------|---------|------|
| Delete immediately | Keeps docs repo ref count low; prevents stale refs accumulating over months of use by 9+ developers | Folded branches cannot be inspected post-fold for debugging; a prematurely deleted branch cannot be recovered unless the SHA is recorded in `publish-history.json` |
| Retain permanently | Full audit trail; branches can be recreated from their SHAs | Ref table grows unboundedly; `git ls-remote` latency increases |
| Delete after N days (default 7) | Balances auditability with storage | Requires a separate scheduled cleanup job not shipped in this piece |

**Decision:** Default is no deletion (`DELETE_FOLDED_REFS: false`). The `publish-history.json` file records all folded SHAs regardless of pruning, providing the audit trail. Teams that want to prune set `DELETE_FOLDED_REFS: true`. A future cleanup piece may add scheduled pruning after N days.

### No `publish-inbox.yml`

This piece ships the fold pipeline only. The "publish" side — creating inbox branches — is entirely client-driven by pieces 33 and 34. There is no server-side publish pipeline in the product repo. This is a hard constraint that must be verified in review: the PR for piece 35 must contain no pipeline files targeting the product repo.

## Test surface

| Test file | Coverage |
|-----------|----------|
| `test/squad-templates/fold-github.test.ts` (new) | Assert GitHub Actions YAML parses without error using the `yaml` package; assert top-level `on.push.branches` (or `on.push.branches-ignore`) is not present with `squad-state`; assert trigger ref pattern includes `squad/inbox/**`; assert no `pull_request:` key in top-level parsed object; assert `permissions.contents === 'write'`; assert file contains the single-writer invariant comment string. |
| `test/squad-templates/fold-ado.test.ts` (new) | Assert ADO YAML parses without error; assert `trigger.branches.include` contains `refs/heads/squad/inbox/*`; assert no `pr:` key in top-level parsed object; assert no `allowScripts: true` at pool level; assert file contains the single-writer invariant comment string. |
| `test/cli/install-fold-pipeline.test.ts` (new) | Assert `github` arg copies template to `<docsRepoPath>/.github/workflows/fold-squad-state.yml`; assert `ado` arg copies to `<docsRepoPath>/.azure-pipelines/fold-squad-state.yml`; assert idempotent re-run exits 0 and produces no change; assert re-run with a different file content at destination exits 1 with actionable error message; assert missing target directory exits 1 before any write. |
| Integration test (strongly recommended) | Bare-repo fixture: two simulated developers push inbox branches (`squad/inbox/alice/20260605-120000-aaa` and `squad/inbox/bob/20260605-120001-bbb`) to a test remote; fold algorithm is exercised locally (not via actual pipeline runner) by calling the fold logic directly; assert `squad-state` tip includes both developers' `.squad/` trees; assert `publish-history.json` records both foldedRefs; assert a third `squad sync --pull` retrieves the merged state. |

Validation commands:

```powershell
npm install
npm run build
npm test -- test/squad-templates/fold-github.test.ts
npm test -- test/squad-templates/fold-ado.test.ts
npm test -- test/cli/install-fold-pipeline.test.ts
npm test
```

## Files

| Path | Role |
|------|------|
| `.squad-templates/fold/github/fold-squad-state.yml` | GitHub Actions fold pipeline template |
| `.squad-templates/fold/ado/fold-squad-state.yml` | ADO Pipelines fold pipeline template |
| `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` | Installer command implementation |
| `packages/squad-cli/src/cli-entry.ts` | Extend: wire `install-fold-pipeline` dispatch |
| `test/squad-templates/fold-github.test.ts` | New: GitHub Actions template behavioral assertions |
| `test/squad-templates/fold-ado.test.ts` | New: ADO template behavioral assertions |
| `test/cli/install-fold-pipeline.test.ts` | New: installer behavioral assertions |

## Changeset

Required. This piece modifies `packages/squad-cli/src/` (new command + cli-entry wiring). Add a changeset classifying `@bradygaster/squad-cli` as `minor` (new `install-fold-pipeline` command). `@bradygaster/squad-sdk` is not modified by this piece.

## Dependencies

- `squad/piece-34-client-side-publish-triggers` (branch-off point)
- Pieces 32 and 33 must be present: piece 32's `squad connect` establishes `docsRepoPath`; piece 33's `publishTeamRootToInbox` creates the inbox branches the fold pipeline consumes
- `yaml` devDependency (already added in piece 30; verify it is present before adding again)

## Notes

Verify-first probe before implementation:

```
# Confirm the fold algorithm source exists for porting
ls .squad-templates/fold/ 2>/dev/null || echo "fold/ subdirectory absent — will be created"

# Confirm yaml devDependency is present
node -e "require('yaml'); console.log('yaml available')"

# Confirm cli-entry.ts install-fold-pipeline dispatch does not already exist
grep -c 'install-fold-pipeline' packages/squad-cli/src/cli-entry.ts && echo "already wired" || echo "not yet wired"
```

Pipeline template comments must not reference external product names or version numbers. Use generic terms throughout: "Squad fold pipeline," "Squad inbox branch," "Squad state branch." No comparison framing in YAML comments.

The fold pipeline's `--force-with-lease` push guard is the last line of defense against concurrent pipeline runs that slip through branch protection serialization. It is not the primary guard — branch protection should be configured to allow only one concurrent pipeline run on `squad-state` — but it is non-optional in the template.
