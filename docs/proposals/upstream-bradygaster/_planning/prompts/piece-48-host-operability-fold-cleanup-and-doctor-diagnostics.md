@Lead and Team, this is the Phase B replay session for piece 48 of the upstream stack.
Phase A staged the piece 48 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 48 this session. No PR creation in Phase B. Piece 48 continues the stack
past piece 47 from a fresh dogfooding pass that exercised the shared-host operator path
(install the fold pipeline, run the fold loop, diagnose a host with `squad doctor`). It closes
five operability gaps: install ergonomics, fold inbox-branch cleanup hygiene, and two `doctor`
diagnostics. None is a transport-correctness defect — the fold loop folds correctly once
configured; these are setup, lifecycle, and diagnostics gaps.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-48-host-operability-fold-cleanup-and-doctor-diagnostics`
  off `squad/piece-47-monorepo-gitdir-and-sync-registry-robustness` (tip 736289a6)
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve
  that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of
  the clone.

Read these inputs in order before any work (use `git show` from the spec branch —
do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/41-fold-pipeline-repo-root-and-generic-discovery.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/47-monorepo-gitdir-and-sync-registry-robustness.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/48-host-operability-fold-cleanup-and-doctor-diagnostics.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `48-host-operability-fold-cleanup-and-doctor-diagnostics.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context. The backlog's "Operational
follow-ups" are host administrative actions, NOT stack pieces — ignore them as
implementation scope.

Piece 48 delivers six Tier-1 sub-proposals and one Tier-2 decision. A, C, and D are
self-contained CLI/SDK changes; B spans the fold-pipeline templates (all four copies) plus an
install flag; F adds an opt-in service-connection identity parameter to the ADO fold template
plus install wiring and setup docs, defaulting to today's behavior; G is a self-contained
`squad assign` ergonomics fix (de-overload the warm-path `--callsign` disambiguation). A, B, C, D,
F, G are Tier 1 (implement). E is a Tier-2 decision (destination-directory creation in
`install-fold-pipeline`) — triage it first and either implement E1 (registry-gated auto-create;
**recommended**) or E2 (`--create-dirs` opt-in) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-47 base; do not assume signatures or line numbers.

- `installFoldPipeline` in `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts`.
  Confirm `InstallFoldPipelineOptions` declares `force?: boolean` (it is currently unread), the
  three-way conflict gate (`absent` / `present+match` / `present+differ`) where `present+differ`
  calls `process.exit(1)`, the destination-directory fail-fast (`if (!fs.existsSync(targetDir))`),
  and the callsign-scoped vs generic filename logic (`fold-squad-state.<callsign>.yml` vs
  `fold-squad-state.yml`).
- The fold templates `packages/squad-cli/templates/fold/{ado,github}/fold-squad-state.yml` and
  their mirrors `packages/squad-sdk/templates/fold/{ado,github}/fold-squad-state.yml`. Confirm:
  (a) the `DELETE_FOLDED_REFS` gate exists and defaults to `false` (ADO via a `variables` entry +
  `$(DELETE_FOLDED_REFS)` macro; GitHub via `${DELETE_FOLDED_REFS:-false}`); (b) the delete loop
  reads `$SORTED_REFS` (the full discovered set), while the successfully-folded set is tracked
  separately in `$FOLDED_ENTRIES`; (c) the four copies are currently byte-identical across the
  two packages. This is the correctness defect: a ref whose fold commit failed (the `else` branch
  that warns and `git reset --hard`s) is still in `$SORTED_REFS` and would be deleted unfolded.
- `runDoctor` in `packages/squad-cli/src/commands/doctor.ts`. Confirm it checks local `.squad/`
  presence, loads/validates the registry (already threads `--registry-path` via
  `resolveRegistryFilePath`), reports clone-match / origin-overlap health, and calls
  `diagnoseCopilotPayload` for orphan findings — but performs NO inspection of the resolved host
  repo (`path.dirname(entry.path)`) when the current directory is a registered clone whose host
  is elsewhere.
