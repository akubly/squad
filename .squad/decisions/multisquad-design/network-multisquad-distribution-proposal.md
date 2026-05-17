### Network — Multi-Squad Distribution Proposal

**Author:** Network  
**Requested by:** Brady  
**Date:** 2026-05-15T23:06:53-07:00

## Executive summary

Recommend a **Rally-style central store in `~/.squad/`**, with the **Squad CLI** as the operator surface and the **SDK** owning transport, pinning, cache resolution, and binding logic.

For org-scale deployment, pick **one primary channel**: **MDM-installed Squad CLI + an org bootstrap manifest** dropped onto the machine at install time. On first run, the CLI imports that manifest, registers org sources, and keeps them synced by policy. That gives the org a one-time deployment path, while still preserving offline-first personal squads and non-org use.

The model is:

1. **Source** — where a squad comes from (git, npm, HTTP bundle, OneDrive path, etc.)
2. **Resolved artifact** — immutable cached copy pinned to a commit/version/hash
3. **Binding** — which projects/repo clones consume which sources, in what precedence order
4. **Policy** — who is allowed to auto-update each layer (personal, team, org)

This reuses two proven ideas:

- **Rally**: one familiar user-home store (`~/rally` → here `~/.squad/`)
- **Tamir upstream-auto-sync**: sources can auto-refresh into a local materialized cache instead of asking every repo to manage clones manually

---

## Design principles

1. **One-time org deployment** — after IT deploys the CLI and org bootstrap, the user should not have to hand-wire org squads.
2. **Offline-first personal use** — a solo dev with no org backend still gets full value from local/path/git sources.
3. **Immutable cache, mutable bindings** — never "live-edit" installed sources; resolve them to pinned snapshots and switch bindings.
4. **Separate transport from resolution** — source adapters fetch; SDK resolves final layered squad view.
5. **Team/org layers should feel like package management** — channels, pins, lock metadata, update cadence, rollback.
6. **Reuse `~/.squad/` as the single mental model** — no second hidden system unless v2 proves it is required.

---

## 1) Squad transport by source medium

### Source model

Each source entry should have:

```json
{
  "name": "org-core",
  "scope": "org",
  "transport": "git",
  "locator": "git@github.com:acme/squad-org-core.git",
  "track": "refs/tags/v1",
  "policy": "auto",
  "resolved": {
    "version": "v1.4.2",
    "revision": "9f2c1ab...",
    "integrity": "sha256-...",
    "resolvedAt": "2026-05-15T23:06:53-07:00"
  }
}
```

The key rule: **bindings point at a logical source name; lock metadata points at the exact resolved artifact**.

### Transport table

| Source medium | Install / sync mechanism | Cached form in `~/.squad/` | Version pin / lock rule |
|---|---|---|---|
| **Git repo (GitHub or generic Git)** | `git clone --filter=blob:none` on first install, then `git fetch --tags --prune` + checkout/export of pinned ref | Immutable snapshot keyed by commit SHA; optional bare/mirror cache plus materialized tree | **Commit SHA** is the true lock. User may track branch/tag, but lockfile records resolved SHA + remote URL + ref + fetched time |
| **GitHub release tarball** | Download release asset/archive, verify checksum if published, unpack into cache | Extracted immutable directory keyed by tag + asset + SHA256 | **Release tag + asset name + SHA256** |
| **ADO repo** | Same as git transport using Azure Repos URL/credential helper; no separate model needed beyond auth UX | Immutable snapshot keyed by commit SHA | **Commit SHA**; record collection/project/repo URL + ref |
| **OneDrive folder** | Prefer local synced path via OneDrive client / Files On-Demand; CLI reads from resolved local folder and snapshots it | Read-only snapshot keyed by OneDrive item id + eTag | **Drive item id + eTag** (not local mtime) |
| **npm package** | Resolve exact package version from configured registry, `npm pack`, unpack tarball to cache | Extracted immutable package contents keyed by package name + exact version + integrity | **Exact semver version + npm integrity hash** |
| **Plain HTTP URL** | GET manifest/bundle, use `ETag` / `Last-Modified`, verify optional detached checksum | Extracted or copied snapshot keyed by URL + ETag/SHA256 | **URL + ETag (or SHA256 when provided)** |

