### Piece 09 revision — CONTROL

**Verdict:** revised and ready for review.

**What changed:**
- Moved watch startup squad resolution behind an internal source path so the public watch command declaration no longer publishes the startup resolver.
- Removed the environment shape assertion from startup resolution.
- Strengthened watch and triage parity tests to enter the command boundary and verify startup reaches the first round using the resolved squad path.
- Replaced the new test non-null and error assertions with explicit narrowing.

**Validation:**
- `npm run build` passed.
- `npx vitest run test/cli/watch-triage-migration.test.ts` passed 5/5.
- `npx vitest run test/cli/ test/state-backend.test.ts` reported existing broader-suite instability: state-backend hook timeout, several CLI timeouts, one team-root-resolution assertion, and Vitest worker `onTaskUpdate` timeouts. These remain outside this revision.
- Scrub gate: Gate 1 baseline fail, Gate 3 baseline warning, Gates 2/4/5/6 pass.

**Phase C follow-ups:**
- Add Sims-owned terminal rehearsals for watch, triage, missing/ambiguous startup errors, signal shutdown, and long-lived startup-context stability.
- Add FIDO-owned coverage for malformed state context, mid-loop registry stability, empty/null path edges, and Windows registry path normalization.
- Investigate the state-backend related-suite nonzero exit and broader CLI timeout behavior as a separate stability item.
