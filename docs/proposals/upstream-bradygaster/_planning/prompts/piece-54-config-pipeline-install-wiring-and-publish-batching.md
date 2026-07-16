@Lead and Team, this is the Phase B replay session for piece 54 of the upstream stack.
Phase A staged the piece 54 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 54 this session. No PR creation in Phase B. Piece 54 continues the stack past
piece 53 from a dogfooding pass that stood up a real Pole-A shared squad on a **self-hosted Windows CI
host** and re-homed a live production squad onto it. The durable review loop that piece 53 designed
does not close in the field: the config pipeline **template exists but is never installed**, and even
once installed it **pins `ubuntu-latest`** so it cannot run on a self-hosted-only host; the publish
path is **O(2·N) serial git spawns** (a 696-file push measured 214 s and looks hung); and
`--push-config --dry-run` previews the **wrong lane**. Piece 54 makes 53's loop actually deployable,
runnable, and fast.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-54-config-pipeline-install-wiring-and-publish-batching`
  off `squad/piece-53-hands-off-durable-review-config-inbox-and-auto-pr` (tip `8738741a`)
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of the clone.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs
into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/50-subfolder-host-and-self-hosted-runner-hardening.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/52-infra-only-main-and-durable-config-lane.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/53-hands-off-durable-review-config-inbox-and-auto-pr.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/54-config-pipeline-install-wiring-and-publish-batching.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `54-config-pipeline-install-wiring-and-publish-batching.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be staged before
this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context. The backlog's "Operational follow-ups" are host
administrative actions, NOT stack pieces — ignore them as implementation scope. In particular, the dead
ADO fold and the admin-owned-clone hydrate friction are operational, not piece-54 scope.

Piece 54 delivers four Tier-1 sub-proposals and two Tier-2 decisions. A is config-pipeline install
wiring; B is `--runner` parity for the config template; C is batched publish git-spawns; D is a
lane-correct `--push-config --dry-run`. E (install command surface) and F (`.gitignore` placement) are
Tier-2 decisions — triage them first and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-53 base; do not assume signatures or line numbers.

- **The config pipeline template already exists.** Confirm
  `packages/squad-cli/templates/fold/{github,ado}/fold-squad-config.yml` and their
  `packages/squad-sdk/...` mirrors (plus any root `templates/` and `.squad-templates/` copies) are
  present on the base, and read the GitHub one: confirm it triggers on `push:
  squad/config-inbox/**`, opens a PR into `squad/config/<callsign>` (never force-push), genesis-seeds
  the config branch when absent, and **hardcodes `runs-on: ubuntu-latest`** with no
  `defaults.run.shell`. Piece 54 does NOT rewrite this template's body — A installs it, B adds the
  `--runner` render only.
- `installFoldPipeline` in `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts`: confirm it
  writes only `fold-squad-state.yml`, and locate (a) the host-root resolution (registry entry →
  `dirname(entry.path)`; `.squad/`-at-root and `<callsign>/.squad/team.md` self-install — piece 50 §D),
  (b) the callsign parameterization block, (c) the three-way idempotency/conflict gate, and (d) the
  `applyRunner` helper (piece 50 §F) and how it renders `runs-on` + `defaults.run.shell`. A reuses
  (a)–(c); B reuses (d).
- `installHostGitignore` / `migratePoleBToA` in the same file: confirm where the Pole-A `.gitignore` is
  written (root git-root vs subfolder) and that genesis (`seedConfigOrphan`) runs there. F builds on
  this; confirm the current placement empirically before choosing F1/F2.
- `publishTeamRootToInbox` and `seedConfigOrphan` in
  `packages/squad-cli/src/cli/commands/sync.ts`: confirm the per-file loop runs
  `git hash-object -w --stdin` **and** `git update-index --add --cacheinfo` per path against an isolated
  `GIT_INDEX_FILE`, with `write-tree` + `commit-tree` as single spawns after. Confirm the git version
  behavior for `hash-object --stdin-paths` (and `-z`) and `update-index --index-info` on the CI/dev
  git. C replaces the loop; the resulting tree SHA must be identical.
