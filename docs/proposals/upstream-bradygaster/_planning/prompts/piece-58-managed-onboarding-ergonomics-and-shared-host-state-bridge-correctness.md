@Lead and Team, this is the Phase B replay session for piece 58 of the upstream stack.
Phase A staged the piece 58 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs.

You implement piece 58 this session. No PR creation in Phase B. Piece 58 is the **managed-onboarding
ergonomics + shared-host state-bridge correctness** piece. Pieces 40–57 made a shared squad producible,
deployable, cold-startable, and discoverable from a managed consumer clone. Live dogfooding after piece
57 surfaced five follow-on defects rooted in the **two-clone managed topology** (team root + skills +
config + runtime state in the host clone `~/.squad/hosts/<callsign>/.squad`; agents + Copilot in a
**headless** product clone with no `.squad` and — per owner ruling — no repo-local `.mcp.json`). Piece 58
closes them: register the `squad_state` bridge at the **user** level for orphan/two-layer (retiring the
repo-local `.mcp.json` that piece 57 §D wrote — that is not sanctioned for a shared-host orphan config),
reduce `squad assign` to `--callsign` via derived/defaulted/system-wide values, restore the unconditional
`agent_type` + plugin-agent prohibition to the always-loaded coordinator body, case-fold
`normalizeRemoteUrl`, and anchor `resolveSquadState` at the team `.squad/` for managed consumers.

## ⚠️ Base — this piece STACKS ON piece 57 (v0.11 line)

Piece 58 bases on the **piece-57 tip**, not directly on the 0.11 integration base, because §A amends
piece 57 §D and §E folds a fix that lives on top of 57:

- Base branch: **`squad/piece-57-managed-consumer-discovery-and-state-mcp-wiring`** (tip `30f83be4`),
  which itself bases on `akubly/upstream-npm-release-0.11` (`664e9db4`, version `0.11.0-mc.preview.1`).
- Branch to create: **`squad/piece-58-managed-onboarding-ergonomics-and-shared-host-state-bridge-correctness`**
  off the piece-57 tip, in an **isolated worktree** (suggested path `D:\git\squad-p58-wt`).
- **Scope is already `@wifi-aware/squad-*`.** Do NOT reintroduce `@bradygaster` into touched files.
  Confirm the scrub-gate hit count does not grow vs the `30f83be4` base.

### ⚠️ Pre-flight: the piece-57 worktree has an uncommitted §E reference diff

`D:\git\squad-p57-wt` currently has an **uncommitted** `packages/squad-sdk/src/resolution.ts` change — the
`resolveSquadState` dual-root fix. It is NOT on any committed branch. §E folds it into piece 58 **with a
regression test it currently lacks**. Before you branch:
1. Confirm the piece-57 tip `30f83be4` is what you base on (the uncommitted diff is your §E **reference**,
   not your base — diff against it, re-implement cleanly on your branch).
