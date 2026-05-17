# Multi-Squad Management: Proposal & Functional Specification

**Version:** 1.1
**Status:** Proposal — pending Brady approval
**Date:** 2026-05-17
**Supersedes:** v1.0 (`.squad/decisions/inbox/flight-multisquad-proposal-and-spec.md`)

## Changes from v1.0

- Replaced §13's three open questions with resolved design decisions and moved those decisions into the body of the spec.
- Generalized bindings across §14, §15, §16, and §19 from a single default into a pluggable binding-location model with repo-visible, host-local, and env-var override support.
- Re-cut §15 and §17 around Brady's layering rule so the SDK keeps mechanisms while hosts own org policy; corp catalog discovery, enterprise auth flows, and managed-machine personal enforcement moved out of the SDK kernel.
- Added an explicit Rally relationship in §21 and removed Rally from the v1 critical path in §11 and §22.
- Updated the upstream contribution plan in §22 so Rally adoption is optional downstream work rather than required v1 work.
- Added the v1 build-allocation table in §7.1 and reclassified Rally as `🔁 optional consumer (no v1 dep)`.
- Extended Appendix C vocabulary with binding-location, consuming-host, pluggable lookup, and SDK state-directory-contract terms.

## PART I — PROPOSAL

### 1. Title page / metadata

- **Title:** Multi-Squad Management: Proposal & Functional Specification
- **Author:** Flight, on behalf of Squad
- **Date:** 2026-05-17
- **Status:** Proposal — pending Brady approval
- **Version:** 1.1
- **Supersedes:** v1.0 (`.squad/decisions/inbox/flight-multisquad-proposal-and-spec.md`)
- **Requested by:** Brady

### 2. Executive summary

Squad needs to support engineering-org scale, not just a single in-repo team. Brady’s priority order remains the same: first, the system must support many squads across many folders, repos, storage media, and hosts; second, it should minimize custom code; third, it should contribute reusable value upstream to `bradygaster/squad`.

The recommendation remains the deliberate **third path**, but v1.1 resolves the three design questions left open in v1.0. The SDK upstreams the **minimum invariant kernel** that every host needs, keeps **org-specific layers private**, and treats binding location as a **pluggable lookup problem** rather than a fixed disk layout. That means Squad upstream owns only the host-neutral contract: source identity, binding records, binding-location lookup primitives, per-directory resolution, ambiguity reporting, explanation payloads, runtime contract export, materialization, re-entry/drift checks, and least-privilege policy hooks. It does **not** own corporate catalog lookup, staffing policies, enterprise auth/connectors, managed deployment UX, or dashboard/operator workflows.

The binding answer is now explicit: the SDK supports **repo-visible**, **host-local**, and **env-var override** binding inputs, and the host chooses the default lookup order. `squad-cli` may default to repo-visible first for solo portability; an org-tool may default to host-local first for repo cleanliness. The SDK itself privileges neither.

The Rally answer is also explicit: **Squad has zero hard dependency on Rally.** Rally is one optional consuming host that happens to keep its own operator state in `~/rally/`; `squad-cli` uses `~/.squad/`; an org tool can use whatever state root the organization wants. The SDK knows only the generic state-directory contract, not `~/rally/` itself.

### 3. Problem statement

Brady’s original framing is a mix-and-match matrix, not a single feature request. The system must support all of the following at the same time:

- **N squads, not one squad** — project, team, org, and personal squads may all exist on one machine.
- **Applicability by location** — the answer can change by subdirectory, not just by repo.
- **Multiple storage media** — in-repo, other repo, GitHub release, ADO repo, OneDrive, plain filesystem, npm, and HTTP are all valid sources.
- **Multiple persistence locations** — repo-visible files, host-local overrides, machine-local registry/cache, and host-local operator stores must all be possible.
- **Layering without state bleed** — one authoritative answer per working directory, plus explicit fallbacks and bounded personal overlays.
- **Sharing across people and repos** — one team or org squad should be reusable by many repos and many users.
- **Multiple hosts** — `squad-cli`, Rally, and private org tools must be able to consume the same underlying answer.
- **Trust and governance** — provenance, write boundaries, connector limits, and restricted personal mode must be enforceable in code.

In short: **given any current directory, on any supported host, resolve the right squad stack, explain it plainly, materialize it safely, and preserve the boundary between shared and personal state.**

### 4. Goals (P0 / P1 / P1)

1. **P0:** Org-scale multi-squad flexibility (N squads, applicability, storage medium, location, layering, sharing)
2. **P1:** Minimum custom code
3. **P1:** Contribute upstream to `bradygaster/squad`

