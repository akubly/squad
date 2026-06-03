# Piece 30 Revision Follow-on Review — CAPCOM (Architecture/Contract)

**Reviewing:** commit a9da5453 (Booster's revision) on top of 10168051 (Flight's original)
**Scope:** inline fold logic + trigger correction + no-regression check
**Date:** 2026-06-02

**Verdict on prior M1 (nonexistent `squad fold`):** RESOLVED
**Verdict on prior M2 (wrong publish-inbox trigger):** RESOLVED

**Overall verdict on revision:** REJECT
**New mandatory findings:** 1
**New non-blocking findings:** 3

---

## Summary

Both prior blocking findings are cleanly resolved: the `squad fold` CLI call is gone (replaced with self-contained bash+jq plumbing), and the publish pipeline trigger is corrected to the spec-compliant exclude-only pattern. The revision is architecturally sound in its gross structure. However, the inline fold logic contains a correctness defect in its enumeration/skip step that causes permanent silent data loss for inbox refs with timestamp clock skew or same-second tie collisions — a blocking defect in the primary contract of the sole writer to `squad-state`.

---

## Prior-finding resolution

### M1 — `squad fold` does not exist as a CLI command

**What changed:** The entire `squad fold --state-branch ... --history-file ... --order ...` invocation at lines 60–63 of the original is removed. The Node.js installation and Squad CLI installation steps are also removed. In their place, a 150-line inline bash+jq script implements the fold entirely in pipeline-resident git plumbing. The `squad fold --prune` call in the prune step is also replaced with inline `git push origin --delete` commands. A comment at the top of the inline script explicitly states: "The fold pipeline does NOT invoke any squad CLI subcommand."

**Does it match spec intent?** Yes, structurally. The spec did not prescribe that a `squad fold` CLI command must exist — it specified the fold behavior. Inlining the logic is option (b) from my prior suggested fix and is defensible. The implementation covers all six spec steps.

**Gaps:** See New M1 below — the enumeration/skip step has a correctness defect that prevents this from being a complete resolution of the underlying contract.

**RESOLVED** — the nonexistent CLI call is gone.

---

### M2 — `publish-inbox.yml` CI trigger unreachable in product repo

**What changed:** The `include: squad/inbox/**` branch filter is removed entirely. The trigger block is now:

```yaml
trigger:
  branches:
    exclude:
      - squad-state
      - main
      - dev
```

The header comment is rewritten to accurately document the architecture: "Runs in the product repo (WORK_ROOT). Triggered by any feature-branch push except squad-state, main, and dev. Inbox branches (squad/inbox/<alias>/...) live in TEAM_ROOT (docs repo); this pipeline publishes state TO them via squad sync --push."

**Does it match spec intent?** Yes precisely. The spec says "Triggered by branch pushes only. No trigger on squad-state, main, or dev branches." Exclude-only is the correct ADO pattern for "all feature branches except these." The corrected header comment resolves the prior documentation gap as well.

**Gaps:** None for M2.

**RESOLVED** — trigger is now reachable and semantically correct.

---

## New mandatory findings

### M1 — Timestamp-based skip causes permanent data loss for out-of-order and tie-timestamp inbox refs

**What / where:** `fold-squad-state.yml` inline script, Step 2 enumeration + skip block (approximately lines 100–113 of the inline bash):

```bash
# Step 2: Determine last-folded publishedAt from history
LAST_PUBLISHED_AT=""
if [ -f "$HISTORY_FILE" ]; then
  LAST_PUBLISHED_AT=$(jq -r '.[-1].publishedAt // empty' "$HISTORY_FILE" 2>/dev/null || true)
fi

# ... for each REF:
if [ -n "$LAST_PUBLISHED_AT" ] && [ -n "$REF_PUB_AT" ]; then
  if [[ "$REF_PUB_AT" < "$LAST_PUBLISHED_AT" ]] || [[ "$REF_PUB_AT" == "$LAST_PUBLISHED_AT" ]]; then
    echo "  Skipping $REF (publishedAt=$REF_PUB_AT <= last=$LAST_PUBLISHED_AT)"
    continue
  fi
fi
```

