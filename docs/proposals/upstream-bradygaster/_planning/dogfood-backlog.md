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

---

## Planned (candidate pieces — no spec yet)

None. Piece 46 was the last planned piece on this stack and is now specced (above); there is
no piece 47.

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