### 5. Non-goals

This proposal does **not** attempt to solve the following in v1:

- Building a new first-party org-managed host on top of Squad
- Replacing Rally as the shared-repo / external operator shell
- Requiring Rally, `~/rally/`, or any one host state directory as part of Squad v1
- Forcing all hosts onto one physical on-disk store in v1
- Upstreaming enterprise-specific catalog lookup, staffing rules, SSO plumbing, or connector policy
- Making Squad CLI mandatory for every end user or every deployment model
- Implementing silent multi-authority merge for identity, routing, or automatic writes
- Solving every enterprise deployment problem inside the SDK
- Shipping a public admin service or dashboard product for rollout management
- Treating Tamir’s fork as an alternate trunk or merge queue

The private layer inventory is explicit: **corp catalog, enterprise policy, enterprise auth/connectors, deployment/bootstrap UX, dashboard/operator UX, and managed-machine personal enforcement policy remain private unless Brady later chooses to productize them.**

### 6. Audience

This design serves four user archetypes:

1. **Solo developer** — wants portable Squad behavior with explicit personal control and minimal setup.
2. **Team member** — wants the right shared help to appear by folder or repo, plus plain-English “why here?” status.
3. **Org admin / platform owner** — wants controlled rollout, source registration, trust, and policy enforcement without repo pollution.
4. **OSS maintainer / upstream host maintainer (Squad and Rally)** — wants a small durable contract that avoids duplicated resolution logic.

### 7. The “third path” recommendation

**Recommendation:** upstream the **minimum invariant SDK kernel**, keep **org-specific catalog/policy/deployment/dashboard layers private**, adopt ideas from Tamir’s branches only where they clearly reduce work without importing fork-shaped semantics, and treat Rally as an **optional consuming host** rather than a v1 dependency. In practice, that means building the public center of gravity in `squad-sdk` and `squad-cli`, giving hosts a pluggable binding-location lookup plus a generic state-directory contract, and refusing to upstream enterprise-only behavior.

#### 7.1 v1 build allocation

| Piece | v1 allocation | Why |
|---|---|---|
| **`squad-sdk`** | **✅ invest** | Owns the invariant kernel: source identity, bindings, lookup primitives, resolution, explanation, runtime contract, materialization, re-entry, and policy hooks. |
| **`squad-cli`** | **✅ invest** | Proves the kernel end-to-end as the portable first-party reference host. |
| **Org tool layer** | **✅ invest privately / on top** | Owns corp catalog, enterprise auth, managed-machine policy, and org rollout UX without forcing those choices into upstream Squad. |
| **Rally** | **🔁 optional consumer (no v1 dep)** | Rally may adopt the kernel later, but Squad v1.1 does not require Rally changes or `~/rally/` convergence. |

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

- `SquadSourceRecord`, `SquadBinding`, binding-lookup policy, and state-directory contract shapes
- `resolveSquadStack()` with ambiguity and explanation payloads
- runtime contract export, policy seam, re-entry token, and materialization hook
- `squad-cli` reference flows for source registration, binding, `status`, `explain`, and personal-only mode
- enough trust metadata to support verified/unverified and shared-vs-personal boundaries

**Outcome:** Casey can move between folders and get a correct, plain-English answer on day 1 using `squad-cli`, with no dependency on Rally.

#### Phase 2 — Reference-host parity across `squad-cli` and one org consumer

- the org-tool consumes the SDK contract through host-provided binding lookup order, catalog hints, and auth context
- parity tests assert that the same cwd + bindings produce the same resolution and runtime contract across `squad-cli` and the org consumer
- documentation proves the contract is consumable without `squad-cli` as the user-facing front door

**Outcome:** host choice changes the UX and policy defaults, not the meaning of the underlying resolution contract.

#### Phase 3 — Polish / optional downstream adoption

- cache refresh ergonomics, pin/freeze/rollback hardening
- targeted reuse of `upstream-auto-sync` ideas if needed
- optional Rally adoption work if the team decides the shared-repo host should consume the kernel
- re-evaluate store convergence only if host-local persistence becomes an operational problem

**Outcome:** better operator experience without enlarging the public kernel or making Rally part of the v1 critical path unnecessarily.

### 12. Success criteria

The work counts as shipped when all of the following are true:

