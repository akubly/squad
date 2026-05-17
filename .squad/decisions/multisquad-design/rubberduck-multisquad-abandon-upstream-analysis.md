### Rubber-Duck — Devil's Advocate: What if we abandon the upstream contribution goal?

**Date:** 2026-05-16T00:14:13-07:00

## 1. What "abandon upstream" actually means

The strongest independent path is **not** a broad permanent fork of all `bradygaster/squad`. The strongest version is:

> Build a private org-managed multi-squad host/adapter, pin to a known-good Squad SDK/CLI version, treat upstream Squad as a runtime substrate, and implement multi-squad resolution, catalog lookup, policy, binding, and worktree/session materialization privately.

Concretely:

- **No upstream SDK contract negotiation.**
- **No upstream `squad-cli` UX changes required for v1.**
- **No Rally modifications required for v1.**
- **No attempt to make the solution generally reusable.**
- **No promise that public Squad users get the same multi-squad behavior.**
- Use public Squad only where it is already stable enough: `.squad/` format, agent prompts, consult/session conventions, basic SDK resolution primitives.
- Implement the engineering-org-specific layer privately:
  - corp catalog lookup;
  - project/folder binding rules;
  - approved tools/connectors;
  - personal sandbox rules;
  - effective `.squad/` materialization into target workspaces;
  - dashboard/status/explain UX inside the org host.

This directly attacks the Round 4 recommendation's biggest cost center: it avoids making the SDK the universal invariant contract across `squad-cli`, Rally, and org hosts, even though the recommendation says that is the product center (`flight-multisquad-solution-shape-recommendation.md:21-36`, `:98-131`, `:194-196`).

## 2. The cost savings, enumerated and quantified

### 2.1 Eliminated process drag

The upstream path requires changes across at least three surfaces: SDK, CLI, and Rally (`flight-multisquad-solution-shape-recommendation.md:7-19`). It also touches foundational SDK semantics: source records, bindings, ambiguity, policy, runtime contracts, materialization, and re-entry validation (`:27-36`, `:100-108`).

That is not a small PR. It is an architectural program.

Relevant team reality:

- Meaningful changes require proposal-first alignment (`decisions.md:77-80`).
- Prior community PRs were deferred specifically because substantive changes lacked proposals (`decisions.md:273-281`).
- Rally is now a downstream compatibility surface, so SDK/CLI changes must consider Rally impact (`decisions.md:354-367`).

**Estimated savings if abandoned:**
- Proposal/design review cycles avoided: **2-4 weeks**.
- SDK API negotiation avoided: **3-6 weeks**.
- Rally maintainer coordination avoided: **2-5 weeks**.
- Cross-repo sequencing/review/rework avoided: **2-4 weeks**.

**Total likely calendar savings:** **~8-16 weeks** for v1.
Aggressive case: if the upstream SDK contract becomes contentious, abandoning upstream could save **3-6 months**.

### 2.2 Eliminated generality constraint

The upstream design must be host-neutral. The Round 4 recommendation explicitly says the SDK must serve `squad-cli`, Rally, and org hosts (`flight-multisquad-solution-shape-recommendation.md:21-36`, `:87-96`). The gap analysis also expands the invariant layer to include ambiguity, explanation payloads, runtime restrictions, materialization, cache/update primitives, and re-entry stability (`flight-multisquad-strategy-gap-analysis.md:122-154`).

A private org host can cut scope sharply:

| Capability | Upstream-worthy version | Private org version |
|---|---|---|
| Source registry | generic transports, trust, refresh, pinning | corp catalog + maybe local personal path |
| Bindings | generic persistence model | org-owned project/folder map |
| Ambiguity | general candidate model | ask corp catalog / require explicit project selection |
| Policy | pluggable trust/personal/tool rules | hardcoded enterprise policy |
| Materialization | reusable SDK primitive | copy/symlink effective `.squad/` into session/worktree |
| Explainability | machine-readable reason-code contract | org-specific status strings |
| Re-entry | generic token/drift contract | compare cached project revision + policy version |

**Estimated scope savings:** **30-50%** of v1 implementation.
The private path can implement only the engineering-org happy path and defer heterogeneous transport, generic pin/rollback, public CLI ergonomics, and reusable Rally abstractions.

