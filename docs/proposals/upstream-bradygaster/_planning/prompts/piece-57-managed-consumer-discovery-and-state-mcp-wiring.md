@Lead and Team, this is the Phase B replay session for piece 57 of the upstream stack.
Phase A staged the piece 57 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs.

You implement piece 57 this session. No PR creation in Phase B. Piece 57 is the **managed-consumer
discovery capstone**. Pieces 40–56 made a shared squad producible, deployable, and cold-startable into a
CLI-managed host clone (`~/.squad/hosts/<callsign>/.squad`). What is still broken is **discovery from the
consumer side**: the managed model moved the team root, skills, and the runtime `.mcp.json` into the
host clone, but agents and Copilot run in the **product clone**. Registry-aware callers (`squad status`,
`squad sync`) resolve fine; anything that discovers by walking the filesystem from cwd — Copilot's
`.mcp.json` auto-load, and any agent that greps for `.squad/team.md` — breaks, because the v0.11
cold-start dropped the `local` filesystem anchor v0.9 relied on. Piece 57 restores that anchor, adds a
machine-readable resolver so nobody probes for `team.md`, wires the new-in-0.11 `squad_state` MCP bridge
into the consumer clone with a command that actually resolves, and adds a doctor check for the
"resolves-but-no-config-lane" stale host.

## ⚠️ Base has moved — this piece is on the v0.11 integration line

Unlike pieces 40–56 (authored on the 0.9.6-mc fork at `D:\git\squad-replay-fresh`), piece 57 **must**
base on the **v0.11 integration** branch, because §D/§F/§I wire the `squad_state` MCP bridge
(`state-mcp.ts`, `mcp-root.ts`, `resolveSquadState`) — a component that is **upstream-new in v0.11 and
absent from the 0.9.6 line** (the fork has zero state-mcp files). Implement here:

- Working directory: **`D:\git\squad-int-0110`** (worktree of the integration clone).
- Base branch: **`akubly/upstream-npm-release-0.11`** (tip `664e9db4` —
  `chore(release): rescope @bradygaster → @wifi-aware`, version `0.11.0-mc.preview.1`).
- Branch to create: **`squad/piece-57-managed-consumer-discovery-and-state-mcp-wiring`** off
  `akubly/upstream-npm-release-0.11`, in an isolated worktree.
- **Scope is already `@wifi-aware/squad-*` on this branch.** Do NOT reintroduce `@bradygaster` into
  touched files. Confirm the scrub-gate hit count does not grow vs the `664e9db4` base.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into
your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/55-managed-consumer-clone-and-one-command-cold-start.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56-managed-cold-start-hardening-and-fold-ref-garbage-collection.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56a-bulk-hydrate-promisor-gate-regression.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/57-managed-consumer-discovery-and-state-mcp-wiring.md
```

If `57-managed-consumer-discovery-and-state-mcp-wiring.md` does not exist on `akubly/upstream-specs`,
STOP immediately and ask for the spec to be staged before proceeding.

The spec's "Root cause (one cause, five symptoms)" table and "Fork / upstream boundary" section are the
authoritative framing. Piece 57 delivers six Tier-1 sub-proposals (A–F) and three Tier-2 decisions
(G/H/I) — triage G/H/I first and record rationale.

---

## Verify-first (before specifying or writing any change — confirm the actual 0.11 code shape)

Do not assume signatures or line numbers; confirm on the `664e9db4` base:

- **Resolver.** `packages/squad-sdk/src/resolution.ts` — `resolveSquadState`,
  `resolveRegistrySquad({ cwd })`, `resolveSquadPaths`, backend resolution (`local` → FSStorageProvider;
  `orphan`/git-notes → StateBackendStorageAdapter). Resolver precedence in `cli-entry.ts`
  `formatResolverReason` (`local → env → clones → origins → platform → worktree`) and that `local` wins
  when a clone `.squad/config.json.teamRoot` is present.
- **`squad link` (reuse for §A).** `packages/squad-cli/src/cli/commands/link.ts` — `runLink` writes
  `.squad/config.json` (`{version, teamRoot, projectKey}`), adds `.squad/config.json` to `.gitignore`,
  clears the resolve cache. §A must reuse this, not fork a second writer.
- **Cold-start (§A/§B/§D injection point).** `packages/squad-cli/src/commands/assign.ts` — the managed
  cold-start path, `_findWarmEntry` (do NOT regress the warm-entry guard), the §D auto-wire block, the
  registry write (`clones[]`, `managed:true`, `stateRemote/Branch`, `configRemote/Branch`,
  `inboxHandle`). Confirm there is **no** `ensureSquadStateMcpInRoot` and **no** `squad link` call there
  today (both are the gap §A/§D close).
- **MCP wiring (§D).** `packages/squad-cli/src/cli/core/mcp-root.ts` — `ensureSquadStateMcpInRoot`
  (writes `.mcp.json` to a git root) + the Copilot auto-load assumption. Confirm the only current callers
  are `init.ts` and `upgrade.ts`. `packages/squad-cli/src/cli/commands/state-mcp.ts` — the
  `squad state-mcp` command, `MCP_TOOL_ALIASES`, and the **exact command string** currently written into
  `.mcp.json` (the unpublished `npx -y @wifi-aware/squad-cli@insider state-mcp` line — §D replaces this
  with a locally-resolvable command per decision H).
- **`--json` + status (§C).** The `status` command — confirm `--json` is parsed-but-ignored (exit 0,
  human text) and where the resolved fields (`callsign, teamRoot, source, managed, stateBackend`) are
  computed so §C can serialize them. Confirm whether a `team-root`/`where` subcommand already exists.
- **Hydrate + doctor (§E).** `packages/squad-cli/src/cli/commands/sync.ts` —
  `hydrateTeamRootFromConfigRef` and the `.last-config-hydrate-sha` sentinel.
  `packages/squad-cli/src/cli/commands/doctor.ts` (and `packages/squad-cli/src/commands/doctor.ts`) — the
  managed-host checks; where to add the "config lane present" assertion (team.md + sentinel) and the heal
  call.
- **Template (§F).** `packages/squad-cli/templates/squad.agent.md.template` — the "On every session
  start" block and any current team-root discovery guidance; the mirror-copy set the template-sync
  re-renders (edit canonical, re-sync byte-identically).

---

## Triage

Before any code, triage and record decisions in `.squad/decisions/inbox/piece-57-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Cold-start auto-`link`s the cwd product clone (restore resolver source=`local`). | Tier 1 | Accept |
| B — Cold-start binds the cwd git-root into the managed entry `clones[]` (no manual registry edit). | Tier 1 | Accept |
| C — Machine-readable resolver: real `squad status --json` + `squad team-root` (alias `where`), non-zero exit when unresolved. | Tier 1 | Accept |
| D — Wire `ensureSquadStateMcpInRoot` into managed cold-start / `link`; replace the unpublished `@insider` npx command with a locally-resolvable one. | Tier 1 | Accept |
| E — Doctor detects a managed host missing the config lane (no `team.md` / no `.last-config-hydrate-sha`) → RED, and heals via config hydrate → GREEN. | Tier 1 | Accept |
| F — Coordinator template resolves the team root via §C resolver; remove the `team.md` filesystem-probe. | Tier 1 | Accept |
| G — Primary anchor: G1 do BOTH `link` + `clones[]` (**recommended**) vs G2 registry-only. | Tier 2 | Decide (record precedence rationale) |
| H — state-MCP command: H1 locally-installed `squad state-mcp` bin (offline-robust) (**recommended**) vs H2 `npx` pinned to a published version. | Tier 2 | Decide (record; H2 as B1-publish follow-up) |
| I — Fork/upstream convergence: I1 keep both bespoke + native `squad_state` short-term, converge on the bridge (**recommended**) vs I2 retire bespoke now. | Tier 2 | Decide (record deprecation intent) |

