# Piece 49 — Self-hosted fold runners and multi-squad host onboarding — Triage

Date: 2026-07-09

## Sub-proposal decisions

| Sub-proposal | Decision | Tier |
|---|---|---|
| A — Self-hosted-runner durability (stale branch drop + no-op fold skip) | Accept | Tier 1 |
| B — Manual on-demand fold trigger (workflow_dispatch / parameters) | Accept | Tier 1 |
| C — squad assign subfolder team-root resolution | Accept | Tier 1 |
| D — install-fold-pipeline self-hosting target | **D1** (.squad/-gated self-install) | Tier 1 |

## D decision rationale (D1 chosen, D2 rejected)

**D1** — `.squad/`-gated self-install into the current state repo:
- Confines self-install to a demonstrable state repo (presence of `.squad/` is a reliable
  indicator that the current repo is the host itself).
- No new CLI flag needed — the detection is implicit and safe.
- Leaves the separate-host resolution path (registry entry → dirname; config stateLocation)
  completely untouched.
- Mirrors the existing "registry-gated auto-create" pattern: if the directory qualifies,
  proceed; otherwise fall through to the fail-fast.

**D2 rejected** — explicit `--self` flag:
- Extra ceremony for an operator who already knows they're in a state repo.
- Adds flag-validation surface area and test matrix.
- Conflicts with the ergonomic intent of the self-hosted path.

## Follow-up note (not in scope for piece 49)

**Post-commit hook + subfolder team root:** The cross-repo post-commit hook
installed by `squad assign` runs a plain `squad sync` from the clone root. For a
subfolder-hosted squad, `squad sync` resolves the team root from the registry
entry's `.path` (which C now correctly sets to `<cloneDest>/<callsign>/.squad`),
so the hook works correctly for the registered squad. However, if a single host
carries *multiple* squads (multiple callsigns), the hook invokes one `squad sync`
per commit regardless of which subfolder changed — a future piece could scope the
hook to the changed subfolder or add a per-callsign filter. This does not break
sub-proposal C's acceptance criterion (onboarding a multi-squad host) — it is an
optimisation candidate for a later piece.
