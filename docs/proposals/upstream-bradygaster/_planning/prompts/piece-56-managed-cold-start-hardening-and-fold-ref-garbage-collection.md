@Lead and Team, this is the Phase B replay session for piece 56 of the upstream stack.
Phase A staged the piece 56 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 56 this session. No PR creation in Phase B. Piece 56 is the **hardening pass** on
the piece-55 consumer capstone. Piece 55 made shared-squad consumption one command: `squad assign
--callsign <cs> --state-remote <url> --state-branch squad/state/<cs> --config-branch squad/config/<cs>
--skills-from host` stands up a CLI-managed host clone under `~/.squad/hosts/<callsign>/` and auto-wires
it. A live pilot then drove two real squads through that path — cold-start, bind product clones, and a
genuine Scribe write folded end-to-end into `squad/state/<cs>`. The mechanism works, but the pilot
surfaced five rough edges the happy-path tests did not exercise: (1) cold-start ignores the repo it is
run from and binds nothing the user is standing in; (2) the first hydrate is O(N) lazy blob fetches
(many minutes on a real squad); (3) the first `sync --push` re-publishes the whole squad as a no-op; (4)
`doctor` reports false errors/warnings on a correctly-bound managed consumer; (5) a fold pipeline that
fails to delete a folded inbox ref never retries, leaking orphan branches. Piece 56 makes the piece-55
promise hold under real onboarding.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-56-managed-cold-start-hardening-and-fold-ref-garbage-collection`
  off `squad/piece-55-managed-consumer-clone-and-one-command-cold-start` (tip `c949cca3`)
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of the clone.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs
into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/50-subfolder-host-and-self-hosted-runner-hardening.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/52-infra-only-main-and-durable-config-lane.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/54-config-pipeline-install-wiring-and-publish-batching.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/55-managed-consumer-clone-and-one-command-cold-start.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56-managed-cold-start-hardening-and-fold-ref-garbage-collection.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `56-managed-cold-start-hardening-and-fold-ref-garbage-collection.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be staged before
this session proceeds.

`_planning/dogfood-backlog.md` is roadmap context. The backlog's "Operational follow-ups" are host
administrative actions, NOT stack pieces — ignore them as implementation scope.

Piece 56 delivers six Tier-1 sub-proposals and three Tier-2 decisions. A is cold-start binds the
invoking product clone; B is bulk managed hydrate; C is an honest post-hydrate publish baseline; D is a
doctor fold-pipeline check that validates a checkout-free host on the remote; E is doctor suppression of
product-clone local false positives; F is idempotent fold inbox-ref garbage-collection. G (managed-clone
fetch/hydrate shape), H (cwd-bind policy), and I (publish-baseline strategy) are Tier-2 decisions —
triage them first and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-55 base; do not assume signatures or line numbers.

- **Managed cold-start.** In `packages/squad-cli/src/commands/assign.ts` confirm `_managedColdStart`
  (the `ctx` it receives — note `cwd` is passed but currently unused), the managed entry write
  (`clones: [managedProjectDir]`), `_defaultManagedCloneCommand` (`--filter=blob:none --no-checkout`),
  the auto-wire (`installCoordinatorAgent`, `runUpgrade`, `installCrossRepoHook`), and the trigger guard
  at the top of `runAssign` (flag cold-start fires only when `--callsign` is present with no positional
  arg, no `--clone-to`, `--state-remote`+`--state-branch` present, and `_findWarmEntry` returns
  undefined). For A, confirm the warm-assign bind path (how cwd's git root is appended to `clones[]`,
  the origin-collision check, `--allow-origin-collision`, and the product-squad-forbid + cross-repo hook
  installers) so cold-start can reuse it verbatim rather than a second copy. Do NOT regress the warm
  path, the `<url> --clone-to` path, handle-only updates, or host-only cold-start run outside a repo.
