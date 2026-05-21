# Multi-Squad Management: Proposal & Functional Specification

**Author:** Flight (Squad Lead)
**Date:** 2026-05-16
**Status:** Proposal — pending Brady approval
**Version:** 1.0

## PART I — PROPOSAL

### 1. Title page / metadata

- **Title:** Multi-Squad Management: Proposal & Functional Specification
- **Author:** Flight, on behalf of Squad
- **Date:** 2026-05-16
- **Status:** Proposal — pending Brady approval
- **Version:** 1.0
- **Supersedes on contested points:** prior Round 1–5 inbox artifacts on multi-squad management
- **Requested by:** Brady

### 2. Executive summary

Squad needs to support engineering-org scale, not just a single in-repo team. Brady’s priority order is now clear: first, the system must support many squads across many folders, repos, storage media, and hosts; second, it should minimize custom code; third, it should contribute reusable value upstream to `bradygaster/squad`.

The recommendation is a deliberate **third path**. We should upstream the **minimum invariant SDK kernel** that every host needs, keep **org-specific layers private**, and use **Rally as a consumer shell** where it already solves real workflow problems. That means Squad upstream owns only the host-neutral contract: source identity, binding records, per-directory resolution, ambiguity reporting, explanation payloads, runtime contract export, policy hooks, materialization, and re-entry/drift checks. It does **not** own corporate catalog lookup, staffing policies, enterprise auth/connectors, managed deployment UX, or dashboard/operator workflows.

This shape satisfies P0 because it treats the problem as a directory-resolution and materialization problem, not a single-tool problem. It satisfies the first P1 because it reuses the existing state-backend substrate in Squad and Rally’s operator shell instead of rebuilding those surfaces. It satisfies the second P1 because the public contribution is small, general, and useful beyond one company.

The key discipline is to treat Tamir’s branches as **idea sources, not a merge queue**. The state-backend work is already largely upstreamed; other branches are useful only as selective inspiration. If upstream review on the minimum kernel drags past roughly **12 weeks**, or if maintainers reject the premise that these kernel primitives belong in the SDK, we should pivot to a private independent host rather than stall the org.

### 3. Problem statement

Brady’s original framing is a mix-and-match matrix, not a single feature request. The system must support all of the following at the same time:

- **N squads, not one squad** — project, team, org, and personal squads may all exist on one machine.
- **Applicability by location** — the answer can change by subdirectory, not just by repo.
- **Multiple storage media** — in-repo, other repo, GitHub release, ADO repo, OneDrive, plain filesystem, npm, and HTTP are all valid sources.
- **Multiple persistence locations** — repo-visible files, clone-local overrides, machine-local registry/cache, and host-local operator stores must all be possible.
- **Layering without state bleed** — one authoritative answer per working directory, plus explicit fallbacks and bounded personal overlays.
- **Sharing across people and repos** — one team or org squad should be reusable by many repos and many users.
- **Multiple hosts** — `squad-cli`, Rally, and private org tools must be able to consume the same underlying answer.
- **Trust and governance** — provenance, write boundaries, connector limits, and sandboxed personal mode must be enforceable in code.

In short: **given any current directory, on any supported host, resolve the right squad stack, explain it plainly, materialize it safely, and preserve the boundary between shared and personal state.**

### 4. Goals — requirements summary

| Priority | Requirement |
|---|---|
| **P0** | **Org-scale multi-squad flexibility** — N squads, applicability by directory, multiple storage media, multiple persistence locations, layering, cross-user sharing. |
| **P0** | **Transparent artifact/dotfile management** — Squad's mutable state (decisions, histories, logs, orchestration records) MUST NOT appear in developer pull requests. Developers must not pay a git/repo tax — no manual file separation, no separate PRs, no branch-policy negotiation — to use Squad in organizations with PR review and branch protection. The SDK/agents and any organization layer are responsible; the developer is unaware. Default out-of-the-box behavior (worktree backend, single-developer) is unchanged. See §4a. |
| **P1** | **Minimum custom code** — Reuse existing Squad and Rally substrate; minimize net-new code. |
| **P1** | **Contribute upstream** — Upstream reusable value to `bradygaster/squad`. |

### 4a. How transparent state isolation works

#### Three classes of Squad files

Squad files fall into three categories with distinct PR-visibility rules in org settings:

| Class | Examples | Visible in PR diffs? |
|---|---|---|
| **Working product changes** | Feature code, tests, build config | Always — peer-reviewed normally |
| **Squad static config** | `charters/`, `team.md`, `routing.md`, `ceremonies.md` | Yes — intentional, reviewable artifacts |
| **Squad mutable state** | `decisions.md`, `agents/*/history.md`, `log/*`, `orchestration-log/*`, `decisions/inbox/*` | **No** — MUST be invisible to PRs in org contexts |

The boundary between "static config" and "mutable state" is the same line that already exists in the state-backend design: config describes who the squad is; state records what the squad has done.

#### The `stateBackend` mechanism

Squad's `.squad/config.json` supports a `stateBackend` field that already ships in v0.9.2-mc.preview.x:

| Value | Where state lives | Appears in working-branch diffs? | Recommended for |
|---|---|---|---|
| `worktree` | On the working branch | **Yes** (default) | Solo developers, personal projects |
| `git-notes` | In `refs/notes/squad` — branch-invisible | No | Single-developer org repos |
| `orphan` | On a dedicated `squad-state` orphan branch | No | Org / team use — **recommended org default** |
| `two-layer` | Static config on working branch; mutable state on orphan | No (mutable part) | Orgs that want config committed, state hidden |
| `external` | Outside the repo entirely | No | Fully managed environments |

For organizational use, **`orphan` or `two-layer` are the recommended defaults.** The org's tool layer can pre-set the backend when registering a new squad, so individual developers never need to configure it themselves.

#### What the developer sees

With `orphan` or `two-layer` as the org default:

- Scribe commits mutable state to the `squad-state` orphan branch transparently as part of normal state-flush operations.
- The working branch carries only the developer's product changes (plus static Squad config, if any).
- `git diff main...feature-branch` shows zero Squad artifacts — only product code.
- PR review, branch protection, and required-reviewer policies apply only to the developer's real work.
- No cherry-picking, no separate Squad-state PRs, no branch-policy negotiation required.

#### Before/after: the PR diff tax

**Without transparent state isolation** (`worktree` backend, single-repo default):

