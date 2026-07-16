# 55 — Managed consumer clone and one-command cold-start onboarding

## Summary

Pieces 50–54 made a shared squad *producible*: an infra-only-`main` host keeps its team root only on
orphan branches (`squad/config/<callsign>` durable, `squad/state/<callsign>` ephemeral), a fold
pipeline consumes the ephemeral inbox, and a config pipeline (piece 54) auto-PRs durable changes. What
is still missing is the *consumer* half: there is no single, hands-off command that stands up a machine
as a **consumer** of such a squad and keeps it fresh. A live onboarding pass — bringing a second
workstation onto two already-published squads — reduced the intended experience:

```
squad assign --callsign <cs> \
  --state-remote <url> --state-branch squad/state/<cs> \
  --config-branch squad/config/<cs> --inbox-handle <handle> --skills-from host
```

…to a multi-step manual recipe: hand-edit `registry.json`, run `squad sync --pull` against the exact
project directory (not the `.squad` directory — an unguided footgun), then `squad upgrade` from that
same directory to install the coordinator agent, skills, gitignore/gitattributes rules, workflows, and
git hooks. Miss any step and `squad doctor` reports errors. Worse, two of those doctor errors are
**false positives** that no user action can clear, so even a correctly-onboarded consumer never reaches
a clean bill of health.

This piece delivers the consumer story as one command. It introduces a **CLI-managed host clone** under
`~/.squad/hosts/<callsign>/` that the user never sees or maintains, a cold-start path that **hydrates
from the orphan branches** (not from a working tree that infra-only-`main` deliberately keeps empty),
**auto-wiring** so the host is immediately usable, and a **deterministic hands-off freshness sync**
driven from the coordinator's existing session-start hook (no durable charter change). It also repairs
the two `doctor` false positives so a freshly cold-started host passes `squad doctor` with **zero
errors**.

Six Tier-1 changes — (A) flag-driven cold-start identity, (B) the managed host clone, (C) orphan-branch
hydrate in cold-start, (D) auto-wire after first hydrate, (E) deterministic freshness sync, (F) a
zero-error `doctor` on a fresh managed host — plus three Tier-2 decisions: (G) managed-clone fetch
shape, (H) freshness-trigger policy, and (I) origin-overlap suppression for callsign-distinguished
managed entries.

Stack position: Part 55 of the cross-repo arc, and the consumer capstone of the Pole-A line
(51 hygiene, 52 topology, 53 durable transport, 54 deployment). Branches off piece 54
(`squad/piece-54-config-pipeline-install-wiring-and-publish-batching`, tip `9619896b`). It depends on
piece 54's config-pipeline install wiring and batched publish; on piece 53's `--push-config` lane,
`configBranch`/`configRemote` registry fields, and durable hydrate on `--pull`; on piece 52's
`squad/config/<callsign>` orphan and `seedConfigOrphan`; on piece 50 §A's remote/branch resolution and
§D's subfolder/self-install host resolution; and on the piece-43 `hydrateTeamRootFromRef` state hydrate
and its `.last-hydrate-sha` / `.last-config-hydrate-sha` sentinels.

