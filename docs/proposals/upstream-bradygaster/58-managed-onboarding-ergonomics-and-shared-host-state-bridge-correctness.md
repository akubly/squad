# 58 — Managed onboarding ergonomics + shared-host state-bridge correctness

## Summary

Piece 57 delivered the managed-consumer **discovery** capstone (restore the `local` anchor, a
machine-readable resolver, a `squad_state` bridge write, a doctor heal, and a template that resolves via
the registry instead of probing for `team.md`). Live dogfooding of the v0.11 rebase after 57 surfaced
five follow-on defects that piece 57 either did not cover or covered in a way the owner has since ruled
out. Piece 58 is the **managed-onboarding ergonomics + shared-host state correctness** piece:

1. **§A** — For the shared-host / **orphan** (and two-layer) topology, the `squad_state` bridge must be
   registered at the **user** level (`~/.copilot/mcp-config.json`), **not** as a repo-local `.mcp.json`
   in the product clone. Piece 57 §D wrote a gitignored repo-local `.mcp.json`; **that is not sanctioned
   for a shared-host orphan config** (owner ruling, 2026-08-10). The correct local-bin pinner already
   exists but is **dead code**, and the bootstrap that should call it reads the host MCP from the wrong
   path and would copy an unspawnable `npx @insider` command anyway.
2. **§B** — `squad assign` is far too flag-heavy for onboarding a shared-squad consumer. Almost every
   flag can be derived from the callsign, defaulted, or made a one-time system-wide setting. Target:
   `squad assign --callsign <cs>`.
3. **§C** — Restore the **unconditional** `agent_type` invariant and an explicit **plugin-agent
   prohibition** to the always-loaded coordinator `squad.agent.md`. The v0.11 lean-index refactor moved
   the hard spawn rule into an on-demand reference; when it is not read, the coordinator dispatches
   installed **plugin** agent types (e.g. `mobcon-dev-tools:wlan-dev`) as cast members, bypassing the
   charter and the entire state/governance envelope.
4. **§D** — Fix a latent `normalizeRemoteUrl` **case asymmetry** that can make origin-only registry
   resolution miss a mixed-case clone URL.
