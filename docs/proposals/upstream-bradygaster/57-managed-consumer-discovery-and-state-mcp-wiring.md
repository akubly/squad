# 57 — Managed-consumer discovery: restore the `local` anchor, wire the state-MCP bridge, and stop agents filesystem-probing for the team root

## Summary

The v0.9→v0.11 adoption pass moved shared-squad consumers fully onto the **managed / centralized**
model: the team root, skills, and the runtime `.mcp.json` all live in a CLI-managed host clone
(`~/.squad/hosts/<callsign>/.squad`), while agents and the Copilot session run in the **product clone**
(e.g. `D:\git\os\wifi\src`). Everything that resolves the squad by asking the **registry**
(`squad status`, `squad sync`) still works. Everything that discovers by **walking the filesystem from
cwd** — Copilot's `.mcp.json` auto-load, and any agent that greps for `.squad/team.md` — now breaks,
because none of those files exist under the clone anymore.

This piece is the **consumer-discovery capstone** for the managed model. It restores the single missing
primitive that made v0.9 "just work" (a filesystem-discoverable `local` anchor in the clone), gives
callers and agents a **machine-readable resolver** so nobody has to probe for `team.md`, wires the
**new-in-0.11 `squad_state` MCP bridge** into the managed-consumer clone (today it is only ever written
into an `init`/`upgrade` `dest`, never by managed cold-start, and it points at an unpublished package),
and adds a **doctor** check that detects the "resolves but has no config lane" stale-host condition we
hit live on `wifi-aware`.

**Why this piece is on the 0.11 line, not the 0.9.6 fork.** §D/§F/§I concern the `squad_state`
state-MCP bridge (`state-mcp.ts`, `mcp-root.ts`, `resolveSquadState`). That bridge is **upstream-new in
v0.11** (commit `5e35a04b`); the 0.9.6-mc fork line has **zero** state-mcp files. This piece therefore
bases on the v0.11 integration branch, where the bridge exists to be wired.

Stack position: a new consumer-discovery piece on the **v0.11 integration** tip
(`akubly/upstream-npm-release-0.11`, `664e9db4`), consuming the managed cold-start machinery pieces
40–56 delivered on the 0.9.6 line and now rebased onto 0.11.

---

## Root cause (one cause, five symptoms)

**Resolver precedence** (`cli-entry.ts` `formatResolverReason`):
`local → env → clones → origins → platform → worktree`.

- In **v0.9**, a consumer clone resolved via **`local`**: either a `squad link` pointer
  (`.squad/config.json.teamRoot`) or a real local `.squad/`. That anchor is on the filesystem, so
  *every* discovery mechanism — the CLI resolver, Copilot's `.mcp.json` walk, and a naive agent grep —
  found the same team root.
- The **v0.11 adoption** moved consumers to managed/registry-only resolution (`clones`). Managed
  cold-start (`assign`) registers the clone in the registry but **never runs `squad link`**, so the
  `local` anchor is gone. Registry-aware callers still resolve; filesystem-based discovery does not.

The five observed symptoms all reduce to "the `local` anchor and the clone-local runtime files are
missing under the managed model":

| # | Symptom (observed live) | Defect id |
|---|---|---|
| 1 | Agent in `D:\git\os\wifi\src` greps `.squad/team.md`, times out on VFS, concludes "no team root". | `agent-teamroot-fs-probe-vs-registry-managed` |
| 2 | `squad status --json` is silently ignored (exit 0, prints human text) — no machine-readable resolve. | `agent-teamroot-fs-probe-vs-registry-managed` |
| 3 | Copilot: "`squad_state` MCP server in `.mcp.json` is not reachable … restart or set `stateBackend: local`" — because the clone has no `.mcp.json`, and the host-side one points at an unpublished `@insider` package. | `squad-state-mcp-bridge-new-in-011-unpublished-hostplaced` |
| 4 | Cold-start run from inside a product clone does not add that clone to the managed entry `clones[]`. | `managed-coldstart-ignores-cwd-clone` |
| 5 | A managed host that resolves but was stood up with only the state lane (no `team.md` / no `.last-config-hydrate-sha`) silently yields "no team.md". | `wfa-teamroot-no-config-hydrate` |

**Proven immediate mitigations this session** (the durable forms are the sub-proposals below):
- `squad link 'C:\Users\akubly\.squad\hosts\<cs>'` in the product clone → resolver flips back to
  source=`local`; agents and Copilot rediscover the root. (durable form: §A)
- `squad sync --pull` from the product dir hydrates the missing config lane → `team.md` returns.
  (durable form: §E doctor heal)

---

## Fork / upstream boundary (context for §D, §F, §I)

- **Our fork (0.9.6-mc) owns the shared-host STATE machinery**: orphan/git-notes state backend, managed
  cold-start, registry `clones[]`/managed hosts, cross-repo state+config lanes and fold pipelines
  (pieces 40–56). All registry/managed-aware.