**Why it blocks:** The skip condition is `publishedAt ≤ LAST_PUBLISHED_AT`. `LAST_PUBLISHED_AT` is the `publishedAt` value of the last entry in `publish-history.json` — a single timestamp scalar, not a set of folded ref names. Two failure scenarios cause permanent, silent data loss:

**Scenario 1 — Clock skew (realistic in multi-developer teams):** Developer A publishes at ISO timestamp T=1000. Fold run 1 folds A; history[-1].publishedAt = 1000. Developer B's machine clock is a few seconds behind; B's `publishedAt` field in `publish-metadata.json` is 995. B's push arrives at the remote after A's, triggering fold run 2. Run 2 reads LAST_PUBLISHED_AT=1000. B.publishedAt=995 < 1000 → B is skipped with the log message "Skipping … (publishedAt=995 <= last=1000)". B is never folded. With `pruneAfterFold=true` enabled, B is also deleted in the same run. B's state is permanently lost.

**Scenario 2 — Same-second tie, split across runs:** Developer A and Developer B both publish at T=1000 (second-level precision, realistic for two developers hitting sync within the same second). With `batch: true`, B's push may arrive after run 1's initial `git fetch`. Run 1 folds A, history[-1].publishedAt=1000. Run 2 starts: LAST_PUBLISHED_AT=1000, B.publishedAt=1000 == 1000 → B is skipped permanently.

**Root cause:** The spec says "Enumerate newly pushed inbox refs since the last recorded fold commit in `.squad/publish-history.json`." The implementation interprets this as a timestamp cutoff, but the history already contains `inboxRef` (the full ref name) for every folded entry. The correct idempotency check is ref-name membership in the history, not timestamp comparison:

```bash
# Correct approach — get set of already-folded inbox ref names from history
FOLDED_REFS=$(jq -r '.[].inboxRef' "$HISTORY_FILE" 2>/dev/null || echo "")

# For each REF:
if echo "$FOLDED_REFS" | grep -qxF "$REF"; then
  echo "  Skipping $REF (already in publish-history.json)"
  continue
fi
```

This is safe, idempotent, and immune to clock skew and tie-timestamp collisions.

**Suggested fix:** Replace the `LAST_PUBLISHED_AT` scalar approach with a set-membership check against `.[].inboxRef` entries in `publish-history.json`. The sort step (ordering by publishedAt then ref name) remains valid — only the skip predicate changes.

---

## New non-blocking findings

### N1 — `foldCommit` stores inbox ref SHA, not squad-state fold commit SHA

**Where:** inline fold script, commit-SHA capture line before the `jq -n` entry construction:

```bash
COMMIT=$(git rev-parse "$REF")
# ...
--arg foldCommit "$COMMIT" \
```

**What:** `$REF` is the remote-tracking ref for the inbox branch. `git rev-parse "$REF"` yields the inbox branch HEAD commit SHA. This is stored as `foldCommit` in the history entry. The actual fold commit — the new commit produced on `squad-state` by `git commit -m "fold: …"` — is never captured or stored.

The spec says history should contain "fold commit SHA." In context this refers to the commit produced on `squad-state`, which enables tracing: given a history entry, find exactly which commit on `squad-state` it corresponds to. The current implementation records the wrong SHA (source inbox commit, not destination fold commit).

**Suggested fix:** Capture the fold commit SHA after `git commit` and store it in the entry. Rename the source SHA to something accurate like `sourceCommit` or `inboxCommit`:

```bash
git commit -m "fold: $ALIAS / $SESSION (${PUB_AT:-$REF})"
FOLD_COMMIT_SHA=$(git rev-parse HEAD)
# Use $FOLD_COMMIT_SHA (not $COMMIT) as foldCommit in the entry
# Optionally rename $COMMIT to sourceCommit
```

---

### N2 — Sort tie-breaker uses full ref name instead of `developerAlias`

**Where:** inline fold script, sort key construction:

```bash
SORT_KEY="${REF_PUB_AT:-$REF}"
SORT_LIST+=("${SORT_KEY}"$'\t'"${REF}")
# ...
mapfile -t SORTED_REFS < <(printf '%s\n' "${SORT_LIST[@]}" | sort | cut -f2)
```

