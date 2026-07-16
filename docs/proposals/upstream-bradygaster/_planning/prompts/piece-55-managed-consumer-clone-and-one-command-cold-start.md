@Lead and Team, this is the Phase B replay session for piece 55 of the upstream stack.
Phase A staged the piece 55 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 55 this session. No PR creation in Phase B. Piece 55 is the consumer capstone of
the Pole-A line. Pieces 50–54 made a shared squad producible and deployable: an infra-only-`main` host
keeps its team root only on orphan branches (`squad/config/<callsign>` durable,
`squad/state/<callsign>` ephemeral), a fold pipeline consumes the ephemeral inbox, and a config pipeline
auto-PRs durable changes. What is missing is the consumer half: there is no single hands-off command
that stands up a machine as a **consumer** of such a squad and keeps it fresh. Onboarding a second
workstation today is a hand-wired `registry.json` edit, then a bare `squad sync --pull` that only works
if you pass the project directory (not the `.squad` directory — an unguided footgun), then a
`squad upgrade` from that same directory. Miss a step and `squad doctor` errors — and two of those
errors are **false positives no user action can clear**. Piece 55 makes the consumer story one command,
introduces a CLI-managed host clone the user never maintains, and makes a fresh managed host pass
`squad doctor` with zero errors.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-55-managed-consumer-clone-and-one-command-cold-start`
  off `squad/piece-54-config-pipeline-install-wiring-and-publish-batching` (tip `9619896b`)
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
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/53-hands-off-durable-review-config-inbox-and-auto-pr.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/54-config-pipeline-install-wiring-and-publish-batching.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/55-managed-consumer-clone-and-one-command-cold-start.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `55-managed-consumer-clone-and-one-command-cold-start.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be staged before
this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context. The backlog's "Operational follow-ups" are host
administrative actions, NOT stack pieces — ignore them as implementation scope.

Piece 55 delivers six Tier-1 sub-proposals and three Tier-2 decisions. A is flag-driven cold-start
identity; B is the CLI-managed host clone; C is orphan-branch hydrate in cold-start; D is auto-wire
after first hydrate; E is deterministic hands-off freshness sync; F is a zero-error `doctor` on a fresh
managed host (two false-positive fixes). G (managed-clone fetch shape), H (freshness-trigger policy),
and I (origin-overlap suppression) are Tier-2 decisions — triage them first and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-54 base; do not assume signatures or line numbers.

- **`assign` arg surface and paths.** In `packages/squad-cli/src/commands/assign-args.ts` confirm the
  parsed flags: `--callsign`, `--clone-to`, `--skills-from`, `--state-remote`, `--state-branch`,
  `--inbox-handle`, `--target-dir`, and whether `--config-remote`/`--config-branch` are already parsed
  (add them if not). In `packages/squad-cli/src/commands/assign.ts` confirm `runAssign`, the cold-start
  branch (triggered today by `--clone-to`), `_coldStart`, the `ERR_ASSIGN_MISSING_ARG` /
  `ERR_ASSIGN_URL_WITHOUT_CLONE_TO` / `ERR_ASSIGN_HOST_PATH_MISSING` / `ERR_ASSIGN_NO_TEAM_MD` error
  codes, the injectable `cloneCommand` seam (`_defaultCloneCommand`), and `installCoordinatorAgent`.
  A introduces the flag-only cold-start; do not regress the bare-callsign warm path, the
  `<url> --clone-to` path, or handle-only updates.
- **Hydrate + resolution.** In `packages/squad-cli/src/cli/commands/sync.ts` confirm
  `hydrateTeamRootFromRef` (writes the team-root tree + `.last-hydrate-sha` sentinel), the piece-53
  durable config hydrate (`.last-config-hydrate-sha`), `resolveStateRemote`, `deriveStateBranch`,
  `deriveConfigBranch`, and the override/clone match blocks that key on `dirname(entry.path)` (the
  PROJECT directory, not the `.squad` directory). C reuses these helpers verbatim — cold-start must call
  the same hydrate, not a second copy.