2. Do not depend on that working-tree change being present in your fresh worktree; it will not be.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into
your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/55-managed-consumer-clone-and-one-command-cold-start.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56-managed-cold-start-hardening-and-fold-ref-garbage-collection.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56a-bulk-hydrate-promisor-gate-regression.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/57-managed-consumer-discovery-and-state-mcp-wiring.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/58-managed-onboarding-ergonomics-and-shared-host-state-bridge-correctness.md
```

If `58-managed-onboarding-ergonomics-and-shared-host-state-bridge-correctness.md` does not exist on
`akubly/upstream-specs`, STOP immediately and ask for the spec to be staged before proceeding.

The spec's "Root causes (five defects)" table and "Fork / upstream boundary" section are the authoritative
framing. Piece 58 delivers five Tier-1 sub-proposals (§A–§E) and four Tier-2 decisions (G/H/I/J) — triage
G/H/I/J first and record rationale.

---

## Verify-first (before writing any change — confirm the actual 0.11/piece-57 code shape)

Do not assume signatures or line numbers; confirm on the `30f83be4` base:

- **§A — user-level state-MCP registration.**
  `packages/squad-cli/src/cli/core/mcp-root.ts` — `ensureSquadStateMcpInUserConfig(dest, spec)` (confirm
  signature, the per-project hashed key `squad_state_<shortHash>`, and that it is currently **uncalled**
  — dead code). `packages/squad-cli/src/cli/core/mcp-spec.ts` — `localSquadStateMcpSpec()` (=
  `{command:"squad", args:["state-mcp"], source:"local-bin"}`) and `resolveSquadStateMcpSpec()` (confirm
  it emits the unpublished 2-tier `npx @insider` spec today). `packages/squad-sdk/src/copilot-payload.ts`
  — the `installCopilotPayload` MCP block: confirm **Bug A** (it reads host MCP from
  `hostDir/.copilot/mcp-config.json`, which the managed host does not have — the host keeps `.mcp.json` at
  its repo root) and confirm how it selects the copilot home / user mcp-config path. Confirm the backend
  is known at this point so §A can branch `orphan`/`two-layer` (user-level) vs `local` (repo-local per
  decision G1). Confirm piece 57 §D's repo-local writer (`ensureSquadStateMcpInRoot`) so you can gate it
  off for orphan/two-layer.
- **§B — assign ergonomics.** `packages/squad-cli/src/commands/assign.ts` — the managed cold-start path,
  the `hasStateIdentity = !!stateRemote && !!stateBranch` gate, `_findWarmEntry` (do NOT regress the
  warm-entry guard), the registry write (`clones[]`, `managed:true`, `stateRemote/Branch`,
  `configRemote/Branch`, `inboxHandle`), and the `--allow-origin-collision` path.
  `packages/squad-cli/src/commands/assign-args.ts` — the `NAMED_FLAGS` list. `sync.ts` —
  `deriveStateBranch`, `deriveConfigBranch`, `resolveStateRemote` (already imported into `assign.ts`).
  The registry schema + validator in `squad-sdk` — where a `defaults` block (`registry.defaults.stateRemote`)
  would live and how the validator must tolerate it. Confirm `INBOX_HANDLE_RE`.
- **§C — coordinator agent md.** `packages/squad-cli/templates/squad.agent.md.template` — the
  always-loaded dispatch-invariant block (the current `agent_type: "general-purpose"` mention), the
  on-demand `spawn-reference.md` pointer, and the mirror-copy set the template-sync re-renders (edit
  canonical, re-sync byte-identically).
- **§D — normalizeRemoteUrl.** `packages/squad-sdk/src/resolution.ts` (or `resolution-v2.ts`) —
  `normalizeRemoteUrl` and its ADO/GitHub canonicalization branches; the resolver test file covering it.
- **§E — resolveSquadState dual-root.** `packages/squad-sdk/src/resolution.ts` — `resolveSquadState`,
  `resolveSquadPaths`, `resolveStateBackend`, `ResolvedSquadPaths.teamDir`, `paths.mode`. Diff against the
  uncommitted reference in `D:\git\squad-p57-wt`.

---

## Triage

Before any code, triage and record decisions in `.squad/decisions/inbox/piece-58-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Register `squad_state` at the user level (local-bin) for orphan/two-layer; fix copilot-payload Bug A/B; skip repo-local `.mcp.json` for those backends. | Tier 1 | Accept |
| B — Reduce `squad assign` to `--callsign`: derive state/config branches, default skills-from=host, default inbox-handle (env→git), system-wide state-remote; relax the identity gate; auto-detect+prompt on origin collision. | Tier 1 | Accept |
| C — Restore the unconditional `agent_type: general-purpose|explore` invariant + explicit plugin-agent prohibition to the always-loaded coordinator body. | Tier 1 | Accept |
| D — Case-fold `normalizeRemoteUrl` (ADO + GitHub). | Tier 1 | Accept |
| E — Fold the `resolveSquadState` dual-root fix + regression test (linked-consumer orphan resolves; teamDir at host `.squad/`). | Tier 1 | Accept |
| G — State-bridge delivery surface: G1 orphan/two-layer→user-level only, `local`→repo-local may remain (**recommended**) vs G2 both everywhere. | Tier 2 | Decide (record per-backend branch) |
| H — System-wide state-remote home: **DECIDED H1** — `registry.defaults.stateRemote` in `~/.squad/registry.json` + `SQUAD_STATE_REMOTE` env (not a separate config.json). | Tier 2 | Decided (implement H1) |
| I — inbox-handle precedence: flag > `SQUAD_INBOX_HANDLE` > `git config user.name` (sanitized), fail on unsanitizable. | Tier 2 | Decide (record) |
| J — Origin-collision: interactive auto-detect+prompt; `--yes`/non-interactive still require `--allow-origin-collision`. | Tier 2 | Decide (record) |

---

## Workflow

**a.** Create the implementation branch off the piece-57 tip (dedicated worktree):

```
cd D:\git\squad-int-0110
git fetch origin
git worktree add -b squad/piece-58-managed-onboarding-ergonomics-and-shared-host-state-bridge-correctness D:\git\squad-p58-wt squad/piece-57-managed-consumer-discovery-and-state-mcp-wiring
```