---

## Workflow

**a.** Create the implementation branch off the 0.11 base (dedicated worktree):

```
cd D:\git\squad-int-0110
git fetch origin
git worktree add -b squad/piece-57-managed-consumer-discovery-and-state-mcp-wiring <worktree-path> akubly/upstream-npm-release-0.11
```

**b.** Triage (above). Record decisions in `.squad/decisions/inbox/piece-57-triage.md` before the first
product file is modified.

**c.** Implement TDD, red→green. §A/§B/§D are `packages/squad-cli/src` (assign + mcp-root reuse) plus the
`link`/`ensureSquadStateMcpInRoot` reuse; §C is the status command + a new `team-root` subcommand; §E is
`sync.ts` (reuse `hydrateTeamRootFromConfigRef`) + `doctor.ts`; §F edits the canonical
`squad.agent.md.template` and re-syncs mirror copies byte-identically. Write the failing test that
reproduces each symptom from the spec's symptom table first.

**d.** Scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates pass; confirm your changes add **no new** hits vs the `664e9db4` base. NOTE: this branch's
scope is `@wifi-aware/squad-*` — keep it; do NOT introduce `@bradygaster` into clean files.

**e.** Changeset (REQUIRED — `squad-cli` + `squad-sdk` both touched):

```
npx changeset add
```

`patch` for `@wifi-aware/squad-cli` and `@wifi-aware/squad-sdk`. Summary per the spec's Changeset section.

**f.** Single squashed commit with the trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A–F + G/H/I outcomes), triage outcome, scrub-gate result, changeset
classification.

**g.** Push the branch:

```
git push -u origin squad/piece-57-managed-consumer-discovery-and-state-mcp-wiring
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 57 complete.

---

## Implementation notes / gotchas (carried from prior pieces)

- Use `npm install`, not `npm ci`. Build `squad-sdk` first, then `squad-cli`. `npm run lint` is
  `tsc --noEmit`.
- If a published `@wifi-aware/squad-sdk` is nested under `packages/squad-cli/node_modules` and shadows
  the workspace source, remove it so the workspace source resolves.
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`); a trailing
  `onTaskUpdate` timeout with all tests passing is infra flakiness — the "Tests N passed" line is the
  signal.
- Classify every regression-sweep failure as pre-existing-on-base vs caused-by-this-piece by re-running
  the same file on the `664e9db4` base worktree. Known pre-existing 0.11-rebase failures must not be
  attributed to piece 57.
- Revert incidental `package.json` / `package-lock.json` / build-stamp churn before committing. For §F
  you DO intend to re-render the template mirror copies — edit the canonical source and re-sync so all
  copies stay byte-identical; revert only *incidental* churn.
- **§D command choice (decision H):** the `@insider` npx command cannot spawn (scope unpublished →
  `npm view` E401). Prefer writing a command that resolves to the installed `squad` bin
  (`squad state-mcp`) so the bridge works offline / pre-publish. If you keep an npx form, it must be
  pinned to a version that actually exists on the feed — do not ship an unresolvable command.
- **§A/§C interaction:** after §A writes the clone-local `.squad/config.json`, `squad team-root` (§C)
  must report `source=local`. Assert this end-to-end so §A and §C are proven together, mirroring how the
  live `squad link` mitigation flipped the resolver back to `local` this session.
- **Do not regress** the warm-assign path, `_findWarmEntry`, cross-repo `sync --pull`, or the
  `.last-hydrate-sha` / `.last-config-hydrate-sha` fast-path idempotency.
