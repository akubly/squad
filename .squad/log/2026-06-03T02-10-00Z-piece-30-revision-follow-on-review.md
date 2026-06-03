# Session Log — Piece 30 Revision Follow-On Adversarial Review

**Timestamp:** 2026-06-03T02:10:00Z (2026-06-02T19:10:00-07:00)  
**Session type:** Follow-on adversarial review (3 parallel background reviewers)  
**Commit reviewed:** a9da5453 (Booster's revision)  
**Original commit:** 10168051 (Flight's implementation)  

## Reviewer Verdicts

| Reviewer | Verdict | New Mandatory | New Nits | Status |
|----------|---------|---------------|----------|--------|
| CAPCOM | REJECT | 1 | 3 non-blocking | Blocks merge; must revise |
| RETRO | APPROVE-WITH-NITS | 1 (conditional) | 1 non-blocking | Approve; patch follow-on |
| FIDO | APPROVE | 0 | 2 non-blocking | Ready to merge |

**Overall outcome:** MIXED — 1 REJECT (CAPCOM), 1 APPROVE-WITH-NITS (RETRO), 1 APPROVE (FIDO)

## Locked-Out Authors

For next revision:
- **Flight** — locked out (original 10168051)
- **Booster** — locked out (revision a9da5453)

## Prior Finding Resolution Status

**CAPCOM (M1, M2):**
- M1 (nonexistent `squad fold`): RESOLVED ✅
- M2 (unreachable publish-inbox trigger): RESOLVED ✅

**RETRO (M1, M2, M3):**
- M1 (PAT-in-URL leak via Write-Host): PARTIALLY-RESOLVED ⚠️ (redaction correct; stderr gap remains)
- M2 (missing `--` on git clone): RESOLVED ✅
- M3 (no URL scheme allowlist): RESOLVED ✅

**FIDO (M1, PAO M1):**
- M1 (no execution-based idempotency test): RESOLVED ✅
- PAO M1 (docs-test sync — state-backends): RESOLVED ✅

## NEW Mandatory Findings

**CAPCOM M_NEW_1 — Timestamp-based skip logic data loss (CRITICAL)**
- **Issue:** Inline fold script uses `publishedAt ≤ lastFoldedTimestamp` comparison to skip already-folded refs. On clock skew or same-second ties, this silently drops new inbox refs with matching or earlier timestamps.
- **Impact:** Permanent, silent loss of developer submissions — reliability guarantee broken for multi-developer teams.
- **Root cause:** Fold logic makes timestamp ordering assumption that does not hold across pipeline runs or after clock adjustments.
- **Fix:** Use ref-name membership against `publish-history.json` (`.[].inboxRef`) instead of timestamp scalar comparison.

**RETRO M_NEW_1 — Git clone stderr leak (MEDIUM)**
- **Issue:** `git clone` failure paths emit unredacted URL (with embedded PAT) to stderr. On clone failure (expired token, wrong URL), raw error is captured into pipeline logs.
- **Root cause:** Booster's revision added URL scheme allowlist but did not suppress `stderr` on failure or redirect to sanitized message.
- **Impact:** Conditional leak (only on clone failure); lower likelihood than M1 in prior revision (always-emit path). But failure WILL happen in the field.
- **Fix:** Redirect stderr: `git clone 2>&1 ...` and emit sanitized error message instead of raw git error.

## Candidate Revision Authors

- EECOM (Core Dev) — available (piece-28 R2 approved, not locked)
- Procedures (Protocol) — available (has infrastructure charter)
- PAO (Release) — available (not locked from this round)

## Test & Quality Status

- **Test count:** 196 verified (14 ado-templates + 181 template-sync + 1 idempotency)
- **Mirror byte-identity:** PASS — all 3 canonical files byte-identical across 4 mirrors
- **Scrub-gate:** Gates 2, 5–9 pass; Gate 1 pre-existing baseline (zero new violations); Gates 3–4 WARN (state files expected)

## Next Steps

1. Revision R2 must address CAPCOM M_NEW_1 (timestamp skip logic)
2. RETRO M_NEW_1 (stderr leak) can be addressed in R2 or follow-on patch
3. Flight and Booster remain locked out; assign R2 to next available author
4. No PR opens until CAPCOM REJECT is resolved
