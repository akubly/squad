### Flight — Multi-Squad Strategy: Converged (Round 2)

**Date:** 2026-05-15T23:06:53-07:00  
**Requested by:** Brady  
**Status:** CANONICAL STRATEGY FOR DOWNSTREAM WORK

## 1) Executive summary

- Standardize on **Source + Binding + Stack + Active Write Layer**. One authoritative squad wins per cwd; other layers are explicit fallbacks or advisory overlays.
- Put **shared source registration, immutable cache, locks, and personal squads under `~/.squad/` / `%USERPROFILE%\.squad\`**. Keep **repo/subdir bindings in repo space** and **clone overrides in `.git/`**.
- Make **personal squads advisory by default** in shared contexts. Personal agents travel everywhere, but they do not silently take governance authority.
- Keep **mutable project/team/org state single-writer by default**. Cross-squad writes are denied unless the owner grants **inbox-only, append-only, time-bounded** access.
- Ship this in **SDK + CLI first**, let **Rally consume the same resolver**, and **do not create a new v1 tool**.

## 2) The model

### Agreed nouns

- **Squad** — the human operating model: roster, routing, charters, skills, decisions, governance.
- **Source** — the authoritative home of a shareable squad. A source has a stable `sourceId`, provenance, transport, and a materializable `.squad/` tree.
- **Binding** — the repo-root or subdirectory declaration that says which source is primary here, which fallbacks apply, whether personal is allowed, and where writable state goes.
- **Layer** — one source participating in resolution for the current cwd.
- **Stack** — the ordered list of layers visible to one cwd/session.
- **Active write layer** — the single authoritative layer that receives automatic writes for shared squad state in this session.
- **Instance** — the resolved runtime view of the stack for one cwd/worktree/session.
- **Promotion** — the explicit act of moving reusable learnings upward from a narrower layer to a broader one.

### Required shape for shared sources

For any **shareable** team/org/personal source, require a source manifest with a stable logical ID. Legacy in-repo `.squad/` trees without a manifest still work as local project layers, but the CLI should generate/attach a source ID when they are promoted into reusable shared sources.

### Runtime resolution diagram

```text
Current cwd
   |
   v
Find strongest binding declaration
   1. session/CLI override (future)
   2. .git/squad-binding.json
   3. nearest .squad/config.json binding block (cwd -> repo root)
   4. user/org registry defaults in ~/.squad
   5. legacy single-squad resolution
   |
   v
Select exactly one PRIMARY authoritative source
   |
   v
Expand explicit fallbacks
   project/local -> team -> org
Append personal advisory overlay if allowed
   |
   v
Materialize pinned source snapshots from ~/.squad/cache
   |
   v
Resolve by file class
   - identity/routing: nearest authoritative layer
   - mutable squad state: ACTIVE WRITE LAYER
   - foreign writes: owner inbox only, if granted
   |
   v
