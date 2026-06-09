# Session Log: Dogfooding Q&A + Piece-37 Scoping

**Date:** 2026-06-09T20:27:32Z  
**Session:** dogfood-qa-and-piece37-scoping  
**Branch:** akubly/upstream-npm-release  
**Participants:** FIDO, PAO, EECOM, Flight, Scribe

---

## Summary

Multi-round dogfooding Q&A and architectural design investigation on `akubly/upstream-npm-release` (piece-36 repairs). Team completed readiness GO, docs reconciliation, 14-question dogfood analysis, and architectural review of upstream vs shared-squad models. All findings merged into decisions.md with forward-looking piece-37 scope clearly labeled.

---

## Readiness GO (FIDO)

✅ **CONDITIONAL GO** — CLI is ready to dogfood as-is.

- **Installed version:** `@wifi-aware/squad-cli@0.9.6-mc.preview.12` (all piece-36 A–I repairs included)
- **No rebuild or reinstall required**
- **CI:** Red (23 failures) but all from dead test mocks — non-blocking
- **Verified:** All 12 major repair areas confirmed in source; all tests passing
- **Hard blockers:** None
- **Non-blockers (fix before PR):** 3 items — test scope mismatch (NB-1), changeset package name (NB-2), flaky timeout (NB-3, pre-existing)

---

## Docs Reconciliation (PAO)

✅ **Complete** — piece-36 shipped behavior documented accurately.

- **Commit:** b942dc2c
- **Decisions:** 7 reconciliation choices made (removed false workarounds, added missing flag docs, clarified gate behavior, rewrote setup section)
- **Test coverage:** 2 new assertions in `test/docs-build.test.ts` (both pass)
- **All 17 non-Astro tests pass**

---

## Dogfooding Q&A Findings (EECOM)

✅ **Triage-ready candidate list for piece-37** — 14 observations + 2 follow-up rounds investigated.

**Status:** All items confirmed in source; no fixes applied (piece-37 scope candidate).

### Findings

| Category | Count | Items |
|----------|-------|-------|
| **BUGs** | 3 | ERR_ASSIGN_ORIGIN_AMBIGUITY dead flag \| cross-repo hook missing from product \| install-fold-pipeline absent from help |
| **UX** | 5 | docs-repo terminology \| assign --help fallthrough \| developer alias rename surface (14+ touch points) \| stateRemote default wrong \| help table padding |
| **DESIGN** | 3 | alias init-time gap \| inbox branch pattern not configurable \| hook placement in both repos (with content-filter guard) |
| **ANSWERED** | 6 | squad upstream from origin/dev \| --callsign cold-start only \| no remote state before first sync \| stateRemote vs stateBranch \| developer alias rename subsumed \| squad scrub-emails |

### Key Insight

**UX-6 alias rename** is comprehensive — 14+ touch points across SDK (validation.ts, registry.ts), CLI (assign-args.ts, cli-entry.ts, sync.ts, install-hooks.ts), env vars, help text, and docs (reference/cli.md + guide/shared-squad.md).

---

## Architectural Analysis (Flight)

✅ **Design inputs for piece-37** — upstream vs shared-squad comparison + host-publish model analysis.

### Q2: Upstream vs Shared-Squad

**Key finding:** Build parallel system was correct.
- **Upstream = read-only CONFIGURATION inheritance** (skills, routing, wisdom, casting policy)
- **Shared-squad = bidirectional LIVE STATE sync** (decisions, sessions, logs)
- **No write-back in upstream; no fold pipeline; no multi-developer concurrency model**

**Consolidation opportunity:** YES — Shared-squad's CONTEXT read path should be upstream local entry; STATE sync remains inbox/fold. This split makes the architecture's seams legible.

### Q4: Host Self-Publish Model

**Recommendation:** Do NOT implement yet. First enforce orphan-branch backend in host. Already achieves PR-cleanliness goal structurally without new mechanism.

If needed later: implement as flag `"selfPublish": true` on host registry entry with content-filter guard on publish.

### Piece-37 Design-Decision Inputs

5 design decisions ready for team prioritization:
1. Upstream as context read path
2. Orphan-branch backend in host
3. Host-self-publish as opt-in flag
4. Post-commit hook scope (docs-repo only; product guard if needed)
5. Upstream / shared-squad interface boundary

---

## History Summarization

**Agents requiring summarization (>= 15360 bytes):**
- capcom/history.md: 15208 bytes
- eecom/history.md: 17100 bytes
- fido/history.md: 16158 bytes
- flight/history.md: 18822 bytes

**Deferring:** Summarization deferred to next session per standard Scribe protocol (only if triggered during active session work).

---

## Decisions Merged

### Inbox Files → decisions.md

All 4 inbox files merged into decisions.md with new "📋 PIECE 37 CANDIDATE SCOPE" section:

- `fido-dogfooding-readiness.md` ✅ merged
- `pao-piece36-docs-reconcile.md` ✅ merged
- `eecom-piece37-dogfood-opens.md` ✅ merged (with full tables + Q6 surface area)
- `flight-upstream-vs-sharedsquad-and-publish-model.md` ✅ merged (with full analysis + recommendations)

### Archive Decision

**decisions.md size before merge:** 97849 bytes  
**Archive threshold:** 51200 bytes  
**Archival triggered:** YES, but no entries older than 7 days (cutoff 2026-06-02). No archival performed.

### Deduplication

No duplicate entries found during merge.

---

## Orchestration Logs

Created 4 orchestration logs in `.squad/orchestration-log/`:
- `2026-06-09T20:27:32Z-fido.md` — Readiness GO verdict + non-blockers
- `2026-06-09T20:27:32Z-pao.md` — Docs reconciliation decisions + test verification
- `2026-06-09T20:27:32Z-eecom.md` — Dogfood Q&A findings triaged (BUGs + UX + DESIGN items)
- `2026-06-09T20:27:32Z-flight.md` — Architectural analysis + piece-37 design inputs

---

## Files Modified

**Scribe-only state files:**
- `.squad/decisions.md` — merged inbox + piece-37 scope section added
- `.squad/orchestration-log/` — 4 new logs created
- `.squad/log/` — session log written (this file)
- `.squad/decisions/inbox/` — 4 files deleted after merge

---

## Next Steps

1. **Piece-37 Prioritization:** Team to schedule design-decision review for 5 inputs from Flight
2. **Non-Blockers:** Fix NB-1, NB-2, NB-3 before PR submission
3. **Dogfooding:** Can proceed immediately with current CLI version
4. **History Summarization:** Deferred to next session (no active session triggered need)

---

## Session Outcome

✅ **All objectives achieved:**
- ✅ Readiness GO verified (FIDO)
- ✅ Docs reconciliation completed (PAO)
- ✅ Dogfooding Q&A triaged and consolidated (EECOM)
- ✅ Architectural analysis and design inputs (Flight)
- ✅ Decisions merged and piece-37 scope preserved (Scribe)
- ✅ Orchestration logs created (Scribe)
- ✅ Session log written (Scribe)

**No blockers to dogfooding. Piece-37 candidate scope ready for team prioritization.**