**b.** Triage (above). Record decisions in `.squad/decisions/inbox/piece-58-triage.md` before the first
product file is modified.

**c.** Implement TDD, red→green. Write the failing test that reproduces each symptom from the spec's
root-cause table first, then the fix:
- **§A** — `squad-cli` (`assign` + `mcp-root` reuse of `ensureSquadStateMcpInUserConfig`) + `squad-sdk`
  (`copilot-payload` Bug A/B). Test: orphan cold-start writes a user-config `squad_state` local-bin entry
  and writes **no** repo-local `.mcp.json`; `local` cold-start still writes the repo-local one (decision
  G1). Assert idempotency + preservation of unrelated user-config servers.
- **§B** — `squad-cli` (`assign`, `assign-args`) + `squad-sdk` (registry schema `defaults` + validator).
  Test: `squad assign --callsign X` with a system-wide state-remote yields the derived registry entry;
  the full explicit form yields an identical entry (regression); unset state-remote with no default →
  clear error. inbox-handle precedence + sanitization; collision prompt vs `--yes` hard-require.
- **§C** — edit the canonical `squad.agent.md.template`, re-sync mirror copies byte-identically. Test:
  the rendered coordinator body contains the closed-set `agent_type` invariant + plugin prohibition.
- **§D** — `normalizeRemoteUrl` case-fold + regression test (ADO + GitHub mixed vs lower case).
- **§E** — fold the dual-root `resolveSquadState` fix + regression test (linked consumer with host
  `stateBackend: orphan` → `backend.name === 'orphan'`, `paths.teamDir` at host `.squad/`). Do NOT assert
  §E covers the headless (no-config.json) topology — that path is §A's guarantee.

**d.** Scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates pass; confirm your changes add **no new** hits vs the `30f83be4` base. Keep the `@wifi-aware`
scope; do NOT introduce `@bradygaster` into clean files.

**e.** Changeset (REQUIRED — `squad-cli` + `squad-sdk` both touched):

```
npx changeset add
```

`patch` for `@wifi-aware/squad-cli` and `@wifi-aware/squad-sdk`. Summary per the spec's Changeset section.

**f.** Single squashed commit with the trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (§A–§E + G/H/I/J outcomes), triage outcome, scrub-gate result,
changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-58-managed-onboarding-ergonomics-and-shared-host-state-bridge-correctness
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 58 complete.

---

## Implementation notes / gotchas (carried from prior pieces)

- Use `npm install`, not `npm ci`. Build `squad-sdk` first, then `squad-cli`. `npm run lint` is
  `tsc --noEmit`.
- If a published `@wifi-aware/squad-sdk` is nested under `packages/squad-cli/node_modules` and shadows the
  workspace source, remove it so the workspace source resolves.
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`); a trailing
  `onTaskUpdate` timeout with all tests passing is infra flakiness — the "Tests N passed" line is the
  signal.
- Classify every regression-sweep failure as pre-existing-on-base vs caused-by-this-piece by re-running
  the same file on the `30f83be4` base worktree. Known pre-existing 0.11-rebase failures must not be
  attributed to piece 58.
- Revert incidental `package.json` / `package-lock.json` / build-stamp churn before committing. For §C you
  DO intend to re-render the template mirror copies — edit the canonical source and re-sync so all copies
  stay byte-identical; revert only *incidental* churn.
- **§A command choice (decision H, piece 57):** the `@insider` npx command cannot spawn (scope unpublished
  → `npm view` E401). Register the **local-bin** `squad state-mcp` spec so the bridge works offline /
  pre-publish. `squad state-mcp` resolves the squad from the session **cwd**, so a single user-level
  registration serves every clone — do NOT write one entry per clone unless the hashed-key path already
  does so.
- **§A/§G interaction:** for `local` backend keep piece 57 §D's repo-local `.mcp.json`; for
  orphan/two-layer write only the user-level entry and skip the repo-local writer. Prove both branches.
- **§B backward-compat:** the full explicit `squad assign --callsign X --state-remote … --state-branch …
  --config-branch … --inbox-handle … --skills-from host --allow-origin-collision` form must still produce
  a byte-identical registry entry to the short form. Add a regression asserting equivalence.
- **§E scope:** the dual-root branch is gated on `paths.mode === 'remote'`. Do NOT widen it to fire in
  single-clone/local contexts — that would re-root local squads incorrectly. Test the negative
  (local/single-clone unchanged) alongside the positive.
- **Do not regress** the warm-assign path, `_findWarmEntry`, cross-repo `sync --pull`, or the
  `.last-hydrate-sha` / `.last-config-hydrate-sha` fast-path idempotency.
