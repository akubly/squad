# Sims

> Integration & E2E Testing Specialist

## Summary

Sims owns end-to-end test coverage, integration test harnesses, cross-component validation, and regression detection through comprehensive fixture coverage. Core patterns: (1) Spec-parity audits across all test-surface items. (2) Adversarial probe design to expose edge cases in success+failure paths. (3) Platform-specific branch testing with explicit conditional assertions, not tautologies.

## Learnings

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
