### Procedures — Multi-Squad Discovery & Layering Proposal

**Date:** 2026-05-15T23:06:53-07:00  
**Requested by:** Brady  
**Domain:** Discovery, resolution, layering  
**Goal:** Extend today's single-team-root + personal ambient discovery model into a fast, additive, engineering-org-scale multi-squad stack without breaking the existing worktree flow.

---

## Executive summary

Keep today's behavior as the zero-config default. Add a new **stack resolver** that only activates when binding metadata exist. The resolver returns an ordered set of applicable squads for the current clone/session:

1. **Project squad** (optional, authoritative, nearest scope)
2. **Team squad** (optional, authoritative)
3. **Org squad** (optional, authoritative fallback)
4. **Personal squad** (optional, advisory overlay by default)

The key design choice: **personal is part of discovery, not part of silent governance override.** Personal agents can travel everywhere, but they do not automatically steal authority from project/team/org agents.

That gives us:
- **Backward compatibility:** no binding metadata → current single-squad resolution remains unchanged
- **Fast startup:** resolve a stack from small local/global manifests, not from recursive scans
- **State-backend flexibility:** each layer can carry its own `stateBackend` (`worktree`, `git-notes`, `orphan`, `two-layer`)
- **Safe layering:** closest authoritative squad owns write authority; wider layers are read-mostly unless explicitly promoted

---

## Design principles

1. **Additive, never breaking.** Existing `resolveSquad()` / worktree behavior stays the fallback path.
2. **Resolve once, use everywhere.** The coordinator should compute a stack object once per session start and pass it to spawned agents.
3. **Authority and visibility are different.** A squad can be visible in the cast without being allowed to write.
4. **Closest scope wins for writes.** Project > team > org.
5. **Personal is consult-first.** Personal agents remain ambient and useful, but Ghost Protocol still protects project/team/org state.
6. **Promotions are explicit.** Reusable learnings can move upward; they should not drift upward automatically.
7. **Registries must be cacheable.** Session start must stay cheap enough to run on every launch.

---

## 1. The resolution stack

### Proposed runtime shape

Introduce a new SDK primitive:

```ts
interface ResolvedSquadLayer {
  squadId: string;                 // e.g. "foo-team", "foo-org", "personal/default"
  scope: 'project' | 'team' | 'org' | 'personal';
  root: string;                    // absolute path or logical root for backend adapter
  source: 'project-config' | 'clone-binding' | 'user-registry' | 'org-registry' | 'ambient-personal';
  precedence: number;              // lower = stronger
  mode: 'authoritative' | 'advisory';
  stateBackend: 'worktree' | 'git-notes' | 'orphan' | 'two-layer';
  writable: boolean;
  namespaced: boolean;             // required for explicit addressing on collision
}

interface ResolvedSquadStack {
  layers: ResolvedSquadLayer[];    // already sorted strongest → weakest
  activeWriteLayer: ResolvedSquadLayer | null;
  personalOverlay: ResolvedSquadLayer | null;
  resolutionMode: 'legacy-single' | 'layered';
}
```

### Resolution algorithm

If **no multi-squad config is present**, call today's single-root resolver and stop. That is the compatibility gate.

If multi-squad config **is** present, resolve in this order:

1. **Determine clone context cheaply**
   - `cwd`
   - current git root / worktree root
   - main checkout root if in a worktree
   - normalized repo origin (if available)
   - optional repo slug / org slug
2. **Check for project-local squad config**
   - If `.squad/config.json` exists and has a `layering` block, use it.
   - If `.squad/` exists with no `layering` block, treat it as today's local/project squad and optionally extend with bound fallbacks.
3. **Check clone-local binding metadata**
   - `.git/squad-binding.json` or git config key(s)
   - strongest non-committed override for this exact checkout/worktree
4. **Check per-user binding registry**
   - global `clone-bindings.json`
   - match order: exact clone path → main checkout path → normalized origin → repo slug → org slug
5. **Check squad registry defaults**
   - resolve named squad IDs to roots/backends using global `squads.json`
   - expand default fallback chains declared on team/org squads
6. **Apply ambient personal discovery**
   - if `SQUAD_NO_PERSONAL` is not set and a personal squad exists, add it as an advisory overlay
