# 49 — Self-hosted fold runners and multi-squad host onboarding

## Summary

A dogfooding pass that stood the fold pipeline up on a **self-hosted CI runner** and prepared a
single host repository to carry **more than one squad** exercised two operator paths the stack has
not yet covered: running the fold loop on a runner that reuses its workspace across runs, and
onboarding a teammate against a host that nests each squad's team root in its own subdirectory.
It surfaced four gaps. None is a transport-correctness defect — the fold loop folds correctly on a
clean, ephemeral runner and a single-squad host — but each blocks the self-hosted-runner and
multi-squad-host configurations that the cross-repo model already implies.

1. **The fold templates assume an ephemeral workspace and break on a runner that reuses one.**
   A hosted (cloud) runner gives every job a fresh clone, so a `git checkout --orphan
   "$STATE_BRANCH"` on the first fold of a callsign always starts clean. A self-hosted runner
   reuses its working directory across runs, so a local `squad/state/<callsign>` branch created
   by a previous fold survives into the next run and the orphan checkout aborts with `fatal: a
   branch named 'squad/state/<callsign>' already exists`, failing every subsequent fold for that
   callsign. The templates never delete the stale local branch before the checkout.

2. **A no-op (idempotent) fold aborts the whole run instead of skipping cleanly.** When an inbox
   snapshot's `.squad/` content is byte-identical to what the state branch already holds (a
   re-published or duplicate snapshot), the per-ref `git add` stages nothing and the per-ref `git
   commit` has an empty diff. The GitHub template invokes that commit unguarded, so under `set
   -euo pipefail` it exits non-zero and aborts the run **after** other refs in the same batch were
   already folded but **before** the state branch is pushed. The ADO template tolerates the
   failure (it wraps the commit in an `if` and resets on failure) but then never records the ref
   as folded, so the redundant inbox ref is never cleaned up. Neither template treats an
   already-folded snapshot as the benign no-op it is.

3. **There is no way to run a fold on demand.** Both templates trigger only on an inbox-ref
   `push` and on a `*/15 * * * *` schedule. An operator validating a freshly-installed pipeline,
   or re-running a fold after fixing a runner, must either push a throwaway inbox ref or wait up
   to fifteen minutes for the next scheduled sweep. Neither template exposes a manual trigger.