- `diagnoseCopilotPayload` and `_extractCandidateCallsign` in
  `packages/squad-sdk/src/copilot-payload.ts`. Confirm the `owned` check is
  `entry.name.startsWith(\`squad-${cs}-\`)` (so `squad-<cs>-squad-…` is treated as owned) and that
  `_extractCandidateCallsign` uses `withoutPrefix.lastIndexOf('-')` (so
  `squad-probe-agent-collaboration` → `probe-agent`, not `probe`).

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-48-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Wire `install-fold-pipeline --force` to overwrite a `present+differ` pipeline file (with a `.bak` backup); no change to `absent` / `present+match` / no-`--force` behavior; surface `--force` in help | Tier 1 | Accept |
| B — Fix the fold cleanup to delete only successfully-folded refs (`$FOLDED_ENTRIES`, never `$SORTED_REFS`) in both ADO + GitHub variants and their mirrors; add `install-fold-pipeline --delete-folded-refs` to set `DELETE_FOLDED_REFS` default to `true` at install (default stays off) | Tier 1 | Accept |
| C — `squad doctor` host-repo diagnostics: when cwd resolves to a registered clone whose host is elsewhere, warn on missing host `.squad/`, missing/empty host fold-pipeline YAML, and missing in-repo `squad.agent.md` | Tier 1 | Accept |
| D — Accurate orphan-payload callsign attribution: resolve the callsign against known source payload names (not a last-hyphen split) so `probe`, not `probe-agent`; flag doubly-prefixed `squad-<cs>-squad-…` payloads as orphans | Tier 1 | Accept |
| E — `install-fold-pipeline` destination-dir creation: E1 registry-gated auto-create (**recommended**) vs E2 `--create-dirs` opt-in | Tier 2 | Decide — record E1 or E2 with rationale |
| F — Make the fold pipeline's state-branch write-back identity explicit/compliant: add an opt-in `install-fold-pipeline --fold-service-connection <name>` that renders the ADO template to push under an ADO service connection (managed-identity/SP, `aka.ms/azdosc`) instead of relying on a manually-granted build-service Contribute; default rendering byte-identical to today; document the minimum-permission path and the compliant alternative in setup docs | Tier 1 | Accept |
| G — De-overload `squad assign` warm-path origin-collision disambiguation: a warm-path `squad assign <callsign>` whose remotes also match ≥2 other squads' origins assigns to the named callsign without requiring a redundant `--callsign <sameValue>`; add a purpose-named `--allow-origin-collision` opt-in for the genuine multi-match case; make `ERR_ASSIGN_ORIGIN_AMBIGUITY` name the colliding squads, the target, and the remediation; cold-start (URL) `--callsign` semantics unchanged | Tier 1 | Accept |

Record the triage outcome in `.squad/decisions/inbox/piece-48-triage.md` before writing any
product code.

---

## Workflow for piece 48

**a.** Create the implementation branch off piece 47 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-48-host-operability-fold-cleanup-and-doctor-diagnostics <worktree-path> squad/piece-47-monorepo-gitdir-and-sync-registry-robustness
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-48-triage.md`
before the first product file is modified.

**c.** Implement TDD: write failing tests first, then implementation, red-to-green. A is the
install force-mode branch; B is the template correctness fix plus the install flag (edit the
canonical template and re-sync mirrors — keep all four copies byte-identical); C and D are the
two doctor enhancements (share `runDoctor`'s host/registry resolution); F is the ADO template
identity parameter plus install wiring and setup docs (defaults byte-identical to today); G is the
`squad assign` warm-path disambiguation fix (de-overload `--callsign`, add `--allow-origin-collision`,
actionable error); E is the decided behavior. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
contribute **no new** hits (compare against the piece-47 base — the count must not grow). The
stack's package scope is `@bradygaster/squad-*`; keep it as-is — do not introduce any internal
release scope into clean files.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli` (and `patch` for `@bradygaster/squad-sdk` if you
modified its `copilot-payload.ts` source for D). Summary: "Add `install-fold-pipeline --force`,
`--delete-folded-refs`, and `--fold-service-connection`; fix the fold pipeline to delete only
successfully-folded inbox refs; add `squad doctor` host-repo diagnostics (missing host `.squad/`,
missing fold YAML, missing in-repo agent) and accurate orphan-payload callsign attribution; add a
compliant opt-in service-connection identity for the fold state-branch push; de-overload
`squad assign` warm-path origin-collision disambiguation (no redundant `--callsign`, new
`--allow-origin-collision`, actionable ambiguity error)."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A/B/C/D/F/G and the E1/E2 outcome), triage outcome, scrub
gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-48-host-operability-fold-cleanup-and-doctor-diagnostics
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 48 complete.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under
  `packages/squad-cli/node_modules` and shadows the workspace source, remove it so the
  workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is
  `tsc --noEmit` (no churn).
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
  worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is
  infra flakiness — the "Tests N passed" line is the signal).
