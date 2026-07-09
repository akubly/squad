@Lead and Team, this is the Phase B replay session for piece 49 of the upstream stack.
Phase A staged the piece 49 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 49 this session. No PR creation in Phase B. Piece 49 continues the stack past
piece 48 from a dogfooding pass that stood the fold pipeline up on a **self-hosted CI runner** and
prepared a single host repository to carry **more than one squad**. It closes four gaps: two
self-hosted-runner durability defects in the fold templates, a missing manual fold trigger, and a
`squad assign` team-root-resolution gap that blocks onboarding a multi-squad host. None is a
transport-correctness defect — the fold loop folds correctly on a clean, ephemeral runner and a
single-squad host; these are runner-portability, trigger-affordance, and multi-squad-onboarding
gaps that cost real time during the pass.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-49-self-hosted-fold-runners-and-multi-squad-host-onboarding`
  off `squad/piece-48-host-operability-fold-cleanup-and-doctor-diagnostics` (tip 67d32fd2)
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that
  isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of the clone.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy
specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/41-fold-pipeline-repo-root-and-generic-discovery.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/42-fold-subtree-overlay-and-serialization.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/48-host-operability-fold-cleanup-and-doctor-diagnostics.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/49-self-hosted-fold-runners-and-multi-squad-host-onboarding.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `49-self-hosted-fold-runners-and-multi-squad-host-onboarding.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be staged
before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context. The backlog's "Operational follow-ups" are
host administrative actions, NOT stack pieces — ignore them as implementation scope.

Piece 49 delivers three Tier-1 sub-proposals and one Tier-2 decision. A is a fold-template
durability fix (all four template copies); B is a manual trigger in both templates; C is a
`squad assign` warm-path team-root resolution change. A, B, C are Tier 1 (implement). D is a Tier-2
decision (`install-fold-pipeline` targeting a self-hosting state repository) — triage it first and
either implement D1 (`.squad/`-gated self-install; **recommended**) or D2 (`--host-root`/`--here`
opt-in) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-48 base; do not assume signatures or line numbers.

- The four fold templates `packages/squad-cli/templates/fold/{ado,github}/fold-squad-state.yml`
  and their mirrors `packages/squad-sdk/templates/fold/{ado,github}/fold-squad-state.yml`. Confirm:
  (a) the state-branch resolution block does `git checkout -B "$STATE_BRANCH" "origin/$STATE_BRANCH"`
  when the remote branch exists and `git checkout --orphan "$STATE_BRANCH"` otherwise, and that
  **no** stale-local-branch delete precedes it; (b) the GitHub per-ref commit is invoked unguarded
  after `git add .squad/`, while the ADO per-ref commit is wrapped in an `if …; then record; else
  warn + git reset --hard HEAD`; (c) the `on:`/`trigger:` blocks expose only push + schedule and
  **no** manual trigger; (d) the four copies are byte-identical within each platform. Locate the
  canonical template source and the template-sync script (piece 44/48 kept `squad-cli` and
  `squad-sdk` copies byte-identical via a sync step) — edit the canonical copy and re-sync, do not
  hand-edit four files.
- The per-ref fold loop's `$FOLDED_ENTRIES` accumulation and the piece-48 cleanup that deletes only
  `$FOLDED_ENTRIES` (never `$SORTED_REFS`). A2 must keep that invariant: a no-op fold is *recorded*
  in `$FOLDED_ENTRIES` (so its redundant ref is cleaned up), a genuinely failed fold is still
  *excluded*.
- `squad assign` warm-path clone validation in `packages/squad-cli/src/commands/assign.ts`
  (note: `commands/`, not `cli/commands/`). Confirm the team-root check is
  `const squadDir = path.join(cloneDest, '.squad'); const teamMdPath = path.join(squadDir,
  'team.md');` followed by the `ERR_ASSIGN_NO_TEAM_MD` throw with clone rollback (`fs.rmSync(
  cloneDest, …)`). Confirm how the registry entry's team-root `path` (ending in `.squad`) is
  computed for the assigned clone so C can point it at the subfolder when the subfolder form
  resolves.