- **Hydrate.** In `packages/squad-cli/src/cli/commands/sync.ts` confirm `hydrateTeamRootFromRef` (the
  `ls-tree -r --name-only` + per-file `cat-file blob` loop, ~lines 1045–1058), `hydrateTeamRootFromStateRef`
  / `hydrateTeamRootFromConfigRef`, the `.last-hydrate-sha` fast-path skip, `resolveTeamRootGitDir` /
  `--absolute-git-dir` monorepo handling, and the `pruneLane` durable-lane pruning. For B, the bulk
  fetch must slot in without changing the non-managed `--pull` semantics or the monorepo git-dir logic.
  Identify the injectable git-exec seam used in the sync tests so the O(1)-network assertion can count
  calls.
- **Publish/pending detection.** Confirm where `.squad/.last-publish` is written and read, how
  `sync --dry-run` computes "pending" (mtime vs `.last-publish`, or SHA-based), and how
  `publish-metadata.json` / `publish-history.json` participate. For C/I, decide whether to stamp
  `.last-publish` at hydrate (I1) or record a SHA baseline (I2), and confirm the change is scoped to the
  cold-start path (do not weaken pending detection for normal edits).
- **Doctor.** In `packages/squad-cli/src/commands/doctor.ts` confirm the host-repo diagnostics block
  (`cwdCloneMatches`, `hostSquadDir`, `hostRepoRoot`), `_hostHasFoldPipeline` (~line 436) and the
  `State folding is silently disabled` finding (~259), the `.squad/ directory` finding (~99/251), and
  the coordinator-agent finding (~268). For D, add managed/checkout-free detection and a remote
  default-branch pipeline probe (`git ls-tree <remote>/HEAD -- .github/workflows` / `.azuredevops`). For
  E, detect product-clone context (cwd ∈ registry `clones[]`, entry orphan-backed or `managed: true`,
  team root outside cwd) and suppress the local `.squad`/agent/gitignore checks and their remedies.
  Confirm the existing doctor tests in `packages/squad-cli/src/commands/__tests__/doctor.test.ts`
  (`C01` fold-pipeline) so you extend rather than break them.
- **Fold templates.** Confirm the fold templates exist byte-identical at
  `packages/squad-cli/templates/fold/{github,ado}/fold-squad-state.yml`,
  `packages/squad-sdk/templates/fold/{github,ado}/fold-squad-state.yml`, and
  `templates/fold/{github,ado}/fold-squad-state.yml`; confirm the skip guard (`grep -qxF` against
  `FOLDED_REFS` from `publish-history.json`), the fold loop, and the best-effort delete block
  (`git push origin --delete … || echo WARNING`). For F, add the recorded-but-present re-delete so all
  copies stay byte-identical; find the template-sync governance test that enforces that identity.

## Triage

Resolve the three Tier-2 decisions first and record each choice + rationale in the piece triage file:
- **G — managed-clone fetch/hydrate shape.** Recommended G1 (bulk `git fetch` of each orphan ref tip
  without the blob filter, then the existing local write-out loop). Justify vs G2 (`git archive`) and
  G3 (drop `--filter=blob:none`).
- **H — cwd-bind policy.** Recommended H1 (auto-bind cwd when it is a git work tree distinct from the
  managed host, with a `--no-bind` opt-out). Justify vs H2 (explicit follow-up only).
- **I — publish-baseline strategy.** Recommended I1 (stamp `.last-publish` at hydrate). Justify vs I2
  (SHA-based baseline).

## Workflow for piece 56

1. Create the worktree + branch off `c949cca3`. Read all inputs via `git show`.
2. Record the G/H/I decisions in the triage file.
3. Implement A–F test-first. Each sub-proposal lands with its own failing-then-green tests; keep the
   build green between sub-proposals.
4. B and F each need a mechanical assertion (network-call count independent of file count; orphan-ref
   re-delete) — do not accept "looks right"; assert it.
5. Run the full test suite, the scrub gate, and the template-sync governance test. Add `patch`
   changesets for `@bradygaster/squad-cli` (and `@bradygaster/squad-sdk` if the managed-hosts helper or
   a shared resolver changed).