- **Registry shape.** Confirm the registry entry type and where `path`, `callsign`, `origins`,
  `clones`, `stateRemote`, `stateBranch`, `configRemote`, `configBranch`, `inboxHandle` live, and add a
  `managed?: boolean` field. Confirm how entries are read/written (`upsertEntry`, `writeRegistry`) and
  the home-dir override seam used across the CLI/SDK for tests. B adds a managed hosts-root helper in
  `packages/squad-sdk` (`~/.squad/hosts/<callsign>/`) honoring that seam.
- **Upgrade.** In `packages/squad-cli/src/cli/core/upgrade.ts` confirm `runUpgrade(dest)`,
  `detectSquadDir(dest)`, the `No squad found — run init first` fatal, and the exact line that writes the
  repo agent: today `path.join(dest, '.github', 'agents', 'squad.agent.md')`. Confirm where workflows and
  git hooks are installed (git root vs `dest`). D calls `runUpgrade` on the managed project dir; F1
  changes the repo-agent write to the **git root** of `dest` to match where hooks/workflows already land.
- **Doctor — two checks.** In `packages/squad-cli/src/cli/commands/doctor.ts` confirm the system check
  that resolves `const base = getGitRoot(cwd) ?? cwd` and reads
  `path.join(base, '.github', 'agents', 'squad.agent.md')` (the F1 false negative). In
  `packages/squad-cli/src/commands/doctor.ts` confirm the registry checks: the origin-overlap warning
  (over `activeEntries`) and the orphan-payload block that calls `diagnoseCopilotPayload({ knownCallsigns,
  knownSkillBases: _knownSkillBases(), copilotHome })`, and that `_knownSkillBases()` is built only from
  `TEMPLATE_MANIFEST`. F2/I change these.
- **Copilot payload ownership.** In `packages/squad-sdk/src/copilot-payload.ts` confirm
  `diagnoseCopilotPayload`, `_isOwnedPayload(name, knownCallsigns, knownSkillBases)` (the
  `rest.startsWith('squad-') && !knownSkillBases.includes(rest)` double-prefix guard), and
  `_extractCandidateCallsign`. F2 makes a `squad-<registeredCallsign>-<rest>` name owned whenever
  `<registeredCallsign>` is registered, regardless of whether `<rest>` begins with `squad-`.
- **Coordinator template session-start hook.** In `packages/squad-cli/templates/squad.agent.md.template`
  confirm the "On every session start" block and the inlined Scribe git-commit block in the spawn
  prompt. E edits the canonical template (and re-syncs any mirror copies so all stay byte-identical);
  it does NOT touch `.squad/agents/scribe/charter.md`.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-55-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Flag-driven cold-start identity: `--callsign` + `--state-remote`/`--state-branch` (+ optional `--config-remote`/`--config-branch`, `--inbox-handle`, `--skills-from host`) with no positional and no `--clone-to` triggers a managed cold-start; all existing shapes preserved. | Tier 1 | Accept |
| B — CLI-managed host clone under `~/.squad/hosts/<callsign>/` (team root `…/.squad`); SDK hosts-root helper; registry `managed: true`; doctor/upgrade treat managed paths as tool-owned; one clone per callsign. | Tier 1 | Accept |
| C — Orphan-branch hydrate in cold-start: create the managed clone, write the managed entry, run the same state+config `--pull` hydrate into the managed team root (sentinels written), then verify `team.md` in the hydrated tree (not on `main`); fail fast naming the remote/branches when absent. | Tier 1 | Accept |
| D — Auto-wire after first hydrate: run `runUpgrade` against the managed project dir so the repo agent, `.copilot/skills`, gitignore/gitattributes, workflows, global coordinator, and git hooks are installed with zero follow-up. | Tier 1 | Accept |
| E — Deterministic hands-off freshness sync in the coordinator `squad.agent.md` session-start hook (managed entries only), plus optional Scribe pull-before-push; no durable charter change. | Tier 1 | Accept |
| F — Zero-error `doctor` on a fresh managed host: F1 upgrade/doctor agree on the repo agent path (write at git root); F2 a `squad-<registeredCallsign>-<rest>` payload is owned even when `<rest>` begins with `squad-`. | Tier 1 | Accept |
| G — Managed-clone fetch shape: G1 partial + single-branch (`--filter=blob:none`, ref-scoped) (**recommended**) vs G2 full clone. | Tier 2 | Decide — record G1 or G2 with rationale |
| H — Freshness-trigger policy: H1 session-start-always vs H2 sentinel-age threshold (pull when `.last-hydrate-sha` older than a bounded window) (**recommended**). | Tier 2 | Decide — record H1 or H2 (+ threshold) with rationale |
| I — Origin-overlap suppression: I1 suppress the warning between two callsign-distinguished managed entries of one host (**recommended**) vs I2 keep + document. | Tier 2 | Decide — record I1 or I2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-55-triage.md` before writing any product
code.

---

## Workflow for piece 55

**a.** Create the implementation branch off piece 54 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-55-managed-consumer-clone-and-one-command-cold-start <worktree-path> squad/piece-54-config-pipeline-install-wiring-and-publish-batching
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-55-triage.md` before the
first product file is modified.

