### EECOM — Multi-Squad Storage & Implementation Proposal

**Author:** EECOM  
**Requested by:** Brady  
**Date:** 2026-05-15T23:06:53-07:00

## Executive summary

Treat a **Squad** as a **manifested directory tree with a stable identity**, and treat storage media as **transport/materialization choices**, not as different logical squad types. Reuse Tamir's pluggable `StateBackend` abstraction for writable state, but widen the model slightly so Squad can also represent **read-only or pull-only sources** and **layer multiple squads into one effective stack**.

The key move is to separate:

1. **Squad artifact** — the thing being shared (`.squad/` tree + manifest)  
2. **Squad source** — where that artifact comes from (repo, folder, OneDrive path, GitHub URL, ADO URL)  
3. **State backend** — how writes/sync happen once the artifact is materialized (`local`, `external`, `orphan`, `git-notes`, `two-layer`)  
4. **Squad stack** — the ordered set of squads visible in one repo/session

That gives us multi-squad-per-repo, one-squad-across-repos, org/team/personal layering, and multiple storage media without inventing a new server.

---

## 1) Squad as an addressable artifact

## Recommendation

A **Squad** should be defined canonically as a **directory tree rooted at `.squad/` with a required manifest file**:

```text
.squad/
  manifest.json
  team.md
  routing.md
  config.json
  agents/
  skills/
  decisions/
  log/
  templates/
```

`manifest.json` is the identity contract. The rest is ordinary Squad content.

### Proposed manifest shape

```json
{
  "$schema": "https://squad.dev/schema/squad-manifest.v1.json",
  "version": 1,
  "id": "squad:foo:platform",
  "name": "Foo Platform Squad",
  "kind": "team",
  "shareable": true,
  "defaultBackend": "two-layer",
  "source": {
    "uri": "git+https://github.com/foo/platform-squad.git//platform",
    "revision": "refs/heads/main"
  },
  "exports": {
    "includes": [
      "team.md",
      "routing.md",
      "config.json",
      "agents/**",
      "skills/**",
      "templates/**",
      "decisions/**"
    ],
    "excludes": [
      "log/**",
      "orchestration-log/**",
      ".scratch/**"
    ]
  }
}
```

### Required fields

- `version` — manifest schema version, not squad content version
- `id` — stable logical identity; must survive copies/clones/sync
- `name` — display label
- `defaultBackend` — preferred writable backend when mounted writable
- `source.uri` — canonical origin pointer

### Identity rule

`id` must be **logical and stable**, e.g. `squad:foo:org-default`, `squad:foo:platform`, `squad:brady:personal`. Do **not** derive identity from a local path.

### On disk vs over the wire

- **On disk:** a normal `.squad/` directory with `manifest.json`
- **Over the wire:** a **source URI + revision** that resolves to that directory tree
- **Optional export:** tar/zip is fine as a transport, but not the canonical model

That makes a squad shareable through git, synced folders, raw filesystem paths, or prebuilt bundles without changing the logical contract.

---

## 2) Backend matrix

The existing backend names are still useful, but they are not enough by themselves to describe remote/read-only sources. I would keep them for **state persistence**, and add a lightweight **source adapter** layer.

### Proposed source adapters

- `path` — direct filesystem path
- `git` — any git repo reachable by URL or local path
- `onedrive` — synced local folder; operationally a specialized `path`
- `http-readonly` — raw downloadable read-only squad bundle/tree

### Proposed backend capability widening

Add capability flags to `StateBackend` resolution:

- `read: true`
- `write: boolean`
- `pull: boolean`
- `push: boolean`
- `readonly: boolean`

This is the one widening I think Tamir's abstraction needs.

### Media matrix

| Storage media | Viable squad source? | Source adapter | Backend after materialization | Read/write semantics |
|---|---|---|---|---|
| In-repo `.squad/` | Yes | none / implicit local repo | `local`, `orphan`, `git-notes`, `two-layer` | Full RW; best for project-local overlay or repo-owned squad |
| Other repo on same disk | Yes | `path` or `git` | `external` or `two-layer` | RW if developer has filesystem access; good for shared team squad checkout |
| GitHub repo | Yes | `git` | cached as `external`; optional `two-layer` for local overlay | Read-only if mounted as fallback; RW if clone/push rights exist |
| ADO repo | Yes | `git` | cached as `external`; optional `two-layer` | Same as GitHub; use git transport, not a new service |
| OneDrive folder | Yes | `onedrive` | `external` | RW, but only safe with conflict detection/advisory locks |
| Plain filesystem folder | Yes | `path` | `external` | RW local/shared depending on folder ownership |
| Org-served static bundle / raw HTTP | Yes, but fallback-only | `http-readonly` | cached `external` with `readonly=true` | Pull-only, no direct writes |

