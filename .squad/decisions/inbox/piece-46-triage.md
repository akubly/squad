# Piece 46 — Triage

State-remote resolution hardening and pull/push transport coverage. Branch
`squad/piece-46-state-remote-resolution-hardening-and-transport-coverage` off piece 45
(tip 899d95f3).

## Sub-proposal dispositions

| Sub-proposal | Tier | Decision | Notes |
|---|---|---|---|
| A — Harden `resolveRemote(cwd)` precedence: tracking remote → sole configured remote → `origin` only if it exists → else throw an actionable `SquadError` naming `stateRemote` | 1 | **Accept** | Only production-code change. Lazy-memoize the code-clone call site so a cross-repo sync does not throw on an unrelated code-clone remote (value unused in cross-repo). |
| B — New integration test: cross-repo `--pull` from a REAL bare state remote whose branch is `squad/state/<callsign>` (derived) hydrates `.squad` files (real fetch, `_transport` not mocked) | 1 | **Accept** | Closes the piece-43 mock gap for pull. |
| C — New integration test: cross-repo `--push` to a REAL bare host remote NOT named `origin` (remote resolved, no explicit `stateRemote`) publishes the inbox ref (real push, `_transport` not mocked) | 1 | **Accept** | Proves sole-remote precedence (A.2) + real publish. |
| D — Focused unit test: `deriveStateBranch` returns flat `squad-state` for every invalid callsign shape (uppercase, underscore, dot, leading digit, over-length) | 1 | **Accept** | Coverage only — `deriveStateBranch` unchanged. Any `CALLSIGN_RE` discrepancy is a finding to triage, not a silent fix. |
| E — Ambiguous resolution (no tracking, no `origin`, >1 remote) | 2 | **E1 — fail with actionable error naming `stateRemote`** | See rationale below. |

## Tier-2 decision E — rationale

**Chosen: E1 (fail closed with an actionable error naming `stateRemote`).**

When there is no branch tracking remote, no remote named `origin`, and more than one remote
configured, the resolver cannot deterministically choose a remote. The two options were:

- **E1 (chosen)** — throw a `SquadError` instructing the operator to set `stateRemote`. The
  resolver never guesses. The failure surfaces as a clean CLI message via the `main().catch`
  handler in `cli-entry.ts`, not an unhandled crash. The one-line `stateRemote` setting makes
  the choice explicit and auditable.
- **E2 (rejected)** — fall back to the first-listed remote. Convenient, but it can silently
  fetch from — or, worse, publish squad state to — the wrong remote with no operator signal.
  That silent-wrong-destination class is exactly the defect this piece exists to remove
  (today's literal-`origin` fallback is the same shape of silent-wrong-destination bug).

Failing closed is strictly safer than guessing a remote that could be wrong, especially on the
push path where the consequence is publishing state to the wrong place. The actionable error
directs the operator to the deterministic fix (`stateRemote`).

## Coordinator review gate — findings dispositions

Adversarial review (code-review + rubber-duck sub-agents) ran against the diff before commit.
Code-review: no material issues. Rubber-duck raised two items, both adjudicated by the
Coordinator:

- **Single-repo code-clone fallback asymmetry (rubber-duck #1) — accepted as designed.**
  `getCodeCloneRemote()` catches a resolver throw and falls back to `origin` on the single-repo
  path, so single-repo flows never fail closed even when remotes are ambiguous, whereas the
  cross-repo state remote does. This asymmetry is intentional and matches the acceptance
  criterion "a cross-repo sync does not throw on an unrelated code-clone remote configuration"
  while preserving the code-clone call site's pre-piece-46 contract (it returned the literal
  `origin` unconditionally). The safety-critical resolution is the cross-repo **state** remote
  (where a wrong destination publishes shared squad state); the single-repo code-clone remote
  targets the operator's own repo, where `origin` is the universal git default and a wrong value
  fails naturally at the git layer. Narrowing the fallback would change long-standing single-repo
  behavior with no acceptance-criteria requirement, so E1 fail-closed is scoped to the state
  remote only.
- **Tracking remote accepted without validation (rubber-duck #2) — fixed.** `resolveRemote`
  now enumerates configured remotes first and only honors `branch.<name>.remote` when it names
  a real remote, so a `.` local-tracking value or a stale/manual remote name falls through to
  the sole-remote / `origin` / fail-closed precedence instead of being returned blindly. Pinned
  by new unit tests A.4 (stale name → `origin`) and A.5 (`.` → sole remote).

## Scope guardrails

- `deriveStateBranch` behavior is NOT changed (D is coverage only).
- The existing piece-43 mocked plumbing tests are NOT weakened; B/C are additive.
- `@bradygaster/squad-*` is the canonical scope; no `@wifi-aware` introduced.
- Known pre-existing-on-base failures (piece-38 J6/J7/M2/O6/N2/PM1/PM2; assign P34.A1/A3) are
  confirmed unchanged and not attributed to piece 46.
