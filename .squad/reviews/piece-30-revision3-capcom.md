# Piece 30 Revision-3 Follow-on Review — CAPCOM (Architecture/Contract)

**Reviewing:** commit 3c6c9edf (EECOM's revision) on top of bc6d0146  
**Scope:** new ref-membership fold logic only  
**Date:** 2026-06-02

**Verdict on prior M_NEW_1 (timestamp-skip data loss):** RESOLVED

**Overall verdict on revision-3:** APPROVE-WITH-NITS  
**New mandatory findings:** 0  
**New non-blocking findings:** 0  
*(Prior N1 and N3 from round 2 persist — noted below, not re-escalated; they were not in EECOM's scope.)*

---

## Summary

EECOM's revision correctly replaces the scalar `LAST_PUBLISHED_AT` timestamp cutoff with a ref-name set-membership check against `.[].inboxRef` in `publish-history.json`, eliminating the clock-skew and same-second tie data-loss defect flagged in round 2. The field name used for extraction (`.[].inboxRef`) matches the field written by the fold itself — the schema is self-consistent. All tested edge cases (empty array, missing file, malformed JSON, duplicate entries) behave correctly. Zero timestamp-based skip logic remains. The revision is correct within its stated scope and no new blocking issues were found.

---

## Prior-finding resolution

### M_NEW_1 — Timestamp-skip data loss (RESOLVED)

**What EECOM changed:** Entirely replaced the Step 2 skip logic. Old approach read `LAST_PUBLISHED_AT=$(jq -r '.[-1].publishedAt // empty' ...)` and skipped refs whose `publishedAt` was `≤ LAST_PUBLISHED_AT` — a scalar timestamp comparison that silently drops out-of-order and tie-timestamp refs. EECOM replaced this with:

```bash
FOLDED_REFS=$(jq -r '.[].inboxRef // empty' "$HISTORY_FILE" 2>/dev/null || true)
```

and a per-ref membership guard:

```bash
if [ -n "$FOLDED_REFS" ] && printf '%s\n' "$FOLDED_REFS" | grep -qxF "$REF"; then
  echo "  Skipping $REF (already recorded in publish-history.json)"
  continue
fi
```

**Does it match spec?** Yes. The spec (piece 30 §2) says "enumerate newly pushed inbox refs since the last recorded fold commit." The implementation now treats the set of `inboxRef` values already recorded in `publish-history.json` as the authoritative already-folded set — a stable, unique identifier per inbox ref immune to clock skew and tie-timestamp collisions. The fix is what CAPCOM prescribed in round 2.

**Field name verification:** Piece 28 does not define field names for `publish-history.json` entries. Piece 30 describes the content as "folded refs, fold commit SHA, fold timestamp." The fold writes history entries using `--arg inboxRef "$REF"` and reads back `.[].inboxRef` — the same field name in both directions. Self-consistent. No spec field-name mismatch.

**Gaps:** None within this fix's scope.

---

### Prior N2 — Sort tie-breaker used full ref name instead of developerAlias (RESOLVED as a side-effect)

EECOM updated the sort key from `publishedAt\tref` (two fields) to `publishedAt\tdeveloperAlias\tref` (three fields), and updated `cut -f2` to `cut -f3` accordingly. Spec §3 tie-breaker by `developerAlias` is now correctly implemented.

---

## New mandatory findings

None.

---

## New non-blocking findings

None new. The following are carry-forward from round 2, not re-escalated:

- **Prior N1 (persisting):** `foldCommit` stores `git rev-parse "$REF"` — the inbox branch HEAD SHA — not the fold commit SHA produced on `squad-state` after `git commit`. To capture the correct SHA: `git rev-parse HEAD` after the commit step. EECOM was not tasked to fix this.
- **Prior N3 (persisting):** Prune step re-enumerates ALL current remote inbox refs and deletes them, not just those folded in the current run. With the membership fix, the main risk vector (timestamp-skipped refs being pruned) is gone; the residual risk is refs skipped-with-warning (missing `publish-metadata.json`) being pruned when `pruneAfterFold=true`. Default is `false` — non-blocking unless a team opts in.

---

## Spec-conformance probe results

| Probe | Filter / pattern | Spec field | Match |
|-------|-----------------|------------|-------|
| Membership extraction | `jq -r '.[].inboxRef // empty'` | `inboxRef` (self-defined by fold write) | ✅ Consistent |
| Malformed JSON guard | `if ! jq empty "$HISTORY_FILE"` → `exit 1` | spec: abort on data integrity risk | ✅ Match |
| Empty array `[]` | `FOLDED_REFS=""` → no membership guard fires | spec: fold all (first fold) | ✅ Correct |
| Missing file | outer `if [ -f "$HISTORY_FILE" ]` skipped → `FOLDED_REFS=""` | spec: fold all | ✅ Correct |
| Duplicate `inboxRef` entries | `grep -qxF "$REF"` fires on first match | idempotent | ✅ Correct |
| Sort key | `publishedAt\tdeveloperAlias\tref`, `cut -f3` | spec §3: publishedAt then developerAlias | ✅ Match |

---

## Edge-case probe results

**Empty array `[]` in publish-history.json:** `jq -r '.[].inboxRef // empty' []` returns nothing. `FOLDED_REFS=""`. Membership guard condition `[ -n "$FOLDED_REFS" ]` is false. All refs proceed to fold. **Correct.**

**Missing publish-history.json:** `[ -f "$HISTORY_FILE" ]` is false. `FOLDED_REFS=""`. All refs proceed to fold. **Correct.** (Also covered: orphan-init path writes `[]` first; subsequent check is same as empty-array case.)

**Malformed JSON:** `jq empty "$HISTORY_FILE"` exits non-zero. Pipeline emits `::error::` annotation and calls `exit 1`. **Correct — abort prevents silent data loss.**

**Duplicate inboxRef entries (corruption):** `jq -r '.[].inboxRef // empty'` extracts all occurrences. `grep -qxF "$REF"` matches on the first. Membership skip fires. **Idempotent.**

**publishedAt missing from an otherwise-valid metadata file:** `REF_PUB_AT=""`. Sort key becomes `""\t"$ALIAS"\t"$REF"`. Empty-string primary key sorts before any ISO 8601 timestamp. Deterministic on re-run. Fold entry will contain `publishedAt: ""` — spec-violating per piece-28 (publishedAt required, ISO 8601 UTC), but this is an anomalous input case; the fold itself still succeeds and the ref is recorded in history.

**Inbox ref deleted between fetch and merge (race):** The `git fetch` at the top creates local remote-tracking refs (`refs/remotes/origin/squad/inbox/*`). Subsequent `git rev-parse "$REF"` and `git checkout "$REF" -- .squad/` resolve against the local copies, which survive the remote deletion within the same pipeline run. **Not a defect.**

**Partial fold failure (n refs folded, n+1th aborts):** `set -euo pipefail` causes `exit 1` on any failure in the loop. The fold commits for refs 1..n are local only. The "Fast-forward squad-state" step is downstream and carries ADO's default `condition: succeeded()` — it does not run on prior-step failure. `origin/squad-state` is not updated. On the next fold run, refs 1..n are re-folded (they're absent from `origin/publish-history.json`). **Correctly idempotent — partial success leaves history consistent.**

**Merge commit vs. flat commit:** `git checkout "$REF" -- .squad/` is a path-level tree copy, not a merge. Each fold commit is a flat commit on `squad-state` with a single parent. No merge commit noise. `git push --ff-only` validates the resulting linear history. **Correct pattern for state serialization.**

---

## Regression checks

- **Timestamp-skip patterns (`LAST_PUBLISHED_AT`, `publishedAt >`, `< $LAST_FOLDED`, etc.):** **0 occurrences.** Confirmed by exact-match search against full file at HEAD. Zero residual timestamp-based skip logic.
- **Sole-writer comment:** **Present and strong.** Exact wording: `# INVARIANT: This pipeline is the SOLE writer to refs/heads/squad-state. No other / pipeline, script, or workflow may push to squad-state. Direct developer pushes / must be blocked by branch policy. Exceptions require a decision record in / .squad/decisions/inbox/ and explicit user adjudication.`
- **`batch: true`:** **Present.** Line in trigger block: `batch: true  # serialize fold runs — at most one active, then one queued`
