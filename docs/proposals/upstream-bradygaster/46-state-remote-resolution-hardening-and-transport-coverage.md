# 46 — State-remote resolution hardening and pull/push transport coverage

## Summary

Piece 43 made cross-repo `sync --pull`/`--push` resolve the squad **state remote** and the
`squad/state/<callsign>` **branch** from the registry / team-root host rather than the code
clone's origin. But the underlying remote resolver it relies on — `resolveRemote(cwd)` in
`packages/squad-cli/src/cli/commands/sync.ts` — still falls back to the **literal string
`origin`** without confirming a remote named `origin` actually exists. On a host clone
configured with a single differently named remote (for example `upstream`) and no branch
tracking, resolution names a non-existent `origin` instead of the obvious sole remote, and the
subsequent fetch/push fails against a remote that is not there.

Piece 43 also left a transport **test gap**: its cross-repo pull/push tests set up real bare
git repositories but assert argument plumbing against the **mocked** `_transport` seam
(`hydrateTeamRootFromStateRef` / `publishTeamRootToInbox`) rather than exercising the real git
fetch/push. The resolver and the transport are therefore never proven together end-to-end, so
the literal-`origin` defect above could not have been caught by the existing suite.

This piece (A) hardens `resolveRemote` to a deterministic precedence — the branch's tracking
remote; else, when exactly one remote is configured, that remote; else `origin` only when
`origin` actually exists; else an actionable failure directing the operator to set
`stateRemote` — and closes the transport coverage gap with new integration tests that exercise
the **real** transport end-to-end: (B) a cross-repo `--pull` from a real bare state remote
whose branch is `squad/state/<callsign>` hydrates `.squad` files into the team-root; (C) a
cross-repo `--push` to a real bare host remote that is **not** named `origin` publishes the
inbox ref to that remote; and (D) a focused unit test pins the `deriveStateBranch` flat
`squad-state` fallback for every invalid callsign shape. A Tier-2 decision (E) covers the
ambiguous-resolution behavior when there is no tracking remote, no `origin`, and more than one
remote configured.

Stack position: Part 46 of the cross-repo arc, and the final planned piece on this stack.
Branches off piece 45 (`squad/piece-45-post-commit-hook-entrypoint-resolution`). This piece
directly closes gaps the piece-43 adversarial review accepted and deferred out of piece 43 (to
avoid reopening shipped scope and to keep the shared resolver change isolated): the
literal-`origin` fallback in the remote resolver, the piece-43 transport tests asserting
plumbing against mocks rather than real fetch/push, and the invalid-callsign fallback lacking
direct coverage. It depends on the state-remote / state-branch resolution surface
(`resolveRemote`, `deriveStateBranch`, the `_transport` seam, the registry `stateRemote` /
`stateBranch` / `callsign` fields) established in piece 43 and the callsign-namespaced
transport from piece 40.

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs
`43-cross-repo-state-remote-and-branch-resolution.md`,
`44-pipeline-file-injection-hygiene-on-shared-hosts.md`,
`45-post-commit-hook-entrypoint-resolution.md`, and the piece-46 entry in
`_planning/dogfood-backlog.md`.

Changeset requirement: `packages/squad-cli/src/` is touched (the `resolveRemote` hardening) —
include a `patch` changeset entry for `@bradygaster/squad-cli`.

---

## Problem

Piece 43 resolves the effective state remote, in cross-repo mode, as
`stateRemote ?? resolveRemote(teamRoot)` and the effective state branch as
`deriveStateBranch(stateBranch, callsign)`. Both lean on helpers that piece 43 left only
partially hardened, and the tests that should have exercised them stop at the mock boundary.

**1. `resolveRemote` falls back to a literal `origin` that may not exist.**
`resolveRemote(cwd)` reads the current branch's `branch.<name>.remote` and, on the
empty-config branch or in the catch path, returns the literal string `origin`:

```ts
function resolveRemote(cwd: string): string {
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd, ... }).trim();
    const remote = execFileSync('git', ['config', `branch.${branch}.remote`], { cwd, ... }).trim();
    return remote || 'origin';   // ← literal, never confirmed to exist
  } catch {
    return 'origin';             // ← literal, never confirmed to exist
  }
}
```

