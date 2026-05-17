### Flight — Multi-Squad Plan: Priority-Framed (Round 5)

**Date:** 2026-05-16T00:14:13-07:00  
**Requested by:** Brady  
**Status:** TEAM-READY PRIORITY FRAME

## 1) Priority frame

### Priority order
1. **P0 (must satisfy):** engineering-org multi-squad flexibility
2. **P1 (equal):** minimize custom code
3. **P1 (equal):** contribute reusable value upstream to `bradygaster/squad`

### Decision rule
- **P0 dominates everything.** If an option fails multi-squad flexibility, it is out even if it is cheaper or more upstream-friendly.
- Between the two **P1s**, prefer the option that keeps the **SDK/host boundary clean upstream** when the extra code is modest and durable.
- Prefer **minimum local custom code** only when an upstream-shaped version would materially expand scope, delay P0, or force us to upstream org-specific behavior that does not belong there.

### Re-framed recommendation
Keep the **Round 4 shape**: **SDK contract + CLI reference host + Rally host modifications**, no new first-party org host in v1.  
Refine it under the explicit priorities as: **adopt the smallest possible upstream-shaped SDK contract, selectively reuse Tamir’s backend work, and keep Rally changes to host integration plus folder-level squad selection.**

---

## 2) P0 satisfaction checklist

Round 4 already got the core shape right: **SDK owns the invariant contract; CLI and Rally are hosts; no split-brain resolution logic; no new v1 host**. This section makes the P0 satisfaction explicit.

| P0 dimension | How the plan satisfies it | Round 4 alignment |
|---|---|---|
| **N squads** | The plan supports **0..N named squad sources** on one machine via source records + bindings. A cwd resolves one primary plus explicit fallbacks/overlays; the machine registry can hold many squads simultaneously. | Round 4 §3/§5 already defines shared `SquadSourceRecord` + `SquadBinding` + `resolveSquadStack()`. |
| **Applicability / “which squad applies here?”** | Applicability is decided **per cwd/subdirectory**, not per repo only. The resolver returns the active stack plus explanation and exclusions. | Round 4 explicitly requires per-directory resolution, ambiguity handling, and explanation payloads. |
| **Repo overlap / multiple squads inside one repo** | The plan supports **folder-level bindings** so `Foo/services/project-a` and `Foo/services/project-b` can resolve differently without duplicate clones. | Round 4 + PAO gap analysis both call this a non-negotiable host capability. |
| **Cross-repo reuse** | Multiple repos may bind to the same team/org/personal source. Shared identity/governance come from the source; runtime state still resolves to the active write layer per binding. | Round 4’s source records + runtime contract already assume host-neutral reuse. |
| **Shared squads across many users** | Team/org squads are modeled as **shareable sources** with trust/pinning/caching. Many users can consume the same source while preserving local applicability and write boundaries. | Round 4’s source/trust/cache model and SDK-owned contract cover this directly. |
| **Storage media** | Storage is **not hardcoded**. The plan supports git/GitHub/ADO/path/OneDrive/npm/HTTP through source adapters and materialization. | Round 4 keeps transport/source semantics in SDK; Round 2/Network/EECOM specify the medium set. |
| **Location on disk** | The plan allows **host-dependent persistence**: repo-visible bindings where appropriate, clone-local `.git` overrides, machine-local registries/caches, and Rally’s operator store. Location is flexible so long as the resolver emits the same contract. | Round 4 + Round 3 corrected the mistake of making one CLI-owned disk layout universal. |
| **Layering** | The plan keeps **one primary authority + explicit fallbacks + bounded personal overlay + one active write layer**. Identity and automatic writes do not silently merge. | Round 4 rests on the same invariant and inherits Round 2’s layering rules. |
| **Sharing without state bleed** | Shared squads provide reusable guidance; repo/session noise does **not** automatically flow upward. Promotion is explicit; cross-squad writes are inbox-only by grant. | Round 4 keeps policy/materialization in SDK; Round 2/RETRO define the write boundary. |

### P0 verdict
**The recommendation still satisfies P0.** The critical requirement is not “make Rally or CLI smarter in isolation”; it is **make the SDK contract host-neutral and per-directory, then let each host persist/bind/materialize that answer in the shape its workflow needs.**

---

## 3) P1 — Custom code minimization audit

### Reusable as-is or near-as-is