6. Do NOT open PRs. Leave the branch ready for Phase C.

## Implementation notes

### Gotchas (established by prior pieces and the pilot)

- The managed clone is `--no-checkout`: never assume a working tree on `main`. All host validation of
  team-root/pipeline content must go through orphan refs or the remote default-branch tree, not the
  local checkout (D).
- Reuse the shared `hydrateTeamRootFromRef` — do not fork a second hydrate for managed clones (keeps
  `--pull` and cold-start on one code path). B's bulk fetch is a pre-step to that shared function, not a
  replacement (unless G2/G3 is chosen, in which case gate it to the managed path only).
- Product clones on a shared monorepo origin legitimately collide on origin with sibling
  squads; A's auto-bind must respect `--allow-origin-collision` and decision I's suppression, and must
  not hard-fail the one-command flow on a benign collision.
- All fold template copies must stay byte-identical or the governance sync test fails; make the F edit
  once and propagate it identically to all three roots and both platforms.
- The `.last-hydrate-sha` fast-path skip must survive B: a second cold-start / `--pull` with an
  unchanged tip must still be a no-op and must not re-issue the bulk fetch.

### Sub-proposal A — cold-start binds the invoking product clone

Read `ctx.cwd` in `_managedColdStart`. After the managed entry is written and auto-wired, resolve
cwd's git root (`git -C cwd rev-parse --show-toplevel`); if it succeeds and differs from
`managedProjectDir`, invoke the warm-bind path against the new entry: append the git root to `clones[]`,
run origin-collision detection (respect `--allow-origin-collision` and decision I), install the
cross-repo + product-squad-forbid hooks. Guard with `--no-bind` per H1. Non-repo cwd → host-only.

### Sub-proposal B — bulk managed hydrate

Per G1: before the write-out loop, run one `git fetch` per lane ref tip *without* `--filter=blob:none`
(e.g. `git -C <clone> fetch --no-filter origin <branch>` or fetch the specific ref so all reachable
blobs land in one pack), then let the existing `cat-file blob` loop read local objects. Assert via the
git-exec seam that network-touching calls are O(1) per lane, not O(files).

### Sub-proposal C — honest post-hydrate publish baseline

Per I1: after a successful cold-start hydrate, write `.squad/.last-publish` to the hydrate timestamp so
`sync --dry-run` sees no file newer than the last publish. Assert 0 pending immediately after
cold-start and exactly-one pending after a single real edit.

### Sub-proposal D — doctor checks the remote for a checkout-free host

Teach `_hostHasFoldPipeline` (and the surrounding host-repo block) to detect `managed: true` /
no-checkout hosts and validate against the remote default-branch tree
(`git ls-tree <remote>/HEAD -- .github/workflows .azuredevops`), passing when a non-empty
`fold-squad-state*.yml` is present. Extend `doctor.test.ts` C01 with a managed-host case.

### Sub-proposal E — doctor suppresses product-clone local false positives

Detect product-clone context and skip the cwd-local `.squad`/coordinator-agent/gitignore checks (or
re-point them at the host). Never emit a remedy that writes squad rules into cwd. Add a test: doctor run
from a bound product clone of a managed/orphan host → zero errors, zero false warnings.

### Sub-proposal F — idempotent fold inbox-ref garbage-collection

In every fold template, after (or before) the fold loop, also delete any remote
`squad/inbox/<callsign>/*` ref already present in `publish-history.json.foldedRefs` (a
recorded-but-present ref = a failed prior delete). Keep deletes best-effort within a run but retried
across runs. Propagate the identical edit to all three template roots × both platforms. Add a harness
test: a recorded-but-present ref is deleted next run; an un-folded ref is never deleted.

### Sub-proposal G / H / I — decisions

Record in the triage file before implementing. Recommended: G1, H1, I1. A/B/C are written against the
recommended options but must satisfy the same acceptance under the alternates.
