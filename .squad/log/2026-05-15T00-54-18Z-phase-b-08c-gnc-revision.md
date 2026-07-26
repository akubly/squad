# Phase B Piece 08c GNC Revision — Session Log

**Date:** 2026-05-15T00:54:18Z  
**Phase:** B (adversarial review + revision)  
**Piece:** 08c (lifecycle command resolver migration)  
**Agent:** GNC (Node.js Runtime)  
**Owner:** gnc-revision  

## Summary

Scribe archived Phase B piece 08c GNC revision decisions and cleaned up review inbox. RETRO blocker addressed (fail-closed validation), FIDO majors addressed (assertion strengthening + dispatch-level passthrough subprocess), test count 27/27 GREEN, scrub gate passed, commit ff55ecf7 pushed.

## Key Outcomes

### Blocker Resolution

✅ **RETRO Blocker #1:** Lifecycle commands now validate resolved squad paths exist via `lstatSync` before runner invocation. Fail-closed pattern mirrors `resolveByCallsign()`.

✅ **RETRO Blocker #2:** Explicit registry parse failures now throw `REGISTRY_INVALID` before any state creation. Auto-discovery continues silently (intentional).

### FIDO Major Addressal

✅ **FIDO Major #1:** `rc does not start bridge when resolution throws` now asserts error text visible in stdout/stderr.

✅ **FIDO Major #2:** Dispatch-level copilot args passthrough now tested via `runCliShort(['start', '--extra-copilot-flag'])` subprocess, proving dispatch filter does not strip non-squad args.

### Minor Enhancements

✅ **Flight symmetric test:** Added `start does not start bridge when resolution throws` (mirror of rc variant).

✅ **Deprecation gate:** Existing deprecation notice verified in dispatch tests.

✅ **Timeout flake mitigation:** Replaced 150ms `setTimeout` waits with `vi.waitFor()` deterministic polling.

## Metrics

- **Test suite:** 27/27 GREEN
- **Build:** clean
- **Scrub gate:** passed
- **Files touched:** 5 (resolution-v2.ts, start.ts, rc.ts, cli-entry.ts, legacy-resolver-migration.test.ts)
- **Decision merged:** gnc-08c-revision.md (3887 bytes)
- **Inbox cleaned:** fido-08c-review.md (git rm), gnc-08c-revision.md (deletion)

## Ready for Phase C

Branch `akubly/upstream-08c-migrate-lifecycle-commands` at `ff55ecf7` ready for PR creation. No further revision required.