Squad Instance
```

## 3) Layering & jurisdiction rules

### Final resolution rules

1. **One primary authoritative squad per cwd.** Do not merge multiple authorities for identity or automatic writes.
2. **Nearest binding wins the subtree.** A child binding overrides a parent binding for that subtree.
3. **Binding precedence is fixed:** session override (future) → clone-local `.git/squad-binding.json` → nearest committed `.squad/config.json` binding block → user/org registry default → legacy single-squad fallback.
4. **Fallback expansion order is fixed:** project/local source (if primary) → team fallback(s) → org fallback(s) → personal advisory overlay.
5. **Personal is consult-first.** In shared contexts, personal is visible and explicitly addressable, but it is not an unqualified governance winner.
6. **One active write layer per session.** Automatic writes to `decisions.md`, histories, orchestration logs, inbox bookkeeping, and similar squad state go to exactly one layer.
7. **Promotion is explicit.** Project learnings do not drift upward automatically into team/org memory.

### Write authority by file class

| File / artifact class | Default authority | Final rule |
|---|---|---|
| `team.md`, coordinator identity, canonical agent names | Primary authoritative source | Single winner. No silent identity merge. |
| `routing.md`, agent charters, reusable skills, policy bundles | Primary authoritative source with constrained fallbacks | Narrower layers may specialize; broader org policy may constrain; lower layers may tighten policy but not loosen org denies. |
| `decisions.md`, `agents/*/history.md`, `log/**`, orchestration/session state | Active write layer only | Automatic writes go to one layer only. |
| Personal notes / personal consult breadcrumbs | Personal layer only | Personal can write its own namespace; not shared governance files. |
| Product code in the repo | User's repo rights | Any participating squad may help edit product code as the signed-in user, but that does not grant shared squad-governance write power. |
| Reusable learnings promoted upward | Destination owner | Must go through explicit promote/extract flow. |

### Cross-squad collaboration semantics

- **Unqualified agent names resolve to the nearest authoritative layer.** If both team and personal provide `Procedures`, `Procedures` means the team one; `personal/Procedures` means the personal one.
- **Only one active Ralph** may monitor/dispatch for an authoritative stack. Personal Ralph may observe only if explicitly granted; never dispatch by default.
- **Foreign writes are denied by default.** If Squad X needs to contribute to Squad Y's shared state, Y must grant it.
- **The only safe default foreign write target is an owner inbox** (for example `decisions/inbox/`), not canonical files.
- **Grants must be owner-side, path-scoped, append-only, time-bounded, and recorded** with source squad ID and grant ID.

## 4) Storage & transport matrix

| Medium | Source transport | Supported backend(s) after materialization | Recommended default |
|---|---|---|---|
| In-repo `.squad/` | implicit local/path | `worktree`, `git-notes`, `orphan`, `two-layer` | **`worktree`** for repo-local project state |
| Other repo checkout on disk | `path` or `git` | `external`, `two-layer` | **`two-layer`** for shared writable team sources |
| GitHub repo | `git` or release bundle | `external`, `two-layer` | **`external` cached snapshot** by default; use `two-layer` only when the team intentionally maintains the shared source there |
| ADO repo | `git` | `external`, `two-layer` | **`external` cached snapshot** by default |
| OneDrive / SharePoint synced folder | `onedrive-path` / `path` | `external` | **`external`** read-mostly snapshot |
| Plain filesystem folder (non-repo) | `path` | `external`, `two-layer` | **`external`** for personal/local shared folders |
| npm package | `npm` | `external` | **`external`** pinned package snapshot |
| HTTP bundle / URL | `http` | `external` | **`external`** pinned read-only snapshot |

### Recommended defaults by scope

- **Project-local work:** in-repo `.squad/` with `worktree`
- **Shared team source:** git-backed source with `two-layer` only when the team intentionally edits the shared authored layer; otherwise consume as cached `external`
- **Org fallback:** immutable cached `external` source, auto-updated by policy
- **Personal source:** local path-backed source in `%USERPROFILE%\.squad\personal\squads\<name>` using `local/external` semantics, manual by default

## 5) Build allocation — canonical table

| Capability | Canonical owner |
|---|---|
| Source manifest schema, source ID rules, legacy-source normalization | **squad-sdk** |
| `resolveSquadStack()` and binding precedence resolution | **squad-sdk** |
| Jurisdiction classifier and active-write-layer selection | **squad-sdk** |
| Transport adapters (`path`, `git`, `npm`, `http`, `onedrive-path`) | **squad-sdk** |
| Immutable cache layout, lockfiles, pinning, rollback pointers, update-policy evaluation | **squad-sdk** |
| Trust verification, ACL evaluation, destination-class enforcement hooks | **squad-sdk** |
| Promotion/extract helpers for moving learnings upward | **squad-sdk** |
| Machine registry, source add/create/remove/list/set commands | **squad-cli** |
| Binding commands (`bind set/show/list`, migration helpers) | **squad-cli** |
| Bootstrap import, first-run onboarding, trust/status/explain UX | **squad-cli** |
| Local diagnostics (`status`, `doctor`, freeze/pin/update commands) | **squad-cli** |
| Existing consult-mode workflow, worktree dispatch, repo-clean external execution path | **Rally (existing)** |
| Read the SDK stack resolver instead of assuming one squad, honor subdirectory bindings, apply trust downgrades in consult mode | **Rally (modification)** |
| Optional cross-repo/source-health dashboard over the CLI/SDK registry | **Rally (modification)** |
| Org-admin publishing/signing utility for bootstrap manifests (future only, not v1) | **new tool** |

### Final allocation choice

- **SDK is the source of truth** for resolution, transport, policy, and security.
- **CLI is the operator surface** for setup, explainability, trust, and updates.
- **Rally stays an operator shell**, not the owner of source semantics.
- **No new end-user tool in v1.** A new tool is only justified later for admin-side publishing/signing if Brady wants it.

## 6) Security & trust posture

### Defaults

1. **Verified org/team sources load silently.**
2. **Unverified external sources load read-only until approved.**
3. **Personal sources load normally, but shared-governance writes are blocked by default.**
4. **Cross-squad writes are deny-by-default.**
5. **Shared append-only files are sanitized collaboration records, not transcript dumps.** Block secrets, tokens, emails, private share links, auth artifacts, and ambient identity harvesting.
6. **Enforcement lives in hooks / ACL evaluation in code, not in prompts.**

### Override mechanism

Use one narrow override path only:

- The **owner layer** grants access.
- The grant is **path-scoped** (normally inbox-only), **append-only**, **time-bounded**, and **recorded**.
- The grant never upgrades a foreign squad into an identity/routing authority.
- Canonical shared files (`team.md`, `routing.md`, charters, ACLs, canonical `decisions.md`) are not foreign-write targets in normal operation.

### Org auto-deploy boundary

**Recommended org deployment:** managed Squad CLI install + machine bootstrap manifest.

The org **may** automatically:
- install/update Squad CLI and SDK,
- import/update verified org source declarations,
- refresh immutable cached org artifacts,
- apply policy metadata that does not widen permissions silently.

The org **must not** silently:
- overwrite repo-owned `.squad/` state,
- rewrite team-owned local overlays,
- widen write authority without surfacing the change,
- auto-enable new external connectors inside existing repos without notice.

## 7) Onboarding UX contract

### The developer MUST do

- Install or receive the Squad CLI.
- Authenticate only when a private source actually requires it.
- Register any non-bootstrap team/personal sources they intend to use.
- Bind each project or subdirectory to the desired primary source and fallback chain.

### The developer MUST NOT have to do

- Manually clone org/team squad repos just to consume them.
- Hand-edit JSON to make day 1 work.
- Understand backend internals before they can bind a project.
- Set up symlinks.
- Re-register the same org source per repo.
- Re-answer trust prompts for already-verified org/team sources on every run.

### UX contract

- First run should explain **what stack is active here** in one short banner.
- Detailed reasoning belongs behind explicit inspection (`status --explain`, trust/status views).
- The common case is silent: verified sources + same-boundary work should not prompt.

## 8) Day-1 walkthrough — canonical version

### Assumptions

- IT already installed Squad and imported an org bootstrap that registered **`foo-org`** as the org fallback source.
- The new developer needs to add two team sources and one personal source.
- Commands marked **`[NEW]`** are part of this converged strategy and do not exist yet.

### 0. Confirm machine state

```powershell
[NEW] squad status --sources
```

Expected: `foo-org` is already present from bootstrap import.

### 1. Register shared team sources and personal source

```powershell
[NEW] squad source add --name foo-team --scope team --transport git --locator https://github.com/foo/foo-team-squad.git --track refs/heads/main
[NEW] squad source add --name bar-team --scope team --transport git --locator https://github.com/bar/bar-team-squad.git --track refs/heads/main
[NEW] squad source create --name baz-personal --scope personal --backend local
```

If a source is private, authenticate only when prompted (for example `gh auth login`).

### 2. Project A — Foo, org-wide fallback

```powershell
Set-Location D:\src\Foo\A
[NEW] squad bind set --primary foo-org --state-scope project
[NEW] squad status --explain
```

### 3. Project B — Foo, team squad with org fallback

```powershell
Set-Location D:\src\Foo\B
[NEW] squad bind set --primary foo-team --fallback foo-org --state-scope project
[NEW] squad status --explain
```

### 4. Project C — Bar standalone, team squad

```powershell
Set-Location D:\src\Bar\C
[NEW] squad bind set --primary bar-team --state-scope project
[NEW] squad status --explain
```

### 5. Project D — Baz personal

```powershell
Set-Location D:\src\Baz\D
[NEW] squad bind set --primary baz-personal --state-scope project
[NEW] squad status --explain
```

### 6. What the runtime resolves

- **A** → `foo-org` authoritative; personal advisory overlay allowed by default unless disabled.
- **B** → `foo-team` authoritative, `foo-org` fallback, personal advisory overlay.
- **C** → `bar-team` authoritative, no org fallback unless added later, personal advisory overlay.
- **D** → `baz-personal` authoritative because no broader binding applies.

## 9) Conflicts resolved

1. **Personal precedence conflict**  
   - **Conflict:** Procedures/Flight treated personal as advisory; Network's draft wording implied personal could outrank shared layers.  
   - **Decision:** personal is **advisory by default** and never silently outranks project/team/org governance.  
   - **Why:** this preserves shared authority, matches Ghost Protocol, and avoids invisible behavior changes in org repos.

2. **Registry/store split vs one home directory**  
   - **Conflict:** Flight described `%APPDATA%` registries plus project-local bindings; Network argued for a Rally-style unified home.  
   - **Decision:** use **one user-home store** (`~/.squad/` / `%USERPROFILE%\\.squad\\`) for registry, cache, locks, bootstrap imports, and personal squads, while keeping repo/subdir bindings in repo space.  
   - **Why:** one mental model beats multiple hidden stores; it also matches Rally's proven operator pattern.

3. **Manifest required everywhere vs backward compatibility**  
   - **Conflict:** EECOM wanted a manifest-backed source identity; Procedures/Flight prioritized compatibility with existing local `.squad/` trees.  
   - **Decision:** **shared sources require a manifest/source ID; legacy repo-local squads remain valid as project layers** until promoted/shared.  
   - **Why:** stable identity is required for dedupe, pinning, and transport, but breaking existing local repos is unnecessary.

4. **Where explain/status UX belongs**  
   - **Conflict:** Procedures pushed stack explanation toward Rally UX; Network pushed CLI-first visibility.  
   - **Decision:** **CLI owns local explainability**; Rally consumes and renders the same resolver output when running consult mode.  
   - **Why:** every user needs local answers; Rally is optional and should not become the only place the model is understandable.

5. **Need for a new tool**  
   - **Conflict:** all five proposals were skeptical, but EECOM and Network left room for future enterprise tooling.  
   - **Decision:** **no v1 new tool**. Reserve that slot only for a future admin-side manifest publisher/signing utility if real org operations demand it.  
   - **Why:** the day-1 problem is fully solved by SDK + CLI + small Rally changes.

## 10) Open questions for Brady

1. **Enterprise default:** Is managed install + bootstrap manifest the official org rollout story we should optimize first?
2. **Verification bar:** For org auto-update, is a trusted protected repo enough, or do you want signed tags/releases to be the required bar for verified status?
3. **Team writability on day 1:** Should direct writable team sources ship in phase 1, or should phase 1 keep team sources read-mostly with promote/extract as the default collaboration path?
4. **Manifest enforcement timing:** Do you want manifest/source-ID enforcement immediately for all newly shared sources, or only after a migration window?
5. **Required org layers:** May org bootstrap declare non-removable required layers (for example security policy), or must every layer remain user-removable at bind time?

## 11) Phased delivery sketch

### Phase 1 — MVP that unblocks the day-1 scenario

Ship the minimum to make A/B/C/D work:
- SDK: `resolveSquadStack()`, source manifest/source ID support, active-write-layer selection, path/git transports, trust metadata, lockfile basics
- CLI: `source add/create/list`, `bind set/show`, `status --explain`, bootstrap import
- Security: deny cross-squad writes by default, personal advisory overlay, destination-class write enforcement
- Storage: unified `~/.squad/` registry/cache/personal home

### Phase 2 — Hardening and broader transport support

- Additional transports: ADO, npm, HTTP, OneDrive-path
- Freeze/pin/update policy controls and rollback pointers
- Explicit promote/extract UX
- Rally modification: consume stack resolver, honor subdirectory bindings, surface trust/state in consult mode

### Phase 3 — Scale polish, not v1 blockers

- Optional org-admin publisher/signing tool if Brady wants fleet-managed manifests
- Ring/channel rollout UX for org/team sources
- Cross-repo/source-health dashboards
- More opinionated org policy tooling once real operators demand it

## Recommendation in one sentence

Adopt a **single-primary, layered-stack model** with **immutable shared sources**, **repo-local bindings**, **personal advisory overlays**, **SDK-owned policy/security**, **CLI-owned setup/explainability**, and **Rally as the external execution shell that consumes the same contract**.
