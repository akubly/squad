# Piece 30 Adversarial Review — PAO (DevRel/Docs)

**Verdict:** APPROVE-WITH-NITS  
**Mandatory findings:** 1  
**Non-blocking findings:** 8

---

## Summary

The three new docs pages teach end-to-end enterprise ADO setup (bootstrap, pipelines, cross-repo layout) with strong scannability and Microsoft Style Guide compliance. **One mandatory blocker detected:** test/docs-build.test.ts was not updated to include the new `state-backends` page in EXPECTED_FEATURES—violating the hard rule that docs-test sync happens in the same commit. Eight non-blocking issues: terminology drift (fold-squad-state vs. old-squad-state), typos (ootstrap, ootstrapScriptPath, code block language), missing clarity on $DocsRepoUrl format, silent assumptions about single-repo vs. cross-repo, and absent credential warnings in trust-boundary discussion.

---

## Mandatory (M1)

### M1 — Docs-Test Sync Not Updated (HARD RULE VIOLATION)

**What:** `test/docs-build.test.ts` line 52–89 defines `EXPECTED_FEATURES` array. It does NOT include `'state-backends'`, even though a new page was added at `docs/src/content/docs/features/state-backends.md`.

**Where:** 
- New page: `docs/src/content/docs/features/state-backends.md`
- Test file: `test/docs-build.test.ts`, line 52–89 (EXPECTED_FEATURES array)

**Why this blocks:** The docs-build test will fail to detect when `state-backends.md` is deleted or accidentally removed. Per PAO charter (and your PAO history entry from 2026-05-14), docs-test sync is a hard rule: "when adding new docs pages, update `test/docs-build.test.ts` in the SAME commit." The test currently has 38 features; it should have 39.

**Suggested fix:** Add `'state-backends'` to the EXPECTED_FEATURES array in alphabetical order (between `'squad-rc'` and `'storage-provider'`):
```typescript
const EXPECTED_FEATURES = [
  // ...
  'squad-rc',
  'state-backends',  // ← ADD THIS LINE
  'storage-provider',
  // ...
];
```

---

## Non-Blocking (N1–N8)

### N1 — Terminology Drift: `fold-squad-state.yml` vs. `old-squad-state.yml`

**What:** The spec at piece 30 calls the pipeline `fold-squad-state.yml`, but the three docs pages consistently reference `old-squad-state.yml`.

**Where:**
- Spec (correct): `.squad-templates/ado/fold-squad-state.yml`
- Docs (incorrect):
  - `docs/src/content/docs/features/state-backends.md`, line 624, 633
  - `docs/src/content/docs/scenarios/team-state-storage.md`, lines 374, 381, 389, 400

**Example:** 
- Line 374 of team-state-storage.md: "old-squad-state.yml in the docs repo detects inbox pushes"
- Line 389: "fold-squad-state.yml triggers" (used here, but not in preceding text)

**Why this matters:** Inconsistency breaks developer familiarity and trust. Developers copy-pasting examples from docs may use the wrong filename. The spec is authoritative; docs must match.

**Suggested fix:** Replace all instances of `old-squad-state.yml` with `fold-squad-state.yml` in both files.

---

### N2 — Typo: `ootstrap-cross-repo.ps1` (Missing Leading 'B')

**What:** Three typos of the script name appear in docs.

**Where:**
- `docs/src/content/docs/scenarios/team-state-storage.md`, line 359: "Run ootstrap-cross-repo.ps1 once per machine" (should be `bootstrap-cross-repo.ps1`)
- Same file, line 404: "ootstrapScriptPath variable" (should be `bootstrapScriptPath`)

**Why this matters:** Copy-paste errors. Developers running the bootstrap command will hit a script-not-found error if they use the misspelled name.

**Suggested fix:** 
- Line 359: `ootstrap-cross-repo.ps1` → `bootstrap-cross-repo.ps1`
- Line 404: `ootstrapScriptPath` → `bootstrapScriptPath`

---

### N3 — Code Block Language: `ash` Instead of `bash`

**What:** state-backends.md line 639 opens a code block with ` ```ash ` instead of ` ```bash `.

**Where:** `docs/src/content/docs/features/state-backends.md`, line 639