**c.** Implement TDD: write failing tests first, then implementation, red-to-green. A/B/C/D are
`packages/squad-cli/src` + a `packages/squad-sdk` hosts-root helper; F1 is `upgrade.ts` +
`cli/commands/doctor.ts`; F2 is `packages/squad-sdk/src/copilot-payload.ts` (+ its doctor call-site);
E edits the canonical `squad.agent.md.template` and re-syncs mirror copies byte-identically. See
implementation notes.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes contribute
**no new** hits (compare against the piece-54 base — the count must not grow). The stack's package
scope is `@bradygaster/squad-*`; keep it as-is — do not introduce any internal release scope into clean
files.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` and `packages/squad-sdk/src` are both
touched):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli` and `@bradygaster/squad-sdk`. Summary: "squad assign:
one-command cold-start onboarding of a shared-squad consumer into a CLI-managed host clone
(`~/.squad/hosts/<callsign>/`) — flag-driven identity, orphan-branch hydrate, and auto-wire so the host
is usable with no follow-up; deterministic hands-off freshness sync from the coordinator session-start
hook; doctor: fix the subfolder-host repo-agent-path false negative and the custom `squad-`-prefixed
skill orphan false positive so a fresh managed host is green."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A–F and the G/H/I outcomes), triage outcome, scrub gate result,
and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-55-managed-consumer-clone-and-one-command-cold-start
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 55 complete.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under `packages/squad-cli/node_modules` and shadows
  the workspace source, remove it so the workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is `tsc --noEmit`.
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
  worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is infra
  flakiness — the "Tests N passed" line is the signal).
- Revert incidental `package.json` / `package-lock.json` / build-stamp churn before committing. For E you
  DO intend to re-render the coordinator template mirror copies via the template-sync — edit the
  canonical source and re-sync so all copies stay byte-identical; only revert *incidental* churn.
- Classify every regression-sweep failure as pre-existing-on-base vs. caused-by-this-piece (run the same
  file on the piece-54 base worktree to confirm). Known pre-existing failures on this stack must not be
  attributed to piece 55.

### Sub-proposal A — flag-driven cold-start identity

In `runAssign`, before the `ERR_ASSIGN_MISSING_ARG` guard, detect the managed cold-start: `--callsign`
present, `--state-remote` + `--state-branch` present, no positional `callsignOrUrl`, no `--clone-to`,
and no warm registry entry resolving for `<callsign>`. Route that to the new managed cold-start
(B–D). Keep `--clone-to`-triggered cold-start, bare-callsign warm assign, and handle-only update
exactly as today. `--config-remote` defaults to `--state-remote`; `--config-branch` optional;
`--skills-from` must be `host` (reuse `ERR_ASSIGN_INVALID_SKILLS_SOURCE` otherwise). Tests: the flag-only
invocation resolves to managed cold-start; `--callsign` without `--state-remote` still teaches the
correct usage; existing shapes unchanged.

### Sub-proposal B — managed host clone + registry `managed`

Add a `@bradygaster/squad-sdk` helper `managedHostsRoot(home?)` → `<home>/.squad/hosts` and
`managedHostPath(callsign, home?)` → `<home>/.squad/hosts/<callsign>`, honoring the existing home
override seam. Add `managed?: boolean` to the registry entry type. When present and true: `doctor` does
not emit `missing path` for the entry during onboarding, and `upgrade`/`sync` treat the path as a
clean-overwrite hydrate target. One clone per callsign. Tests: helper resolves under an injected home;
a managed entry round-trips through `writeRegistry`/read; `doctor` does not flag a managed path as a
user working tree.

