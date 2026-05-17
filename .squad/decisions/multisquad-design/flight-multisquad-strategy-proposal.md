### Flight — Multi-Squad Strategy Proposal

**Date:** 2026-05-15T23:06:53-07:00  
**Requested by:** Brady  
**Status:** PROPOSAL

## Executive summary

For org-scale adoption, Squad should standardize on an explicit **source → binding → stack → instance** model:

1. **Squad Source** = the durable, named home of a squad.
2. **Project Binding** = the local pointer that says which source applies in this repo/subdir.
3. **Squad Stack** = ordered overlays (org → team → personal → project/worktree/session).
4. **Squad Instance** = the resolved runtime view for one cwd/session.

The key design choice: **only one squad is primary in a given cwd**, while optional higher-priority overlays may augment it in narrow, well-defined ways. Shared squads provide identity/governance; **project-local state remains local by default**. Reusable learnings move upward only through an explicit promote/extract flow. This keeps org behavior predictable, prevents team/org squad pollution, and fits both Rally's externalized workflow and Tamir's pluggable state-backend direction.

---

## 1) Conceptual model

### Durable nouns

#### Squad
A named operating model: roster, coordinator behavior, routing, charters, reusable skills, and long-lived governance.

A Squad is the human concept. It may be materialized many times.

#### Squad Source
The **authoritative storage location** for one Squad.

A source has:
- `sourceId` (for example `org:foo`, `team:platform`, `personal:brady-d`)
- `kind` (`org`, `team`, `personal`, `project`)
- `location` (filesystem path, repo path, GitHub/ADO/OneDrive URL, etc.)
- `backend` (`local`, `external`, `orphan`, `two-layer`, later remote-backed providers)
- ownership metadata (who may edit it)

This is the durable "home".

#### Project Binding
A repo-root or subdirectory-local declaration that says:
- which Squad Source is primary here
- which overlays also apply
- where mutable state should live
- whether parent/root squads should be inherited or ignored

This is the bridge between a code checkout and a squad source.

#### Resolution Scope
The ordered scopes that can contribute to resolution:
1. **Org**
2. **Team**
3. **Personal**
4. **Project / subdirectory binding**
5. **Worktree / clone**
6. **Session**

Important: scope order is about **precedence**, not about storing everything in all layers.

#### Squad Instance
The resolved runtime view for one **cwd + checkout + session**.

It includes:
- the selected primary source
- any overlays
- the effective authored files seen by the runtime
- the effective write targets for mutable state

This is what `squad` actually runs.

#### Jurisdiction
The rule that says **which layer is authoritative for which artifact class**.

Jurisdiction is not a single winner for everything. It is **per artifact class**:
- identity
- routing
- policies
- mutable runtime state
- reusable learnings

### Model sketch

```text
Squad Source(s)
  org:foo
  team:platform
  personal:brady-d
        │
        │ referenced by
        ▼
Project Binding(s)
  Foo\A  -> org:foo
  Foo\B  -> team:platform + overlay org:foo
  Bar\C  -> team:platform + overlay org:foo
  Baz\D  -> personal:brady-d
        │
        │ resolved for a cwd
        ▼
Squad Stack
  [org, team, personal, project/worktree/session]
        │
        │ materialized into
        ▼
Squad Instance
  effective identity + routing + policies + write targets
```

### Recommended file/config split

- **Global source registry**: user machine-local, for example `~/.config/squad/sources.json` or `%APPDATA%\squad\sources.json`
- **Project binding**: repo/subdir-local `.squad/config.json`
- **Mutable project state**: per binding, defaulting to project-local state backend
- **Shared authored source**: filesystem/external repo/remote provider location

This extends the current model rather than replacing it:
- current **remote mode** already gives us `projectDir` vs `teamDir`
- current **multi-squad** primitives already give us named personal squads
- current **state backends** already separate storage medium from behavior

---

## 2) Layering rules

## 2.1 Resolution order

I recommend a two-phase resolution model.

### Phase A — select the primary squad

For a given cwd:

1. **Nearest project binding wins** (current directory up to repo root)
2. If none exists, use the user's **default personal binding**
3. If none exists, use the **org default** (if provisioned)
4. Otherwise fall back to normal local `squad init` behavior

This is the crucial simplification: **pick exactly one primary squad first**.

### Phase B — apply overlays in fixed order

After primary selection, build the effective stack:

1. **Org baseline**
2. **Team baseline**
3. **Personal overlay**
4. **Project/subdir binding overlay**
5. **Worktree/clone/session overrides**

If a layer is absent, skip it. If a layer is present, it may only affect artifact classes for which it has jurisdiction.

