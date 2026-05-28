# Session Log: Piece 25 Spec Authoring (2026-05-27T23:45)

**Date:** 2026-05-27  
**Time:** 23:45 UTC  
**Agent:** Flight (Lead)  
**Topic:** Piece 25 — Resolver Rename and CLI Hardening  

---

## What Happened

Flight authored the piece 25 specification, selecting a minimal cluster from the ship-debt audit that bundles three orthogonal fixes:

1. **D-18:** SDK `resolveSquad` → `resolveSquadDir` rename with deprecation.
2. **CONTROL N2:** `DoctorSource` exhaustiveness guard deferred from piece 22 revision.
3. **CONTROL Directive 2:** `env` seam on CLI `resolveSquadDir` deferred from piece 23 review.

**Key constraint:** Deprecation strategy (Option A: alias + minor bump vs. Option B: removal + major bump) requires Brady's sign-off before implementation starts.

---

## Decisions

- ✅ **Option A (recommended):** Minor-bump approach. Keep `resolveSquad` as `@deprecated` alias, no consumer breakage.
- 🟡 **Brady decision pending:** Option A/B confirmation gates implementation kickoff.
- ✅ **Piece 25 branch:** `squad/piece-25-resolver-rename-and-cli-hardening` (from `squad/piece-24-sdk-adapter-otel-typing` or later from `dev`).

---

## Notes

Flight history was flagged for summarization at 23.6KB. Scribe archived pieces 22–24 learnings to history-archive.md and replaced main history with condensed version (6.1KB). All decisions merged. Ready for Scribe commit.

---

## Outcomes

✅ Piece 25 spec complete.  
✅ Handoff prepared.  
🟡 Brady decision pending (blocks implementation kickoff).  
✅ Scribe merging decisions and committing.