- The `init` subfolder/monorepo support this depends on: `packages/squad-cli/src/cli/core/init.ts`
  (`detectParentGitRepo`, `agentFileRoot = parentGitRoot`) and
  `packages/squad-sdk/src/config/init.ts` (`InitOptions.agentFileRoot`, the `isMonorepoSubfolder`
  workflow-skip guard, and the `join(options.agentFileRoot ?? teamRoot, '.github', 'agents', …)`
  agent-file placement). Do not modify `init` — C only needs to mirror the layout it produces
  (`<subdir>/.squad/`).
- `installFoldPipeline` host-root resolution in
  `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` (the registry-entry →
  `path.dirname(entry.path)` path, the `.squad/config.json` `stateLocation` fallback, and the
  `Run 'squad assign' to register a host clone.` exit). D operates here.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-49-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Fold-template self-hosted-runner durability: (A1) detach + `git branch -D "$STATE_BRANCH"` before the checkout/`--orphan` block so a reused workspace's stale local state branch does not abort the orphan checkout; (A2) guard the per-ref commit with `git diff --cached --quiet` so a no-op/idempotent fold skips the commit but is still recorded in `$FOLDED_ENTRIES` (and thus cleaned up), converging the ADO and GitHub behavior; applied to all four template copies, kept byte-identical | Tier 1 | Accept |
| B — Add a manual on-demand fold trigger: `workflow_dispatch:` on the GitHub template; an explicit manual-run affordance on the ADO template (empty `parameters: []` / documented note; rendered body unchanged); four copies byte-identical | Tier 1 | Accept |
| C — `squad assign` subfolder team-root resolution: resolve the team root as `<cloneDest>/.squad/team.md` (today) else `<cloneDest>/<callsign>/.squad/team.md` (the subfolder layout `init` produces), register the entry against the resolved team root, and fail `ERR_ASSIGN_NO_TEAM_MD` only when neither exists — with the error naming both checked paths; single-squad-at-root hosts unchanged | Tier 1 | Accept |
| D — `install-fold-pipeline` self-hosting-repo target: D1 `.squad/`-gated self-install when registry+config resolution are empty and the current repo root holds `.squad/` (**recommended**) vs. D2 explicit `--host-root`/`--here` opt-in | Tier 2 | Decide — record D1 or D2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-49-triage.md` before writing any product
code.

---

## Workflow for piece 49

**a.** Create the implementation branch off piece 48 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-49-self-hosted-fold-runners-and-multi-squad-host-onboarding <worktree-path> squad/piece-48-host-operability-fold-cleanup-and-doctor-diagnostics
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-49-triage.md` before
the first product file is modified.

**c.** Implement TDD: write failing tests first, then implementation, red-to-green. A and B are the
template edits (edit the canonical template source and run the template-sync so all four copies stay
byte-identical — do not hand-edit four files); C is the `squad assign` warm-path resolution change;
D is the decided `install-fold-pipeline` behavior. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes contribute
**no new** hits (compare against the piece-48 base — the count must not grow). The stack's package
scope is `@bradygaster/squad-*`; keep it as-is — do not introduce any internal release scope into
clean files.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched by C, and by D if D1/D2 land
there):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. The fold templates ship in `@bradygaster/squad-cli` and
are mirrored in `@bradygaster/squad-sdk`; because A and B modify the `squad-sdk` template mirror,
also select `patch` for `@bradygaster/squad-sdk`. Summary: "Fold pipeline: drop a stale local state
branch before checkout and treat a no-op fold as a recorded skip (self-hosted-runner durability),
add a manual `workflow_dispatch`/manual-run trigger; `squad assign`: resolve a subfolder
`<callsign>/.squad` team root so a multi-squad host can be onboarded; `install-fold-pipeline`: <D
outcome>."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A/B/C and the D1/D2 outcome), triage outcome, scrub gate
result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-49-self-hosted-fold-runners-and-multi-squad-host-onboarding
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 49 complete.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under `packages/squad-cli/node_modules` and
  shadows the workspace source, remove it so the workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is `tsc --noEmit`
  (no churn).
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
  worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is infra
  flakiness — the "Tests N passed" line is the signal).