---

## 2.2 Jurisdiction matrix

| Artifact class | Default jurisdiction | Rule | Collaboration allowed? |
|---|---|---|---|
| **Team identity** (`team.md`, coordinator identity, agent names) | **Primary source** | One winner. Nearest binding's primary source owns identity. Lower layers do not silently replace agent names. | Only by explicit alias/extension; no implicit merges on identity collisions. |
| **Routing & charter content** | Primary source, with constrained overlays | Team/project/personal may specialize, but org/team policy blocks are monotonic: lower layers may tighten, not loosen. | Yes, additive when non-conflicting. Conflicts resolve to higher-precedence layer. |
| **Tool/model defaults** | Personal or project overlay unless org policy pins | Personal/project may override defaults, but org policy may deny specific tools/models. | Yes. |
| **Mutable runtime state** (`decisions.md`, inbox, sessions, orchestration logs, histories`) | **Project binding scope** by default | Shared sources are read-only for day-to-day repo-specific state. | No implicit upward writes. |
| **Reusable learnings / skills** | Source owner chosen explicitly by user | Promotion upward is explicit (`extract`, `promote`, or similar), never automatic. | Yes, but only through explicit flow. |

### Why this split matters

For org-scale use, **team/org squads must not become dumping grounds for repo-local noise**. If every project writes decisions, histories, and session logs back into a shared team source, the shared squad becomes unusable.

So the default must be:
- **shared source for identity + reusable guidance**
- **project-local state for active work**
- **explicit promotion** for anything worth upstreaming

That is the same basic discipline that makes Rally consult mode safe.

---

## 2.3 Overlap rules

### A. Multiple squads in the same repo

**Nearest binding wins jurisdiction for that subtree.**

Example:
- `Foo\.squad\config.json` points to `org:foo`
- `Foo\B\.squad\config.json` points to `team:platform`

Inside `Foo\B\...`, the `team:platform` binding is primary.
Inside `Foo\A\...`, the repo-root org binding remains primary.

### B. Root squad + subdirectory squad

The root squad does **not** implicitly co-own the subtree.

If collaboration is desired, the subdirectory binding must say so explicitly by listing the root source as an overlay or consult source.

That gives a clear answer to "who has jurisdiction?":
- **the nearest binding has jurisdiction**
- parents only participate when explicitly declared

### C. One squad across multiple repos/clones/subdirs

Many project bindings may point to the same source.

That source provides shared identity/governance, but each binding still defaults to its own project-local mutable state. This gives shared team behavior without cross-project state bleed.

### D. One squad shared by many users

That is a **shared Squad Source** with:
- shared authored content
- shared ownership/publishing path
- separate per-project instances for runtime state

Use `two-layer` or another merge-safe backend for shared authored state if multiple maintainers will edit the source directly.

---

## 2.4 When do squads collaborate vs. when must one win?

### They may collaborate when:
- the artifact class is additive (skills, policy constraints, tool allow/deny lists, model defaults)
- collaboration is explicit in the Project Binding
- the lower layer is not trying to rename or replace the primary squad identity
- learnings move via explicit promotion/extract flow

### One must win when:
- choosing the coordinator/team identity
- choosing agent canonical names
- choosing the routing owner for a cwd
- choosing the write target for mutable runtime state
- parent and child bindings both claim the same subtree without explicit overlay declaration

In short:
- **identity and write targets require a single authority**
- **guidance and policy may layer**

---

## 3) Build allocation

Below is the smallest surface area I think earns its keep.

### A. squad-sdk modification

| Capability | Why SDK owns it |
|---|---|
| `resolveSquadStack(startDir): ResolvedSquadStack` | Resolution is core runtime behavior and must be shared by CLI, Rally, shell, tests, and future tools. |
| `resolvePrimaryBinding(startDir)` and nearest-binding walk-up rules | Jurisdiction cannot live only in the CLI; runtime and tests need the same truth. |
| `classifyJurisdiction(stack, artifactClass)` | Artifact-class ownership must be deterministic and reusable. |
| Extend current `resolveSquadPaths()` to support **binding + overlays**, not just local vs remote | This is the natural evolution of today's dual-root model. |
| `SourceProvider` abstraction for source media (`file`, later `github`, `ado`, `onedrive`) | Media/location is a storage concern; the SDK should hide transport details behind one provider contract. |
| `resolveWritableStateTarget(stack)` | Prevent shared team/org sources from accidentally receiving repo-local session noise. |
| `promoteLearnings(fromInstance, toSource)` helper | Promotion rules must be consistent across CLI and Rally. |

**Specific recommendation:** add one top-level SDK entry point:

```ts
resolveSquadStack(startDir): {
  primary: SquadSourceRef;
  overlays: SquadSourceRef[];
  projectBinding: ProjectBinding | null;
  jurisdiction: JurisdictionMap;
  writableStateTarget: WritableTarget;
}
```

That becomes the stable contract everything else uses.

---

### B. squad-cli modification

| Capability | Why CLI owns it |
|---|---|
| `squad source create <name>` | Users need a friendly way to create named personal/shared sources without hand-editing files. |
| `squad source add <name> --path <path> --kind <org|team|personal>` | Register existing shared sources on a machine. |
| `squad source list` | Needed to make source selection visible and debuggable. |
| `squad bind set --source <name> [--overlay <name> ...]` | Binding a repo/subdir to a source is operator workflow, not SDK plumbing. |
| `squad bind show` / `squad status --explain` | Resolution must be explainable, especially in overlapping repo/subdir cases. |
| Extend `squad init --global` with `--name <name>` | Reuse current personal-squad flow instead of inventing a second bootstrap path. |
| Extend current `init --mode remote` to write the richer binding schema | Reuses today's mental model and preserves backward compatibility. |

**Headline:** the CLI should expose **source registry + binding commands**, not invent a second runtime.

---

### C. Rally as-is

| Capability | Why Rally already fits |
|---|---|
| Consult-mode workflow for non-committable/shared repos | This is already Rally's sweet spot. |
| Worktree dispatch and `.worktrees/` placement | Rally already solves the operational side of shared-repo execution. |
| Symlink / consult-style externalization patterns | Useful when the repo must remain clean. |
| Human-reviewed promotion/extraction discipline | Rally already reinforces "analyze locally, publish intentionally." |

**Recommendation:** keep Rally as the sanctioned external operator shell. Do not absorb Rally's dashboard/onboarding/session-bookkeeping into Squad core.

---

### D. Rally modification

| Capability | Why Rally needs a small change |
|---|---|
| Read `resolveSquadStack()` instead of assuming one remote/personal squad per checkout | Rally should honor the same binding/jurisdiction rules as Squad core. |
| Support subdirectory bindings during onboard/dispatch | A shared repo may have different squad bindings for different subtrees. Rally should not flatten that away. |
| Optional `rally onboard --source <name>` convenience | Lets Rally reuse the same registered Squad Sources instead of asking users for raw paths repeatedly. |

This is deliberately small. Rally should consume the SDK's resolution model, not invent its own variant.

---

### E. NEW standalone tool

**Not earned for day 1.**

I do **not** recommend a new standalone tool for the first cut.

If later we need enterprise-only synchronization or source publication workflows (for example GitHub/ADO/OneDrive mirroring with approvals), that can be revisited. But day 1 should land as:
- SDK resolution/provider work
- CLI registry/binding commands
- small Rally adoption of the SDK contract

That is enough.

---

## 4) Day-1 walkthrough

Below is the concrete end-to-end flow I recommend for the new developer scenario.

## Assumptions

- Org IT already published two shared Squad Sources:
  - `foo-org` at `C:\Squads\foo-org`
  - `foo-team` at `C:\Squads\foo-team`
- The new CLI surfaces exist:
  - `squad source create|add|list`
  - `squad bind set|show`
  - `squad status --explain`
- Shared sources use a merge-safe backend (recommended: `two-layer`)

---

## Step 1 — bootstrap personal source registry

```powershell
squad source add foo-org --kind org --path C:\Squads\foo-org
squad source add foo-team --kind team --path C:\Squads\foo-team
squad source create brady-d --kind personal --backend local
```

Resulting user-local registry (conceptually):

**`%APPDATA%\squad\sources.json`**

```json
{
  "version": 1,
  "sources": {
    "foo-org": {
      "kind": "org",
      "path": "C:\\Squads\\foo-org"
    },
    "foo-team": {
      "kind": "team",
      "path": "C:\\Squads\\foo-team"
    },
    "brady-d": {
      "kind": "personal",
      "path": "%APPDATA%\\squad\\squads\\brady-d",
      "backend": "local"
    }
  }
}
```

---

## Step 2 — bind project A to the org squad

```powershell
cd D:\src\Foo\A
squad bind set --source foo-org --state-scope project
squad status --explain
```

Generated binding:

**`D:\src\Foo\A\.squad\config.json`**

```json
{
  "version": 2,
  "source": "foo-org",
  "overlays": [],
  "stateScope": "project"
}
```

Meaning: project A falls back to the org-wide squad.

---

## Step 3 — bind project B to the team squad, with org baseline

```powershell
cd D:\src\Foo\B
squad bind set --source foo-team --overlay foo-org --state-scope project
squad status --explain
```

Generated binding:

**`D:\src\Foo\B\.squad\config.json`**

```json
{
  "version": 2,
  "source": "foo-team",
  "overlays": ["foo-org"],
  "stateScope": "project"
}
```

Meaning: B uses the team squad as primary, with org policy/baseline layered underneath.

---

## Step 4 — bind project C to the same team squad

```powershell
cd D:\src\Bar\C
squad bind set --source foo-team --overlay foo-org --state-scope project
squad status --explain
```

Generated binding:

**`D:\src\Bar\C\.squad\config.json`**

```json
{
  "version": 2,
  "source": "foo-team",
  "overlays": ["foo-org"],
  "stateScope": "project"
}
```

Meaning: B and C share one team identity/governance source across different repos, but keep active repo state local.

---

## Step 5 — bind project D to the developer's personal squad

```powershell
cd D:\src\Baz\D
squad bind set --source brady-d --state-scope project
squad status --explain
```

Generated binding:

**`D:\src\Baz\D\.squad\config.json`**

```json
{
  "version": 2,
  "source": "brady-d",
  "overlays": [],
  "stateScope": "project"
}
```

Meaning: D uses the developer's own personal squad.

---

## Step 6 — optional shared-repo / non-committable variant

If one of these repos is not allowed to carry `.squad/` state in-tree, use Rally for the execution path while keeping the same source model:

```powershell
rally onboard D:\src\Foo --source foo-team
rally dispatch issue 123
```

Rally should read the same source registry / binding rules via `resolveSquadStack()`, then run consult/external mode without repo pollution.

---

## Why this walkthrough is the right day-1 shape

It satisfies the concrete scenario exactly:
- **A** → org squad
- **B + C** → same team squad across multiple repos
- **D** → personal squad
- one user can have multiple squads
- shared sources are reusable across clones and repos
- storage location is decoupled from project binding

And it does so with **two concepts the developer can actually understand**:
- register sources
- bind projects to sources

That is simpler than asking users to reason directly about backends, worktree inheritance, or raw path pointers.

---

## 5) Risks & open questions

## Top 3 design risks

### 1. Silent layering ambiguity
If we allow too much implicit merging, users will not know which team they are actually running. This is especially dangerous for agent identity and routing.

**Mitigation:**
- choose one primary squad first
- keep overlay behavior narrow and explicit
- make `squad status --explain` mandatory-grade UX

### 2. Shared-squad pollution
If repo-specific state writes back into team/org sources by default, shared squads will become noisy, conflict-heavy, and eventually abandoned.

**Mitigation:**
- default mutable runtime state to the project binding scope
- require explicit promotion for reusable learnings
- use merge-safe shared backends (`two-layer`) only for truly shared authored state

### 3. Remote media complexity outrunning the model
GitHub, ADO, OneDrive, and local filesystem all have different auth/sync/offline semantics. If we design around every medium at once, day 1 will sprawl.

**Mitigation:**
- stabilize the SDK's `SourceProvider` contract first
- ship filesystem/external repo sources first
- add GitHub/ADO/OneDrive providers later behind the same contract

---

## Top 3 questions Brady should decide

### 1. Should personal overlays be automatic everywhere, or only when explicitly named?
My recommendation: **explicit by default** for org-scale determinism. Automatic personal overlays are friendlier for solo users but introduce hidden behavior in shared-team environments.

### 2. Should shared team/org sources ever be writable runtime targets?
My recommendation: **no by default**. Shared sources should hold authored identity/governance/reusable memory; active project state should remain local unless a team explicitly opts into shared mutable state.

### 3. What is the real day-1 media scope?
My recommendation: **filesystem + repo/external paths first**, with GitHub/ADO/OneDrive deferred behind provider interfaces. The conceptual model should account for them now, but the first shipped implementation should not depend on all three.

---

## Recommended headline decision

If Brady wants the smallest strategy that scales to org use without painting Squad into a corner, I recommend this exact stance:

> **Adopt an explicit Source + Binding + Stack model.**
> 
> - One primary squad per cwd.
> - Nearest binding wins.
> - Org/team/personal may layer only where jurisdiction allows.
> - Project state stays local by default.
> - Shared learnings move upward only by explicit promotion.
> - Rally remains the external/shared-repo operator shell, consuming the same SDK resolution contract.

This gives Squad one coherent answer across all six dimensions without turning the runtime into a magical merge engine.