### Notes per medium

#### Git repo / ADO repo

- Best source for **live team squads** and **org-owned read-only squads**.
- Reuse existing upstream behavior, but move clones/materializations into the **central store**, not repo-local `.squad/_upstream_repos/` for multi-project reuse.
- The lock always records the exact commit SHA even when the source tracks `main`, `dev`, or `release/v1`.

#### GitHub release tarball

- Best for **org-approved, immutable bundles** where the org wants a signed artifact instead of a live repo.
- Good fit for controlled rollout rings because releases map naturally to stable/canary channels.

#### OneDrive folder

- Best for teams already distributing internal docs/templates through SharePoint/OneDrive.
- Should not be the primary org mechanism, but is a valid adapter.
- Treat it as a **sync source**, not a mutable working directory. Snapshot locally, then resolve from the snapshot.

#### npm package

- Best for **blessed org/team squad bundles** that need semver, integrity, dist-tags, and controlled rollout.
- Package payload should be a squad bundle, not executable logic.
- Strongest packaging story for reproducible org/team releases.

#### Plain HTTP URL

- Best as a lowest-common-denominator import path.
- Require an explicit checksum or strong caching metadata for org/team usage.
- Fine for public/open-source squad bundles and partner-distributed read-only squads.

### Lockfile recommendation

Use a **machine-local source lock** rather than per-repo lock for shared sources:

- `~/.squad/registry-v2.json` — source declarations + bindings + policy
- `~/.squad/locks/sources.lock.json` — resolved revisions, integrity, last sync, rollback pointer

Per-project bindings may additionally pin a source override in:

- `<repo>\.squad\bindings.json`

That keeps the reusable fetch/cache layer global while allowing repo-local override semantics.

---

## 2) Org auto-deploy — recommend one primary mechanism

## Recommendation: **MDM-installed Squad CLI + org bootstrap manifest**

### What IT deploys once

1. **Squad CLI** installed through the org's managed software channel (Intune/Jamf/Corp installer/MSI/pkg)
2. A machine-level bootstrap file, for example:
   - `C:\ProgramData\Squad\org-bootstrap.json`
   - `/Library/Application Support/Squad/org-bootstrap.json`
   - `/etc/squad/org-bootstrap.json`
3. Optional managed settings for update cadence and allowed registries

### What happens on first run

`Squad` detects the bootstrap manifest and automatically:

- initializes `~/.squad/` if missing
- registers org sources
- hydrates the org cache
- creates default org bindings/rings
- marks the bootstrap as imported

### Why this is the primary mechanism

It best satisfies the constraint **"deploy once and have it Just Work"**:

- **No per-dev Node/global-package ceremony** beyond getting the CLI onto the machine
- **Works even if the user never manually runs source-add commands for org squads**
- **Supports multiple source media behind one bootstrap contract**
- **Lets IT own the root of trust** without forcing every org squad to be an npm package
- **Still coexists with offline personal squads** because the bootstrap only adds org defaults; it does not replace local/path usage

### Why not the other options as primary

- **Internal npm install alone**: good for delivering the CLI, weak for auto-registering org sources unless coupled to another mechanism.
- **ADO pipeline writing directly into user home**: operationally brittle, platform-specific, and hostile to laptops that are offline/VPN-late.
- **Rally-only central store**: good pattern, wrong owner for Squad source semantics. Rally can visualize; Squad should own install/bind/update.

### Bootstrap manifest shape

