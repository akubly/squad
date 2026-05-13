# Piece 02 — Adversarial Review Session

**Timestamp:** 2026-05-13T06:07:00Z  
**Requestor:** Brady  
**Branch:** `akubly/upstream-02-resolver-worktree-callsign`  
**Commit:** 68b4f379 (resolver-worktree-callsign)

## Reviewers & Verdicts

| Agent  | Role     | Verdict               | Blocking | Should-Fix |
|--------|----------|----------------------|----------|-----------|
| FIDO   | Quality  | CONDITIONAL           | 2        | 5         |
| RETRO  | Security | CLEAR                 | —        | 2         |
| Flight | Lead     | APPROVE WITH CONDITIONS | —        | 3         |

## Consolidated Findings

**Blocking Issues (Phase C Gate):**
1. Test isolation failure (FIDO) — `opts.env` not set in worktree-local tests allows inheritance from `process.env.SQUAD_CALLSIGN`
2. Empty callsign test coverage gap (FIDO) — `opts.callsign = ''` path untested

**Hardening Recommendations:**
- Callsign character-set validation (RETRO) — restrict to `[a-zA-Z0-9_-]`, non-breaking
- Error-code typing (FLIGHT) — backfill four typed `code` fields on `SquadError` for CLI discriminability

**Architectural Concerns:**
- Module naming policy needed (FLIGHT) — no `-vN` in permanent SDK names; rename or document exception
- Error model standardization (FLIGHT) — type-checked reason codes for downstream consumers

## Team Status

User Brady has been presented with the consolidated verdict. All three reviewers concur that piece 02 is **conditionally acceptable** — blocking items must be resolved, architectural decisions (error-code typing, naming) can ship with piece 02 or defer to next piece depending on Brady's routing call.

CONTROL (piece author) is NOT locked out. Awaiting Brady's remediation directive.

## Next Action

Brady decides:
1. Route blocking fixes to CONTROL or assign new piece (estimated < 1 hour)
2. Accept hardening recommendations as optional follow-up
3. Approve error-code typing backfill (non-breaking)
4. Resolve module-naming policy (rename piece vs permanent suffix exception)