- **Upstream added the `squad_state` MCP bridge NEW in 0.11** (`5e35a04b`). Our replay carried its
  **resolver** awareness (the bridge resolves via `resolveSquadState → resolveRegistrySquad`, our
  registry resolver — so it *can* find a managed host from a registered clone cwd), but did **not** wire
  its **delivery** for the managed topology: `.mcp.json` is written only by `init.ts`/`upgrade.ts` into
  `dest`, never by managed cold-start, and its command targets an unpublished scope. So: **resolution
  parity YES, wiring/host-support parity NO** — the gap §D closes.
- **Not** introduced by 0.9→0.11: `squad link` (remote-squad mode) and `doctor` — those predate our fork
  point and exist in 0.9.6 too. The genuinely new convergent primitive is the state-MCP bridge (§I
  decides retire-vs-keep of our bespoke state access now that a native path exists).

---

## Sub-proposals

### §A (Tier 1) — Cold-start auto-`link`s the cwd product clone (restore the `local` anchor)

Managed cold-start run from inside a product clone must, as part of §D auto-wire, run the equivalent of
`squad link <host-path>` in that clone: write clone-local `.squad/config.json`
(`{version, teamRoot: <host>, projectKey}`, gitignored) and clear the resolve cache. This restores
resolver source=`local` — the exact anchor v0.9 had — so agents and Copilot rediscover the root by
filesystem walk. Only `config.json` lands in the clone; `team.md` stays in the host (callers must follow
`config.json.teamRoot`, not probe for `team.md`).

**Acceptance:** after cold-start from a clone, `squad status` in that clone resolves via **`local`** with
a `teamRoot` pointer to the host, AND cross-repo `sync --pull` still resolves the callsign.

### §B (Tier 1) — Cold-start binds the cwd git-root into the managed entry `clones[]`

Managed cold-start run from `D:\git\os\wifi\src` must auto-add that git-root to the managed registry
entry's `clones[]` (and wire the product-repo cross-repo hook) with no manual `registry.json` edit.

**Acceptance:** `squad assign --callsign X --state-remote …` from a product clone yields a registry
entry whose `clones[]` includes that clone path, unedited.

### §C (Tier 1) — Machine-readable team-root resolver (`squad team-root`, real `--json`)

Give callers/agents a resolver they can call instead of probing. Two parts:
1. `squad status --json` must **emit JSON** (today `--json` is silently ignored — exit 0, human text).
   Include at least `{ callsign, teamRoot, source, managed, stateBackend }`.
2. Add `squad team-root` (alias `squad where`): prints the resolved absolute team-root path and the
   resolver `source`; exits **non-zero** when unresolved (so a script can branch on it).

**Acceptance:** from a managed clone, `squad team-root` prints the host `.squad` path + `source=local`
and exits 0; from an unregistered directory it exits non-zero with a machine-parseable reason.
`squad status --json` returns valid JSON with the resolved fields.

### §D (Tier 1) — Wire the `squad_state` MCP bridge into the managed-consumer clone

Managed cold-start (and `squad link`) must write the state-MCP `.mcp.json` at the **consumer git root**
(reuse `ensureSquadStateMcpInRoot`, today called only by `init`/`upgrade`), and the bridge command must
resolve to an **installed** binary rather than `npx -y @wifi-aware/squad-cli@insider state-mcp` (the
scope is unpublished — `npm view` → E401 — so the command can never spawn). Prefer the locally-resolvable
`squad state-mcp` (bin on PATH) so it works offline/pre-publish; see decision **H**.

**Acceptance:** after cold-start from a clone, a `.mcp.json` exists at the clone git-root with a command
that resolves on this machine with no network; a fresh Copilot session in the clone loads `squad_state`
with no "bridge is missing" error, and `squad_state_health` returns healthy against the resolved backend.

### §E (Tier 1) — Doctor detects + heals the stale managed host (config lane missing)

`squad doctor` must detect a managed host that **resolves** but is missing the config lane — no
`team.md` and/or no `.last-config-hydrate-sha` sentinel (the live `wifi-aware` condition) — and report it
**RED**, then offer/auto-run the config-lane hydrate (`hydrateTeamRootFromConfigRef`) to turn it GREEN.

**Acceptance:** doctor on a pre-heal managed host (state lane only) reports the missing-config-lane
condition RED; the heal path runs the config hydrate and re-checks GREEN, and `squad status` then
resolves with a real `team.md`.

### §F (Tier 1) — Agent bootstrap resolves via the registry, never probes for `team.md`

The coordinator/agent session-start guidance (`squad.agent.md.template`) must resolve the team root by
calling the §C resolver (`squad team-root` / `squad status --json`) and follow `config.json.teamRoot`,
and must **not** filesystem-probe for `.squad/team.md` (which never exists under the managed clone and
times out on VFS repos). Edit the canonical template and re-sync mirror copies byte-identically.