5. **§E** — Fold the pending **`resolveSquadState` dual-root** fix (the state bridge currently roots one
   directory segment too high for a managed consumer, silently falling back to the FS provider instead of
   the host's orphan backend) into the piece with a proper regression test.

**Base / stack position.** Piece 58 stacks on the piece-57 tip
(`squad/piece-57-managed-consumer-discovery-and-state-mcp-wiring`, `30f83be4`), which itself bases on the
v0.11 integration branch (`akubly/upstream-npm-release-0.11`, `664e9db4`, version `0.11.0-mc.preview.1`).
All of §A–§E touch v0.11-line components (`state-mcp`, `mcp-root`, `copilot-payload`, `assign`,
`resolution`, the coordinator template) — this piece is on the 0.11 line, not the 0.9.6 fork.

**Scope stays `@wifi-aware/squad-*`.** Do not reintroduce `@bradygaster` into touched files; the
scrub-gate hit count must not grow vs the `30f83be4` base.

---

## Root causes (five defects, one theme: the managed shared-host topology)

The theme is the **two-clone managed topology**: the team root, skills, config, and runtime state live in
a CLI-managed **host** clone (`~/.squad/hosts/<callsign>/.squad`), while agents and the Copilot session
run in a **product** clone (e.g. `D:\git\os\wfa\src`) that is **headless** — no `.squad`, and (per owner
ruling) **no** repo-local `.mcp.json`. Each defect is a place where a v0.11 code path still assumes the
single-clone model.

| # | Symptom (observed live) | Root cause | Defect id |
|---|---|---|---|
| 1 | Copilot in the product clone: "Squad's runtime state bridge is missing for backend `orphan` … `squad_state` MCP server in `.mcp.json` is not reachable." | The bootstrap never lands a `squad_state` entry in the **user** MCP config; it reads the host MCP from `hostDir/.copilot/mcp-config.json` (which does not exist — the host keeps it at repo-root `.mcp.json`), and even if matched the command is an unpublished `npx @wifi-aware/squad-cli@insider state-mcp` (`npm view` → E401). The correct user-level local-bin pinner is **dead code**. | `orphan-state-mcp-unreachable-in-headless-clone` |
| 2 | Onboarding a shared-squad consumer requires ~7 flags (`--state-remote --state-branch --config-branch --inbox-handle --skills-from --allow-origin-collision`). | The cold-start identity gate requires explicit `--state-remote` **and** `--state-branch`; the derive helpers exist and are already imported but are not used to relax the gate, and there is no system-wide state-remote default. | `assign-flag-ergonomics-too-many-mandatory` |
| 3 | Coordinator spawns `mobcon-dev-tools:wlan-dev` / `omega-dev` / `build-engineer` as cast members. | v0.11 lean-index moved `agent_type: general-purpose (always)` + the inline-charter mandate into the **on-demand** `.squad/templates/spawn-reference.md`. The always-loaded body only mentions `general-purpose` in passing and has **no closed-set invariant and no plugin prohibition**, so the coordinator picks plugin `agent_type`s off the Task-tool enum. | `coordinator-spawns-plugin-agent-type-instead-of-general-purpose` |
| 4 | An origin-only registry entry can fail to resolve a clone whose live remote URL differs only in case. | `normalizeRemoteUrl` lowercases in one canonicalization path but preserves case in the ADO/GitHub path; host/org/repo are case-insensitive, so a canonical registry origin and a mixed-case live URL don't string-match. | `resolver-normalizeRemoteUrl-case-asymmetry` |
| 5 | The state bridge writes sibling files under the host **repo root** and silently uses the FS provider instead of the host's configured `orphan` backend. | `resolveSquadState` anchors the provider/backend/`repoRoot` at `paths.projectDir` (the consumer `.squad/`), one segment too high for a managed consumer; it must follow the same dual-root pointer as `resolveTeamRoot` and anchor at the **team** `.squad/`. | `resolvesquadstate-roots-one-segment-too-high` |

---

## Fork / upstream boundary (unchanged from piece 57, restated for §A/§E)

The `squad_state` bridge (`state-mcp.ts`, `mcp-root.ts`, `resolveSquadState`) is **upstream-new in v0.11**
(`5e35a04b`). Our replay carried its **resolver** awareness but not its **delivery** for the two-clone
managed topology. Piece 57 §D began wiring delivery via a **repo-local** `.mcp.json`
(`ensureSquadStateMcpInRoot`). Piece 58 §A **amends** that decision: for orphan/two-layer the delivery
surface is the **user** MCP config, because a repo-local `.mcp.json` in a shared-host orphan config is not
sanctioned. §E completes the resolver-correctness half (dual-root).

---

## Sub-proposals

### §A (Tier 1) — Register `squad_state` at the user level for orphan/two-layer; retire the repo-local `.mcp.json` for those backends

For a managed host whose backend is `orphan` or `two-layer`, cold-start / `assign` (and the
`installCopilotPayload` bootstrap) must register the `squad_state` bridge in the **user**
`~/.copilot/mcp-config.json` by calling the existing-but-dead
`ensureSquadStateMcpInUserConfig(cwd, localSquadStateMcpSpec())` (`mcp-root.ts` / `mcp-spec.ts`), and must
**not** write a repo-local `.mcp.json` into the product clone for those backends. The spec must be the
**local-bin** form `{ command: "squad", args: ["state-mcp"], source: "local-bin" }`, which resolves from
the session cwd — so **one** user-level registration serves every clone (each session's cwd selects the
right squad's orphan state).

Two bootstrap bugs must be fixed as part of this:
- **Bug A (source-path mismatch):** `copilot-payload.ts` reads the host MCP from
  `hostDir/.copilot/mcp-config.json`, but the managed host stores its MCP at the host **repo root**
  (`.mcp.json`). It copies nothing. The user-level `squad_state` registration must not depend on copying
  the host file at all — synthesize the local-bin spec directly.
- **Bug B (unspawnable command):** the host `.mcp.json` command is `npx -y
  @wifi-aware/squad-cli@insider state-mcp`; the scope is unpublished (E401), so the command can never
  spawn. `resolveSquadStateMcpSpec` must prefer the local-bin spec for the unpublished managed fork
  (decision H from piece 57, now enforced at the user-config layer).

**Interaction with piece 57 §D (see decision G):** for the `local` backend, a repo-local `.mcp.json`
(piece 57 §D) may remain valid; for orphan/two-layer the repo-local writer must be **skipped** and the
user-level registration used instead.

**Acceptance:** after cold-start/assign for an **orphan**-backend managed host from a headless product
clone: (1) `~/.copilot/mcp-config.json` contains a `squad_state` local-bin entry (hashed key per
`ensureSquadStateMcpInUserConfig`); (2) **no** `.mcp.json` is written into the product clone; (3) a fresh
Copilot session in that clone loads `squad_state` with no "bridge is missing" error and
`squad_state_health` reports healthy against the **orphan** backend (not an FS fallback). A pre-existing
user config with unrelated servers is preserved; re-running is idempotent.

### §B (Tier 1) — `squad assign` onboarding ergonomics: derive, default, and make state-remote system-wide

Reduce the shared-consumer onboarding command to `squad assign --callsign <cs>`. Per flag:

| Flag | Change | Mechanism (already present unless noted) |
|---|---|---|
| `--state-branch` | **Derive** `squad/state/<callsign>` when omitted; drop from the cold-start identity gate. | `deriveStateBranch(x, callsign)` (already imported into `assign.ts`). |
| `--config-branch` | **Derive** `squad/config/<callsign>` when omitted. | `deriveConfigBranch(x, callsign)`. |
| `--skills-from` | **Stop requiring**; default is already `host`. | `_resolveSkillsSourceDir` defaults to host; only validates when the value ≠ `host`/`none`. |
| `--inbox-handle` | Default from `SQUAD_INBOX_HANDLE` (already honored) then from `git config user.name`, sanitized to `INBOX_HANDLE_RE` (reject if unsanitizable). | Extend the existing `?? process.env['SQUAD_INBOX_HANDLE']` fallback (decision I). |
| `--state-remote` | Default from a **system-wide** setting when omitted. | **New:** `registry.defaults.stateRemote` in `~/.squad/registry.json` + `SQUAD_STATE_REMOTE` env override (decision H). |
| `--allow-origin-collision` | Auto-detect the collision, name the colliding squad, and **prompt** in interactive mode; keep requiring the explicit flag under `--yes` / non-interactive (decision J). | New collision-detect + prompt path in `assign.ts`. |

The cold-start identity gate (`hasStateIdentity = !!stateRemote && !!stateBranch`) must be relaxed to:
`state-remote` resolvable (flag → env → `registry.defaults.stateRemote`) is sufficient; `state-branch`
and `config-branch` are derived from the callsign. Explicit flags always override derived/default values
(backward-compatible — the long form must still work unchanged).

**Acceptance:** with `registry.defaults.stateRemote` (or `SQUAD_STATE_REMOTE`) set once, `squad assign
--callsign mobcon` from a fresh product clone registers a managed consumer with `stateBranch =
squad/state/mobcon`, `configBranch = squad/config/mobcon`, `skillsFrom = host`, and an `inboxHandle`
derived from env/git, adding the clone to `clones[]` — with no other flags. The full explicit form still
produces an identical registry entry (regression). An unset state-remote with no default yields a clear
error naming the three ways to supply it.

### §C (Tier 1) — Restore the unconditional `agent_type` invariant + plugin-agent prohibition to the always-loaded coordinator body

Add a short, **unconditional** rule to the always-loaded coordinator body (canonical
`packages/squad-cli/templates/squad.agent.md.template`, re-synced byte-identically to its mirror copies —
the same set piece 57 §F re-renders):

> When dispatching a cast member, `agent_type` MUST be exactly `general-purpose` (or `explore` for a
> read-only cast task). NEVER pass an installed **plugin/custom** agent type (e.g. `mobcon-dev-tools:*`,
> `<plugin>:*`) as a cast member's `agent_type` — the charter is delivered **inline** in the prompt, and a
> plugin agent bypasses the charter and the state/governance envelope. (Plugins may still be installed **as
> skills / charter content** via the marketplace flow — that is unaffected; this rule governs `agent_type`
> routing only.)

This must live in the **always-loaded** body, not only in the on-demand `spawn-reference.md`, so the
guardrail holds even when resolution/hydration of the on-demand reference has not occurred. Keep the
existing on-demand reference; this is an additive, resolution-independent restatement of the invariant.

**Acceptance:** a dry read of the rendered coordinator `squad.agent.md` shows the closed-set `agent_type`
invariant **and** the explicit plugin prohibition in the always-loaded body, without reading any
on-demand reference. Mirror copies remain byte-identical to the canonical template.

### §D (Tier 1) — `normalizeRemoteUrl` case-fold

Lowercase the ADO/GitHub canonical outputs in `normalizeRemoteUrl` so a canonical registry origin matches
a mixed-case live clone URL (host/org/repo are case-insensitive). Add a regression test covering ADO
(`dev.azure.com/Org/Proj/_git/Repo` vs lowercase) and GitHub (`github.com/Owner/Repo` vs lowercase). This
is latent (it was **not** the MobconTools resolution cause, which resolved via path-exact `clones[]`), but
it is a real origin-only-registration miss.

**Acceptance:** `normalizeRemoteUrl` is case-insensitive across host/org/repo for both ADO and GitHub
forms; the regression test asserts equality of mixed- and lower-case inputs. No existing resolver test
regresses.

### §E (Tier 1) — Fold the `resolveSquadState` dual-root fix + regression test

Fold the pending `packages/squad-sdk/src/resolution.ts` change into piece 58 with a real regression test.
**Provenance / urgency:** this change is a hand-authored **local fix** made on 2026-08-04 (~18:20) during
the "bridge root off by one segment" diagnosis; it was built and **globally installed** the same minute
(installed `dist/resolution.js` mtime 18:20:30) — so the CLI currently running on this machine carries it
and it is **load-bearing** for the working orphan bridge — but it was **never committed to any branch**
(working-tree-only in `D:\git\squad-p57-wt`). It will be silently lost on the next clean `npm install` /
rebuild. §E exists to capture this untracked-but-live fix into version control and pin it with a test. In
**remote** mode (`paths.mode === 'remote'`, i.e. a
consumer with a `squad link` `config.json.teamRoot` pointer), `resolveSquadState` must anchor the state
provider, the backend read (`resolveStateBackend`), and `repoRoot` at the **team** `.squad/`
(`<teamDir>/.squad` when it exists, else `teamDir`) — not at the consumer `paths.projectDir`. Without
this, the bridge roots one segment too high: it writes sibling files under the host repo root and silently
falls back to the FS provider instead of the host's configured (e.g. `orphan`) backend.

**Interaction to test explicitly (both topologies):**
- **Linked consumer** (`mode === 'remote'`, config.json pointer present — the piece 57 §A outcome): the
  dual-root branch fires; assert `backend.name === 'orphan'` (no FS fallback) and the returned
  `paths.teamDir` is the host `.squad/`.
- **Headless clone** (no `config.json`, `mode !== 'remote'`): the dual-root branch does **not** fire; the
  state bridge is reached via the §A user-level `squad state-mcp` registration, which resolves the squad
  from cwd. The spec-level guarantee for this topology is §A's, not §E's — the regression suite must not
  assume §E covers the headless case.

**Acceptance:** a regression test builds a managed consumer with a `squad link` pointer to a host whose
`.squad/config.json` has `stateBackend: orphan`, and asserts `resolveSquadState` returns
`backend.name === 'orphan'` with `paths.teamDir` at the host `.squad/`. Existing `resolution-v2` tests
stay green.

### Tier 2 decisions (triage first, record rationale)

- **G — state-bridge delivery surface by backend.** G1 (**recommended**): orphan/two-layer →
  **user-level only** (skip the piece 57 §D repo-local `.mcp.json` writer for these backends); `local`
  backend → repo-local `.mcp.json` may remain. G2: keep both everywhere. G1 aligns with the owner ruling
  that a repo-local `.mcp.json` in a shared-host orphan config is not sanctioned. Record the per-backend
  branch.
- **H — system-wide state-remote home.** **DECIDED H1** (Aaron, 2026-08-13): the default lives in
  `~/.squad/registry.json` — the single source of squad-wide configuration — as a top-level `defaults`
  block (`registry.defaults.stateRemote`), with a `SQUAD_STATE_REMOTE` env override. **Not** a separate
  `~/.squad/config.json` (H2, rejected — no second config surface). Implementation note: all existing
  managed entries already carry an identical `stateRemote`, so the build session MAY additionally infer
  the default from the modal `stateRemote` of existing managed entries when `defaults.stateRemote` is
  unset (confirm-then-use) — but the explicit `defaults` block is authoritative. Extend the registry
  schema + validator to tolerate the `defaults` block.
- **I — inbox-handle derivation precedence.** flag > `SQUAD_INBOX_HANDLE` > `git config user.name`
  (sanitized to `INBOX_HANDLE_RE`; if it cannot be sanitized to a valid handle, fail with a clear message
  rather than registering a malformed handle). Record.
- **J — origin-collision handling.** Interactive: auto-detect, name the colliding squad, prompt to
  proceed. Non-interactive / `--yes`: still require explicit `--allow-origin-collision` (safety — never
  silently share an origin under automation). Record.

---

## Verify-first (before writing any change — confirm the actual shape on the `30f83be4` base)

- **§A.** `packages/squad-cli/src/cli/core/mcp-root.ts` — `ensureSquadStateMcpInUserConfig(dest, spec)`
  (confirm signature + hashed-key behavior + that it is currently uncalled).
  `packages/squad-cli/src/cli/core/mcp-spec.ts` — `localSquadStateMcpSpec()` and
  `resolveSquadStateMcpSpec()` (confirm the 2-tier npx spec it emits today).
  `packages/squad-sdk/src/copilot-payload.ts` — the `installCopilotPayload` MCP block (confirm it reads
  `hostDir/.copilot/mcp-config.json` — Bug A — and how it decides which servers to copy). Confirm which
  backends flow through cold-start so §A can branch on `orphan`/`two-layer` vs `local`.
- **§B.** `packages/squad-cli/src/commands/assign.ts` (`hasStateIdentity` gate, `_findWarmEntry`, the
  registry write of `stateBranch/configBranch/inboxHandle`, `--allow-origin-collision` handling) and
  `packages/squad-cli/src/commands/assign-args.ts` (the flag list). `deriveStateBranch` /
  `deriveConfigBranch` / `resolveStateRemote` in `sync.ts`. The registry schema in `squad-sdk` (where a
  `defaults` block would live) and its validator.
- **§C.** `packages/squad-cli/templates/squad.agent.md.template` — the always-loaded dispatch-invariant
  block (the current `agent_type: "general-purpose"` mention) and the on-demand `spawn-reference.md`
  pointer; the mirror-copy set the template-sync re-renders.
- **§D.** `packages/squad-sdk/src/resolution.ts` (or `resolution-v2.ts`) — `normalizeRemoteUrl` and its
  ADO/GitHub canonicalization branches; the resolver test file that covers it.
- **§E.** `packages/squad-sdk/src/resolution.ts` — `resolveSquadState`, `resolveSquadPaths`,
  `resolveStateBackend`, `ResolvedSquadPaths.teamDir`, and `paths.mode`. The reference implementation is
  the uncommitted working-tree diff in `D:\git\squad-p57-wt` (diff against it; do not assume it is on any
  committed branch).

---

## Changeset

Both `packages/squad-cli/src` and `packages/squad-sdk/src` are touched. Add a `patch` changeset for
`@wifi-aware/squad-cli` and `@wifi-aware/squad-sdk`. Summary: "managed-onboarding ergonomics +
shared-host state correctness — register `squad_state` at the user level for orphan/two-layer (retire the
repo-local `.mcp.json` for those backends), reduce `squad assign` to `--callsign` via derived branches /
defaulted skills+inbox-handle / system-wide state-remote, restore the unconditional `agent_type` +
plugin-agent prohibition to the always-loaded coordinator body, case-fold `normalizeRemoteUrl`, and
anchor `resolveSquadState` at the team `.squad/` for managed consumers."

## Acceptance (piece-level)

With `registry.defaults.stateRemote` set once, `squad assign --callsign <cs>` from inside a headless
product clone yields, with **zero** other flags: (1) a managed registry entry with derived
`state`/`config` branches, host skills, and a derived inbox-handle, the clone in `clones[]` (§B);
(2) a `squad_state` local-bin entry in the **user** MCP config and **no** repo-local `.mcp.json` for the
orphan backend (§A, decision G1); (3) a fresh Copilot session in the clone loads `squad_state` and
`squad_state_health` is green against the **orphan** backend, with the provider/backend anchored at the
host `.squad/` (§A + §E). The rendered coordinator agent md carries the unconditional `agent_type`
invariant + plugin prohibition in its always-loaded body (§C). `normalizeRemoteUrl` is case-insensitive
(§D). No regression to the warm-assign path, the full explicit `assign` form, cross-repo `sync --pull`,
`_findWarmEntry`, or `.last-hydrate-sha` / `.last-config-hydrate-sha` idempotency.