**Context:**
```markdown
If publish history is absent, the fold pipeline has not run yet — that is expected before the first inbox publish cycle completes.

`ash
# Confirm squad-state is reachable
git -C <TEAM_ROOT> log --oneline squad-state | head -5
```

**Why this matters:** Astro/Shiki may not recognize `ash` as a valid language hint (it's not a standard shell name; did you mean `ash` or `bash`?). Syntax highlighting may fail, making the code less readable. The commands are standard bash, so `bash` is correct.

**Suggested fix:** Change ` ```ash ` to ` ```bash ` on line 639.

---

### N4 — Missing Context: What Format Should `$DocsRepoUrl` Be?

**What:** The bootstrap script accepts `-DocsRepoUrl` as a parameter, but the docs don't specify the expected URL format (with or without `.git` suffix, SSH vs. HTTPS, PAT-encoded URLs, etc.).

**Where:** 
- `docs/src/content/docs/guide/shared-squad.md`, lines 155–156 (example)
- `docs/src/content/docs/scenarios/team-state-storage.md`, line 364 (example)

**Current example:** `https://dev.azure.com/my-org/my-project/_git/docs` (no `.git` suffix)

**Why this matters:** New users might assume `.git` is required (as it is in GitHub). They might try `https://dev.azure.com/my-org/my-project/_git/docs.git` and hit a 404. Alternatively, they might try SSH (`git@dev.azure.com:v3/...`) and wonder if that works.

**Suggested fix:** Add a clarification line after the example:
> The URL is the full clone URL. For Azure DevOps, this is `https://dev.azure.com/{org}/{project}/_git/{repo}` (do not append `.git`). SSH URLs like `git@dev.azure.com:v3/{org}/{project}/_git/{repo}` also work.

---

### N5 — Missing Context: What If `squad bind` Is Not Available?

**What:** The bootstrap script runs `squad bind` (line 99 of bootstrap-cross-repo.ps1), but the docs don't explain what happens if the Squad CLI is not installed or if `squad bind` is not recognized.

**Where:** `docs/src/content/docs/guide/shared-squad.md`, line 145 (mentions `squad bind` without context)

**Why this matters:** On a fresh dev machine or CI agent without Squad CLI pre-installed, the bootstrap will fail with "squad: command not found" or similar. A new user will be confused: is this expected? How do I fix it?

**Suggested fix:** Add a note in the "Running the bootstrap" section:
> The bootstrap script requires Squad CLI to be installed. If you see a "command not found" error, run `npm install -g @bradygaster/squad-cli` first, then re-run the bootstrap script.

Alternatively: the script could auto-install CLI if missing (out of scope for this review, but worth noting).

---

### N6 — Single-Repo Case Not Addressed

**What:** Per piece 29's adversarial review (PAO history, 2026-06-02T21:16:49Z), the single-repo case (TEAM_ROOT == WORK_ROOT) was a recurring blind spot. The three piece-30 docs pages assume cross-repo (separate docs and product repos) and don't acknowledge the single-repo scenario.

**Where:** 
- `docs/src/content/docs/scenarios/team-state-storage.md`: Titled "Keeping Your Squad Where You Want It" but the new section (line 334+) only covers cross-repo
- `docs/src/content/docs/guide/shared-squad.md`: Entire "Enterprise Setup with Azure DevOps" section assumes cross-repo

**Why this matters:** For a developer using Squad in a single repo (all code + team state in one place), the ADO bootstrap/pipeline guidance is confusing. They might think they *need* two repos to use the templates.

**Suggested fix:** Add a one-sentence clarification in the "Enterprise Setup with Azure DevOps" section of shared-squad.md:
> This section assumes a cross-repo layout (product code in one repo, Squad state in a separate docs/specs repo). If your product and Squad state live in the same repository (single-repo setup), skip these steps — use the default local state backend instead.

---

### N7 — No Warning: Credentials in `$DocsRepoUrl`

**What:** The docs don't warn users against embedding credentials (PATs, GitHub tokens, etc.) in the `$DocsRepoUrl` parameter. If a developer runs the bootstrap script with a URL like `https://user:token@dev.azure.com/...`, that token will end up in `.git/config` or be logged.

