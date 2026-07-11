# Dogfood backlog — fold pipeline and cross-repo transport

Internal planning artifact (not a shipped upstream document). Tracks work discovered while
dogfooding the cross-repo publish → fold → pull loop, mapped to replay-stack pieces. Each
planned piece lists an intent and assertion-shaped candidate outcomes so a Phase-B session
can pick it up directly. Bug classes are described generically; concrete host/tenant
specifics stay out of this file (and out of the stack).

**Replay guardrails (every piece below):** author the spec on `akubly/upstream-specs`
first (Phase A); implement on a branch stacked off the previous piece in an isolated
worktree, fully tested, **no PR** (Phase B); edit the canonical `.squad-templates/` and
re-sync mirrors (keep all template copies byte-identical); run the scrub gate and
contribute **no new** hits; use the `@bradygaster/squad-*` scope and generic
`dev.azure.com/contoso/MyProject` placeholders; single squashed commit with the
`Co-authored-by: Copilot ...` trailer.

Status legend: **shipped** (on a replay branch) · **specced** (design on the spec branch,
not yet implemented) · **planned** (candidate, no spec yet) · **operational** (host action,
not a stack piece).

---

## Delivered by piece 41 (shipped — verify on next dogfood cycle)

Piece 41 (`squad/piece-41-fold-pipeline-repo-root`) absorbed several dogfood findings.
These need no new piece; confirm them in the next end-to-end dogfood run.

| Finding (class) | How piece 41 resolves it |
|---|---|
| Install target resolved from the entry's parent dir, wrong for a host that nests squad state in a callsign subdirectory | Resolve the install target to the git repo root via `git rev-parse --show-toplevel` (sub-proposal A) |
| A single-callsign scoped pipeline is insufficient for a host aggregating several callsigns in one repo | Default pipeline is callsign-generic: one definition discovers callsigns at run time and folds each into its own `squad/state/<callsign>` (sub-proposal B) |
| `publish-history.json` that is present-but-empty produced "nothing to commit" / dropped all folds | Self-heal missing/empty/non-array history to `[]`; always write a valid array (sub-proposal D) |
| A failed fold could still record/push (custom gating overrode the implicit success gate) | Fold body under `set -euo pipefail`; a ref is recorded only inside a successful commit; history rewrite validated before push (sub-proposal D) |
| Concurrent runs racing the same state branch (GitHub) | Workflow-level `concurrency` group, no cancel-in-progress (sub-proposal D) |

---

## Specced (design on the spec branch — ready for Phase B)

### Piece 42 — Fold subtree overlay and serialization

