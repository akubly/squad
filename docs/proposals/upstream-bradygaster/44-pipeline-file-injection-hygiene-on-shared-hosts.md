# 44 — Pipeline-file injection hygiene on shared hosts

## Summary

A host repository that aggregates the squad state for more than one callsign may carry more
than one fold definition over its lifetime — a scoped `--callsign` pipeline per squad, or a
pipeline that migrated between CI platforms. Two injection paths do not keep that arrangement
hygienic. The scoped `install-fold-pipeline --callsign` writes a **fixed** filename
(`fold-squad-state.yml`) regardless of the callsign, so two scoped installs targeting one
repository overwrite each other (and the second collides with the first under the existing
conflict gate). And the `sync`-time pipeline injection that embeds the host's pipeline YAML
into the published inbox snapshot probes the ADO and GitHub pipeline directories
**independently** and embeds whichever exist, so a stale copy left in an alternate pipeline
directory (from an earlier platform or filename convention) is carried into the snapshot
alongside the canonical one.

This piece makes both injection points hygienic on a shared host: (A) the scoped
`--callsign` install writes a distinct, callsign-named pipeline file
(`fold-squad-state.<callsign>.yml`) so two scoped installs on one repository never collide;
and (B) the `sync`-time injection resolves a single **canonical** pipeline path and embeds
only that one, so a stale alternate-directory copy is never embedded in the published
snapshot. A residual decision (C) covers whether the scoped install should also remove a
stale copy left in an alternate pipeline directory.

Stack position: Part 44 of the cross-repo arc. Branches off piece 43
(`squad/piece-43-cross-repo-state-remote-and-branch-resolution`). Depends on the
callsign-namespaced transport surface (inbox prefix `squad/inbox/<callsign>/<handle>/...`,
state branch `squad/state/<callsign>`, and the `CALLSIGN_RE` validator) introduced in piece
40, on the repository-root install target and the callsign-generic default pipeline from
piece 41, and on the pipeline-YAML injection into the inbox snapshot that the cross-repo
publish path carries.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs `41-fold-pipeline-repo-root-and-generic-discovery.md`,
`42-fold-subtree-overlay-and-serialization.md`, `43-cross-repo-state-remote-and-branch-resolution.md`,
and the piece-44 entry in `_planning/dogfood-backlog.md`.

Changeset requirement: `packages/squad-cli/src/` is touched — include a `patch` changeset
entry for `@bradygaster/squad-cli`. If the callsign-named filename derivation is factored
into a shared helper in the SDK, add a `patch` entry for `@bradygaster/squad-sdk` as well.

---

## Problem

Piece 41 resolved the fold-pipeline install target to the repository root and made the
**default** pipeline callsign-generic: one `fold-squad-state.yml` per host discovers the
callsigns present at run time and folds each into its own `squad/state/<callsign>` branch.
A scoped `--callsign` install remains available for a host that wants a pipeline limited to a
single squad. Separately, the cross-repo publish path embeds the host's pipeline YAML into
the published inbox snapshot so the snapshot carries the pipeline definition that governs it.
Two hygiene gaps remain when one repository carries more than one fold definition.

**1. The scoped `--callsign` install writes a fixed filename and two scoped installs
collide.** `installFoldPipeline` derives the destination as a constant:

```ts
const destPath = path.join(targetDir, 'fold-squad-state.yml');
```

regardless of `options.callsign`. The callsign only parameterizes the file *content* (the
trigger glob, the discovered callsign list, and the `squad/state/<callsign>` target); the
*filename* is always `fold-squad-state.yml`. On a host that hosts two callsigns, installing a
scoped pipeline for the first callsign and then for the second targets the same path. The
three-way idempotency/conflict gate then fires: because the two scoped files differ in
content, the second install hits the "exists with different content" branch and exits 1
(`✗ fold-squad-state.yml exists at … with different content`). The two scoped pipelines
cannot coexist; there is no filename that distinguishes them.

**2. The `sync`-time pipeline injection embeds whichever directory copies exist, including a
stale one.** When the cross-repo publish builds the inbox snapshot it embeds the host's
pipeline YAML so CI can evaluate triggers against the snapshot. It probes the two platform
directories **independently** and adds whichever exist:

```ts
const adoYamlPath = path.join(teamRoot, '.azuredevops', 'fold-squad-state.yml');
if (fs.existsSync(adoYamlPath)) { /* stage .azuredevops/fold-squad-state.yml */ }
const ghYamlPath = path.join(teamRoot, '.github', 'workflows', 'fold-squad-state.yml');
if (fs.existsSync(ghYamlPath)) { /* stage .github/workflows/fold-squad-state.yml */ }
```

