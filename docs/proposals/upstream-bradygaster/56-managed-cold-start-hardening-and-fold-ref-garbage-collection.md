# 56 — Managed cold-start hardening and fold inbox-ref garbage-collection

## Summary

Piece 55 delivered the consumer capstone: `squad assign --callsign <cs> --state-remote <url>
--state-branch squad/state/<cs> --config-branch squad/config/<cs> --skills-from host` stands up a
machine as a hands-off consumer of a published squad, hydrating a CLI-managed host clone under
`~/.squad/hosts/<callsign>/` and auto-wiring it so `squad doctor` is green. A live onboarding pilot then took two
real squads through the full managed path — cold-start, bind their
product clones, and a genuine Scribe write folded end-to-end into `squad/state/<cs>`. The mechanism
works. But the pilot surfaced a cluster of **rough edges that the happy-path piece-55 tests did not
exercise**, each of which degrades the "one command, no further steps, always green" promise for the
next onboarder:

1. **Cold-start ignores where it is run.** `squad assign --callsign …` from inside a product repo
   does *not* bind that repo — it only stands up the managed host and lists the managed clone as the
   sole clone. The user must run a *second* `squad assign <callsign>` from the product repo. Everywhere
   else `squad assign` binds the current directory; the cold-start form silently breaks that contract,
   turning the one-command story back into two commands.
2. **First hydrate is O(N) network round-trips.** The managed clone is created blobless and
   no-checkout (`--filter=blob:none --no-checkout`), then hydrated by a per-file `git cat-file blob`
   loop — so every one of ~1,000–1,600 team-root files is lazily fetched in its own network request. A
   real cold-start took tens of minutes. This is the single worst onboarding pain and it scales
   with squad size.
3. **The first `sync --push` re-publishes the entire squad.** Immediately after a cold-start hydrate,
   `squad sync --dry-run` reports hundreds of files "pending" (most of the team root on the pilot) even though
   every sampled file is byte-identical to the state orphan. The fold pipeline dedupes them to a no-op,
   but the first push needlessly manufactures a squad-sized inbox branch and a fold cycle.
4. **`doctor` cries wolf on a correctly-onboarded managed consumer.** Run from a bound product clone,
   `squad doctor` emits a scary `State folding is silently disabled` **error-adjacent warning** for the
   checkout-free managed host (whose fold pipeline actually lives and runs on the remote), plus
   `.squad/ directory … not found` and `.github/agents/squad.agent.md … file not found` errors for the
   product clone that has neither by design. None are real; no user action clears them; and one of the
   suggested fixes (`squad upgrade` in the product enlistment) would pollute an unrelated monorepo.
5. **A fold pipeline that fails to delete a folded inbox ref never retries.** The fold records each
   folded ref in `publish-history.json` *then* deletes the remote inbox branch best-effort
   (`git push --delete … || echo WARNING`). A single transient delete failure leaves the ref on the
   host, but it is now recorded as folded — so every later run skips it as "already recorded" and never
   re-deletes it. The pilot host still carries an orphan inbox branch from its first publish that has
   survived dozens of successful folds.

Piece 55's own acceptance was "one command → green host". Piece 56 is the hardening pass that makes
that promise hold under real onboarding: **the cold-start command binds the repo you run it from, the
first hydrate is one bulk transfer instead of thousands, the first sync is honest, `doctor` is
genuinely zero-error on a managed consumer, and the fold pipeline garbage-collects its own refs.**

Six Tier-1 changes — (A) cold-start binds the invoking product clone, (B) bulk managed hydrate,
(C) honest post-hydrate publish baseline, (D) doctor validates a checkout-free host's fold pipeline on
the remote, (E) doctor suppresses product-clone local false positives, (F) idempotent fold inbox-ref
garbage-collection — plus three Tier-2 decisions: (G) managed-clone fetch/hydrate shape, (H) cwd-bind
policy, and (I) publish-baseline strategy.