1. A single machine can register **multiple named squad sources** across different media.
2. One repo can resolve **different squads in different subdirectories** without duplicate clones.
3. `resolveSquadStack()` returns either a **resolved stack** or an **ambiguity result**; hosts never silently guess across conflicting project mappings.
4. Every host can render a plain-English **“why here?”** explanation from the same reason-code payload.
5. Personal-only mode explicitly states that org/team help is **off here**.
6. A consuming host other than `squad-cli` can start a session from a **runtime contract** without requiring `squad-cli` to be the end-user front door.
7. Binding lookup is explicit and testable across **env-var override**, **repo-visible**, and **host-local** locations.
8. Cross-squad writes are denied by default except for **owner-granted inbox append**.
9. Re-entry validation can confirm **“same answer as yesterday”** or surface drift.
10. The public upstream contribution remains bounded to the kernel; the private inventory stays private; Rally remains optional.

### 13. Open questions

None at v1.1. The three v1.0 open questions are now resolved in the body of the document: binding-location flexibility (§15–§16–§19), SDK-vs-host layering (§15.4, §17, §20.5), and Rally relationship / dependency stance (§21–§22).

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
+------------------------------+   +-----------------------------------------------+   +------------------------------+
| Binding locations            |<->|       Squad SDK kernel (invariant)            |<->| Host state directories       |
| .squad/binding.json          |   |-----------------------------------------------|   | ~/.squad/ ...                |
| ~/.squad/bindings/{repoId}   |   | source IDs • bindings • binding lookup policy |   | ~/rally/ ...                 |
| env-var override             |   | resolveSquadStack() • ambiguity • explanation  |   | org-defined roots            |
+------------------------------+   | runtime contract • materialization • re-entry  |   +------------------------------+
                                   | policy hooks • state-directory contract        |
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

**Annotation:** the SDK kernel is the only semantic center. Hosts own UX, policy defaults, and their chosen state roots above the line; transports and caches sit below the line. The contract must be stable enough that a host can resolve, explain, materialize, and re-enter without inventing its own semantics — and without assuming that `~/.squad/` or `~/rally/` is universal.

### 15. The Squad SDK kernel — invariant contract

In v1.1 the boundary is explicit: the SDK ships **mechanism**; hosts ship **policy, defaults, and UX**. The kernel must not know about corp catalog rules, enterprise auth choreography, or managed-machine enforcement policy.

#### 15.1 Core types