### 2.3 Eliminated coordination overhead

The current strategy requires keeping multiple product boundaries straight:

- Squad owns runtime/team semantics; Rally owns worktrees, dispatch, dashboard, trust, and sandboxing (`decisions.md:359-367`).
- Rally is positioned as a companion path, not a replacement (`decisions.md:386-400`).
- The recommendation says CLI and Rally should consume the same SDK contract, not own resolution/policy themselves (`flight-multisquad-solution-shape-recommendation.md:54-96`).

Private path collapses this. The org host owns the operator UX and policy. Squad becomes an implementation detail.

**Estimated ongoing savings:**
- Avoid upstream branch tracking/rebases: **4-8 hours/month**.
- Avoid release compatibility review across Squad/Rally: **0.1-0.25 FTE** during active development.
- Avoid maintainer communication and PR shepherding: **1-3 days per substantive change**.

### 2.4 Eliminated upstream acceptance risk

Abandoning upstream removes these risks:

- maintainer unavailable;
- maintainer agrees with problem but rejects API shape;
- maintainer asks for a more general abstraction;
- Rally maintainer does not want the coupling;
- upstream direction changes while org implementation is waiting;
- accepted changes land too late for org deployment.

The gap analysis already shows the strategy changed materially from "CLI owns operator surface" to "SDK owns host contract" after narrative review (`flight-multisquad-strategy-gap-analysis.md:57-70`, `:92-120`). That is good architecture work, but it is exactly the kind of architecture churn that can slow upstreaming.

## 3. The new costs we'd take on

### 3.1 Carrying a semantic fork forever

Even without a source-code fork, a private org host becomes a **semantic fork**. It defines its own meaning for:

- squad source;
- binding;
- active write layer;
- personal sandboxing;
- materialization;
- drift/re-entry;
- policy.

That duplicates the invariant contract the Round 4 recommendation intentionally centralizes in the SDK (`flight-multisquad-solution-shape-recommendation.md:21-36`, `:159-163`).

**Expected cost:**
- Initial private adapter: **4-8 engineer-weeks**.
- Ongoing compatibility maintenance: **0.15-0.5 FTE**, depending on upstream churn.
- If upstream later lands similar APIs, migration cost: **4-12 weeks**.

### 3.2 Fewer free upstream improvements

The repo history shows upstream has already absorbed fork ideas and advanced them: Tamir's state-backend work is described as effectively absorbed upstream and then moved forward (`history.md:239-246`). The team decision treats Tamir's fork as an incubation lane, not an alternate trunk (`decisions.md:9-23`).

Going private opts out of that compounding effect. The org team must either cherry-pick improvements or live without them.

### 3.3 Lost discoverability, credibility, and community mind-share

The upstream path makes multi-squad a public Squad capability. The private path makes it an internal product.

Costs:

- fewer external users stress-test the model;
- fewer community fixes;
- weaker story for Rally users;
- weaker credibility when explaining "this is Squad" versus "this is our private Squad-compatible thing."

### 3.4 Hiring and onboarding tax

New engineers can learn public Squad, but they must separately learn the org host's private semantics. If the private model diverges from public docs, onboarding becomes harder.

Rule of thumb:

- If private behavior differs in **1-2 obvious places**, manageable.
- If it differs in **resolution, storage, policy, and session materialization**, expect **1-2 weeks onboarding tax** per engineer working in this area.

### 3.5 Strategic redundancy risk

If upstream lands a competing multi-squad contract before the org host ships, the private system can look redundant or off-strategy. This is especially plausible because the Round 4 recommendation already identifies the same SDK contract as the natural center (`flight-multisquad-solution-shape-recommendation.md:21-36`, `:194-196`).

## 4. The break-even analysis

Abandon upstream is the right call when **calendar urgency and org-specific shortcuts outweigh long-term divergence**.

### Heuristic 1 — upstream delay threshold

Abandon upstream if expected upstream acceptance delay is:

- **>8 weeks** and the org host can ship internally in **≤8 weeks**, or
- **>12 weeks** even with no hard external deadline, because the opportunity cost becomes larger than P1 upstream value.