**What:** The spec defines the tie-breaker as lexicographic by `developerAlias`. The sort key is `publishedAt\t<full-ref-name>`. For same-timestamp refs, sorting by full ref name (`origin/squad/inbox/<alias>/<session>`) approximates sorting by alias (since alias comes first in the path), but includes the session-ID suffix. Two sessions from different aliases at the same timestamp sort correctly. Two sessions from the same alias at the same timestamp sort by session name, which is acceptable. The divergence from the exact spec wording is minor and has no known practical impact.

**Suggested fix:** Extract `developerAlias` from `META_JSON` and use it as the secondary sort key: `SORT_KEY="${REF_PUB_AT}${TAB}${ALIAS}${TAB}${REF}"`.

---

### N3 — Prune step deletes ALL inbox refs, not only successfully folded ones

**Where:** `fold-squad-state.yml` prune step:

```bash
while IFS= read -r REF; do
  REMOTE_REF="${REF#origin/}"
  git push origin --delete "$REMOTE_REF" 2>/dev/null ...
done < <(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/squad/inbox/')
```

**What:** The prune step re-enumerates ALL remote inbox refs (as of the initial fetch) and deletes them. If the skip logic (New M1) caused some refs to be silently excluded from folding, those unfolded refs are also deleted when prune is enabled. Prune defaults to false, so this only compounds the New M1 defect when a team opts in to pruning. If New M1 is fixed (membership-based skip), this becomes a non-issue — only already-folded refs would have been skipped, and deleting them is correct.

---

## Spec-conformance probe results

| Spec fold step | Pipeline implementation | Match |
|---------------|------------------------|-------|
| 1. Check out docs repo with full fetch depth | `checkout: self; fetchDepth: 0; persistCredentials: true` | ✅ Match |
| 2. Enumerate inbox refs since last fold commit in publish-history.json | `LAST_PUBLISHED_AT=$(jq '.[-1].publishedAt')` + `publishedAt ≤ LAST` skip | ⚠️ Diverges — uses timestamp scalar, not ref-name membership; data loss bug (New M1) |
| 3. Deterministic order: publishedAt then developerAlias | `sort` by `publishedAt\tREF` | ⚠️ Partial — publishedAt primary key correct; tie-breaker is full ref name, not alias alone (New N2) |
| 4. Update publish-history.json with fold provenance | Appends `{developerAlias, publishedAt, sessionId, inboxRef, foldCommit, foldedAt}` | ⚠️ Partial — `foldCommit` stores inbox ref SHA, not squad-state fold commit SHA (New N1) |
| 5. Fast-forward squad-state | `git push --ff-only origin HEAD:squad-state` | ✅ Match — `--ff-only` correctly enforced |
| 6. Optionally delete folded inbox refs (default off) | `pruneAfterFold` variable (default false); prune deletes all fetched inbox refs | ⚠️ Partial — deletes all refs, not just folded ones (New N3; only harmful when New M1 is also present) |

---

## Regression checks

- **`squad fold` references in revised files:** Zero in active code. Appears only in removed (`-`) diff lines and in the commit message describing what was removed. Clean.
- **`squad fold` references in any `+` line:** Zero. Confirmed by searching the diff output.
- **Other writers to `squad-state`:** `publish-inbox.yml` contains no `git push` to `squad-state` and its header comment explicitly states it never writes to `squad-state`. No regression.
- **`batch: true` present:** Yes — line 15 of the revised `fold-squad-state.yml` trigger block. Comment explains "serialize fold runs — at most one active, then one queued."
- **Sole-writer comment present:** Yes. Top of `fold-squad-state.yml`:

  ```
  # INVARIANT: This pipeline is the SOLE writer to refs/heads/squad-state. No other
  # pipeline, script, or workflow may push to squad-state. Direct developer pushes
  # must be blocked by branch policy. Exceptions require a decision record in
  # .squad/decisions/inbox/ and explicit user adjudication.
  ```

  Wording strength: **strong**. "SOLE writer" is capitalized. Adds branch-policy enforcement guidance and an explicit exception process. Upgrade from the original wording.