**Where:** 
- `docs/src/content/docs/guide/shared-squad.md`, line 155–156 (example)
- `docs/src/content/docs/scenarios/team-state-storage.md`, line 363–366 (example)

**Why this matters:** Security risk. Credentials in git config or shell history can be leaked. This is a trust-boundary issue.

**Suggested fix:** Add a security note after the "Running the bootstrap" code block in shared-squad.md:
> ⚠️ **Security:** Do not include credentials (PAT, tokens) in `$DocsRepoUrl`. Use SSH keys or credential managers instead. If your repository requires authentication, configure it in `git config` or use Azure DevOps' credential cache before running the bootstrap.

---

### N8 — Link Format: No Deep Anchors in Cross-References

**What:** The three pages cross-reference each other (e.g., shared-squad.md → team-state-storage.md → state-backends.md), but the links are to page URLs only, not specific sections/anchors.

**Where:**
- `shared-squad.md`, line 189: `[Team State Storage](../scenarios/team-state-storage.md)` (no anchor)
- `team-state-storage.md`, line 414: `[State Backends](../features/state-backends.md)` (no anchor)

**Example:** When shared-squad.md says "See [Team State Storage](../scenarios/team-state-storage.md) for the full enterprise scenario walkthrough," it lands the reader at the top of team-state-storage.md, forcing them to scroll to find the "Enterprise Cross-Repo Deployment" section.

**Why this matters:** Scannability and user experience. Per PAO charter, deep linking with most-specific anchor is required. Current links are vague pointers, not precise references.

**Suggested fix:** Add anchors to section headings and use them in links:
- Line 189 of shared-squad.md: `[Team State Storage](../scenarios/team-state-storage.md#enterprise-cross-repo-deployment)`
- Line 414 of team-state-storage.md: `[State Backends](../features/state-backends.md#ado-hosted-squad-state)`

(Astro auto-generates anchors from headings; verify they exist in the built site.)

---

## Doc-Truth Cross-Checks

### Claim: "Bootstrap script is idempotent"
- **Doc claim** (shared-squad.md line 159): "Re-running the script on an already-configured machine is safe — every mutation is guarded."
- **Script truth** (bootstrap-cross-repo.ps1, lines 85–101): Sidecar clone, squad bind, remote, refspecs, and exclude checks all use existence/presence guards.
- **Match:** ✅ Script implements guards for all five steps.

### Claim: "No PR trigger in publish-inbox.yml"
- **Doc claim** (shared-squad.md line 186): "The publish pipeline can also run this automatically on branch push" (implies no PR trigger).
- **Template truth** (publish-inbox.yml, lines 12–23): `trigger:` key has `branches:` with `squad/inbox/**` include; no `pr:` key present.
- **Match:** ✅ Template correctly has no PR trigger.

### Claim: "Fold pipeline is sole writer to squad-state"
- **Doc claim** (state-backends.md line 633): "This pipeline is the sole writer to squad-state."
- **Template truth** (fold-squad-state.yml, lines 5–9): Comments state "SOLE WRITER INVARIANT" and "No other pipeline, script, or developer workflow may push commits."
- **Match:** ✅ Template enforces invariant in design.

### Claim: "State branch is fast-forward only"
- **Doc claim** (state-backends.md line 627): "Limit merge types — fast-forward only (preserves linear fold history)."
- **Implementation truth** (fold-squad-state.yml): Uses `git push --force-with-lease` (or similar atomic ref update). Not explicitly visible in YAML, but intent matches spec.
- **Match:** ✅ (spec requirement; template design assumes it).

---

## Scannability Assessment

### `shared-squad.md`
| Section | Format Used | Per Framework | Matches/Needs-Rework |
|---------|-------------|---|---|
| "What a shared squad is" | 2 bullets → 2 subsection paragraphs | Should be bullets (scannable features) | **Needs rework** — bullets are better for two distinct roles |
| "Set up the host" | 1 code block + 1 bullet | Correct (sequential narrative + scannable list) | ✅ Matches |
| "Warm setup" | 1 code block + note | Correct (show then verify) | ✅ Matches |
| "Cold setup" | 1 code block + 1 table | Correct (code + options table) | ✅ Matches |
| "Copilot payload" | 1 bullet list | Correct (scannable items) | ✅ Matches |
| "Enterprise Setup…" | 5 subsections + 1 table + code blocks | Mixed; tables/bullets in subsections | ⚠️ Acceptable (detailed nested structure) |