Changeset requirement: `packages/squad-cli/src/` is touched (assign cold-start, managed-clone
resolution, upgrade auto-wire, doctor fixes) and `@bradygaster/squad-sdk` is touched (the managed-host
path helper and the copilot-payload ownership fix) — include `patch` changesets for
`@bradygaster/squad-cli` and `@bradygaster/squad-sdk`. The coordinator `squad.agent.md` template is
edited for the session-start freshness sync (E); it is installed per-machine by `upgrade` and folds
through the normal template-sync, so keep all template copies byte-identical.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`,
`50-subfolder-host-and-self-hosted-runner-hardening.md`,
`52-infra-only-main-and-durable-config-lane.md`,
`53-hands-off-durable-review-config-inbox-and-auto-pr.md`,
`54-config-pipeline-install-wiring-and-publish-batching.md`, and the `_planning/dogfood-backlog.md`
roadmap.

---

## Problem

### 1. There is no one-command consumer onboarding

`squad assign` has two shapes today: a **warm** path (`squad assign <callsign>`) that binds the current
directory to an *already-registered* squad, and a **cold-start** path
(`squad assign <url> --clone-to <path>`) that clones a host and then verifies `.squad/team.md` on the
checked-out working tree. Neither stands up a consumer from published orphan branches:

- The warm path fails with `ERR_ASSIGN_HOST_PATH_MISSING` unless `team.md` already exists on disk — but
  on a fresh machine it does not, and on an infra-only-`main` host it never will on `main` (piece 52
  gitignores the team root; it lives only on the orphan branches).
- The cold-start path requires a positional URL **and** a user-chosen `--clone-to` directory, and it
  checks the *working tree* for `team.md`. Against an infra-only-`main` host it clones `main`, finds no
  team root, and fails `ERR_ASSIGN_NO_TEAM_MD` (or `ERR_ASSIGN_NO_TEAM_MD`-equivalent) — even though the
  team root is fully present on `squad/config/<callsign>` and `squad/state/<callsign>`.

The flags the intended command needs — `--callsign`, `--state-remote`, `--state-branch`,
`--config-remote`, `--config-branch`, `--inbox-handle`, `--skills-from` — are already parsed by
`assign-args`, but `--callsign` alone yields `ERR_ASSIGN_MISSING_ARG` because the callsign is only
honored as a positional or as a cold-start override paired with a URL. The result is that onboarding a
consumer is a hand-wired registry edit plus a bare `squad sync --pull`, whose success hinges on passing
the **project directory** (the parent of `.squad`) rather than the `.squad` directory itself — an
undocumented footgun that silently mis-resolves to the legacy state branch and skips durable hydrate
when the wrong path is passed.

### 2. A consumer needs a clone, but the user should not own or maintain one

Hydration writes a team root into a working tree that must be backed by a real clone of the state/config
remote (the sentinels live at `.squad/.last-hydrate-sha` / `.squad/.last-config-hydrate-sha`, and
`--pull` fetches the orphan refs through that clone's `origin`). Today the user must create, place, and
remember that clone (`--clone-to`), and must never accidentally hand-edit it or a later `--pull` could
conflict. That is maintenance the product promises to hide. There is no notion of a **tool-owned** host
clone whose location is chosen by the CLI, recorded in the registry as managed, and refreshed by
clean overwrite because it is never hand-edited.

### 3. A fresh hydrate is not a working host

`hydrateTeamRootFromRef` writes the team-root *files* but installs none of the squad-owned machinery
that makes a coordinator session run: the repo `.github/agents/squad.agent.md`, the `.copilot/skills`
payload, the `.gitattributes`/`.gitignore` managed rules, the workflows, the global coordinator agent
at `~/.copilot/agents/squad.agent.md`, and the git sync hooks. All of those are installed by
`squad upgrade`, which the user must know to run — and must run from the project directory, or it fails
`No squad found — run init first`. A hydrate without that follow-up leaves a host that `doctor` reports
as broken and that Copilot cannot actually drive.

### 4. Staying fresh is a manual `sync --pull`

Even once onboarded, a pure consumer only receives new durable/ephemeral state when someone runs
`squad sync --pull`. There is no hands-off trigger: the fold and config pipelines keep the orphan
branches current, but the consumer's managed clone drifts until a human remembers to pull. The
coordinator already resolves the team root and identity at session start; it does not refresh the
managed clone there.

### 5. `doctor` reports two false positives that no user action can clear

On a correctly-onboarded consumer, `squad doctor` still shows:

- **`.github/agents/squad.agent.md — file not found`**, even immediately after a successful
  `squad upgrade` that printed `upgraded coordinator …`. `upgrade` writes the agent to
  `<dest>/.github/agents/squad.agent.md` where `dest` is the project directory, but `doctor` looks for
  it at `getGitRoot(cwd)/.github/agents/squad.agent.md`. On a **subfolder host** (one git repository
  with per-callsign subfolders — the managed-clone and multi-squad shapes both hit this) the project
  directory and the git root differ, so the file exists where `upgrade` wrote it and is reported missing
  where `doctor` reads it. The functional global coordinator (`~/.copilot/agents/squad.agent.md`, what
  Copilot actually loads) is installed correctly; only the repo-root check is a false negative.
- **`Orphan skill payload: "…squad-<cs>-squad-state-harvest-union" … callsign <cs> is not in the
  registry`**, with the remediation `Run "squad assign <cs>"` — which does not clear it. The host
  authored a custom skill whose *base name itself begins with `squad-`* (`squad-state-harvest-union`),
  so on disk the namespaced payload is `squad-<cs>-squad-state-harvest-union`. `_isOwnedPayload` strips
  the `squad-<cs>-` prefix, sees the remainder begins with `squad-`, and treats it as a stale
  double-prefix artifact *unless* the base appears in `knownSkillBases` — but `knownSkillBases` is built
  only from the static built-in template manifest, which does not enumerate host-authored custom skills.
  The payload is therefore declared unowned and attributed to the (registered) callsign, and no
  `assign` can inject a host custom skill into the CLI's static manifest. The warning is permanent and
  harmless — which is exactly why it must not be emitted.

A one-command onboarding that ends by telling the operator their host is broken is not hands-off. Piece
55 makes the fresh managed host pass `doctor` with zero errors.

---

## Proposed change

### Sub-proposal A (Tier 1) — flag-driven cold-start identity

Accept a cold-start invocation that carries **no positional argument and no `--clone-to`**, identifying
the squad entirely by flags:

```
squad assign --callsign <cs> \
  --state-remote <url> --state-branch <branch> \
  [--config-remote <url>] [--config-branch <branch>] \
  --inbox-handle <handle> --skills-from host
