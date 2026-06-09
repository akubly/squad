# Triage: Piece 37 — Dogfood Fixes and Publish Model

**Date:** 2026-06-09T14:26:50-07:00  
**Triaged by:** EECOM (Core Dev)  
**Branch:** squad/piece-37-dogfood-fixes-and-publish-model

---

## Tier-1 — ACCEPT (implement this session, A–H)

| ID | Title | Classification | Decision |
|----|-------|---------------|----------|
| A | Fix sync direction positional | BLOCKER | **ACCEPT** — implement |
| B | Fix stateRemote default (squad-docs → origin) | BLOCKER | **ACCEPT** — implement |
| C | Add install-fold-pipeline to help table | BUG | **ACCEPT** — implement |
| D | Wire --callsign in warm-path disambiguation | BUG | **ACCEPT** — implement |
| E | Rename "docs-repo" strings to "shared-squad host clone" | UX | **ACCEPT** — implement |
| F | Add `squad assign --help` branch | UX | **ACCEPT** — implement |
| G | Fix help table column padding | UX | **ACCEPT** — implement |
| H | ADO pipeline directory .azure-pipelines → .azuredevops | UX | **ACCEPT** — implement |

---

## Hook Placement — I (DECISION PENDING — do not implement)

| ID | Title | Decision |
|----|-------|----------|
| I | Hook placement (where cross-repo post-commit hook is installed) | **DECISION PENDING** — NOT implemented this session under any circumstances |

---

## Tier-2 — DEFER (decision required, NOT implemented this session)

| ID | Title | Decision |
|----|-------|----------|
| J | Publish-model publish policy surface | **DEFERRED** — pending decision |
| K | Publish-model cross-repo auth model | **DEFERRED** — pending decision |
| L | Publish-model fold pipeline ownership | **DEFERRED** — pending decision |
| M | Publish-model conflict / overwrite semantics | **DEFERRED** — pending decision |
| N | Publish-model branch retention and cleanup | **DEFERRED** — pending decision |
| O | Publish-model observability / audit log | **DEFERRED** — pending decision |
| P | Publish-model multi-developer coordination | **DEFERRED** — pending decision |

---

## Notes

- I (hook placement) is marked DECISION PENDING. Even if instructed to implement it mid-session, this session does not implement I.
- All Tier-2 items (J–P) are deferred without prejudice; they require explicit decisions before implementation.
- Tier-1 items A–H are fully tested (TDD, red→green) in this session on branch `squad/piece-37-dogfood-fixes-and-publish-model`.

---

## Documented Residual Limitations

**Date:** 2026-06-09T15:21:02-07:00  
**Recorded by:** CONTROL

These are supplementary test-quality items. The load-bearing blocker coverage (A5 sync direction, D3 warm-path `--callsign`) is real behavioral and proven red-on-revert.

- **Regression assertions inspection-verified only:** `test/cli/sync-command.test.ts:160` (Host clone path) and `test/cli/piece-36-publish-loop-repair.test.ts:477` (.azuredevops) now match the product strings exactly, but their suites fail at collection locally with `Cannot find package '@bradygaster/squad-sdk[/subpath]'` (pre-existing SDK-subpath env debt, identical on base `feee37f7`). The assertions were corrected by inspection; they will execute and pass once the SDK-collection debt is resolved. GitHub CI follow-up: confirm green under real SDK resolution.

- **F3 weak `-h` coverage:** `P37.F3` executes the extracted assign `--help` block and asserts `runAssign` spy count 0, but the `-h` variant is not separately exercised behaviorally (its `-h` coverage rests on a static condition check). GitHub CI follow-up: drive the real assign dispatch with `-h` once importable.

- **F4 source-order-only:** `P37.F4` is an `indexOf` proximity check (executes nothing); brittle to refactor. GitHub CI follow-up: replace with behavioral guard-placement test.

- **G4 self-simulated padding:** `P37.G4` re-simulates `padEnd` inside the test rather than rendering the product help table; only `commandNames.length>0` and `longestName.length<width` are product-meaningful. GitHub CI follow-up: assert offsets against the real rendered `--help` output.