Neither return confirms that a remote named `origin` is configured. On a host clone with a
single differently named remote (for example `upstream`) and no branch tracking, the function
returns `origin` — a remote that does not exist — instead of the obvious sole remote. The
subsequent `hydrateTeamRootFromStateRef` / `publishTeamRootToInbox` then fetches or pushes
against a non-existent remote and fails. The resolver should prefer the branch's tracking
remote; otherwise, when exactly one remote is configured, select that remote; otherwise use
`origin` only when it actually exists; otherwise fail with an actionable error rather than
silently naming a remote that is not there.

**2. The piece-43 cross-repo pull/push tests assert plumbing against a mocked transport.**
The piece-43 suites (`test/cli/cross-repo-pull-resolution.test.ts`,
`test/cli/cross-repo-sync.test.ts`) set up real bare git repositories, but the cross-repo
resolution assertions spy on the `_transport` seam (`hydrateTeamRootFromStateRef` /
`publishTeamRootToInbox` are replaced with `vi.fn()` resolved stubs) and assert only that the
seam was **called with** the resolved remote and branch. The real fetch/push is never
exercised through those assertions, so the resolver and the transport are not proven together:
the literal-`origin` defect in (1) cannot surface because no test drives a real fetch/push from
a resolved-but-non-existent remote. The suite needs **new** integration tests (without
weakening the existing plumbing assertions) that exercise the real transport end-to-end.

**3. The invalid-callsign fallback in `deriveStateBranch` has no direct coverage.**
`deriveStateBranch(stateBranch, callsign)` returns an explicit `stateBranch` verbatim;
otherwise, when the callsign passes `CALLSIGN_RE`, it derives `squad/state/<callsign>`;
otherwise it falls back to the flat legacy `squad-state` branch. The piece-43 suite covers the
explicit-branch and valid-callsign paths, but never asserts that an **invalid** callsign
(uppercase, underscore, dot, leading digit, over-length) takes the flat `squad-state` fallback
rather than interpolating a malformed branch name. This is a coverage gap, not a logic gap: the
fallback exists; the assertion that pins it does not.

---

## Proposed change

Sub-proposals A, B, C, and D are Tier 1 (concrete, implementation-ready). Sub-proposal E is
Tier 2 (a decision with a behavior-surprise cost) and is gated on the maintainer's choice.

A is the only production-code change; B, C, and D are test-coverage additions and do not change
runtime behavior. `deriveStateBranch` is unchanged.

**Recommended implementation order:** A (harden the resolver) first, then resolve E (the
ambiguous-resolution decision, which A's precedence encodes), then B and C (real-transport
integration tests) and D (the invalid-callsign unit test).

---

## Tier 1

### A. Harden `resolveRemote` to a deterministic precedence

**Current behavior:** `resolveRemote(cwd)` returns the branch's tracking remote when set, and
otherwise the literal string `origin` (on both the empty-config branch and the catch path),
without confirming a remote named `origin` exists.

**Required behavior:** `resolveRemote(cwd)` resolves the remote by this precedence:

1. the current branch's tracking remote (`branch.<name>.remote`) when configured;
2. else, when exactly one remote is configured (per `git remote`), that sole remote;
3. else `origin` only when a remote named `origin` actually exists;
4. else it fails with an actionable error directing the operator to set `stateRemote`.

The error is surfaced as an actionable CLI message, not an unhandled crash: it is thrown as a
`SquadError` so the CLI entrypoint's top-level handler prints a clean `✗ <message>` and exits
non-zero, and it names `stateRemote` as the fix. Every call site of `resolveRemote` is kept
intact: the code-clone call (`options.remote ?? resolveRemote(repoRoot)`) and the team-root
call (`stateRemote ?? resolveRemote(teamRoot)`) keep their current contracts; the code-clone
resolution is only consumed on the single-repo path, so a cross-repo sync — whose state remote
resolves from the team-root host — does not throw on an unrelated code-clone remote
configuration.

**Hard constraints:**
- A branch with a configured tracking remote resolves to that remote (precedence 1), unchanged
  from today for the common case.
- A clone with no branch tracking and exactly one remote resolves to that sole remote, even
  when it is not named `origin` (precedence 2) — the defect this piece fixes.
- A clone with no branch tracking and multiple remotes one of which is `origin` resolves to
  `origin` (precedence 3).
- A clone where the resolver would otherwise name a non-existent `origin` fails with an
  actionable error naming `stateRemote` (precedence 4), surfaced as a CLI message rather than an
  unhandled crash.