- The `--push-config` publish and its `--dry-run` in `sync.ts`: locate the lane selection (allowlist +
  inbox prefix + remote) for the real publish, and confirm the `--dry-run` path currently reuses the
  ephemeral selection regardless of `--push-config`. D factors one lane resolver used by both.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-54-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Install the config pipeline alongside the fold pipeline: render + write `fold-squad-config.yml` next to `fold-squad-state.yml` reusing the existing host-root resolution, callsign parameterization, and three-way idempotency gate; callsign-generic by default, `--callsign`-scoped when supplied. | Tier 1 | Accept |
| B — `--runner` parity for the GitHub config template: reuse `applyRunner` so `--runner "<labels>"` renders `runs-on: [<labels>]` + (non-Linux) `defaults.run.shell: bash`; default rendering byte-identical to base (`ubuntu-latest`). ADO config template unchanged. | Tier 1 | Accept |
| C — Batch the publish git-spawns: one `git hash-object -w --stdin-paths` for all blobs + one `git update-index --index-info` for all staging, replacing the O(2·N) per-file loop in `publishTeamRootToInbox` and `seedConfigOrphan`; identical resulting tree SHA. | Tier 1 | Accept |
| D — Lane-correct `--push-config --dry-run`: preview the `CONFIG_ALLOWLIST` set + `squad/config-inbox/<callsign>/…` target + config remote via one lane resolver shared with the real publish. | Tier 1 | Accept |
| E — Config-pipeline install command surface: E1 one command writes both pipelines (optional `--state-only`/`--config-only`) (**recommended**) vs E2 a separate `install-config-pipeline`. | Tier 2 | Decide — record E1 or E2 with rationale |
| F — Canonicalize subfolder `.gitignore` placement: F1 single root-git-root managed block with one `<prefix>.squad/` line per callsign, migrating a legacy subfolder managed block (**recommended**) vs F2 per-subfolder `.gitignore`; either way `init` + `install-fold-pipeline` must be consistent and idempotent. | Tier 2 | Decide — record F1 or F2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-54-triage.md` before writing any product
code.

---

## Workflow for piece 54

**a.** Create the implementation branch off piece 53 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-54-config-pipeline-install-wiring-and-publish-batching <worktree-path> squad/piece-53-hands-off-durable-review-config-inbox-and-auto-pr
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-54-triage.md` before the
first product file is modified.

**c.** Implement TDD: write failing tests first, then implementation, red-to-green. A/C/D are
`packages/squad-cli/src` changes; B is a template-render change (edit the canonical `applyRunner`
call-site / template plumbing and re-sync so all config-template copies stay byte-identical — do not
hand-edit the mirror copies); F touches `init` and `install-fold-pipeline` gitignore handling. See
implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes contribute
**no new** hits (compare against the piece-53 base — the count must not grow). The stack's package
scope is `@bradygaster/squad-*`; keep it as-is — do not introduce any internal release scope into
clean files.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched by A/C/D/F and the config
template is re-rendered by B):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Because B re-renders the `squad-sdk` config-template
mirror, also select `patch` for `@bradygaster/squad-sdk`. Summary: "install-fold-pipeline: also deploy
the durable config pipeline (config-inbox → auto-PR consumer) with `--runner` parity so it runs on a
self-hosted host; sync publish: batch blob-hash + index-stage into two spawns (was O(2·N)); `sync
--push-config --dry-run`: preview the durable lane; canonicalize Pole-A `.gitignore` placement."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A–D and the E/F outcomes), triage outcome, scrub gate result,
and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-54-config-pipeline-install-wiring-and-publish-batching
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 54 complete.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under `packages/squad-cli/node_modules` and
  shadows the workspace source, remove it so the workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is `tsc --noEmit`.
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
  worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is infra
  flakiness — the "Tests N passed" line is the signal).
- Revert incidental `package.json` / `package-lock.json` / build-stamp churn before committing. For B
  you DO intend to re-render the config template copies via the template-sync — edit the canonical
  source / render plumbing and re-sync so all copies stay byte-identical; only revert *incidental*
  unrelated churn.
- Known pre-existing failures on this stack (piece-38 sync/publish J6/J7/M2/O6/N2/PM1/PM2 and assign
  P34.A1/A3) — confirm they remain unchanged; do not attribute them to piece 54. Classify every
  regression-sweep failure as pre-existing-on-base vs. caused-by-this-piece (run the same file on the
  piece-53 base worktree to confirm).

### Sub-proposal A — install the config pipeline

