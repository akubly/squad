# Sims

> Integration & E2E Testing Specialist

## Summary

Sims owns end-to-end test coverage, integration test harnesses, cross-component validation, and regression detection through comprehensive fixture coverage. Core patterns: (1) Spec-parity audits across all test-surface items. (2) Adversarial probe design to expose edge cases in success+failure paths. (3) Platform-specific branch testing with explicit conditional assertions, not tautologies.

## Learnings

### 2026-05-18 — Init registry coverage

- Atomic rename protects registry writes from partial-file corruption, but it does not prevent lost updates when two init operations both do load-modify-write against the same registry file.
- Reactivation path matching depends on normalized absolute keys: trailing separators normalize cleanly, case-only variants normalize on Windows, and relative registry paths do not match reliably when they are resolved from a different base directory.
- CLI URL-guard rehearsals should cover multiple URL forms and URLs that appear after value-taking options, and they should assert rejection before either the scaffold or the registry file is created.

### Piece 10 Revision — Init Fail-Fast Test Coverage (2026-05-15T23:15:56Z)

📌 **Team update — Piece 10 Revision Complete:** EECOM locked out per strict lockout protocol after adversarial review split verdict (Flight APPROVE-3-notes, FIDO REJECT-6-gaps, RETRO APPROVE-WITH-FIXES). CONTROL + Sims assigned joint revision. Sims addressed all 6 FIDO test gaps: (1) guard-order CLI E2E via dispatch path with derived callsign conflict; (2) clone-collision tests for default+explicit registry scenarios; (3) `.squad` symlink collision with lstat rejection proof; (4) registry byte stability: snapshots after all conflict paths; (5) typed error assertions for `SquadError` and `ConfigurationError` instances; (6) test label/assertion alignment. Added scaffold-file assertions (no dir/file creation on conflict), CLI stderr contract assertions (specific conflict identification), exit code 2 verification on all paths. Surgeon squashed both revision commits into `331894e8`. Build CLEAN. 28/28 tests GREEN. Pattern reinforced: fail-fast guard tests should prove first guard, unchanged registry, unchanged scaffold surface, and process-visible error text in the same rehearsal. Ready for Phase C.

### Piece 09 — Watch/Triage Startup Resolution (2026-05-15)

📌 **Team update (2026-05-15T22:14:43Z — Piece 09 E2E Review + Phase C Assignment):** Piece 09 watch/triage startup resolution returned NEEDS-E2E-BEFORE-MERGE verdict (Sims). No node-pty-driven E2E rehearsal for watch/triage commands; spec requires terminal behavior verification. Missing happy-path rehearsal (consumer repo with registry resolution, CLI entry), failure rehearsal (ambiguous/missing resolution, error surfacing), triage command terminal tests, Ctrl-C/SIGINT handling, long-lived startup-context stability (post-mutation), and Windows path-normalization E2E. Phase C assignment: Sims to author node-pty E2E suite for watch and triage terminal rehearsals, signal handling, cross-platform path edge cases, and validate user-facing error messages.

Added mission checks for init guard ordering, cwd-based clone collision, registry byte stability on conflict, typed error assertions, inactive-entry reactivation, scaffold entries, and CLI stderr delivery. Pattern reinforced: fail-fast tests should prove first guard, unchanged registry, unchanged scaffold surface, and process-visible error text in the same rehearsal.

### Piece 08b Revision — Resolver Guard Harmonization (2026-05-14)

**Role:** Revision author (successor to EECOM, locked out per Reviewer Rejection Protocol)

#### Gap #3 Ruling — URL/Clone/Host-Verify Deferred

The three assign-to-copilot failure modes FIDO flagged (URL-without-clone-destination, clone failure, host verification failure) were deferred. Spec wording uses "preserve" — which presupposes prior existence. Since `assign-to-copilot` is introduced as new work in 08b, there is nothing to preserve. These are future feature work, not resolver-migration scope. Documented in `.squad/decisions/inbox/sims-08b-revision.md`.

#### Flight Nit Harmonization — Dispatch-Level Guard with Threading

Chose **dispatch-level guard** as the canonical pattern for all three commands (consistent with 08a pattern for read-only commands):

- `consult` and `link`: inline boolean guard (no stored result — runner is self-contained)
- `assign-to-copilot`: guard stores result and threads it into `RunAssignOpts.resolved`

Key insight: whether to thread the result depends on whether the runner needs the struct. If the runner re-resolves from the same inputs, that's fine and intentional (gate-only semantics). If the runner needs `resolved.path` or `resolved.callsign`, thread the result to avoid any guard/runner divergence.

