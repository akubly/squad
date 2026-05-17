### Flight — Multi-Squad Solution Shape: Recommendation (Round 4)

**Date:** 2026-05-16T00:07:22-07:00  
**Requested by:** Brady  
**Status:** RECOMMENDED SHAPE FOR BUILD ALLOCATION

## 1) Recommended shape — one sentence

Invest in **(a) squad-sdk modifications + (b) squad-cli modifications + (d) Rally modifications**, keep **(c) Rally as-is** only as today’s starting base and **do not build (e) a new first-party standalone host in v1**.

## 2) What each piece does

| Piece | Invest? | What lives here | Why this layer |
|---|---|---|---|
| **(a) Modification of squad-sdk** | **YES** | The invariant host contract: source records, per-directory resolution, ambiguity reporting, explanation payloads, runtime contract export, policy enforcement, state-backend selection, and effective squad materialization. | These are the capabilities every viable front door must share. If this logic lives in one host, the other hosts drift immediately. |
| **(b) Modification of squad-cli** | **YES** | The first-party reference host: welcome/bootstrap UX, source/binding commands, human-readable status/explain flows, explicit personal choices, and local diagnostics. | `squad-cli` should prove the contract end-to-end on an unmanaged machine and remain the portable host users can carry between environments. |
| **(c) Rally as-is** | **NO** | Keep its existing consult/worktree/dashboard value, but do not treat the current behavior as sufficient for the multi-squad story. | As-is Rally is repo-centric and assumes one effective squad too often. Casey’s folder-level and per-dispatch needs require real changes, not documentation. |
| **(d) Modification of Rally** | **YES** | Rally owns shared-repo operator UX: squad source registration inside Rally, folder/repo selection rules, dashboard visibility of active squad, and worktree-time materialization of the effective squad for each dispatch. | That is Rally’s natural surface. Rally should consume the SDK contract, then add dispatch/operator affordances the CLI should not own. |
| **(e) New standalone tool on top of Squad** | **NO for v1** | None in v1. Future-only if Brady decides Squad itself must ship a first-party org-managed host. | The org-tool path is real, but the right v1 move is to support it through the SDK contract, not to build and own a fourth product surface. |

## 3) SDK boundary contract (the invariant)

This is the line that must be stable across `squad-cli`, Rally, and any org host. The SDK should stay tight: **contract, policy, and materialization only**.

| Capability | API surface | Input / output shape | Why it belongs in SDK |
|---|---|---|---|
| Resolve current squad roots | **Existing:** `resolveSquad()`, `resolveSquadPaths()`, `loadDirConfig()`, `resolveUpstreams()`, `resolveStateBackend()` | `cwd -> ResolvedSquadPaths`, upstream context, selected state backend | Current base primitives already live here and should remain host-neutral. |
| Resolve the full multi-squad stack | **Add:** `resolveSquadStack(input)` | `ResolveSquadStackInput { cwd, hostId?, overrides?, catalogHints? } -> SquadResolutionResult` where result is either `resolved` or `ambiguous` | Every host needs the same per-directory answer. |
| Report ambiguity instead of guessing | **Add:** `type SquadResolutionResult = { kind: 'resolved'; resolution: SquadResolution } | { kind: 'ambiguous'; candidates: SquadCandidate[] }` | `SquadCandidate { projectKey, displayName, path, reasonCodes[] }` | Repo-root ambiguity is invariant logic, not host copy. |
| Explain the answer in machine-readable form | **Add:** `explainSquadSelection(resolution)` | `SquadExplanation { summary, reasonCodes[], positiveLayers[], excludedLayers[] }` | Hosts should render different UX, but not invent different reasons. |
| Model source records and trust | **Add:** `registerSquadSource()`, `refreshSquadSource()`, `pinSquadSource()`, `removeSquadSource()` | `SquadSourceRecord { sourceId, name, scope, transport, locator, trust, revision, cachePath }` | Source identity, provenance, and cache semantics must stay consistent. |
| Model bindings and exclusions | **Add:** `readSquadBindings()`, `writeSquadBinding()`, `removeSquadBinding()` | `SquadBinding { scopePath, primarySourceId, fallbackSourceIds[], allowPersonal, personalOnly, excludedSourceIds[] }` | Hosts may present different flows, but the binding model must be shared. |
| Export the runtime contract | **Add:** `createSquadRuntimeContract(resolution, hostContext)` | `SquadRuntimeContract { workspace, stack, activeWriteLayer, memoryScope, stateBackend, trust, approvedTools, restrictedTools, authContext, reentryToken }` | This is the handoff every host needs before starting a session. |
| Materialize the effective squad into a target workspace | **Add:** `materializeResolvedSquad(contract, target)` | `MaterializeInput { contract, targetDir, mode: 'worktree' | 'session' | 'local' } -> MaterializedSquad { squadDir, files, cleanup? }` | Rally and org hosts need this; repo-root-only semantics are not enough. |
| Enforce write/policy rules | **Add:** `authorizeSquadWrite(contract, artifact)` and `evaluateSquadPolicy(contract)` | `WriteDecision { allowed, reason, targetLayer }`; `PolicyDecision { mode, restrictedTools, publishAllowed }` | Security/governance cannot live in host-specific prompt copy. |
| Preserve next-day stability | **Add:** `validateReentry(token, cwd)` | `ReentryCheck { unchanged | drifted, explanation }` | Casey’s “same answer tomorrow” check is invariant across hosts. |