```ts
export type SquadScope = 'project' | 'team' | 'org' | 'personal';
export type LayerMode = 'authoritative' | 'advisory';
export type MaterializationMode = 'worktree' | 'session' | 'local';
export type StateBackendKind = 'worktree' | 'git-notes' | 'orphan' | 'two-layer' | 'external';
export type TrustTier = 't0-personal' | 't1-team' | 't2-org' | 't3-platform';
export type BindingLocationKind = 'env-override' | 'host-local' | 'repo-visible';
export type SquadTransport =
  | 'path'
  | 'git'
  | 'github-release'
  | 'ado-git'
  | 'onedrive-path'
  | 'npm'
  | 'http';

export type ReasonCode =
  | 'binding.env-override'
  | 'binding.host-local'
  | 'binding.repo-visible'
  | 'binding.nearest-match'
  | 'binding.user-default'
  | 'binding.personal-only'
  | 'binding.personal-disabled'
  | 'binding.source-excluded'
  | 'fallback.team'
  | 'fallback.org'
  | 'fallback.personal-overlay'
  | 'policy.personal-restricted'
  | 'policy.restricted-tools'
  | 'ambiguity.multiple-projects'
  | 'reentry.source-drift'
  | 'reentry.policy-drift';

export interface BindingLookupPolicy {
  orderedLocations: BindingLocationKind[];
  repoBindingPath?: string; // default .squad/binding.json
  hostBindingRoot?: string; // default ~/.squad/bindings
}

export interface SquadStateDirectoryContract {
  hostId: string;
  stateRoot: string;
  bindingRoot?: string;
  cacheRoot: string;
  receiptRoot?: string;
}
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
  stateDirectoryContract: SquadStateDirectoryContract;
  approvedTools: string[];
  restrictedTools: string[];
  authContext: { mode: 'inherit-host' | 'host-provided'; descriptor?: string };
  policyMode: 'normal' | 'personal-only' | 'restricted-personal';
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

| Entry point | Signature | Ownership | Behavior contract | Error / edge-case semantics | Stability |
|---|---|---|---|---|---|
| Resolve stack | `resolveSquadStack(cwd: string, options?: ResolveSquadStackOptions): Promise<SquadResolutionResult>` | **SDK (mechanism)** | Resolve the current directory to exactly one primary authoritative layer plus ordered fallbacks and personal mode, or return ambiguity. Must consume host-supplied binding lookup order, optional project hints, and optional state-directory contract. | Return `kind: 'ambiguous'` instead of guessing when multiple project mappings match. Throw only for malformed config, unreadable required files, or impossible internal states. | **v1 frozen** for result shape and lookup semantics. |
| Ambiguity result | `type SquadResolutionResult = { kind: 'resolved'; resolution: SquadResolution } | { kind: 'ambiguous'; ambiguity: SquadAmbiguity }` | **SDK (mechanism)** | Hosts branch on a discriminated union. Ambiguity must include candidate project/source options and reason codes. | Never collapse ambiguity into “best effort”. Empty candidate set is an error; 2+ candidates is valid ambiguity. | **v1 frozen**. |
| Explain selection | `explainSquadSelection(input: SquadResolution): SquadExplanation` | **SDK (mechanism)** | Produce host-neutral reason codes and short human-readable summaries. Must include positive layers and explicit exclusions/off states. | If explanation cannot be derived, return a synthetic policy/internal message rather than host-specific prose. | **v1 frozen** for payload shape and code strings; host wording is not. |
| Source registration | `registerSquadSource(record: SquadSourceRecord): Promise<void>` | **SDK (mechanism)** | Persist a source record into the machine registry without fetching content. | Reject duplicate `sourceId` with conflicting locator/transport. Allow idempotent re-registration with same identity. | **v1 frozen**. |
| Source refresh / pin | `refreshSquadSource(sourceId: string, opts?: RefreshOptions): Promise<SquadSourceRecord>` / `pinSquadSource(sourceId: string, revision: string): Promise<SquadSourceRecord>` | **SDK (mechanism)** | Fetch or re-resolve the source, update lock state, and preserve immutable cache history. | Unverified sources may refresh, but runtime may later load them read-only. Missing transport credentials surface as recoverable source errors. | **v1 frozen** for semantics; transport-specific options may expand experimentally. |
| Read / write bindings | `readSquadBindings(cwd: string, options?: BindingLookupPolicy): Promise<BindingSet>` / `writeSquadBinding(target: BindingTarget, binding: SquadBinding): Promise<void>` | **SDK (mechanism)** | Read or persist bindings in repo-visible or host-local locations; SDK validates schema and path normalization, but the host chooses default location order. | Invalid repo-relative paths are fatal validation errors. Location precedence is explicit, not implicit. | **v1 frozen**. |
| Runtime contract export | `createSquadRuntimeContract(resolution: SquadResolution, host: HostContext): Promise<SquadRuntimeContract>` | **SDK (mechanism)** | Convert resolution + host context into the full session handoff: stack, explanation, active write layer, tool policy, auth descriptor, state-directory contract, and re-entry token. | Missing host policy inputs default to least privilege. Contract creation must never widen permissions implicitly. | **v1 frozen** for core fields; host extension bag may be experimental. |
| Materialization hook | `materializeResolvedSquad(contract: SquadRuntimeContract, input: MaterializeInput): Promise<MaterializedSquad>` | **SDK (mechanism)** | Produce the effective `.squad/` content for a worktree, session dir, or local target. Must preserve source provenance and generate a materialization receipt. | If a layer cannot be materialized, fail the materialization; do not silently drop a required layer. Advisory personal layers may be omitted only when policy mode disables them and the receipt says so. | **v1 frozen** for input/output contract; physical optimization strategy is experimental. |
| Re-entry / drift | `validateReentry(token: SquadReentryToken, cwd: string): Promise<ReentryCheck>` | **SDK (mechanism)** | Determine whether the same directory still resolves to the same answer. | Return `status: 'drifted'` with explanation instead of throwing when revisions, bindings, or policy changed. | **v1 frozen**. |
| Policy seam | `authorizeSquadWrite(contract: SquadRuntimeContract, request: WriteRequest): WriteDecision` and `evaluateSquadPolicy(contract: SquadRuntimeContract): PolicyDecision` | **SDK (mechanism)** | Centralize write ACL primitives, destination classes, and restricted-tool evaluation hooks. Hosts provide the actual policy inputs and may tighten the result. | Default deny across namespaces. Foreign writes may only target owner-approved inbox paths. | **v1 frozen** for decision semantics. |

#### 15.3 Required supporting types

```ts
export interface ResolveSquadStackOptions {
  hostId?: 'squad-cli' | 'rally' | 'org-tool' | string;
  bindingLookupPolicy?: BindingLookupPolicy;
  hostProjectHints?: Array<{
    projectKey: string;
    displayName: string;
    path: string;
    proposedPrimarySourceId?: string;
  }>;
  stateDirectoryContract?: SquadStateDirectoryContract;
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

#### 15.4 Boundary reclassification in v1.1

| Surface | v1.1 owner | Rationale |
|---|---|---|
| Binding lookup primitives, resolution, explanation, runtime contract, materialization, re-entry, write-policy hooks | **SDK (mechanism)** | At least two hosts must share these semantics. |
| Binding-location **default order** (`repo-visible` first vs `host-local` first) | **Host (policy)** | The SDK supports both; the host decides which is the default for its environment. |
| Corp catalog discovery / repo-to-project mapping | **Host (policy)** — org-tool | This is organizational data and should arrive as host hints, not SDK-owned discovery rules. |
| Enterprise auth flows / connector injection | **Host (policy)** — org-tool | The SDK may carry an auth descriptor, but it must not own enterprise auth choreography. |
| Managed-machine personal enforcement | **Host (policy)** — org-tool | The SDK ships restriction primitives; the org layer decides when and how to enforce them. |
| Dashboard, onboarding, dispatch UI, and operator workflows | **Host (policy / UX)** — `squad-cli`, Rally, org-tool | Different hosts should feel different without redefining the kernel. |

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

#### 16.2 Repo-visible binding file — `.squad/binding.json`

```ts
export interface SquadBindingFileV1 {
  version: 1;
  bindings: SquadBinding[];
}
```

Semantics:

- shareable, repo-visible binding intent
- nearest matching `path` wins within the file
- `personalMode: 'only'` disables all shared layers for that path

#### 16.3 Host-local binding file — `~/.squad/bindings/{repoId}.json`

```ts
export interface HostLocalSquadBindingFileV1 {
  version: 1;
  repoId: string;
  bindings: SquadBinding[];
}
```

Semantics:

- host-local, non-committed binding intent
- uses the same binding shape as the repo-visible file
- may be the primary binding location or the fallback binding location depending on host policy

#### 16.4 Env-var override

The env-var override is an explicit escape hatch above both on-disk locations. The SDK reserves a host-normalized override input with the following effective shape:

```ts
export interface SquadBindingEnvOverrideV1 {
  bindingFile?: string; // absolute path to a binding file
  sourceIds?: string[];
  personalMode?: 'overlay' | 'only' | 'disabled';
}
```

Example reserved inputs: `SQUAD_BINDING_FILE`, `SQUAD_BINDING_SOURCE_IDS`, and `SQUAD_PERSONAL_MODE`. Hosts may wrap these in flags or richer UX, but the precedence is the same: env-var override wins.

#### 16.5 Machine registry — `~/.squad/registry-v2.json`

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

#### 16.6 Lockfile — `~/.squad/locks/sources.lock.json`

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

#### 16.7 Per-target materialization receipt

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

#### Binding-location lookup precedence

The SDK supports all three binding inputs without privileging one universally. Lookup works as follows:

1. **Env-var override** (if present)
2. **First matching on-disk binding location from the host’s ordered lookup policy**
3. **Machine registry defaults**
4. **Legacy single-squad fallback**

Default lookup orders are host policy, not SDK policy:

- **Solo / `squad-cli` default:** `repo-visible` → `host-local`
- **Org-tool default:** `host-local` → `repo-visible`
- **Rally if adopted later:** `host-local` → `repo-visible`, while Rally still keeps its own operator state in `~/rally/`

### 17. Host responsibilities (what the SDK does NOT own)

#### 17.1 `squad-cli`

| `squad-cli` owns | `squad-cli` does not own |
|---|---|
| first-run welcome/bootstrap UX | resolution semantics |
| source add/list/remove/update/pin/freeze commands | policy decisions |
| bind/unbind/status/explain rendering | ambiguity ranking logic |
| the **solo default** binding lookup order (`repo-visible` → `host-local`) | materialization semantics |
| local diagnostics and trust display | enterprise catalog lookup |
| `~/.squad/` as the CLI’s chosen host state root | any universal host-state-directory rule |

#### 17.2 Rally (optional consuming host)

| Rally owns | Rally does not own |
|---|---|
| dashboard, issue/PR dispatch, attach/open/log flows | source identity model |
| worktree creation and lifecycle | resolution algorithm |
| `~/rally/` operator state and bookkeeping | trust / ACL semantics |
| any Rally-local rule UI or status rendering | runtime contract schema |
| optional future adoption of the Squad kernel | cross-squad write logic |

#### 17.3 Org tool

| Org tool owns | Org tool does not own |
|---|---|
| corp catalog lookup and repo-to-project mapping | stack resolution meaning |
| enterprise auth, connector injection, policy UX | source/binding core types |
| managed deployment/bootstrap | reason-code semantics |
| tighter managed-machine personal policy on corp boxes | materialization contract shape |
| the **org default** binding lookup order (`host-local` → `repo-visible`) | re-entry meaning |

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
function resolveSquadStack(cwd, options):
  normalize cwd
  discover repo root / worktree root / host context

