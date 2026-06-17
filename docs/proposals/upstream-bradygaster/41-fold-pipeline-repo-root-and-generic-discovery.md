# 41 — Fold pipeline: repo-root install and callsign-generic discovery

## Summary

`install-fold-pipeline` writes the fold pipeline file into a directory derived from the
squad registry entry's path. When a host repository carries the squad state in a nested
subdirectory (one repository aggregating one or more callsigns under
`<repo-root>/<callsign>/.squad/...`), that derived directory is a subdirectory rather
than the repository root. CI platforms resolve pipeline/workflow definitions relative to
the repository root and evaluate push triggers across the whole repository, so a
definition placed in a subdirectory is not discovered.

This piece (1) resolves the install target to the git repository root, and (2) replaces
the per-callsign scoped pipeline with a single **callsign-generic** pipeline that triggers
on every inbox push, discovers the distinct callsigns present at run time, and folds each
into its own `squad/state/<callsign>` branch. One pipeline definition then serves any
number of callsigns hosted in the same repository.

Stack position: Part 41 of the cross-repo arc. Branches off piece 40
(`squad/piece-40-callsign-namespaced-transport`). Depends on the callsign-namespaced
transport surface (inbox prefix `squad/inbox/<callsign>/<handle>/...` and state branch
`squad/state/<callsign>`) introduced in piece 40.

Changeset requirement: `packages/squad-cli/src/` and the fold-pipeline templates are
touched — include a `patch` changeset entry for `@bradygaster/squad-cli` covering both.

---

## Problem

Piece 40 added the callsign slot to the inbox branch and adopted
`squad/state/<callsign>` as the fold target, and parameterized `install-fold-pipeline`
with `--callsign` so a scoped pipeline could be generated per squad. Two problems remain
when one repository hosts the squad state for one or more callsigns in nested
subdirectories.

**1. The install target is a subdirectory, not the repository root.**
`install-fold-pipeline` computes the output directory from the squad entry's path
(effectively `dirname(entry.path)`). For a host whose `.squad` directory sits at
`<repo-root>/<callsign>/.squad`, this resolves to `<repo-root>/<callsign>`. Azure DevOps
resolves a pipeline's YAML path repo-relative and GitHub Actions only discovers workflow
files under `<repo-root>/.github/workflows/`; a definition written to a nested
subdirectory is either unreachable or never evaluated. The pipeline must be written under
the repository root (`<repo-root>/.azuredevops/` for ADO, `<repo-root>/.github/workflows/`
for GitHub).

**2. Per-callsign scoped pipelines are redundant and contend on a shared host.**
With `--callsign`, each squad gets a pipeline whose trigger is scoped to
`squad/inbox/<callsign>/...` and whose target is `squad/state/<callsign>`. On a host that
aggregates several callsigns this requires installing and maintaining N pipeline files.
It is also redundant: the Azure DevOps single-segment branch wildcard `*` already spans
the `/` separators in `refs/heads/squad/inbox/*`, so one trigger matches every callsign's
inbox refs; and `batch: true` coalesces a burst of concurrent pushes across callsigns
into a single run. N scoped pipelines therefore overlap in coverage and can be queued
concurrently, competing to mutate distinct `squad/state/<callsign>` branches from
separate runs.

A single definition that catches all inbox pushes and resolves the affected callsigns at
run time is both correct and the natural match for the repository-wide trigger semantics.

---

## Proposed change

Sub-proposals A–C are Tier 1 (concrete, implementation-ready). There is no Tier-2
decision item in this piece.

**Recommended implementation order:** A (repo-root target), B (callsign-generic pipeline
template + runtime discovery), C (onboarding prerequisite documentation).

> **Relationship to piece 40, sub-proposal C.** Piece 40 introduced `--callsign` to
> generate a scoped single-callsign pipeline. This piece revises that surface: the
> **default** install (no `--callsign`) now generates the callsign-generic pipeline at the
> repository root, replacing the previous default whose hardcoded global trigger folded
> every squad's inbox into a single flat `squad-state` branch. The `--callsign` flag is
> retained for the dedicated-repository case (one repository, one callsign) and continues
> to emit a scoped pipeline, unchanged from piece 40.

---

## Tier 1

### A. Resolve the install target to the repository root

**Current behavior:** `install-fold-pipeline` derives the output directory from the squad
entry's path. For a nested host this is a subdirectory of the repository.

**Required behavior:** Resolve the repository root by running
`git -C <clone-or-entry-dir> rev-parse --show-toplevel` and write the pipeline definition
relative to that root:
- ADO: `<repo-root>/.azuredevops/fold-squad-state.yml`
- GitHub: `<repo-root>/.github/workflows/fold-squad-state.yml`

