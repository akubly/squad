# 50 — Subfolder-host and self-hosted-runner hardening

## Summary

A dogfooding pass that operated a **subfolder-hosted squad** (a host repository that nests each
squad's team root in its own `<callsign>/.squad/` subdirectory) on a **self-hosted CI runner**, and
exercised the cross-developer publish → fold → pull loop end to end from a separate product clone.
The fold loop itself is correct — a second developer's snapshot published, folded into
`squad/state/<callsign>`, and hydrated onto another clone — but six operator-facing gaps blocked or
silently corrupted the subfolder-host and self-hosted-runner configurations that the cross-repo model
already implies. None is a fold-correctness defect; each is a resolution, hygiene, or delivery gap
that cost real time during the pass.

1. **Cross-repo `sync` resolves the state remote in the wrong git context for a subfolder host.**
   In cross-repo mode the team root is a subdirectory of the host clone, so both `publishTeamRootToInbox`
   and `hydrateTeamRootFromStateRef` run git with `cwd = teamRoot`, whose git directory is the **host
   clone**. The registry's `stateRemote` (e.g. a name like `squad-state`) must therefore name a remote
   in the *host* clone — but an operator who added that remote to the *product* clone (the natural
   place, since that is where `sync` is invoked) sees `sync --pull` fail with `'<remote>' does not
   appear to be a git repository`. The host clone typically has only `origin`, which already is the
   state host, yet resolution does not fall back to it. The failure is opaque and points at the wrong
   clone.

2. **The fold templates' `--delete-folded-refs` cleanup emits an invalid refspec on a self-hosted
   Windows runner.** In a multi-ref fold run under Git-for-Windows bash, the **first** folded inbox
   ref in the cleanup loop is passed to `git push origin --delete` with a trailing control character
   (a stray `\r` from a CRLF-tainted `jq`/`while read` pipeline), producing `fatal: invalid refspec
   ':squad/inbox/…?'` and orphaning that already-folded ref. Subsequent refs in the same batch delete
   cleanly, and single-ref runs are unaffected — so the corruption is intermittent and batch-order
   dependent.

3. **`squad assign` installs the host-side cross-repo hook against the wrong git root for a subfolder
   host.** The warm-path host-side hook installer derives the host git root as the parent of the
   resolved `.squad` directory (`dirname(entry.path)`). For a subfolder-hosted squad the team root is
   `<hostRoot>/<callsign>/.squad`, so `dirname` yields `<hostRoot>/<callsign>` — not a git repository
   root — and the install fails: `is not a git repository root (root is "<hostRoot>"). Pass the git
   root directory, not a subdirectory.` The hook can never install for a subfolder host.

4. **`install-fold-pipeline` self-install detects only a root-level `.squad/`.** Piece 49's D1
   self-install path (target the current repo when it is itself the state host) checks for `.squad/`
   at the repo root only. A subfolder host has no root-level `.squad/` — its team roots are
   `<callsign>/.squad/` — so self-install fails on exactly the multi-squad layout piece 49 introduced,
   forcing the `squad assign` fallback that gap 3 also blocks.

5. **`squad doctor` reports false failures against a subfolder host.** Two checks resolve paths
   against the current working directory instead of the git repository root: (a) the
   `.github/agents/squad.agent.md` presence check fails for a subfolder host whose coordinator agent
   file is correctly at the git root; (b) a "Local `.squad/` directory found" warning fires for a
   legitimate registered subfolder team root, treating a valid multi-squad layout as a
   misconfiguration.

6. **`install-fold-pipeline` renders a cloud-hosted runner target that is dead on arrival where
   hosted runners are disabled.** The GitHub template is generated with `runs-on: ubuntu-latest`. On a
   host where cloud-hosted runners are unavailable (an enterprise that disables them) or where a
   self-hosted runner is required, the rendered workflow never runs until an operator hand-edits
   `runs-on` (and adds `defaults.run.shell: bash` for the POSIX fold body). The generator never adapts
   the runner target.

This piece delivers five Tier-1 fixes — (A) cross-repo state-remote resolution in the team-root/host
git context, (B) CRLF-safe fold-ref cleanup, (C) subfolder-aware host-side hook root resolution in
`squad assign`, (D) subfolder-aware `install-fold-pipeline` self-install detection, (E) subfolder-host
accuracy for two `squad doctor` checks — and resolves a Tier-2 decision (F) about how
`install-fold-pipeline` should target a self-hosted runner.

Stack position: Part 50 of the cross-repo arc. Branches off piece 49
(`squad/piece-49-self-hosted-fold-runners-and-multi-squad-host-onboarding`). Piece 49 added
self-hosted-runner fold-template durability, a manual fold trigger, and subfolder team-root
resolution in `squad assign`'s validation; piece 50 continues from the next pass, which ran that
multi-squad subfolder host on a self-hosted runner and drove a real cross-developer loop. It depends
on the cross-repo state-remote resolution from pieces 43/46, the `publishTeamRootToInbox` /
`hydrateTeamRootFromStateRef` team-root git-dir resolution from piece 47, the fold-ref cleanup set
(`$FOLDED_ENTRIES`) from piece 48, the subfolder team-root layout from piece 49, and the cross-repo
hook installer and `install-fold-pipeline` host resolution from pieces 45/48/49.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs
`43-cross-repo-state-remote-and-branch-resolution.md`,
`46-state-remote-resolution-hardening-and-transport-coverage.md`,
`47-monorepo-gitdir-and-sync-registry-robustness.md`,
`48-host-operability-fold-cleanup-and-doctor-diagnostics.md`,
`49-self-hosted-fold-runners-and-multi-squad-host-onboarding.md`, and the
`_planning/dogfood-backlog.md` roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (sync state-remote resolution, `assign`
hook root, `install-fold-pipeline` self-install + runner target, `doctor` checks) — include a `patch`
changeset for `@bradygaster/squad-cli`. The fold templates ship in `@bradygaster/squad-cli` and are
mirrored in `@bradygaster/squad-sdk`; because B modifies the fold templates, also include a `patch`
changeset for `@bradygaster/squad-sdk`.

---

## Problem

### 1. Cross-repo state-remote resolves in the product clone, but git runs in the host clone

In cross-repo mode the team root is resolved as the parent directory of the registry entry's `.squad`
path (`teamRoot = path.dirname(entry.path)`; piece 47 §A). For a subfolder host that team root is
`<hostRoot>/<callsign>`, and `git rev-parse --absolute-git-dir` from there resolves to the **host
clone's** `.git`. Both transport halves run git with `cwd = teamRoot`:

- `publishTeamRootToInbox` pushes the inbox ref to `effectiveStateRemote`.
- `hydrateTeamRootFromStateRef` fetches `refs/heads/<stateBranch>` from `effectiveStateRemote`.

`effectiveStateRemote` comes from the registry entry's `stateRemote` (piece 32/33). Piece 46 §A
hardened `resolveRemote(cwd)` to a deterministic precedence, but the cross-repo path passes the
registry `stateRemote` name through **without confirming it exists in the team-root git context**. An
operator naturally adds that remote to the product clone (where `sync` is invoked), not the host
clone, and the fetch/push then fails because the host clone has no such remote:

```
hydrateTeamRootFromStateRef: failed to fetch "squad/state/<callsign>" from "<remote>":
'<remote>' does not appear to be a git repository
```

The host clone almost always has `origin` pointing at the very repository that hosts the state
branches, but resolution neither validates the configured `stateRemote` against the team-root context
nor falls back to the host clone's own resolvable remote. The product clone's `stateRemote` is
vestigial — never consulted by git in cross-repo mode — yet it is where the operator was led to put
it.

### 2. The fold-ref cleanup corrupts the first refspec on a CRLF-tainted pipeline

With `--delete-folded-refs` enabled, the fold body deletes each successfully-folded inbox ref
(piece 48 §B — only the `$FOLDED_ENTRIES` set):

```bash
FOLDED_REF_LIST=$(echo "$FOLDED_ENTRIES" | jq -r '.[].ref')
while IFS= read -r REF; do
  [ -z "$REF" ] && continue
  git push origin --delete "${REF#refs/heads/}" || echo "  WARNING: Failed to delete $REF — continuing."
done <<< "$FOLDED_REF_LIST"
```

On the self-hosted Windows runner (Git-for-Windows bash, jq built for Windows) the observed failure is
that the **first** element carries a trailing `\r`, so the delete becomes `git push origin --delete
'squad/inbox/…\r'`, which git reports as `fatal: invalid refspec ':squad/inbox/…?'`. The `|| echo …`
swallows it as a warning, the run continues, and the ref is left orphaned on the remote (folded into
state but never cleaned up). Only the first ref in a multi-ref batch is affected; single-ref runs
(e.g. one developer publishing once) never reproduce it, which is why it survived earlier passes.

### 3. `squad assign` computes the host-side hook root as `dirname(.squad)`

The warm-path host-side cross-repo hook installer (piece 45) takes the resolved team root and derives
the host git root to install the post-commit hook into. For a root-hosted squad the team root is
`<hostRoot>/.squad` and `dirname` gives `<hostRoot>` — correct. Piece 49 §C taught the *validation*
step to resolve a subfolder team root (`<hostRoot>/<callsign>/.squad`), and registers the entry
against it, but the hook installer still does `dirname(entry.path)`, which for the subfolder form
yields `<hostRoot>/<callsign>` — not a git root. The install aborts:

```
Could not install cross-repo hook at host "<hostRoot>/<callsign>":
"<hostRoot>/<callsign>" is not a git repository root (root is "<hostRoot>").
Pass the git root directory, not a subdirectory.
```

`init`↔`assign` asymmetry that piece 49 closed for validation reopens here for the hook: a subfolder
host can be registered but its host-side fold-trigger hook can never install.

### 4. `install-fold-pipeline` self-install only sees a root-level `.squad/`

Piece 49 §D1 added self-install: when the registry lookup and `.squad/config.json` `stateLocation`
fallback both yield nothing and the current repo root holds `.squad/`, target the current repo root
(via `git rev-parse --show-toplevel`) instead of exiting with the `squad assign` guidance. The check
is `.squad/` at the repo root only. A subfolder host has no root-level `.squad/`; its team roots are
`<callsign>/.squad/`. So self-install fails on the very multi-squad layout piece 49 introduced, and
the operator is pushed back to `squad assign` — which gap 3 also blocks.

### 5. Two `squad doctor` checks resolve against the CWD, not the git root

- `checkSquadAgentMd` looks for `.github/agents/squad.agent.md` relative to the current working
  directory. For a subfolder host whose coordinator agent file is correctly at the **git root** (the
  layout `init`'s monorepo/`agentFileRoot` mode produces, #939), running `doctor` from anywhere but
  the git root reports a false FAIL.
- The "Local `.squad/` directory found" advisory fires for a registered subfolder team root, treating
  a legitimate multi-squad host as if a stray local squad were shadowing a cross-repo binding.

### 6. `install-fold-pipeline` hardcodes a cloud-hosted runner target

`install-fold-pipeline github` renders the GitHub template verbatim, which ships `runs-on:
ubuntu-latest`. Where cloud-hosted runners are disabled (an enterprise policy) or a self-hosted runner
is mandated, the rendered workflow is inert until an operator manually rewrites `runs-on` to a
self-hosted label set and adds `defaults.run.shell: bash` so the POSIX fold body (sed/awk/jq/tar)
runs under Git-Bash. The generator offers no runner-target option.

---

## Proposed change

### Sub-proposal A (Tier 1) — cross-repo state-remote resolution in the team-root git context

In the cross-repo publish and hydrate paths, resolve the effective state remote **in the team-root
git context** with this precedence, and never pass an unresolvable name to git:

1. If the registry entry's `stateRemote` is set **and** that remote exists in the team-root git
   context (`git -C <teamRoot> remote get-url <name>` succeeds), use it.
2. Otherwise fall back to `resolveRemote(teamRoot)` (piece 46 §A precedence: tracking remote; else the
   sole remote; else `origin` when it exists).
3. Otherwise fail with an actionable `SquadError` that names the **host clone** git root (not the
   product clone), the missing remote, and the remediation (`git -C <hostRoot> remote add <name>
   <url>` or clear the registry `stateRemote` to use the host clone's `origin`).

A configured-but-absent `stateRemote` (the exact dogfood failure) now falls through to the host
clone's `origin` instead of throwing an opaque fetch error. Single-repo (non-cross-repo) resolution is
unchanged.

### Sub-proposal B (Tier 1) — CRLF-safe fold-ref cleanup

Harden the `--delete-folded-refs` loop in all four fold-template copies so no ref carries a stray
carriage return. Strip CR from the `jq` output and read line-safely:

```bash
FOLDED_REF_LIST=$(echo "$FOLDED_ENTRIES" | jq -r '.[].ref' | tr -d '\r')
while IFS= read -r REF; do
  REF="${REF%$'\r'}"
  [ -z "$REF" ] && continue
  git push origin --delete "${REF#refs/heads/}" || echo "  WARNING: Failed to delete $REF — continuing."
done <<< "$FOLDED_REF_LIST"
```

Apply the same CR-strip defensively to the other `jq -r … | while read` pipelines in the fold body
that feed git refspecs (the `FOLDED_REFS` recorded-ref scan and the `INBOX_REFS` discovery loop), so a
CRLF-tainted Windows runner never injects a control character into a refspec. All four copies
(`packages/squad-cli` + `packages/squad-sdk`, ado + github) stay byte-identical within each platform;
edit the canonical source and re-sync.

### Sub-proposal C (Tier 1) — subfolder-aware host-side hook root in `squad assign`

In the warm-path host-side hook installer, resolve the host git root with `git rev-parse
--show-toplevel` (cwd = the resolved team root) instead of `dirname(entry.path)`. For a root-hosted
squad this yields `<hostRoot>` (unchanged); for a subfolder-hosted squad
(`<hostRoot>/<callsign>/.squad`) it yields `<hostRoot>` correctly. Install the cross-repo hook against
that git root. If `git rev-parse --show-toplevel` fails (the team root is not inside a git work tree),
keep today's actionable error but sourced from the real git query. This mirrors, on the hook side, the
subfolder resolution piece 49 §C added on the validation side.

### Sub-proposal D (Tier 1) — subfolder-aware `install-fold-pipeline` self-install

Extend the piece-49 §D1 self-install detection: when the registry lookup and `stateLocation` fallback
both yield nothing, target the current repo root (via `git rev-parse --show-toplevel`) when **either**
the repo root holds `.squad/` (today) **or** the repo root holds at least one `<subdir>/.squad/team.md`
matching the callsign-named subfolder layout `init` produces. Because the fold pipeline is
repo-level and callsign-generic (piece 41 §B — it discovers all callsigns at run time), the install
target is the git root in both cases; the only change is recognizing the subfolder host as a valid
self-install target. Do not scan for arbitrary `*/.squad` — recognize the layout, then install at the
git root. A directory that is neither a registered clone nor any recognized squad host still fails
fast with the `squad assign` guidance.

### Sub-proposal E (Tier 1) — subfolder-host accuracy in `squad doctor`

- **E1** — resolve the `.github/agents/squad.agent.md` presence check against the git repository root
  (`git rev-parse --show-toplevel`), not the current working directory, so a subfolder host whose
  coordinator file is at the git root passes from any working directory. When not inside a git work
  tree, keep the current cwd-relative behavior.
- **E2** — suppress the "Local `.squad/` directory found" advisory when the local `.squad/` is a
  **registered** team root (matches a registry entry `path`, including the subfolder form). The
  advisory still fires for an unregistered stray `.squad/` that could shadow a cross-repo binding.

### Sub-proposal F (Tier 2, decision) — `install-fold-pipeline` self-hosted runner target

- **F1 (recommended):** add an `install-fold-pipeline --runner "<labels>"` option (e.g. `--runner
  "self-hosted,Windows,X64"`). When supplied, the GitHub template is rendered with `runs-on:
  [<labels>]` and, when the label set is non-`ubuntu`/non-Linux, `defaults.run.shell: bash` so the
  POSIX fold body runs under Git-Bash. Absent the flag, rendering is byte-identical to today
  (`runs-on: ubuntu-latest`, no `defaults.run.shell`). The ADO template is agent-pool-driven and
  unaffected; document the equivalent pool selection.
- **F2:** keep `ubuntu-latest` as the only rendered target and document the manual `runs-on` /
  `defaults.run.shell` edit for self-hosted hosts in the setup guide.

Record the decision and rationale in the triage file.

---

## Acceptance

- Cross-repo `sync --pull`/`--push` against a subfolder host whose registry `stateRemote` is unset or
  names a remote absent from the host clone resolves the host clone's `origin` and completes; an
  entry naming a remote that exists in neither context fails with an error naming the host git root
  and the remediation (A).
- A multi-ref fold run with `--delete-folded-refs` on a CRLF-prone runner deletes **every** folded
  ref, including the first, with no `invalid refspec` warning; all four template copies byte-identical
  within each platform (B).
- `squad assign` against a subfolder host installs the host-side cross-repo hook at the host git root
  and succeeds; a root-hosted host is unchanged (C).
- `install-fold-pipeline` self-install succeeds inside a subfolder host (installs at the git root);
  inside a non-squad repository it still fails fast with the `squad assign` guidance (D).
- `squad doctor` run from any directory of a registered subfolder host reports neither the
  `squad.agent.md` FAIL nor the local-`.squad/` advisory; an unregistered stray `.squad/` still warns
  (E).
- With F1: `install-fold-pipeline --runner "self-hosted,Windows,X64"` renders `runs-on: [self-hosted,
  Windows, X64]` + `defaults.run.shell: bash`; without the flag rendering is byte-identical to today.
- Scrub gate contributes no new hits versus the piece-49 base; `@bradygaster/squad-cli` (+
  `@bradygaster/squad-sdk` for B) changesets present.