- Revert any incidental `package.json` / `package-lock.json` / build-stamp churn (the prebuild
  stamps a version into `package.json` x3 and `.github/agents/squad.agent.md`, and runs
  `sync-templates`) before committing. NOTE: for B you DO intend to change the fold templates —
  edit the canonical source and run the template-sync so all four copies stay byte-identical;
  only revert *incidental* unrelated churn.
- Known pre-existing failures on this stack (piece-38 sync/publish J6/J7/M2/O6/N2/PM1/PM2 and
  assign P34.A1/A3) — confirm they remain unchanged; do not attribute them to piece 48.
  Classify every regression-sweep failure as pre-existing-on-base vs. caused-by-this-piece
  (run the same file on the piece-47 base worktree to confirm).

### Sub-proposal A — `install-fold-pipeline --force`

Thread the already-declared `force` option into the `present+differ` branch only. When `force`
is set: read the existing content, write it to `<destPath>.bak`, then write the rendered template
to `destPath` and log the overwrite. When `force` is unset: the existing `process.exit(1)`
conflict guard is unchanged. Parse `--force` in the CLI entry's `install-fold-pipeline` handler
and add it to that command's `--help`. Tests live alongside the existing install-fold-pipeline
tests; cover all four force-mode branches.

### Sub-proposal B — fold cleanup correctness + install flag

Two parts:

1. **Template correctness.** In all four fold templates, drive the delete loop from the
   successfully-folded set, not `$SORTED_REFS`. The folded refs are already tracked in
   `$FOLDED_ENTRIES` (a JSON array of `{ref, sha, …}` objects); derive the ref list from it (e.g.
   `echo "$FOLDED_ENTRIES" | jq -r '.[].ref'`) and iterate that. A ref whose fold commit failed
   (the `else` branch that warns and `git reset --hard`s, so it never gets an entry) must not be
   deleted. Keep the deletion best-effort (warn-and-continue) and after the state push. Apply to
   the ADO and GitHub variants identically; edit the canonical copy and re-sync mirrors so the
   `squad-cli` and `squad-sdk` copies stay byte-identical.
2. **Install flag.** Add `--delete-folded-refs` to `install-fold-pipeline`. When set, the rendered
   pipeline's `DELETE_FOLDED_REFS` default is `true` (ADO `variables` value and/or the GitHub
   default expression); when unset, it renders `false`. This is a render-time substitution
   alongside the existing callsign parameterization — keep the substitution minimal and anchored
   so it does not disturb unrelated template text. Default behavior (no flag) keeps cleanup off.

Tests: template-content assertions (delete loop reads the folded set in both variants; the four
copies are byte-identical; `--delete-folded-refs` flips the default to `true` and the plain
install renders `false`).

### Sub-proposal C — doctor host-repo diagnostics

