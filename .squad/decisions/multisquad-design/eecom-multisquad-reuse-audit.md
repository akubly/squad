### EECOM — Multi-Squad Reuse-vs-New Audit

**Author:** EECOM  
**Requested by:** Brady  
**Date:** 2026-05-16T00:14:13-07:00

## Executive verdict

If Brady wants **P0 org flexibility** while honoring **P1 as little custom code as possible**, the cheapest tractable path is:

1. **Reuse the storage substrate already proven in Squad mainline** (the current `state-backend.ts` / `resolution.ts` / preset + sync flows that descended from Tamir's `feat/state-backend-global-996`)  
2. **Reuse Rally's existing operator shell unchanged where it is already strong** (`~/rally/` bookkeeping, `.worktrees/` placement, host/agent split, dashboard/session lifecycle)  
3. **Build only the missing invariant layer net-new in `squad-sdk`** (stack resolution, ambiguity, explanation, runtime contract, effective materialization)  
4. **Make thin host changes** in `squad-cli` and Rally on top of that contract.

That keeps the permanent custom surface concentrated in one place: the SDK contract every host must share.

---

## 1) Tamir branches: what is useful as-is vs what is already upstream vs what is a trap

| Branch | What it covers | Can we pull/cherry-pick it? | Upstream merge status | If adopted wholesale, how much of the recommended shape does it satisfy? |
|---|---|---|---|---|
| **`feat/state-backend-global-996`** | Pluggable state backends (`local`, `git-notes`, `external`, `orphan`, `two-layer`), repo-root-anchored git-notes persistence, preset/init/sync/migrate flows, squad-home mobility. | **Do not adopt wholesale from the fork.** Reuse the **current upstream/mainline implementation** instead; the branch is best treated as the origin of the storage substrate, not as a patch queue. | Fork compare: **24 ahead / 0 behind** vs Tamir `dev`; upstream compare: **0 ahead / 25 behind** vs `bradygaster/squad` `dev` → meaning the idea has effectively already been absorbed/evolved upstream. | **High reuse value, but only for the storage substrate.** It covers backend selection and write-layer plumbing. It does **not** cover source records, folder bindings, ambiguity results, explanation payloads, runtime contract export, or Rally worktree materialization. Roughly **25-35%** of the recommended shape, almost entirely in SDK storage plumbing plus some CLI command substrate. |
| **`feat/upstream-auto-sync`** | Parent→child watch/polling, child→parent propose flow, upstream hashing/snapshots, cached git clones under `.squad/_upstream_repos`, `upstream watch` / `upstream propose`. | **Cherry-pick only targeted pieces later if needed.** The branch is compact (11 files, 2 commits), but it is stale enough that a wholesale merge would still need adaptation. | Fork compare: **2 ahead / 335 behind**; upstream compare: **2 ahead / 384 behind** → still unique, but badly diverged from current mainline. | **Narrow fit.** It can help with **refresh/pin/sync ergonomics** for source records later, but it does **not** solve per-directory stack resolution, ambiguity handling, or materialization. At best **10-15%** of the shape, and only as a follow-on. |
| **`feat/persistent-ralph`** | Persistent `RalphMonitor`, heartbeat workflow, monitor state persistence, crash recovery. | **No wholesale adoption needed.** Current mainline already has a persistent Ralph monitor surface in `packages/squad-sdk/src/ralph/index.ts`. | Fork compare: **3 ahead / 335 behind**; upstream compare: **3 ahead / 384 behind**. Conceptually mostly upstream-adjacent already, but stale. | **Almost none** for this problem. Useful operationally, but it does not move multi-squad source/binding/runtime-contract work. **0-5%**. |
| **`feat/squad-scheduler`** | `.squad/schedule.json` schema, provider-agnostic scheduler, `squad schedule list|run|init|status`, schedule state tracking. | **Do not pull from the fork.** The upstream repo already carries `runtime/scheduler.ts` and `cli/commands/schedule.ts`; use mainline if anything here matters. | Fork compare: **2 ahead / 335 behind**; upstream compare: **2 ahead / 384 behind**. Essentially a stale branch for functionality we already own upstream. | **Not part of the minimum multi-squad shape.** It does not solve source identity, bindings, stack resolution, or materialization. **0-5%**. |
| **`feat/cross-squad-orchestration`** | `.squad/manifest.json`, manifest validation, discovery metadata, `squad discover`, `squad delegate`, cross-repo delegation helpers. | **Reuse concepts, not the branch wholesale.** Current mainline already contains `runtime/cross-squad.ts` and `cli/commands/cross-squad.ts`. Pull only if a specific manifest field or helper is missing. | Fork compare: **2 ahead / 335 behind**; upstream compare: **2 ahead / 384 behind**. Again: mostly upstream-adjacent, branch itself stale. | **Moderate conceptual reuse only.** It helps with **manifest/discovery vocabulary**, but not folder-level selection, ambiguity, explanation, or worktree materialization. Roughly **10-15%** of the target shape. |
| **`feat/communication-adapter`** | GitHub/ADO/file-log channel abstraction, remote auto-detection, ADO work-item discussion transport, enterprise platform concerns. | **Do not pull wholesale.** Current mainline already has `packages/squad-sdk/src/platform/comms.ts` and adapters; the branch is long-diverged and drags solution shape toward enterprise transport concerns before core multi-squad invariants are solved. | Fork compare: **13 ahead / 456 behind**; upstream compare: **13 ahead / 505 behind**. Highly diverged. | **Very low fit for this ask.** It may matter later for an org host's connector layer, but it does not solve the SDK invariant contract. **0-5%**. |

### Bottom line on Tamir's branches

- **Best reuse source:** `feat/state-backend-global-996`, but **reuse it through current upstream Squad mainline**, not by adopting the fork branch wholesale.
- **Best later targeted follow-on:** `feat/upstream-auto-sync`, specifically if Brady wants refresh/watch/propose flows after the stack contract exists.
- **Already effectively upstream / not worth branch adoption:** `persistent-ralph`, `squad-scheduler`, `cross-squad-orchestration`, `communication-adapter`.

---

## 2) Rally pieces reusable as-is vs modify vs fork into SDK

### Reuse unchanged

| Rally asset | Reuse status | Why |
|---|---|---|
| **Central `~/rally/active.yaml` + lock + atomic write bookkeeping** | **Reuse unchanged** | This is Rally-owned operator state, not Squad invariant logic. It already tracks dispatch lifecycle, PIDs/session IDs, and dashboard refresh cleanly. |
| **`.worktrees\...` placement under the repo** | **Reuse unchanged** | This is an implementation win worth keeping. It naturally inherits the parent repo's `node_modules` and reduces the manual linking/junction complexity Squad still documents. |
| **Host-side `gh` orchestration + in-agent deny-list** | **Reuse unchanged** | Rally's host/agent split is already good product architecture: host does GitHub orchestration, dispatched agent gets repo edits + MCP reads but not mutation-heavy CLI tools. |
| **Dashboard/session lifecycle ownership** | **Reuse unchanged** | Dashboard, picker, issue/PR dispatch UI, and session-refresh mechanics are Rally product value and should stay Rally-owned. |

### Modify in Rally

| Rally area | Needed modification | Why the change belongs in Rally |
|---|---|---|
| **Central `~/rally/` store** | Add **source registry + folder/repo bindings + cached active-squad explanation**. | This is Rally's operator-facing persistence layer. Rally needs to remember "for this repo/folder, use squad X + fallbacks Y" without pushing that UX burden into Squad core. |
| **Repo/folder selection rules** | Move from implicit repo-centric behavior to **folder-aware selection** driven by SDK resolution. | Casey/Brady's multi-squad case is not "one repo == one squad". Rally must ask the SDK which stack applies at dispatch time. |
| **Dashboard visibility** | Show the **active squad / fallback stack / write layer** for each dispatch target. | This is trust-building UX and belongs in the host. The SDK should produce the answer; Rally should render it. |
| **Dispatch-time `.squad/` setup** | Instead of always copying one personal squad via consult mode, Rally should call SDK **resolve → explain → runtime contract → materialize**. | Rally's current consult flow assumes a single personal squad. Multi-squad requires a host-side call into an invariant SDK contract. |

### Generalize/fork into SDK (do not leave Rally-specific)

| Current capability | What to move/generalize into SDK | Why |
|---|---|---|
| **`setupConsultMode()` copy-into-worktree behavior** | Generalize into **`materializeResolvedSquad()`** over a resolved stack/runtime contract. | The worktree materialization semantics must be shared by Rally, `squad-cli`, and any org host. |
| **Single-source consult config** | Generalize into **source records + binding model + active write-layer selection**. | Rally should not invent its own binding semantics; every host needs the same resolution answer. |
| **Ad hoc explanation implied by Rally UI** | Replace with SDK **explanation payloads + reason codes**. | Hosts should present different UX, but not different reasons for why a squad was selected/excluded. |
| **Re-entry assumptions** | Add SDK **reentry/drift validation**. | "Same answer tomorrow" is invariant contract logic, not a Rally-only concern. |

### Rally conclusion

Rally already gives us the **operator shell** we need. We should **keep its control-plane mechanics** and only modify the places where it currently assumes **one effective squad**.

---

## 3) Net-new custom code we will own no matter what

These are the pieces that neither Tamir's branches nor Rally already solve in the right layer.

| Net-new component | Why it must be net-new | Rough size |
|---|---|---|
| **`SquadSourceRecord` + `SquadBinding` data model** | Existing branches know about backends, upstreams, or manifests, but not the exact host-neutral source/binding contract Brady needs across CLI + Rally. | **Medium** (~200-350 LOC) |
| **`resolveSquadStack()`** | No existing asset returns a folder-scoped result that can be either **resolved** or **ambiguous** with ranked candidates. | **Large** (~400-700 LOC) |
| **Ambiguity handling + explanation payloads** | Current code can resolve a squad/back-end, but not explain multi-source selection/exclusion in a host-neutral payload. | **Small-Medium** (~150-300 LOC) |
| **`createSquadRuntimeContract()`** | Needed so every host starts sessions from the same machine-readable contract (stack, write layer, trust, state backend, restrictions, reentry token). | **Medium** (~200-400 LOC) |
| **`materializeResolvedSquad()`** | Current consult mode copies one personal squad. The new requirement is to materialize an **effective stack** into a worktree/session/local target. | **Medium-Large** (~350-650 LOC) |
| **Reentry/drift validation** | Needed for "same folder, same answer tomorrow unless something changed". Not covered by the current branches. | **Small-Medium** (~120-250 LOC) |
| **CLI source/binding/status/explain UX** | Even with SDK contract in place, `squad-cli` still needs thin command surfaces for unmanaged machines. | **Medium** (~300-550 LOC) |
| **Rally folder-binding + dispatch integration** | Rally must persist per-folder choices and invoke the SDK contract during dispatch. | **Medium-Large** (~400-700 LOC) |

### What is *not* net-new

- The **storage substrate** is **not** net-new: current mainline `state-backend.ts` / `resolution.ts` already give us the right starting point.
- Worktree/session bookkeeping is **not** net-new: Rally already has that.
- Manifest/discovery vocabulary is **not** fully net-new: current `cross-squad.ts` already gives us a partial language to build from.

---

## 4) Concrete recipe — the minimum build kit to ship P0 functionality

### Cheapest tractable recipe

1. **Adopt current upstream Squad state-backend machinery as the base**  
   Use the mainline descendants of `feat/state-backend-global-996` (`state-backend.ts`, `resolution.ts`, preset/sync/migrate flows) as the write-layer substrate. **Do not merge the fork branch wholesale.**

2. **Keep Rally's current operator shell intact**  
   Preserve `~/rally/active.yaml`, `.worktrees\...`, dashboard/session refresh, and the host/agent split exactly as they are.

3. **Build the missing invariant contract in `squad-sdk`**  
   Add:  
   - `SquadSourceRecord` + `SquadBinding`  
   - `resolveSquadStack()`  
   - `explainSquadSelection()`  
   - `createSquadRuntimeContract()`  
   - `materializeResolvedSquad()`  
   - `validateReentry()`

4. **Make `squad-cli` a thin reference host**  
   Add only the user-facing wrappers over the SDK contract: source registration, binding, `status`, `explain`, explicit personal/team choice flows.

5. **Modify Rally to consume the SDK contract**  
   Rally should store folder/repo bindings in `~/rally/`, ask the SDK for the active stack at dispatch time, then materialize that stack into the worktree instead of copying a single personal squad.

6. **Optionally borrow from `feat/upstream-auto-sync` later**  
   Only after the contract exists, borrow watch/propose ideas for refresh/pin/update ergonomics if Brady wants them.

### Why this is the minimum set

Because it gets Brady's **P0** without creating a fourth product or a second resolution engine. It uses the fork only where it has already proven useful, keeps Rally in its natural role, and limits permanent custom ownership to the invariant contract we cannot avoid building.

---

## 5) Maintenance cost ranking — cheapest to maintain → most expensive

1. **Current mainline state-backend substrate** (already upstream, already owned, aligned with project direction)  
2. **Rally `.worktrees\...` layout + `active.yaml` bookkeeping** (stable host mechanics, not shared contract logic)  
3. **Current consult-mode implementation as an internal substrate** (already working; can be wrapped rather than replaced)  
4. **Targeted reuse of `feat/upstream-auto-sync` ideas** (small contained branch if used surgically, not wholesale)  
5. **Thin `squad-cli` host commands on top of SDK** (visible surface area, but mostly rendering and persistence)  
6. **Rally source/binding/dashboard modifications** (host-specific changes, moderate permanent cost)  
7. **Net-new SDK explanation + runtime contract surfaces** (shared across every host forever)  
8. **Net-new SDK stack resolution + materialization + reentry invariants** (**most expensive** because every future host and workflow will depend on them)

### Interpretation

The cheapest things are the ones that are **already upstream** or **clearly host-owned**. The most expensive things are the ones that become **long-lived shared invariants**.

---

## 6) The trap branches

| Branch | Why it looks attractive | Why it is actually a trap here |
|---|---|---|
| **`feat/communication-adapter`** | Enterprise-ready, ADO-aware, apparently relevant to "org flexibility". | **Biggest trap.** It is **13 ahead / 505 behind** upstream, drags the discussion into transport/channel adapters, and solves the wrong layer first. Brady's immediate problem is not "how do GitHub and ADO threads look?"; it is "which squad stack applies here, why, and how do we materialize it?" |
| **`feat/cross-squad-orchestration`** | Has manifests, discovery, delegation, and the phrase "cross-squad" right in the name. | Discovery/delegation is **adjacent**, not the same as **per-folder multi-squad stack resolution**. If we mistake this for the solution, we will ship discovery without selection semantics. |
| **`feat/squad-scheduler`** | Feels like orchestration infrastructure and already has CLI/runtime surfaces. | It is automation plumbing, not stack selection or materialization. Pulling it into this effort increases surface area without reducing the real custom work. |
| **`feat/persistent-ralph`** | Operationally mature, persistent, and already in our runtime ownership zone. | Helpful operationally, but irrelevant to the specific multi-squad host contract Brady is costing out. |
| **`feat/upstream-auto-sync`** | Gives visible "watch/propose/sync" behavior that feels like source management. | Useful later, but **premature** if used to avoid building the underlying source/binding contract. Watch/propose is not a substitute for stack resolution and ambiguity handling. |

### Biggest trap to avoid

**`feat/communication-adapter`** is the one I would actively steer away from for this cycle. It is the farthest from the core invariant we actually need, the most stale, and the easiest way to spend time on enterprise transport without delivering the P0 selection/materialization contract.

---

## Final recommendation

**Reuse current upstream Squad for storage/backends, reuse Rally for operator mechanics, and build only the host-neutral stack contract net-new.**

That means:
- **Pull nothing wholesale from the fork except ideas**  
- **Treat `feat/state-backend-global-996` as already-harvested value in mainline**  
- **Borrow `feat/upstream-auto-sync` only later and only surgically**  
- **Do not let communication/scheduler/heartbeat branches distract from stack resolution + materialization**

If Brady wants the minimum tractable path, this is it.