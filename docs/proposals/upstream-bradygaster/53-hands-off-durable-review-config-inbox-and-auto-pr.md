# 53 — Hands-off durable review: config-inbox and auto-PR

## Summary

Piece 52 gave the durable squad constitution its own reviewed home — the orphan branch
`squad/config/<callsign>` — but left it advanced only by genesis plus manual merge. The whole point of
the fold model is that ephemeral state moves **hands-off**: a developer publishes, a pipeline folds,
another developer pulls, with no one operating git branches by hand. Durable content deserves the same
ergonomics **plus** a review gate: hands-off to the author, one human approval. This piece delivers
that transport — a developer's durable change publishes to a **config-inbox** lane, a pipeline
**auto-opens a pull request** from that inbox into `squad/config/<callsign>`, a human approves and
merges (the only gate), and `sync --pull` **hydrates** the merged durable content back into every
clone. It closes the loop opened by pieces 51–52 and makes durable governance as low-friction as
ephemeral state, without giving up review.

The transport is symmetric with the ephemeral fold, with exactly one difference — a merge/approval gate
instead of a force-push:

| | Ephemeral (state) | Durable (config) |
|---|---|---|
| Publish target | `squad/inbox/<callsign>/<dev>/…` | `squad/config-inbox/<callsign>/<dev>/…` |
| Payload | `PUBLISH_ALLOWLIST` (piece 51) | `CONFIG_ALLOWLIST` (piece 52 §C) |
| Pipeline action | fold → **force-push** `squad/state/<callsign>` | assemble → **open PR** into `squad/config/<callsign>` |
| Gate | none (last-writer-wins) | one human approval (CODEOWNERS / branch policy) |
| Consume | `sync --pull` hydrates state | `sync --pull` hydrates config |

It surfaced four requirements.

1. **A durable publish lane distinct from the ephemeral one.** Durable changes must not fold silently
   into state; they publish to `squad/config-inbox/**` carrying only `CONFIG_ALLOWLIST`.

2. **A pipeline that opens a PR rather than force-pushing.** The config pipeline assembles a candidate
   durable tree from the inbox payload and opens a PR into `squad/config/<callsign>` — feasible and
   hands-off on both GitHub (`gh pr create` / peer action + CODEOWNERS) and ADO (`az repos pr create`
   + branch policies) — with the well-known caveats each platform imposes on bot-opened PRs.

3. **Durable hydrate on pull.** `sync --pull` must hydrate the durable set from
   `squad/config/<callsign>` into the team root, alongside the existing state hydrate, without the two
   lanes clobbering each other.

4. **Surfacing durable changes so they are actually promoted.** Because durable mutation is deliberate
   and low-frequency, the CLI must notice uncommitted durable team-root changes and one-line the path
   to promotion (publish → auto-PR), so a charter edit is not silently stranded locally.

This piece delivers four Tier-1 changes — (A) the config-inbox publish lane, (B) the GitHub auto-PR
config pipeline, (C) the ADO auto-PR config pipeline, (D) durable hydrate in `sync --pull` + registry
wiring — plus an operator-surfacing change (E), and resolves a Tier-2 decision (F) about whether to
keep two physically distinct inbox lanes or a single superset the pipeline demultiplexes.

