# 45 — Post-commit hook entrypoint resolution

## Summary

The cross-repo publish post-commit hook that `squad assign` installs into a host or product
clone invokes a **bare `squad`** resolved from the global `PATH`. The two hook bodies —
`CROSS_REPO_HOST_POST_COMMIT_TEMPLATE` (the host-filtered variant) and
`CROSS_REPO_PRODUCT_POST_COMMIT_TEMPLATE` (the product unfiltered variant) — each run
`squad sync --push --quiet` with no qualification of which `squad` that is. On a machine where
the global `squad` on `PATH` is a different version or build than the CLI that installed the
hook (a globally installed release shadowing a locally built or `npx`-launched CLI, or vice
versa), the hook silently runs the wrong build. The publish behavior the hook triggers is
then governed by an entrypoint the operator never chose, and can drift arbitrarily from the
CLI version that wrote the hook.

This piece resolves the CLI entrypoint **at install time** and embeds a resolved invocation in
the hook body, so the hook runs the same CLI version/build that installed it rather than
whatever `squad` happens to be first on `PATH`. The resolution reuses the project's existing
self-location idiom (`fileURLToPath(import.meta.url)`, with `process.execPath` for the Node
binary) and the resolved invocation is POSIX-shell-quoted and Windows-path-safe so it survives
git's `#!/bin/sh` execution on every platform. A Tier-2 decision (B) covers the fallback when
the entrypoint cannot be resolved at install time.

Stack position: Part 45 of the cross-repo arc. Branches off piece 44
(`squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts`). This piece touches the
post-commit hook **only**; the backend sync hooks (`pre-push` / `post-merge` / `post-rewrite`
/ `post-checkout`) call `git` directly and never invoke `squad`, so they are out of scope. It
depends on the cross-repo post-commit hook surface (`installCrossRepoHook`, the host/product
variant selection via `.squad/team.md`, and the `SQUAD_SYNC_ACTIVE` recursion guard)
established earlier in the arc.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs
`42-fold-subtree-overlay-and-serialization.md`,
`43-cross-repo-state-remote-and-branch-resolution.md`,
`44-pipeline-file-injection-hygiene-on-shared-hosts.md`, and the piece-45 entry in
`_planning/dogfood-backlog.md`.

Changeset requirement: `packages/squad-cli/src/` is touched — include a `patch` changeset
entry for `@bradygaster/squad-cli`.

---

## Problem

`installCrossRepoHook` (`packages/squad-cli/src/cli/commands/install-hooks.ts`) writes a
post-commit hook into a clone's `.git/hooks/`. It selects one of two module-level string
constants by clone variant (host clones carry `.squad/team.md`; product clones do not) and
writes it verbatim:

```ts
// host variant — filters out .squad/-only commits
const CROSS_REPO_HOST_POST_COMMIT_TEMPLATE = `#!/bin/sh
# --- squad-sync-hook ---
...
if [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  if git diff-tree --no-commit-id --name-only -r --root HEAD | grep -qv '^\.squad/'; then
    squad sync --push --quiet
  fi
fi
`;

// product variant — fires on any commit
const CROSS_REPO_PRODUCT_POST_COMMIT_TEMPLATE = `#!/bin/sh
# --- squad-sync-hook ---
...
if [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  squad sync --push --quiet
fi
`;
```

Both bodies invoke the **bare token `squad`**, which `git`'s `sh` resolves from the process
`PATH` at hook-execution time. Nothing pins that resolution to the CLI that installed the
hook. Three failure shapes follow from this:

1. **Version skew on a host with a global install.** An operator who installed the hook from a
   locally built or `npx`-pinned CLI, but who also has an older `@bradygaster/squad-cli`
   installed globally, runs the **global** build on every commit — the publish logic that
   fires is the global version's, not the one that wrote the hook.
2. **No `squad` on `PATH` at all.** A CLI launched via `npx` (never globally installed) writes
   a hook that references a `squad` that does not exist once the `npx` process exits; the hook
   fails to publish on the next commit.
3. **Silent divergence over time.** Because the bare token is re-resolved on every commit, a
   later global upgrade/downgrade changes the hook's behavior without the hook bytes changing
   and without any operator action — the installed hook is not pinned to a known build.

The hook should instead invoke a **resolved entrypoint** captured at install time: the Node
binary and the absolute path to the CLI entry script of the very process performing the
install, so the hook re-runs that same build on every commit.

The constraints that make this non-trivial are all on the `#!/bin/sh` execution surface. The
hook is run by git's `sh` (Git Bash / MSYS on Windows), so a resolved Windows absolute path
(`C:\Program Files\nodejs\node.exe`, drive letters, spaces, backslashes) must be converted to
an `sh`-safe form and quoted, or the hook breaks. The existing `SQUAD_SYNC_ACTIVE` recursion
guard, the host variant's `.squad/`-only filter, and the `# --- squad-sync-hook ---` marker
idempotency/chaining must all be preserved unchanged.

---

## Proposed change

Sub-proposal A is Tier 1 (concrete, implementation-ready). Sub-proposal B is Tier 2 (a
decision with a behavior-surprise cost) and is gated on the maintainer's choice.

**Recommended implementation order:** A (resolve and embed the entrypoint) first, then resolve
B (the unresolvable-entrypoint fallback).

---

## Tier 1

### A. Resolve the CLI entrypoint at install time and embed it in the hook

**Current behavior:** both post-commit templates are module-level string constants that embed
the bare token `squad sync --push --quiet`. The entrypoint is resolved from `PATH` at every
hook execution.

**Required behavior:** at install time, `installCrossRepoHook` resolves the running CLI's
entrypoint and embeds a **resolved invocation** in the hook body in place of the bare `squad`
token. Resolution reuses the project's existing self-location idiom rather than re-inventing
it:

- The Node binary is `process.execPath` (the absolute path to the Node executable running the
  install).
- The CLI entry script is resolved relative to the installing module via
  `fileURLToPath(import.meta.url)` — `install-hooks` resolves to the package's
  `cli-entry.js` (the `bin` target in `packages/squad-cli/package.json`, launched under Node
  ESM). The resolution probes the built `cli-entry.js` and, failing that, the source
  `cli-entry.ts` (so the resolver works both from the published `dist/` and from a
  source/test checkout), and finally `process.argv[1]` when it names a CLI entry. The first
  candidate that exists on disk is the resolved entry.

The embedded invocation is `<node> <cli-entry> sync --push --quiet` with both paths resolved
to absolutes and rendered `sh`-safe (see the shell-safety constraint below), e.g.
`'/c/Program Files/nodejs/node.exe' '/d/clone/dist/cli-entry.js' sync --push --quiet`. The two
post-commit templates become **builder functions** parameterized by the resolved invocation
string; the host variant's `.squad/`-only filter, the `SQUAD_SYNC_ACTIVE` guard, and the
marker are unchanged. `installCrossRepoHook` resolves the invocation once and passes it to the
selected builder; the public signature of `installCrossRepoHook` is unchanged (the resolution
is internal to the module — it is not threaded from the `squad assign` caller).

**Shell-safety / cross-platform constraint:** the hook is a `#!/bin/sh` script run by git's
`sh` (MSYS on Windows). The resolved invocation MUST survive a Windows absolute path: each
resolved path is converted to its POSIX/MSYS form (forward slashes, `C:\…` → `/c/…`) and then
single-quoted so spaces and shell metacharacters are inert. On non-Windows platforms the path
is already POSIX and only the quoting applies. The conversion is driven by the path shape (a
drive-letter / backslash path is converted) so it is deterministic regardless of the host the
install runs on.

**Hard constraints:**
- The installed post-commit hook (both host and product variants) invokes the resolved
  entrypoint — a `<node> <cli-entry> sync --push --quiet` invocation with absolute,
  `sh`-quoted paths — and **not** the bare token `squad` on the global `PATH`.
- The resolved entry is the CLI entry script of the process performing the install, so the
  hook runs the same CLI build that wrote it.
- The host variant still filters `.squad/`-only commits (the `git diff-tree … --root HEAD |
  grep -qv '^\.squad/'` diff is intact); the product variant still fires on any commit.
- The `SQUAD_SYNC_ACTIVE` recursion guard is preserved in both variants and the hook does not
  pre-set/export `SQUAD_SYNC_ACTIVE` (the sync command owns the guard).
- The `# --- squad-sync-hook ---` marker idempotency/chaining is preserved: re-installing does
  not duplicate the squad section, and an absolute-path invocation that changes the hook bytes
  still re-installs cleanly under `--force`.
- The resolved invocation is POSIX-shell-quoted and Windows-absolute-path-safe (drive letters,
  spaces, backslashes converted to an `sh`-safe form).
- No hook body moves into a template file: the hook bodies remain inline module constants/
  builders, so no `.squad-templates/` mirror change is required.

**Test surface:** (a) the installed post-commit hook (host variant) contains a resolved
`<node> <cli-entry> … sync --push --quiet` invocation and does not contain the bare
`squad sync` token; the product variant likewise. (b) a unit test of the invocation builder:
given a Node binary path and an entry path with spaces and a Windows drive letter, the built
string converts both to MSYS form and single-quotes them, and the suffix is
`sync --push --quiet`. (c) the recursion guard still suppresses the invocation when
`SQUAD_SYNC_ACTIVE=1` and runs it when unset (the existing sentinel fixture, retargeted at the
resolved invocation). (d) re-installing is idempotent (the marker appears once) and the host
variant's `.squad/`-filter diff is present.

---

## Tier 2 (decision)

### B. Fallback when the entrypoint cannot be resolved at install time

**Decision required:** what the hook should embed when the CLI entry script cannot be resolved
at install time (no `cli-entry` candidate exists on disk and `process.argv[1]` does not name a
CLI entry — an unusual layout, a packaging that relocates the entry, or an exotic launcher).

**Option B1 — Resolve with fallback to bare `squad` (recommended).** When the entrypoint
cannot be resolved, the builder embeds the current bare `squad sync --push --quiet` invocation,
exactly as today. The install never fails and the hook is never left empty; in the common case
the resolved entrypoint is embedded, and only the unresolvable edge case degrades to the prior
PATH-resolved behavior. Cost: in that edge case the version-skew exposure remains (identical to
today), but the install is never broken and no regression is introduced for any host that
previously worked.

**Option B2 — Hard-require a resolved entrypoint.** When the entrypoint cannot be resolved, the
install fails with an actionable error rather than embedding a bare `squad`. Cost: an install
path that previously succeeded (writing a bare-`squad` hook) now fails on any layout where the
entry cannot be located, which is a regression for hosts that were working — the failure mode
is worse than the skew it prevents.

**Recommendation: B1.** Degrade gracefully — never break an install that previously worked.
The resolved entrypoint is embedded whenever it can be found (the overwhelmingly common case),
and the bare-`squad` fallback preserves today's behavior only in the unresolvable edge case.

**Hard constraints (whichever is chosen):**
- The choice does not change the resolved-invocation behavior in A (when the entry resolves,
  the hook embeds the resolved entrypoint).
- The choice does not change the host/product variant selection or any guard/filter/marker.
- The decision and its rationale are recorded in the Phase-B triage file so it is auditable.

**Test surface:** for B1, the invocation builder given a null/unresolved entry returns the bare
`squad sync --push --quiet` invocation (and a test asserts the install still succeeds and writes
a non-empty hook). For B2, the same unresolved case causes the install to throw an actionable
error and a test asserts no hook is written.

---

## Acceptance

- Build exits 0.
- The installed cross-repo post-commit hook (host and product variants) invokes a resolved CLI
  entrypoint — a `<node> <cli-entry> sync --push --quiet` invocation with absolute, `sh`-quoted
  paths — and not the bare token `squad` on the global `PATH` (A).
- The resolved entry is the CLI entry script of the installing process, so the hook runs the
  same CLI version/build that installed it; no global-install skew (A).
- The resolved invocation is POSIX-shell-quoted and survives a Windows absolute path (drive
  letter, spaces, backslashes converted to an `sh`-safe MSYS form); the existing hook tests
  that exercise `sh` execution still pass (A).
- The host variant still filters `.squad/`-only commits and the product variant still fires on
  any commit; the `SQUAD_SYNC_ACTIVE` recursion guard, the no-`export`-of-the-guard rule, and
  the `# --- squad-sync-hook ---` marker idempotency/chaining are all preserved (A).
- The two post-commit hook bodies remain inline (now builder functions); no `.squad-templates/`
  mirror change is introduced (A).
- The backend sync hooks (`pre-push` / `post-merge` / `post-rewrite` / `post-checkout`) are
  unchanged — confirmed out of scope (they invoke `git`, never `squad`).
- Sub-proposal B is resolved one way or the other: either the builder falls back to a bare
  `squad sync --push --quiet` when the entry cannot be resolved (B1, install never breaks) or
  the install hard-fails with an actionable error (B2); the choice and rationale are recorded
  in the Phase-B triage.
- Tests cover: the resolved invocation embedded in both variants and the absence of the bare
  `squad sync` token; the invocation builder's MSYS conversion and single-quoting given a
  Windows path with spaces; the recursion-guard sentinel retargeted at the resolved invocation;
  the idempotent re-install and the intact host `.squad/`-filter; and the chosen B behavior
  (bare-`squad` fallback for an unresolved entry, or the hard-fail).
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
- No specific internal tenant/host URL appears in any documentation; placeholders use
  `dev.azure.com/contoso/MyProject`.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
