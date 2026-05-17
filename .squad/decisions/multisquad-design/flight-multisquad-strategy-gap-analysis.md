### Flight — Multi-Squad Strategy: Gap Analysis vs PAO Narratives (Round 3)

**Date:** 2026-05-15T23:54:07-07:00  
**Requested by:** Brady

## 1. Executive summary

- The converged strategy got the core architecture right: per-directory resolution, one primary authority, layered fallbacks, transport heterogeneity, and explicit personal boundaries all show up in PAO’s lived experience stories (`flight-multisquad-strategy-converged.md:21-27,70-77,97-115,230-267`; `pao-multisquad-day-in-life-casey.md:86-121,123-139,141-199`; `pao-multisquad-day-in-life-casey-rally.md:83-120,167-204`; `pao-multisquad-day-in-life-casey-org-tool.md:45-82,92-132,145-196`).
- The biggest gap is **discovery/bootstrap**. My Round 2 model assumes Casey manually registers and binds too much on day 1; all three narratives want the host to discover, preload, or at least strongly guide the right squad choices before Casey learns source URLs or storage vocabulary (`flight-multisquad-strategy-converged.md:184-187,208-258`; `pao-multisquad-day-in-life-casey.md:21-38`; `pao-multisquad-day-in-life-casey-rally.md:31-60`; `pao-multisquad-day-in-life-casey-org-tool.md:23-27,68-82`).
- The biggest thing I got wrong is treating **Squad CLI as the universal operator surface**. The narratives show that `squad-cli`, Rally, and an org host can all be valid front doors; the invariant belongs in the SDK contract, not in a CLI-owned UX assumption (`flight-multisquad-strategy-converged.md:128-142,286-294,330`; `pao-multisquad-day-in-life-casey-rally.md:206-231`; `pao-multisquad-day-in-life-casey-org-tool.md:191-196`).
- The tool-host assumption is **not justified as a universal default**. It is justified only as the first-party portable/reference host. For org-managed environments, the org-tool variant is the strongest day-1 experience; for shared-repo / no-repo-pollution workflows, Rally is stronger.
- The minimum invariant layer is larger than I wrote in Round 2: the SDK must expose not just resolution and transport, but also ambiguity reporting, plain-English reason codes, approved-tool restrictions, host-consumable runtime contracts, and effective-squad materialization for worktrees/sessions.

## 2. What we got right (with citations)

1. **Per-directory binding is the right core abstraction.**  
   Round 2 says nearest binding wins the subtree and demonstrates A/B/C/D resolving differently by location (`flight-multisquad-strategy-converged.md:70-77,230-267`). That matches PAO’s strongest recurring beat: one repo can legitimately host multiple experiences, and the system must change help when Casey changes folders (`pao-multisquad-day-in-life-casey.md:86-121`; `pao-multisquad-day-in-life-casey-rally.md:83-135`; `pao-multisquad-day-in-life-casey-org-tool.md:45-82,92-113`).

2. **Single primary authority plus explicit fallbacks matches the lived model better than silent merge.**  
   The converged doc’s “one primary authoritative squad per cwd” and fixed fallback order (`flight-multisquad-strategy-converged.md:70-77`) maps cleanly to PAO’s lived outcomes: Project A is org-wide, Project B is team + org, Project C is team, Project D is personal-only or sandboxed personal (`pao-multisquad-day-in-life-casey.md:58-68,92-100,129-137,149-199`; `pao-multisquad-day-in-life-casey-rally.md:107-115,129-136`; `pao-multisquad-day-in-life-casey-org-tool.md:71-80,101-110,164-175`).

3. **Plain-English explainability is mandatory, and Round 2 correctly prioritized it.**  
   The UX contract says the system should explain the active stack in one short banner and push deeper reasoning behind explicit inspection (`flight-multisquad-strategy-converged.md:198-203`). PAO independently lands on the same requirement in every narrative: Casey trusts the system only when it explains “why here?” in ordinary language (`pao-multisquad-day-in-life-casey.md:72-85,105-121`; `pao-multisquad-day-in-life-casey-rally.md:120-139`; `pao-multisquad-day-in-life-casey-org-tool.md:59-82`).