7. **Dedupe + sort**
   - authoritative layers sort closest-to-farthest: project → team → org
   - personal layer is appended as an advisory overlay unless explicitly addressed
8. **Assign write authority**
   - first authoritative layer in the ordered list becomes `activeWriteLayer`
   - all broader authoritative layers are read-only by default for that session

### Precedence rules

There are **two precedence orders**, not one:

#### A. Governance / write precedence

```text
project > team > org
```

This decides:
- who owns `decisions.md`
- where Scribe writes the main session log
- whose routing/charter is authoritative by default

#### B. Visibility / consult precedence

```text
explicit namespace > unqualified authoritative agent > unqualified personal agent
```

This decides agent addressing.

That means the user can still explicitly call `personal/procedures`, but a plain `Procedures` resolves to the nearest authoritative squad if there is a collision.

### Where binding metadata live

Use **three levels** of metadata, each with a different job:

| Level | Purpose | Location | Shared? |
|---|---|---|---|
| Per-project default | Repo says what it normally inherits from | `.squad/config.json` (`layering`) | Yes, committed |
| Per-clone override | This specific checkout/worktree overrides the default | `.git/squad-binding.json` (or git config) | No |
| Per-user / org registry | Reusable mappings + named squads + defaults | global config root (`clone-bindings.json`, `squads.json`) | Per-user, optionally synced |

This gives us repo-shared defaults plus local escape hatches without forcing every repo to commit org/team inheritance policy on day 1.

---

## 2. Binding mechanism

### A. Registry of named squads

Extend today's global `squads.json` registry so entries can describe scope + backend + default fallback chain.

```json
{
  "version": 2,
  "active": "personal-default",
  "squads": [
    {
      "id": "foo-team",
      "name": "Foo Team",
      "scope": "team",
      "path": "D:\\Users\\brady\\AppData\\Roaming\\squad\\squads\\foo-team",
      "stateBackend": "git-notes",
      "defaultFallbacks": ["foo-org"]
    },
    {
      "id": "foo-org",
      "name": "Foo Org",
      "scope": "org",
      "path": "D:\\Users\\brady\\AppData\\Roaming\\squad\\squads\\foo-org",
      "stateBackend": "two-layer",
      "defaultFallbacks": []
    }
  ]
}
```

### B. Repo-shared default binding

Extend `.squad/config.json` with an optional `layering` block:

```json
{
  "version": 2,
  "teamRoot": ".squad",
  "stateBackend": "worktree",
  "layering": {
    "primary": "foo-team",
    "fallback": ["foo-org"],
    "allowPersonal": true,
    "personalMode": "overlay"
  }
}
```

This means: *when this repo is opened, prefer the repo's own squad if present, otherwise bind to `foo-team`, then `foo-org`, and allow the user's personal ambient agents.*

### C. Clone-local override

Add a non-committed binding file for exact checkout/worktree overrides:

**Path:** `.git/squad-binding.json`

```json
{
  "version": 1,
  "primary": "foo-team",
  "fallback": ["foo-org"],
  "allowPersonal": true,
  "personalMode": "overlay",
  "writeLayer": "primary"
}
```

Use cases:
- one engineer wants Foo/A to inherit Foo Team + Foo Org
- another engineer keeps the same repo in standalone mode
- worktree-specific experiments without touching committed files

### D. Per-user clone binding registry

Add `clone-bindings.json` in the global Squad config root:

```json
{
  "version": 1,
  "bindings": [
    {
      "match": {
        "cloneRoot": "D:\\src\\foo-project-a",
        "origin": "github.com/foo/project-a"
      },
      "stack": {
        "primary": "foo-team",
        "fallback": ["foo-org"],
        "allowPersonal": true
      }
    },
    {
      "match": {
        "origin": "github.com/bar/project-c"
      },
      "stack": {
        "primary": "bar-team",
        "fallback": ["bar-org"],
        "allowPersonal": true
      }
    }
  ]
}
```

This is the right place for:
- per-user fleet defaults
- mappings discovered during `squad bind`
- bindings hydrated from enterprise tooling later

### E. Env vars

Keep env vars minimal and mostly for debugging / temporary overrides:

- `SQUAD_NO_PERSONAL=1` — existing kill switch
- `SQUAD_NO_MULTI_SQUAD=1` — force legacy single-squad resolution for rollback/debugging
- `SQUAD_STACK=foo-team,foo-org` — explicit session-only override (highest priority, optional)