`docs/proposals/upstream-bradygaster/42-fold-subtree-overlay-and-serialization.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Replace the `.squad/` subtree placement (`read-tree --prefix=.squad/`, which fails once the state branch already contains `.squad/`) with a `git archive | tar -x` overlay that excludes the pipeline-owned `publish-history.json` |
| B (Tier 2, decision) | Run-level serialization of the Azure DevOps fold — exclusive-lock Environment (recommended, onboarding cost) vs. retain `batch: true` + `--force-with-lease` |

### Piece 43 — Cross-repo state remote and branch resolution

`docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Resolve the cross-repo `sync --pull` state remote from the registry/team-root host (entry `stateRemote`, else the host clone's remote), never the code clone's origin |
| B (Tier 1) | When a registry entry has no explicit `stateBranch` but carries a callsign, derive `squad/state/<callsign>` (the pipeline's namespaced target) via the existing `CALLSIGN_RE` instead of the flat legacy branch |
| C (Tier 1) | A cross-repo `sync --pull` no longer runs the in-clone fetch against the code clone (no misleading "no remote squad-state refs" warning); hydration from the state ref is the sole source |
| D (Tier 2, decision) | Fallback when an entry has neither `stateBranch` nor a callsign — retain the flat `squad-state` legacy default (recommended) vs. fail fast with a teaching error |

### Piece 44 — Pipeline-file injection hygiene on shared hosts

`docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Scoped `install-fold-pipeline --callsign` writes a distinct, callsign-named `fold-squad-state.<callsign>.yml` (reusing `CALLSIGN_RE`) so two scoped installs on one repository no longer collide on the fixed filename; the default install is unchanged |
| B (Tier 1) | The cross-repo `sync` pipeline injection resolves a single canonical pipeline path (callsign-named preferred, ADO-before-GitHub tiebreak) and embeds only that one, so a stale alternate-directory copy is never carried into the published snapshot |
| C (Tier 2, decision) | Whether the scoped install also removes a stale alternate-directory copy — leave it in place and rely on B's single-embed (recommended) vs. remove the superseded copy |

### Piece 45 — Post-commit hook entrypoint resolution

`docs/proposals/upstream-bradygaster/45-post-commit-hook-entrypoint-resolution.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | The cross-repo post-commit hook resolves the CLI entrypoint at install time (`process.execPath` + the `cli-entry` located via `fileURLToPath(import.meta.url)`) and embeds a `<node> <cli-entry> sync --push --quiet` invocation — POSIX-shell-quoted and Windows-absolute-path-safe — in both host and product variants via builder functions, instead of a bare `squad` resolved from the global `PATH`, so the hook runs the same CLI build that installed it; the `SQUAD_SYNC_ACTIVE` guard, host `.squad/`-filter, and marker idempotency are preserved |
| B (Tier 2, decision) | Fallback when the entrypoint cannot be resolved at install time — resolve-with-fallback-to-bare-`squad` so the install never breaks (recommended) vs. hard-require a resolved entrypoint |

### Piece 46 — State-remote resolution hardening and pull/push transport coverage

`docs/proposals/upstream-bradygaster/46-state-remote-resolution-hardening-and-transport-coverage.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Harden `resolveRemote(cwd)` to a deterministic precedence — the branch's tracking remote; else, when exactly one remote is configured, that remote; else `origin` only when `origin` actually exists; else fail with an actionable `SquadError` directing the operator to set `stateRemote` — instead of silently returning a literal `origin` that may not exist; every call site is kept intact and a cross-repo sync does not throw on an unrelated code-clone remote |
| B (Tier 1) | New integration test: a cross-repo `sync --pull` against a REAL bare state remote whose branch is `squad/state/<callsign>` (derived from the callsign, no explicit `stateBranch`) hydrates `.squad` files into the team-root via a real git fetch — `_transport` is not mocked |
| C (Tier 1) | New integration test: a cross-repo `sync --push` against a REAL bare host remote that is NOT named `origin` (remote resolved per A, no explicit `stateRemote`) publishes the inbox ref to that remote via a real git push — `_transport` is not mocked |
| D (Tier 1) | Focused unit test pinning `deriveStateBranch`'s flat `squad-state` fallback for every invalid callsign shape (uppercase, underscore, dot, leading digit, over-length); `deriveStateBranch` is unchanged (coverage only) |
| E (Tier 2, decision) | Ambiguous resolution (no tracking remote, no `origin`, more than one remote) — fail with an actionable error naming `stateRemote` (recommended) vs. fall back to the first-listed remote |

### Piece 47 — Monorepo team-root git-dir resolution and sync registry robustness

`docs/proposals/upstream-bradygaster/47-monorepo-gitdir-and-sync-registry-robustness.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Resolve the team root's real git directory via `git rev-parse --absolute-git-dir` (cwd = teamRoot) and place the isolated publish index inside it in `publishTeamRootToInbox`, instead of assuming a literal `<teamRoot>/.git` — fixes a live-reproduced monorepo `--push` failure where the team root is a subdirectory and the real `.git` is at the repo root |
| B (Tier 1) | Use that same resolved git directory as the `--git-dir` for the `ls-tree` / `cat-file` calls in `hydrateTeamRootFromStateRef` (the pull-side sibling of A) so a monorepo subdirectory team root hydrates correctly |
| C (Tier 1) | Thread `--registry-path` through `sync` into every `loadRegistryFromDisk({ registryPath })` call (the SDK helper already accepts it and `init` honours it; `sync` currently ignores it and always reads the default registry); default behaviour unchanged when absent |
| D (Tier 2, decision) | `SQUAD_TEAM_ROOT` override + registry-sourced callsign/state — augment the override from a matching registry entry (best-effort, env-only fallback when none matches; recommended) vs. add explicit `--callsign`/state flags to `sync`, so a cross-repo `--push` from an env-overridden team root no longer fails the callsign guard |

### Piece 48 — Shared-host operability: install-fold ergonomics, fold inbox-branch cleanup, and doctor host/payload diagnostics

`docs/proposals/upstream-bradygaster/48-host-operability-fold-cleanup-and-doctor-diagnostics.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Wire the already-declared `install-fold-pipeline --force` option into the conflict gate so a `present+differ` pipeline file is overwritten (with a `.bak` backup) in one step instead of hard-exiting with "delete it manually"; `absent` / `present+match` / no-`--force` behaviour unchanged |
| B (Tier 1) | Fix the fold templates' inbox-branch cleanup to delete only **successfully-folded** refs (the `$FOLDED_ENTRIES` set, never the full discovered `$SORTED_REFS`) so a failed-fold snapshot is never deleted unfolded, and add `install-fold-pipeline --delete-folded-refs` to enable cleanup at install time (default stays off); applied to all four template copies (squad-cli + squad-sdk, ado + github), kept byte-identical |
| C (Tier 1) | `squad doctor` host-repo diagnostics: when the current directory resolves to a registered clone whose shared-squad host is elsewhere, warn on a missing host `.squad/`, a missing/empty host fold-pipeline YAML (the gap that silently disables folding), and a missing in-repo `squad.agent.md` — actionable, best-effort, never firing for a single-repo/local squad |
| D (Tier 1) | Accurate orphan-payload callsign attribution in `doctor`: resolve the owning callsign against known callsigns/source payload names instead of a last-hyphen split (so `squad-probe-agent-collaboration` → `probe`, not `probe-agent`) and flag doubly-prefixed re-namespaced payloads (`squad-<cs>-squad-…`) as orphans rather than silently treating them as owned |
| E (Tier 2, decision) | `install-fold-pipeline` destination-directory creation — registry-gated auto-create (create only on a registry-confirmed host; recommended) vs. an explicit `--create-dirs` opt-in, replacing the unconditional fail-fast on a missing `.azuredevops`/`.github/workflows` directory |
| F (Tier 1) | Compliant fold state-branch write-back identity: the ADO fold pushes folded state under the implicit `System.AccessToken`, which only works after a manually-granted Project Build Service **Contribute** on the state branch — the over-privileged build-service-account pattern flagged by the "Securing Azure DevOps Build Service Accounts" control. Add an opt-in `install-fold-pipeline --fold-service-connection <name>` that renders the ADO template to push under an ADO service connection (managed-identity / service-principal backed, `aka.ms/azdosc`) for a per-resource least-privilege identity; default rendering stays byte-identical to today, and the setup docs document both the minimum-permission path and the compliant alternative (generic `dev.azure.com/contoso/MyProject` placeholder, no internal portal URL) |
| G (Tier 1) | De-overload `squad assign` warm-path origin-collision disambiguation: when the current clone's remotes also match ≥2 *other* squads' recorded origins, the guard throws `ERR_ASSIGN_ORIGIN_AMBIGUITY` and the only value that clears it is the callsign already given positionally (`squad assign teamx --callsign teamx`) — because `--callsign` is overloaded (its cold-start role is to name the registration callsign for a URL assign). Make the warm path assign to the positional target without a redundant `--callsign`, add a purpose-named `--allow-origin-collision` opt-in for the genuine multi-match case, and make the error name the colliding squads, the target, and the remediation; cold-start `--callsign` semantics unchanged |

### Piece 49 — Self-hosted fold runners and multi-squad host onboarding

`docs/proposals/upstream-bradygaster/49-self-hosted-fold-runners-and-multi-squad-host-onboarding.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Fold-template self-hosted-runner durability, all four copies byte-identical: (A1) detach and `git branch -D "$STATE_BRANCH"` before the checkout/`--orphan` block so a workspace-reusing (self-hosted) runner's stale local state branch does not abort the first-fold orphan checkout with "a branch named … already exists" (hosted runners start clean, so it is a no-op there); (A2) guard the per-ref commit with `git diff --cached --quiet` so an idempotent/already-folded snapshot skips the empty commit but is still recorded in `$FOLDED_ENTRIES` (and thus cleaned up), converging the GitHub template (which aborts the run today) with the ADO template (which drops the ref today) — a genuine fold failure is still excluded and not deleted |
| B (Tier 1) | Add a manual on-demand fold trigger: `workflow_dispatch:` on the GitHub template and an explicit manual-run affordance on the ADO template (rendered fold body unchanged), so an operator can fold immediately instead of pushing a throwaway inbox ref or waiting up to fifteen minutes for the scheduled sweep; four copies byte-identical |
| C (Tier 1) | `squad assign` subfolder team-root resolution: the warm-path clone validation resolves the team root as `<cloneDest>/.squad/team.md` (today) else `<cloneDest>/<callsign>/.squad/team.md` (the per-callsign subfolder layout that `init`'s monorepo/`agentFileRoot` mode already produces, #939), registers the entry against the resolved team root, and fails `ERR_ASSIGN_NO_TEAM_MD` — naming both checked paths — only when neither exists; closes the init↔assign asymmetry that blocks onboarding a multi-squad host; single-squad-at-root hosts unchanged; no arbitrary `*/.squad` scan |
| D (Tier 2, decision) | `install-fold-pipeline` targeting a self-hosting state repository — D1 `.squad/`-gated self-install (when registry-entry and `.squad/config.json` `stateLocation` resolution are both empty and the current repo root holds `.squad/`, target the current repo root via `git rev-parse --show-toplevel` instead of exiting with the `squad assign` guidance; recommended) vs. D2 an explicit `--host-root`/`--here` opt-in |

### Piece 50 — Subfolder-host and self-hosted-runner hardening

`docs/proposals/upstream-bradygaster/50-subfolder-host-and-self-hosted-runner-hardening.md`

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Cross-repo `sync` resolves the effective state remote in the team-root/host-clone git context: use the registry `stateRemote` only when it exists in that context, else fall back to `resolveRemote(teamRoot)` (the host clone's `origin`), else fail with an error naming the host git root and remediation — fixes the opaque `'<remote>' does not appear to be a git repository` when the operator added the state remote to the product clone; single-repo path unchanged |
| B (Tier 1) | CRLF-safe fold-ref cleanup: `tr -d '\r'` + `${REF%$'\r'}` in the `--delete-folded-refs` loop (and defensively in the other refspec-feeding `jq \| while read` loops) so the first ref in a multi-ref batch on a self-hosted Windows runner is no longer passed as an invalid refspec and orphaned; all four template copies byte-identical |
| C (Tier 1) | `squad assign` installs the host-side cross-repo hook at the host git root resolved via `git rev-parse --show-toplevel` (cwd = resolved team root) instead of `dirname(entry.path)`, so a subfolder-hosted squad (`<hostRoot>/<callsign>/.squad`) installs the hook at `<hostRoot>` instead of failing "not a git repository root"; closes the hook-side half of the init↔assign subfolder asymmetry piece 49 §C opened |
| D (Tier 1) | `install-fold-pipeline` self-install (piece 49 §D1) also recognizes a `<callsign>/.squad/team.md` subfolder host, not only a root-level `.squad/`, and installs at the git root; a non-squad repo still fails fast with the `squad assign` guidance |
| E (Tier 1) | `squad doctor` subfolder-host accuracy: (E1) resolve `.github/agents/squad.agent.md` against `git rev-parse --show-toplevel` not the cwd; (E2) suppress the "Local `.squad/` directory found" advisory for a registered team root (incl. the subfolder form), keeping it for an unregistered stray |
| F (Tier 2, decision) | `install-fold-pipeline` self-hosted runner target — F1 `--runner "<labels>"` renders `runs-on: [<labels>]` + `defaults.run.shell: bash` for non-Linux labels (recommended) vs. F2 keep `ubuntu-latest` and document the manual edit |

### Piece 51 — Publish-allowlist completion and team-root state hygiene

`docs/proposals/upstream-bradygaster/51-publish-allowlist-completion-and-team-root-state-hygiene.md`

Topology-agnostic; prerequisite for the Pole-A pieces 52–53. Completes the ephemeral/scratch
classification so every mutable team-root path has a defined home (fold or gitignore).

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Extend `PUBLISH_ALLOWLIST` for unambiguous append-only state: EXACT `history.md`, `orchestration-log.md`, `casting-history.json`, `casting-registry.json`; PREFIX `casting/`, `files/onboarding/` — so these no longer drift permanently between clones |
| B (Tier 2, decision) | Fold per-agent `agents/<name>/history.md` without folding the durable `agents/<name>/charter.md` — B1 a suffix/glob allowlist matcher (recommended) vs. B2 relocate histories under a folded `history/agents/` prefix |
| C (Tier 1) | Declare machine-local scratch (`raw-agent-output.md`, `run-output.md`, `publish-metadata.json`) and pipeline-owned `publish-history.json` in the managed `.gitignore`, and assert `publish-history.json` is excluded from every publish snapshot (fold pipeline is its sole writer) |
| D (Tier 1) | `install-fold-pipeline` installs the same allowlist-aware `.gitignore` that `init` does (shared idempotent helper), closing the leak where a host onboarded only via `install-fold-pipeline` has no `.gitignore` and a `git add -A` sweeps folded state onto the product branch; never a blanket `.squad/` here (that is piece 52) |
| E (Tier 2, decision) | `casting-registry.json` fold semantics — E1 fold last-writer-wins (recommended) vs. E2 machine-local (gitignore, never fold) |

### Piece 52 — Infra-only main and the durable config lane (Pole A)

`docs/proposals/upstream-bradygaster/52-infra-only-main-and-durable-config-lane.md`

Pole-A pivot: **no squad content or state lands on `main`.** Reverses `init`'s Sub-proposal J intent
(durable-on-`main`). Establishes topology + durable storage; the transport is piece 53.

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | Under the orphan backend, `init` and `install-fold-pipeline` write a **blanket** team-root `.squad/` ignore (`applyBlanketGitignore`) instead of the allowlist-scoped one; `main` retains only the fold workflow, the `.gitignore`, and a README; provide a one-time Pole-B→Pole-A migration (`git rm -r --cached`, seed the config orphan, commit infra-only `main`) |
| B (Tier 1) | Introduce the durable orphan `squad/config/<callsign>` (no `main` ancestor, tree = durable `.squad/**` only) and a genesis seeding step (commit-tree plumbing); the branch advances only by reviewed merge (piece 53); register `configBranch`/`configRemote` on the entry |
| C (Tier 1) | Define `CONFIG_ALLOWLIST` (durable: charters, roster, routing, `config.json`, templates, process docs) as the deterministic complement of piece 51's ephemeral+scratch partition; a total, disjoint classifier test asserts every path is in exactly one lane (guard against future category-3 drift) |
| D (Tier 2, decision) | Uniform vs. hybrid infra-only rule — D1 uniform across all topologies incl. dedicated squad-host repos (recommended) vs. D2 hybrid (dedicated squad-host repos may keep durable on `main`) |

### Piece 53 — Hands-off durable review: config-inbox and auto-PR

`docs/proposals/upstream-bradygaster/53-hands-off-durable-review-config-inbox-and-auto-pr.md`

Capstone of the Pole-A trilogy: durable governance becomes as hands-off as ephemeral state, with one
human approval. Publish → auto-PR → approve/merge → hydrate.

| Sub-proposal | Summary |
|---|---|
| A (Tier 1) | A durable publish lane: `squad sync --push-config` snapshots the team root filtered to `CONFIG_ALLOWLIST` and pushes to `squad/config-inbox/<callsign>/<dev>/<ts>`; refactor `publishTeamRootToInbox(payloadAllowlist, inboxPrefix, …)` so the ephemeral and durable lanes share one filter and cannot cross-contaminate |
| B (Tier 1) | GitHub auto-PR config pipeline: on push to `squad/config-inbox/**`, assemble a candidate and `gh pr create` into `squad/config/<callsign>`; document the `GITHUB_TOKEN` downstream-CI caveat (use a PAT/App token if the lane runs CI) and ship a `CODEOWNERS` reviewer-routing snippet |
| C (Tier 1) | ADO auto-PR config pipeline: `az repos pr create` under `System.AccessToken` targeting `squad/config/<callsign>`; document the build-service "Contribute to pull requests" grant, `System.AccessToken` exposure, "Limit job authorization scope", and a required-reviewer branch policy; kept behaviorally aligned with GitHub |
| D (Tier 1) | Durable hydrate on `sync --pull` from `squad/config/<callsign>` (via `configRemote`/`configBranch`, resolved per piece 50 §A) alongside the state hydrate; disjoint path sets compose without clobbering; `.last-config-hydrate-sha` sentinel + idempotent re-pull; skip with a notice when `configBranch` is unset |
| E (Tier 1) | Surface unpromoted durable changes: `squad status`/session-end diffs `CONFIG_ALLOWLIST` files against the hydrated config tip and prints a one-line `run 'squad sync --push-config' to open a review PR` nudge; no blocking, no auto-publish |
| F (Tier 2, decision) | One inbox lane or two — F1 physically distinct `squad/inbox/**` (fold/force-push) and `squad/config-inbox/**` (auto-PR) lanes, prefix determines handling (recommended) vs. F2 a single superset lane the pipeline demultiplexes |

---

## Planned (candidate pieces — no spec yet)

None currently. Piece 46 closed the originally-planned stack; piece 47 reopened it with a
live-reproduced monorepo team-root transport defect plus two sync registry-resolution gaps;
piece 48 continued it from the next dogfooding pass (shared-host operability — install
ergonomics, fold inbox-branch cleanup hygiene, two `doctor` diagnostics, a compliant
fold-pipeline state-branch identity, and a `squad assign` disambiguation ergonomics fix); piece 49
continues it from the pass that took the host onto a self-hosted CI runner and toward a multi-squad
layout (self-hosted-runner fold-template durability, a manual fold trigger, and subfolder team-root
onboarding in `squad assign`) and is now specced (above). Further pieces are added here as
new dogfood cycles surface them.

## Operational follow-ups (host actions, not stack pieces)

- **CI service-identity grant per host.** Each new host repository's build/service identity
  must be granted Contribute + Create branch + Force push before the fold can push
  `squad/state/<callsign>` branches. (Piece 41 sub-proposal C documents this prerequisite;
  the grant itself is a per-host administrative action.)
- **Admin-owned local clone.** A pre-existing clone whose `.git` is owned by an
  administrator blocks non-elevated commits; the universal workaround is a fresh
  `git clone` into a user-writable directory. Environmental, not a squad defect.
- **Redeploy host pipeline from current template.** A host whose deployed pipeline predates
  the current template should be re-installed from the corrected template so it picks up the
  identity / history / overlay fixes.

---

## Maintenance

When a planned piece is specced, move it to the "specced" section with its design-doc path;
when implemented, move it to "shipped" with its branch name. Keep bug specifics generic in
this file — concrete host, tenant, and organization details belong in the operator's
private notes, never on the stack branch.