4. **Heterogeneous source transport is real, not theoretical.**  
   Round 2 explicitly supports GitHub, ADO, OneDrive/path, npm, and HTTP (`flight-multisquad-strategy-converged.md:97-115`). PAO’s variants all need mixed provenance: GitHub team squads, org catalogs, and personal OneDrive/path storage (`pao-multisquad-day-in-life-casey.md:134-139,168-193`; `pao-multisquad-day-in-life-casey-rally.md:35-55`; `pao-multisquad-day-in-life-casey-org-tool.md:82,181`).

5. **Personal must be explicit and bounded.**  
   The converged strategy correctly rejects silent personal precedence and treats personal as consult-first in shared contexts (`flight-multisquad-strategy-converged.md:73-77,271-279`). PAO’s stories agree that personal should require an explicit choice and that “only mine here” must be legible (`pao-multisquad-day-in-life-casey.md:141-199`; `pao-multisquad-day-in-life-casey-rally.md:101-117`; `pao-multisquad-day-in-life-casey-org-tool.md:148-179`).

## 3. What we missed

1. **Discovery/catalog is a concrete v1 requirement.**  
   Round 2 assumes Casey manually adds `foo-team`, `bar-team`, and her personal source, then binds projects herself (`flight-multisquad-strategy-converged.md:184-187,208-258`). PAO shows that day 1 breaks if Casey must already know source locations. Baseline wants `squad welcome` to enumerate accessible shared help (`pao-multisquad-day-in-life-casey.md:21-38`); Rally explicitly calls current setup too knowledge-heavy and asks for starter-file/bootstrap discovery (`pao-multisquad-day-in-life-casey-rally.md:31-60`); the org-tool story assumes a project catalog and policy engine already exist (`pao-multisquad-day-in-life-casey-org-tool.md:23-27,68-82`).

2. **Ambiguous repo-root handling is missing.**  
   My model resolves by nearest binding, but it does not specify what the host should do when Casey stands at a repo root that maps to multiple projects. The org-tool variant makes that a first-class UX: stop, surface the candidate projects, and explain the override (`pao-multisquad-day-in-life-casey-org-tool.md:47-57`). Round 2 has no ambiguity API or UX contract for that case.

3. **We missed “intentionality” explanations, not just hierarchy explanations.**  
   `status --explain` in Round 2 tells Casey what stack is active (`flight-multisquad-strategy-converged.md:198-203`), but PAO shows Casey also needs to know whether the outcome is intentional policy rather than accidental fallback. In baseline, Casey still pings a teammate because the tool cannot say “this project intentionally uses the company squad” (`pao-multisquad-day-in-life-casey.md:74-85`). In the org-tool story, “Foo team coverage below staffing threshold” closes that trust gap (`pao-multisquad-day-in-life-casey-org-tool.md:48-59,73-80`).

4. **We missed explicit negative confirmation for exclusions.**  
   Round 2 says personal overlays are allowed unless disabled (`flight-multisquad-strategy-converged.md:264-267`), but it does not require the host to say what is turned off. PAO does: “Company and team help: off for this repo” and `--only` are core trust-building moments, not polish (`pao-multisquad-day-in-life-casey.md:182-199`; `pao-multisquad-day-in-life-casey-rally.md:101-117`).

5. **We missed recurring confirmation at session start.**  
   Round 2 covers first-run banners, but not resumability banners (`flight-multisquad-strategy-converged.md:198-203`). Baseline explicitly wants a one-line “still the same answer” banner on the next morning’s `squad start` (`pao-multisquad-day-in-life-casey.md:210-223`). That is a concrete product requirement because Casey uses it as drift detection.