### Binding precedence

```text
SQUAD_STACK env override
→ .git/squad-binding.json
→ .squad/config.json layering block
→ clone-bindings.json
→ squad registry defaultFallbacks
→ legacy single-squad resolution
```

---

## 3. Jurisdiction rules

### 3.1 Authority model

| Layer | Default role | Can write own state? | Can write broader/narrower layers? |
|---|---|---:|---:|
| Project | Authoritative | Yes | No |
| Team | Authoritative fallback | Yes when active write layer | No |
| Org | Authoritative fallback | Yes when active write layer | No |
| Personal | Advisory overlay | Yes, but only personal state | No project/team/org writes |

### 3.2 Who can write to which `decisions.md`

**Default rule:** a session writes to exactly **one** authoritative `decisions.md` automatically: the `activeWriteLayer`.

That means:
- if a project squad exists, project `decisions.md` gets the automatic writes
- if no project squad exists but the clone is bound to Foo Team, team `decisions.md` gets the automatic writes
- org `decisions.md` is not written automatically unless the org layer is the active write layer

### 3.3 Promotion rule for broader learnings

A decision can move upward only by **explicit promotion**:
- `scope: project` → stays local
- `scope: team` → staged into the team layer inbox
- `scope: org` → staged into the org layer inbox
- `scope: personal` → staged into personal extraction/personal decisions

This keeps reuse intentional. Team/org layers should become curated memory, not a noisy dump of every project-specific conclusion.

### 3.4 Charter and routing collisions

**Nearest authoritative charter wins.**

Default resolution on unqualified collisions:

```text
project charter > team charter > org charter
```

**Personal charters do not silently shadow authoritative agents.**

If `personal/procedures` exists and `team/procedures` exists:
- `Procedures` resolves to the nearest authoritative squad
- `personal/Procedures` or `@personal/procedures` resolves to the personal one

### 3.5 Can a personal Ralph monitor a team squad's queue?

**Default: no.**

Reason: ambient double-Ralphs are dangerous. Queue monitoring and auto-dispatch are coordinator-grade powers. If both a team Ralph and a personal Ralph monitor the same context, we create dueling schedulers.

Proposed rule:
- only **one active Ralph** per authoritative stack
- that Ralph comes from the strongest authoritative layer
- a personal Ralph may exist, but only as:
  - a consult-only advisor, or
  - an explicitly namespaced observer with **no dispatch authority**

If we ever allow cross-layer observation, it must be declared explicitly in binding metadata, e.g.:

```json
{
  "observerOverrides": {
    "personal/ralph": ["team:foo-team"]
  }
}
```

Even then: observe yes, dispatch no, write no.

### 3.6 Scribe logging partition

Scribe should partition by **session layer** and **entry origin**.

#### Main session log

Write to the `activeWriteLayer` only.

Examples:
- project session → project log/backend
- team-bound repo with no local squad → team log/backend
- org-only repo → org log/backend

#### Entry tags inside the log

Every entry carries:
- `layer: project|team|org|personal`
- `squadId`
- `origin: authoritative|personal-consult`
- `scope: project|team|org|personal`

#### Personal mirror log

If personal agents participated, Scribe may append a **brief mirror breadcrumb** to the personal squad's consult log, but not the full project log. That keeps personal memory aware of where it advised without copying project internals wholesale.

---

## 4. Coordinator prompt deltas (`.github/agents/squad.agent.md`)

## 4.1 Replace single-root framing with stack framing

Current prompt language assumes one resolved `TEAM_ROOT`. Replace that with:
- `SQUAD_STACK` (ordered layers)
- `ACTIVE_WRITE_LAYER`
- `PRIMARY_TEAM_ROOT` (root of the active authoritative layer for backward compatibility in spawn prompts)
- optional `PERSONAL_OVERLAY`

### New section to add

```md
### Squad Stack Resolution

On every session start, resolve the applicable squad stack for the current cwd.

1. If no layering metadata exists, use the legacy single-squad resolution path.
2. Otherwise, resolve the current clone/worktree identity.
3. Read the strongest available binding metadata in this order:
   - session/env override
   - clone-local binding
   - repo-local layering config
   - user clone-binding registry
   - squad registry default fallbacks
4. Expand named squad IDs into concrete layer roots + state backends.
5. Add ambient personal squad as an advisory overlay unless disabled.
6. Sort authoritative layers: project > team > org.
7. Select the first authoritative layer as ACTIVE_WRITE_LAYER.
8. Pass the full stack and the active write layer into every spawn prompt.
```