### Practical mapping

- **Personal squad:** `path` source + `external` backend at local squad home
- **Team squad in dedicated git repo:** `git` source + `two-layer` backend
- **Org fallback squad:** `git` source or `http-readonly` source + read-only cached `external`
- **Repo-local squad state:** existing in-repo backends unchanged

---

## 3) Multi-squad coexistence on one disk

## Recommendation

Use a **centralized machine cache + per-repo binding file + local repo overlay**. Avoid symlinks as the primary model.

### Why not symlinks?

- Windows friction
- OneDrive/synced-folder weirdness
- tool confusion when resolving actual writable path
- hard to layer more than one squad cleanly

### Proposed layout

### Machine-local registry/cache (via `resolveGlobalSquadPath()`)

```text
%APPDATA%\squad\
  sources.json
  cache\
    squad_foo_org-default\
    squad_foo_platform\
  repos\
    squad_foo_platform.git\
```

Purpose:
- `sources.json` registers known squad sources
- `cache\{id}\` stores materialized copies for read-only/shared sources
- `repos\{id}.git\` optionally stores bare/mirror clones for git-backed sources

### Personal writable squad home (existing roaming concept)

```text
%USERPROFILE%\.squad\
  personal-squad\
```

Use this for the user's personal squad content.

### Per-repo binding + local overlay

```text
<repo>\.squad\
  config.json
  stack.json
  overlay\
```

- `stack.json` declares which squad IDs are visible in this repo and their order
- `overlay\` is the repo-local writable layer for repo-specific state

### Proposed `stack.json`

```json
{
  "version": 1,
  "layers": [
    { "id": "local-overlay", "kind": "overlay", "path": ".squad/overlay", "write": true },
    { "id": "squad:foo:platform", "kind": "primary", "write": false },
    { "id": "squad:foo:org-default", "kind": "fallback", "write": false }
  ],
  "defaultWriteLayer": "local-overlay"
}
```

### Read/write behavior

- **Reads:** resolve top-down, first match wins
- **Writes:** go to `defaultWriteLayer` unless caller explicitly targets another writable layer
- **Shared team edits:** only allowed when that layer is configured writable and backend supports push

This supports:
- org squad installed once, reused everywhere
- team squad shared across B and C
- personal squad independent for D
- repo-local overrides without mutating shared layers

---

## 4) SDK surface deltas

Keep the additions small and functional, not class-heavy.

### New types

```ts
export interface SquadManifest { ... }
export interface SquadSourceSpec { id: string; uri: string; adapter: 'path' | 'git' | 'onedrive' | 'http-readonly'; }
export interface RegisteredSquadSource extends SquadSourceSpec { readonly?: boolean; backend?: StateBackendType; cachePath?: string; }
export interface SquadLayer { id: string; role: 'overlay' | 'primary' | 'fallback'; readOnly: boolean; writeTarget?: boolean; }
export interface SquadStack { layers: SquadLayer[]; }
```

### New functions

- `readSquadManifest(path)`
- `parseSquadSource(uri)`
- `materializeSquadSource(source, options?)`
- `resolveSquadStack(cwd)`
- `resolveSquadStackStorage(cwd)` or `createStackedStorageProvider(stack)`

### Existing APIs to keep

- keep `resolveSquadState()` for single-backend mutable state
- keep current `StateBackend` implementations
- extend backend resolution to report capabilities

### Minimal widening to existing backend abstraction

I would add metadata, not rewrite the interface:

```ts
interface StateBackendCapabilities {
  readonly: boolean;
  canPull: boolean;
  canPush: boolean;
}
```

That is enough to support org-wide pull-only squads without making every backend understand networking.

---

## 5) CLI surface deltas

I would keep the CLI **thin but real**. This is core operator setup, so pushing everything into Rally would make the base product incomplete.

### Proposed commands

#### Source registry

- `squad source add <uri> --id <id> [--adapter git|path|onedrive|http-readonly] [--backend <type>] [--readonly]`
- `squad source list`
- `squad source pull [<id>]`
- `squad source remove <id>`

#### Repo binding

- `squad bind add <id> [--role primary|fallback] [--write]`
- `squad bind remove <id>`
- `squad bind list`
- `squad bind set-write <id>`

### Why this is enough

- `source *` manages global source registration/materialization
- `bind *` manages per-repo stack composition
- existing `init`, `preset`, `sync`, `migrate-backend` remain relevant

I would **not** add a large new command family beyond that for MVP.

---

## 6) Day-1 walkthrough

Below is the exact setup I would want a developer to run.

### Step 0 — create personal squad once

```powershell
squad init --global
squad source add "$HOME\.squad\personal-squad" --id squad:brady:personal --adapter path --backend external
```

### Step 1 — register shared sources once on this machine

```powershell
squad source add "git+https://github.com/Foo/squads.git//org-default" --id squad:foo:org-default --adapter git --backend external --readonly
squad source add "git+https://github.com/Foo/squads.git//platform" --id squad:foo:platform --adapter git --backend two-layer
```

If Bar hosts the same team squad instead of Foo:

```powershell
squad source add "git+https://dev.azure.com/Bar/Platform/_git/squads//platform" --id squad:foo:platform --adapter git --backend two-layer
```

### Step 2 — project A gets org fallback only

```powershell
cd D:\src\Foo\A
squad init
squad bind add squad:foo:org-default --role fallback
```

### Step 3 — projects B and C share the same team squad, with org fallback behind it

```powershell
cd D:\src\Foo\B
squad init
squad bind add squad:foo:platform --role primary
squad bind add squad:foo:org-default --role fallback