6. **We missed policy-backed personal sandboxing as a first-class mode.**  
   Round 2 blocks shared-governance writes from personal by default (`flight-multisquad-strategy-converged.md:148-162`), but PAO’s org-tool story needs more than that: local-only memory, corp connectors off by default, no shared publishing, and visible restricted tools (`pao-multisquad-day-in-life-casey-org-tool.md:148-177`). That is not just a trust nuance; it is a concrete policy mode the SDK/host contract must support.

7. **We missed worktree/session materialization as an explicit SDK capability.**  
   I gave Rally “read the resolver” and “honor subdirectory bindings” (`flight-multisquad-strategy-converged.md:132-134,318-319`), but PAO’s Rally story needs more: per-dispatch effective squad materialization into the worktree so one repo can launch different squads for different jobs (`pao-multisquad-day-in-life-casey-rally.md:169-200`). That is a deeper capability than explainability alone.

8. **We missed host-consumable runtime restrictions in the contract.**  
   The org-tool narrative requires a fully baked contract before session start: identity, memory scope, state location, approved tools, auth context, and per-directory binding (`pao-multisquad-day-in-life-casey-org-tool.md:195-196`). Round 2 does not say the SDK must emit that contract in a way non-CLI hosts can consume.

## 4. What we got wrong

1. **Wrong: “The developer MUST install or receive the Squad CLI.”**  
   That statement is explicitly false in two of the three narratives (`flight-multisquad-strategy-converged.md:184`). Rally Casey never installs `squad-cli` (`pao-multisquad-day-in-life-casey-rally.md:6-16,206-223`). Org-tool Casey never learns the word Squad at all (`pao-multisquad-day-in-life-casey-org-tool.md:3-5,191-196`). The invariant is not “CLI installed”; it is “a host can resolve and launch the right workspace.”

2. **Wrong: the day-1 problem is fully solved by SDK + CLI + small Rally changes.**  
   I wrote that directly (`flight-multisquad-strategy-converged.md:291-294`). PAO’s narratives say otherwise. Rally needs non-trivial new concepts (`squad add`, `squad use`, `squad status`, folder-level rules, effective worktree materialization) (`pao-multisquad-day-in-life-casey-rally.md:33-55,87-135,169-204,225-229`). The org-tool variant needs a corporate catalog, policy-backed ambiguity handling, and runtime restrictions (`pao-multisquad-day-in-life-casey-org-tool.md:47-82,148-196`). That is not “small host polish.”

3. **Wrong: “CLI owns local explainability” as a product boundary.**  
   That over-rotates toward one host (`flight-multisquad-strategy-converged.md:286-289,330`). The narratives show explainability must be a host-neutral capability. Casey needs the same plain-English answer whether the host is `squad`, Rally, or `eng` (`pao-multisquad-day-in-life-casey.md:105-121`; `pao-multisquad-day-in-life-casey-rally.md:120-139`; `pao-multisquad-day-in-life-casey-org-tool.md:47-80`). The CLI can be a first-party implementation, not the owner of the concept.

4. **Wrong: manual registration/binding is part of the normal day-1 contract.**  
   My onboarding contract requires Casey to register non-bootstrap sources and bind each project/subdirectory herself (`flight-multisquad-strategy-converged.md:184-187,220-258`). That is too CLI-shaped. Baseline and org-tool variants both show that in the best experience, the org/team defaults are already known and most directory bindings are discovered or predeclared; Casey only intervenes when making an explicit personal choice or resolving ambiguity (`pao-multisquad-day-in-life-casey.md:21-38,54-68`; `pao-multisquad-day-in-life-casey-org-tool.md:47-82,133-135`).

## 5. Contested across narratives

1. **Front door / host is contested.**  
   Baseline says `squad-cli` can be the whole experience (`pao-multisquad-day-in-life-casey.md:5-18`). Rally says one operator shell is preferable in shared-repo workflows (`pao-multisquad-day-in-life-casey-rally.md:6-31,140-145`). Org-tool says the best corp experience hides Squad behind the company’s standard dev tool (`pao-multisquad-day-in-life-casey-org-tool.md:3-27`). Conclusion: host choice is **not invariant**.