  bindingInputs = collect in precedence order:
    1. env-var override (if any)
    2. on-disk binding locations in host-provided orderedLocations
       - e.g. repo-visible -> host-local for squad-cli
       - e.g. host-local -> repo-visible for org-tool
    3. machine registry defaults
    4. legacy single-squad fallback

  effectiveBinding = first matching binding set found in that order

  if hostProjectHints identify multiple projects for cwd
    and effectiveBinding does not disambiguate:
      return ambiguous(candidates, reason = ambiguity.multiple-projects)

  if effectiveBinding.personalMode == 'only':
      primary = personal source
      fallbacks = []
      exclusions = all shared sources
  else:
      primary = effectiveBinding.primarySourceId if present
             else legacy project-local source if present
             else first matching default source

      fallbacks = explicit fallbackSourceIds in order
      append personal overlay only when allowPersonal == true and personalMode != 'disabled'

  dedupe by sourceId while preserving primary + fallback order

  compute activeWriteLayer:
      first authoritative layer unless personalMode == 'only'
      personal layer writes only to personal namespace

  build explanation payload:
      include which binding location won
      include why primary matched
      include why fallbacks were added
      include what was explicitly excluded/off
      include policy notes (restricted personal, restricted tools)

  return resolved(primary, fallbacks, activeWriteLayer, explanation)
```

Required behavior:

- **Binding lookup order is explicit and host-provided.** The SDK does not hardcode repo-visible or host-local as universally first.
- **Nearest binding wins within one binding file.**
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

The SDK exposes **mechanisms**, not corp policy. Minimum upstream mechanism:

- runtime contract can declare `policyMode: 'restricted-personal'`
- local-only memory scope is representable
- shared publishing can be denied by policy hooks
- restricted-tool lists are visible in the runtime contract

The **host policy** decides when those mechanisms activate:

- org-tool chooses when a managed machine enters restricted personal mode
- org-tool decides whether enterprise connectors or auth descriptors are available
- hosts may tighten restrictions further, but the SDK must not silently enforce an org-specific rule on its own

### 21. Materialization & worktree integration

**Decision:** materialization is a public SDK hook; the exact physical optimization and the host’s chosen state directory are host-specific.

#### Contract

1. Host resolves the stack.
2. Host creates a runtime contract.
3. SDK materializes the effective `.squad/` view for a target directory.
4. SDK writes a materialization receipt.
5. Host starts the session against that materialized view.

#### Materialization modes

- **`worktree`** — used by Rally and any worktree-based host. Effective `.squad/` content is placed inside the dispatch worktree.
- **`session`** — used by a host that stages a session workspace outside the repo.
- **`local`** — used by `squad-cli` for direct repo-local operation or inspection.

#### Physical strategy

- **Default semantic model:** copy/generate the effective `.squad/` tree into the target.
- **Allowed optimization:** hosts may use symlink/junction/cached read-only overlay internally for immutable source snapshots, but correctness must not depend on links.
- **Never assume repo-root-only symlinking.** The effective squad is per resolved directory, not per repo.

#### Rally relationship

**Position:** the Squad SDK kernel has **zero hard dependency on Rally**. Rally is **one optional consuming host** that happens to own its own state directory (`~/rally/`) and its own operator shell.

What we take from Rally as **inspiration / compatibility surface**:

- the `.worktrees/` mechanics pattern for dispatch targets
- the operator-shell shape (dashboard, attach/open/log, dispatch lifecycle)
- the expectation that an external host may want repo-clean, non-committable operation

What we do **not** take as a dependency:

- `~/rally/` as an SDK-known path
- Rally dashboard/session bookkeeping
- Rally’s `gh` orchestration model
- Rally onboarding, trust prompts, or worktree bookkeeping

The generic rule is: the SDK exports a **state-directory contract**; each host chooses its own roots. `squad-cli` uses `~/.squad/`; Rally uses `~/rally/`; an org tool uses whatever the organization wants. The SDK should not know or care which one it is talking to beyond the host-declared contract.

### 22. Upstream contribution plan

#### 22.1 `bradygaster/squad` — target branch `dev`

| Order | Proposed PR title | Scope | Contributability | Expected reviewer concerns |
|---|---|---|---|---|
| 1 | `feat(sdk): add binding lookup policy and state-directory contract` | `BindingLocationKind`, `BindingLookupPolicy`, `SquadStateDirectoryContract`, docs | 🟢 | naming, path neutrality, avoiding host leakage |
| 2 | `feat(sdk): add source identity and binding record types` | `SquadSourceRecord`, `SquadBinding`, repo-visible + host-local binding readers, docs | 🟢 | schema minimalism, migration path for legacy `.squad/`, repo-id shape |
| 3 | `feat(sdk): add layered resolveSquadStack with ambiguity result` | precedence rules, ambiguity return, explanation seed data | 🟢 | API sprawl, backward compatibility, monorepo ambiguity behavior |
| 4 | `feat(sdk): add explanation payloads, runtime contract, re-entry, and policy primitives` | reason codes, `explainSquadSelection`, `createSquadRuntimeContract`, `validateReentry`, policy seam | 🟡 | whether explanation belongs in SDK vs host, contract size, auth/policy boundary |
| 5 | `feat(sdk): add materialization hook` | `materializeResolvedSquad`, receipts, target modes | 🟡 | host leakage, mode naming, failure semantics |
| 6 | `feat(cli): add source/bind/status/explain reference-host flows` | thin first-party UX over the SDK, solo-dev default binding lookup order | 🟢 | command naming, default binding order, migration from older CLI flows |
| 7 | `docs(sdk): publish consuming-host guide for org hosts and optional Rally adopters` | resolve → explain → contract → materialize guide | 🟢 | scope discipline, examples vs guarantees |

#### 22.2 Optional downstream adoption — Rally or any other consuming host

No Rally PR is required for Squad v1.1 to land. If the team later chooses to adopt the kernel in Rally, that work is a **separate optional initiative**, not the critical path.

| Initiative | Scope | Critical path? |
|---|---|---|
| Compatibility note | document Rally as an optional consuming host with its own `~/rally/` state | **No** |
| Dispatch integration | have Rally resolve → contract → materialize per worktree | **No** |
| Dashboard/status follow-on | render active squad / explanation in Rally UX | **No** |

### 23. The “what we keep private” inventory

The following remain private by default:

1. **Corp catalog** — repo/project/team discovery and staffing overrides
2. **Enterprise auth / connector policy** — identity providers, connector injection, approved enterprise-only capabilities
3. **Deployment/bootstrap** — MDM packages, machine manifests, rollout rings, corp install UX
4. **Dashboard/operator UX** — company-specific control planes, cross-repo fleet views, internal status pages
5. **Managed-machine personal enforcement policy** — when to restrict personal mode and what restrictions to apply
6. **Host-specific operator bookkeeping** — e.g. Rally’s `~/rally/active.yaml` and similar host-private stores

These may consume the kernel; they do not define it.

### 24. Implementation guidance — minimum viable code surface

Build in this order.

1. **Reuse current Squad state substrate first**
   - Start from existing `packages/squad-sdk/src/state-backend.ts` and `packages/squad-sdk/src/resolution.ts`
   - Treat Tamir’s `feat/state-backend-global-996` as already-harvested architectural input, not a branch to merge

2. **Add the host-neutral binding lookup and state-directory contract**
   - pluggable binding locations
   - host-declared lookup order
   - host-declared state roots

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

5. **Integrate one org consumer on top of the SDK**
   - pass catalog hints from the host
   - pass auth descriptors from the host
   - enforce managed-machine policy in the host

6. **Optionally adapt Rally later**
   - folder-aware rules
   - status display
   - dispatch-time materialization

7. **Only then consider selective follow-ons from Tamir ideas**
   - `upstream-auto-sync` watch/propose behavior, if and only if refresh ergonomics still hurt after the kernel exists

### 25. Testing & acceptance

#### 25.1 Automated tests

At minimum, add SDK tests that prove:

- registry and binding schemas round-trip cleanly
- repo-visible, host-local, and env-var override lookup order is explicit and testable
- nearest binding wins by path within one binding file
- fallback order is stable and explicit
- ambiguity returns candidates instead of guessing
- personal-only and personal-disabled modes behave distinctly
- explanation payloads include positive and excluded layers
- runtime contract preserves active write layer, tool restrictions, state-directory contract, and re-entry token
- materialization receipts reflect all resolved layers
- `validateReentry()` detects source drift and policy drift
- `authorizeSquadWrite()` denies foreign canonical writes and allows inbox append when granted

#### 25.2 Manual acceptance checks

Validate Casey’s day-1 across the required hosts first, then optional downstream consumers:

1. **`squad-cli` (required)**
   - one repo with two subdirectories resolves differently
   - `status` explains the answer plainly
   - personal-only repo explicitly turns shared help off

2. **Org tool (required)**
   - repo-root ambiguity is surfaced, not guessed
   - project A resolves to org fallback while project B resolves to team
   - unregistered repo enters restricted personal mode with restricted tools visible

3. **Rally (optional downstream compatibility)**
   - if Rally adopts the kernel later, two issues from one repo can dispatch into separate worktrees with different effective squads
   - Rally renders the same explanation payload semantics without re-implementing resolution logic

#### 25.3 Cross-host parity assertion

For a shared fixture repo and binding set, required hosts must agree on:

- primary source ID
- ordered fallback IDs
- personal mode
- active write layer
- reason codes
- re-entry drift result

Rally joins the parity matrix only if and when the optional downstream initiative happens.

### 26. Glossary

- **Squad** — the human/AI operating model: roster, routing, skills, memory, and governance.
- **Source** — the authoritative home of a reusable squad definition, identified by stable source ID.
- **Binding** — the rule that says which source is primary for a path, what falls back, and how personal mode behaves.
- **Binding location** — where a binding is stored: repo-visible, host-local, or env-var override.
- **Pluggable binding location lookup** — host-provided ordered search across supported binding locations; the SDK consumes the order but does not privilege one universally.
- **Stack** — the ordered set of layers visible for one current working directory.
- **Resolution** — the act of mapping a cwd to a concrete stack or an ambiguity result.
- **Host** — the user-facing shell that consumes the kernel, such as `squad-cli`, Rally, or an org tool.
- **Consuming host** — a host that adopts the Squad kernel without owning its semantics; Rally is one optional example.
- **SDK state-directory contract** — the host-declared mapping of state/cache/binding roots the SDK may use without assuming one universal path.
- **Materialization** — creating the effective `.squad/` content for the target workspace or session.
- **Personal-only mode** — an explicit rule that disables shared layers for a path and keeps only the personal workspace active.
- **Org tool** — a private company-standard developer shell that consumes the Squad kernel without exposing Squad-native UX directly.
- **Pivot heuristic** — the pre-decided rule set for abandoning the upstream path and shipping independently.

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
- `.squad/decisions/inbox/copilot-directive-2026-05-17-binding-flexibility.md` — Brady directive establishing binding-location flexibility as a first principle.
- `.squad/decisions/inbox/copilot-directive-2026-05-17-squad-layering-principle.md` — Brady directive establishing the org-vs-public boundary rule.

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
- **Binding location** — the storage location for binding intent (`.squad/binding.json`, `~/.squad/bindings/{repoId}.json`, or env override)
- **Pluggable binding location lookup** — host-provided ordered search through supported binding locations
- **Stack** — ordered layers for one cwd
- **Active write layer** — the one authoritative destination for automatic shared-state writes
- **Runtime contract** — the machine-readable handoff a host uses to start a session
- **Materialization** — producing the effective `.squad/` view for a target workspace
- **Consuming host** — a host that consumes the kernel without owning its semantics
- **SDK state-directory contract** — the host-declared state/cache/binding roots used by the SDK
- **Personal-only mode** — explicit exclusion of all shared layers
- **Pivot heuristic** — the pre-agreed trigger set for abandoning upstream

#### Existing terms redefined

- **`TEAM_ROOT`** — no longer “the only squad root”; it becomes a backward-compatible alias for the primary authoritative root or active write layer root.
- **Personal squad** — no longer just ambient discovery under Ghost Protocol; it becomes an explicit layer with policy mode (`overlay`, `only`, or `disabled`).
- **Host** — no longer implies one storage root; it now means a UX shell that consumes the SDK contract and declares its own state roots.
- **Consult mode** — remains a host behavior, especially in Rally, but is no longer the only model for personal participation.
- **Worktree setup** — shifts from one static squad copy to per-dispatch materialization of the resolved stack.

#### Existing terms deprecated

- **Single team-root chain as the universal resolver** — replaced by layered resolution plus binding-location lookup.
- **“One repo = one squad” assumption** — replaced by per-directory applicability.
- **CLI as the universal operator surface** — replaced by CLI as the reference host.
- **Repo-root-only effective `.squad/` symlink model** — replaced by target-specific materialization.
- **Rally as a required v1 dependency** — replaced by Rally as an optional downstream consuming host.

This vocabulary update is the coordinator-prompt delta Procedures should carry forward when converting today’s single-root wording into the layered stack model.