### Canonical data shapes

```text
SquadSourceRecord
- sourceId, name, scope, transport, locator, trust, revision, cachePath

SquadBinding
- scopePath, primarySourceId, fallbackSourceIds[], allowPersonal, personalOnly, excludedSourceIds[]

SquadResolution
- cwd, primary, fallbacks[], personal, activeWriteLayer, stateBackend, reasonCodes[], excludedLayers[]

SquadRuntimeContract
- workspace, stack, activeWriteLayer, memoryScope, stateBackend, approvedTools[], restrictedTools[], trust, authContext, reentryToken
```

## 4) Host responsibilities

### squad-cli (recommended investment)

`squad-cli` owns:
- first-run onboarding (`welcome`), bootstrap import, and unmanaged-machine setup
- user-facing source and binding workflows
- plain-English `status`, `explain`, and `choose` UX
- local diagnostics (`doctor`, refresh/pin/update views)
- reference implementation of personal-only and fallback choices

`squad-cli` does **not** own:
- resolution semantics
- policy evaluation
- state-backend rules
- materialization semantics
- source-of-truth explanation logic

### Rally (recommended investment)

Rally owns:
- dashboard and dispatch UX
- project/folder registration inside Rally
- showing the active squad next to issues/PRs
- per-dispatch effective squad materialization into worktrees
- attach/open/log flows for shared-repo and clean-repo workflows

Rally does **not** own:
- source semantics
- folder-resolution logic
- trust/policy semantics
- the runtime contract format

### Org tool (supported consumer, not built by us)

The org host owns:
- corp catalog lookup
- repo/project mapping policy
- enterprise auth and connector injection
- managed-machine bootstrap and approved-tool policy UX
- any sandbox rules stricter than the SDK minimum

The org host should consume the same SDK contract and should not re-implement resolution logic.

## 5) Minimum viable trio for Casey’s day-1

### Non-negotiable SDK additions

1. `resolveSquadStack()` with per-directory resolution and ambiguity return
2. `explainSquadSelection()` with reason codes plus explicit negative state
3. `createSquadRuntimeContract()` for host handoff before session start
4. `materializeResolvedSquad()` for worktree/session targets
5. shared source + binding record shapes (`SquadSourceRecord`, `SquadBinding`)
6. policy helpers for personal-only / sandboxed-personal / restricted-tool modes
7. re-entry validation so hosts can confirm drift or sameness on day 2

### Non-negotiable squad-cli changes

1. `squad welcome` as the first-run, portable bootstrap surface
2. source registry commands and binding commands on top of SDK records
3. `squad status` / `squad explain` that render SDK reasons cleanly
4. an explicit choice flow for personal-only and “company/team help off here”
5. one-line re-entry banner at `squad start`

### Non-negotiable Rally changes

1. `rally squad add` (source registration in Rally UX)
2. `rally squad use` (folder/repo selection rule)
3. `rally squad status` (trust-building explanation)
4. dashboard display of active squad per dispatch target
5. worktree-time materialization from SDK runtime contract