```diff
# PR: feat/add-payment-gateway
diff --git a/src/payments/stripe.ts b/src/payments/stripe.ts
@@ -0,0 +1,12 @@
+ export async function createCharge(...) { ... }

diff --git a/.squad/decisions.md b/.squad/decisions.md
@@ -1,3 +1,18 @@
+## 2026-05-21: Payment gateway architecture decision
+...

diff --git a/.squad/agents/flight/history.md b/.squad/agents/flight/history.md
@@ ... @@
+📌 Team update: reviewed payment gateway proposal...

diff --git a/.squad/log/session-2026-05-21.md b/.squad/log/session-2026-05-21.md
new file mode 100644
@@ ... @@
+[session log contents]
```

Reviewers must sift through Squad artifacts to find the real change. Branch protection may block merge until reviewers sign off on Squad state they cannot meaningfully evaluate.

**With transparent state isolation** (`orphan` or `two-layer` backend):

```diff
# PR: feat/add-payment-gateway
diff --git a/src/payments/stripe.ts b/src/payments/stripe.ts
@@ -0,0 +1,12 @@
+ export async function createCharge(...) { ... }
```

The developer's PR contains only product code. Squad mutable state is committed by Scribe to the `squad-state` branch independently — no human review required, no branch-protection friction.

#### Ownership

| Owner | Responsibility |
|---|---|
| **SDK** | Provides the `stateBackend` abstraction and implements each backend variant |
| **`squad-cli`** | Reads `stateBackend` from `.squad/config.json` and plumbs it to the runtime |
| **Scribe** | Executes the orphan-branch commit/push workflow transparently; the developer does not invoke it manually |
| **Org tool layer** | Sets `"stateBackend": "orphan"` as the org default when registering new squads — developers never touch this setting |
| **Developer** | Unaware — commits product changes; Squad state management is invisible |

#### Current implementation status

The SDK's `stateBackend` abstraction provides the foundation: the `orphan` and `two-layer` variants are shipped, and Scribe's commit/push workflow is plumbed. Three targeted features remain before the P0 is complete for org settings.

#### Required follow-on work (P0 delivery checklist)

These items are required to close the transparent state isolation P0. They apply only when `stateBackend` is `orphan` or `two-layer`. Default worktree-backend behavior is unchanged; orphan/two-layer opt-in adds hooks and guards as part of the isolation mechanism.

- [ ] **State Leak Guard: Scribe enforcement** — Strengthen Scribe's pre-check from warn-mode to block-mode: if `stateBackend` is `orphan`/`two-layer` and the working tree has staged changes to mutable state paths, Scribe refuses to proceed and prints a remediation command. Lives in the spawn template / Scribe's bootstrap logic.

- [ ] **State Leak Guard: Pre-commit hook** — Ship a git pre-commit hook template, auto-installed by `squad init` and `squad assign`, that inspects `git diff --cached --name-only` and rejects a commit if mutable state paths appear while the backend is `orphan`/`two-layer`. Hard enforcement; `--no-verify` bypass is an accepted limitation (see §5).

  The pre-commit hook is the primary blocking gate — it fires before the commit is written. Scribe's pre-check is the audit/self-heal layer, activating when the hook is missing or was bypassed (e.g., `--no-verify`). These are not competing peers; they are layered guards with distinct authority.

- [ ] **Hook Bootstrap** — `squad assign` installs the pre-commit hook on completion, mirroring the existing call site in `squad init`. Installation is idempotent — running multiple times must not corrupt the hooks directory or duplicate entries.

  Hooks are not a separate distribution problem. A developer cannot use Squad without `squad.agent.md` present and consciously selecting the squad agent in their IDE. The same delivery events that activate Squad (`squad init` for solo dev, `squad assign --callsign` for org-managed) are the right install moments, reusing existing channels rather than inventing new ones. Orgs that commit `squad.agent.md` directly (bypassing `assign`) are responsible for also committing `.githooks/` and setting `core.hooksPath`.

- [ ] **Post-Migration Cleanup** — `squad migrate-backend` runs `git rm --cached` on tracked mutable state paths to remove them from git's index, then appends appropriate `.gitignore` entries (covering `decisions.md`, `agents/*/history.md`, `log/*`, `orchestration-log/*`, `decisions/inbox/*`) to guard against new `git add` of those files going forward. Note: `.gitignore` only prevents tracking of *untracked* files — `git rm --cached` is the required first step for files git is already tracking. The pre-commit hook backstops residual edge cases (old-checkout, stash-pop, and merge-conflict scenarios where files may be re-staged). History scrubbing (`git filter-repo` to remove old state files from project history) is explicitly out of scope for the P0 — clean PR diffs going forward is the bar; pre-migration commits retaining `.squad/` state in history are accepted, analogous to legacy `.DS_Store` commits. A documented recipe for compliance-paranoid orgs is provided (see §5).

### 5. Non-goals

This proposal does **not** attempt to solve the following in v1:

- Building a new first-party org-managed host on top of Squad
- Replacing Rally as the shared-repo / external operator shell
- Forcing all hosts onto one physical on-disk store in v1
- Upstreaming enterprise-specific catalog lookup, staffing rules, SSO plumbing, or connector policy
- Making Squad CLI mandatory for every end user or every deployment model
- Implementing silent multi-authority merge for identity, routing, or automatic writes
- Solving every enterprise deployment problem inside the SDK
- Shipping a public admin service or dashboard product for rollout management
- Treating Tamir's fork as an alternate trunk or merge queue
- **The SDK does not enforce `--no-verify` bypass prevention** — `git commit --no-verify` circumvents the pre-commit hook; this is an accepted limitation of the hook-based approach. Enforcement at this boundary relies on developer discipline or org-discretionary CI guards.
- **The SDK does not rewrite git history at migration time** — `squad migrate-backend` cleans the working tree going forward; pre-migration commits retaining `.squad/` state in history are accepted. A `git filter-repo` recipe for compliance-paranoid orgs will be documented alongside the migration command, but it is not a built-in.
- **The SDK does not ship a CI-side state-diff enforcement guard** — this is an optional defense-in-depth pattern an org may adopt independently; it is documented as such but not included in the SDK.

The private layer inventory is explicit: **corp catalog, enterprise policy, deployment/bootstrap UX, dashboard/operator UX, and managed-machine personal sandbox behavior remain private unless Brady later chooses to productize them.**

### 6. Audience

This design serves four user archetypes:

1. **Solo developer** — wants portable Squad behavior with explicit personal control and minimal setup.
2. **Team member** — wants the right shared help to appear by folder or repo, plus plain-English “why here?” status.
3. **Org admin / platform owner** — wants controlled rollout, source registration, trust, and policy enforcement without repo pollution.
4. **OSS maintainer / upstream host maintainer (Squad and Rally)** — wants a small durable contract that avoids duplicated resolution logic.

### 7. The “third path” recommendation