**Acceptance:** the template's session-start block invokes the resolver command and contains no
`team.md` filesystem-search step; a dry read of the rendered coordinator agent shows the resolver call.

### Tier 2 decisions (triage first, record rationale)

- **G — Primary anchor: `link` vs `clones[]`.** G1 do **both** (link gives the filesystem `local` anchor
  for agents/Copilot; `clones[]` gives registry resolution for the CLI) — **recommended**; G2 registry
  only. Decide precedence interaction and record.
- **H — state-MCP command shape.** H1 locally-installed `squad state-mcp` bin (offline-robust, works
  pre-publish) — **recommended**; H2 `npx` pinned to a **published** version once the feed publishes.
  Record H1 now with an H2 follow-up gated on B1 publish.
- **I — Fork/upstream convergence: retire vs keep bespoke state access.** Now that upstream ships the
  native `squad_state` bridge, decide whether to converge on it and retire our bespoke access path, or
  keep both. **Recommended:** keep both short-term (bridge for agent sessions, direct/orphan backend for
  CLI/fold), converge on the bridge as the single agent-facing surface; record the deprecation intent.

---

## Verify-first (before specifying or writing any change — on the 0.11 base, not the 0.9.6 line)

- **Resolver.** In the SDK confirm `resolveSquadState` (`resolution.ts`) and its
  `resolveRegistrySquad({ cwd }) → resolveSquadPaths → resolve backend` chain; confirm the resolver
  precedence in `cli-entry.ts` `formatResolverReason` and that `local` still wins when a clone
  `.squad/config.json.teamRoot` is present.
- **`squad link`.** In `link.ts` confirm `runLink` writes `.squad/config.json`
  (`{version, teamRoot, projectKey}`), adds `.squad/config.json` to `.gitignore`, and clears the resolve
  cache. §A reuses this verbatim — do not fork a second implementation.
- **Cold-start.** In `assign.ts` confirm the managed cold-start path, the §D auto-wire block, the
  registry write (`clones[]`, `managed:true`), and that **no** `ensureSquadStateMcpInRoot` / `squad link`
  call exists there today (both are the gap). Do not regress the warm path or `_findWarmEntry`.
- **MCP wiring.** In `mcp-root.ts` confirm `ensureSquadStateMcpInRoot` (writes `.mcp.json` to a git
  root) and the auto-load assumption; in `init.ts`/`upgrade.ts` confirm they are the only current
  callers; in `state-mcp.ts` confirm the `squad state-mcp` command + `MCP_TOOL_ALIASES` and the exact
  command string currently written into `.mcp.json` (the unpublished `@insider` npx line).
- **`--json` + status.** In the status command confirm `--json` is parsed-but-ignored today; find where
  the resolved fields are computed so §C can serialize them.
- **Hydrate + doctor.** In `sync.ts` confirm `hydrateTeamRootFromConfigRef` and the
  `.last-config-hydrate-sha` sentinel; in `doctor.ts` confirm the managed-host checks and where to add
  the config-lane-present assertion + heal call.
- **Template.** In `squad.agent.md.template` confirm the "On every session start" block and any current
  team-root discovery guidance; confirm the mirror-copy set the template-sync re-renders.

---

## Scope note (v0.11 integration branch)

The integration branch is already rescoped to `@wifi-aware/squad-*` (tip
`chore(release): rescope @bradygaster → @wifi-aware`). Unlike prior 0.9.6-line pieces, **keep the
`@wifi-aware` scope** — do not reintroduce `@bradygaster` into touched files, and confirm the scrub gate
count does not grow relative to the `664e9db4` base.

## Changeset

`packages/squad-cli/src` and `packages/squad-sdk/src` are both touched. Add a `patch` changeset for
`@wifi-aware/squad-cli` and `@wifi-aware/squad-sdk`. Summary: "managed-consumer discovery — cold-start
auto-links the product clone and binds it into `clones[]`, wires the `squad_state` MCP bridge into the
consumer clone with a locally-resolvable command, adds `squad team-root` / real `status --json`, a
doctor stale-config-lane detect+heal, and stops the coordinator template filesystem-probing for
`team.md`."

## Acceptance (piece-level)

A fresh managed cold-start from inside a product clone yields, with **zero follow-up**: (1) resolver
source=`local` in that clone (§A) and the clone present in `clones[]` (§B); (2) `squad team-root` /
`status --json` resolve the root machine-readably (§C); (3) a clone-root `.mcp.json` whose bridge command
spawns offline and a Copilot session that loads `squad_state` with no "bridge missing" error (§D);
(4) `squad doctor` green — including a RED→GREEN transition on a state-lane-only host after the config
hydrate heal (§E); (5) the coordinator agent resolves the team root via the resolver, not a `team.md`
probe (§F). No regression to the warm-assign path, cross-repo sync, or `.last-hydrate-sha` /
`.last-config-hydrate-sha` idempotency.