- The function signature is unchanged; both call sites keep working and a thrown error from the
  code-clone call does not fire on a cross-repo sync where that value is unused.

**Test surface:** (a) tracking remote configured → that remote (precedence 1). (b) no tracking,
single remote named `upstream` → `upstream`, not `origin` (precedence 2). (c) no tracking,
remotes `upstream` + `origin` → `origin` (precedence 3). (d) no tracking, no `origin`, multiple
remotes → throws an actionable error naming `stateRemote` (precedence 4 / E). (e) the thrown
error is a `SquadError` whose message directs the operator to set `stateRemote`.

### B. Cover the cross-repo `--pull` real transport end-to-end

**Current behavior:** the piece-43 pull tests assert the resolved remote/branch are passed to a
**mocked** `hydrateTeamRootFromStateRef`; the real fetch is never driven from a resolved remote.

**Required behavior:** a **new** integration test (the existing plumbing assertions are not
weakened) exercises a cross-repo `sync --pull` against a **real bare state remote** whose state
branch is named `squad/state/<callsign>`, with the branch **derived** (no explicit
`stateBranch` in the registry entry), and asserts that `.squad` files are actually hydrated into
the team-root by a **real** git fetch — `_transport` is not mocked. This proves the resolver
(A/E) and the real transport together for the pull direction.

**Hard constraints:**
- The state branch is `squad/state/<callsign>` and is derived from the entry's callsign (no
  explicit `stateBranch`), matching the fold pipeline's namespaced target.
- The hydration is a real git fetch from a real bare remote; `_transport` is not spied/stubbed
  in this test.
- The assertion is on real filesystem effect (a known `.squad` file exists in the team-root
  after the pull), not on a mock call.
- The existing piece-43 mocked plumbing tests remain and still pass.

**Test surface:** publish (or synthesize) a `squad/state/<callsign>` branch on a real bare
remote; configure a registry entry with the callsign and no explicit `stateBranch`; run
`sync --pull`; assert the team-root now contains the hydrated `.squad` file.

### C. Cover the cross-repo `--push` real transport to a non-`origin` remote

**Current behavior:** the piece-43 push tests assert the resolved remote is passed to a
**mocked** `publishTeamRootToInbox`; no test drives a real push to a remote that is not named
`origin`.