- Revert any incidental `package.json` / `package-lock.json` / build-stamp churn (the prebuild
  stamps a version into `package.json` x3 and `.github/agents/squad.agent.md`, and runs
  `sync-templates`) before committing. NOTE: for A and B you DO intend to change the fold templates
  — edit the canonical source and run the template-sync so all four copies stay byte-identical; only
  revert *incidental* unrelated churn.
- Known pre-existing failures on this stack (piece-38 sync/publish J6/J7/M2/O6/N2/PM1/PM2 and assign
  P34.A1/A3) — confirm they remain unchanged; do not attribute them to piece 49. Classify every
  regression-sweep failure as pre-existing-on-base vs. caused-by-this-piece (run the same file on
  the piece-48 base worktree to confirm).

### Sub-proposal A — fold-template self-hosted-runner durability

Two edits in the fold body, applied to both platforms and re-synced across all four copies.

1. **A1 — stale local state branch.** Immediately before the `if git ls-remote --exit-code origin
   "refs/heads/${STATE_BRANCH}" …` block, add:

   ```bash
   git checkout --detach >/dev/null 2>&1 || true
   git branch -D "$STATE_BRANCH" >/dev/null 2>&1 || true
   ```

   Both commands are tolerant of a clean workspace (nothing to detach-from-differently, no branch to
   delete), so a hosted-runner run is behaviorally unchanged. The bug only manifests on the
   `--orphan` (no-remote) path when a local `$STATE_BRANCH` survives from a prior run on a reused
   workspace.

2. **A2 — no-op fold commit.** Replace the unguarded GitHub commit and the ADO commit-`if`/`else`
   shape with a single empty-diff guard that records on both the committed and no-op paths, and
   records into `$FOLDED_ENTRIES` **only** for a successful-or-no-op fold (never for a genuine
   failure):

   ```bash
   git add .squad/
   if git diff --cached --quiet; then
     echo "  $SHORT_REF already folded (no changes) — recording without commit."
   else
     GIT_AUTHOR_DATE="$PUB_AT" GIT_COMMITTER_DATE="$PUB_AT" \
       git commit --author="Squad Fold Pipeline <squad-fold@noreply>" \
         -m "fold: $SHORT_REF (alias=$DEV_ALIAS publishedAt=$PUB_AT)"
   fi
   # then append $REF to $FOLDED_ENTRIES (unchanged jq construction)
   ```

   Preserve the ADO template's handling of a *genuine* fold failure (a commit that fails for a
   non-empty-diff reason must still warn, `git reset --hard`, and be excluded from
   `$FOLDED_ENTRIES`); only the empty-diff case moves from failure to recorded-skip. After the edit,
   the ADO and GitHub fold bodies converge on this behavior. Do not touch the post-loop
   `fold: update publish-history.json` commit (it always changes `foldTimestamp`).

Tests: template-content assertions on the four copies — the stale-branch delete precedes the
checkout block in both platforms; the per-ref commit is guarded by `git diff --cached --quiet` in
both platforms; the four copies are byte-identical within each platform. If the repo has an
executable fold-template harness (piece 41/42/48 added shell-level fold tests), add: (i) a reused
workspace carrying a local `$STATE_BRANCH` with no remote branch folds green; (ii) a re-published
identical snapshot records the ref, produces no empty commit, and (with cleanup on) deletes the
redundant ref; (iii) a snapshot that changes state still commits.