Stack position: Part 56 of the cross-repo arc, the hardening follow-up to the piece-55 consumer
capstone. Branches off piece 55
(`squad/piece-55-managed-consumer-clone-and-one-command-cold-start`, tip `c949cca3`). It depends on
piece 55's `_managedColdStart`, `managed: true` registry entry, managed-hosts path helper, and
auto-wire; on the piece-43/53 `hydrateTeamRootFromRef` state/config hydrate and its
`.last-hydrate-sha`/`.last-config-hydrate-sha` sentinels; on the piece-50/54 fold-pipeline templates
and `install-fold-pipeline`; and on the piece-55 §F doctor host-repo diagnostics it refines.

Changeset requirement: `packages/squad-cli/src/` is touched (assign cold-start cwd-bind, sync bulk
hydrate + publish baseline, doctor managed-host awareness) and the fold templates under
`packages/squad-cli/templates/fold/**` + `packages/squad-sdk/templates/fold/**` + `templates/fold/**`
are edited (F must land byte-identical across all copies so the template-sync governance test passes).
Include `patch` changesets for `@bradygaster/squad-cli` and, if the managed-hosts helper or a shared
resolver changes, `@bradygaster/squad-sdk`. No coordinator `squad.agent.md` change is required —
piece 55's session-start freshness sync already lights the pull path.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`,
`50-subfolder-host-and-self-hosted-runner-hardening.md`,
`52-infra-only-main-and-durable-config-lane.md`,
`54-config-pipeline-install-wiring-and-publish-batching.md`,
`55-managed-consumer-clone-and-one-command-cold-start.md`, and the `_planning/dogfood-backlog.md`
roadmap.

---

## Problem

### 1. Cold-start does not bind the product clone it is invoked from

`_managedColdStart` (`packages/squad-cli/src/commands/assign.ts`) is passed `ctx.cwd` but never reads
it: the function destructures `{ callsign, opts, writeRegistryFn }` and writes the managed registry
entry with `clones: [managedProjectDir]` — the managed host clone only. So:

```
cd /path/to/product-repo        # a real product enlistment
squad assign --callsign <cs> --state-remote <url> --state-branch squad/state/<cs> \
  --config-branch squad/config/<cs> --skills-from host --yes
# → stands up ~/.squad/hosts/<cs>, registers ONLY that as a clone.
# The product enlistment is NOT bound. Coordinator sessions here do not resolve the squad.
```

The user must then run a second command from the product repo:

```
squad assign <cs> --allow-origin-collision
```

This breaks the invariant that `squad assign` binds *the current directory*. The warm path
(`squad assign <callsign>`) binds cwd; the URL cold-start path (`squad assign <url> --clone-to <path>`)
binds the freshly-cloned `<path>`; only the piece-55 flag cold-start binds nothing the user is standing
in. The intended one-command onboarding — run once, from the repo you want on the squad — is not what
the command does.

### 2. The managed hydrate is O(N) lazy blob fetches

`_defaultManagedCloneCommand` (`assign.ts:351`) clones with `--filter=blob:none --no-checkout`, so the
managed clone starts with commits and trees but **no blobs**. Cold-start then hydrates each lane with
`hydrateTeamRootFromRef` (`packages/squad-cli/src/cli/commands/sync.ts:~1045`), whose core is:

```ts
const fileList = execFileSync('git', ['--git-dir', gitDir, 'ls-tree', '-r', '--name-only', ref])
  .split('\n');
for (const filePath of fileList) {
  const content = execFileSync('git', ['--git-dir', gitDir, 'cat-file', 'blob', `${ref}:${filePath}`]);
  fs.writeFileSync(outPath, content);
}
```

On a partial clone, every `cat-file blob` for a not-yet-present blob triggers an individual promisor
fetch over the network. For a squad with ~1,500 files that is ~1,500 sequential fetch round-trips — the
observed multi-minute cold-start. The blob filter buys nothing here because the very next step
materializes *every* blob anyway; it only converts one pack transfer into thousands of tiny ones.

### 3. A freshly hydrated consumer reports the whole squad as pending

`squad sync --dry-run` from the cold-started clone reports hundreds of files pending publish (most of
the team root), yet the sampled pending files are byte-identical to the state orphan blob (identical
blob SHAs). Pending detection compares file mtime against the `.last-publish` marker, but the hydrate
writes every file with a *fresh* local mtime while the hydrated `.last-publish` marker carries the
*seed's* old timestamp — so every hydrated file looks newer than the last
publish. The result is correct only because the fold pipeline dedupes identical payloads; the cost is
that the consumer's *first* `sync --push` manufactures a full squad-sized inbox branch and a fold
cycle for content that is already canonical.