```json
{
  "org": "acme",
  "version": 1,
  "sources": [
    {
      "name": "acme-org-core",
      "scope": "org",
      "transport": "npm",
      "locator": "@acme/squad-org-core",
      "track": "stable",
      "policy": "auto"
    },
    {
      "name": "acme-security",
      "scope": "org",
      "transport": "git",
      "locator": "https://dev.azure.com/acme/devex/_git/squad-security",
      "track": "refs/heads/main",
      "policy": "auto"
    }
  ],
  "defaultBindings": {
    "fallback": ["acme-org-core"],
    "required": ["acme-security"]
  }
}
```

---

## 3) Update model

## Default policy by layer

| Layer | Default owner | Default behavior | Recommended cadence | Override interface |
|---|---|---|---|---|
| **Personal** | User | **Manual only** | On demand | `squad update <source>`, `squad pin`, `squad unpin` |
| **Team** | Team leads / maintainers | **Notify + scheduled pull** | Daily check, explicit apply by default; emergency push allowed | `squad source set --policy notify|auto`, `squad update --scope team`, repo binding freeze |
| **Org** | Org platform owner | **Auto-update stable ring** | Daily check, staged rollout, 7-day opt-out/freeze window | `squad freeze <source> --until ...`, `squad channel set`, admin manifest |

## Recommended behavior

### Personal squads

- Default to **manual**.
- Never auto-advance a personal source unless the user explicitly opts in.
- Offline/local path sources remain first-class.

### Team squads

- Default to **team-controlled, user-applied**: the team publishes, users are notified, CLI pulls metadata daily, but materialization/binding change happens on `squad update` or repo entry if the user opted into auto.
- Allow team owners to mark a release **required** for breaking governance/security fixes.
- Support "promote release N to stable" instead of "everyone tracks branch head forever."

### Org squads

- Default to **auto-update on stable channel**.
- Roll out by ring: `canary` → `pilot` → `stable`.
- Give users a **temporary opt-out/freeze window** (for example 7 days) per source or per project binding.
- Expired freezes surface warnings in `squad status` and on session start.

## Override interface

### CLI

```bash
squad source set acme-org-core --channel stable --policy auto
squad pin team-foo --to 9f2c1ab
squad freeze acme-org-core --until 2026-05-22
squad unfreeze acme-org-core
squad update --scope org
squad update --scope team --source network-platform
```

### Binding-level config

`<repo>\.squad\bindings.json`

```json
{
  "layers": [
    { "name": "team-foo", "mode": "primary" },
    { "name": "acme-org-core", "mode": "fallback" }
  ],
  "overrides": {
    "team-foo": { "pin": "9f2c1ab" },
    "acme-org-core": { "freezeUntil": "2026-05-22T00:00:00Z" }
  }
}
```

---

## 4) Central store layout (v2)

Recommend **one Rally-like home** rooted at `~/.squad/`.

```text
~/.squad/
├── registry-v2.json                 # authoritative local registry + policy + imported org bootstrap refs
├── locks/
│   └── sources.lock.json            # resolved revision/version/hash per source
├── cache/
│   ├── git/
│   │   └── <source-id>/<commit-sha>/
│   ├── npm/
│   │   └── <package>/<version>/
│   ├── releases/
│   │   └── <source-id>/<tag>/
│   ├── http/
│   │   └── <source-id>/<etag-or-sha>/
│   └── onedrive/
│       └── <source-id>/<etag>/
├── orgs/
│   └── <org>/
│       ├── bootstrap.json           # imported machine/org manifest
│       ├── policy.json              # org rollout policy, allowed channels, defaults
│       ├── bindings.json            # org default/fallback bindings
│       └── state.json               # import/update bookkeeping
├── teams/
│   └── <team>/
│       ├── sources.json             # team-declared sources visible to the user
│       ├── bindings.json            # team defaults for repos/workspaces
│       └── state.json               # last sync / owner / rollout metadata
├── personal/
│   ├── squads/
│   │   └── <name>/                  # local editable personal squads
│   ├── sources.json                 # personal source declarations
│   └── bindings.json                # optional personal default bindings
├── bindings/
│   ├── projects/
│   │   └── <project-key>.json       # effective binding per repo/clone/worktree
│   └── workspaces/
│       └── <workspace-key>.json     # optional workspace-wide binding sets
├── logs/
│   └── updates.jsonl                # install/update/audit trail
└── tmp/
    └── staging/                     # safe temporary extraction inside squad home
```

