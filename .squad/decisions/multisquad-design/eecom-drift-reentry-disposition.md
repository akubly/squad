### EECOM — Drift / Re-entry: Disposition (Downscope)

**Requested by:** Aaron  
**Author:** EECOM  
**Date:** 2026-05-17T22:41:30-07:00

## Recommendation

**Downscope.** Keep only a tiny, host-neutral **resolution fingerprint** in the SDK, and move actual **drift detection**, **re-entry timing**, and **user-facing reaction** out of the SDK and into the consuming host or organizational layer. The current full re-entry story is doing too many jobs at once: state comparison, policy interpretation, reopening workflow, and user education. Only the first of those belongs naturally in shared infrastructure. The rest depends on who is reopening the session, what persistence model they use, what counts as a meaningful change, and whether the user ever opted into organizational behavior in the first place. Under Aaron’s zero-impact and layering directives, that is too much policy to freeze into the core kernel.

This is not a recommendation to pretend drift cannot exist. It is a recommendation to stop treating “morning after” behavior as a required SDK invariant. The SDK should define a stable way to describe **what answer was applied**; hosts can decide whether, when, and how to compare that answer later. That preserves future extensibility without forcing every single-squad user and every host to pay for a feature whose strongest current use case is organizational.

## What stays in the SDK

The smallest useful primitive is this:

- when the SDK resolves a workspace, it produces the normal resolution/runtime contract
- that contract includes an **opaque resolution fingerprint** (or re-entry token if we want to keep the name)
- the fingerprint is derived from the parts of the resolved answer that matter to behavior, not from host UX state

Concretely, the fingerprint can cover things such as:

- primary squad identity
- fallback layer identities and ordering
- personal-only / personal-disabled / default mode state
- effective binding target that won for the current path
- source revision or pin state for applied layers, where relevant
- policy inputs that actually change runtime behavior

That is enough to answer one narrow question later: **“Is the applied answer materially the same as the one I used before?”**

The SDK does **not** need to decide when that question is asked. It does **not** need to decide whether a difference is merely informative, requires a warning, requires a re-explanation, or should block reuse. It does **not** need to own the “same answer as yesterday” copy. It only needs to make the answer comparable in a stable, host-neutral way.

If we want one helper in addition to the fingerprint itself, keep it mechanical: a pure comparison utility that says `same` or `different` and, at most, returns machine-readable changed dimensions such as `binding`, `source`, or `policy`. Even that helper is optional. The main value is the canonical fingerprint, because it gives every host the same substrate without freezing one host’s workflow into the kernel.

## What leaves the SDK

Everything that turns comparison into product behavior should move out:

1. **When to run the check**  
   On session reopen? On shell start? On worktree materialization? On explicit `status`? Those are host choices.

2. **What counts as actionable drift**  
   A source revision change may matter in a managed engineering shell and not matter in a lightweight local CLI. A policy change may require forced disclosure in one environment and a quiet refresh in another.

3. **How to present the result**  
   Silent refresh, informational banner, “re-explain” flow, warning, or hard stop are all UX/policy decisions, not SDK invariants.

4. **Where prior state is stored**  
   Repo-visible file, host-local store, machine cache, session DB, or not stored at all. This is explicitly host-layer territory.

5. **Whether the experience exists at all**  
   A host serving single-squad users may never surface re-entry, and that should be perfectly valid.

This is the critical simplification. The SDK should answer **what the current workspace resolves to** and provide a comparable fingerprint for that answer. The host should own **whether yesterday matters**.

## Why the full mechanism should not remain an SDK invariant

There are three reasons.

### 1) The strongest current justification is organizational, not universal

The most vivid story for re-entry is the managed-machine case: a developer returns to a workspace after some combination of binding edits, source refresh, or org policy change. That is real. But it is also exactly the class of problem Aaron is asking us to layer **on top of Squad**, not to make every Squad consumer inherit by default.

For a normal single-squad user, the default expectation is still: open the repo, Squad behaves like it always has. They do not need “re-entry” as a first-class concept. If we formalize full drift/re-entry in the SDK kernel, we risk turning an organizational safety story into ambient product complexity for everyone.

### 2) The reaction is inseparable from host policy

Detecting that something changed is one problem. Deciding what to do about it is another. The current proposal bundles them too tightly. In practice, the consuming host will always need to decide whether to re-explain automatically, whether to ask the user to confirm, whether to show org-specific provenance, and whether a particular drift dimension matters enough to interrupt work.

Once that is true, the SDK should stop short of prescribing the flow. Otherwise we freeze a generic API around behavior that is not actually generic.

### 3) It conflicts with the zero-impact principle if made too visible