2. **Where bindings and state live is contested.**  
   Baseline ends with small inspectable repo files plus a personal source in OneDrive (`pao-multisquad-day-in-life-casey.md:202-206`). Rally keeps project rules and squad caches centrally in `~/rally/` and avoids permanent repo check-ins (`pao-multisquad-day-in-life-casey-rally.md:173-204`). Org-tool hides metadata under `%LOCALAPPDATA%\Contoso\eng\` (`pao-multisquad-day-in-life-casey-org-tool.md:181-181`). Conclusion: storage location is **host-dependent**; the invariant is that the current directory resolves to the same contract.

3. **Personal mode is contested.**  
   Baseline makes personal portable and optionally OneDrive-backed (`pao-multisquad-day-in-life-casey.md:168-193`). Rally allows explicit personal-only isolation (`pao-multisquad-day-in-life-casey-rally.md:101-117`). Org-tool sandboxes personal aggressively on corp hardware (`pao-multisquad-day-in-life-casey-org-tool.md:148-177`). Conclusion: “personal exists and is explicit” is invariant; “personal is sovereign vs sandboxed” is host/policy-specific.

4. **Source provenance visibility is contested.**  
   Baseline likes lightweight “Fetched from” hints (`pao-multisquad-day-in-life-casey.md:132-139`). Rally makes source registration front-and-center (`pao-multisquad-day-in-life-casey-rally.md:33-55`). Org-tool hides source location completely and treats that invisibility as part of the promise (`pao-multisquad-day-in-life-casey-org-tool.md:181-181`). Conclusion: provenance detail belongs to host-specific UX layers, not to the invariant default screen.

5. **What is invariant across all three:**  
   - per-directory resolution, not repo-root-only behavior;  
   - plain-English “why here?” status;  
   - explicit personal boundary controls;  
   - trustable defaults before session start;  
   - durable next-day re-entry without reconfiguration.

## 6. Tool-host assumption: justified or not?

**Verdict: not justified as the primary host assumption for the whole strategy. Justified only as the first-party portable/reference host.**

Why:

- The baseline narrative proves `squad-cli` can deliver a strong first-party experience if the org has already bootstrapped discovery and trust (`pao-multisquad-day-in-life-casey.md:21-38,54-121`).
- The Rally narrative proves there is a distinct shared-repo / operator-console path where Rally is the better front door, because Casey wants one dashboard, one dispatch surface, and no repo pollution (`pao-multisquad-day-in-life-casey-rally.md:140-204`).
- The org-tool narrative proves that, on a corp-managed machine, the best day-1 UX is often a company-standard tool that already owns identity, catalog, compliance, approved connectors, and clone/bootstrap flows (`pao-multisquad-day-in-life-casey-org-tool.md:13-27,68-82,145-196`).

So the strategic correction is:

- **Keep `squad-cli` as the portable first-party host and reference implementation.**
- **Treat Rally as a first-class external host for shared-repo / dispatch-centric workflows.**
- **Treat custom org tools as legitimate v1 SDK consumers, not as out-of-scope future exceptions.**

### Build-allocation change implied

Replace the old framing:
- “CLI is the operator surface.”
- “Rally stays an operator shell.”
- “No new end-user tool in v1.”

With this framing:
- **SDK owns the host contract.**
- **CLI is the first-party reference host.**
- **Rally is a first-class external host with worktree orchestration responsibilities.**
- **Org tools are supported host implementations when they consume the same SDK/runtime contract.**
- **No new first-party end-user host in v1** is still reasonable; **unsupported org hosts in v1** is not.

## 7. Minimal SDK contract (the invariant layer)

Every viable host needs the SDK/runtime layer to provide at least this:

1. **Source identity + provenance**  
   Stable source IDs, transport metadata, trust state, and refresh/pinning information.

2. **Per-location resolution**  
   Resolve an arbitrary cwd/subdirectory to: primary workspace owner, ordered fallback stack, active write layer, and personal-mode flags.

3. **Ambiguity reporting**  
   If a repo root maps to multiple candidate projects, return the candidates plus reason codes instead of forcing a bad guess.

4. **Reason codes / explanation payload**  
   Machine-readable reasons that hosts can render as plain English (“team fallback policy triggered”, “personal-only here”, “company defaults fill shared tools”).

5. **Explicit exclusion controls**  
   Support “only this workspace here”, “disable org/team overlays”, and visible negative state in the resolved contract.

6. **Runtime contract export**  
   A fully baked session payload: workspace identity, memory scope, state backend/location, auth/trust context, approved tools/connectors, and restricted capabilities.

7. **Policy enforcement**  
   Cross-squad write enforcement, destination-class restrictions, trust downgrades, and personal sandbox policies.

8. **Effective-squad materialization**  
   Materialize the resolved workspace into a worktree/session path without assuming repo-root-only `.squad/` semantics.

9. **Cache/update primitives**  
   Pull/refresh/pin/rollback shared sources consistently across hosts.

10. **Re-entry stability**  
   Hosts must be able to re-open yesterday’s context and verify that the same resolution still holds, or surface drift when it does not.

## 8. Proposed amendments to the converged strategy (specific deltas — sections to rewrite, build-allocation rows to change)

1. **Rewrite Section 7 (“Onboarding UX contract”) to be host-neutral.**  
   Replace “developer MUST install or receive the Squad CLI” with “developer MUST have access to a host that implements the Squad runtime contract.” Replace “register sources” and “bind each project” with a split:  
   - host should auto-discover/bootstrap org/team defaults when policy allows;  
   - developer intervention is only for explicit personal choices, ambiguity resolution, or non-managed sources.

2. **Rewrite Section 8 (“Day-1 walkthrough”) as three host paths or one host-neutral flow with host examples.**  
   Current walkthrough is too CLI-shaped (`flight-multisquad-strategy-converged.md:204-267`). Replace it with:  
   - first-party portable host (`squad`),  
   - Rally/shared-repo host,  
   - org-managed host.  
   The invariant should be the outcome, not the command names.

3. **Amend Section 5 (“Build allocation — canonical table”).**  
   Add SDK-owned rows for:  
   - ambiguity/candidate-project API,  
   - reason-code/explanation payloads,  
   - runtime contract export (identity, scopes, tool restrictions),  
   - effective-squad materialization for worktrees/sessions,  
   - personal sandbox policy mode.  
   Change CLI rows from “operator surface” to “first-party reference host”.  
   Expand Rally rows to include folder-level rules + worktree-time materialization.  
   Add a new row: **Org host integration surface (SDK consumer)** — corp catalog lookup, policy-backed binding injection, auth/connector injection, host-owned bootstrap UX.

4. **Amend Section 6 (“Security & trust posture”).**  
   Add an explicit policy mode for sandboxed personal workspaces on managed machines: local-only memory, disabled shared publishing, connector restrictions, and host-visible restricted-tool lists.

5. **Amend Section 3 / resolution rules.**  
   Add a rule for ambiguous repo-root contexts: when multiple project bindings match, the resolver must return candidates and require a host selection path rather than defaulting silently.

6. **Amend Section 7 UX contract.**  
   Require two concrete UX outcomes:  
   - hosts must be able to say not just what is active, but why it is intentionally active;  
   - hosts must be able to confirm what is explicitly off (“org/team help off here”, “restricted tools here”).

7. **Amend the Recommendation sentence.**  
   Change from “CLI-owned setup/explainability” to “SDK-owned host contract with CLI as first-party host, Rally as external dispatch host, and org tools as supported managed hosts.”

## 9. New open questions for Brady (at most 3)

1. Is Squad optimizing first for the **portable first-party host** experience, or for the **best possible corp-managed host** experience? Those are adjacent, but not the same product bet.
2. Do you want the SDK to explicitly support **sandboxed personal mode on managed machines** (restricted connectors, local-only memory), or should that remain host-defined policy outside the core contract?
3. For shared repos and corp-managed hosts, is **repo-visible binding state** still the preferred default, or should clone-local / host-local rules be a first-class equally blessed persistence model?