**Hard constraints:**
- The repository root is resolved via `git rev-parse --show-toplevel`; the entry path is
  not assumed to be the root.
- When the squad's `.squad` directory is itself at the repository root (the simple host
  case), `--show-toplevel` returns that same directory, so the output path is unchanged
  from current behavior for simple hosts.
- If `git rev-parse --show-toplevel` fails (the target is not a git working tree), the
  command exits with a clear, actionable error and writes nothing.

**Test surface:** (a) Given an entry whose path is a nested subdirectory of a git working
tree, the generated definition is written under the working tree's root, not the
subdirectory. (b) Given an entry whose path is the repository root, the output path is
unchanged. (c) A non-git target produces a fatal error and no file write.

---

### B. Callsign-generic pipeline with run-time callsign discovery

**Current behavior:** Without `--callsign`, the generated pipeline triggers on a global
inbox glob and folds all matched refs into a single hardcoded `squad-state` branch. With
`--callsign`, it generates a scoped single-callsign pipeline.

**Required behavior:** Add a callsign-generic template that becomes the **default**
generated output (no `--callsign`). For both platforms the template:

1. **Triggers on every inbox push** with batching:
   - ADO: `trigger.branches.include: ['refs/heads/squad/inbox/*']`, `trigger.batch: true`.
   - GitHub: `on.push.branches: ['squad/inbox/**']`.
2. **Discovers the distinct callsigns** present on the remote at run time. Enumerate the
   inbox refs and extract the `<callsign>` path segment:
   ```bash
   git ls-remote --heads origin 'refs/heads/squad/inbox/*' \
     | sed -nE 's#^[0-9a-f]+\srefs/heads/squad/inbox/([^/]+)/.*#\1#p' \
     | sort -u
   ```
3. **Folds each discovered callsign independently** into its own `squad/state/<callsign>`
   branch, iterating over the discovered set. Each callsign's fold reads only that
   callsign's inbox refs (`squad/inbox/<callsign>/...`) and writes only
   `squad/state/<callsign>`.
4. **Pushes the updated state branches** back to `origin` with `--force-with-lease`.

The `--callsign <name>` flag is retained and unchanged from piece 40: it emits the scoped
single-callsign pipeline (trigger `refs/heads/squad/inbox/<name>/*` for ADO,
`squad/inbox/<name>/**` for GitHub; target `squad/state/<name>`) for the
dedicated-repository case.

**Hard constraints:**
- The default (no `--callsign`) output is the callsign-generic pipeline; it must not fold
  into a single flat `squad-state` branch.
- Callsign discovery is performed at run time from the live inbox refs; the set of
  callsigns is not baked into the generated YAML.
- A callsign that appears in an inbox ref is validated against the callsign character
  constraints (the `CALLSIGN_RE` constant from piece 40) before it is used as a branch
  name component in the fold loop; a ref whose callsign segment fails validation is
  skipped with a logged warning, not folded.
- The fold loop is idempotent: re-running on an already-folded inbox ref produces no new
  state commit (a fold run that races or repeats does not corrupt or duplicate state).
- `batch: true` (ADO) is present so concurrent multi-callsign pushes coalesce into one run.

**Out of scope (successor piece):** Two fold-body correctness items are addressed in
piece 42 and apply to all fold templates: (1) overlaying the inbox `.squad` tree onto a
state branch that already contains `.squad/` without a bind failure and without clobbering
the pipeline-owned `publish-history.json`, and (2) serializing Azure DevOps fold runs
beyond `batch: true` so the fetch→fold→push critical section cannot overlap. This piece
introduces the template structure (repo-root placement, run-time discovery, per-callsign
fold loop) with a self-healing, success-gated fold body (sub-proposal D).

**Test surface:** (a) The default generated ADO YAML contains
`refs/heads/squad/inbox/*` in the trigger, `batch: true`, the callsign-discovery command,
and a per-callsign fold writing `squad/state/<callsign>` — and does **not** contain a
hardcoded single `squad-state` fold target. (b) The default generated GitHub YAML
contains the `squad/inbox/**` trigger, the discovery command, and the per-callsign fold.
(c) `--callsign teamA` still produces the scoped pipeline (trigger
`refs/heads/squad/inbox/teamA/*`, target `squad/state/teamA`) for both platforms,
unchanged from piece 40.

---

### C. Host-onboarding prerequisite documentation

**Current behavior:** The permission requirements for the CI service identity that runs
the fold pipeline are not documented. A host whose build service identity lacks push
permission fails the fold with a generic permission error
(`TF401027`-class on Azure DevOps).