### Sub-proposal C — orphan-branch hydrate in cold-start

Implement the managed cold-start as: (1) create the managed clone at `managedHostPath(callsign)` with
the state remote as `origin` (fetch shape per G) — reuse the injectable clone seam; (2) `upsertEntry`
the managed entry (remotes, branches, handle, `managed: true`); (3) call the **same** hydrate `sync
--pull` runs for state (`hydrateTeamRootFromRef`) and durable config, into the managed team root, writing
both sentinels. Replace the working-tree `team.md` check with a post-hydrate assertion against the
managed team root; on absence, fail fast naming the resolved remote and both branches. Do NOT fork a
second hydrate path — call the piece-53/43 helpers. Tests (git-integration, isolated): a fixture bare
remote carrying `squad/config/<cs>` + `squad/state/<cs>` orphans hydrates into `~/.squad/hosts/<cs>/.squad`
with both sentinels; an infra-only-`main` fixture (no team root on `main`) still succeeds; a remote whose
orphans lack `team.md` fails fast with the remote/branches named.

### Sub-proposal D — auto-wire after first hydrate

After the first successful managed hydrate, call `runUpgrade(managedProjectDir)` (or the shared install
steps) so `detectSquadDir` resolves the freshly hydrated `.squad`. Surface the wiring in the cold-start
result (coordinator installed, hooks installed) alongside hydrate counts. Tests: after managed
cold-start, the repo agent (at the git root per F1), `.copilot/skills`, gitignore/gitattributes,
workflows, global coordinator, and git hooks all exist; a second run is idempotent.

### Sub-proposal E — deterministic freshness sync

Edit the canonical `squad.agent.md.template` "On every session start" block: when the resolved team root
is a `managed: true` entry, run `squad sync --pull` per the H trigger (H2: only when `.last-hydrate-sha`
is older than the chosen window). Add the optional pull-before-push to the inlined Scribe commit block.
Re-sync mirror template copies byte-identically. Do NOT edit `.squad/agents/scribe/charter.md`. Tests:
template-governance/byte-identity tests over the rendered copies; assert the session-start block
references the managed pull and the durable charter is untouched.

### Sub-proposal F — zero-error doctor

F1: change `upgrade`'s repo-agent write from `path.join(dest, '.github', …)` to the **git root** of
`dest` (`getGitRoot(dest) ?? dest`), the same base `doctor` checks and where hooks/workflows already
install. Tests: install then immediately doctor-check on a root host (dest == git root) and a subfolder
host (dest != git root) — both green; assert the agent lands at the git root.
F2: in `_isOwnedPayload`, when `name` starts with `squad-<cs>-` for a registered `<cs>`, treat it as
owned regardless of whether the remainder begins with `squad-`; the double-prefix guard fires only when
the leading token is not a registered callsign. Tests: `squad-<cs>-squad-state-harvest-union` with `<cs>`
registered → owned, not an orphan; a genuinely stale double-prefixed payload with no registered leading
callsign → still flagged; `_extractCandidateCallsign` unaffected for legitimate orphans.

### Sub-proposal G — managed-clone fetch shape (decision)

If G1: clone with `--filter=blob:none` and a single-branch/ref-scoped fetch of the state (and config)
orphan refs; ensure every SHA the hydrate reads is reachable. If G2: plain `git clone`. Record the
choice; the clone seam must remain injectable for tests either way.

### Sub-proposal H — freshness-trigger policy (decision)

If H2: define the staleness window and read `.last-hydrate-sha`'s age to decide; an explicit
`squad sync --pull` always overrides. If H1: pull every session start. Record the choice (+ threshold).

### Sub-proposal I — origin-overlap suppression (decision)

If I1: in the registry origin-overlap check, skip the warning for a pair when both entries have distinct
callsigns and distinct state/config branches (resolution unambiguous by callsign); keep it for
indistinguishable entries. If I2: leave as-is and document. Record the choice. Tests: two managed
callsign-distinguished entries sharing a state-remote → no origin-overlap error under I1.