| Reusable asset | How we use it | Why it reduces new code |
|---|---|---|
| **Current Squad state-backend primitives** | Keep existing backend concepts and implementations as the starting point for writable-state behavior. | Avoids inventing a second storage abstraction from scratch. |
| **Tamir `feat/state-backend-global-996` direction** | Reuse the **pluggable backend / global-state / backend-selection shape** selectively, especially where it already converged with mainline. | Lowest-risk way to cover multi-location state without designing a brand-new backend model. |
| **Tamir `feat/upstream-auto-sync` idea** | Reuse the idea of **source refresh into a local cache** rather than re-cloning or wiring every repo manually. | Gives us cache/update semantics without inventing a whole new sync story. |
| **Rally central store and operator shell** | Keep Rally’s existing **dashboard, onboarding, attach/open/log, worktree dispatch, consult workflow**. | Avoids rebuilding a second operator console in Squad. |
| **Rally worktree materialization pattern** | Keep the worktree-centric execution model; swap the source of truth from “single effective squad” to SDK-produced runtime contract. | Minimizes Rally churn to host integration rather than product redesign. |
| **Current Squad CLI host role** | Keep CLI as the **reference host**, not as the universal owner of semantics. | Reuses existing product surface instead of adding a fourth tool. |

### Net-new code we must own

| Net-new surface | Why it is unavoidable for P0 |
|---|---|
| **`resolveSquadStack()` + ambiguity return** | P0 requires per-directory applicability and multi-squad overlap resolution. No current host can fake this safely. |
| **Shared source/binding record schema** | P0 requires many squads, shared squads, and cross-repo reuse. The machine needs stable source IDs and binding records. |
| **Machine-readable explanation payloads** | PAO’s narratives make plain-English “why here?” a product requirement, not host-local copy. |
| **Runtime contract export** | Rally and org tools both need a host-consumable handoff before session start. |
| **Resolved-squad materialization API** | Rally cannot satisfy per-folder dispatch with repo-root-only `.squad/` assumptions. |
| **Active-write-layer / policy enforcement helpers** | P0 requires layering and sharing without state bleed. That boundary must be code, not convention. |
| **Minimal Rally folder-selection integration** | Rally as-is is repo-centric; P0 needs folder-level squad choice and status. |

### Minimum viable custom-code footprint that still satisfies P0

This is the **smallest footprint worth building**:

1. **SDK (must build)**
   - source record + binding record types
   - `resolveSquadStack()`
   - ambiguity + explanation payloads
   - active write layer selection + policy helpers
   - runtime contract + materialization

2. **Squad CLI (minimum reference-host layer)**
   - `source` / `bind` flows
   - `status` / `explain`
   - explicit personal-only / exclusion choice flow
   - optional `welcome` banner only as a reference host proof

3. **Rally (minimum host delta)**
   - consume SDK contract
   - folder/repo-level squad choice
   - plain-English squad status
   - dashboard badge for active squad
   - worktree-time materialization using SDK output

4. **Explicitly defer**
   - new first-party org host
   - corp catalog logic in Squad
   - staffing systems / SSO-specific policy engines
   - admin publishing/signing helpers unless pain proves they are needed
   - store unification work that is not required to satisfy P0

### Custom-code minimization verdict
**Do not adopt Tamir or Rally wholesale.** The minimum viable footprint is **selective reuse of backend/cache ideas plus a new SDK invariant contract plus thin host integrations**. That is smaller than Path C and safer than Path A.

---

## 4) P1 — Upstream contributability map

| Surface | Status | Justification |
|---|---|---|
| **SDK source/binding data model** | 🟢 **Upstream-ready** | This is a general Squad capability, not org-specific. Multiple hosts need the same schema. |
| **`resolveSquadStack()` + ambiguity API** | 🟢 **Upstream-ready** | Per-directory multi-squad resolution is core product behavior and belongs in the shared runtime. |
| **Explanation payloads / reason codes / explicit negative state** | 🟢 **Upstream-ready** | All hosts need the same answer rendered differently. This is product value, not local glue. |
| **Active write layer + write-authorization helpers** | 🟢 **Upstream-ready** | The sharing boundary is generic and aligns with existing Squad governance/security direction. |
| **Runtime contract export** | 🟡 **Upstream-shaped but needs discussion** | Strong value, but API size and host-boundary placement need maintainer agreement. |
| **Resolved-squad materialization API** | 🟡 **Upstream-shaped but needs discussion** | Necessary for Rally/org hosts, but exact target model (`worktree`/`session`/`local`) is negotiable. |
| **CLI source/bind/status/explain flows** | 🟢 **Upstream-ready** | These are natural first-party reference-host features for Squad CLI. |
| **CLI personal-only / exclusion UX** | 🟡 **Upstream-shaped but needs discussion** | Concept is aligned, but the final UX wording and command shape are host-level choices. |
| **Rally consuming SDK resolution contract** | 🟡 **Upstream-shaped but needs discussion** | Valuable to Rally, but depends on Rally’s appetite for deeper Squad integration. |
| **Rally `squad add/use/status` + dashboard active-squad badge** | 🟡 **Upstream-shaped but needs discussion** | Aligned to Rally’s operator role, but command names and persistence model are Rally product questions. |
| **MDM/bootstrap manifest format for corp rollout** | 🔴 **Local-only** | Real need, but this is enterprise deployment policy, not a generic Squad product surface. |
| **Corp catalog / staffing overrides / SSO connector policy** | 🔴 **Local-only** | Important for org-tool stories, but not appropriate to upstream into Squad or Rally core. |

