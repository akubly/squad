# 54 — Config pipeline install wiring and publish batching

## Summary

Piece 53 delivered the durable review loop end to end **on paper**: a `--push-config` client lane
(§A), a GitHub and an ADO config auto-PR pipeline **template** (§B/§C), durable hydrate on `--pull`
(§D), and a promotion nudge (§E). A live dogfooding pass that stood up a real Pole-A shared squad on a
self-hosted host surfaced that the loop does not actually close in the field, for two independent
reasons:

1. **The config pipeline is never deployed.** `fold-squad-config.yml` exists in the template tree
   (GitHub + ADO, mirrored across `squad-cli`/`squad-sdk`), but `install-fold-pipeline` installs only
   `fold-squad-state.yml`. There is no CLI path that writes the config pipeline into a host. So every
   host publishes durable changes to `squad/config-inbox/**` and **nothing consumes them** — the PR is
   promised by the client and never opened. This is the capstone gap: piece 53 shipped the producer and
   the pipeline artifact but not the wiring that makes a host run it.

2. **Even once deployed, the config pipeline cannot run on a self-hosted-only host.** The GitHub config
   template hardcodes `runs-on: ubuntu-latest` with no shell override — but piece 50 §F taught the fold
   template to render `runs-on: [<labels>]` + `defaults.run.shell: bash` from `--runner`. A host whose
   only runner is self-hosted Windows (the exact shape this stack has been dogfooding) has no
   `ubuntu-latest` executor, so the config PR job would queue forever. The config template never
   received the piece-50 §F treatment.

A third defect makes the durable lane painful even when it works: **the publish path is O(2·N) serial
git spawns.** `publishTeamRootToInbox` hashes and stages every file with a separate
`git hash-object -w --stdin` **and** `git update-index --add --cacheinfo` per path. At ~124 ms/spawn on
Windows (reboot-invariant), a 134-file durable snapshot is ~270 spawns ≈ minutes, and a real ephemeral
push measured **214 s for 696 files**. It looks hung; operators kill it. And a fourth, smaller
correctness defect: `sync --push-config --dry-run` previews the **ephemeral** lane
(`PUBLISH_ALLOWLIST` / `squad/inbox/**`) instead of the durable one, so the operator cannot see what a
durable publish will actually carry.

This piece closes the loop for real. It delivers four Tier-1 changes — (A) install wiring that deploys
the config pipeline alongside the fold pipeline, (B) `--runner` parity for the config template so a
self-hosted host can run it, (C) a batched publish that turns O(2·N) spawns into a small constant, and
(D) a lane-correct `--push-config` dry-run — plus two Tier-2 decisions: (E) the config-pipeline install
command surface, and (F) canonicalizing subfolder `.gitignore` placement.