### New spawn context fields

Add to every spawn prompt:

```md
SQUAD_STACK: [{ scope, squadId, root, stateBackend, mode, writable }...]
ACTIVE_WRITE_LAYER: { scope, squadId, root, stateBackend }
PERSONAL_OVERLAY: { enabled, squadId|null }
```

Keep `TEAM_ROOT` for compatibility, but redefine it as:
- the root of `ACTIVE_WRITE_LAYER`
- not "the only squad root"

## 4.2 Rewrite the current team-root chain as a layered algorithm

The current 6-step team-root chain should become:

1. **Try layered resolution first** if any binding metadata are present.
2. **If layered resolution yields no authoritative layers, fall back to today's chain**:
   - CWD `.squad/`
   - git root `.squad/`
   - clone registry match
   - platform/global registry
   - worktree main checkout fallback
3. **If all of that fails**, enter today's init flow.

This preserves existing behavior while allowing the new model to short-circuit when configured.

## 4.3 Update Personal Squad (Ambient Discovery)

The Personal Squad section should change from "merge into cast; project agent wins on conflict" to:

```md
### Personal Squad (Ambient Discovery)

Personal squad discovery remains ambient and fast.

1. Honor `SQUAD_NO_PERSONAL`.
2. Resolve the personal squad directory.
3. Add personal agents as an advisory overlay, not as an automatic write-authority layer.
4. Personal agents follow Ghost Protocol by default.
5. On name collision with any authoritative layer, the authoritative agent owns the unqualified name.
6. Personal agents remain explicitly addressable via `personal/{name}`.
7. Personal agents may advise across the stack, but they may not write to project/team/org state unless the session is explicitly in consult mode.
```

## 4.4 Add a new section: Cross-Layer Jurisdiction

Add a short always-loaded section covering:
- one automatic write layer per session
- personal never silently overrides governance
- promotion required for team/org writes
- only one active Ralph per authoritative stack
- Scribe tags entries with layer + origin + scope

That is the policy glue the current prompt is missing.

---

## 5. Day-1 walkthrough

### Assumptions for the walkthrough

- **Foo Team squad** exists and uses `git-notes`
- **Foo Org squad** exists and uses `two-layer`
- **Bar Team squad** exists and uses `git-notes`
- **Bar Org squad** exists and uses `two-layer`
- The engineer has a personal squad enabled
- Project A in Foo is bound to `foo-team` with fallback `foo-org`
- Project B in Foo has its own local `.squad/` and also falls back to `foo-team` → `foo-org`
- Project C in Bar is bound to `bar-team` with fallback `bar-org`
- Project D is a personal project in Baz with no team/org binding

### Clone A — Foo / Project A

**Discovery path**
1. No local `.squad/` or only a thin binding stub
2. Clone binding matches `foo-team`
3. Registry expands fallback to `foo-org`
4. Personal overlay is added
5. Active write layer = `foo-team`

**Coordinator first response**

```md
Squad v0.9.1
Resolved stack: Foo Team (primary, git-notes) → Foo Org (fallback, two-layer) + Personal overlay.
No project-local squad in this clone, so I’m using the shared Foo stack for authority and your personal agents in consult mode.
```

**If catch-up is triggered**

```md
Catch-up: Foo Team landed 2 routing updates and one testing decision since your last session. Foo Org added an org-wide reviewer rule. Your personal squad has 1 consult breadcrumb from this repo.
```

### Clone B — Foo / Project B

**Discovery path**
1. Local `.squad/` exists with `layering.primary=foo-team` and fallback `foo-org`
2. Local project squad becomes strongest authoritative layer
3. Personal overlay is added
4. Active write layer = project B local squad

**Coordinator first response**

```md
Squad v0.9.1
Resolved stack: Project B local squad (primary, worktree) → Foo Team (fallback, git-notes) → Foo Org (fallback, two-layer) + Personal overlay.
Local project rules win here; team and org memory are available as fallbacks.
```

**If catch-up is triggered**