### Upstream contributability verdict
The **center of gravity should be upstream SDK + CLI contract work**, with Rally integrations proposed as **consumer-side follow-ons**. Corp deployment and policy specifics stay local.

---

## 5) The P1 tension: where the two P1s pull against each other

| Tension point | Why the P1s conflict | Resolution | Which P1 wins here? |
|---|---|---|---|
| **Adopt Tamir branch as-is vs reshape into upstream contract** | Pulling Tamir wholesale is less net-new code now, but it imports branch-specific shape and automation assumptions that may not merge cleanly. | **Adopt concepts selectively, not branch wholesale.** Reuse backend/cache ideas, but express them in Brady’s SDK contract and naming. | **Upstream contributability wins.** |
| **Keep Rally exactly as-is vs add host integration points** | Leaving Rally untouched minimizes our code, but P0 fails because Rally as-is cannot do per-folder applicability or worktree-time effective-squad materialization. | **Make the smallest Rally changes that let it consume the SDK contract.** Do not redesign Rally beyond that. | **P0 first; then minimal custom code wins.** |
| **Force one shared store (`~/.squad/`) everywhere vs let Rally keep `~/rally/`** | Unifying stores may look cleaner upstream, but it adds migration and product churn. Letting Rally keep its store minimizes code and respects its operator-shell model. | **Keep host-local persistence acceptable in v1.** Unify the contract, not the folders. Revisit physical-store convergence only if it becomes operationally costly. | **Custom-code minimization wins.** |
| **Bake org-managed behavior into upstream SDK vs keep it host-local** | Pushing corp bootstrap, staffing overrides, and connector rules upstream could reduce local wrapper code, but it pollutes the core product with org-specific policy. | **Keep SDK generic.** Upstream only the contract hooks org tools need; keep enterprise policy out of core. | **Upstream contributability wins.** |
| **Make the SDK super rich now vs keep it thin and host-neutral** | A richer SDK could eliminate repeated host work, but it risks turning the SDK into a host UX owner and increasing long-term maintenance. | **Only upstream what at least two hosts need.** Host choreography stays in CLI/Rally/org tool. | **Both P1s align here.** |

### Tension summary
The hardest tension is **“reuse Tamir fastest” vs “shape the work to merge cleanly upstream.”** The resolution is: **reuse the ideas, not the fork-shaped surface.** That costs a little more now, but it avoids owning a permanent compatibility layer later.

---

## 6) Execution paths (sorted by total custom-code surface)

| Path | Shape | Custom-code surface | Strengths | Weaknesses | Verdict |
|---|---|---:|---|---|---|
| **A. Maximum reuse** | Adopt Tamir branches aggressively + keep Rally mostly as-is | **Smallest** | Lowest immediate implementation load; fastest path to a demo | Too coupled to fork movement; Rally as-is still misses key P0 cases; weakest upstream story | **Do not pick** |
| **B. Selective adoption** | Pull in Tamir backend/global-state ideas selectively, build the SDK invariant contract in mainline shape, add minimal Rally integration | **Middle** | Satisfies P0, keeps custom code bounded, preserves strong upstream path, avoids new tool | Requires disciplined scoping and a few unavoidable new SDK surfaces | **Pick this** |
| **C. Clean-room aligned build** | Rebuild the whole model from scratch under Brady conventions | **Largest** | Cleanest conceptual design, no inherited branch debt | Highest custom-code cost, slowest, worst fit for the “minimize custom code” P1 | **Do not pick** |