A host has exactly one active CI platform, but a directory copy from an earlier convention
can persist: a host that migrated from GitHub Actions to Azure DevOps (or vice versa)
leaves a `fold-squad-state.yml` in the abandoned platform directory, and a host that adopts
the scoped callsign-named file (sub-proposal A) leaves the old generic file behind. The
independent probes embed **both** the canonical and the stale copy into the snapshot. The
fold pipeline then materializes the snapshot onto the state branch, so the stale
alternate-directory pipeline file persists and propagates with the accumulated state instead
of being dropped. The injection must resolve a single canonical pipeline path and embed only
that one.

---

## Proposed change

Sub-proposals A and B are Tier 1 (concrete, implementation-ready). Sub-proposal C is Tier 2
(a decision with a behavior-surprise cost) and is gated on the maintainer's choice.

**Recommended implementation order:** A (callsign-named scoped install) first, then B
(canonical single-embed injection), then resolve C.

---

## Tier 1

### A. Scoped `--callsign` install writes a distinct, callsign-named file

**Current behavior:** the destination is the constant `fold-squad-state.yml`; the callsign
parameterizes only the file content. Two scoped installs on one repository target the same
path and the second is rejected by the conflict gate.

**Required behavior:** when `--callsign <name>` is supplied, the scoped install writes
`fold-squad-state.<callsign>.yml` in the resolved platform directory. The callsign-generic
default install (no `--callsign`) is unchanged and continues to write `fold-squad-state.yml`.
The callsign is validated with the existing `CALLSIGN_RE` (`packages/squad-sdk/src/validation.ts`)
before it is interpolated into the filename — `installFoldPipeline` already validates
`--callsign` against `CALLSIGN_RE` and exits 1 on a malformed value, so the same guard
covers the filename derivation; do not introduce a second callsign pattern. The three-way
idempotency/conflict gate (absent → write; present+match → exit 0; present+differ → exit 1)
operates per resolved filename, so two scoped installs for different callsigns each write
their own file and neither trips the other's conflict gate.

**Hard constraints:**
- A scoped install for callsign `alpha` writes `fold-squad-state.alpha.yml`; a scoped
  install for callsign `bravo` on the same repository writes `fold-squad-state.bravo.yml`;
  neither overwrites the other and neither trips the conflict gate.
- The default (no `--callsign`) install path writes `fold-squad-state.yml` byte-identically
  to today.
- The idempotency/conflict gate and all user-facing messages reference the **resolved**
  filename (the callsign-named file for a scoped install), not a hardcoded
  `fold-squad-state.yml`.
- A callsign that fails `CALLSIGN_RE` is never interpolated into a filename (the existing
  validation guard already rejects it before any write).
- The source template path is unchanged (`templates/fold/<platform>/fold-squad-state.yml`);
  only the destination filename is derived. No template-mirror change is required.

**Test surface:** (a) a scoped install with `--callsign alpha` writes
`fold-squad-state.alpha.yml` and not `fold-squad-state.yml`. (b) two scoped installs with
different callsigns on one repository produce two distinct files and the second exits 0
(no conflict). (c) the default install with no callsign still writes `fold-squad-state.yml`.
(d) re-running a scoped install for the same callsign is idempotent (exit 0, no change); a
scoped install over a same-named file with different content still trips the conflict gate
naming the callsign-named path.

### B. `sync`-time injection embeds a single canonical pipeline path

**Current behavior:** the cross-repo publish embeds the pipeline YAML into the inbox snapshot
by probing `.azuredevops/fold-squad-state.yml` and `.github/workflows/fold-squad-state.yml`
independently and staging whichever exist — embedding both when both exist.

**Required behavior:** the injection resolves a **single** canonical pipeline file and
embeds only that one. Candidate paths are evaluated in a fixed precedence and the first that
exists is the canonical one; no second copy is embedded. The precedence prefers the
callsign-scoped filename for the publish's callsign over the generic filename (a scoped file
is the strongest signal of the pipeline that governs this squad), and resolves the platform
directory by a documented tiebreak (Azure DevOps before GitHub, matching the existing probe
order):

1. `.azuredevops/fold-squad-state.<callsign>.yml`
2. `.github/workflows/fold-squad-state.<callsign>.yml`
3. `.azuredevops/fold-squad-state.yml`
4. `.github/workflows/fold-squad-state.yml`

The callsign-scoped candidates (1–2) are only considered when the publish carries a callsign
(always true on the cross-repo publish path that performs the injection). The canonical file
is embedded at its real host-relative path (so CI resolves it where it expects); a copy in
any other candidate directory is not embedded.

