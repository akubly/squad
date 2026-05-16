# 2026-05-15T23:20:52.565-07:00 — Booster — Self-healing test hooks

## Decision
When a test suite verifies committed mirror parity, do not run a mutating fixer in `beforeAll()` before the parity assertion. Check parity first, then run the fixer, or fail if the fixer would rewrite any tracked mirror file.

## Why
A self-healing setup hook can convert a stale tracked checkout into a passing test run by rewriting mirrors before the assertions execute. That hides partial landings and missed sync updates instead of catching them.

## Preferred pattern
1. Enumerate every tracked mirror target for the canonical source.
2. Snapshot each target's content hash before running the sync script.
3. Run the sync script.
4. Fail with a file-by-file message if any tracked mirror hash changed.
5. Keep the existing byte-for-byte parity assertions after the gate.

## Applied in
- `test/template-sync.test.ts`
- `scripts/sync-templates.mjs`

## Guidance for future tests
If a suite needs a fixer to stabilize generated content, run the parity gate before the fixer mutates tracked files. Error messages should name each rewritten file so the remediation is obvious.
