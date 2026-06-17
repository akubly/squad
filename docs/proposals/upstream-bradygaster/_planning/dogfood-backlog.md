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

---

## Planned (candidate pieces — no spec yet)

### Piece 44 — Pipeline-file injection hygiene on shared hosts

**Intent.** On a host that may carry more than one fold definition, the scoped `--callsign`
install and the `sync`-time pipeline injection must not collide or leave stale copies.
Today a scoped install writes a fixed filename (two scoped installs on one repo would
overwrite each other) and the injection writes one canonical pipeline directory while a
stale alternate-directory copy can remain from an earlier convention.

**Candidate outcomes (assertion-shaped).**
- Two `--callsign` scoped installs targeting one repository produce distinct,
  non-colliding pipeline files (callsign-named), or the scoped install is rejected when the
  callsign-generic pipeline already covers the repo.
- `sync` injects only the canonical pipeline path and does not leave a stale copy in an
  alternate pipeline directory.

**Source classes:** scoped-mode fixed-filename collision; injection writes one directory
while a stale alternate copy persists.

### Piece 45 — Post-commit hook entrypoint resolution

**Intent.** The squad-installed post-commit hook invokes a bare `squad` resolved from the
global `PATH`, which risks version skew between the hook and the CLI that installed it. The
hook should invoke a resolved entrypoint (absolute path, or a pinned/launder-through
mechanism) so it runs the same CLI version that wrote it.

**Candidate outcomes (assertion-shaped).**
- The installed post-commit hook invokes a resolved CLI entrypoint, not bare `squad` on the
  global `PATH`.
- The hook runs the same CLI version/build that installed it (no global-install skew).

**Source class:** post-commit hook invokes bare `squad`.

### Piece 46 — State-remote resolution hardening and pull/push transport coverage

**Intent.** Piece 43 resolves the cross-repo state remote from the team-root host, but the
underlying remote resolver still falls back to a literal `origin` string without confirming
that remote exists. On a host clone configured with a single differently named remote (or
none) and no branch tracking, resolution can name a non-existent `origin` instead of the
obvious sole remote. Harden the resolver and close the cross-repo transport test gap left by
piece 43 (whose pull/push tests assert argument plumbing against a mocked transport rather
than real git fetch/push behavior).

**Candidate outcomes (assertion-shaped).**
- The state-remote resolver prefers the branch's tracking remote; else, when exactly one
  remote is configured, it selects that remote; else `origin` only when `origin` actually
  exists; else it fails with an actionable error directing the operator to set `stateRemote`.
- A cross-repo `sync --pull` against a real bare state remote whose branch is named
  `squad/state/<callsign>` hydrates `.squad` files into the team-root (real fetch, not a
  mocked transport).
- A cross-repo `sync --push` against a real bare host remote that is **not** named `origin`
  publishes the inbox ref to that remote.
- The state-branch derivation returns the flat `squad-state` fallback for every invalid
  callsign shape (uppercase, underscore, dot, leading digit, over-length), covered by a
  focused unit test.

**Source classes:** literal-`origin` fallback in the remote resolver; piece-43 transport
tests assert plumbing against mocks, not real fetch/push; invalid-callsign fallback lacks
direct coverage. (Accepted from the piece-43 adversarial review; deferred out of piece 43 to
avoid reopening shipped scope and to keep the shared resolver change isolated.)

---

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