### What an org-tool needs from us without us building it

1. the SDK APIs above, documented as a supported host contract
2. stable data shapes for sources, bindings, resolution, and runtime contracts
3. a small reference integration guide showing: resolve → explain → create contract → materialize → start session
4. no dependency on `squad-cli` being installed by the end user

## 6) Phased build sketch

### Phase 1 — MVP
- Add the SDK contract: stack resolution, ambiguity, explanation payloads, runtime contract, materialization
- Ship the `squad-cli` reference path (`welcome`, `status`, `explain`, explicit personal choice)
- Publish the host-integration contract for Rally and org hosts

### Phase 2 — parity across hosts
- Upgrade Rally to consume the SDK contract end-to-end
- Add Rally source registration, folder rules, status, and dashboard visibility
- Prove an org-host integration path with docs/examples, not a new first-party product

### Phase 3 — polish / optional
- richer cache/update UX, drift reporting, and pin/rollback workflows
- optional admin-side publishing/signing helper if org bootstrapping becomes painful
- nicer dashboard and health views on top of the same SDK records

## 7) What we explicitly are NOT building

- No new first-party org-managed host in v1
- No split-brain ownership where both CLI and Rally own resolution logic
- No silent multi-authority merge for identity or automatic writes
- No SDK-owned corporate catalog, staffing system, or enterprise policy engine
- No requirement that every user install `squad-cli` to benefit from Squad
- No attempt to solve every org bootstrap problem inside the SDK

## 8) The one big risk

**Risk:** the SDK boundary balloons until it starts owning host UX instead of the invariant contract.

**Mitigation:** only add SDK surfaces that at least two hosts must share. If a behavior is presentation, copy, dashboard layout, onboarding choreography, or enterprise catalog policy, it stays in the host. The SDK gets the answer; the host gets the experience.

## 9) Short comparison table

| Capability need | SDK | squad-cli | Rally (mod) | org-tool |
|---|---|---|---|---|
| Source schema + cache semantics | ✅ owns | 🔁 consumes | 🔁 consumes | 🔁 consumes |
| Source registry UX | ❌ N/A | ✅ owns | ✅ owns | ✅ owns |
| Per-directory resolution | ✅ owns | 🔁 consumes | 🔁 consumes | 🔁 consumes |
| Ambiguity handling contract | ✅ owns | 🔁 consumes | 🔁 consumes | 🔁 consumes |
| Plain-English explanation payload | ✅ owns | 🔁 consumes/render | 🔁 consumes/render | 🔁 consumes/render |
| Binding persistence model | ✅ owns | 🔁 manages via SDK | 🔁 manages via SDK | 🔁 manages via SDK/policy |
| State backend selection | ✅ owns | 🔁 displays | 🔁 consumes | 🔁 consumes |
| Runtime contract export | ✅ owns | 🔁 consumes | 🔁 consumes | 🔁 consumes |
| Effective squad materialization | ✅ owns | 🔁 may use locally | 🔁 consumes heavily | 🔁 consumes |
| Dashboard / dispatch UX | ❌ N/A | ❌ N/A | ✅ owns | ✅ owns |
| Corp catalog / SSO / connector policy | ❌ N/A | ❌ N/A | ❌ N/A | ✅ owns |
| Personal-only / sandbox policy evaluation | ✅ owns minimum | 🔁 surfaces | 🔁 surfaces | 🔁 may tighten |

## 10) Verdict on (e) — a new standalone tool

**Verdict: no, we are not building one in v1.**

Why:
- the problem is a shared contract problem, not a missing-fourth-host problem
- `squad-cli` already covers the portable first-party path
- Rally already covers the dispatch/operator path once upgraded
- org-managed environments should integrate at the SDK boundary, not wait for us to ship their tool

**Revisit only if** Brady explicitly decides Squad must ship a first-party managed-host product because multiple design partners need the same org UX and neither `squad-cli` nor Rally can satisfy that need without unnatural distortion.

## Final verdict

Round 2 was right that the invariant belongs below any one host. Round 3 was right that the host assumption had to move out of the CLI. The decisive recommendation is therefore: **make the SDK contract the product center, make `squad-cli` the portable reference host, make Rally the dispatch-centric host, and support org tools without becoming one.**