**Recommendation:** upstream the **minimum invariant SDK kernel**, keep **org-specific catalog/policy/deployment/dashboard layers private**, adopt ideas from Tamir’s branches only where they clearly reduce work without importing fork-shaped semantics, and use **Rally as a consumer host** wherever its operator shell already fits. In practice, that means building the public center of gravity in `squad-sdk` and `squad-cli`, letting Rally consume the same contract, and refusing to upstream enterprise-only behavior.

### 8. Why this shape

The convergence point from Round 3 onward is that the invariant is **not** a CLI flow and **not** a Rally flow; it is an SDK contract. The Casey narratives proved that host choice is variable, while per-directory resolution, explainability, explicit personal boundaries, trustable defaults, and next-day re-entry are invariant. Round 4 therefore moved the product center into the SDK, and Round 5 confirmed that selective reuse is cheaper than either wholesale fork adoption or a clean-room rebuild. This shape preserves P0 while keeping both P1s honest: small public kernel, private enterprise layers, no duplicated resolution engines.

### 9. Risks and mitigations

| Priority | Risk | Likelihood | Impact | Mitigation | Residual risk |
|---|---|---|---|---|---|
| 1 | **Upstream review drags past the useful window** and delays org value | Medium | High | Keep PRs small and sequenced; land types and resolver first; use the pivot heuristic at 12 weeks | Medium |
| 2 | **Upstream rejection of the SDK boundary** (maintainers agree with the problem but reject the API placement or shape) | Medium | High | Upstream only host-neutral primitives used by at least two hosts; keep catalog/policy/UX private; ship design docs with each PR | Medium |
| 3 | **Semantic fork despite best intentions** because private layers bleed into public contracts | Medium | High | Maintain a strict “private inventory”; require a two-host use case for every public SDK surface; do not upstream corp-specific nouns | Low-Medium |
| 4 | **Upstream pace or Rally evolution creates churn** in the kernel integration points | Medium | Medium-High | Pin compatible versions, run parity tests across hosts, review upstream changes weekly while the kernel is landing | Medium |
| 5 | **Trust or write-boundary failure causes shared-state bleed** across squads or leaks provenance | Low-Medium | High | Enforce ACLs in SDK hooks, use inbox-only foreign writes, trust tiers, source locks, and visible restricted-tool policy | Low-Medium |

### 10. Pivot heuristic

Decide the pivot policy now.

**Stay on the upstream-shaped third path by default. Pivot to full independence if either immediate trigger fires, or if any two economic triggers persist through a phase gate.**

#### Immediate pivot triggers

1. **Calendar trigger:** from the first upstream kernel PR, the path to acceptance of the minimum kernel is projected to exceed **12 weeks**.
2. **Boundary rejection trigger:** Squad maintainers reject the premise that the following belong in `squad-sdk`: resolution result shape, ambiguity return, explanation payload, runtime contract export, or materialization hook.

#### Economic pivot triggers (pivot if any two hold at the same time)

3. **Divergence trigger:** the private consumer must redefine **3 or more core concepts** (`source`, `binding`, `stack`, `active write layer`, `materialization`, `re-entry`) differently from upstream.
4. **Maintenance trigger:** compatibility work is forecast to exceed **0.5 FTE ongoing**, or each upstream release would require **more than 2–3 engineer-days** to absorb.
5. **Ownership trigger:** Brady cannot assign **one senior owner plus 0.25 FTE ongoing maintenance** for the compatibility tail.

#### Non-pivot signal

Do **not** pivot if the kernel can land in **4–6 weeks** and maintainer feedback is narrowing scope rather than rejecting the boundary.

### 11. Phased delivery

#### Phase 1 — MVP for Casey day-1

Ship the smallest public kernel and first-party CLI proof:

- `SquadSourceRecord`, `SquadBinding`, registry/lockfile shapes
- `resolveSquadStack()` with ambiguity and explanation payloads
- runtime contract export, policy seam, re-entry token, materialization hook
- `squad-cli` reference flows for source registration, binding, `status`, `explain`, and personal-only mode
- enough trust metadata to support verified/unverified and shared-vs-personal boundaries

**Outcome:** Casey can move between folders and get a correct, plain-English answer on day 1 using `squad-cli`.

#### Phase 2 — Host parity across `squad-cli`, Rally, and org-tool

- Rally consumes the SDK contract at dispatch time
- Rally adds folder-aware selection/status and active-squad visibility
- org-tool integration guide and reference sample prove the contract is consumable without `squad-cli`
- parity tests assert that the same cwd + bindings produce the same resolution and runtime contract across all three hosts

**Outcome:** host choice changes the UX, not the meaning.

#### Phase 3 — Polish / optional / upstream-back

- cache refresh ergonomics, pin/freeze/rollback hardening
- targeted reuse of `upstream-auto-sync` ideas if needed
- dashboard polish, health views, and optional admin-side publishing helpers
- re-evaluate store convergence only if host-local persistence becomes an operational problem

**Outcome:** better operator experience without enlarging the public kernel unnecessarily.

### 12. Success criteria

The work counts as shipped when all of the following are true:

1. A single machine can register **multiple named squad sources** across different media.
2. One repo can resolve **different squads in different subdirectories** without duplicate clones.
3. `resolveSquadStack()` returns either a **resolved stack** or an **ambiguity result**; hosts never silently guess across conflicting project mappings.
4. Every host can render a plain-English **“why here?”** explanation from the same reason-code payload.
5. Personal-only mode explicitly states that org/team help is **off here**.
6. Rally can dispatch two worktrees from the same repo and materialize **different effective squads** for each.
7. An org tool can start a session from a **runtime contract** without requiring `squad-cli` to be the end-user front door.
8. Cross-squad writes are denied by default except for **owner-granted inbox append**.
9. Re-entry validation can confirm **“same answer as yesterday”** or surface drift.
10. The public upstream contribution remains bounded to the kernel; the private inventory stays private.

### 13. Open questions for Brady

1. **Binding visibility default:** should committed repo-visible bindings remain the preferred default, or should host-local / clone-local bindings be equally first-class from day 1?
2. **Managed-machine personal sandbox:** should sandboxed personal mode be part of the minimum public SDK contract, or stay a host-tightening extension only?
3. **Rally storage convergence:** is it acceptable in v1 for Rally to keep `~/rally/` as its operator store while consuming the shared SDK contract, or do you want forced convergence toward `~/.squad/` immediately?

## PART II — FUNCTIONAL SPECIFICATION

### 14. Architecture overview