```

When `--callsign` is supplied together with `--state-remote`/`--state-branch` and no warm registry entry
for that callsign resolves, treat it as a **managed cold-start** (Sub-proposals B–D) rather than
emitting `ERR_ASSIGN_MISSING_ARG`. `--config-remote` defaults to `--state-remote` when omitted (matching
the piece-50 §A resolution precedence); `--config-branch` is optional (a state-only squad hydrates
without durable config, as `--pull` already tolerates). `--inbox-handle` sets the durable handle on the
new entry. `--skills-from host` selects the host's skills as the payload source (the existing
`assign-args` value; reject other values with the existing `ERR_ASSIGN_INVALID_SKILLS_SOURCE`). Preserve
every existing shape: bare `<callsign>` (warm), `<url> --clone-to` (explicit cold-start), and
handle-only updates continue to behave exactly as today.

### Sub-proposal B (Tier 1) — CLI-managed host clone under `~/.squad/hosts/<callsign>/`

Introduce a tool-owned host location the user never chooses or maintains:

- The managed host clone lives at `~/.squad/hosts/<callsign>/`; its team root is
  `~/.squad/hosts/<callsign>/.squad`. This satisfies the existing invariant that a registry entry's
  `path` ends in `.squad` and that `sync` derives the project directory as `dirname(entry.path)`.
- Add a single home-path helper (in `@bradygaster/squad-sdk`) that resolves the managed hosts root
  (`~/.squad/hosts`) and a per-callsign clone path, honoring the same home override seam the rest of the
  CLI already threads for tests.
- The registry entry created for a managed cold-start carries the state/config remote and branch fields
  (as the hand-wired consumer entries do today) plus a `managed: true` marker recording that the CLI
  owns the path. `doctor` and `upgrade` treat a `managed: true` entry's path as tool-owned: it is never
  reported as `missing path` when absent-then-created during onboarding, and it is understood to be a
  clean-overwrite hydrate target (never a user working tree).
- One managed clone per callsign. Multiple squads consumed on one machine get **separate** managed
  clones under `~/.squad/hosts/<callsign>/`, isolating their sentinels, hooks, and CI directories.

The user's real product clones are unchanged: `assign` still appends the bound product directory to the
entry's `clones[]`. Only the *host* moves under `~/.squad/hosts/`.

### Sub-proposal C (Tier 1) — orphan-branch hydrate in cold-start

The managed cold-start must obtain the team root from the **orphan branches**, not from a checked-out
working tree:

1. Create/ensure the managed clone at `~/.squad/hosts/<callsign>/` (fetch shape per decision G),
   configured with the state remote as `origin` (and the config remote if distinct).
2. Write the managed registry entry (Sub-proposal B) so resolution can find it.
3. Run the same durable+ephemeral hydrate `sync --pull` performs — `hydrateTeamRootFromRef` for
   `squad/state/<callsign>` and the piece-53 durable hydrate for `squad/config/<callsign>` — into the
   managed team root, writing the `.last-hydrate-sha` / `.last-config-hydrate-sha` sentinels. Reuse the
   existing hydrate helpers; do not fork a second code path.

Replace the working-tree `team.md` existence check for the managed cold-start with a **post-hydrate**
verification: after the config+state hydrate, assert `team.md` exists in the managed team root. If the
orphan branches carry no `team.md` (an unseeded or wrong-branch remote), fail fast with a message naming
the resolved remote and branches — the managed analogue of `ERR_ASSIGN_NO_TEAM_MD`, but evaluated
against the hydrated tree rather than `main`.

### Sub-proposal D (Tier 1) — auto-wire after first hydrate

Immediately after the first successful managed hydrate, run the `upgrade` install against the managed
project directory so the host is usable with **zero follow-up commands**: install the repo
`.github/agents/squad.agent.md`, the `.copilot/skills` payload, the `.gitattributes`/`.gitignore`
managed rules, the workflows, the global coordinator agent at `~/.copilot/agents/squad.agent.md`, and
the git sync hooks. Invoke the existing `runUpgrade` (or the shared install steps it calls) with the
managed project directory as `dest`, so `detectSquadDir` resolves the freshly hydrated `.squad` and does
not fail `No squad found`. The cold-start result reports both the hydrate (config/state file counts) and
the wiring (coordinator installed, hooks installed) so the operator sees a single completed onboarding.

### Sub-proposal E (Tier 1) — deterministic hands-off freshness sync

Keep a managed consumer fresh without any user command and without a durable charter change:

- Add a **deterministic session-start freshness pull** to the coordinator `squad.agent.md` template's
  existing session-start hook: when the resolved team root is a `managed: true` entry, run
  `squad sync --pull` for it before spawning work. The trigger is deterministic (per decision H:
  session-start-always, or a sentinel-age threshold), never a fuzzy agent judgment. Because the managed
  clone is tool-owned (Sub-proposal B), each pull is a conflict-free fast-forward to the sentinel SHA.
- Optionally add a **pull-before-push** to the coordinator's inlined Scribe commit step so a producing
  session refreshes the managed clone immediately before an orphan-branch publish, avoiding fold races.
  This lives in the same per-machine `squad.agent.md` (the coordinator's spawn-prompt block), **not** in
  the durable `.squad/agents/scribe/charter.md`, so it does not fold to every consumer.

Both edits are to the coordinator template installed per-machine by `upgrade`; the durable Scribe
charter is untouched.

### Sub-proposal F (Tier 1) — a zero-error `doctor` on a fresh managed host

Repair the two false positives so a freshly cold-started managed host passes `doctor` with zero errors:

- **F1 — agent-path agreement.** Make `upgrade` and `doctor` agree on where
  `.github/agents/squad.agent.md` lives for subfolder/managed hosts. `upgrade` writes it under the
  project directory (`dest`); `doctor` checks it under `getGitRoot(cwd)`. Converge them: `upgrade`
  installs the repo agent under the **git root** of `dest` (the same root where it already installs the
  workflows and git hooks), so all repo-scoped squad artifacts share one location and `doctor`'s
  git-root check passes. Where a project directory legitimately differs from the git root, `doctor` must
  find the agent that `upgrade` wrote — verify by installing then immediately checking on both a
  root host and a subfolder host.
- **F2 — custom `squad-`-prefixed skill ownership.** Fix `_isOwnedPayload` /
  `_extractCandidateCallsign` so a payload named `squad-<registeredCallsign>-<rest>` is recognized as
  **owned** whenever `<registeredCallsign>` is a registered callsign, regardless of whether `<rest>`
  itself begins with `squad-`. The double-prefix guard must only fire when the leading token is **not**
  a registered callsign; a registered-callsign prefix match wins over the stale-double-prefix heuristic.
  A host-authored skill whose base begins with `squad-` (e.g. `squad-state-harvest-union`) consumed by a
  registered callsign is therefore correctly attributed as owned and never reported as an orphan.

After F, onboarding a managed consumer and running `squad doctor` yields zero errors (remaining warnings
addressed by decision I).

### Sub-proposal G (Tier 2, decision) — managed-clone fetch shape

- **G1 (recommended, partial + single-branch):** clone the managed host with `--filter=blob:none` and
  fetch only the state/config orphan refs the entry needs. The managed clone is a pure hydration target
  — it never checks out `main` and never builds — so a blobless, ref-scoped clone minimizes disk and
  transfer while keeping every SHA the hydrate needs reachable.
- **G2 (full clone):** a plain `git clone` of the host. Simpler and offline-complete, but pulls history
  and blobs the consumer never uses.

Record the choice and rationale in the triage file; B/C above assume G1's ref-scoped fetch but must work
under either.

### Sub-proposal H (Tier 2, decision) — freshness-trigger policy

- **H1 (session-start always):** the coordinator pulls the managed clone on every session start.
  Simplest and always-fresh, but adds a network fetch to every session.
- **H2 (recommended, sentinel-age threshold):** pull only when the managed clone's `.last-hydrate-sha`
  sentinel is older than a bounded staleness window (e.g. a few hours), so back-to-back sessions do not
  re-fetch. Deterministic and bounded, with an explicit `squad sync --pull` still available on demand.

Record the choice and the threshold (if H2) in the triage file; E above is written against H2's bounded
trigger but must degrade cleanly to H1.

### Sub-proposal I (Tier 2, decision) — origin-overlap suppression for managed entries

Multiple squads consumed from one host repository share a state-remote URL, so `doctor`'s registry
origin-overlap warning fires for every pair of managed consumers of the same host — expected by the
multi-squad-one-host model, not an error.

- **I1 (recommended):** suppress the origin-overlap warning between two entries when both are
  callsign-distinguished (each has a distinct callsign and a distinct state/config branch), since
  resolution is unambiguous by callsign. Keep the warning for entries that are genuinely
  indistinguishable (no callsign, overlapping clones).
- **I2 (keep, document):** leave the warning and document it as expected for multi-squad hosts.

Record the choice and rationale in the triage file.

---

## Acceptance

- `squad assign --callsign <cs> --state-remote <url> --state-branch squad/state/<cs> --config-branch
  squad/config/<cs> --inbox-handle <handle> --skills-from host`, run on a machine with no prior entry
  for `<cs>`, completes with **no positional argument and no `--clone-to`**, creating a managed host
  under `~/.squad/hosts/<cs>/` and a `managed: true` registry entry (A, B).
- The command hydrates both lanes from the orphan branches into `~/.squad/hosts/<cs>/.squad` (config
  from `squad/config/<cs>`, state from `squad/state/<cs>`), writing both sentinels, and verifies
  `team.md` in the hydrated tree — succeeding against an infra-only-`main` host whose `main` carries no
  team root, and failing fast (naming the resolved remote/branches) when the orphan branches carry no
  `team.md` (C).
- After the command, the managed host is immediately usable with no follow-up: the repo agent, the
  `.copilot/skills` payload, gitignore/gitattributes rules, workflows, the global coordinator agent, and
  the git sync hooks are all installed (D).
- A coordinator session against a `managed: true` entry performs the deterministic freshness pull per
  the H decision (fast-forward only, no conflict) with no user command; the durable Scribe charter is
  unchanged (E).
- `squad doctor` on the freshly cold-started managed host reports **zero errors**: the repo
  `.github/agents/squad.agent.md` check passes (F1), and a host-authored skill whose base begins with
  `squad-` consumed by a registered callsign is **not** flagged as an orphan payload (F2).
- The managed-clone fetch shape (G), the freshness-trigger policy (H), and the origin-overlap-suppression
  decision (I) are each recorded with rationale; per I, two callsign-distinguished managed consumers of
  one host do not raise an origin-overlap error.
- End-to-end: a second machine goes from nothing to a fully-wired, self-refreshing consumer of a
  published squad with a **single command and no further steps**, and `squad doctor` is green — the
  Pole-A consumer capstone.
- Scrub gate contributes no new hits versus the piece-54 base; `@bradygaster/squad-cli` +
  `@bradygaster/squad-sdk` changesets present.