### 4. `doctor` reports false positives on a correct managed consumer

Run from a bound product clone, `squad doctor` produces three findings that no correct configuration can
clear:

- **`State folding is silently disabled`** (`doctor.ts:259`, `_hostHasFoldPipeline`). The host-repo
  diagnostic inspects the managed host's *working tree* for `.github/workflows/fold-squad-state*.yml`.
  A managed host is a `--no-checkout` clone of an infra-only-`main` repo: its working tree is empty by
  construction, and the fold pipeline lives on the remote's `main` where it runs server-side. The check
  reports the pipeline missing even though it exists and is actively folding.
- **`.squad/ directory … not found`** and **`.github/agents/squad.agent.md … file not found`**
  (system/registry checks against cwd). An orphan-backend product clone bound to a managed host keeps
  no local `.squad` and no repo coordinator agent — those live in the managed host. The checks assume
  cwd is itself a team root and flag their absence as errors, and one remedy they print (`squad upgrade`
  here) would write `.squad` gitignore/gitattributes rules into an unrelated monorepo enlistment.

Piece 55 §F promised "a fresh managed host passes `squad doctor` with zero errors". That holds when
`doctor` is run *in the managed host*, but not when run from a bound product clone — the far more common
place a user actually runs it.

### 5. A failed inbox-ref delete is never retried, orphaning the branch

The fold pipeline (`templates/fold/github/fold-squad-state.yml` and the ADO variant) records each folded
ref in `publish-history.json`, then, at the end of the run:

```bash
if [ "${DELETE_FOLDED_REFS:-true}" = "true" ]; then
  for REF in $(echo "$FOLDED_ENTRIES" | jq -r '.[].ref'); do
    git push origin --delete "${REF#refs/heads/}" || echo "  WARNING: Failed to delete $REF — continuing."
  done
fi
```

The delete is best-effort. But the *skip guard* at the top of the fold loop excludes any ref already
present in `publish-history.json.foldedRefs`:

```bash
if printf '%s\n' "$FOLDED_REFS" | grep -qxF "$REF"; then
  echo "  Skipping $REF (already recorded in publish-history.json)"; continue
fi
```

So once a ref is recorded, a failed delete is permanent: the ref stays on the host, is skipped on every
subsequent run, and is never re-added to the delete set. The pilot host still carries an inbox branch
`squad/inbox/<cs>/<handle>/<timestamp>-…` from its very first publish — it has survived
dozens of successful scheduled folds while newer inbox branches were folded and deleted correctly. Over
a squad's life this leaks an unbounded set of orphan inbox branches.

---

## Proposed change

### Sub-proposal A (Tier 1) — cold-start binds the invoking product clone