In `runDoctor`, after the existing clone-match resolution, when a registry entry matches the
current directory as a clone AND the resolved host (`path.dirname(entry.path)`) differs from the
current directory, inspect the host working tree (best-effort; never throw) and push `warn`
findings for: missing host `.squad/`; missing/empty fold-pipeline YAML (neither
`.azuredevops/fold-squad-state*.yml` nor `.github/workflows/fold-squad-state*.yml` present/
non-empty) with remediation naming `install-fold-pipeline`; missing in-repo `squad.agent.md`.
Reuse the existing severity `escalate('warn')` helper. Do not duplicate the existing local
`.squad/` finding or the `.gitattributes` / `.gitignore` upgrade checks. These checks must not
fire for a single-repo / local-only squad.

Tests: a fixture host with no fold YAML → the missing-fold-YAML finding; host missing `.squad/`
→ that finding; host missing `squad.agent.md` → that finding; a fully-configured host → none of
the three; a local-only squad → none of the three.

### Sub-proposal D — orphan callsign attribution

Replace the last-hyphen split in `_extractCandidateCallsign` with a resolution that prefers the
**longest known registered callsign** that prefixes `<name>` after the `squad-` prefix (the
known callsigns are already passed into `diagnoseCopilotPayload` as `knownCallsigns`); when no
registered callsign matches (the orphan's owning squad is unregistered, which is the whole point
of the finding), fall back to matching the trailing segment against the known source skill/agent
base names if available, else the existing heuristic — but never emit a callsign that includes a
known skill-name fragment. Additionally, in the `owned` check, treat a directory of the form
`squad-<knownCallsign>-squad-…` as an orphan (re-namespaced stale payload), not as owned, so the
double-prefix accumulation is surfaced. Keep a correctly-namespaced registered payload a
non-orphan (no false positives). If you modify `copilot-payload.ts` source, add the
`@bradygaster/squad-sdk` changeset.

Tests (in the copilot-payload test suite): `squad-probe-agent-collaboration` with `probe`
unregistered → orphan attributed to `probe`; `squad-teamx-squad-conventions` with
`teamx` registered → orphan (double-prefix), not owned; `squad-teamx-agent-collaboration`
with `teamx` registered → not an orphan; the remediation text names the corrected callsign.

### Sub-proposal E — destination-dir creation (decision)

Default recommendation E1: in `installFoldPipeline`, when the platform directory is absent,
create it **only** when `hostRepoRoot` was resolved from a matching registry `entry` (not the
config-fallback path and not an unconfirmed `git rev-parse`); otherwise keep today's fail-fast.
This confines auto-create to a registry-confirmed host. If E2 is chosen instead, add a
`--create-dirs` flag and create the directory only when it is passed; without it, fail-fast is
unchanged. Record the decision and rationale in the triage file.

Test (E1): a registry-confirmed host with no `.azuredevops/` installs successfully (directory
created); an unconfirmed/fallback host with no directory still fails fast. (E2): `--create-dirs`
creates the directory; absent the flag, fail-fast is unchanged.

### Sub-proposal F — compliant fold state-branch write-back identity

The ADO fold template (`packages/squad-cli/templates/fold/ado/fold-squad-state.yml` and the
`squad-sdk` mirror) checks out `self` with `persistCredentials: true` and pushes the folded state
to `squad/state/<callsign>` under `System.AccessToken`, which only works after a manual Project
Build Service **Contribute** grant on the state branch — the over-privileged build-service-account
pattern flagged by the "Securing Azure DevOps Build Service Accounts" control.

Implement F as an **opt-in, default-preserving** change:

1. **Template parameter.** Add an optional service-connection input to the ADO template (e.g. a
   pipeline `parameter`/variable consumed by the checkout and the push step). When unset, the
   rendered YAML is **byte-identical to today** (`System.AccessToken` path). When set, the checkout
   and `git push origin HEAD:refs/heads/${STATE_BRANCH}` run under the service connection
   (managed-identity / service-principal backed). Keep the four template copies byte-identical for
   the default rendering.