## Notes

- **Cache is immutable**. New versions land in new directories.
- **Bindings are mutable**. Project X can move from `team-foo@abc` to `team-foo@def` without rewriting the cache.
- **Personal squads stay editable under `~/.squad/personal/squads/`** and work fully offline.
- **Project-local bindings** continue to live in repo space where needed: `<repo>\.squad\bindings.json`.

---

## 5) CLI vs Rally vs new tool — ownership of distribution work

## Recommended split

| Capability | Primary owner | Why |
|---|---|---|
| `squad source add github:org/team-squad` | **CLI** | It mutates the user's source registry and should share auth/update semantics with install/sync/bind |
| `squad update` | **CLI** backed by SDK | Update is an operator action over the local cache and bindings |
| `squad bind --primary team-foo --fallback org-wide` | **CLI** | Binding is local project configuration, not an external dashboard concern |
| Resolve layered squad view at runtime | **SDK** | Core resolution logic must be reusable by CLI, runtime, VS Code, and future tools |
| Visibility into "what squads are active here?" | **CLI first**, Rally second | CLI must answer locally (`squad status`, `squad bind list`); Rally can add cross-repo/fleet visualization later |

## Concrete answer

### CLI owns

- `source add/remove/list`
- `update`
- `pin/unpin/freeze`
- `bind/unbind/list`
- local status and diagnostics:
  - `squad status`
  - `squad status --bindings`
  - `squad doctor --distribution`

### SDK owns

- transport adapters
- cache layout
- lockfile schema
- binding merge order
- policy evaluation
- rollback resolution

### Rally owns

- optional **dashboard / observability layer** for humans who want to see installed squads across repos or across a machine
- maybe a "what is active across my workspace?" overview if Rally remains the user-home operations shell

### Rally mod

- only if needed: a thin module that reads `~/.squad/registry-v2.json` and renders distribution health
- not required for v1 distribution semantics

### New tool

- **Do not create one for v1**.
- If a future org needs fleet-wide admin controls, make it an **admin/export tool**, not a second end-user installer.

---

## 6) Day-1 walkthrough

Assume the org already pushed the managed CLI and bootstrap manifest to the machine.

### A. Install / first run

```bash
# IT/MDM already installed squad
squad --version
squad status --org
```

Expected:

- `~/.squad/` created if missing
- org bootstrap imported
- org sources materialized into cache
- default org bindings available

If auth is needed for private GitHub sources:

```bash
gh auth login
squad update --scope org
```

### B. Register a team squad source

```bash
squad source add github:acme/network-platform-squad --scope team --name network-platform --track main
squad update network-platform
```

If the team source lives in ADO instead:

```bash
squad source add ado:https://dev.azure.com/acme/DevEx/_git/network-platform-squad --scope team --name network-platform --track refs/heads/main
squad update network-platform
```

### C. Bind it to clones B and C

```bash
cd D:\dev\Foo-B
squad bind --primary network-platform --fallback acme-org-core
squad status --bindings

cd D:\dev\Bar-C
squad bind --primary network-platform --fallback acme-org-core
squad status --bindings
```

### D. Create the personal squad for D

```bash
squad source add path:%USERPROFILE%\\.squad\\personal\\squads\\d-local --scope personal --name d-local --create
squad bind --project D:\dev\Baz-D --primary d-local --fallback network-platform --fallback acme-org-core
```

If the user wants the personal squad to roam later:

```bash
squad source set d-local --sync git --locator git@github.com:<user>/d-local-squad.git
```

But the offline default remains the local path.