Factor the single-template install (render → three-way idempotency gate → write) into a helper keyed by
`{ templateName, filename, callsignSubstitutions }`, then call it for `fold-squad-state.yml` and (per
the E decision) `fold-squad-config.yml`. Keep `installHostGitignore` (genesis + Pole-A ignore) called
exactly once regardless of pipeline count. The config template's callsign substitutions mirror the
fold's but target the config lane: scope the `push: squad/config-inbox/**` trigger to
`squad/config-inbox/<callsign>/**` and any `squad/config/<callsign>` references when `--callsign` is
given; generic otherwise. Tests: a host install writes both pipeline files; re-run is idempotent per
file (unchanged file → "already installed and up to date"; differing file → conflict unless `--force`,
which backs up only the differing file); `--callsign` scopes both; a non-squad repo still fails fast.

### Sub-proposal B — `--runner` parity for the config template

Reuse the piece-50 §F `applyRunner` on the config template's `runs-on`/`defaults.run.shell`. The config
job id is `open-config-pr` (confirm), so inject `defaults.run.shell: bash` at that job for a non-Linux
label set. Absent `--runner`, output is byte-identical to the base template. Tests:
`--runner "self-hosted,Windows,X64"` → `runs-on: [self-hosted, Windows, X64]` + `defaults.run.shell:
bash` in the installed config file; no flag → `ubuntu-latest`, no `defaults.run.shell`; assert the fold
and config templates share one `applyRunner` (a single change moves both).

### Sub-proposal C — batch the publish git-spawns

Replace the per-file loop with: (1) `git hash-object -w --stdin-paths` fed the absolute file paths
(one per line; prefer `-z` NUL-delimited if the git version supports it, else guard against paths with
newlines), reading back SHAs in input order; (2) build the index manifest lines
`<mode> <sha>\t<relpath>` and pipe them to `git update-index --index-info` (single spawn) against the
isolated `GIT_INDEX_FILE`. Keep the mode (`100644`), path normalization (forward-slash `.squad/…`), and
content exactly as today so `write-tree` yields the **same tree SHA**. Tests: build the same multi-file
fixture (mix of nested paths, a large file, CRLF content) via the old per-file path and the new batched
path and assert identical `write-tree` SHA; assert the batched path spawns a small constant number of
git processes (spy/wrap `execFileSync`, expect ≤ 4); a ≥100-file fixture publishes without per-file
fan-out. Apply the same batching to `seedConfigOrphan`.

### Sub-proposal D — lane-correct `--push-config --dry-run`

Introduce one `resolvePublishLane(opts)` → `{ allowlistPredicate, inboxPrefix, remote }` returning the
durable lane for `--push-config` (`CONFIG_ALLOWLIST`, `squad/config-inbox`, `configRemote`) and the
ephemeral lane otherwise (`PUBLISH_ALLOWLIST`, `squad/inbox`, `stateRemote`). Use it in both the
dry-run preview and the real publish so they cannot diverge. Tests: `--push-config --dry-run` prints
the `CONFIG_ALLOWLIST` pending set and a `squad/config-inbox/<callsign>/…` target with the config
remote; `--push --dry-run` is unchanged; a fixture with both durable and ephemeral pending changes
shows only the lane-appropriate subset in each mode.

### Sub-proposal E — install command surface (decision)

If E1: `installFoldPipeline` writes both templates by default; add `--state-only` / `--config-only`
guards for the escape hatches; the help text names both pipelines. If E2: add a sibling
`install-config-pipeline` command wired through the CLI entrypoint that reuses the same host resolution
and the A helper. Either way, the config consumer must be one documented command away, and the default
onboarding must not leave a host with a fold but no config consumer. Record the choice in the triage
file.

### Sub-proposal F — canonicalize `.gitignore` placement (decision)

If F1: write/maintain a single managed block in the host git-root `.gitignore` with one
`<prefix>.squad/` line per callsign (root → `.squad/`; subfolder → `<callsign>/.squad/`); when a legacy
subfolder `<callsign>/.gitignore` managed block is found, remove it (leaving any non-managed user lines
intact). If F2: keep per-subfolder files but make writes idempotent and de-duplicated. Make both `init`
and `install-fold-pipeline` converge on the chosen shape; a re-run must not duplicate or fight an
existing managed block. Tests: fresh subfolder host → the chosen shape; re-run → no change (idempotent);
a host carrying the legacy shape → migrated (F1) or de-duplicated (F2) without touching user lines.