```text
                         +-----------------------------------+
                         |         Host shells / UX          |
                         |-----------------------------------|
                         | squad-cli | Rally | org-tool      |
                         | bind      | dash  | catalog/policy|
                         | status    | dispatch | bootstrap  |
                         +----------------+------------------+
                                          |
                                          | consumes one contract
                                          v
+----------------------+     +-----------------------------------------------+     +----------------------+
| Project bindings     |<--->|            Squad SDK kernel (invariant)       |<--->| Source registry      |
| .squad/bindings.json |     |-----------------------------------------------|     | ~/.squad/registry-v2 |
| .git/squad-binding   |     | source IDs • bindings • resolveSquadStack()   |     | ~/.squad/locks/*     |
| repo config hints    |     | ambiguity • explanation • runtime contract    |     | host-local caches    |
+----------------------+     | policy seam • materialization • re-entry      |     +----------------------+
                             +-------------------+---------------------------+
                                                 |
                                                 | fetch / pin / refresh
                                                 v
                             +--------------------------------------------------+
                             | Storage backends / media                          |
                             | repo .squad | other repo | GitHub release | ADO  |
                             | OneDrive    | plain FS   | npm            | HTTP |
                             +--------------------------------------------------+
```

**Annotation:** the SDK kernel is the only semantic center. Hosts own UX and persistence choices above the line; transports and caches sit below the line. The contract must be stable enough that a host can resolve, explain, materialize, and re-enter without inventing its own semantics.

### 15. The Squad SDK kernel — invariant contract

#### 15.1 Core types

```ts
export type SquadScope = 'project' | 'team' | 'org' | 'personal';
export type LayerMode = 'authoritative' | 'advisory';
export type MaterializationMode = 'worktree' | 'session' | 'local';
export type StateBackendKind = 'worktree' | 'git-notes' | 'orphan' | 'two-layer' | 'external';
export type TrustTier = 't0-personal' | 't1-team' | 't2-org' | 't3-platform';
export type SquadTransport =
  | 'path'
  | 'git'
  | 'github-release'
  | 'ado-git'
  | 'onedrive-path'
  | 'npm'
  | 'http';

export type ReasonCode =
  | 'binding.nearest-match'
  | 'binding.clone-override'
  | 'binding.repo-default'
  | 'binding.user-default'
  | 'binding.personal-only'
  | 'binding.personal-disabled'
  | 'binding.source-excluded'
  | 'fallback.team'
  | 'fallback.org'
  | 'fallback.personal-overlay'
  | 'policy.sandboxed-personal'
  | 'policy.restricted-tools'
  | 'policy.team-fallback'
  | 'ambiguity.multiple-projects'
  | 'reentry.source-drift'
  | 'reentry.policy-drift';
```

```ts
export interface SquadSourceRecord {
  sourceId: string;
  name: string;
  scope: Exclude<SquadScope, 'project'>;
  transport: SquadTransport;
  locator: string;
  defaultFallbackSourceIds: string[];
  trustTier: TrustTier;
  verification: {
    status: 'verified' | 'trusted-repo' | 'local' | 'unverified';
    owner?: string;
    revision?: string;
    integrity?: string;
    verifiedAt?: string;
  };
  cache: {
    cachePath: string;
    revision?: string;
    fetchedAt?: string;
    pinned?: boolean;
  };
}

export interface SquadBinding {
  path: string; // repo-relative path prefix, '.' allowed
  primarySourceId?: string;
  fallbackSourceIds: string[];
  allowPersonal: boolean;
  personalMode: 'overlay' | 'only' | 'disabled';
  excludedSourceIds: string[];
  writeLayer?: 'primary' | 'team' | 'org' | 'personal';
  pinOverrides?: Record<string, { revision?: string; freezeUntil?: string }>;
}
```

```ts
export interface ResolvedSquadLayer {
  sourceId: string;
  scope: SquadScope;
  mode: LayerMode;
  root: string;
  stateBackend: StateBackendKind;
  writable: boolean;
  reasonCodes: ReasonCode[];
}

export interface SquadExplanation {
  summary: string;
  reasons: Array<{ code: ReasonCode; message: string; layerId?: string }>;
  positiveLayers: string[];
  excludedLayers: Array<{ sourceId: string; reason: ReasonCode }>;
  personalMode: 'overlay' | 'only' | 'disabled';
}

export interface SquadRuntimeContract {
  version: 1;
  cwd: string;
  primaryLayer: ResolvedSquadLayer;
  stack: ResolvedSquadLayer[];
  activeWriteLayer: ResolvedSquadLayer | null;
  explanation: SquadExplanation;
  memoryScope: 'project' | 'team' | 'org' | 'personal-local';
  stateBackend: StateBackendKind;
  approvedTools: string[];
  restrictedTools: string[];
  authContext: { mode: 'inherit-host' | 'host-provided'; provider?: string };
  policyMode: 'normal' | 'personal-only' | 'sandboxed-personal';
  reentryToken: SquadReentryToken;
}

export interface SquadReentryToken {
  version: 1;
  cwd: string;
  sourceRevisions: Record<string, string | undefined>;
  bindingHash: string;
  policyHash: string;
  createdAt: string;
}
```

#### 15.2 Entry points

