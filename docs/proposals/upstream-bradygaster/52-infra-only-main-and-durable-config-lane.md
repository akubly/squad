# 52 — Infra-only main and the durable config lane (Pole A)

## Summary

Today the orphan-backend host keeps the squad's **durable constitution** — roster, charters, routing,
`config.json`, templates, and process docs — tracked on the host's default branch (`main`), while
**ephemeral state** transports to `squad/state/<callsign>` via the fold pipeline. `init`'s
`applyAllowlistGitignore` deliberately implements this split (Sub-proposal J): it ignores only the
allowlisted ephemeral paths and leaves durable files tracked on `main`, with the explicit intent
"never a blanket `.squad/`." Call this **Pole B** (durable on `main`).

A design review of the shared-squad model concluded Pole B has a structural cost: it interleaves the
squad's **governance** diffs (a charter rewrite, a roster change) with the **product's** PR history on
`main`, and — for a product repository that also hosts a squad — pollutes the product's default branch
with squad content. The squad's constitution is not the product; it should not live on the product
lineage. This piece pivots to **Pole A**: **no squad content or state lands on `main`.** `main` becomes
a pure-infrastructure anchor (the fold workflow, a blanket `.squad/` ignore, and a README), the durable
constitution moves to its own reviewed orphan lineage `squad/config/<callsign>`, and ephemeral state
keeps its auto-fold orphan `squad/state/<callsign>`. This reverses `init`'s Sub-proposal J intent and
is a deliberate re-architecture, not a bug fix.

This piece establishes the **topology and the durable lane's storage**; the hands-off review transport
that advances the durable lane (publish → auto-PR → hydrate) is piece 53. It surfaced three decisions
that must be locked before the transport is built.

1. **`main` must exist, but only as infrastructure.** A durable anchor branch is non-negotiable —
   GitHub Actions `schedule`/`workflow_dispatch` only run from the workflow on the default branch, and
   an ADO pipeline is a resource that needs a durable anchor; ephemeral inbox branches are deleted
   post-fold and cannot host a cron. But nothing squad-specific beyond the fold workflow, the ignore,
   and a README needs to live there.

2. **The durable constitution needs a reviewed home that is not `main`.** Charters/roster/routing are
   the squad's constitution and must be review-gated (unlike logs), but putting them on `main` is the
   pollution Pole A rejects. They move to `squad/config/<callsign>`, a durable orphan advanced only by
   reviewed merges (the transport is piece 53).

3. **The classifier must partition every path into exactly one lane.** With three lanes — infra
   (`main`), durable (`squad/config/<callsign>`), ephemeral (`squad/state/<callsign>`) — plus
   machine-local scratch, every team-root path needs a deterministic home. Piece 51 fixed the
   ephemeral/scratch partition; this piece adds the durable partition (the complement).

This piece delivers three Tier-1 changes — (A) redefine `main` as infra-only for the orphan backend
and blanket-ignore the team root, (B) introduce the `squad/config/<callsign>` durable orphan and its
genesis seeding, (C) define the durable payload set as the deterministic complement of piece 51's
ephemeral+scratch partition — and resolves a Tier-2 decision (D) about whether the infra-only rule is
uniform across all topologies or hybrid for dedicated squad-host repositories.