### Sub-proposal B — manual fold trigger

- **GitHub template:** add `workflow_dispatch:` to the `on:` map (no inputs). Keep the existing
  `push` and `schedule` triggers.
- **ADO template:** add an explicit manual-run affordance. An ADO YAML pipeline is manually runnable
  by default, so the functional change is minimal; make it first-class and parity with GitHub by
  adding an empty `parameters: []` block (or a clearly-commented note) without altering the rendered
  fold body. Keep the schedule/trigger blocks intact.

Tests: template-content assertions — GitHub template contains `workflow_dispatch`; both templates
retain push + schedule; four copies byte-identical within each platform.

### Sub-proposal C — `squad assign` subfolder team-root resolution

In the warm-path clone validation, after the clone succeeds, resolve the team-root directory in
precedence order and register against it:

```ts
const rootTeamMd = path.join(cloneDest, '.squad', 'team.md');
const subDirTeamMd = path.join(cloneDest, callsign, '.squad', 'team.md');
let resolvedSquadDir: string | undefined;
if (fs.existsSync(rootTeamMd)) {
  resolvedSquadDir = path.join(cloneDest, '.squad');
} else if (fs.existsSync(subDirTeamMd)) {
  resolvedSquadDir = path.join(cloneDest, callsign, '.squad');
}
if (!resolvedSquadDir) {
  try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
  throw new AssignError(
    'ERR_ASSIGN_NO_TEAM_MD',
    `"${cloneDest}" does not contain .squad/team.md (checked ` +
    `"${rootTeamMd}" and "${subDirTeamMd}"). This repository is not a squad host. ` +
    'Clone directory has been removed.',
  );
}
```

Then thread `resolvedSquadDir` into wherever the assigned entry's team-root `path` and any
subsequent team-root-relative work is computed (today that is `path.join(cloneDest, '.squad')`), so
the registry entry points at the subfolder `.squad` when the subfolder form resolved. Do **not**
scan for arbitrary `*/.squad/team.md` — resolve only the callsign-named subdirectory (the layout
`init` produces), so two squads in one host never collide and the resolution stays deterministic.

Tests (in the assign warm-path suite): a host fixture with `.squad/team.md` at the clone root →
assigns as today (regression); a host fixture with `<callsign>/.squad/team.md` → assigns, and the
registered entry's team-root path is the subfolder `.squad`; a host fixture with neither →
`ERR_ASSIGN_NO_TEAM_MD` naming both checked paths, clone rolled back; a host fixture with a
*differently*-named subdirectory (not the callsign) → still fails (no arbitrary scan). Confirm the
cold-start (URL-only) path and the existing origin/refcount behavior are unchanged.

### Sub-proposal D — `install-fold-pipeline` self-hosting-repo target (decision)

Default recommendation **D1**: in the host-root resolution, when the registry-entry lookup and the
`.squad/config.json` `stateLocation` fallback both yield nothing, check whether the current repo
root (already resolved via `git rev-parse --show-toplevel` for the registry lookup) contains a
`.squad/` directory; if it does, target that repo root directly instead of exiting with `Run 'squad
assign' …`. This confines the self-install path to a repository that is demonstrably a squad
team-root/state repo and leaves the separate-host resolution (registry entry → `dirname(entry.path)`
→ config `stateLocation`) untouched. No new flag.

If **D2** is chosen instead: add an explicit `--host-root <path>` (or `--here`) option that names the
host repository directly; when neither registry, config, nor the flag resolves a host, keep today's
fail-fast. Record the decision and rationale in the triage file.

Tests: D1 — `install-fold-pipeline` run inside a `.squad/`-bearing state repository with no matching
registry entry and no `stateLocation` installs into that repo root; a directory that is neither a
registered clone nor a `.squad/` state repo still fails fast with the `squad assign` guidance. D2 —
`--host-root`/`--here` targets the named repo; absent it, fail-fast unchanged.