### E. Verify everything

```bash
squad status --all
squad bind list
squad doctor --distribution
```

Expected verification:

- org source present and current
- team source present and pinned
- project B and C bound to team + org fallback
- project D bound to personal + team + org fallback
- no unresolved sources
- no expired freezes

---

## 7) Build allocation

## Allocation by capability

| Capability | Owner | Why |
|---|---|---|
| **(a) SDK** | **Yes — heavy ownership** | Transport adapters, cache manager, lock schema, binding resolver, policy engine belong in reusable runtime code |
| **(b) CLI** | **Yes — heavy ownership** | End-user commands for source add/update/bind/status/doctor/bootstrap import |
| **(c) Rally** | **Yes — light ownership** | Optional visibility/dashboard layer over `~/.squad/`; not the source of truth |
| **(d) Rally mod** | **Maybe — thin add-on only** | If Rally needs a Squad distribution panel, keep it as a read-only module |
| **(e) New tool** | **No for v1** | Another installer/operator surface would fragment ownership and confuse lifecycle semantics |

## Practical implementation split

### SDK

Build here:

- `SourceTransport` adapters: `git`, `release`, `ado-git`, `npm`, `http`, `onedrive-path`
- `RegistryV2` types
- lockfile read/write
- immutable cache materializer
- binding resolver (`personal > team > org`, with explicit order)
- update policy engine and rollback pointers

### CLI

Build here:

- `squad source add/remove/list/set`
- `squad update`
- `squad bind/unbind/list`
- `squad pin/unpin/freeze/unfreeze`
- `squad status --bindings --sources --org`
- `squad doctor --distribution`
- first-run bootstrap import

### Rally

Build only if it adds visibility value:

- "what squads are active on this machine?"
- "which repos are bound to which layers?"
- stale source / failed update / frozen source dashboard

### Rally mod

Only if Rally ships the dashboard; otherwise skip.

### New tool

Not justified for v1. If later needed, restrict it to **org admin publishing** (for example, generating signed bootstrap manifests), not end-user install/update.

---

## 8) Top 3 distribution risks

### 1. Registry drift across user machines

**Risk:** two users think they are on "team-foo stable" but one is pinned to an old materialization and the other auto-advanced.

**Mitigation:**

- explicit `sources.lock.json`
- `squad status` always shows declared vs resolved version
- org/team releases promote immutable versions, not moving branch heads alone
- project bindings may pin/freeze, but drift is visible

### 2. Stale org squads cached forever

**Risk:** the org deploys a source once and laptops never refresh, especially after long offline periods.

**Mitigation:**

- TTL-based update checks on CLI start / session start
- required-refresh policy for org security/governance sources
- `lastChecked`, `lastApplied`, and `staleAfter` tracked per source
- clear warning surface in `squad doctor --distribution`

### 3. Breaking changes pushed without coordination

**Risk:** org or team publishes a breaking squad change and auto-update rolls it to everyone at once.

**Mitigation:**

- channels/rings (`canary`, `pilot`, `stable`)
- semantic versioning for packaged sources and release tags for git/release sources
- rollback pointer in lockfile
- per-project freeze window
- team/org sources should publish compatibility metadata (`requiresCLI`, `schemaVersion`, `breaking: true`)

---

## Recommendation summary

If we want multi-squad layering to work at engineering-org scale, the cleanest v1 is:

- **Central store:** `~/.squad/` (Rally-style familiarity)
- **Source of truth for distribution:** **Squad SDK + Squad CLI**
- **Primary org deployment:** **MDM-installed CLI + org bootstrap manifest**
- **Personal squads:** local/offline-first, user-controlled
- **Team squads:** centrally published, user-applied by default, optional auto mode
- **Org squads:** stable-ring auto-update with temporary freeze override
- **No new tool for v1**; Rally only adds visibility if needed

That gives us a single mental model: **declare sources, materialize immutable local copies, bind layers to projects, update by policy**.
