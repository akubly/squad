### 2026-06-11: Piece 40 triage — callsign-namespaced transport
**By:** Aaron Kubly (via Copilot), on Flight's triage
**What:** Triage of sub-proposals A–E for piece 40 (callsign-namespaced transport). A–D are Tier 1, implementation-ready. E is Tier 2, decision-required, and deferred.
**Why:** Phase B replay; A–D are implementation-ready Tier-1 items that resolve concrete shared-remote namespace collisions with no design ambiguity. E requires a recorded decision before any migration code lands — none present in `.squad/decisions/inbox/` as of this session, so it is deferred.

---

## Triage Table

| Sub-proposal | Tier | Decision | Rationale |
|---|---|---|---|
| A — Callsign-namespaced inbox branches (`sync.ts`) | 1 | **ACCEPT** | Mechanism is concrete: capture `entry.callsign` alongside `registryAlias` near `sync.ts:645`, thread to `publishTeamRootToInbox`, and construct branch as `squad/inbox/<callsign>/<handle>/...`. Callsign validated against a `CALLSIGN_RE` constraint before use; unset callsign is a fatal error. Single-repo mode is unchanged. |
| B — Callsign-namespaced state branch default (init/assign) | 1 | **ACCEPT** | `squad init --callsign <name>` and `squad assign` write `stateBranch: "squad/state/<name>"` into the registry entry. Hydrate side at `sync.ts:749–750` already reads `stateBranch ?? 'squad-state'` — no further change needed there. The bare `squad-state` fallback is preserved for un-migrated entries. |
| C — `install-fold-pipeline --callsign` (ADO + GitHub templates) | 1 | **ACCEPT** | `--callsign` is additive and optional. When provided: trigger glob narrows to `squad/inbox/<callsign>/**` (GitHub) or `refs/heads/squad/inbox/<callsign>/*` (ADO); fold target becomes `squad/state/<callsign>`. Absent `--callsign`: existing globals are unchanged verbatim. Both platform templates are parameterized. |
| D — Origin-ambiguity guard verification (`assign.ts:530–544`) | 1 | **ACCEPT** (tests only unless a guard is found incorrect) | Verification-and-documentation item. Four behaviors must be covered: 2-squad warning+exit-0, 3-squad `ERR_ASSIGN_ORIGIN_AMBIGUITY` without `--callsign`, same with `--callsign` succeeds, Guard 7 rebuff of duplicate product-clone path. If any guard is wrong, a corrective code fix lands under this sub-proposal. |
| E — Back-compat/migration | 2 | **DEFER** | No decision recorded in `.squad/decisions/inbox/` as of 2026-06-11. Spec recommends E3 (documented cutover + `squad doctor` warning). That recommendation stands as the starting point when the decision is revisited, but no migration code may be implemented this session. Record a decision in `.squad/decisions/inbox/` to ungate implementation. |

---

## Per-item rationale

**A:** The inbox branch collision is the primary shared-remote hazard. The fix is surgical
(one new variable capture, one branch-name format change, one metadata field addition) with
a clear fallback boundary (single-repo path unchanged). No design ambiguity.

**B:** The state branch naming change is confined to the write side (init/assign). The
hydrate side already reads from `stateBranch` in the registry entry — adopting the namespaced
default slots in cleanly. Existing entries carrying `stateBranch: "squad-state"` continue to
work without any changes to the fallback logic.

**C:** The pipeline parameterization is the fold-side complement of A. Additive flag, both
platforms, backward-compatible absence behavior. The optional pipeline-filename disambiguation
(e.g., `fold-squad-state-<callsign>.yml`) is a naming-convention detail that does not block
the trigger/target parameterization, which is the core Tier-1 deliverable.

**D:** Guard behaviors at `assign.ts:530–544` are documented and appear sound as of piece 39.
This sub-proposal is satisfied by four test cases. A code fix is only warranted if a guard is
found incorrect during test authoring.

**E:** The spec's E3 recommendation (documented cutover + `squad doctor` warning) is noted as
the preferred starting point. However, no recorded decision exists in `.squad/decisions/inbox/`
as of this triage. The implementation gate is clear: record the decision first, implement
second. A–D are independent of E and proceed without it.

---

## Parity criteria for final review (Lead hold)

The implementer will be held to all of the following at review time:

1. **A — Namespaced inbox branch:** cross-repo push produces `squad/inbox/<callsign>/<handle>/...`; `publish-metadata.json` carries a `callsign` field; unset callsign at publish is a fatal error with a clear message; single-repo branch name is unchanged.
2. **B — Namespaced state branch in registry + hydrate:** `squad init --callsign <name>` writes `stateBranch: "squad/state/<name>"`; `squad sync --pull` for that entry fetches from `squad/state/<name>`; existing entry with `stateBranch: "squad-state"` continues to pull from `squad-state`.
3. **C — Scoped pipeline YAML for both platforms, unchanged output when `--callsign` absent:** GitHub and ADO templates both parameterized; `--callsign teamA` narrows trigger and target correctly on each platform; invocation without `--callsign` produces byte-identical output to the current template.
4. **D — Four guard tests:** (a) 2-squad origin-sharing assign: warning + exit 0; (b) 3-squad without `--callsign`: `ERR_ASSIGN_ORIGIN_AMBIGUITY`; (c) same with `--callsign`: succeeds; (d) Guard 7: duplicate product-clone path to a second squad fails.
5. **Changeset:** a `patch` changeset entry for `@bradygaster/squad-cli` is present in the diff.
6. **Commit shape:** single squashed commit with required trailer.
7. **Scrub gate:** zero new hits on all strip-listed patterns.
8. **E deferred:** no migration code, no `squad doctor` warning implementation — those are gated on the recorded decision.