#### FIDO Gap #1 — Consult Success Path Test

The consult setup success test required both a real git init on consumerRepo (for `setupConsultMode` to write `.git/info/exclude`) AND a personal squad via `squad init --global`. Both are achievable within the test fixture pattern using `execSync` for git init and `runCli` for init. Pattern: set up XDG env vars pointing to a test-local global config dir.

#### FIDO Gap #2 — Spec Requires ALL Named Side Effects

The spec lists `config.json`, `.gitignore`, and `.git/info/exclude` as side-effect locations. Testing only `config.json` absence leaves the other two unchecked. Checklist going forward: for every failure test, enumerate ALL file locations the command can write and assert none of them changed.

#### Reusable Pattern: Resolver Guard Threading

Extracted to `.squad/skills/resolver-guard-threading/SKILL.md`. Key components: dispatch-level guard shape, runner threading shape, testing checklist (failure path + success path + threading proof), and path validation before file writes.

---

### Piece 08b — User-Action Command Migration (2026-05-14)

**Revision owner assigned:** Sims (Integration / E2E)

**Blocking findings to address:**

1. **Consult setup-mode resolver-success path unexercised** — The spec requires every user-action command's success path to be covered. Current tests only exercise `consult --status`, which bypasses the resolver guard by design. Need: add test for `squad consult` (no flags) from registered consumer repo, asserting config is written and guard was sole resolution point.

2. **`.gitignore` non-mutation unverified** — Spec explicitly requires "does not append to .gitignore" on failure. Both consult and link failure tests check only `config.json`. Need: extend consult failure test to assert `.gitignore`/`.git/info/exclude` not written; extend link failure test similarly.

3. **Three assign-to-copilot spec-required failure modes absent** — Spec test surface lists URL-without-clone-destination, clone failure, and host verification as required. Implementation lacks these features. Need: file a scope decision (are these in 08b or deferred?), then add tests once scope is settled.

4. **Dead `resolved` variable in dispatch blocks** — Consult and link guards compute but don't thread `resolved` to runners. If runners re-resolve, guard+runner diverge on context. Need: verify pattern is intentional (gate-only semantics) or thread resolved value through.

**Additional gaps to address:**

- Coordinator-agent install path (`--no-install-agent` escape hatch) completely untested
- `assign` short alias never tested
- Symlinked target path in agent install never reached
- `teamRoot` relativity not proven (absolute path would pass `toBeTruthy()`)
- Case-insensitive callsign matching (win32/darwin) not tested

**Pattern learned:** Guard-only tests (prove failure-path exits) are insufficient when spec requires both success-path verification and side-effect non-mutation assertions on multiple file types. Checklist for revision: (a) is the success path exercised for every guarded command? (b) are ALL named spec side effects (not just config.json) explicitly asserted absent in failure paths? (c) are guard and runner decoupled (dead resolved variable)? (d) are platform-specific branches exercised with real conditional assertions, not tautologies?

**Flight nits (non-blocking, for post-08b cleanup):**
- Dual-resolver imports (resolveSquadV2 vs resolveSquad from different paths)
- Guard-location inconsistency (dispatch vs module boundary)

**RETRO hardening candidates (LOW, all noted for follow-up):**
- `--home` flag path validation (add `path.isAbsolute(home)` guard)
- `opts.cwd` normalization (add `path.isAbsolute(opts.cwd)` check)
- Test env isolation (`XDG_CONFIG_HOME`/`APPDATA` overrides)

**EECOM lockout status:** EECOM remains locked out for this cycle. Revision ownership transfers to Sims.

### Piece 09 — Watch/Triage Startup Resolution (2026-05-15)

📌 **Team update (2026-05-15T22:14:43Z — Piece 09 E2E Review + Phase C Assignment):** Piece 09 watch/triage startup resolution returned NEEDS-E2E-BEFORE-MERGE verdict (Sims). No node-pty-driven E2E rehearsal for watch/triage commands; spec requires terminal behavior verification. Missing happy-path rehearsal (consumer repo with registry resolution, CLI entry), failure rehearsal (ambiguous/missing resolution, error surfacing), triage command terminal tests, Ctrl-C/SIGINT handling, long-lived startup-context stability (post-mutation), and Windows path-normalization E2E. Phase C assignment: Sims to author node-pty E2E suite for watch and triage terminal rehearsals, signal handling, cross-platform path edge cases, and validate user-facing error messages.


---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.