Aaron’s P0 is very clear: no new default prompts, no changed default workflows, no new semantic burden for existing single-squad users unless they opted into organizational behavior. A full SDK-level re-entry story creates pressure to surface checks and messages broadly because otherwise the invariant is hard to observe or justify. The thinner fingerprint primitive avoids that trap. It gives organizational hosts the mechanism they need while letting classic Squad remain boring.

## Why a thin SDK primitive is still worth keeping

I do **not** recommend a pure defer/cut, because the comparison substrate has legitimate reuse value.

First, multiple hosts can share one canonical notion of “materially the same resolved workspace.” That matters even if only one host surfaces a morning-after message today. Without a shared primitive, every host invents its own comparison logic and we re-create divergence immediately.

Second, the fingerprint is useful for more than drift banners. It can support status output, cache invalidation, session resume integrity, audit breadcrumbs, and future diagnostics without changing any user-facing semantics.

Third, it keeps the door open for later expansion. If we later prove that a common cross-host re-entry flow is warranted, adding host behavior on top of an existing fingerprint is easy. Reconstructing a canonical comparable answer later is harder if every host already stored different bespoke state.

So the thin primitive earns its place. The thick workflow does not.

## Implications for the proposal

I would make the following changes to the proposal language.

### Remove as an SDK invariant

Do **not** describe “drift / re-entry” as a core invariant alongside resolution, explanation, runtime contract, and materialization. That currently implies too much product policy lives in the shared layer.

### Replace with a narrower statement

Replace it with something like:

> The SDK runtime contract includes a stable, comparable fingerprint of the effective squad resolution. Consuming hosts may persist and compare that fingerprint to detect material changes across session reopen or workspace reuse.

That preserves the extensibility point without promising a universal morning-after workflow.

### Move user experience examples up a layer

If the org proposal wants to show Casey returning to a workspace and being told “same answer as yesterday” or “your org policy changed,” that story should be described as **host behavior built on the SDK fingerprint**, not as the SDK itself owning re-entry. That matches the layering directive and avoids overselling the upstream contract.

### Keep single-squad defaults untouched

For `squad-cli` and plain upstream Squad behavior, there should be no new required prompt, no automatic re-validation ceremony, and no changed default semantics. A single-squad user should be able to use Squad indefinitely without learning that the fingerprint exists.

## What we lose by downscoping

We do lose one thing: the proposal can no longer claim that every host gets a complete, built-in “morning after” experience merely by adopting the SDK. That experience becomes optional host work.

I think that is the correct trade. The current narrative value of re-entry is higher than its proven invariant value. If an organizational host needs it, it can still build it quickly on top of the fingerprint. If a lightweight host does not need it, it should not have to explain why it is not participating in a kernel-level feature.

## Why this does not paint us into a corner

This path is safely extensible.

If later evidence shows that several hosts genuinely need the same drift categories and the same comparison semantics, we can promote a tiny compare helper or a richer diff payload without breaking the contract. The host-visible story still layers cleanly on top.

If later evidence shows that the SDK truly must own reopen-time validation, we can add a higher-level helper that consumes the already-shipped fingerprint and current resolution. That is an additive move.

What would be harder is the reverse: shipping a full re-entry invariant now, then discovering hosts disagree sharply on storage, timing, UX, and action thresholds. Pulling policy back out of a frozen kernel is painful. So from a sequencing standpoint, downscope is the safer technical choice.

## Direct answers to Aaron’s questions

### 1. Is drift / re-entry adding value at the SDK layer?

**Only in thin form.** A canonical resolution fingerprint adds value at the SDK layer because it defines a shared, host-neutral way to describe “what answer was applied here.” The full drift/re-entry workflow does **not** add enough universal value to justify living in the SDK kernel today.

### 2. If it is strictly organizational, can we defer as a nice-to-have?

**Yes for the workflow; no for the comparison primitive.** The user-facing re-entry experience can absolutely be deferred or implemented only in an org host. What should remain in the SDK is the tiny comparison substrate so hosts do not fork the meaning of “same resolved workspace.”

### 3. If we keep it, should we disclose it formally as a requirement or goal?

**Not as a top-level requirement or goal in its current broad form.** If we keep the thin primitive, it should be documented as an implementation detail of the runtime contract or as an extensibility point for hosts. A formal goal would overstate its importance and imply a user-visible cross-host promise we are not ready to make.

## Bottom line

My recommendation is to **downscope** drift/re-entry from “SDK invariant” to “SDK fingerprint plus host-owned behavior.” That keeps the reusable part, removes the policy-heavy part, honors zero-impact for existing users, and matches the principle that organizational concerns should layer on top of Squad rather than reshape its default core behavior.