Stack position: Part 52 of the cross-repo arc. Branches off piece 51
(`squad/piece-51-publish-allowlist-completion-and-team-root-state-hygiene`). It depends on piece 51's
completed ephemeral/scratch classification (the durable set is defined as its complement), `init`'s
`applyAllowlistGitignore` (which this piece's blanket-ignore replaces under Pole A), the orphan-backend
state lineage, and the callsign-scoped branch naming from piece 41.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`,
`51-publish-allowlist-completion-and-team-root-state-hygiene.md`,
`53-hands-off-durable-review-config-inbox-and-auto-pr.md` (the transport that consumes this
topology — read them as a pair), and the `_planning/dogfood-backlog.md` roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (`init` gitignore behavior, the
config-orphan seeding, the classifier) — include a `patch` changeset for `@bradygaster/squad-cli`
(and `@bradygaster/squad-sdk` if the classifier/templates are mirrored there).

---

## Problem

### 1. Pole B interleaves governance with product history

Under the shipped model a durable change (rewrite a charter, add a specialist to the roster) is a
commit on `main`. On a dedicated squad-host repo that is merely noisy; on a **product** repo that also
hosts a squad it is pollution — every product PR's `main` history is interleaved with squad-governance
diffs, and a reviewer reading `git log main` cannot separate "what shipped in the product" from "how
the squad reorganized itself." The design review flagged this as the fatal cost of keeping durable
content on `main`.

### 2. There is no reviewed lane at all

Independently of *where* durable content lives, the current transport gives it **no review**: the fold
pipeline carries only the ephemeral allowlist, so a charter edit is not folded — it is committed to
`main` by hand, or (worse, after piece 51 without this piece) it simply never leaves the author's
clone. The squad has a constitution with no defined, review-gated way to change it across developers.

### 3. `applyAllowlistGitignore` encodes the wrong pole

`init`'s Sub-proposal J writes an allowlist-scoped `.gitignore` precisely so durable files **stay
tracked on `main`**. Its own comments state the intent ("never a blanket `.squad/`"; the allowlisted
paths "should not be committed to the main branch"). Pole A requires the opposite: a **blanket** team-
root ignore so nothing squad-related is tracked on `main`, with durable content riding
`squad/config/<callsign>` instead. Landing Pole A is a deliberate reversal of shipped intent plus a
new durable lineage.

### 4. No deterministic durable partition

Piece 51 gave every mutable path an ephemeral or machine-local home. The durable partition — the
constitution files that must ride the reviewed lane — is still implicit (it is "everything tracked on
`main` that isn't ephemeral"). Pole A needs it explicit: a deterministic set so the piece-53 durable
publish carries exactly the constitution and nothing else.

---

## Proposed change

### Sub-proposal A (Tier 1) — `main` is infra-only for the orphan backend; blanket-ignore the team root

Under the orphan backend, `init` (and `install-fold-pipeline`'s gitignore step from piece 51 §D) write
a **blanket** team-root ignore instead of the allowlist-scoped one:

```
# --- squad (managed) ---
# No squad content or state is tracked on this branch. The durable constitution rides
# squad/config/<callsign>; ephemeral state rides squad/state/<callsign> (fold pipeline).
<callsign>/.squad/
# --- end squad (managed) ---
```

(Root-hosted squads use `.squad/`.) `main` retains only pure infrastructure: the fold workflow
(`.github/workflows/…` or `.azuredevops/…`), this `.gitignore`, and a README describing the two
orphan lineages. `applyAllowlistGitignore` is replaced by `applyBlanketGitignore` under Pole A; the
allowlist constants remain the authority for **what the fold transport carries** (piece 51), they just
no longer drive the `.gitignore`. Provide a one-time migration for a Pole-B host (a host whose `main`
already tracks durable `.squad/` files): `git rm -r --cached <team-root>/.squad`, seed the config
orphan from those files (B), and commit the infra-only `main`.

### Sub-proposal B (Tier 1) — the `squad/config/<callsign>` durable orphan and its genesis

Introduce a durable orphan branch `squad/config/<callsign>`, parallel in shape to
`squad/state/<callsign>`: an orphan (no `main` ancestor) whose tree is `.squad/**` restricted to the
durable payload set (C). Add a `squad config-init` (or fold into `init`/`install-fold-pipeline` under
the orphan backend) that, at genesis, publishes the seed durable content to `squad/config/<callsign>`
via the same commit-tree plumbing the state orphan uses (no `main` parent, tree = durable `.squad/**`
only). The branch advances **only** by reviewed merge (piece 53); genesis is the one exception (the
seed has no prior to review against). Register `configBranch = squad/config/<callsign>` and
`configRemote` on the registry entry so piece 53's publish/hydrate can find it.

### Sub-proposal C (Tier 1) — the durable payload set (deterministic complement)

Define `CONFIG_ALLOWLIST` (durable) as the deterministic complement of piece 51's ephemeral + machine-
local partition. Durable (rides `squad/config/<callsign>`):

- `team.md`, `roster.md`, `routing.md`, `charter.md`, `agents/<name>/charter.md`,
  `scribe-charter.md`, `fact-checker-charter.md`
- `config.json`, `casting-policy.json`
- process docs: `ceremonies.md`, `issue-lifecycle.md`, `mcp-config.md`, `multi-agent-format.md`,
  `copilot-instructions.md`, `constraint-tracking.md`
- `skill.md` / skills, `plugin-marketplace.md`
- `files/triage-flow/**` and other authored (non-generated) `files/**`
- `templates/**`

The classifier is total: assert in a test that **every** path is in exactly one of `CONFIG_ALLOWLIST`
(durable), `PUBLISH_ALLOWLIST` (ephemeral), or the machine-local scratch set — no path is unclassified
(no category-3 drift) and no path is in two lanes. A new path added to the team root without a lane
fails the classifier test (a guard against future drift).

### Sub-proposal D (Tier 2, decision) — uniform vs hybrid infra-only rule

- **D1 (recommended, uniform):** the infra-only-`main` rule applies to **all** topologies, including a
  dedicated squad-host repo. Uniform topology means one mental model, one migration, and identical
  tooling on product and host repos — the durable orphan is the only durable home everywhere.
- **D2 (hybrid):** a dedicated squad-host repo (no product content) may keep durable content on `main`
  (Pole B), and only product-hosting repos go infra-only. Less migration for existing hosts but two
  code paths and two mental models.

Record the decision and rationale in the triage file. The transport in piece 53 assumes D1 (durable
always on the config orphan); if D2 is chosen, piece 53 must branch on host kind.

---

## Acceptance

- Under the orphan backend, `init` and `install-fold-pipeline` write a **blanket** `.squad/` ignore;
  `main` tracks only the fold workflow, the `.gitignore`, and a README. `git add -A` on a fresh host
  stages no `.squad/` content (A).
- A Pole-B host migrates cleanly: durable `.squad/` files are removed from `main`'s index, seeded onto
  `squad/config/<callsign>`, and `main` is left infra-only with no durable loss (A).
- `squad/config/<callsign>` exists as an orphan (no `main` ancestor) whose tree is the durable payload
  only; genesis seeding produces it deterministically (B).
- The classifier is total and disjoint: a test asserts every team-root path is in exactly one lane;
  an unclassified new path fails the test (C).
- The durable payload carries the constitution (charters, roster, routing, config, templates, process
  docs) and **no** ephemeral/scratch content (C).
- The uniform-vs-hybrid decision (D) is recorded with rationale.
- Scrub gate contributes no new hits versus the piece-51 base; `@bradygaster/squad-cli` (+
  `@bradygaster/squad-sdk` if mirrored) changesets present.

> Note: this piece establishes the topology and durable storage only. The developer-facing flow that
> *changes* durable content across clones — publish to a config-inbox, auto-open a PR to
> `squad/config/<callsign>`, one human approval, hydrate on pull — is piece 53. Until piece 53 lands,
> the durable orphan is advanced only by genesis + manual reviewed merge.