**Required behavior:** Document, alongside the `install-fold-pipeline` command help and in
the fold-pipeline section of the CLI docs, that the CI service identity which runs the
fold pipeline must have, on the **host repository**:
- **Contribute**,
- **Create branch**, and
- **Force push** (also called *force push / rewrite history*)

permissions, because the fold job creates and force-updates `squad/state/<callsign>`
branches. Use a generic platform example (e.g. `dev.azure.com/contoso/MyProject`) in the
documentation; no specific tenant or organization URL.

**Hard constraints:**
- Documentation-only; no behavior change.
- No specific internal tenant/organization URL appears in the documentation.

**Test surface:** None (documentation). Verified by the acceptance review.

---

### D. Fold-body integrity: self-healing publish-history, push gated on fold success, and serialized GitHub runs

**Current behavior:** The fold body records each inbox ref it processes and rewrites
`.squad/publish-history.json`, then pushes the state branch, without (1) tolerating a
`publish-history.json` that is present-but-empty or non-array, (2) guaranteeing that a ref
is recorded and pushed only when its fold commit actually succeeded, or (3) preventing two
GitHub workflow runs from mutating the same state branch concurrently.

**Required behavior:**

1. **Self-healing history.** Treat a `publish-history.json` that is missing, empty, or not
   a JSON array as an empty history (`[]`) — both when reading the already-folded set
   before the loop and when appending the run record after it — so a degenerate history
   file recovers to a valid array rather than skipping all folds or being rewritten empty.
   The written history is always a valid JSON array.
2. **Push gated on fold success.** Record an inbox ref in the run's folded set (and
   therefore in `publish-history.json`) only if its fold commit succeeded; a failed fold
   logs a warning, resets the working tree, and is not recorded, so the next run retries
   it. The fold body runs under shell `errexit`/`pipefail` (where the platform does not
   supply it by default) so an intermediate failure aborts before the state-branch push;
   the post-loop history rewrite is validated to be a non-empty JSON array before it is
   written and pushed.
3. **Serialized GitHub runs.** The GitHub workflow declares a `concurrency` group so two
   fold runs never overlap; an in-progress fold is not cancelled mid-push (queued, not
   cancelled). Azure DevOps retains `batch: true` for coalescing; run-level serialization
   of the ADO fold beyond batching is deferred to piece 42.

**Hard constraints:**
- Applies to all fold templates (both platforms); the mirrored template trees are kept
  byte-identical.
- A degenerate `publish-history.json` never causes the fold to drop all refs or to write an
  empty/invalid file.
- A ref is never recorded as folded unless its fold commit landed.
- The GitHub workflow does not run two fold jobs concurrently, and does not cancel an
  in-progress fold.

**Test surface:** generated-YAML assertions that the fold body contains the history
self-heal guard, the commit-success-gated record, the `errexit`/`pipefail` directive where
the platform does not supply it (the ADO inline bash body), and the GitHub `concurrency`
group; the runtime behavior is covered by the integration acceptance criterion.

---

## Acceptance

- Build exits 0.
- `install-fold-pipeline` resolves the output directory via
  `git rev-parse --show-toplevel`; for a nested-subdirectory entry the definition is
  written under the repository root, and for a root-level entry the path is unchanged.
- A non-git target produces a fatal error and writes no file.
- The default generated pipeline (no `--callsign`) is the callsign-generic definition:
  repository-wide inbox trigger with batching, run-time callsign discovery, and a
  per-callsign fold to `squad/state/<callsign>`; it does not fold into a single flat
  `squad-state` branch.
- `--callsign <name>` still produces the scoped single-callsign pipeline for both
  platforms, unchanged from piece 40.
- The fold body self-heals a missing, empty, or non-array `publish-history.json` to `[]`
  and always writes a valid JSON array; an inbox ref is recorded and pushed only when its
  fold commit succeeded, and a failed fold is retried on the next run; the GitHub workflow
  serializes fold runs via a `concurrency` group and does not cancel an in-progress fold.
- Integration: a single installed callsign-generic pipeline, exercised with inbox pushes
  for two distinct callsigns sharing one host repository, folds each into its own
  `squad/state/<callsign>` branch in one batched run, with no cross-contamination and no
  duplicate state on a repeated run.
- The host-onboarding permission prerequisite (Contribute, Create branch, Force push for
  the CI service identity) is documented, with no specific internal tenant URL.
- Tests cover: repo-root target resolution (A), default callsign-generic YAML generation
  for both platforms (B), retained `--callsign` scoped generation (B), and the non-git
  error path (A).
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