**Required behavior:** a **new** integration test exercises a cross-repo `sync --push` against a
**real bare host remote that is not named `origin`**, with the remote **resolved** (no explicit
`stateRemote`, so resolution falls to the team-root host's sole remote per A), and asserts that
the inbox ref is actually published to that remote by a **real** git push — `_transport` is not
mocked. This proves the resolver's sole-remote precedence (A.2) together with the real transport
for the push direction.

**Hard constraints:**
- The team-root host's sole remote is **not** named `origin`; the entry has no explicit
  `stateRemote`, so the remote is resolved (precedence 2), not taken from a literal.
- The publish is a real git push to a real bare remote; `_transport` is not spied/stubbed in
  this test.
- The assertion is on a real ref appearing on the bare remote (a `squad/inbox/<callsign>/...`
  ref), not on a mock call.
- The existing piece-43 mocked plumbing tests remain and still pass.

**Test surface:** create a real bare remote and a team-root host whose sole remote (named, for
example, `upstream`) points at it; configure a registry entry with a callsign and no explicit
`stateRemote`; run `sync --push`; assert a `squad/inbox/<callsign>/...` ref exists on the bare
remote.

### D. Pin the `deriveStateBranch` flat-fallback for every invalid callsign shape

**Current behavior:** `deriveStateBranch` falls back to the flat `squad-state` branch for an
invalid callsign, but no test asserts this for the rejected shapes.

**Required behavior:** a focused unit test asserts that `deriveStateBranch(undefined, callsign)`
returns the flat `squad-state` branch for **every** invalid callsign shape — uppercase,
underscore, dot, leading digit, and over-length — and (as a positive control) that a valid
callsign yields `squad/state/<callsign>` while an explicit `stateBranch` wins verbatim. The
function's behavior is **not** changed; this is coverage only. If the test reveals a real gap in
`CALLSIGN_RE` (a shape the regex accepts that it should reject, or vice versa), that is recorded
as a finding to triage — not silently patched.

**Hard constraints:**
- `deriveStateBranch` is unchanged.
- Each invalid shape (uppercase, underscore, dot, leading digit, over-length) is asserted to
  return the flat `squad-state` fallback.
- A valid callsign still derives `squad/state/<callsign>`; an explicit `stateBranch` still wins.
- Any discrepancy surfaced by the test is triaged, not silently fixed.

**Test surface:** a table-driven unit test over the invalid shapes asserting the flat
`squad-state` result, plus the valid-callsign and explicit-`stateBranch` positive controls.

---

## Tier 2 (decision)

### E. Ambiguous resolution: no tracking remote, no `origin`, more than one remote

**Decision required:** what `resolveRemote` does when there is no branch tracking remote, no
remote named `origin`, and **more than one** remote configured (so the sole-remote precedence
A.2 does not apply and there is no `origin` to fall back to).

**Option E1 — Fail with an actionable error naming `stateRemote` (recommended).** Resolution
fails with a `SquadError` instructing the operator to set `stateRemote` explicitly, because the
resolver cannot deterministically choose among several remotes and must never guess. The failure
is surfaced as a clean CLI message. Cost: an ambiguous multi-remote clone that previously
resolved to a (possibly wrong) literal `origin` now fails fast — but that prior behavior was the
defect, and failing closed is safer than silently fetching from or, worse, pushing to the wrong
remote.

**Option E2 — Fall back to the first-listed remote.** Resolution picks the first remote returned
by `git remote`. Cost: convenient, but it can silently fetch from or publish state to the wrong
remote with no operator signal — exactly the class of silent-wrong-destination failure this
piece exists to remove.

**Recommendation: E1.** Fail closed and direct the operator to set `stateRemote`. The resolver
is deterministic and never guesses a remote that could be wrong; the one-line `stateRemote`
setting makes the choice explicit and auditable.

**Hard constraints (whichever is chosen):**
- The choice does not change precedence 1–3 (tracking remote → sole remote → existing
  `origin`); it governs only the otherwise-ambiguous case.
- A thrown error (E1) is a `SquadError` surfaced as a CLI message, not an unhandled crash, and
  names `stateRemote` as the fix.
- The decision and its rationale are recorded in the Phase-B triage file so it is auditable.

**Test surface:** for E1, a clone with multiple remotes, none named `origin`, and no branch
tracking causes `resolveRemote` to throw an actionable `SquadError` naming `stateRemote`. For
E2, the same clone resolves to the first-listed remote.

---

## Acceptance

- Build exits 0.
- The state-remote resolver prefers the branch's tracking remote; else, when exactly one remote
  is configured, it selects that remote; else `origin` only when `origin` actually exists; else
  it FAILS with an actionable error directing the operator to set `stateRemote` (A/E).
- A cross-repo `sync --pull` against a REAL bare state remote whose branch is named
  `squad/state/<callsign>` hydrates `.squad` files into the team-root (real git fetch, not a
  mocked transport) (B).
- A cross-repo `sync --push` against a REAL bare host remote that is NOT named `origin`
  publishes the inbox ref to that remote (C).
- `deriveStateBranch` returns the flat `squad-state` fallback for EVERY invalid callsign shape
  (uppercase, underscore, dot, leading digit, over-length), covered by a focused unit test (D).
- `deriveStateBranch` is unchanged; B/C/D add coverage and do not change runtime behavior.
- Every `resolveRemote` call site is intact; a thrown resolution error surfaces as an actionable
  CLI message (`SquadError`), not an unhandled crash, and a cross-repo sync does not throw on an
  unrelated code-clone remote configuration.
- The existing piece-43 mocked plumbing tests are not weakened and still pass.
- Sub-proposal E is resolved one way or the other: either ambiguous multi-remote resolution
  fails with an actionable error naming `stateRemote` (E1) or falls back to the first-listed
  remote (E2); the choice and rationale are recorded in the Phase-B triage.
- Tests cover: the four resolver precedence branches and the ambiguous-failure case (A/E); the
  real-transport pull hydration from a derived `squad/state/<callsign>` branch (B); the
  real-transport push to a non-`origin` remote (C); and the invalid-callsign flat-fallback table
  (D).
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
- No specific internal tenant/host URL appears in any documentation; placeholders use
  `dev.azure.com/contoso/MyProject`.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