**Hard constraints:**
- When both `.azuredevops/fold-squad-state.yml` and `.github/workflows/fold-squad-state.yml`
  exist, exactly one (the canonical, by the precedence above) is embedded in the snapshot;
  the alternate-directory copy is not.
- When only one pipeline file exists, that file is embedded exactly as today (single-platform
  hosts are unaffected).
- When a callsign-scoped file (`fold-squad-state.<callsign>.yml`) exists for the publish's
  callsign, it is the canonical file, preferred over a generic `fold-squad-state.yml`.
- The embedded path in the snapshot equals the file's real host-relative path.
- No pipeline file existing leaves the snapshot without a pipeline entry (unchanged from
  today's behavior when neither directory carries the file).

**Test surface:** (a) a publish from a team root carrying pipeline files in **both**
`.azuredevops/` and `.github/workflows/` embeds only one (the `.azuredevops/` copy by
precedence) and not the other. (b) a publish from a team root with only the GitHub copy
embeds that copy (single-platform unchanged). (c) a publish whose callsign has a
`fold-squad-state.<callsign>.yml` in a platform directory embeds that callsign-named file in
preference to a generic `fold-squad-state.yml`. (d) a publish from a team root with no
pipeline file embeds none (unchanged).

---

## Tier 2 (decision)

### C. Stale alternate-directory cleanup on scoped install

**Decision required:** whether `install-fold-pipeline` should also **remove** a stale
pipeline copy left in an alternate pipeline directory (the other platform's directory, or the
generic `fold-squad-state.yml` superseded by a callsign-named file), or leave the host
filesystem untouched and rely solely on the canonical single-embed (B) to keep the snapshot
clean.

**Option C1 — Leave the alternate copy in place (recommended).** The install writes only its
own canonical file and never deletes a file in another directory it did not create. The
canonical single-embed (B) already prevents a stale alternate-directory copy from being
carried into the published snapshot, so a stray file on the host is inert with respect to the
fold loop. Cost: a stale file remains on the host's filesystem until an operator removes it
(documented as an operational follow-up); the install does not self-heal it.

**Option C2 — Remove the alternate copy on install.** The install deletes a
`fold-squad-state.yml` (or the other platform's directory copy) it detects as superseded, so
the host carries only the canonical file. Cost: an install command that deletes a file in a
directory it was not asked to target is surprising and risks removing a file an operator
placed deliberately (e.g. a host genuinely running two platforms during a migration window);
the deletion is harder to make safe than the single-embed in B.

**Hard constraints (whichever is chosen):**
- The choice does not change the canonical single-embed behavior in B (the snapshot carries
  exactly one pipeline file regardless of C).
- The choice does not change the default (no `--callsign`) install's written file.
- The decision and its rationale are recorded in the Phase-B triage file so it is auditable.

**Test surface:** for C1, a scoped install with a pre-existing generic `fold-squad-state.yml`
in the same directory writes the callsign-named file and leaves the generic file in place.
For C2, the same install removes the superseded generic file and a test asserts it is gone.

---

## Acceptance

- Build exits 0.
- A scoped `install-fold-pipeline --callsign <name>` writes `fold-squad-state.<callsign>.yml`;
  two scoped installs for different callsigns on one repository produce distinct,
  non-colliding files and the second does not trip the conflict gate (A).
- The default (no `--callsign`) install writes `fold-squad-state.yml` byte-identically to
  today; the idempotency/conflict gate and messages reference the resolved filename (A).
- The callsign is validated with the existing `CALLSIGN_RE` before interpolation into the
  filename; no second callsign pattern is introduced (A).
- The cross-repo `sync` pipeline injection embeds exactly one canonical pipeline path; when
  both platform-directory copies exist, only the canonical one is embedded and the stale
  alternate-directory copy is not carried into the snapshot (B).
- A single-platform host's snapshot embeds its one pipeline file exactly as today; a host
  with no pipeline file embeds none (B).
- Sub-proposal C is resolved one way or the other: either the scoped install leaves a stale
  alternate-directory copy in place and the canonical single-embed keeps the snapshot clean
  (C1), or the install removes the superseded copy (C2); the choice and rationale are
  recorded in the Phase-B triage.
- Tests cover: callsign-named scoped filename and two-callsign coexistence, the unchanged
  default filename, and the conflict gate naming the resolved path (A); single canonical
  embed when both directories carry a copy, the unchanged single-platform embed, the
  callsign-named-preference, and the no-pipeline case (B); and the chosen C behavior.
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff (and a `patch`
  changeset for `@bradygaster/squad-sdk` if a shared filename-derivation helper is added
  there).
- No specific internal tenant/host URL appears in any documentation; placeholders use
  `dev.azure.com/contoso/MyProject`.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