### Chosen path: **Path B — Selective adoption**

### Why Path B wins against P0 / P1 / P1
- **P0:** It fully satisfies multi-squad flexibility because it still builds the required SDK contract and Rally host delta.
- **P1 (custom code):** It reuses the most valuable existing work (state-backend/global-state/cache ideas, Rally operator shell) without inheriting unnecessary fork/product assumptions.
- **P1 (upstream):** It shapes the solution around **mainline SDK/CLI boundaries**, which is the only credible way to contribute lasting value upstream.

### Decisive call
**Pick Path B.** Path A under-shoots P0 and over-couples us to fork movement; Path C over-spends custom code for no strategic gain.

---

## 7) Upstream contribution inventory

### PRs to `bradygaster/squad` (priority order)

| Priority | Proposed PR title | Scope | Value to upstream | Rejection risk |
|---|---|---|---|---|
| 1 | **feat(sdk): add multi-squad source and binding records** | `SquadSourceRecord`, `SquadBinding`, persistence-neutral schema | Establishes the common language every host needs | **Low** |
| 2 | **feat(sdk): add `resolveSquadStack()` with ambiguity + explanation payloads** | per-directory resolution, candidates, reason codes, exclusions | Core product capability for multi-squad selection and trust | **Medium** |
| 3 | **feat(sdk): add active write layer + policy helpers for layered squads** | write targeting, foreign-write denial, explicit exclusions | Makes layering safe rather than advisory | **Medium** |
| 4 | **feat(sdk): export runtime contract and resolved-squad materialization API** | host handoff + target materialization for sessions/worktrees | Unlocks Rally and org-host integration without split-brain logic | **Medium-High** |
| 5 | **feat(cli): add source/bind/status/explain flows on top of SDK contract** | reference-host commands + plain-English output | Proves the SDK contract works end-to-end for first-party users | **Medium** |
| 6 | **docs: publish host integration guide for Rally and org hosts** | resolve → explain → contract → materialize guide | Makes upstream value consumable beyond the CLI | **Low** |

### PRs to `jsturtevant/rally` (priority order)

| Priority | Proposed PR title | Scope | Value to Rally | Rejection risk |
|---|---|---|---|---|
| 1 | **feat: consume Squad SDK resolution contract for active squad selection** | read SDK result instead of assuming one effective squad | Gives Rally a real multi-squad story without forking semantics | **Medium-High** |
| 2 | **feat: add folder-level `rally squad use` and `rally squad status`** | location-specific selection + plain-English trust check | Solves the “same repo, different subfolder, different squad” problem | **Medium-High** |
| 3 | **feat: materialize effective squad per dispatch worktree** | use SDK runtime contract during worktree creation | Preserves Rally’s operator UX while fixing repo-root-only assumptions | **Medium-High** |
| 4 | **feat: show active squad in dashboard and dispatch details** | badge/column/detail visibility | Big operator-trust win with modest UI change | **Medium** |

### What we do **not** try to upstream
- Corp bootstrap manifest formats
- Staffing-rule lookup integrations
- SSO-specific connector policy
- MDM rollout choreography

Those remain local because they are **real enterprise needs but not reusable upstream product core**.

---

## 8) Open questions that still block Brady’s decision (max 3)

1. **Persistence default:** Do you want **repo-visible bindings** to remain the preferred default, or do you want **clone-/host-local bindings** treated as an equally blessed first-class default from day 1?  
   This changes both UX framing and PR order.

2. **Sandboxed personal mode:** Should **sandboxed personal on managed machines** be part of the **SDK contract** (host-neutral policy mode), or should it stay entirely **host-defined** outside core Squad APIs?  
   This changes whether we upstream policy surface area now.

3. **Rally storage convergence:** For v1, is it acceptable for Rally to keep its existing **`~/rally/` operator store** while consuming the shared SDK contract, or do you want us to drive toward **registry convergence on `~/.squad/`** immediately?  
   This changes the amount of Rally churn and the balance between the two P1s.

---

## 9) Final call

**Recommendation:** proceed with **Path B — selective adoption**.  
Build the **smallest upstream-shaped SDK contract** that satisfies P0, keep CLI as the **reference host**, make **minimal but real Rally changes** for folder-level selection and worktree-time materialization, and keep org-specific deployment logic **out of upstream core**.

That is the best fit for the explicit priority order:
- **P0 satisfied**
- **custom code minimized without under-building**
- **upstream value created without turning Squad into an internal-only platform tool**