cd D:\src\Bar\C
squad init
squad bind add squad:foo:platform --role primary
squad bind add squad:foo:org-default --role fallback
```

### Step 4 — project D uses personal squad

```powershell
cd D:\src\Baz\D
squad init
squad bind add squad:brady:personal --role primary --write
```

Result:
- **A** sees org defaults
- **B + C** see team squad first, then org fallback
- **D** sees personal squad only

---

## 7) Build allocation

| Capability | Owner | Why |
|---|---|---|
| (a) SDK | **Yes** | manifest schema, source parsing, materialization contracts, stacked resolution, backend capability flags all belong in reusable core logic |
| (b) CLI | **Yes** | local file ops, source registration, repo binding, and stack inspection are core end-user operations |
| (c) Rally | **Yes** | best place for auth-heavy bootstrap flows (GitHub/ADO clone/auth), org rollout helpers, and fleet operations across many repos |
| (d) Rally mod | **Maybe later** | useful for dashboard/admin UX, but not required for MVP; do not block core design on it |
| (e) New tool | **No for MVP** | unnecessary surface area; git + filesystem + existing CLI/Rally are enough |

### Technical split

- **SDK:** pure resolution/model layer, no product-specific auth UX
- **CLI:** thin local operator wrapper over SDK
- **Rally:** networking/orchestration host, especially where `gh` / ADO auth and multi-repo rollout matter

That keeps the CLI zero-dep-friendly while using Rally where host-level orchestration is already a feature.

---

## 8) Implementation risk — top 3

### 1. Cross-backend consistency and conflict semantics

This gets hairy fastest when a writable team squad sits in a **OneDrive-synced folder** or a remote git source is edited from multiple machines.

- `git` backends have explicit fast-forward/divergence semantics
- OneDrive/plain FS do not
- append-only files help, but config/routing/agent edits are not append-only

**Mitigation:** require revision tokens on write, add advisory lock files for `external`/`onedrive`, and treat OneDrive as safe for small teams / low-contention only.

### 2. Identity drift / duplicate squad registration

If the same shared squad is reachable by local path, GitHub URL, and ADO mirror, the system can accidentally register three logical copies unless `manifest.id` is authoritative.

**Mitigation:** manifest `id` wins; registration de-dupes by `id`, not URI.

### 3. Layered resolution becoming opaque to users

Multi-squad stacks can produce “why did Squad read that file from there?” confusion.

**Mitigation:** add an explain/debug path early (`squad bind list --verbose` or `squad doctor`) that prints layer order, writable target, cache path, and source URI.

---

## Final recommendation

Adopt **manifested squad artifacts + source registry + ordered squad stacks**, while reusing Tamir's existing state backends for the writable layer. The minimal architectural widening is:

1. add a **source/materialization** concept next to `StateBackend`  
2. add **capability flags** so backends can be read-only or pull-only  
3. add a small **SquadStack** resolver in the SDK  
4. expose a thin CLI for `source` and `bind`

That gets us multi-squad without inventing a server, without overloading Rally, and without blowing up the SDK surface.