| Entry point | Signature | Behavior contract | Error / edge-case semantics | Stability |
|---|---|---|---|---|
| Resolve stack | `resolveSquadStack(cwd: string, options?: ResolveSquadStackOptions): Promise<SquadResolutionResult>` | Resolve the current directory to exactly one primary authoritative layer plus ordered fallbacks and personal mode, or return ambiguity. Must consult session override → clone overlay → repo bindings → user registry → defaults → legacy fallback. | Return `kind: 'ambiguous'` instead of guessing when multiple project mappings match. Throw only for malformed config, unreadable required files, or impossible internal states. | **v1 frozen** for result shape and precedence rules. |
| Ambiguity result | `type SquadResolutionResult = { kind: 'resolved'; resolution: SquadResolution } | { kind: 'ambiguous'; ambiguity: SquadAmbiguity }` | Hosts must be able to branch on a discriminated union. Ambiguity must include candidate project/source options and reason codes. | Never collapse ambiguity into “best effort”. Empty candidate set is an error; 2+ candidates is valid ambiguity. | **v1 frozen**. |
| Explain selection | `explainSquadSelection(input: SquadResolution): SquadExplanation` | Produce host-neutral reason codes and short human-readable summaries. Must include positive layers and explicit exclusions/off states. | If explanation cannot be derived, return a synthetic `policy.restricted-tools` / internal fallback message rather than host-specific prose. | **v1 frozen** for payload shape and code strings; host wording is not. |
| Source registration | `registerSquadSource(record: SquadSourceRecord): Promise<void>` | Persist a source record into the machine registry without fetching content. | Reject duplicate `sourceId` with conflicting locator/transport. Allow idempotent re-registration with same identity. | **v1 frozen**. |
| Source refresh / pin | `refreshSquadSource(sourceId: string, opts?: RefreshOptions): Promise<SquadSourceRecord>` / `pinSquadSource(sourceId: string, revision: string): Promise<SquadSourceRecord>` | Fetch or re-resolve the source, update lock state, and preserve immutable cache history. | Unverified sources may refresh, but runtime may later load them read-only. Missing transport credentials surface as recoverable source errors. | **v1 frozen** for semantics; transport-specific options may expand experimentally. |
| Read / write bindings | `readSquadBindings(cwd: string): Promise<BindingSet>` / `writeSquadBinding(target: BindingTarget, binding: SquadBinding): Promise<void>` | Read or persist bindings in repo or overlay locations without resolving them yet. | Hosts choose where to write; SDK validates schema and path normalization. Invalid repo-relative paths are fatal validation errors. | **v1 frozen**. |
| Runtime contract export | `createSquadRuntimeContract(resolution: SquadResolution, host: HostContext): Promise<SquadRuntimeContract>` | Convert resolution + host context into the full session handoff: stack, explanation, active write layer, tool policy, auth mode, and re-entry token. | Missing host policy inputs default to least privilege. Contract creation must never widen permissions implicitly. | **v1 frozen** for core fields; host extension bag may be experimental. |
| Materialization hook | `materializeResolvedSquad(contract: SquadRuntimeContract, input: MaterializeInput): Promise<MaterializedSquad>` | Produce the effective `.squad/` content for a worktree, session dir, or local target. Must preserve source provenance and generate a materialization receipt. | If a layer cannot be materialized, fail the materialization; do not silently drop a required layer. Advisory personal layers may be omitted only when policy mode disables them and the receipt says so. | **v1 frozen** for input/output contract; physical optimization strategy is experimental. |
| Re-entry / drift | `validateReentry(token: SquadReentryToken, cwd: string): Promise<ReentryCheck>` | Determine whether the same directory still resolves to the same answer. | Return `status: 'drifted'` with explanation instead of throwing when revisions, bindings, or policy changed. | **v1 frozen**. |
| Policy seam | `authorizeSquadWrite(contract: SquadRuntimeContract, request: WriteRequest): WriteDecision` and `evaluateSquadPolicy(contract: SquadRuntimeContract): PolicyDecision` | Centralize write ACLs, destination classes, and restricted-tool policy. Hosts may tighten but not loosen the decision. | Default deny across namespaces. Foreign writes may only target owner-approved inbox paths. | **v1 frozen** for decision semantics. |

#### 15.3 Required supporting types

```ts
export interface ResolveSquadStackOptions {
  hostId?: 'squad-cli' | 'rally' | 'org-tool' | string;
  sessionOverride?: {
    sourceIds?: string[];
    personalMode?: 'overlay' | 'only' | 'disabled';
  };
}

export interface SquadCandidate {
  projectKey: string;
  displayName: string;
  path: string;
  proposedPrimarySourceId: string;
  reasonCodes: ReasonCode[];
}

export interface SquadAmbiguity {
  cwd: string;
  candidates: SquadCandidate[];
  summary: string;
}

export interface SquadResolution {
  cwd: string;
  primaryLayer: ResolvedSquadLayer;
  fallbackLayers: ResolvedSquadLayer[];
  personalLayer?: ResolvedSquadLayer;
  activeWriteLayer: ResolvedSquadLayer | null;
  explanation: SquadExplanation;
}
```

### 16. Configuration & data shapes

#### 16.1 Shareable source manifest — `.squad/source.json`

Used only for shareable team/org/personal sources. Legacy in-repo `.squad/` trees without this file remain valid as project-local sources but are not globally shareable until promoted.

```ts
export interface SquadSourceManifestV1 {
  version: 1;
  sourceId: string;
  name: string;
  scope: 'team' | 'org' | 'personal';
  transport: SquadTransport;
  locator: string;
  defaultFallbackSourceIds?: string[];
  trust?: {
    required: 'verified' | 'trusted-repo' | 'local';
    owner?: string;
  };
}
```

#### 16.2 Repo binding file — `.squad/bindings.json`

```ts
export interface SquadBindingsFileV1 {
  version: 1;
  bindings: SquadBinding[];
}
```

Semantics:

- nearest matching `path` wins the primary binding for the subtree
- broader bindings still contribute explicit fallbacks when not excluded
- `personalMode: 'only'` disables all shared layers for that path

#### 16.3 Clone-local overlay file — `.git/squad-binding.json`

```ts
export interface SquadBindingOverlayV1 {
  version: 1;
  bindings: SquadBinding[];
  sessionName?: string;
}
```

Semantics: same shape as repo bindings, but clone-local and uncommitted. This is the preferred escape hatch for Rally and other hosts that do not want repo pollution.

#### 16.4 Machine registry — `~/.squad/registry-v2.json`

```ts
export interface SquadRegistryV2 {
  version: 2;
  sources: Record<string, SquadSourceRecord>;
  importedBootstraps?: Array<{ id: string; importedAt: string }>;
  defaults?: {
    orgFallbackSourceIds?: string[];
    requiredSourceIds?: string[];
  };
}
```

Semantics: authoritative machine-local source registry. Hosts may cache a private copy, but the SDK contract is defined against this shape.

#### 16.5 Lockfile — `~/.squad/locks/sources.lock.json`

```ts
export interface SquadSourceLockFileV1 {
  version: 1;
  locks: Record<string, {
    revision?: string;
    integrity?: string;
    fetchedAt?: string;
    rollbackRevision?: string;
    verificationStatus: 'verified' | 'trusted-repo' | 'local' | 'unverified';
  }>;
}
```

Semantics: records the exact resolved artifact; bindings point to logical source IDs, not direct cache paths.

#### 16.6 Per-repo overlay / host receipt

The SDK may write a generated materialization receipt into the target workspace:

```ts
export interface SquadMaterializationReceiptV1 {
  version: 1;
  contractHash: string;
  materializedAt: string;
  layers: Array<{ sourceId: string; revision?: string; mode: LayerMode }>;
  targetMode: MaterializationMode;
}
```

This receipt is not user-authored policy; it is host/runtime bookkeeping.

### 17. Host responsibilities (what the SDK does NOT own)

#### 17.1 `squad-cli`

| `squad-cli` owns | `squad-cli` does not own |
|---|---|
| first-run welcome/bootstrap UX | resolution semantics |
| source add/list/remove/update/pin/freeze commands | policy decisions |
| bind/unbind/status/explain rendering | ambiguity ranking logic |
| explicit personal-only choice flow | materialization semantics |
| local diagnostics and trust display | enterprise catalog lookup |

#### 17.2 Rally (modified)