After `_managedColdStart` writes the `managed: true` entry and auto-wires the host, if `ctx.cwd`
resolves to a git work tree whose root differs from `managedProjectDir`, bind that work tree as a clone
of the new managed entry in the *same* command: append its git root to the entry's `clones[]`, run the
existing warm-assign origin-collision detection (honoring `--allow-origin-collision`, and — per decision
I — auto-clearing when the collision is only with another callsign-distinguished managed consumer of the
same host), and install the cross-repo + product-squad-forbid hooks on the product clone via the same
seams the warm path uses. If `ctx.cwd` is not a git work tree (the "run from anywhere" case), preserve
today's host-only behavior. Net: `cd <product-repo>; squad assign --callsign … --state-remote …
--skills-from host` cold-starts the host **and** binds the repo, a true one-command onboarding, while
run-from-anywhere still works. Do not regress the warm path, the `<url> --clone-to` path, or the
host-only cold-start invoked outside any repo.

### Sub-proposal B (Tier 1) — bulk managed hydrate

Eliminate the O(N) per-file promisor fetch. Before (or instead of) the `cat-file blob` loop, materialize
the ref's blobs in a single network transfer, then write the working tree from local objects. Per
decision G, the mechanism is one of: (G1) a bulk `git fetch` of the two orphan ref tips *without* the
blob filter so all reachable blobs arrive in one pack, after which the existing loop reads purely local
objects; (G2) `git archive <ref> .squad | tar -x` (a single tree materialization) once blobs are local;
or (G3) drop `--filter=blob:none` from the managed clone entirely, since the consumer fully hydrates
both lanes anyway. Whatever the shape, the hydrate must issue **O(1) network round-trips per lane**, not
O(files), and must remain correct on a monorepo host (preserve the `resolveTeamRootGitDir` /
`--absolute-git-dir` handling) and idempotent (the `.last-hydrate-sha` fast-path skip is unchanged). A
regression test must assert the number of network-touching git invocations is independent of file count
(inject the git-exec seam and count `cat-file blob` / fetch calls).

### Sub-proposal C (Tier 1) — honest post-hydrate publish baseline

A freshly hydrated managed consumer must report **zero pending** until it makes a real local edit.
After a successful cold-start hydrate, stamp the publish baseline to reflect that the hydrated tree is
already canonical: per decision I, either (I1) rewrite `.squad/.last-publish` to the hydrate moment so
mtime-based pending detection sees no file newer than the last publish, or (I2) record the hydrated
state SHA as the publish baseline (e.g. reuse `.last-hydrate-sha` / a `publish-history` marker) and make
pending detection SHA-aware rather than mtime-based for the cold-start case. `squad sync --dry-run`
immediately after cold-start must list 0 pending files; a subsequent genuine edit to one team-root file
must then list exactly that file. This removes the squad-sized no-op first push without weakening
change detection for real edits.

### Sub-proposal D (Tier 1) — doctor validates a checkout-free host's fold pipeline on the remote

`_hostHasFoldPipeline` (`doctor.ts:436`) must recognize a managed / checkout-free host and validate the
fold pipeline against the **remote default branch**, not the empty local working tree. When the host
entry is `managed: true` (or the host clone is detectably no-checkout), resolve the fold pipeline by
listing the remote — e.g. `git ls-tree <remote>/HEAD -- .github/workflows` (and the `.azuredevops`
path) or `git ls-remote`/an API-free `git cat-file` against the fetched default-branch tree — and pass
when a non-empty `fold-squad-state*.yml` is present there. Only warn when the pipeline is genuinely
absent on the remote. This turns the pilot's false `State folding is silently disabled` into a pass for
a host that is, in fact, folding.

### Sub-proposal E (Tier 1) — doctor suppresses product-clone local false positives

When `doctor`'s cwd is a registered clone whose team root lives elsewhere (orphan backend / managed
host), the local-cwd checks for `.squad/`, the repo coordinator agent, and the managed gitignore/
gitattributes rules must **not** fire as errors against the product enlistment. Detect the product-clone
context (cwd matches a registry `clones[]` entry; the entry is orphan-backed or `managed: true`; the
team root resolves outside cwd) and either skip those checks or re-point them at the host, so a
correctly-bound product clone reports zero errors. Never print a remedy (`squad upgrade` in cwd) that
would write squad rules into an unrelated repo. Combined with D, `squad doctor` run from a bound product
clone of a managed consumer must reach **zero errors and zero false warnings**.

### Sub-proposal F (Tier 1) — idempotent fold inbox-ref garbage-collection

Make inbox-ref cleanup self-healing across all fold templates (`github` and `ado`, in all three
template roots). On each run, in addition to deleting the refs folded *this* run, delete any remote
`squad/inbox/<callsign>/*` ref that is already recorded in `publish-history.json.foldedRefs` but still
present on the host — a recorded-but-present ref is, by definition, a failed prior delete. Equivalently,
only record a ref as folded *after* its delete is confirmed, and re-attempt deletes for
recorded-but-present refs at the start of the run. Deletes remain best-effort within a run (never abort
a fold on a delete failure), but the failure must be *retried* next run rather than masked forever. A
template-level test (or a scripted harness) must assert that a ref recorded as folded but still present
on the remote is deleted on the next fold, and that no still-un-folded ref is ever deleted. Keep all
template copies byte-identical for the governance sync test.

### Sub-proposal G (Tier 2, decision) — managed-clone fetch/hydrate shape

- **G1 (recommended):** keep the blobless clone but add a single bulk `git fetch` of each orphan ref
  tip without the blob filter before hydrate, so all blobs arrive in one pack and the existing
  write-out loop reads local objects. Minimal change, preserves the partial-clone benefits for `main`.
- **G2:** materialize via `git archive <ref> .squad | tar -x` after a bulk fetch — fewer processes, but
  a second code path distinct from the shared `hydrateTeamRootFromRef` used by non-managed `--pull`.
- **G3:** drop `--filter=blob:none` from the managed clone — simplest, but transfers `main`'s blobs the
  consumer never uses.

Record the choice and rationale in the triage file; B is written against G1's ref-scoped bulk fetch but
must hold under any option. G1/G2 must not alter the non-managed `--pull` hydrate path.

### Sub-proposal H (Tier 2, decision) — cwd-bind policy for cold-start

- **H1 (recommended, auto-bind when in a repo):** if cwd is a git work tree distinct from the managed
  host, bind it automatically as part of cold-start (A), applying the same origin-collision policy as
  the warm path. A `--no-bind` opt-out is available for users who deliberately want a host-only stand-up
  from inside a repo.
- **H2 (explicit only):** cold-start never binds cwd; instead, when invoked inside a repo it prints the
  exact `squad assign <callsign>` follow-up. Lower magic, but keeps the two-command onboarding.

Record the choice and the opt-out flag (if H1) in the triage file; A is written against H1 but must
degrade cleanly to H2's guidance if H2 is chosen.

### Sub-proposal I (Tier 2, decision) — post-hydrate publish-baseline strategy

- **I1 (recommended, stamp `.last-publish`):** on cold-start hydrate, write `.squad/.last-publish` to
  the hydrate timestamp so mtime-based pending detection sees a clean baseline. Smallest change, matches
  the existing detection model.
- **I2 (SHA-based baseline):** record the hydrated state SHA as the publish baseline and make pending
  detection compare content/SHA rather than mtime for the cold-start case. More robust against clock
  skew, but a larger change to the sync pending model.

Record the choice and rationale in the triage file; C is written against I1 but must satisfy the same
acceptance under I2.

---

## Acceptance

- Running `cd <product-repo>; squad assign --callsign <cs> --state-remote <url> --state-branch
  squad/state/<cs> --config-branch squad/config/<cs> --skills-from host --yes` on a machine with no
  prior entry for `<cs>` completes as **one command** that both stands up the managed host under
  `~/.squad/hosts/<cs>/` **and** registers `<product-repo>` in the entry's `clones[]`, with the
  cross-repo + product-squad-forbid hooks installed on the product clone; run outside any repo, it
  preserves host-only behavior (A, H).
- The cold-start hydrate issues a number of network-touching git calls that is **independent of the
  team-root file count** (asserted via the injected git-exec seam), fixing the O(N) lazy-fetch; a
  real-size squad hydrates in one bulk transfer per lane, not thousands of round-trips (B, G).
- `squad sync --dry-run` run immediately after cold-start reports **0 files pending**; a subsequent
  edit to exactly one team-root file then reports exactly that one file pending (C, I).
- `squad doctor` run from a bound product clone of a managed consumer reports **zero errors and zero
  false warnings**: the checkout-free host's fold pipeline is validated on the remote default branch and
  passes when present (D), and the product clone's absent local `.squad`/coordinator-agent/gitignore
  rules are not flagged and no monorepo-polluting remedy is printed (E).
- The fold pipeline garbage-collects orphaned inbox refs: a ref recorded in
  `publish-history.json.foldedRefs` but still present on the remote is deleted on the next fold, while a
  still-un-folded ref is never deleted; all fold template copies remain byte-identical and pass the
  template-sync governance test (F).
- The G (fetch shape), H (cwd-bind policy), and I (publish-baseline) decisions are each recorded with
  rationale in the triage file.
- End-to-end: a second machine goes from nothing to a fully-wired, self-refreshing, **genuinely
  green-on-`doctor`** consumer with a single command run from the product repo, its first hydrate is
  fast, its first sync is a no-op, and the host it consumes does not leak inbox branches — the piece-55
  promise made to hold under real onboarding.
- Scrub gate contributes no new hits versus the piece-55 base; `@bradygaster/squad-cli`
  (and `@bradygaster/squad-sdk` if the managed-hosts helper changes) changesets present.