```md
Catch-up: Project B has 3 local decisions newer than your last session, including one unresolved inbox item. Foo Team shipped a shared prompt update; Foo Org has no new blockers for this project.
```

### Clone C — Bar / Project C

**Discovery path**
1. No local project squad
2. Clone binding / user registry maps repo to `bar-team`
3. Registry expands fallback to `bar-org`
4. Personal overlay is added
5. Active write layer = `bar-team`

**Coordinator first response**

```md
Squad v0.9.1
Resolved stack: Bar Team (primary, git-notes) → Bar Org (fallback, two-layer) + Personal overlay.
This clone is bound to the Bar shared stack, so team state is authoritative here.
```

**If catch-up is triggered**

```md
Catch-up: Bar Team has one open issue routed to the tester and a fresh release-process note. Bar Org has one new compliance decision relevant to all Bar repos.
```

### Clone D — Personal / Baz

**Discovery path**
1. No local `.squad/`
2. No clone binding
3. No org registry match
4. Personal squad exists
5. Active write layer = personal squad (only because no broader authoritative layer exists)

**Coordinator first response**

```md
Squad v0.9.1
Resolved stack: Personal squad only.
No project/team/org binding was found for this clone, so I’m running with your personal squad as the sole authority.
```

**If catch-up is triggered**

```md
Catch-up: Your personal squad has 2 new generic learnings and one open consult extraction review. No shared team or org layers apply in this repo.
```

### UX rule for session start

Do **not** dump the full stack object on every launch. Print a short human banner:
- strongest authoritative layer
- fallback presence
- whether personal overlay is active

Save detailed inspection for an explicit command such as `squad stack` / `squad status`.

---

## 6. Build allocation

| Capability | Build in | Why |
|---|---|---|
| Stack resolver, layer descriptors, binding precedence, backend-aware state adapters | **(a) squad-sdk** | This is core resolution/runtime logic and must be reusable by CLI, shell, and any future host. It belongs in the typed resolution layer next to `resolveSquadPaths()`, `multi-squad.ts`, and backend adapters. |
| Commands for binding, inspection, migration, scaffolding (`squad bind`, `squad stack`, `squad squad use`, `squad personal status`) | **(b) squad-cli** | Operators need a way to create and debug bindings. CLI owns human workflows, validation messages, migration helpers, and local file creation. |
| Session-start stack banner, catch-up rendering, stack inspection UI, “why this stack?” explanations | **(c) Rally** | This is presentation/runtime UX. Rally should explain what the resolver decided and why, without owning the resolver itself. |
| Optional org-specific views / overlays / filters for Rally | **(d) Rally mod** | Good place for optional enterprise visualization and org-specific policy display without bloating the core UI. Treat as extension surface, not baseline dependency. |
| Centralized enterprise registry sync / policy publisher | **(e) new tool — only if later needed** | Do **not** build this on day 1. Start with file-based manifests + SDK/CLI. Add a new tool only when a real org-admin workflow appears (for example: publishing org bindings from a service or admin portal). |

### Recommended sequencing

1. **squad-sdk first** — introduce `resolveSquadStack()` + schemas + tests
2. **squad-cli second** — binding/migration/inspection commands
3. **Prompt update third** — coordinator consumes the new stack object
4. **Rally fourth** — polish discoverability and operator trust
5. **New tool last, only if admin scale demands it**

---

## Concrete recommendation

### Day-1 ship target

Ship **file-based layered resolution** with:
- repo-local `layering` block in `.squad/config.json`
- clone-local `.git/squad-binding.json`
- global `squads.json` + `clone-bindings.json`
- personal overlay remaining consult/ghost by default
- one automatic write layer per session
- explicit promotion for team/org decisions

### What not to do yet

- Do **not** let personal agents silently override authoritative agents by name
- Do **not** let multiple Ralphs auto-monitor one stack
- Do **not** auto-promote project decisions into team/org memory
- Do **not** require a new service/tool to make day 1 work

### Why this is the converged path

It extends the existing primitives cleanly:
- current team-root resolution becomes **stack resolution**
- current personal ambient discovery becomes **personal advisory overlay**
- current state backend work becomes **per-layer storage selection**
- current worktree flow remains untouched when layering metadata are absent

That gives Brady the mix-and-match matrix he wants, without turning every session start into an enterprise control-plane exercise.