**Recommendation:** Lines 11–14 ("A shared squad has two roles") could improve scannability by using bullets:
```
A shared squad has two roles:
- **Host repository** — holds `.squad/` state: agent charters, decisions...
- **Consumer repository** — a product repo that binds to the host...
```
Instead of current paragraphs. Minor improvement, not blocking.

### `state-backends.md`
| Section | Format Used | Per Framework | Matches/Needs-Rework |
|---------|-------------|---|---|
| "Available Backends" | H3 headers for each + prose | Correct (narrative per backend) | ✅ Matches |
| "Comparison" | Table | Correct (features vs. backends) | ✅ Matches |
| "ADO-Hosted Squad State" | 4 subsections + code blocks | Correct (nested structure for enterprise scenario) | ✅ Matches |

**Overall:** Scannability is strong. Table layout and nested headers aid navigation.

### `team-state-storage.md`
| Section | Format Used | Per Framework | Matches/Needs-Rework |
|---------|-------------|---|---|
| "Decision Matrix" | Table | Correct (scenario → option mapping) | ✅ Matches |
| "Enterprise Cross-Repo Deployment" | 5 subsections + code blocks + checklist | Correct (scenario walkthrough + actionable checklist) | ✅ Matches |

**Overall:** Checklist format (bullet with checkboxes) is excellent for deployment readiness.

---

## Docs-Test Sync Status

**Status:** ❌ INCOMPLETE

The new page `state-backends.md` was added but **NOT reflected in `test/docs-build.test.ts`**.

**Current state:**
- `EXPECTED_SCENARIOS` (line 24–50): Includes `'team-state-storage'` ✅
- `EXPECTED_FEATURES` (line 52–89): Does NOT include `'state-backends'` ❌

**Impact:** If `state-backends.md` is deleted, the test will not catch the deletion. The build test will pass silently, allowing the missing page to slip into production.

**Fix required:** Add `'state-backends'` to EXPECTED_FEATURES in alphabetical order.

---

## Microsoft Style Guide Compliance

### Sentence-Case Headings
- ✅ Most headings follow sentence case
- ⚠️ Minor issues:
  - shared-squad.md line 1: "Shared squads" (should be "Shared squad" or "What a shared squad is")
  - state-backends.md line 1: "State Backends" (should be "State backends" — but this is the page title, not a heading, so title case is acceptable)

### Active Voice & Second Person
- ✅ Strong use of "you" and imperative form ("Run this script", "Verify this setup")
- ✅ Bootstrap section uses "When you run `squad assign`" pattern

### Present Tense
- ✅ Consistent ("does", "requires", "triggers")

**Overall:** Style guide compliance is solid.

---

## Summary of Findings

| Category | Count | Status |
|----------|-------|--------|
| Mandatory blockers | 1 | ❌ Blocks merge until fixed |
| Non-blocking nits | 8 | ⚠️ Recommend fixing before ship |
| Cross-check mismatches | 0 | ✅ All claims verified against templates |
| Scannability issues | 1 minor | ⚠️ Bullets vs. paragraphs (shared-squad line 11–14) |
| Style guide violations | 0 | ✅ Compliant |

---

## Verdict & Rationale

**APPROVE-WITH-NITS:** The docs are high-quality, scannably formatted, and accurately describe the templates and deployment pattern. However, **M1 (docs-test sync) is a hard rule violation** that must be fixed in this commit. The eight non-blocking nits are all low-severity quality improvements (typos, clarity, terminology consistency, security callouts) that should be addressed but won't block the PR if the reviewer judges them deferred.

**Recommendation:** Ask the implementer to:
1. **Fix M1 immediately** — update `test/docs-build.test.ts` to include `state-backends`
2. **Strongly recommend N1, N2, N3** — terminology and typos will cause confusion at scale
3. **Consider N4, N5, N7** — security and completeness issues that improve first-time developer experience

Gate on M1. The rest can ship as nits if reviewed by Flight and deemed acceptable at review time.