Stack position: Part 53 of the cross-repo arc, and the capstone of the Pole-A trilogy (51 hygiene, 52
topology, 53 transport). Branches off piece 52
(`squad/piece-52-infra-only-main-and-durable-config-lane`). It depends on piece 52's
`squad/config/<callsign>` orphan, `configBranch`/`configRemote` registry fields, and `CONFIG_ALLOWLIST`;
on piece 51's ephemeral partition (so the two publish lanes are disjoint); and on the existing
`publishTeamRootToInbox` / `hydrateTeamRootFromStateRef` machinery and the fold templates it mirrors.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`,
`51-publish-allowlist-completion-and-team-root-state-hygiene.md`,
`52-infra-only-main-and-durable-config-lane.md`, the fold-pipeline specs (41/44/48/50), and the
`_planning/dogfood-backlog.md` roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (publish/hydrate/status) and the config
pipeline templates are added (mirrored in `@bradygaster/squad-sdk`) — include `patch` changesets for
`@bradygaster/squad-cli` and `@bradygaster/squad-sdk`.

---

## Problem

### 1. Durable content has a home but no hands-off way in

Piece 52's `squad/config/<callsign>` advances only by genesis + manual merge. A developer who edits a
charter has no CLI path that carries it to the reviewed lane; they would have to hand-craft a branch
and PR. That is exactly the friction the fold model removed for ephemeral state, reintroduced for the
content that matters most.

### 2. The two lanes must not cross-contaminate

`publishTeamRootToInbox` filters to `PUBLISH_ALLOWLIST`. A naive durable publish that reused it would
carry ephemeral content into the config lane, or fold durable content into state. The publish path must
select the payload by lane (`CONFIG_ALLOWLIST` for the config lane, `PUBLISH_ALLOWLIST` for state) and
push to the lane's inbox prefix.

### 3. Auto-PR has platform caveats that must be handled, not discovered in production

Both platforms can open a PR hands-off, but each has a sharp edge:

- **GitHub:** a PR opened by the default `GITHUB_TOKEN` does **not** trigger downstream workflows
  (`on: pull_request`) — so if the config lane needs CI on the candidate, use a PAT/App token, not
  `GITHUB_TOKEN`. CODEOWNERS on `squad/config/<callsign>` routes the required reviewer.
- **ADO:** the build service identity needs "Contribute to pull requests" on the repo, and
  `System.AccessToken` must be exposed to the job; a branch policy on `squad/config/<callsign>`
  supplies the required-reviewer gate. Watch "Limit job authorization scope."

### 4. Durable changes get silently stranded without surfacing

Durable edits are deliberate and rare, so a developer will not habitually run a "publish my charter
change" command. The CLI must detect uncommitted durable team-root changes (files in `CONFIG_ALLOWLIST`
that differ from the hydrated `squad/config/<callsign>` tip) and surface the one-line promotion path at
natural checkpoints (`squad status`, session end).

---

## Proposed change

### Sub-proposal A (Tier 1) — the config-inbox publish lane

Generalize the publish path to be lane-aware. Add `squad sync --push-config` (or extend `--push` to
publish both lanes when both have changes) that snapshots the team root filtered to `CONFIG_ALLOWLIST`
and pushes it to `squad/config-inbox/<callsign>/<dev-alias>/<timestamp>` on the config remote, using
the same commit-tree plumbing and dev-alias/publishedAt metadata as the ephemeral publish. The
ephemeral `--push` is unchanged and continues to carry only `PUBLISH_ALLOWLIST`. Refactor
`publishTeamRootToInbox(payloadAllowlist, inboxPrefix, remote, branchRef)` so both lanes share one
filtered-snapshot implementation and cannot cross-contaminate.

### Sub-proposal B (Tier 1) — GitHub auto-PR config pipeline

Add a GitHub config-pipeline template (parallel to the fold template, callsign-generic, discovered at
run time) triggered on push to `squad/config-inbox/**` (plus `workflow_dispatch`). It: checks out
`squad/config/<callsign>` (or genesis-seeds it if absent — piece 52 §B), overlays the inbox payload's
durable `.squad/**` onto a candidate branch `squad/config-candidate/<callsign>/<timestamp>`, commits,
pushes the candidate, and opens a PR into `squad/config/<callsign>` via `gh pr create` with a body
naming the dev-alias, publishedAt, and the changed durable paths. Document the `GITHUB_TOKEN`
downstream-CI caveat and recommend a PAT/App token when the config lane runs CI; ship a `CODEOWNERS`
snippet routing `<team-root>/.squad/**` reviewers. The inbox ref is deleted only after the PR is
opened (mirroring the fold's `--delete-folded-refs`, CRLF-safe per piece 50 §B).

### Sub-proposal C (Tier 1) — ADO auto-PR config pipeline

Add the ADO equivalent: a pipeline triggered on `squad/config-inbox/*` that assembles the candidate and
opens the PR via `az repos pr create` (or the REST API) under `System.AccessToken`, targeting
`squad/config/<callsign>`. Document the required build-service permission ("Contribute to pull
requests"), the `System.AccessToken` exposure, the "Limit job authorization scope" setting, and a
branch policy on `squad/config/<callsign>` for the required-reviewer gate. Keep the GitHub and ADO
config templates behaviorally aligned; ship both mirrored in `squad-cli` and `squad-sdk` and kept
byte-identical within each platform via the template-sync step.

### Sub-proposal D (Tier 1) — durable hydrate on pull + registry wiring

Extend `sync --pull` to hydrate the durable set from `squad/config/<callsign>` (via `configRemote` /
`configBranch` on the registry entry, resolved in the team-root git context per piece 50 §A) into the
team root, alongside the existing state hydrate. The two hydrates write disjoint path sets (durable vs
ephemeral, guaranteed disjoint by piece 52 §C's total classifier), so they compose without clobbering;
land the durable hydrate first, then the state hydrate. Record a durable sentinel
(`.squad/.last-config-hydrate-sha`) parallel to `.last-hydrate-sha`, and make re-pull idempotent. If
`configBranch` is unset (a host predating piece 52), skip the durable hydrate with a one-line notice.

### Sub-proposal E (Tier 1) — surface unpromoted durable changes

In `squad status` (and at session end), diff the team root's `CONFIG_ALLOWLIST` files against the
hydrated `squad/config/<callsign>` tip (`.last-config-hydrate-sha`). When durable files differ, print a
single actionable line: `Durable config changed (charter.md, roster.md) — run 'squad sync
--push-config' to open a review PR.` This is the only nudge needed because durable mutation is rare and
deliberate; do not block or auto-publish.

### Sub-proposal F (Tier 2, decision) — one inbox lane or two

- **F1 (recommended, two lanes):** keep `squad/inbox/**` (ephemeral) and `squad/config-inbox/**`
  (durable) physically distinct, each with its own pipeline. Simplest to reason about — a ref's prefix
  fully determines its handling (force-push fold vs auto-PR); no pipeline-side classification.
- **F2 (single superset lane):** publish one snapshot to `squad/inbox/**` and have a single pipeline
  demultiplex — fold the ephemeral subset (force-push) and auto-PR the durable subset. Fewer branches
  but the pipeline must classify every path and split one payload into two destinations with two
  different gates — more failure surface.

Record the decision and rationale in the triage file. A/B/C/D above assume F1.

---

## Acceptance

- A durable team-root change (e.g. edit `charter.md`) published via `squad sync --push-config` appears
  as a ref under `squad/config-inbox/<callsign>/<dev>/…` carrying only `CONFIG_ALLOWLIST` content — no
  ephemeral files (A).
- The GitHub config pipeline opens a PR from the assembled candidate into `squad/config/<callsign>`
  hands-off, with a body naming the dev-alias and changed durable paths, and does not merge without a
  human approval; CODEOWNERS routes the reviewer (B).
- The ADO config pipeline opens the equivalent PR under `System.AccessToken` with a branch policy
  supplying the required-reviewer gate (C).
- After the config PR merges, `sync --pull` hydrates the durable change into another clone alongside
  the state hydrate, the two lanes do not clobber, `.last-config-hydrate-sha` matches the merged tip,
  and re-pull is a no-op (D).
- `squad status` prints the one-line promotion nudge when a durable file differs from the hydrated
  config tip, and is silent otherwise (E).
- The one-lane-vs-two decision (F) is recorded with rationale.
- End-to-end: a second developer's charter edit reaches every clone through publish → auto-PR → one
  approval → merge → pull, with no manual git branch operation by any developer (the Pole-A hands-off
  durable-review goal).
- Scrub gate contributes no new hits versus the piece-52 base; `@bradygaster/squad-cli` +
  `@bradygaster/squad-sdk` changesets present.