4. **`squad assign` cannot onboard a squad whose team root is a subdirectory of the host.**
   `squad init` already supports a monorepo/subfolder layout: run from a subdirectory of a git
   repository, it places `.squad/` in that subdirectory and the coordinator agent file at the git
   root, and the SDK skips workflow placement in that mode (issue #939). That is exactly the
   layout a host needs to carry several squads in one repository — one team-root subdirectory per
   callsign. But the warm-path clone side of `squad assign` hardcodes the team root at the clone
   root (`path.join(cloneDest, '.squad')`) and fails with `ERR_ASSIGN_NO_TEAM_MD` when
   `.squad/team.md` is not there, so a teammate cannot assign against a subfolder-hosted squad
   even though `init` can create one. The two halves of the multi-squad-host story are asymmetric.

This piece delivers (A) self-hosted-runner durability in the fold templates — drop a stale local
state branch before checkout and treat a no-op fold as a clean skip that still records and cleans
up the ref; (B) a manual on-demand fold trigger in both templates; and (C) subfolder team-root
resolution in `squad assign` so a multi-squad host can be onboarded; and resolves a Tier-2 decision
(D) about whether `install-fold-pipeline` may target the current repository directly when it is
itself the state host.

Stack position: Part 49 of the cross-repo arc. Branches off piece 48
(`squad/piece-48-host-operability-fold-cleanup-and-doctor-diagnostics`). Piece 48 moved from
transport correctness into the host-operator experience (install ergonomics, fold cleanup, doctor
diagnostics); piece 49 continues from the next pass, which took the host onto a self-hosted runner
and toward a multi-squad layout. It depends on the fold templates and `install-fold-pipeline`
established by pieces 41/44/48, the callsign-scoped fold target from piece 41, the monorepo/
subfolder `init` and `agentFileRoot` support (issue #939), and the warm-path clone/validation flow
in `squad assign` from piece 14.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs
`41-fold-pipeline-repo-root-and-generic-discovery.md`,
`42-fold-subtree-overlay-and-serialization.md`,
`44-pipeline-file-injection-hygiene-on-shared-hosts.md`,
`48-host-operability-fold-cleanup-and-doctor-diagnostics.md`, and the
`_planning/dogfood-backlog.md` roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (the `squad assign` change, and the
`install-fold-pipeline` change if D1 is chosen) — include a `patch` changeset entry for
`@bradygaster/squad-cli`. The fold templates ship inside `@bradygaster/squad-cli` and are mirrored
in `@bradygaster/squad-sdk`; if the `squad-sdk` template mirror is modified (it is, for A and B),
include a `patch` changeset for `@bradygaster/squad-sdk` as well.

---

## Problem

### 1. The fold templates break on a workspace-reusing (self-hosted) runner

Both fold templates resolve the state branch with the same block (GitHub template lines 57–66; ADO
template lines 62–71, byte-identical logic):

```bash
if git ls-remote --exit-code origin "refs/heads/${STATE_BRANCH}" >/dev/null 2>&1; then
  git fetch origin "$STATE_BRANCH"
  git checkout -B "$STATE_BRANCH" "origin/$STATE_BRANCH"
else
  git checkout --orphan "$STATE_BRANCH"
  git rm -rf . >/dev/null 2>&1 || true
  git commit --allow-empty -m "Initialize Squad state branch for $CALLSIGN"
fi
```

On a hosted runner the workspace is discarded after every job, so on the first fold of a new
callsign the remote `squad/state/<callsign>` does not exist, the `else` branch runs, and `git
checkout --orphan` succeeds against a clean repository. On a self-hosted runner the workspace
persists: the previous run's `git checkout --orphan "$STATE_BRANCH"` (or `git checkout -B`) leaves
a **local** branch `squad/state/<callsign>` in the working clone. If the state branch is not yet on
the remote (e.g. the first fold produced local commits but a later step failed before the push, or
the branch was deleted on the remote), the next run takes the `else` branch again and `git checkout
--orphan "$STATE_BRANCH"` aborts:

```
fatal: a branch named 'squad/state/mycallsign' already exists
```

The whole job exits non-zero, and it keeps failing every run until the workspace is cleaned by
hand. The `git checkout -B` path (line 59) force-updates and is immune, but the orphan path (the
first-fold / no-remote path) is not. The templates never delete a pre-existing local state branch
before entering the block.

### 2. A no-op fold aborts (GitHub) or leaks its ref (ADO)

Inside the per-ref fold loop the templates overlay the inbox snapshot's `.squad/` subtree and stage
it, then commit. The GitHub template (lines ~118–127) commits unguarded:

```bash
git add .squad/

GIT_AUTHOR_DATE="$PUB_AT" GIT_COMMITTER_DATE="$PUB_AT" \
  git commit \
    --author="Squad Fold Pipeline <squad-fold@noreply>" \
    -m "fold: $SHORT_REF (alias=$DEV_ALIAS publishedAt=$PUB_AT)"
```

When the snapshot is identical to what the state branch already holds — a re-published or duplicate
inbox ref — `git add .squad/` stages nothing and `git commit` fails with `nothing to commit,
working tree clean`. Under the job's `set -euo pipefail`, that non-zero exit aborts the run. The
abort happens mid-loop, so earlier refs in the same batch have already been folded into local
commits that are then never pushed, and the run reports failure even though the "missing" fold was
a no-op.

The ADO template (lines ~123–138) is more resilient but still wrong for this case: it wraps the
commit in an `if` and, on failure, logs a warning and `git reset --hard`s:

```bash
if GIT_AUTHOR_DATE="$PUB_AT" GIT_COMMITTER_DATE="$PUB_AT" \
  git commit --author="Squad Fold Pipeline <squad-fold@noreply>" \
    -m "fold: $SHORT_REF (alias=$DEV_ALIAS publishedAt=$PUB_AT)"; then
  ENTRY=`jq -n --arg ref "$REF" ... '{ref: $ref, ...}'`
  FOLDED_ENTRIES=`echo "$FOLDED_ENTRIES" | jq --argjson e "$ENTRY" '. + [$e]'`
else
  echo "##vso[task.logissue type=warning]WARNING: Fold commit failed for $REF ..."
  git reset --hard HEAD >/dev/null 2>&1 || true
fi
```

Because a no-op commit lands in the `else`, the ref is **not** added to `$FOLDED_ENTRIES`. It is
therefore not eligible for cleanup (piece 48 sub-proposal B correctly deletes only
`$FOLDED_ENTRIES`), so a redundant, fully-folded inbox ref is left on the remote forever, and each
subsequent run re-discovers it, re-attempts the no-op fold, and re-warns. An already-folded
snapshot is a benign, idempotent no-op — it should be recorded as folded (so its ref is cleaned up)
without producing an empty commit, in both templates.

### 3. No on-demand fold trigger

The GitHub template's triggers (lines 7–12):

```yaml
on:
  push:
    branches:
      - 'squad/inbox/**'
  schedule:
    - cron: '*/15 * * * *'
```

The ADO template's triggers (a `trigger:` on `refs/heads/squad/inbox/*` plus a `schedules:` cron).
Neither exposes a manual trigger. An operator who has just installed the pipeline, fixed a runner,
or wants to fold a backlog immediately has no supported way to start a run except to push a
throwaway inbox ref or wait for the next scheduled sweep (up to fifteen minutes).

### 4. `squad assign` hardcodes the team root at the clone root

`squad init` supports a subfolder/monorepo layout (`packages/squad-cli/src/cli/core/init.ts` lines
57–78): when run inside a subdirectory of an existing git repository it keeps `.squad/` in the
subdirectory and places the coordinator agent file at the git root, and the SDK
(`packages/squad-sdk/src/config/init.ts`) threads that through an `agentFileRoot` option and skips
GitHub Actions workflow placement in that mode (issue #939):

```ts
// Never run `git init` — it creates broken nested repos (#939).
let agentFileRoot = dest; // default: place agent file relative to dest
const parentGitRoot = detectParentGitRepo(dest);
if (parentGitRoot) {
  // ...
  // Place the agent file at the git root so Copilot can find it.
  // Team state (.squad/) stays in cwd — resolved via cwd at runtime.
  agentFileRoot = parentGitRoot;
}
```

That layout — one team-root subdirectory per callsign under a single git repository — is the
natural way for one host to carry several squads. But the warm-path clone side of `squad assign`
(`packages/squad-cli/src/commands/assign.ts` lines 767–775) looks for the team root only at the
clone root:

```ts
// Verify .squad/team.md in the cloned repository. Roll back on failure.
const squadDir = path.join(cloneDest, '.squad');
const teamMdPath = path.join(squadDir, 'team.md');
if (!fs.existsSync(teamMdPath)) {
  try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
  throw new AssignError(
    'ERR_ASSIGN_NO_TEAM_MD',
    `"${cloneDest}" does not contain .squad/team.md. ` +
    'This repository is not a squad host. Clone directory has been removed.',
  );
}
```

So a teammate running `squad assign <callsign> <hostUrl>` against a host whose team root is at
`<callsign>/.squad/` gets `ERR_ASSIGN_NO_TEAM_MD` and the clone is deleted, even though `init`
produced exactly that layout. `assign` cannot onboard the multi-squad host that `init` can build.

---

## Proposed change

## Tier 1

### A. Self-hosted-runner durability in the fold templates

Two template corrections, applied identically to the ADO and GitHub variants and re-synced across
all four copies (`packages/squad-cli/templates/fold/{ado,github}/fold-squad-state.yml` and the
`packages/squad-sdk` mirrors) so they stay byte-identical within each platform.

**A1 — Drop a stale local state branch before the checkout.** Immediately before the
state-branch resolution block, detach `HEAD` and delete any pre-existing local `$STATE_BRANCH`,
tolerant of its absence, so both the `git checkout -B` and the `git checkout --orphan` paths start
from a clean slate on a reused workspace:

```bash
# A workspace-reusing (self-hosted) runner can carry a local $STATE_BRANCH
# from a previous run; detach and drop it so the checkout/--orphan below is
# not blocked by "a branch named ... already exists". Hosted runners start
# clean, so this is a no-op there.
git checkout --detach >/dev/null 2>&1 || true
git branch -D "$STATE_BRANCH" >/dev/null 2>&1 || true
```

This changes no behavior on a clean workspace (the branch does not exist, the delete is a tolerated
no-op) and removes the only failure mode on a reused one.

**A2 — Treat a no-op fold as a recorded skip, not a failed commit.** Guard the per-ref commit with
an empty-diff check. When the staged `.squad/` overlay produces no change (the snapshot is already
folded), skip the commit but still record the ref in `$FOLDED_ENTRIES` (so piece 48's cleanup
deletes the redundant inbox ref) and continue; when there is a change, commit as today. Applied to
both templates so their behavior converges:

```bash
git add .squad/

if git diff --cached --quiet; then
  echo "  $SHORT_REF already folded (no changes) — recording without commit."
else
  GIT_AUTHOR_DATE="$PUB_AT" GIT_COMMITTER_DATE="$PUB_AT" \
    git commit --author="Squad Fold Pipeline <squad-fold@noreply>" \
      -m "fold: $SHORT_REF (alias=$DEV_ALIAS publishedAt=$PUB_AT)"
fi

# record $REF in $FOLDED_ENTRIES on both the committed and no-op paths
```

In the ADO template this replaces the current commit-`if`/`else`-reset shape, folding the no-op
case into the success path (recorded) rather than the warning path (dropped). In both templates a
ref that fails to fold for any *other* reason must still be excluded from `$FOLDED_ENTRIES` and must
not be deleted — only the empty-diff case is reclassified from failure to recorded-skip.

The publish-history commit that follows the loop (the `fold: update publish-history.json` commit)
is unaffected: it always changes `foldTimestamp`, so it is never a no-op; leave it as-is.

### B. Manual on-demand fold trigger

Add a manual trigger to both templates, alongside the existing push and schedule triggers, so an
operator can fold on demand.

- **GitHub:** add a bare `workflow_dispatch:` to the `on:` map. No inputs are required — a manual
  run folds every discovered callsign exactly as the scheduled sweep does.
- **ADO:** the pipeline already runs its full discover-and-fold body on the scheduled trigger with
  no parameters; a manual run in Azure DevOps ("Run pipeline") is available for any YAML pipeline
  and needs no template change to *function*. To make the manual path first-class and parity with
  GitHub, add an empty `parameters: []` block (or a documented note) so the manual-run affordance
  is explicit in the template; the rendered body is unchanged.

Keep the four copies byte-identical within each platform after the edit.

### C. `squad assign` subfolder team-root resolution

Teach the warm-path clone validation in `assign.ts` to find the team root in a callsign-named
subdirectory as well as at the clone root, so a multi-squad host built with `init`'s subfolder mode
can be onboarded. After the clone succeeds, resolve the team-root directory as the first of:

1. `<cloneDest>/.squad/team.md` — the single-squad host (today's behavior, unchanged), then
2. `<cloneDest>/<callsign>/.squad/team.md` — the subfolder team root that `init`'s monorepo mode
   produces for this callsign,

and fail with `ERR_ASSIGN_NO_TEAM_MD` only when neither exists. When the subfolder form resolves,
the registry entry's team-root path (`entry.path`, which ends in `.squad`) and any subsequent
team-root-relative resolution must point at `<cloneDest>/<callsign>/.squad`, not the clone root, so
the assigned clone is registered against the correct subdirectory. The rollback-on-failure and the
error text are preserved; the error message gains the two paths it checked so a mis-typed callsign
or a genuinely non-host repository is diagnosable.

The callsign is already an argument on the warm path, so no new flag is needed; the subfolder name
is the callsign by the convention `init` establishes (`.squad/` placed in the subdirectory the
operator `cd`-ed into). A host that keeps a single squad at the clone root is unaffected.

## Tier 2 (decision)

### D. `install-fold-pipeline` targeting a self-hosting state repository

`install-fold-pipeline` resolves the host repository to write the pipeline into by, in order: a
registry entry whose `clones[]` contains the current repo root (then `path.dirname(entry.path)`);
else a `.squad/config.json` `stateLocation`; else it exits with `Run 'squad assign' to register a
host clone.` (`packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` lines ~167–228). This
is correct for the common topology where the state host is separate from the code clone. But when
the operator is standing **in the state host repository itself** — a repository that already holds
`.squad/` state, is not registered as anyone's code `clones[]` entry, and has no `stateLocation`
indirection to elsewhere — there is no registered clone to resolve *from*, and the command exits
telling the operator to `squad assign`, even though the pipeline's correct destination is the
current repository root.

Decide how `install-fold-pipeline` should behave when the current repository is itself the state
host:

- **D1 (recommended):** when registry and config resolution both come up empty **and** the current
  repo root contains a `.squad/` directory (i.e. it is itself a team-root/state repository),
  target the current repo root directly (resolved via `git rev-parse --show-toplevel`) instead of
  exiting. This confines the self-install path to a repository that is demonstrably a squad state
  repo, and leaves the "stand in a code clone" resolution exactly as it is. No new flag.
- **D2:** add an explicit `--host-root <path>` (or `--here`) opt-in that names the host repository
  directly, and keep today's fail-fast when neither registry, config, nor the flag resolves a
  host. More ceremony, but no implicit behavior change.

Record the decision and rationale in the triage file. If D1 is chosen, `packages/squad-cli/src` is
already in the changeset from C; if D2 is chosen, the new flag is likewise `squad-cli/src`.

---

## Acceptance

- **A1:** a fold run on a workspace that already carries a local `squad/state/<callsign>` branch
  (no such branch on the remote) folds successfully — the stale local branch is dropped and the
  orphan checkout succeeds — where before it aborted with "a branch named … already exists". A
  clean-workspace run is byte-for-byte unchanged in behavior.
- **A2:** a fold of an inbox snapshot whose `.squad/` content equals the current state branch
  produces no empty commit, records the ref in `$FOLDED_ENTRIES`, and (with cleanup enabled) the
  redundant inbox ref is deleted; the run succeeds. A fold that *does* change state still commits.
  A ref that fails to fold for a non-no-op reason is still excluded from `$FOLDED_ENTRIES` and not
  deleted. Both templates exhibit identical behavior for all three cases.
- **B:** a manual run (GitHub `workflow_dispatch`; ADO "Run pipeline") executes the full
  discover-and-fold body and folds every discovered callsign; the four template copies remain
  byte-identical within each platform.
- **C:** `squad assign <callsign> <hostUrl>` against a host whose team root is at
  `<callsign>/.squad/team.md` succeeds and registers the clone against the subfolder team root; a
  host with `.squad/team.md` at the clone root still succeeds unchanged; a repository with neither
  fails `ERR_ASSIGN_NO_TEAM_MD` with an error that names both paths checked, and the clone is
  rolled back.
- **D:** the decided behavior (D1 or D2) is implemented and tested — for D1, `install-fold-pipeline`
  run inside a `.squad/`-bearing state repository with no registry/config resolution installs into
  that repository's root; a directory that is neither a registered clone nor a `.squad/` state repo
  still fails fast.
- Template edits keep all four fold copies byte-identical within each platform (verify with a
  content-equality assertion), and the scrub gate contributes **no new** hits over the piece-48
  base.