| Rally owns | Rally does not own |
|---|---|
| dashboard, issue/PR dispatch, attach/open/log flows | source identity model |
| host-local repo/folder selection UI | resolution algorithm |
| worktree creation and lifecycle | trust/ACL semantics |
| active-squad visibility in the dashboard | runtime contract schema |
| reading/writing host-local rules in `~/rally/` | cross-squad write logic |

#### 17.3 Org tool

| Org tool owns | Org tool does not own |
|---|---|
| corp catalog lookup and repo-to-project mapping | stack resolution meaning |
| enterprise auth, connector injection, policy UX | source/binding core types |
| managed deployment/bootstrap | reason-code semantics |
| tighter sandbox policy on corp boxes | materialization contract shape |
| company-specific ambiguity handling UX | re-entry meaning |

**Rule:** a host may add UX, discovery, and stricter policy, but it may not fork the contract semantics.

### 18. Storage media support matrix

| Medium | Adapter / backend pattern | Pull | Push | Pin | Refresh | Security characteristics |
|---|---|---:|---:|---:|---:|---|
| In-repo `.squad/` | local path + `worktree` | n/a | yes | n/a | n/a | trusted by repo visibility; shared-state rules apply immediately |
| Other repo checkout | `path` or `git` + `external` / `two-layer` | yes | yes, if owner-intended | yes | yes | strongest for intentional shared writable team sources; pin by commit or local path trust |
| GitHub release bundle | `github-release` + `external` | yes | no | yes | yes | read-only, checksum-able, good for verified org bundles |
| ADO repo | `ado-git` + `external` / `two-layer` | yes | yes, if owner-intended | yes | yes | similar to git; protected branch/release trust model |
| OneDrive / SharePoint synced folder | `onedrive-path` + `external` | yes | limited / owner-side | yes (eTag) | yes | treat as snapshot source, not live mutable shared state |
| Plain filesystem folder | `path` + `external` | yes | yes | weak | yes | local/private by default; trust tier depends on owner and location |
| npm package | `npm` + `external` | yes | publish outside SDK | yes | yes | exact semver + integrity hash; strongest package-style rollout |
| HTTP bundle | `http` + `external` | yes | no | yes | yes | require ETag or checksum; read-only by default |

**Default posture:** transport choice does not change binding semantics; it changes trust, pinning, and update behavior.

### 19. Resolution algorithm

```text
function resolveSquadStack(cwd):
  normalize cwd
  discover repo root / worktree root / host context

  bindings = collect in precedence order:
    1. session override (if any)
    2. clone-local overlay (.git/squad-binding.json)
    3. nearest repo binding in .squad/bindings.json
    4. machine registry defaults
    5. legacy single-squad fallback

  if host catalog says repo root maps to multiple projects
    and cwd is not inside one concrete project path:
      return ambiguous(candidates, reason = ambiguity.multiple-projects)

  effectiveBinding = nearest matching binding for cwd

  if effectiveBinding.personalMode == 'only':
      primary = personal source
      fallbacks = []
      exclusions = all shared sources
  else:
      primary = effectiveBinding.primarySourceId if present
             else legacy project-local source if present
             else first matching default source

      fallbacks = explicit fallbackSourceIds in order
      append broader fallbacks only when not excluded
      append personal overlay only when allowPersonal == true and personalMode != 'disabled'

  dedupe by sourceId while preserving primary + fallback order

  compute activeWriteLayer:
      first authoritative layer unless personalMode == 'only'
      personal layer writes only to personal namespace

  build explanation payload:
      include why primary matched
      include why fallbacks were added
      include what was explicitly excluded/off
      include policy notes (sandboxed personal, restricted tools)

  return resolved(primary, fallbacks, activeWriteLayer, explanation)
```

Required behavior:

- **Nearest binding wins primary.**
- **Layering is explicit.** No silent merge of multiple authorities.
- **Personal-only mode is a first-class state.** It is not simulated by removing files after resolution.
- **Explainability is mandatory.** Every resolved or drifted state must carry machine-readable reasons.
- **Ambiguity is a result, not an exception.** Hosts must help the user choose, not guess.

### 20. Security & trust model

#### 20.1 Trust tiers

| Tier | Meaning | Default runtime mode | Default write authority |
|---|---|---|---|
| **T0 Personal** | user-local or user-owned source | full read in approved workspace | personal namespace only; no shared-governance writes |
| **T1 Team** | trusted team-owned source | full team/project behavior | team namespace + repo content per repo rights |
| **T2 Org-managed** | verified org bundle or protected org source | full read with policy hooks active | org-managed bundles and allowed repo content; no silent repo-state overwrite |
| **T3 Platform** | built-in SDK/CLI/Rally enforcement | always active | enforcement only |

#### 20.2 Minimum security posture

- Provenance, storage destination, and write target are separate facts.
- Verified sources load silently; unverified sources load read-only or require approval.
- Cross-squad writes are **deny-by-default**.
- The only safe foreign-write default is **owner inbox append**, never canonical shared files.
- Personal agents may help edit product code as the signed-in user, but may not modify shared squad governance by default.
- Shared append-only files prohibit secrets, auth artifacts, emails, and personal share links.
- Enforcement lives in **SDK hooks / ACL evaluation**, not in prompt text.

#### 20.3 Cross-squad write rules

- `authorizeSquadWrite()` must classify destination as `shared-append-only`, `shared-policy`, `shared-mutable`, or `personal-local`.
- Only owner-side grants can widen access.
- Grants must be path-scoped, append-only, time-bounded, and attributable.
- Promotion of reusable learnings is explicit and owner-reviewed.

#### 20.4 Org auto-deploy boundary

The org may auto-deploy:

- SDK/CLI binaries
- verified source catalogs and cached bundles
- update policy metadata that does not widen permissions silently

The org may **not** silently:

- overwrite repo-owned `.squad/` state
- replace team-owned repo overlays
- expand permissions without notice
- auto-enable new connectors inside existing repos without surfacing the change

#### 20.5 Personal sandbox on corp boxes

Minimum supported posture:

- local-only memory
- no org-shared publishing
- connectors restricted by host policy
- restricted-tool list visible in the runtime contract

The SDK supports the policy mode; the host may tighten it further.

### 21. Materialization & worktree integration

**Decision:** materialization is a public SDK hook; the exact physical optimization is host-specific.

#### Contract

1. Host resolves the stack.
2. Host creates a runtime contract.
3. SDK materializes the effective `.squad/` view for a target directory.
4. SDK writes a materialization receipt.
5. Host starts the session against that materialized view.

#### Materialization modes

- **`worktree`** — used by Rally and any worktree-based host. Effective `.squad/` content is placed inside the dispatch worktree.
- **`session`** — used by a host that stages a temporary session workspace outside the repo.
- **`local`** — used by `squad-cli` for direct repo-local operation or inspection.

#### Physical strategy