Do not abandon if the upstream path can land an SDK kernel in **≤4-6 weeks**.

### Heuristic 2 — fork divergence rate

Independent path remains healthy if:

- private code touches **<10%** of upstream-adjacent semantics;
- upstream changes require **<1 day/month** to absorb;
- no more than **1 conflict per quarter** appears in resolution/materialization behavior.

The math flips against independence if:

- private host redefines **3+ core concepts** differently from upstream;
- compatibility work exceeds **0.5 FTE**;
- each upstream release requires **>2-3 days** of analysis/fixes;
- private users depend on behavior that public Squad later contradicts.

### Heuristic 3 — upstream pace

Abandoning upstream is safer if upstream is slow or stable:

- releases are monthly/quarterly;
- runtime contract areas are quiet;
- Rally integration is not actively evolving.

It is dangerous if upstream is fast:

- weekly/biweekly changes in SDK resolution, state backend, consult mode, or templates;
- active Rally compatibility changes;
- state-backend/source-binding work continues to land upstream.

### Heuristic 4 — team velocity

Abandon upstream only if Brady has a durable owner:

- at least **1 senior engineer** for the private host;
- at least **0.25 FTE ongoing** for compatibility;
- ability to deploy org-wide automatically;
- authority to define enterprise policy without upstream consensus.

If the team cannot staff that maintenance tail, upstream is cheaper even if slower.

### Simple formula

Let:

- `D` = upstream calendar delay saved, in months;
- `M` = monthly private maintenance cost, in FTE-months;
- `H` = planning horizon, in months;
- `R` = future migration/reconciliation cost, in FTE-months.

Independent path wins if:

> `Value(D) > (M × H) + R`

Example:

- Save 3 months now.
- Carry 0.2 FTE/month for 12 months = 2.4 FTE-months.
- Future migration cost = 1.5 FTE-months.
- Total private cost = 3.9 FTE-months.

If shipping 3 months earlier is worth more than ~4 FTE-months, independence is rational.

But if maintenance rises to 0.5 FTE/month over 18 months plus 3 FTE-month migration:

- 0.5 × 18 + 3 = 12 FTE-months.

At that point, upstream likely wins.

## 5. The "third path"

The best middle ground is:

> Contribute only the smallest host-neutral SDK kernel upstream; keep org catalog, enterprise policy, deployment, and opinionated UX private.

Upstream only:

1. resolution result shape;
2. ambiguity return;
3. runtime contract export;
4. materialization hook;
5. basic reason-code/explanation payload.

Keep private:

1. corp catalog;
2. source discovery;
3. enterprise auth/connectors;
4. approved/restricted tool policy;
5. dashboard/operator UX;
6. managed-machine personal sandbox behavior;
7. deployment and bootstrap.

This matches the Round 4 mitigation: SDK gets only capabilities at least two hosts need, while host-specific presentation and enterprise policy stay outside (`flight-multisquad-solution-shape-recommendation.md:159-163`). It also respects the gap analysis that host choice is not invariant while resolution, explainability, personal boundaries, trustable defaults, and re-entry are invariant (`flight-multisquad-strategy-gap-analysis.md:71-90`).

Compared to full upstream:

- saves **30-50%** of review/design drag;
- reduces maintainer negotiation scope;
- avoids forcing corp-specific policy into public API.

Compared to full independence:

- avoids semantic fork;
- preserves future Rally compatibility;
- keeps the public Squad story credible.

## 6. Your verdict

**Verdict: NO — Brady should not abandon the upstream goal yet.**

The strongest case for abandoning upstream is real: it could save **~8-16 weeks** and let the org ship a narrower, policy-specific host without waiting for SDK/Rally consensus. But the P0 problem is engineering-org-scale multi-squad flexibility, and the durable value comes from having one shared runtime contract rather than a private semantic fork. Given there is no hard deadline and P1 explicitly values upstream contribution, the better answer is the third path: upstream the minimal invariant kernel and keep org-specific catalog/policy/UX private.

I would flip to **YES** if upstream acceptance of the minimal SDK kernel appears likely to exceed **12 weeks**, or if maintainers reject the premise that resolution/materialization/runtime-contract semantics belong in the SDK.