2. **Install wiring.** Add `--fold-service-connection <name>` to `install-fold-pipeline`. When
   passed, render the template with the service-connection identity; absent the flag, the rendered
   output is unchanged from today.
3. **Docs.** In the fold-pipeline install / shared-host setup docs, document (a) the minimum write
   permission the default `System.AccessToken` path needs on the state branch and that granting the
   shared build service account Contribute is flagged as over-privileged, and (b) the compliant
   alternative — an ADO service connection backed by a managed identity / service principal
   (`aka.ms/azdosc`) scoped to the state branch — and how to wire it via the install flag. Use the
   `dev.azure.com/contoso/MyProject` placeholder; do **not** reference any internal portal URL.

Test (F): default install (no flag) renders the ADO template byte-identical to current output;
`--fold-service-connection <name>` renders checkout/push under the named service connection with no
build-service-Contribute reliance; setup docs contain both the minimum-permission note and the
`aka.ms/azdosc` guidance with the generic placeholder; the four template copies stay byte-identical
for the default rendering. The GitHub template default rendering is unchanged.

### Sub-proposal G — de-overload `squad assign` origin-collision disambiguation

The relevant code is `packages/squad-cli/src/commands/assign.ts` (Guard 8, the origin-collision
check in the warm path) and `assign-args.ts` (the `--callsign` flag parse). Confirm the live shapes
before changing them:
- The warm-path positional callsign flows `callsignOrUrl` → `rawArg` → `_warmPath`'s `callsign`.
- Guard 8 builds `originMatchingEntries` by filtering `existingSquads` where `e.callsign !== callsign`
  (target already excluded) **and** `opts.callsign && e.callsign !== opts.callsign` (the overloaded
  warm-path use of the flag). `>= 2` throws `ERR_ASSIGN_ORIGIN_AMBIGUITY`; `=== 1` warns and proceeds.
- The cold-start path (`_coldStart`) uses `opts.callsign` legitimately as `opts.callsign ??
  _deriveCallsignFromUrl(url)` to name the registration callsign. **Do not change that.**

Implement:
1. **Remove the redundant `--callsign` requirement in the warm path.** The warm-path positional
   callsign is the disambiguation target; Guard 8 should not require `--callsign <sameValue>` to
   proceed when remotes also match other squads' origins. Drop the `opts.callsign`-based filter line
   from the warm-path guard (keep the `e.callsign === callsign` self-exclusion).
2. **Add `--allow-origin-collision`** to `AssignCliArgs` / `parseAssignArgs` (boolean, like `--yes`).
   When set, the warm path records the assignment even in the genuine ≥2-match case instead of
   throwing. Without it, an unresolved genuine multi-match still fails closed.
3. **Make the error actionable.** Reword `ERR_ASSIGN_ORIGIN_AMBIGUITY` to name the colliding squads
   (already available as `names`), restate the target callsign, and direct the operator to
   `--allow-origin-collision` (or to remove the overlapping remote). Keep the error code stable.
4. **Decide the default-flow semantics deliberately:** with the redundant filter gone, define when
   the guard still throws. Recommended: the positional target is always assignable; the guard throws
   only when there is **no** positional target to anchor disambiguation (cannot occur on the warm
   path, which always has one) — i.e. in practice the warm path proceeds and surfaces the
   `=== 1`-style warning for any overlap, while `--allow-origin-collision` silences it. Record the
   exact chosen semantics in the triage file so the test matrix matches.

Test (G): (a) warm-path assign to `teamx` whose remotes also match two other squads' origins
(`alpha`, `beta`) succeeds without `--callsign teamx`; (b) where the guard still applies, the thrown
`ERR_ASSIGN_ORIGIN_AMBIGUITY` message names `alpha`, `beta`, the target `teamx`, and
`--allow-origin-collision`; (c) `--allow-origin-collision` records the assignment in the multi-match
case; (d) the cold-start URL path still honors `--callsign` to name the registration callsign,
unchanged. Use only generic placeholder callsigns (`teamx`, `alpha`, `beta`) in tests and docs.