- **Default semantic model:** copy/generate the effective `.squad/` tree into the target.
- **Allowed optimization:** hosts may use symlink/junction/cached read-only overlay internally for immutable source snapshots, but correctness must not depend on links.
- **Never assume repo-root-only symlinking.** The effective squad is per resolved directory, not per repo.

#### Rally relationship

Reuse Rally’s existing strengths unchanged where possible:

- `~/rally/active.yaml` and dashboard/session bookkeeping stay Rally-owned
- `.worktrees\...` placement stays Rally-owned
- dispatch worktree creation stays Rally-owned

Change only the semantic handoff:

- replace “copy one consult squad” with **resolve → contract → materialize**
- allow different worktrees from the same repo to materialize different effective squads

### 22. Upstream contribution plan

#### 22.1 `bradygaster/squad` — target branch `dev`

| Order | Proposed PR title | Scope | Contributability | Expected reviewer concerns |
|---|---|---|---|---|
| 1 | `feat(sdk): add source identity and binding record types` | `SquadSourceRecord`, `SquadBinding`, registry/lockfile readers, docs | 🟢 | naming, migration path for legacy `.squad/`, schema minimalism |
| 2 | `feat(sdk): add layered resolveSquadStack with ambiguity result` | precedence rules, ambiguity return, explanation seed data | 🟢 | API sprawl, backward compatibility, monorepo ambiguity behavior |
| 3 | `feat(sdk): add explanation payloads, write-layer selection, and re-entry validation` | reason codes, `explainSquadSelection`, re-entry token/checks | 🟢 | whether explanation belongs in SDK vs host, token shape |
| 4 | `feat(sdk): add runtime contract export and materialization hook` | `createSquadRuntimeContract`, `materializeResolvedSquad`, policy seam | 🟡 | host leakage, contract size, materialization mode naming |
| 5 | `feat(cli): add source/bind/status/explain reference-host flows` | thin first-party UX over the SDK | 🟢 | command naming, defaults for repo-visible vs host-local bindings |
| 6 | `docs(sdk): publish host integration guide for Rally and org hosts` | resolve → explain → contract → materialize guide | 🟢 | scope discipline, examples vs guarantees |

#### 22.2 `jsturtevant/rally` — target branch `main`

| Order | Proposed PR title | Scope | Contributability | Expected reviewer concerns |
|---|---|---|---|---|
| 1 | `feat: consume Squad runtime contract during dispatch` | Rally dispatch resolves and materializes effective squad per worktree | 🟡 | coupling to Squad SDK, version pinning, failure modes |
| 2 | `feat: add folder-aware squad rules and status commands` | `rally squad add|use|status`, rules persisted in `~/rally/` | 🟡 | command surface growth, UX wording, config location |
| 3 | `feat: show active squad in dashboard and attach flows` | dashboard badge/column/detail views | 🟡 | UI density, caching, trust wording |
| 4 | `docs: describe Rally as the shared-repo host for Squad kernel` | docs and compatibility guidance | 🟢 | product positioning |

### 23. The “what we keep private” inventory

The following remain private by default:

1. **Corp catalog** — repo/project/team discovery and staffing overrides
2. **Enterprise policy** — approved tools/connectors, org-specific restrictions, escalation rules
3. **Deployment/bootstrap** — MDM packages, machine manifests, rollout rings, corp install UX
4. **Dashboard/operator UX** — company-specific control planes, cross-repo fleet views, internal status pages
5. **Managed-machine personal sandboxing details** — beyond the minimum policy mode exposed by the SDK

These may consume the kernel; they do not define it.

### 24. Implementation guidance — minimum viable code surface

Build in this order.

1. **Reuse current Squad state substrate first**
   - Start from existing `packages/squad-sdk/src/state-backend.ts` and `packages/squad-sdk/src/resolution.ts`
   - Treat Tamir’s `feat/state-backend-global-996` as already-harvested architectural input, not a branch to merge

2. **Keep Rally’s operator shell intact**
   - Preserve `~/rally/` bookkeeping, dashboard/session lifecycle, `.worktrees\...` placement, and host/agent split

3. **Build the missing SDK kernel net-new**
   - source records
   - bindings
   - `resolveSquadStack()`
   - explanation payloads
   - runtime contract
   - materialization hook
   - re-entry/drift
   - policy seam

4. **Add thin `squad-cli` reference-host commands**
   - source register/update/pin
   - bind
   - status/explain
   - personal-only choice flow

5. **Modify Rally to consume the SDK contract**
   - folder-aware rules
   - status display
   - dispatch-time materialization

6. **Only then consider selective follow-ons from Tamir ideas**
   - `upstream-auto-sync` watch/propose behavior, if and only if refresh ergonomics still hurt after the kernel exists

### 25. Testing & acceptance

#### 25.1 Automated tests

At minimum, add SDK tests that prove:

- registry and binding schemas round-trip cleanly
- nearest binding wins by path
- fallback order is stable and explicit
- ambiguity returns candidates instead of guessing
- personal-only and personal-disabled modes behave distinctly
- explanation payloads include positive and excluded layers
- runtime contract preserves active write layer, tool restrictions, and re-entry token
- materialization receipts reflect all resolved layers
- `validateReentry()` detects source drift and policy drift
- `authorizeSquadWrite()` denies foreign canonical writes and allows inbox append when granted

#### 25.2 Manual acceptance checks

Validate Casey’s day-1 across three hosts:

1. **`squad-cli`**
   - one repo with two subdirectories resolves differently
   - `status` explains the answer plainly
   - personal-only repo explicitly turns shared help off

2. **Rally**
   - two issues from one repo dispatch into separate worktrees with different effective squads
   - dashboard shows the active squad before dispatch
   - `rally squad status` matches `squad-cli` semantics

3. **Org tool**
   - repo-root ambiguity is surfaced, not guessed
   - project A resolves to org fallback while project B resolves to team
   - unregistered repo enters sandboxed personal mode with restricted tools visible

#### 25.3 Three-host parity assertion

For a shared fixture repo and binding set, the three hosts must agree on:

- primary source ID
- ordered fallback IDs
- personal mode
- active write layer
- reason codes
- re-entry drift result

They may differ only in presentation and persistence location.

### 26. Glossary