Stack position: Part 54 of the cross-repo arc, and the operationalization of the Pole-A trilogy
(51 hygiene, 52 topology, 53 transport) — piece 54 makes 53's durable review loop actually deployable
and fast. Branches off piece 53
(`squad/piece-53-hands-off-durable-review-config-inbox-and-auto-pr`, tip `8738741a`). It depends on
piece 53's `fold-squad-config.yml` templates, `--push-config` publish lane, `configBranch`/`configRemote`
registry fields, and `CONFIG_ALLOWLIST`; on piece 52's `squad/config/<callsign>` orphan and genesis
seeding (`seedConfigOrphan`); and on piece 50 §F's `--runner` rendering and the
`install-fold-pipeline` self-install / subfolder-host resolution it extends.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`,
`50-subfolder-host-and-self-hosted-runner-hardening.md`,
`52-infra-only-main-and-durable-config-lane.md`,
`53-hands-off-durable-review-config-inbox-and-auto-pr.md`, and the `_planning/dogfood-backlog.md`
roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (install wiring, publish batching,
dry-run) and the GitHub config template is re-rendered for `--runner` (mirrored in
`@bradygaster/squad-sdk`) — include `patch` changesets for `@bradygaster/squad-cli` and
`@bradygaster/squad-sdk`.

---

## Problem

### 1. The config pipeline template ships but nothing installs it

`install-fold-pipeline <github|ado>` resolves the host git root (registry entry → `dirname(entry.path)`,
`.squad/`-at-root self-install, or subfolder `<callsign>/.squad/team.md` self-install — piece 50 §D)
and writes `fold-squad-state.yml` into `.github/workflows` (or `.azuredevops`). It contains **no
reference** to `fold-squad-config.yml`. The durable review loop therefore has a producer
(`--push-config`, piece 53 §A) and a consumer artifact (the config template) but no deployment step
between them. On the dogfood host the observable symptom is a `squad/config-inbox/<callsign>/…` branch
that accumulates with no PR ever opened, because the host's `.github/workflows` has only the state fold.

### 2. The GitHub config template pins `ubuntu-latest`

Piece 50 §F gave the fold template a `--runner "<labels>"` flag that renders `runs-on: [<labels>]` and,
for a non-Linux label set, injects `defaults.run.shell: bash` so the POSIX pipeline body runs under
Git-Bash on a Windows self-hosted runner. `fold-squad-config.yml` predates that treatment: it hardcodes
`runs-on: ubuntu-latest` and assumes a bash default. A host whose only runner is self-hosted Windows —
the configuration this stack has been dogfooding since piece 49 — has no cloud Linux executor, so the
config PR job is unschedulable. The config lane is thus not merely un-installed but, once installed
naively, unrunnable on the very host shape the stack targets.

### 3. Publishing is O(2·N) serial git spawns

`publishTeamRootToInbox` (and `seedConfigOrphan`, which mirrors it) builds the inbox tree by iterating
the filtered file set and, per file, running `git hash-object -w --stdin` to write the blob **and**
`git update-index --add --cacheinfo <mode>,<sha>,<path>` to stage it — two child processes per file
against an isolated `GIT_INDEX_FILE`. Process spawn on Windows is ~124 ms and reboot-invariant, so cost
scales at ~2·N·124 ms: a 134-file durable snapshot is minutes; a measured 696-file ephemeral push took
**214 s**. Nothing is wrong functionally, but the wall-clock cost makes both lanes look hung and
invites operators to kill a mid-publish process (a real risk to a partially-pushed inbox ref). The
blob-write and staging are both batchable: git accepts many paths on stdin for hashing and a full
index manifest on stdin for staging.

### 4. `--push-config --dry-run` previews the wrong lane

`sync --push-config --dry-run` is meant to preview the durable publish, but it renders the ephemeral
lane: it filters by `PUBLISH_ALLOWLIST` and prints `Target inbox branch: squad/inbox/<callsign>/…`
rather than filtering by `CONFIG_ALLOWLIST` and printing the `squad/config-inbox/<callsign>/…` target.
An operator planning a durable publish sees ephemeral files and the wrong destination, defeating the
purpose of a dry-run before a deliberate, reviewed constitution change.

---

## Proposed change

### Sub-proposal A (Tier 1) — install the config pipeline alongside the fold pipeline

Extend the install path so a host onboarded for the shared-squad model deploys **both** the state fold
pipeline and the durable config pipeline. Reuse the existing host-root resolution, callsign
parameterization, and three-way idempotency gate verbatim; add `fold-squad-config.yml` as a second
template rendered and written next to `fold-squad-state.yml` (GitHub → `.github/workflows`, ADO →
`.azuredevops`). The config template is callsign-generic exactly like the fold template (discovers
`squad/config-inbox/<callsign>/*` at run time) and, when `--callsign` is supplied, is scoped by the
same substitutions (trigger glob, `squad/config/<callsign>` target). The genesis seeding and blanket
Pole-A `.gitignore` already performed by `installHostGitignore` are unchanged — they run once for the
durable lane regardless of how many pipelines are written. The exact command surface (one command
writes both, vs. a dedicated config-install command) is decided in E; the behavior — a host ends up with
a deployed, runnable config consumer — is fixed here.

### Sub-proposal B (Tier 1) — `--runner` parity for the config template

Apply piece 50 §F's `--runner "<labels>"` rendering to `fold-squad-config.yml` (GitHub only; ADO stays
agent-pool-driven and unchanged). When `--runner` is present, render the config job's `runs-on` as a
YAML sequence of the labels and, for a non-Linux/ubuntu label set, inject `defaults.run.shell: bash` at
the `open-config-pr` job level so the POSIX assemble/PR body runs under Git-Bash. Absent the flag,
rendering is byte-identical to today (`runs-on: ubuntu-latest`, no `defaults.run.shell`). Share the
single `applyRunner` implementation between the fold and config templates so the two never drift.

### Sub-proposal C (Tier 1) — batch the publish git-spawns

Replace the per-file two-spawn loop in `publishTeamRootToInbox` (and `seedConfigOrphan`) with a batched
build against the isolated `GIT_INDEX_FILE`:

1. **One blob-write spawn.** Feed all file paths to a single `git hash-object -w --stdin-paths`
   (NUL-safe via `-z` where the git version supports it), collecting the emitted SHAs in input order.
2. **One staging spawn.** Assemble an index manifest (`<mode> <sha>\t<path>\n` per file) and pipe it to
   a single `git update-index --index-info` (equivalently `--cacheinfo` via `--stdin`), staging the
   whole set at once.

`write-tree` / `commit-tree` are already single spawns and unchanged. This turns O(2·N) into O(1) small
constant, cutting a 134-file durable publish and a 696-file ephemeral push from minutes to seconds. Both
lanes benefit because they share `publishTeamRootToInbox`. Preserve exact byte-for-byte tree output
(same modes, same path normalization, same content) so the resulting inbox/candidate SHAs are identical
to the per-file path — assert this in a test that builds the same fixture both ways and compares
tree SHAs.

### Sub-proposal D (Tier 1) — lane-correct `--push-config --dry-run`

Route the dry-run through the same lane resolution as the real publish: when `--push-config` is set,
filter the pending set by `CONFIG_ALLOWLIST` and print `Target inbox branch:
squad/config-inbox/<callsign>/<timestamp>-<sessionId>` and `Would publish to remote: <configRemote>`.
The ephemeral `--push --dry-run` is unchanged. Factor the lane selection (allowlist + inbox prefix +
remote) into one resolver used by both the dry-run and the real publish so the preview cannot diverge
from the act.

### Sub-proposal E (Tier 2, decision) — config-pipeline install command surface

- **E1 (recommended, one command writes both):** `install-fold-pipeline <platform>` deploys the state
  fold **and** the config pipeline in one invocation (with the shared idempotency gate applied to each
  file independently). Rationale: onboarding a shared-squad host is a single conceptual act; a host that
  has the fold but not the config consumer is exactly the broken half-state this piece exists to
  prevent. Optional `--state-only` / `--config-only` selectors preserve escape hatches.
- **E2 (separate command):** add `install-config-pipeline <platform>` parallel to
  `install-fold-pipeline`. More composable and explicitly named, but reintroduces the two-step
  onboarding whose first-step-only failure caused this piece.

Record the decision and rationale in the triage file; A above assumes E1.

### Sub-proposal F (Tier 2, decision) — canonicalize subfolder `.gitignore` placement

The dogfood host exposed two different Pole-A ignore encodings coexisting: an older subfolder host has
`<callsign>/.gitignore` containing `.squad/`, while the current `install-fold-pipeline` writes a
**root** `.gitignore` containing `<callsign>/.squad/`. Both ignore the right paths, but the
inconsistency is confusing and risks a double-managed block.

- **F1 (recommended, root-scoped managed block):** canonicalize on a single managed region in the host
  **git-root** `.gitignore` carrying one `<prefix>.squad/` line per callsign (root host → `.squad/`;
  subfolder host → `<callsign>/.squad/`). One managed region per host, idempotent, and the natural shape
  for a multi-callsign subfolder host. `init` and `install-fold-pipeline` both converge here; a legacy
  subfolder `.gitignore` managed block is migrated (removed) when encountered.
- **F2 (subfolder-scoped):** keep per-subfolder `<callsign>/.gitignore`. Matches the oldest hosts but
  multiplies managed regions and has no single place to read a host's ignore posture.

Whichever is chosen, make `init` and `install-fold-pipeline` **consistent and idempotent**: re-running
must not duplicate or fight an existing managed block. Record the decision and rationale in the triage
file.

---

## Acceptance

- After `install-fold-pipeline` (per the E decision) on a host, the host's CI directory contains **both**
  a state fold pipeline and a config pipeline; a durable publish to `squad/config-inbox/<callsign>/…`
  triggers the config pipeline, which opens a PR into `squad/config/<callsign>` and never force-pushes
  it (A).
- `install-fold-pipeline --runner "self-hosted,Windows,X64"` renders the config template with
  `runs-on: [self-hosted, Windows, X64]` + `defaults.run.shell: bash`; with no `--runner` the config
  template is byte-identical to the piece-53 base (`ubuntu-latest`, no `defaults.run.shell`) (B).
- A `publishTeamRootToInbox` (and `seedConfigOrphan`) build over a multi-file fixture produces a tree
  whose SHA is identical to the per-file path, using a small constant number of git child processes
  (asserted, e.g. ≤ 4) rather than 2·N; a ≥100-file publish completes in seconds (C).
- `sync --push-config --dry-run` prints the `CONFIG_ALLOWLIST` pending set, the
  `squad/config-inbox/<callsign>/…` target, and the config remote — and never the ephemeral lane; the
  ephemeral `--push --dry-run` is unchanged (D).
- The install-command-surface decision (E) and the `.gitignore`-placement decision (F) are each recorded
  with rationale; `init` and `install-fold-pipeline` produce a single, idempotent ignore posture per the
  F decision.
- End-to-end on a self-hosted host: a charter edit reaches every clone through
  `--push-config` → config pipeline auto-PR → one approval → merge → `--pull`, with no manual git branch
  operation and no unschedulable job — the Pole-A hands-off durable-review goal, now actually running.
- Scrub gate contributes no new hits versus the piece-53 base; `@bradygaster/squad-cli` +
  `@bradygaster/squad-sdk` changesets present.