- **Squad** — the human/AI operating model: roster, routing, skills, memory, and governance.
- **Source** — the authoritative home of a reusable squad definition, identified by stable source ID.
- **Binding** — the rule that says which source is primary for a path, what falls back, and how personal mode behaves.
- **Stack** — the ordered set of layers visible for one current working directory.
- **Resolution** — the act of mapping a cwd to a concrete stack or an ambiguity result.
- **Host** — the user-facing shell that consumes the kernel, such as `squad-cli`, Rally, or an org tool.
- **Materialization** — creating the effective `.squad/` content for the target workspace or session.
- **Personal-only mode** — an explicit rule that disables shared layers for a path and keeps only the personal workspace active.
- **Org tool** — a private company-standard developer shell that consumes the Squad kernel without exposing Squad-native UX directly.
- **Pivot heuristic** — the pre-decided rule set for abandoning the upstream path and shipping independently.
- **State backend** — the persistence mechanism that controls where Squad mutable state (decisions, history, logs) is stored relative to the working branch. Configured via `stateBackend` in `.squad/config.json`.
- **Transparent state isolation** — the property, achieved via the `orphan` or `two-layer` state backends, by which Squad mutable state never appears on the developer's working branch and therefore never enters PR diffs or triggers branch-protection policies.
- **Orphan-branch backend** — the `orphan` state backend variant: mutable state is committed to a dedicated `squad-state` orphan branch, keeping the working branch entirely free of Squad state artifacts.

## PART III — APPENDICES

### 27. Appendix A — decision trail

- `.squad/decisions/inbox/flight-multisquad-strategy-proposal.md` — Round 1 lead framing of the source/binding/stack model.
- `.squad/decisions/inbox/procedures-multisquad-discovery-proposal.md` — Round 1 layering, precedence, and coordinator-prompt delta proposal.
- `.squad/decisions/inbox/eecom-multisquad-storage-proposal.md` — Round 1 storage/runtime substrate view.
- `.squad/decisions/inbox/network-multisquad-distribution-proposal.md` — Round 1 transport, cache, registry, and rollout proposal.
- `.squad/decisions/inbox/retro-multisquad-security-proposal.md` — Round 1 trust, ACL, provenance, and containment proposal.
- `.squad/decisions/inbox/flight-multisquad-strategy-converged.md` — Round 2 convergence document and first canonical model.
- `.squad/decisions/inbox/flight-multisquad-strategy-gap-analysis.md` — Round 3 correction after the Casey narratives; moved the invariant into the SDK.
- `.squad/decisions/inbox/flight-multisquad-solution-shape-recommendation.md` — Round 4 build-allocation recommendation: SDK kernel + CLI reference host + Rally consumer.
- `.squad/decisions/inbox/flight-multisquad-priority-framed-plan.md` — Round 5 priority-framed Path B recommendation against Brady’s P0/P1/P1 order.
- `.squad/decisions/inbox/eecom-multisquad-reuse-audit.md` — Round 5 audit of Tamir branches, Rally reuse, and unavoidable net-new kernel code.
- `.squad/decisions/inbox/rubberduck-multisquad-abandon-upstream-analysis.md` — Round 5 devil’s advocate and pivot heuristics.
- `.squad/decisions/inbox/pao-multisquad-day-in-life-casey.md` — Casey baseline day-1 narrative for the first-party host.
- `.squad/decisions/inbox/pao-multisquad-day-in-life-casey-rally.md` — Casey narrative for Rally as shared-repo operator host.
- `.squad/decisions/inbox/pao-multisquad-day-in-life-casey-org-tool.md` — Casey narrative for a corp-managed org host.

> **Cross-reference:** The Casey narratives above all implicitly depend on the transparent artifact/dotfile management P0 introduced in §4/§4a. Specifically, any Casey scenario set in an org context assumes that Squad state (decisions, history, logs) does not appear in Casey's PRs and does not trigger branch-protection friction. PAO is refreshing the narrative files to make this dependency explicit; this proposal is the authoritative requirement source.

### 28. Appendix B — alternatives considered

#### Alternative 1 — Pure `squad-cli` host

Rejected. Round 3 showed that `squad-cli` is a valid portable first-party host, but not the universal front door. Making the CLI the owner of the whole model would force Rally and org tools to either re-implement semantics or pretend they are thin wrappers over a UX that does not fit them. The invariant belongs in the SDK, not in CLI-specific setup flows.

#### Alternative 2 — Pure Rally extension

Rejected. Rally is already the right operator shell for shared-repo and dispatch-centric workflows, but it is not the natural owner of source identity, trust, bindings, or per-directory resolution semantics. Extending Rally alone would solve one host well while leaving `squad-cli` and org tools without the same contract, and it would strain especially hard at the “same repo, different subfolder, different squad” requirement.

#### Alternative 3 — Full standalone org host with abandoned upstream

Rejected for now. Rubber-Duck was right that a private org host could ship faster and narrower, especially if urgency dominates. But absent a hard deadline, the long-term cost of semantic fork, compatibility maintenance, and lost public alignment is too high. This remains the contingency plan only if the pivot heuristic fires.

### 29. Appendix C — vocabulary diff vs current `squad.agent.md`

#### New terms introduced

- **Source** — reusable squad identity independent of one repo checkout
- **Binding** — per-path rule selecting primary/fallback/personal behavior
- **Stack** — ordered layers for one cwd
- **Active write layer** — the one authoritative destination for automatic shared-state writes
- **Runtime contract** — the machine-readable handoff a host uses to start a session
- **Materialization** — producing the effective `.squad/` view for a target workspace
- **Personal-only mode** — explicit exclusion of all shared layers
- **Pivot heuristic** — the pre-agreed trigger set for abandoning upstream
- **State backend** — the persistence mechanism controlling where Squad mutable state is stored relative to the working branch; configured via `stateBackend` in `.squad/config.json`
- **Transparent state isolation** — the property by which Squad mutable state is kept off the developer's working branch and therefore invisible to PR diffs and branch-protection policies; achieved via the `orphan` or `two-layer` backends
- **Orphan-branch backend** — the `orphan` backend variant; mutable state commits to a dedicated `squad-state` orphan branch, leaving the working branch entirely clean

#### Existing terms redefined

- **`TEAM_ROOT`** — no longer “the only squad root”; it becomes a backward-compatible alias for the primary authoritative root or active write layer root.
- **Personal squad** — no longer just ambient discovery under Ghost Protocol; it becomes an explicit layer with policy mode (`overlay`, `only`, or `disabled`).
- **Consult mode** — remains a host behavior, especially in Rally, but is no longer the only model for personal participation.
- **Worktree setup** — shifts from one static squad copy to per-dispatch materialization of the resolved stack.

#### Existing terms deprecated

- **Single team-root chain as the universal resolver** — replaced by layered resolution.
- **“One repo = one squad” assumption** — replaced by per-directory applicability.
- **CLI as the universal operator surface** — replaced by CLI as the reference host.
- **Repo-root-only effective `.squad/` symlink model** — replaced by target-specific materialization.

This vocabulary update is the coordinator-prompt delta Procedures should carry forward when converting today’s single-root wording into the layered stack model.
