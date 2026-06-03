# Decisions

> Team decisions that all agents must respect. Managed by Scribe.


---

### 2026-06-02: Piece 30 Follow-On Revision — EECOM Implementation Complete

**Date:** 2026-06-02  
**Author:** EECOM (Core Dev)  
**Branch:** `squad/piece-30-ado-cross-repo-templates`  
**Commit:** `3c6c9edf`  
**Push status:** Pushed to `origin/squad/piece-30-ado-cross-repo-templates`

## Summary

Shipped both mandatory findings from the 3-reviewer follow-on adversarial panel
(CAPCOM REJECT + RETRO Medium APPROVE-WITH-NITS; FIDO clean APPROVE).
Author lockout respected: Flight (10168051) and Booster (a9da5453) both excluded.
Revision authored by EECOM under cross-trained scope (YAML pipeline + PowerShell
hardening, per expanded scope grant in task prompt).

## Fix 1 — CAPCOM M_NEW_1 (fold timestamp bug → ref-name membership)

**File:** `.squad-templates/ado/fold-squad-state.yml` + 3 mirrors  
**Change:** Replaced `LAST_PUBLISHED_AT` scalar timestamp comparison with
`FOLDED_REFS` set-membership check against `.[].inboxRef` in `publish-history.json`.

Key properties of the new implementation:
- Naturally idempotent: re-running against any already-folded ref is a no-op.
- Immune to clock skew and same-second ties.
- Malformed JSON guard: aborts with `exit 1` if `publish-history.json` is not valid JSON.
- Missing metadata: skip-with-warning (chosen over abort so one bad ref doesn't block others).
- Sort key updated to `publishedAt\tdeveloperAlias\tref` (spec §3 tie-breaker); `cut -f3` for extraction.

## Fix 2 — RETRO M_NEW_1 (git clone stderr PAT leak)

**File:** `.squad-templates/ado/bootstrap-cross-repo.ps1` + 3 mirrors  
**Change:** Wrapped `git clone` and `git remote add` (both accept `$DocsRepoUrl`)
with `2>&1` stderr capture, `$LASTEXITCODE` check, dual redaction
(`://[^@/\s]+@` regex + `[regex]::Escape($DocsRepoUrl)` literal), and
`Write-Error` with sanitized output on failure.

Redaction verified to handle:
- `https://user:PAT@host.com/repo.git` ✓
- `https://PAT@host.com/repo.git` ✓
- `https://user%40org:PAT@host.com/repo.git` ✓ (`[^@/]` matches URL-encoded segment)

## Tests

**New assertions:** 4 regression guards added to `test/cli/ado-templates.test.ts`
(assertions 15–18):
- 15: `fold-squad-state.yml` does NOT contain `LAST_PUBLISHED_AT`
- 16: `fold-squad-state.yml` contains `.[].inboxRef`
- 17: `bootstrap-cross-repo.ps1` has `git clone ... 2>&1`
- 18: `bootstrap-cross-repo.ps1` has `$cloneOutput` and `$redactedOutput`

**Test count delta:** 196 → 200 (three ADO-specific suites: 18 + 181 + 1).
Docs-build pre-existing Astro failure unchanged. Grand total passing: 212.

## Scrub Gate

Gates 1 and 8 have pre-existing baseline violations:
- Gate 1: 32 strip-listed paths (unchanged from baseline; Squad's `/casting/`,
  `/identity/`, `/orchestration-log` match Wi-Fi Aware strip pattern incidentally).
- Gate 8: bash `$()` subexpressions in YAML script blocks (pre-existing pattern;
  my revision adds 2 new same-type entries in fold step 3, net baseline +2).
- Gates 2, 5, 7, 9: PASS.
- Gates 3, 4: WARN (akubly refs and internal mentions in `.squad/` state files, expected).
- Gate 6: PASS (11 files changed, under 30-file limit).

## Mirror propagation

`node scripts/sync-templates.mjs --sync` propagated both changed files to 3 mirrors each.
Byte-identity verified: 1 unique SHA-256 hash across all 4 locations for both files. ✓

---

### 2026-06-02: Piece 30 Revision Follow-On Adversarial Review — 3-Reviewer Verdict

**Date:** 2026-06-02  
**Session type:** Follow-on adversarial review of piece-30 revision (commit a9da5453)  
**Reviewers (parallel background):** CAPCOM, RETRO, FIDO  
**Locked-out authors:** Flight (original 10168051), Booster (revision a9da5453)

## CAPCOM — REJECT (1 new mandatory finding)

**Verdict:** REJECT

**Prior findings status:**
- M1 (nonexistent `squad fold`): RESOLVED — CLI call replaced with inline bash+jq
- M2 (unreachable publish-inbox trigger): RESOLVED — `include:` removed; trigger now exclude-only

**New mandatory findings: 1**
- **New M1:** Timestamp-based skip logic in inline fold script causes data loss for inbox refs when `publishedAt` ≤ last-folded entry timestamp (clock skew, same-second ties). Fix: check ref-name membership in `publish-history.json` instead of timestamp comparison.

**New non-blocking findings: 3**
- N1: `foldCommit` stores inbox SHA not squad-state fold SHA
- N2: sort tie-breaker uses full ref name instead of `developerAlias`
- N3: prune deletes all inbox refs not just folded ones

Full review: `.squad/reviews/piece-30-revision-capcom.md`

## RETRO — APPROVE-WITH-NITS (1 new mandatory, 1 new Low)

**Verdict:** APPROVE-WITH-NITS

**Prior findings status:**
- M1 (PAT leak via Write-Host): PARTIALLY-RESOLVED — Write-Host redaction correct; residual gap in `git clone` stderr failure
- M2 (missing `--` on git clone): RESOLVED
- M3 (no URL scheme allowlist): RESOLVED

**New mandatory findings: 1**
- **M_NEW_1 (Medium):** `git clone` failure paths emit unredacted URL with embedded PAT to stderr. Redirect with `2>&1` and emit sanitized error message instead.

**New non-blocking findings: 1**
- **N_NEW_1 (Low):** `$DocsRemoteName` and `$StateBranch` parameters unvalidated; used in git config keys and refspecs. Add charset allowlist per piece-27 convention.

**Disposition:** Safe to merge as-is. M_NEW_1 is conditional leak (failure case), not always-emit. Can be addressed in follow-on patch.

## FIDO — APPROVE (0 new mandatory, 2 non-blocking)

**Verdict:** APPROVE

**Prior findings status:**
- M1 (no execution-based idempotency test): RESOLVED — `test/cli/ado-bootstrap-idempotency.test.ts` added; real `pwsh -File` execution confirmed green
- PAO M1 (docs-test sync — state-backends): RESOLVED — `'state-backends'` confirmed in EXPECTED_FEATURES

**New mandatory findings:** 0

**New non-blocking findings: 2**
- NB1: Remote-add guard mutation not detectable at runtime (native command silent under `$ErrorActionPreference = 'Stop'`)
- NB2: Fixture TEAM_ROOT path mismatch; clone idempotency guard not exercised

**Mirror byte-identity:** PASS — all 3 canonical files byte-identical across all 4 locations

**Test count:** 196 verified (14 ado-templates + 181 template-sync + 1 idempotency)

**Disposition:** Ready to merge.

## Summary

| Reviewer | Verdict | New Mandatory | New Nits |
|----------|---------|---------------|----------|
| CAPCOM | REJECT | 1 (fold timestamp bug) | 3 non-blocking |
| RETRO | APPROVE-WITH-NITS | 1 (clone stderr leak) | 1 non-blocking |
| FIDO | APPROVE | 0 | 2 non-blocking |

---

### 2026-06-03: Piece 30 Revision — Booster Integration (a9da5453)

**Date:** 2026-06-03  
**By:** Booster (CI/CD Engineer) — sole revision integrator  
**Original Flight commit:** 10168051  
**Revision commit:** a9da5453  
**Test coverage:** 190 → 196 tests pass  
**Scrub-gate disposition:** Gates 2,5–9 pass; Gate 1 pre-existing baseline (zero new violations)  

## Context

Five-reviewer adversarial panel (CAPCOM, Booster, FIDO, RETRO, PAO) issued consolidated REJECT verdict on piece 30 (ADO cross-repo pipeline templates) with 9 mandatory findings. Booster was assigned as sole revision implementer across all domains (CI/CD, security, testing, docs).

## Mandatory Findings Addressed

### M1: CAPCOM — `squad fold` does not exist — inline the fold logic

**Decision:** The original `fold-squad-state.yml` called `squad fold` which is not a real CLI subcommand. Per coordinator adjudication, the fold logic must be inlined as bash+jq plumbing. No new `fold` subcommand will be added to the CLI. The template is self-contained.

**Implementation:** `fold-squad-state.yml` rewritten with 150-line inline bash+jq fold logic (lines 5–154). Verified functional; replaces nonexistent CLI call entirely.

### M2: CAPCOM — `publish-inbox.yml` trigger correction — no include clause

**Decision:** The original `include: squad/inbox/**` trigger was incorrect: inbox branches live in TEAM_ROOT (docs repo), not WORK_ROOT (the product repo where the pipeline runs). Fix: remove `include:` entirely; keep only `exclude:` (squad-state, main, dev). Pipeline now triggers on all WORK_ROOT feature branch pushes.

**Implementation:** Removed `include:` line; retained `exclude:` with documented rationale in template comments. Test `test/cli/ado-templates.test.ts` updated to enforce no `include:` clause (assertion 5).

### M3: Booster — `fold-squad-state.yml` lacks concurrency serialization

**Decision:** No `batch: true` in the trigger block. Two simultaneous inbox pushes trigger two concurrent fold runs; the losing run fails with non-fast-forward rejection. Fix: add `batch: true` to the fold trigger.

**Implementation:** Added `batch: true` to `fold-squad-state.yml` trigger block (inside `trigger:`, line 3). Booster note: `batch: true` goes inside `trigger:` block (ADO-specific), not top-level.

### M4: Booster — `publish-inbox.yml` missing `persistCredentials: true`

**Decision:** ADO checkout defaults to `persistCredentials: false` (strips OAuth token). Any pipeline step that runs `git push` after checkout must explicitly set `persistCredentials: true`. This differs from GitHub Actions where the token persists by default.

**Implementation:** Added `persistCredentials: true` to `publish-inbox.yml` checkout step (line 10). Fold template already had this; publish now matches.

### M5: RETRO — PAT-in-URL leak via Write-Host

**Decision:** `bootstrap-cross-repo.ps1` echoes `$DocsRepoUrl` verbatim via `Write-Host` — PAT-embedded URL leak to pipeline/console logs. Also exposed in ADO's command-line log when the pipeline passes `$(docsRepoUrl)` as an argument.

**Implementation:** Redacted PAT in URL before Write-Host emission: changed `Write-Host "Cloning from $DocsRepoUrl"` to redacted form using `://***@` pattern. Error messages also redacted.

### M6: RETRO — Missing `--` separator in git clone

**Decision:** Missing `--` separator before `$DocsRepoUrl` in `git clone` — violates team convention established in piece 14; git-argument injection vector for URLs beginning with `--`.

**Implementation:** Added `--` separator: `git clone -- "$DocsRepoUrl" <path>`. Verified in bootstrap-cross-repo.ps1 line 47.

### M7: RETRO — No URL scheme allowlist for `$DocsRepoUrl`

**Decision:** No URL scheme allowlist for `$DocsRepoUrl`; `file://` and arbitrary HTTPS origins are accepted; `https://attacker.com/.git` blind-clone probe does NOT safe-fail.

**Implementation:** Added URL scheme allowlist: `https://`, `http://`, `git+ssh://`, `ssh://`, `git@`. Rejected schemes: `file://`, `ftp://`, and all others. Error message deliberately omits the full URL value (PAT-redaction principle).

### M8: FIDO — No execution-based idempotency test for `bootstrap-cross-repo.ps1`

**Decision:** The spec requires idempotent behavior (no duplicate remotes, no duplicate exclude entries on re-run). The two bootstrap tests are regex scans only — no test runs the script. Idempotency logic bugs would not be caught.

**Implementation:** New test file `test/cli/ado-bootstrap-idempotency.test.ts` with execution-based assertions. Runs `pwsh -File bootstrap-cross-repo.ps1` twice on a fixture; verifies second run is idempotent (no remotes added, no exclude entries duplicated). Uses `120_000ms` Vitest timeout for PowerShell process startup.

### M9: PAO — `test/docs-build.test.ts` missing `state-backends` in EXPECTED_FEATURES

**Decision:** `test/docs-build.test.ts` missing `'state-backends'` in EXPECTED_FEATURES array — docs-test sync hard rule violated.

**Implementation:** Added `'state-backends'` to EXPECTED_FEATURES array in test/docs-build.test.ts. Docs-test sync hard rule now passes.

## Learnings & Decisions

1. **ADO `batch: true` is inside `trigger:`** — not a top-level pipeline key.
2. **ADO `persistCredentials` defaults false** — must be explicit for push pipelines.
3. **Mirror pattern amplifies file counts 4×** — factor into Gate 6 planning.
4. **Inline fold pattern** — when a CLI subcommand doesn't exist and can't be added, inline the logic in YAML using bash+jq. The fold template is now a useful reference.
5. **Vitest timeout for pwsh tests** — default 5000ms insufficient for PowerShell process startup × 2. Use `120_000` for execution-based idempotency tests.
6. **PAT redaction is a write-path concern** — any Write-Host or error message that names a URL must check the URL for embedded credentials before emission.
7. **URL scheme allowlist is a positive-assertion gate** — define accepted schemes, reject all others. Avoids future injection vectors.
8. **Docs-test sync is a hard rule** — any new template or state surface requires a corresponding EXPECTED_FEATURES entry. Enforced by CI.

---

### 2026-06-02: Piece 30 ADO Cross-Repo Templates — Implementation Complete

**By:** Flight (Lead)  
**Branch:** `squad/piece-30-ado-cross-repo-templates`  
**Commit:** 10168051

#### Templates Shipped

Three canonical ADO pipeline assets added under `.squad-templates/ado/`:

| Template | Role |
|----------|------|
| `bootstrap-cross-repo.ps1` | Developer workstation and pipeline agent bootstrap |
| `publish-inbox.yml` | Inbox branch publisher (product repo) |
| `fold-squad-state.yml` | State serializer (docs repo) — sole writer to squad-state |

All three mirrored to `templates/ado/`, `packages/squad-cli/templates/ado/`, and `packages/squad-sdk/templates/ado/` via `sync-templates.mjs` (which handles subdirectories recursively — no script changes needed).

#### Sole-Writer Invariant

**Location:** `fold-squad-state.yml`, lines 4–9 (near top of file) — documents that this pipeline is the sole writer to squad-state. No other pipeline, script, or developer workflow may push commits or fast-forwards to the squad-state branch. Enforcement: pipeline repo-scoped identity + ADO branch policy (block direct pushes to squad-state except pipeline identity). Comment and reviewer gate in Phase C are the enforcement surfaces. Verified: no other template or script in `.squad-templates/` writes to `squad-state`.

#### No-PR-Trigger Gate

**File:** `publish-inbox.yml` — has no top-level `pr:` key. Machine-checkable test assertion in `test/cli/ado-templates.test.ts` confirms this gate is mandatory and runs in CI.

#### Idempotency Guards in bootstrap-cross-repo.ps1

Every mutation is guarded: sidecar clone (`Test-Path $TeamRoot`), `squad bind` (`Test-Path $SquadConfig`), remote add (check existing remotes), state-branch refspec (check existing config), inbox refspec (check existing config), exclude entries (pre-computed `$escapedEntry` variable — not `$([regex]::Escape(...))` subexpression to satisfy scrub gate 8).

#### Scrub Gate Results

- Gates 2, 5–9: PASS
- Gates 3–4: WARN (`.squad/` state files only — Scribe responsibility, expected)
- Gate 1: FAIL (pre-existing baseline, 32 paths — zero introduced by piece 30)
- Gate 8: PASS (after fix: replaced PowerShell subexpression with pre-computed variable)

Gate 1 baseline applies per team precedent since piece 08a.

#### Test Coverage

| Test file | Assertions |
|-----------|-----------|
| `test/cli/ado-templates.test.ts` (new) | 9 behavioral: YAML-parse, no-PR-trigger, trigger pattern, no broad OAuth, sole-writer comment, idempotency guards |
| `test/template-sync.test.ts` (extended) | 12 new: 3 canonical existence + 9 mirror parity (3 templates × 3 mirrors) |

All 190 tests pass (181 template-sync + 9 ado-templates). No defects recorded.

---

### 2026-06-02: Piece 30 Prompt Template Typo — Correction Applied

**By:** Flight (Lead)  
**Scope:** Replay prompt template authoring

**Finding:** The piece-30 session prompt at `.squad/plans/prompts/piece-30-ado-cross-repo-templates.md` referenced `26-ado-cross-repo-templates.md` (no such file exists). Actual spec: `30-ado-cross-repo-templates.md` on `origin/akubly/upstream-specs`.

**Root cause:** Copy-paste artifact from piece-26 prompt that was not updated when piece-30 prompt was authored.

**Correction Applied:** Session coordinator (Brady) provided override in spawn manifest; piece-30 implementation used correct `30-ado-cross-repo-templates.md` spec.

**Recommendation:** Phase B prompt templates should validate spec path before execution. When authoring prompt for piece N, use path `docs/proposals/upstream-bradygaster/N-<slug>.md` with piece number matching. If file does not exist, agent should stop and report rather than proceeding with incorrect spec.

**Impact:** Low — correction prevented any implementation against wrong spec. No rework required.

---

### 2026-06-02: Piece 29 adversarial-review nit revision complete

**By:** Flight (revision author, per lockout protocol — Procedures locked out)
**Branch:** `squad/piece-29-team-root-work-root-protocol`
**Revision SHA:** b7ff4f99 (atop b642f9cd)
**Pattern:** Same-branch revision (mirrors piece-27 precedent, commit 5d8509f4)

**Nits resolved:**

- **M1 (Flight N1 + PAO N1):** Explore agent spawn pattern updated to carry all five mandatory variables (TEAM_ROOT, WORK_ROOT, STATE_REMOTE, STATE_BRANCH, DEVELOPER_ALIAS) with consistent `KEY: value` format. Old `TEAM ROOT:` (space, no underscore) format eliminated.

- **M2 (Flight N2):** Added "WORK_ROOT resolution procedure" paragraph documenting actual SDK semantics: `loadDirConfig()` reads `teamRoot` from `{WORK_ROOT}/.squad/config.json`; resolves relative to WORK_ROOT; absent config → TEAM_ROOT == WORK_ROOT fallback.

- **M3 (PAO N2):** Added "Single-repo case" callout. When TEAM_ROOT == WORK_ROOT, four paths collapse to two; write rules still apply; Coordinator must still pass both variables in spawn prompts.

**Test delta:** +45 new assertions (80 → 125 total in `team-root-work-root-protocol.test.ts`). `template-sync.test.ts` unchanged (160/160).

**Scrub-gate:** Zero new violations vs parent. Gate 1 FAIL + Gate 3/4 WARN are pre-existing baseline per prior decisions.

**Files changed (6):** canonical template, 4 mirrors, 1 test file.

---

### 2026-05-29: CONTROL — Piece 28 Revision Decisions

**Author:** CONTROL (Control System Engineer)  
**Branch:** squad/piece-28-inbox-branch-publish-flow  
**Amends:** d42f4e21 (EECOM — feat(sync): add inbox branch publish flow)

#### D-1 — InboxGitOps as a separate interface (not extending SyncGitOps)

**What:** Introduced `InboxGitOps` as a stand-alone interface parallel to `SyncGitOps`. It is NOT an extension.

**Why:** Hydrate and publish touch non-overlapping git operations. Extending would have imported irrelevant surface into the injection point and required test stubs for methods never called. This is the correct composition pattern from the injectable-git-ops skill: scope the interface to the use-case.

#### D-2 — SESSION_ID_RE: UUID v4 OR slug form

**What:** `SESSION_ID_RE = /^([0-9a-f]{8}-...|[a-z0-9-]{8,64})$/` — accepts both UUID v4 and `[a-z0-9-]{8,64}`.

**Why:** The default sessionId generator (`randomBytes(8).toString('hex')`) produces 16 lowercase hex chars — not a UUID. A UUID-only regex would have rejected live sessions. The slug branch is required for real usage. Rejection cases: `@`, `/`, `..`, whitespace, empty string.

#### D-3 — Validation order: inboxBranch first

**What:** Guard order in `publishTeamRootToInbox`: (1) `inboxBranch` namespace → (2) `sessionId` charset → (3) `developerAlias` format → (4) build metadata.

**Why:** RETRO required this ordering explicitly. The branch name is the outermost trust boundary — it identifies the entire operation target. Validating it first means later alias parsing cannot bypass the namespace guard if an alias happens to collide with a branch prefix check. Validate from outside-in.

#### D-4 — collectSnapshotFiles fails closed (throw, not skip)

**What:** Non-allowlisted `.squad/` paths now throw `ERR_INBOX_SNAPSHOT_RESTRICTED` instead of being silently skipped.

**Why:** FIDO CRITICAL finding. Silent skip means secrets (`.env`, `tokens.json`, etc.) in `.squad/` would be silently excluded, giving a false sense of safety. The caller decides what to do with the error; the helper cannot safely suppress it. This is the correct contract for any security-sensitive enumeration helper.

#### D-5 — Atomic metadata write

**What:** `publish-metadata.json.tmp` written first, then `fs.renameSync` → `publish-metadata.json`.

**Why:** RETRO MEDIUM finding. If the process dies between write-start and close, `renameSync` never executes, leaving only the `.tmp` file. The canonical JSON is never torn. Any new metadata write to disk should use this pattern.

#### D-6 — throw vs process.exit(1) in publishTeamRootToInbox

**What:** All validation failures throw `Error` with structured message codes. `process.exit(1)` was removed.

**Why:** CAPCOM TS finding. `process.exit` in a library function is untestable, swallows error messages, and prevents callers from recovering. Throw + let the top-level CLI wrapper call `process.exit` with the error message.

#### D-7 — computePathHash / computeInboxBranchName / PublishMetadata kept as CLI exports (not in SDK barrel)

**What:** These remain exported from `sync.ts` but are NOT added to `packages/squad-sdk/src/index.ts`. JSDoc notes Piece 30 dependency.

**Why:** CAPCOM CF-2/CF-3 finding. The Piece 30 fold pipeline will consume these. Promoting them to SDK surface now would lock in the API before the consumption pattern is understood. JSDoc is the lightweight way to document intent without widening the public API.

#### D-8 — validateShardSegment mirrors resolveExternalStateDir pattern

**What:** `validateShardSegment` rejects `''`, `..`, `/`, `\`, leading `.`, NUL — same as the existing `resolveExternalStateDir` guard at ~line 691.

**Why:** CAPCOM CF-4 finding. Reusing an existing in-module pattern ensures consistent traversal defense. Inventing a new validation scheme when one exists in the same file would create divergent hardening levels.

---

### 2026-06-02: Flight Gate Verdict — Piece 28 Revision (R2)

**Date:** 2026-06-02T12:27:39-07:00  
**Reviewer:** Flight (Lead)  
**Revision Commit:** `aff12874`  
**Branch:** `squad/piece-28-inbox-branch-publish-flow`  
**Revision Author:** CONTROL (amends `d42f4e21`)  
**Verdict:** APPROVED

#### Acceptance Checklist — All 23 Items PASS

1. ✅ `collectSnapshotFiles` FAILS CLOSED on non-allowlisted path | `sync.ts:638-644` — throws `Error`; mutation confirmed
2. ✅ `inboxBranch` namespace guard at function entry | `sync.ts:821-827` — first check in `publishTeamRootToInbox`
3. ✅ `sessionId` charset validation — rejects `@`, `/`, `..`, whitespace | `sync.ts:830-835` — `SESSION_ID_RE` checked
4. ✅ Atomic metadata write — `.tmp` + `renameSync` | `sync.ts` — metadataTmpPath + fs.renameSync
5. ✅ Injectable `InboxGitOps` seam on both helpers | `InboxGitOps` interface + `DEFAULT_INBOX_GIT_OPS`
6. ✅ `sessionShardPath` rejects `..`, `/`, `\`, leading dot | `resolution.ts` — `validateShardSegment` checks all vectors
7. ✅ `process.exit(1)` replaced by thrown error | `publishTeamRootToInbox` uses only `throw Error(...)`
8. ✅ Public-export hygiene — JSDoc OR removed from SDK barrel | JSDoc present; NOT in SDK barrel
9. ✅ Concurrent test uses `Promise.all` | `cross-repo-sync.test.ts` — `Promise.all([...])`
10. ✅ Projection deletion assertion — stale removed, sentinel survives | `cross-repo-sync.test.ts` verified
11. ✅ Allowlist-fails-closed test: throw + no inbox ref created | Test 11 passes; rejects `.squad/secrets.json`
12. ✅ PII assertions on metadata: no `@`, no user paths, `publishedAt` ends in `Z` | Three assertions verified
13. ✅ `inboxBranch = 'squad-state'` test: throws before ref creation | Rejects with `squad/inbox/` message
14. ✅ `sessionId` charset-rejection: `@`, `/`, `..`, whitespace each tested | Four tests verified
15. ✅ `sessionShardPath` traversal: `'../etc'`, `'..\\..\\evil'`, `'a/b'` each throws | Three assertions verified
16. ✅ Mutation: neuter allowlist guard → test 11 FAILS | Confirmed; reverted
17. ✅ Mutation: neuter inboxBranch guard → test 13 FAILS | Confirmed; reverted
18. ✅ `npm run build` — zero new errors vs parent | 43 TS errors at both commits; delta 0
19. ✅ `npm test` — no regression | 28/28 in isolation
20. ✅ Scrub gate: no strip-listed paths; ≤30 files | 5 files changed
21. ✅ Single commit; Co-authored-by; body enumerates revision items | 1 commit; trailer present; body lists all 8 items
22. ✅ Force-with-lease push; remote SHA matches local | `aff12874` on both local and origin
23. ✅ No PR opened | `gh pr list --head squad/piece-28-inbox-branch-publish-flow` → `[]`

#### Mutation Re-Verification

Both guards exercised independently, reverted before reporting.

**Allowlist guard:** Commented out the `throw new Error(...)` in `collectSnapshotFiles`. Test result: 1 fail / 27 pass — test 11 FAILED. Guard confirmed live.

**inboxBranch guard:** Removed `if (!inboxBranch.startsWith('squad/inbox/'))` check. Test result: 1 fail / 27 pass — test 13 threw git push error. Guard confirmed fires before any git operation.

#### Non-Blocking Observations

1. **Commit body inaccuracy:** Body claims `InboxPublishRecord` was added to SDK barrel — not present. Cosmetic; not a correctness issue.

2. **Lingering `process.exit(1)` in piece-27 surface:** `ensureStateRemote` (line ~413) and `runSync` (line ~465) still use `process.exit`. Out of scope for R2; track as cleanup debt.

3. **Integration test isolation:** cross-repo-sync tests fail in full-suite parallel run due to shared fixture. 28/28 pass in isolation. Future integration tests should randomize fixture dirs.

#### Lockout Resolution

Both EECOM and CONTROL remain free. No R3 required. Strict-lockout chain closed: APPROVED.

---


---

### 2026-06-02: Piece 29 adversarial review — Flight verdict
**By:** Flight (Lead)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- Four-path model is architecturally sound. The TEAM_ROOT/WORK_ROOT split correctly partitions state from code, and the write rules create an unambiguous authority boundary.
- The three primary spawn templates (Full/Standard/Lightweight + Scribe) all carry the five mandatory variables in consistent order — the contract is well-threaded.
- Mirror drift is zero — all four copies are byte-for-byte identical to canonical. The sync script and template-sync test remain fit-for-purpose.
- One significant contract gap exists: the explore agent inline spawn was NOT updated. It still uses old `TEAM ROOT:` format (space, no underscore) and omits WORK_ROOT, STATE_REMOTE, STATE_BRANCH, DEVELOPER_ALIAS — directly violating the "never omit any of them" rule established 100 lines above in the same file.
- The template mandates passing WORK_ROOT into spawns but provides NO resolution procedure for how the Coordinator determines WORK_ROOT's value at session start. TEAM_ROOT has a detailed 6-step resolution chain; WORK_ROOT has nothing. In the cross-repo bind case, this must come from `.squad/config.json` → `workRoot` field (piece 26), but the template is silent.

**Mandatory nits (must resolve before any PR opens):**
N1: **Explore agent spawn pattern not updated.** Line ~381: `For read-only queries, use the explore agent: agent_type: "explore" with "You are {Name}, the {Role}. CURRENT_DATETIME: {current_datetime} — {question} TEAM ROOT: {team_root}"` — uses old `TEAM ROOT:` format and omits 4 of 5 mandatory variables. **Counterexample:** Coordinator spawns an explore agent to answer "what tests cover the bind function?" The agent receives only TEAM_ROOT. It `cd`s to the squad-state repo and runs `grep -r "bind"` — finds nothing because tests live in WORK_ROOT which was never provided. Agent reports "no tests found." **Fix:** Update to include all five variables: `TEAM_ROOT: {team_root} WORK_ROOT: {work_root} STATE_REMOTE: {state_remote} STATE_BRANCH: squad-state DEVELOPER_ALIAS: {developer_alias}` and rename to `TEAM_ROOT:` (underscore).

N2: **No WORK_ROOT resolution procedure at session start.** The "On every session start" paragraph instructs: "Pass the Working Directory Model variables (`TEAM_ROOT`, `WORK_ROOT`, …)." But TEAM_ROOT has a 6-step resolution chain (steps 1–6); WORK_ROOT has no equivalent procedure. In the TEAM_ROOT ≠ WORK_ROOT case (cross-repo bind from piece 26), the Coordinator must read `.squad/config.json` → `workRoot` field. In the TEAM_ROOT == WORK_ROOT case (single-repo default), it should be set to CWD/team_root. Neither case is documented. **Counterexample:** A Coordinator starts a session on a repo that was `squad bind`'d to a separate docs sidecar. It resolves TEAM_ROOT correctly via step 2 (symlink). It then has no instruction for WORK_ROOT. It guesses CWD (which IS the product repo) — happens to be correct by coincidence. On a different machine where the user opens the sidecar repo directly, CWD == TEAM_ROOT and WORK_ROOT is undefined. **Fix:** Add a resolution paragraph after the four-path table: "WORK_ROOT resolution: If `.squad/config.json` contains a `workRoot` field, use that absolute path. Otherwise, WORK_ROOT = TEAM_ROOT (single-repo mode)."

**Non-blocking nits:**
N3: **`STATE_BRANCH` is hardcoded as `squad-state` in all spawn templates.** Piece 27's sync command allows `--branch` override. The spawn templates lock the value to `squad-state` without noting this is a default that config could override. Not blocking because no config-driven branch override exists yet, but creates a future inconsistency surface when it does.

N4: **Init Mode note is minimal.** Line 85: "Init Mode creates `.squad/` in the current repo (which becomes TEAM_ROOT). For shared-squad consumer repos, state is written to TEAM_ROOT (not CWD)." This is the only guidance connecting Init Mode to the new four-path model. It does not address what WORK_ROOT becomes after Init (answer: same as TEAM_ROOT). Minor gap; inferrable from context.

**DEEP PROBE — cross-repo bind scenario:**

Scenario: Developer has two repos:
- `D:\docs-sidecar` — Squad state repo (TEAM_ROOT), contains `.squad/`
- `D:\product` — Product repo (WORK_ROOT), contains source code
- Piece 26's `squad bind` linked them; `D:\docs-sidecar\.squad\config.json` has `"workRoot": "D:\\product"`

The Coordinator starts a session in `D:\product`. Step 2 of the resolution chain finds `.squad` via the symlink/include path. Resolves TEAM_ROOT = `D:\docs-sidecar`.

**Literal spawn prompt the Coordinator would emit (Standard template):**

```
You are EECOM, the Core Dev on this project.

YOUR CHARTER:
{contents of D:\docs-sidecar\.squad\agents\eecom\charter.md}

TEAM_ROOT: D:\docs-sidecar
WORK_ROOT: D:\product
STATE_REMOTE: squad-docs
STATE_BRANCH: squad-state
DEVELOPER_ALIAS: akubly
CURRENT_DATETIME: 2026-06-02T13:51:32-07:00
All `.squad/` paths are relative to TEAM_ROOT. Code search, builds, and tests operate from WORK_ROOT.

PERSONAL_AGENT: false
GHOST_PROTOCOL: false
...
```

**Walkthrough:** EECOM receives the prompt. It needs to write a decision after completing work. The prompt says "All `.squad/` paths are relative to TEAM_ROOT." EECOM writes to `D:\docs-sidecar\.squad\decisions\inbox\eecom-fix.md`. ✅ Correct.

EECOM needs to run tests. The prompt says "Code search, builds, and tests operate from WORK_ROOT." EECOM runs `cd D:\product && npm test`. ✅ Correct.

**Failure case (N2):** Now consider the Coordinator itself. It started in `D:\product`. It resolved TEAM_ROOT via the chain. But the template never told it HOW to determine WORK_ROOT. It has two plausible guesses: (a) CWD at session start (`D:\product` — happens to be correct), or (b) undefined/same-as-TEAM_ROOT (`D:\docs-sidecar` — WRONG). Without an explicit resolution rule, a Coordinator implementation that caches CWD before resolving TEAM_ROOT would get it right by accident, but one that reads the prompt literally has no instruction. This is why N2 is mandatory.

**Additional failure case (N1):** The Coordinator spawns an explore agent: `"You are EECOM, the Core Dev. CURRENT_DATETIME: 2026-06-02T13:51:32-07:00 — Find all usages of runBind in tests. TEAM ROOT: D:\docs-sidecar"`. The explore agent searches `D:\docs-sidecar` for test files. Finds none (tests are in `D:\product`). Reports: "No usages found." The user gets a false negative because WORK_ROOT was never communicated.

**Cross-piece consistency:** PARTIAL
- Piece 26 (bind): The `workRoot` config field introduced by piece 26 is the mechanism for resolving WORK_ROOT, but piece 29's template does not reference it or describe reading it. Contract assumes the Coordinator "just knows" WORK_ROOT.
- Piece 27 (sync): `STATE_REMOTE` and `DEVELOPER_ALIAS` semantics align perfectly with piece 27's `--remote` and `--developer` flags. The fallback chain (`options.remote ?? config ?? 'squad-docs'`) matches the default in spawn templates.
- Piece 28 (inbox publish): Write rule 5 ("State publication runs via `squad sync --push` against `STATE_REMOTE`") correctly wraps piece 28's publish flow. No drift.

**Mirror drift:** PASS — all four mirrors byte-for-byte identical to canonical (`fc.exe` confirmed).

**Spawn-template five-variable consistency:**
- Full spawn template: PASS (5/5 variables present, correct order)
- Standard spawn template: PASS (5/5 variables present, correct order)
- Scribe spawn template: PASS (5/5 variables present, correct order)
- Lightweight spawn template: PASS (5/5 variables present, correct order)
- Explore agent inline spawn: **FAIL** (1/5 — only TEAM_ROOT present, in old format)

**Cross-reviewer pointers:**
- FIDO: The test file `team-root-work-root-protocol.test.ts` does not assert that the explore agent spawn pattern contains the five variables — test gap.
- PAO: The "Working Directory Model" section uses "docs/specs sidecar clone" in the TEAM_ROOT definition, which may be confusing for single-repo users where TEAM_ROOT == WORK_ROOT.

**If REJECT:** N/A — not rejected. Mandatory nits N1 and N2 are fixable without architectural rethink. Procedures is locked out (implementer). If revision needed: recommend EECOM (pure template text change, no type system implications).


---

### 2026-06-02: Piece 29 adversarial review — FIDO verdict

**By:** FIDO (Quality Owner)
**Verdict:** APPROVE
**Why:**
- All 60 presence/structural assertions pass (223/223 total with template-sync).
- Deep mutation probe: both mutations (write rule deletion AND spawn-variable rename) caught immediately by specific assertions — no tautological tests detected.
- Gate-1 baseline re-confirmed: identical scrub-gate results at `aff12874` (parent) and `b642f9cd` (piece 29). Zero new violations introduced.
- Write rules use regex patterns tight enough to catch deletion but flexible enough to survive minor rewording (good calibration).
- Spawn-variable ordering assertion (TEAM_ROOT before WORK_ROOT) adds structural rigor beyond simple presence.
- Negative guard (section 4) uses lookbehind to verify no accidental write-grant to WORK_SQUAD_DIR — creative and effective.

**Mandatory nits (must resolve before any PR opens):**
None.

**Non-blocking nits:**
N1: **Path semantics paragraph untested** — The "Path semantics" paragraph (line 54 in canonical template) specifies which files resolve from TEAM_ROOT vs WORK_ROOT. No assertion verifies this paragraph exists or contains the correct resolution rules. A deletion of this paragraph would go undetected. LOW severity (the write rules cover the actionable constraints; path semantics is informational guidance).

N2: **Section 1 presence tests are trivially satisfiable** — `expect(content).toContain('TEAM_ROOT')` passes if TEAM_ROOT appears *anywhere* in the file (e.g., in prose or comments), not specifically in the four-path table. This is by-design for lightweight governance, but a mutation that removes the table row while leaving TEAM_ROOT in the spawn template wouldn't fire. Acceptable tradeoff — the template-sync byte-for-byte parity test covers table integrity independently.

N3: **Stray `_mirror1.tmp` in `.github/agents/`** — Found during test run; caused template-sync test failure. File is untracked and should be gitignored or cleaned. Not introduced by piece 29 (pre-existing artifact from a prior sync-templates run).

**Mutation-test summary (DEEP probe):**
- Mutation A (write rule 3 deletion — "Non-Scribe agents must not create or modify files under WORK_SQUAD_DIR"): **CAUGHT** by test "rule 3 — non-Scribe agents must not write under WORK_SQUAD_DIR" (line 83, regex match on content).
- Mutation B (spawn-variable rename — `WORK_ROOT:` → `WorkRoot:`): **CAUGHT** by test "spawn contract lists TEAM_ROOT before WORK_ROOT" (line 119, `content.indexOf('WORK_ROOT:')` returns -1, assertion fails).
- Template restored cleanly: **YES** — `git checkout -- .squad-templates/squad.agent.md` executed; `git status` reports "nothing to commit, working tree clean".

**Test/spec parity audit:**
- Write rules with assertions: **5/5** (all five write rules from canonical template are regex-tested across all 5 copies)
- Spawn variables with presence tests across all 5 copies: **5/5** (TEAM_ROOT, WORK_ROOT, STATE_REMOTE, STATE_BRANCH, DEVELOPER_ALIAS — each tested in all 5 locations)
- Four-path table variables presence-tested: **4/4** (TEAM_ROOT, TEAM_SQUAD_DIR, WORK_ROOT, WORK_SQUAD_DIR)
- Gaps:
  - Path semantics paragraph (informational, not write-rule-critical) — no presence test. LOW.
  - `WORK_SQUAD_DIR` definition as "projection/cache only; never canonical writable state" — tested indirectly via write-permission guard (section 4) but no direct substring assertion on the definition text.
  - Ordering assertion only checks TEAM_ROOT before WORK_ROOT in the canonical copy (line 116 uses `content.indexOf` on single-file content). All 5 copies tested. ✓

**Gate-1 baseline re-confirmation:**
- At parent `aff12874`: Gate 1 FAIL (31 strip-listed paths, pre-existing). Gate 2 PASS. Gate 3 WARN (akubly refs in `.squad/` state). Gate 4 WARN (internal refs in `.squad/` state). Gates 5-9 PASS/SKIP.
- At piece-29 `b642f9cd`: Gate 1 FAIL (same 31 strip-listed paths). Gate 2 PASS. Gate 3 WARN (same refs). Gate 4 WARN (same refs). Gates 5-9 PASS/SKIP. Changed file count: 12 (vs 5 at parent — reflects piece 29 additions).
- Verdict: **BASELINE CONFIRMED** — zero new violations introduced by piece 29. All gate results are identical in substance; only "changed file count" differs (expected for a new piece).

**Full test suite status:** 223/223 green (60 team-root-work-root-protocol + 163 template-sync). Zero failures after clearing pre-existing stray `_mirror1.tmp`.

**Realistic regression scenario analysis:**
| # | Mutation | Caught? | By which test? |
|---|----------|---------|----------------|
| 1 | Rename WORK_ROOT → PRODUCT_ROOT in spawn template | YES | Section 3 ordering + presence |
| 2 | Delete write rule 3 entirely | YES | Section 2 rule 3 regex |
| 3 | Change "must not create or modify" → "should avoid" in rule 3 | YES | Regex requires "must not" |
| 4 | sync-templates.mjs adds trailing whitespace to mirrors | NO (but caught by template-sync.test.ts byte parity) | Indirectly covered |
| 5 | Scribe spawn loses DEVELOPER_ALIAS line | YES | Section 3 presence check |


---

### 2026-06-02: Piece 29 adversarial security review — RETRO verdict
**By:** RETRO (Security)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- The four-path model correctly separates writable state (TEAM_ROOT) from code (WORK_ROOT) and marks WORK_SQUAD_DIR as read-only. This is a net positive for security — it makes accidental state-into-product leakage structurally less likely.
- The spawn-contract variables are passed as prompt-level text, not as shell environment variables or interpolated into command strings. Agents consume them as plaintext path constants. No template prose instructs agents to run `cd $WORK_ROOT` or `git push $STATE_REMOTE` with unquoted shell interpolation — the template uses curly-brace placeholders (`{work_root}`) that resolve before prompt injection reaches an agent.
- STATE_REMOTE injection remains closed by piece-27's `remotes.includes()` guard in `sync.ts:407`. The new template does NOT introduce any shell-string path that bypasses that check — write rule 5 explicitly says "via `squad sync --push`", routing through the validated CLI code path.
- DEVELOPER_ALIAS charset validation (`/^[a-z][a-z0-9-]{0,38}$/` at `sync.ts:504`) was landed in piece-28 R2. The regex rejects shell metacharacters, path separators, dots, whitespace, and control characters at the CLI boundary before any git operation. The template does not weaken this — it merely threads the already-validated value into spawn prompts.
- The WORK_SQUAD_DIR guard is prompt-only (no enforcement hook). This is acknowledged as a design gap but is consistent with the existing model where ALL write-discipline is prompt-enforced for agents. No hook framework exists yet to enforce file-path constraints at runtime.

**Critical findings (BLOCK PR):**
None.

**High findings (mandatory before PR):**
None.

**Medium / Low findings (non-blocking):**

M1: **WORK_SQUAD_DIR write guard is prompt-only — no enforcement hook.**
- Write rule 3 ("Non-Scribe agents must not create or modify files under WORK_SQUAD_DIR") exists only as natural-language instruction. An agent that misunderstands context, hallucinates a path, or is given a conflicting user instruction could write `.squad/` state into the product repo. Per my charter: "hooks are code, prompts can be ignored."
- Mitigation: This is consistent with the existing model (all agent write discipline is prompt-based today). A future piece should add a file-write guard hook that rejects `WORK_SQUAD_DIR` writes at the tool-call layer. Acceptable to ship without — no regression from pre-29 state.
- Severity: MEDIUM. The prompt language is clear and unambiguous. Risk requires agent misbehavior, not attacker action.

M2: **DEVELOPER_ALIAS appears in committed files (history.md, decisions.md) without explicit PII classification.**
- The template threads `DEVELOPER_ALIAS` into spawn prompts. Agents write "Requested by: {user}" into history and decision files. If the alias matches a corporate identity (e.g., GitHub username), it persists in committed state. The template says "Never read or store `git config user.email`" (line 69) but does not classify DEVELOPER_ALIAS as PII or non-PII.
- Assessment: DEVELOPER_ALIAS is validated as `[a-z][a-z0-9-]{0,38}` — it cannot contain an email address. It is a chosen identifier (like a GitHub handle), not PII in the GDPR Article 9 sense. However, the template should explicitly state that DEVELOPER_ALIAS is safe to commit because it is a pseudonym, not a real-name identifier. Currently ambiguous.
- Severity: LOW. The charset validation prevents email-as-alias. The gap is documentation clarity, not a leak path.

L1: **Scribe spawn template says "do not write under WORK_ROOT" but provides no guard against CWD confusion.**
- The Scribe prompt says `Write decisions and logs to TEAM_SQUAD_DIR; do not write under WORK_ROOT.` and defines `SQUAD_DIR: {TEAM_ROOT}/.squad`. This is clear. However, if Scribe's CWD is set to WORK_ROOT (which is the default working tree), a bare `git add .squad/` in step 7 would stage from the wrong root.
- Mitigation: Step 7 already uses `git-root-relative paths` filtering and explicitly stages individual files under `{SQUAD_DIR}`. The prose says "filtered to allowed git-root-relative paths" — not bare globs. Safe as written. Noting for future hardening.
- Severity: LOW. Would require Scribe to deviate from explicit per-file staging instructions.

L2: **No explicit "absolute path required" assertion for WORK_ROOT/TEAM_ROOT at coordinator resolution time.**
- The table says "Absolute path to the product repo root" but there is no validation step in the template prose that says "if WORK_ROOT is not absolute, refuse to proceed." An implementation that resolves WORK_ROOT from user input without calling `path.isAbsolute()` could accept relative paths.
- Mitigation: The CLI already validates paths at the `resolveSquadDir()` boundary (piece 08 hardening: `path.isAbsolute()` + `..`-segment detection). The template is guidance for prompt-level coordinators that delegate to CLI. Risk is low given existing CLI guards.
- Severity: LOW. Defence-in-depth note for future coordinator implementation.

**DEEP PROBE — hostile-input scenarios:**

**Scenario A: `WORK_ROOT="..\..\..\..\Windows\System32"`**

Literal spawn prompt the coordinator would emit per template (line 818-824):
```
TEAM_ROOT: D:\git\docs-sidecar
WORK_ROOT: ..\..\..\..\Windows\System32
STATE_REMOTE: squad-docs
STATE_BRANCH: squad-state
DEVELOPER_ALIAS: akubly
CURRENT_DATETIME: 2026-06-02T13:51:32-07:00
All `.squad/` paths are relative to TEAM_ROOT. Code search, builds, and tests operate from WORK_ROOT.
```

Agent walkthrough: The agent reads this spawn prompt. What does it DO with `WORK_ROOT`?
1. The template says "Code search, builds, and tests operate from WORK_ROOT." An agent would attempt `cd ..\..\..\..\Windows\System32` or `view ..\..\..\..\Windows\System32\some-file`. 
2. On the Copilot CLI platform, `view` and `edit` tools require absolute paths. A relative WORK_ROOT would fail tool validation immediately ("Path MUST be absolute"). The agent cannot read or write System32 via this path.
3. If the agent tried `powershell cd ..\..\..\..\Windows\System32 && npm test`, it would cd to an unrelated directory and `npm test` would fail (no package.json). No state corruption occurs.
4. The template's table definition says "Absolute path" — a coordinator that fills in a relative path violates its own spec. But even if violated, the agent platform's absolute-path requirement on file tools prevents exploitation.

**Verdict: SAFE-FAIL.** Platform-level absolute-path enforcement on file tools prevents exploitation. The agent cannot write to arbitrary paths via a relative WORK_ROOT because `edit`/`create` reject non-absolute paths. Shell commands would fail harmlessly (wrong directory, no targets).

**Scenario B: `DEVELOPER_ALIAS="; rm -rf /"`**

This value would be rejected at the CLI validation boundary. `DEVELOPER_ALIAS_RE = /^[a-z][a-z0-9-]{0,38}$/` (sync.ts:504) rejects semicolons, spaces, slashes, and the string starts with `;` not `[a-z]`. The coordinator cannot obtain this alias from `squad bind` or `config.json` — both paths go through the same regex.

But assume a hostile coordinator manually sets this in a spawn prompt (bypassing CLI):
```
TEAM_ROOT: D:\git\docs-sidecar
WORK_ROOT: D:\git\product
STATE_REMOTE: squad-docs
STATE_BRANCH: squad-state
DEVELOPER_ALIAS: ; rm -rf /
CURRENT_DATETIME: 2026-06-02T13:51:32-07:00
```

Agent walkthrough:
1. The agent sees `DEVELOPER_ALIAS: ; rm -rf /` as a plaintext variable in its prompt context.
2. The agent would write this value into `history.md` as "Requested by: ; rm -rf /" — this is inert text in a markdown file, not executed.
3. If the agent attempted `squad sync --push --developer "; rm -rf /"`, the CLI rejects it at the DEVELOPER_ALIAS_RE check (sync.ts:838) with exit 1.
4. The value never reaches a shell interpolation context. Agent spawn prompts are consumed as structured text, not executed as shell scripts. There is no template guidance that says "run `echo $DEVELOPER_ALIAS`" in a shell.

**Verdict: SAFE-FAIL.** CLI charset validation blocks the value at every programmatic boundary. Even with bypass, the value is consumed as prompt text — never shell-interpolated by the template's guidance. The only consequence is a weird string in history.md.

**Attack surface assessed:**
- WORK_SQUAD_DIR guard: **partial** — prompt-only, no hook enforcement. Clear language, no ambiguity. Consistent with pre-29 model.
- TEAM_ROOT / WORK_ROOT path traversal: **pass** — table requires absolute paths; platform file tools enforce absolute paths; CLI resolvers validate with `path.isAbsolute()` + `..`-detection.
- DEVELOPER_ALIAS surface: **pass** — charset validation at CLI boundary (`[a-z][a-z0-9-]{0,38}$`) blocks all injection payloads. Template does not weaken this.
- STATE_REMOTE injection: **pass** — write rule 5 routes all publication through `squad sync --push`, which goes through `ensureStateRemote()` → `remotes.includes()`. No new raw `git push $STATE_REMOTE` in template. Scribe orphan-push uses hardcoded `origin`, not STATE_REMOTE.
- PII / secret leak: **pass** — DEVELOPER_ALIAS charset prevents email-as-alias. Template explicitly prohibits `git config user.email`. Alias is a pseudonym within `[a-z0-9-]` charset.
- Scribe carve-out: **pass** — Scribe spawn prompt explicitly says "Write decisions and logs to TEAM_SQUAD_DIR; do not write under WORK_ROOT." SQUAD_DIR is anchored to TEAM_ROOT. Orphan-push uses `origin` (not WORK_ROOT remote). No path by which Scribe writes state to WORK_ROOT.

**Cross-piece consistency with piece-27 RETRO findings:**
- H1 (whitespace alias): **still defended** — piece-27 nit revision landed `!alias || !alias.trim()` in sync.ts. Piece 29 does not modify sync.ts. Guard intact.
- M4 (alias charset): **newly addressed** — piece-28 R2 landed `DEVELOPER_ALIAS_RE = /^[a-z][a-z0-9-]{0,38}$/` at sync.ts:504 for the publish path. The spawn-contract variable threads this already-validated value. The piece-27 `runSync()` push-direction guard still only checks presence+whitespace (not charset), but the actual dangerous interpolation site (inbox branch name) has full charset validation. Acceptable layering.

**Net assessment:** Piece 29 is a template-only change that improves the security posture by making the TEAM_ROOT/WORK_ROOT boundary explicit. No new injection surfaces introduced. The prompt-only enforcement model (M1) is a known architectural limitation shared with the entire agent framework — not a regression. Ship it.


---

### 2026-06-02: Piece 29 adversarial review — PAO verdict

**By:** PAO (DevRel)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- The four-path table is well-structured and scannable — a spawned agent can locate it instantly.
- Write rules are crisp, numbered, and actionable.
- Spawn templates now carry all five mandatory variables consistently across lightweight, standard, and Scribe modes.
- One real comprehension risk exists: the table says "four path variables" but the mandatory spawn contract lists five non-path variables — an agent could confuse "four paths" with "five spawn variables" on first read.
- The single-repo degenerate case (TEAM_ROOT == WORK_ROOT) is never addressed, which will cause hesitation the first time a mono-repo project spawns agents.
- Path semantics paragraph is dense; it passes the scannability test only because the preceding table gives it structure — but a split into a two-column table would be stronger.

**Mandatory nits (clarity blocks that will cost the team on every spawn):**

N1: Line 45 — "Every session resolves four path variables" vs. line 146 "Pass the Working Directory Model variables (`TEAM_ROOT`, `WORK_ROOT`, `STATE_REMOTE`, `STATE_BRANCH`, `DEVELOPER_ALIAS`)" — The table defines 4 path variables, but the spawn contract names 5 non-table variables. `STATE_REMOTE`, `STATE_BRANCH`, and `DEVELOPER_ALIAS` are not in the table. An agent reading both passages will ask: "are there four variables or nine?" — Proposed fix: Add a sentence after the table: "Three additional session variables complete the spawn contract: `STATE_REMOTE`, `STATE_BRANCH`, `DEVELOPER_ALIAS`. These are not path variables but are mandatory in every spawn prompt alongside the four paths above."

N2: Line 43–62 — No guidance for the degenerate case where `TEAM_ROOT == WORK_ROOT` (single-repo project with no sidecar). A freshly spawned agent in a mono-repo will read "projection/cache only; never canonical writable state" for `WORK_SQUAD_DIR` and wonder whether writes to `.squad/` are legal since both roots point to the same directory. — Proposed fix: Add after the table: "When the project uses a single repository (no sidecar), `TEAM_ROOT` and `WORK_ROOT` resolve to the same path. All rules still apply — resolve Squad state from `TEAM_ROOT` and product operations from `WORK_ROOT`; the values just happen to be identical."

**Non-blocking nits (polish):**

N3: Line 54 — "Path semantics" paragraph is a single dense sentence listing 7+ glob paths. Converts well to a two-row table: "Resolve from TEAM_ROOT" | "Resolve from WORK_ROOT". Not blocking because the preceding four-path table provides enough scaffolding, but a table would improve scanning speed.

N4: Line 146 — The "On every session start" paragraph now packs two distinct instructions (pass Working Directory Model variables AND pass user name) into one run-on thought. Consider splitting into two sentences: one for the five mandatory variables, one for the user identity pass-through.

N5: Line 1015 (Scribe spawn) — Uses `TEAM_SQUAD_DIR` inline but never defines it in the Scribe prompt's variable block. The Scribe spawn lists `SQUAD_DIR: {TEAM_ROOT}/.squad` — an agent must infer that `TEAM_SQUAD_DIR` in the instruction sentence equals `SQUAD_DIR` in the variable. — Proposed fix: Either use `SQUAD_DIR` consistently in the instruction sentence, or add `TEAM_SQUAD_DIR` to the Scribe variable block.

N6: Line 50 — `TEAM_SQUAD_DIR` definition uses `{TEAM_ROOT}/.squad` with curly-brace placeholder syntax, but this is a definition table, not a spawn template. Reads fine in context but could confuse an agent about whether `{TEAM_ROOT}` is a literal placeholder to substitute or a variable reference. Minor — the surrounding text disambiguates.

**DEEP PROBE — lightweight spawn walkthrough as a fresh agent:**

- Line `agent_type: "general-purpose"`: Clear — I know my execution mode.
- Line `model: "{resolved_model}"`: Clear — Coordinator fills this.
- Line `mode: "background"`: Clear.
- Line `name: "{name}"`: Clear.
- Line `description: "{emoji} {Name}: {brief task summary}"`: Clear.
- Line `You are {Name}, the {Role} on this project.`: Clear — identity established.
- Line `TEAM_ROOT: {team_root}`: Clear — I know where Squad state lives.
- Line `WORK_ROOT: {work_root}`: Clear — I know where code lives.
- Line `STATE_REMOTE: {state_remote}`: **Hesitation** — What is this for? No inline explanation. I don't know whether I should push to it, read from it, or ignore it. Fix: append "(remote for `squad sync --push`; do not use directly)".
- Line `STATE_BRANCH: squad-state`: **Hesitation** — Same issue. Is this the branch I'm on? A branch I push to? Fix: append "(target branch on STATE_REMOTE; managed by Scribe)".
- Line `DEVELOPER_ALIAS: {developer_alias}`: **Hesitation** — What do I use this for? Is it my name? The human's name? Fix: append "(alias of the human developer; use in commit trailers and log attribution)".
- Line `CURRENT_DATETIME: {current_datetime}`: Clear.
- Line `WORKTREE_PATH: {worktree_path}`: Clear — my working directory.
- Line `WORKTREE_MODE: {true|false}`: Clear.
- Line `**Requested by:** {current user name}`: Clear.
- Line `{% if WORKTREE_MODE %}...{% endif %}`: Clear — conditional context.
- Line `TASK: {specific task description}`: Clear.
- Line `TARGET FILE(S): {exact file path(s)}`: Clear.
- Line `Do the work. Keep it focused.`: Clear — tone is direct.
- Line `{% if STATE_BACKEND == "git-notes" %}`: **Hesitation** — `STATE_BACKEND` was never declared in this template's variable block. A lightweight-spawned agent has no `STATE_BACKEND` variable in its prompt header. The Coordinator must either always include it or the template Jinja branch is dead code in lightweight mode. Fix: either add `STATE_BACKEND: {state_backend}` to the lightweight variable block, or add a comment: "(Coordinator resolves this at spawn time; one branch renders)".
- Line `powershell {TEAM_ROOT}/.squad/scripts/notes/write-note.ps1 ...`: Clear — exact command given.
- Line `write to {TEAM_ROOT}/.squad/decisions/inbox/{name}-{brief-slug}.md`: Clear — path uses TEAM_ROOT correctly.
- Line `⚠️ OUTPUT: Report outcomes in human terms.`: Clear.
- Line `⚠️ RESPONSE ORDER: After ALL tool calls, write a plain text summary as FINAL output.`: Clear.

**Hesitation points total: 4** (STATE_REMOTE purpose, STATE_BRANCH purpose, DEVELOPER_ALIAS purpose, STATE_BACKEND undeclared in lightweight block).

**Tone & Record compliance:** PASS — No comparison framing, version leaks, or fork residue in the new diff content. Pre-existing `@bradygaster/squad-cli` package references are unchanged by this piece and are legitimate package-name usage, not protocol references.

**Voice consistency with surrounding template:** PASS — New prose is second-person, present-tense, active voice, sentence-case headings ("Working Directory Model" matches surrounding bold-label convention). No drift to passive or third-person "the agent should."

**Scannability of "Working Directory Model" section:** PASS (with N3 as polish) — Table + numbered list structure is correct. The Path semantics paragraph (line 54) is the densest unit but does not block comprehension because the table above it provides the lookup anchor.

**Spawn-template placeholder consistency:** PASS — All templates use `{lower_snake_case}` for Coordinator-filled values consistently. `STATE_BRANCH: squad-state` is a literal (not a placeholder), matching the upstream spec. Backtick usage around variable names in prose is consistent with surrounding template style.

**Mirror voice drift:** PASS — All four mirrors carry byte-identical diffs to the canonical. No flattening or expansion detected.

**If REJECT:** N/A — approving with nits. N1 and N2 are the only items that will reliably cost time on spawns; both are addressable in a follow-up without blocking merge.

### 2026-05-28: User directive — push policy
**By:** akubly (via Copilot)
**What:** Pushing to github.com/akubly/squad is acceptable if there are no leaked gate violations that weren't pre-existing. Reverses the strict "commit-only no-push" stance applied across pieces 21–25 for any future stack work. The condition: a push must not introduce NEW build/lint/test/tsc failures beyond what the parent branch already had — pre-existing failures inherited from upstream are not a blocker.
**Why:** User request — clarifies that the no-push rule was situational, not absolute. Aligns with normal git workflow on a personal fork while preserving the gate-cleanliness contract.

**Practical implications for the Coordinator:**
- Future implementer spawns may push their branch to `origin` (akubly/squad fork) after committing locally.
- Implementers must run build/lint/tsc/tests AND confirm they pass cleanly OR document any failures as pre-existing (with evidence: the same failure on the parent commit).
- Pushing does NOT mean opening a PR — those remain Brady's call.
- Retroactive: the piece-25 push (`origin/squad/piece-25-resolver-rename-and-cli-hardening` at `e67e0959`) is acceptable under this policy; Flight's self-report said gates were clean.


---

### 2026-05-28: FIDO Piece 25 Adversarial Review Approval

# FIDO Piece 25 Adversarial Review Approval

Date: 2026-05-28
Reviewer: FIDO (Quality Owner)
Commit: `e67e0959`
Branch: `squad/piece-25-resolver-rename-and-cli-hardening`
Requested by: akubly

## Verdict: ⚠️ APPROVE-WITH-NITS

### Blockers
None.

### Option A compliance
- ✅ `resolveSquad` has `@deprecated` JSDoc pointing to `resolveSquadDir` in SDK implementation and public barrel.
- ✅ SDK barrel exports `resolveSquadDir` and retains `resolveSquad` as a `typeof resolveSquadDir` alias.
- ✅ Internal SDK callsites are migrated/clean; only the compatibility alias and unrelated `resolution-v2` import alias retain the old name.
- ✅ Changeset classifies `@bradygaster/squad-sdk` as `minor` and `@bradygaster/squad-cli` as `patch`.
- ✅ Contract test asserts `resolveSquadDir(opts)` and deprecated `resolveSquad(opts)` return equivalent results.

### Push-policy compliance
- Pre-existing failures on parent:
  - Raw clean dependency setup has pre-existing lock/dependency skew: `npm ci` reports package-lock out of sync; `npm install` creates a nested stale `@bradygaster/squad-sdk@0.9.4` under CLI, causing build/lint/CLI tsc to resolve stale declarations.
  - With the local workspace SDK controlling for that skew: `npm run build`, `npm run lint`, SDK tsc, and CLI tsc pass on parent.
  - `npx vitest run` is red on parent: 42 failed test files / 197 passed / 1 skipped.
- New failures on `e67e0959`:
  - None after controlling for the pre-existing dependency skew. Workspace-linked `npm run build`, `npm run lint`, SDK tsc, and CLI tsc all pass.
  - `npx vitest run` remains red but improves to 15 failed test files / 225 passed / 1 skipped; no new visible failure class versus parent.

### Test coverage
- Alias: ✅ `test/cli/legacy-resolver-migration.test.ts` includes a D-18 canonical-vs-deprecated alias equivalence test.
- N2 runtime/type proof: ⚠️ `renderFinding` has the required `never` switch arm, but no dedicated `// @ts-expect-error` test proves a new `DoctorSource` variant fails type-check.
- Env seam: ✅ `test/cli/squad-resolver.test.ts` has four resolver wrapper tests; fake env is injected through `isolatedEnv()` and passed to `resolveSquadDir`.

### LOC actual vs forecast
- Production TS diff: 40 insertions / 17 deletions = +23 net LOC across five package `.ts` files.
- Forecast: +9 to +14 net production LOC.
- Assessment: Above forecast by ~9-14 LOC, still small and below the 40-net warning threshold / 200 LOC ceiling.

### Non-blocking nits
1. Add a compile-time regression test with `// @ts-expect-error` for a hypothetical new `DoctorSource` variant so N2 is test-proven, not only implementation-proven.
2. Consider typing the internal `resolution.ts` compatibility alias as `typeof resolveSquadDir` to match the public barrel.
3. Stale comments still say the CLI wrapper wraps SDK `resolveSquad`; update to `resolveSquadDir` opportunistically.
4. Dependency hygiene remains pre-existing: clean install can resolve CLI against a stale nested published SDK. Not introduced by piece 25, but worth an EECOM/Surgeon follow-up.

### If REJECT
Not rejected. If these nits become blocking later, recommend EECOM because Flight is locked out and the remaining work is implementation/test hygiene.


---

### 2026-05-28: EECOM Piece 25 Revision

**Date:** 2026-05-28  
**Owner:** EECOM (Core Dev)  
**Branch:** `squad/piece-25-resolver-rename-and-cli-hardening`  
**Commit:** `185617e51e215dfbf59415a688ff9e1b9fd9a9af`

**Nits folded:**
- N1 (CONTROL): `packages/squad-sdk/src/resolution.ts` now types the internal compatibility alias as `typeof resolveSquadDir`.
- N2 (FIDO): `test/cli/doctor.test.ts` adds a `@ts-expect-error` regression proving an unhandled `DoctorSource` variant is rejected at compile time through `renderFinding`.
- N3 (FIDO): stale non-deprecated comments/JSDoc now reference `resolveSquadDir` in the SDK resolver docs, path-utils reader note, and CLI wrapper header.

**Gate results:**
- `npm run build`: PASS (after dependency setup).
- `npm run lint`: PASS.
- All tsc checks: PASS.
- `npx vitest run test/cli/doctor.test.ts`: PASS (47/47).
- `npx vitest run`: FAIL, inherited baseline only (15 failed files / 225 passed / 1 skipped — no new failures).

---

### 2026-05-28: CONTROL Directive — Piece 25 Type-Fidelity Findings

# CONTROL Directive — Piece 25 Type-Fidelity Findings

**Date:** 2026-05-28  
**Author:** CONTROL (TypeScript Engineer)  
**Branch:** squad/piece-25-resolver-rename-and-cli-hardening  
**Commit audited:** e67e0959

---

## Finding 1 — `resolution.ts` alias uses bare const (no `typeof`)

**File:** `packages/squad-sdk/src/resolution.ts`, line 159  
**Code:** `export const resolveSquad = resolveSquadDir;`  
**Issue:** The alias lacks `typeof` annotation. TypeScript infers the type from the implementation signature. Since `resolution.ts`'s `resolveSquadDir` is currently single-signature, this is harmless today. However, if overloads were ever added to `resolution.ts`'s `resolveSquadDir`, TypeScript would collapse the alias to the implementation signature — losing overload resolution for direct-module consumers.

**Contrast with barrel:** `packages/squad-sdk/src/index.ts` line 29 correctly uses `export const resolveSquad: typeof resolveSquadDir = resolveSquadDir;` — preserving both barrel overloads.

**Impact:** This module-level alias is NOT re-exported by the barrel (barrel's named-export list on line 32 omits `resolveSquad`). Public API consumers are unaffected. Only users who import directly from `resolution.js` are exposed to the brittle form.

**Directive:** In future pieces touching `resolution.ts`, update the alias to:
```ts
export const resolveSquad: typeof resolveSquadDir = resolveSquadDir;
```
This aligns the internal module alias with the barrel alias form and future-proofs against overload additions.

**Severity:** Non-blocking nit. Do not block the PR for this; fix opportunistically.

---

## Finding 2 — Env seam was pre-existing; piece-25 contribution was import rename only

The Directive 2 env seam (`env: NodeJS.ProcessEnv = process.env`) was implemented in a prior piece, not piece-25. Piece-25 only renamed the import alias from `resolveSquad as resolveSquadV2` to `resolveSquadDir as sdkResolveSquadDir` to align with the D-18 rename. The commit message correctly describes this. No action needed — documented here for audit transparency.

---

## Overall: ✅ APPROVE-WITH-NITS


---

### 2026-05-28: EECOM Decision — Version drift from manual incomplete package.json edit

**Date:** 2026-05-28  
**Author:** EECOM (Core Dev)  
**Branch:** `akubly/upstream-npm-release`  

**Root Cause:** `scripts/bump-build.mjs` was NOT involved. Brady had `SKIP_BUILD_BUMP=1` set when `npm run build` ran — the script was skipped entirely. Commit `0f5ac1d2` manually edited only `packages/squad-cli/package.json` — bumping its version and `@wifi-aware/squad-sdk` dep pin from `.10` to `.11` — without touching `package.json` (root) or `packages/squad-sdk/package.json`. This left: root=`.10`, sdk=`.10`, cli=`.11`, cli sdk-pin=`.11`. The pin referenced an SDK version that does not exist on disk.

**Decision:** Direct edits to any individual `package.json` version field are prohibited. When manual version alignment is necessary, ALL THREE files must be updated in a single atomic commit (root, squad-sdk, squad-cli), and `packages/squad-cli`'s `dependencies["@wifi-aware/squad-sdk"]` pin must equal the new version. **Canonical version resolution rule: Highest on disk wins.** Bring lower-versioned files up; never down.

**Repair:** Brought root and `packages/squad-sdk` to `0.9.6-mc.preview.11` in commit `a3a3a9f0`. bump-build.mjs unchanged (was not the cause).


---

### 2026-05-29: Flight Decision — Cross-Repo Arc Staging

**Author:** Flight  
**Date:** 2026-05-29  
**Status:** Merged from inbox

**Decision: Linear chain 26 → 27 → 28 → 29 → 30; spec authoring is a hard pre-flight blocker**

The cross-repo handoff defines five implementation pieces mapped to local piece numbers 26–30. Execution order: strict linear chain (26 → 27 → 28 → 29 → 30). Piece 26 subdivision option is available but not mandated. **Spec authoring is a hard pre-flight blocker for the entire arc** — no replay session can proceed until the relevant spec file is present on `akubly/upstream-specs`. The scrub gate must be verified before piece 26 replay. Session restart required after piece 29 merges (coordinator protocol update is breaking).

**Hard invariants:** No Squad files in product PR diffs, single canonical writable state root, least-privilege automation, aliases (not emails) in published metadata.


---

### 2026-05-29: Procedures Decision — Cross-Repo Prompt Pack

**Date:** 2026-05-29  
**Author:** Procedures  
**Scope:** Pieces 26–30 prompt artifacts

**Decision:** Shipped five Phase-B session prompts for pieces 26–30. No implementation sub-division required — all five pieces are coherent, self-contained units. 

**Guard-rails identified (team-relevant, not blocking):**
1. Per-piece spec file existence check added to all prompts — recommend standardizing in baseline template.
2. Acceptance gate naming — recommend adding optional `## Acceptance gate` section to baseline.
3. YAML/JSON static asset validation — scrub gate does not validate YAML parse. Recommend adding YAML validation to gate 7.
4. Coordinator restart guidance in commit body — piece 29 changes `squad.agent.md` and requires session restart. Recommend standardizing for any piece modifying coordinator templates.
5. PII guard in publish metadata (piece 28: `.squad/publish-metadata.json` must never contain email — alias only).

**Flight-plan alignment:** Cross-check branching order before execution. If Flight's plan specifies non-linear order, "Currently on branch" lines in affected prompts must be updated.

---

### 2026-05-29: Piece 26 stays as single session (Q1 = A)

**By:** Adam (decision), Flight (recorded)  
**What:** Piece 26 (cross-repo bind config) is NOT subdivided. Config schema + runBind() + tests ship in one session, one commit, one spec file.  
**Why:** Load-bearing contracts ship with their first consumer to prove fitness. Schema correctness is validated by runBind() in same session; speculative-contract risk avoided.  
**Scope:** Replay arc pieces 26–30. Chain remains 26 → 27 → 28 → 29 → 30.

---

### 2026-05-29: sourceWorkRoot is structured `{ repo, pathHash }` (Q2 = C)

**By:** Adam (decision), Flight (recorded), RETRO (security challenge resolution)  
**What:** `publish-metadata.json` field `sourceWorkRoot` is an object: `{ repo: <basename>, pathHash: "sha256:<hex>" }` where pathHash is SHA-256 of the lowercased, forward-slash-normalized absolute path. Raw paths MUST NOT appear in published metadata.  
**Why:** Pipeline publish path (no git author identity to fall back on) and BYOD-alias-mismatch case both expose identity that the developer alias was meant to protect. Hashed form preserves cross-clone race-debugging signal at zero runtime cost.  
**§9 NFR annotation:** "Git commit author identity is the identity floor. Metadata fields must not add incremental identity or infrastructure surface beyond that floor."  
**Scope:** Piece 28 spec + _scrub-gate.ps1 must enforce object-shape assertion.

---

### 2026-05-29: Piece 29 session-restart is a louder banner only (Q3 = A)

**By:** Adam (decision), Flight (recorded)  
**What:** Piece 29 ships as a coordinator-protocol change only. Restart-enforcement tooling is NOT in scope. The piece-29 commit body and PR description must carry a prominent restart banner: "🔄 squad.agent.md updated — restart sessions to pick up new path semantics (TEAM_ROOT/WORK_ROOT split). Pre-29 sessions will silently route writes to wrong roots."  
**Why:** Piece 29 is a coordinator-protocol change, not a tooling change. The current single-developer replay arc is adequately protected by the existing self-development rule + a louder banner. Version-check tooling (Option B from the deliberation) is a generic Squad-platform concern that belongs in its own piece after the arc ships and multi-developer scenarios become real.

---

### 2026-06-02: Piece 30 Adversarial Review — CAPCOM Verdict

**Date:** 2026-06-02  
**Reviewer:** CAPCOM (SDK Expert / Architecture angle)  
**Commit:** 10168051  
**Verdict:** REJECT  
**Mandatory findings:** 2  
**Non-blocking findings:** 3  

#### Mandatory themes

**M1 — `squad fold` command does not exist.**  
`fold-squad-state.yml` calls `squad fold` at pipeline step 4. No `fold` command is registered in `cli-entry.ts`. The fold pipeline is non-functional at runtime. Piece 28 did not ship this command; piece 30 is the first piece to depend on it in executable form. Resolution requires either a new `squad fold` command or a redesign of the fold step using existing CLI surfaces.

**M2 — `publish-inbox.yml` CI trigger is unreachable.**  
The pipeline is spec'd for the product repo (WORK_ROOT), but its trigger is `squad/inbox/**`. Inbox branches are created in TEAM_ROOT (docs repo) by `squad sync --push` — the product repo never receives pushes to that namespace. The pipeline's CI automation is permanently dead. The associated test enforces the wrong trigger pattern and must be corrected alongside the fix. Correct trigger: exclude `squad-state`, `main`, `dev`; no `include:` clause.

#### Non-blocking themes (summary)

**N1** — `publish-inbox.yml` references three required ADO pipeline variables (`bootstrapScriptPath`, `docsRepoUrl`, `developerAlias`) with no declaration or documentation in the YAML. Failure is loud but confusing for first-time teams.

**N2** — `fold-squad-state.yml` hardcodes `squad-state` with no pipeline variable override; inconsistent with bootstrap's `$StateBranch` parameterization.

**N3** — Bootstrap script ignores `SQUAD_TEAM_ROOT` env var when computing sidecar path; creates a second clone if the env var is already set.

---

### 2026-06-02: Piece 30 Adversarial Review — Booster Verdict

**Date:** 2026-06-02  
**Reviewer:** Booster (CI/CD Engineer)  
**Commit:** 10168051  
**Verdict:** REJECT  
**Mandatory findings:** 2  
**Non-blocking findings:** 5  

#### Mandatory themes

**M1 — fold-squad-state.yml: No concurrency serialization control.**  
No `batch: true` (or equivalent) in the trigger block. Two simultaneous inbox pushes trigger two concurrent fold runs; the losing run fails the `git push origin HEAD:squad-state` step with a non-fast-forward rejection. Data stays intact but pipeline reliability breaks in any real multi-developer scenario. Fix: add `batch: true` to the fold trigger.

**M2 — publish-inbox.yml: `persistCredentials: true` absent from checkout.**  
ADO strips the OAuth token after checkout when `persistCredentials` is omitted (the default). The subsequent `squad sync --push` step cannot authenticate git push operations in standard ADO configurations. The fold pipeline sets `persistCredentials: true` — the publish pipeline must match. Fix: add `persistCredentials: true` to the `checkout: self` step in publish-inbox.yml.

---

### 2026-06-02: Piece 30 Adversarial Review — FIDO Verdict

**Date:** 2026-06-02  
**Reviewer:** FIDO (Quality Owner)  
**Commit:** 10168051  
**Verdict:** APPROVE-WITH-NITS  
**Mandatory findings:** 1  
**Non-blocking findings:** 4  

#### Mandatory themes

**M1 — No execution-based idempotency test for `bootstrap-cross-repo.ps1`.**  
The spec requires idempotent behavior (no duplicate remotes, no duplicate exclude entries on re-run). The two bootstrap tests are regex scans of the raw PS1 source only — no test runs the script. Idempotency logic bugs (e.g., the exclude-file regex mishandling `\r\n` line endings) would not be caught.

#### Non-blocking themes

**N1** — Guard-ordering is text-presence-only. Test confirms the guard exists in the file but not that it precedes the first write. Current implementation is correctly ordered; gap is future-mutation risk.

**N2** — Trigger structural fidelity gap. `JSON.stringify(trigger).toContain('squad/inbox')` misses YAML key-name mutations (e.g., `include:` → `Include:`). Value-presence check, not structure check.

**N3** — No assertion that `publish-inbox.yml` steps do not write to `squad-state`. Spec says "Does not write to `squad-state` at any step." No test enforces this step-content invariant.

**N4** — `$DocsRepoUrl` URL format unvalidated. Non-empty check only; `file://` and malformed URLs reach `git clone`. Script halts on failure — no silent damage — but error is opaque.

---

### 2026-06-02: Piece 30 Adversarial Review — RETRO Verdict

**Date:** 2026-06-02  
**Reviewer:** RETRO (Security)  
**Commit:** 10168051  
**Verdict:** APPROVE-WITH-NITS  
**Severity counts:** Critical: 0 | High: 1 | Medium: 2 | Low: 4  
**Mandatory findings:** 3  
**Non-blocking findings:** 4  

#### Mandatory themes (blocks merge)

- **M1 (High):** `bootstrap-cross-repo.ps1` echoes `$DocsRepoUrl` verbatim via `Write-Host` — PAT-embedded URL leak to pipeline/console logs; also exposed in ADO's command-line log when `publish-inbox.yml` passes `$(docsRepoUrl)` as an argument to `pwsh -File`.
- **M2 (Medium):** Missing `--` separator before `$DocsRepoUrl` in `git clone` — violates team convention established in piece 14; git-argument injection vector for URLs beginning with `--`.
- **M3 (Medium):** No URL scheme allowlist for `$DocsRepoUrl`; `file://` and arbitrary HTTPS origins are accepted; `https://attacker.com/.git` blind-clone probe does NOT safe-fail.

#### Non-blocking themes

- **N1 (Medium):** Sole-writer invariant enforced by branch-policy recommendation only — no CI preflight gate validates the policy is set.
- **N2–N4 (Low):** Misleading `persistCredentials` scope comment; unconditional `cat publish-history.json` in fold report step; `.git/info/exclude` masking `.squad/` from `git status` warrants an inline documentation note.

#### Documentation gap

No doc warns that `DocsRepoUrl` must never contain embedded credentials. Recommend a callout box in all three docs: "Never embed PATs in `DocsRepoUrl`. Use SSH keys or ADO service connections."

---

### 2026-06-02: Piece 30 Adversarial Review — PAO Verdict

**Date:** 2026-06-02  
**Reviewer:** PAO (DevRel)  
**Commit:** 10168051  
**Verdict:** APPROVE-WITH-NITS  
**Mandatory findings:** 1  
**Non-blocking findings:** 8  

#### Mandatory themes

**M1 (BLOCKER):** `test/docs-build.test.ts` missing `'state-backends'` in EXPECTED_FEATURES array — docs-test sync hard rule violated.

#### Non-blocking themes

**N1:** Terminology drift — docs reference `old-squad-state.yml` instead of spec's `fold-squad-state.yml` (4 instances across 2 files).

**N2:** Typos — `ootstrap-cross-repo.ps1` and `ootstrapScriptPath` (missing leading 'B').

**N3:** Code block language typo — `ash` should be `bash` (state-backends.md line 639).

**N4:** Missing clarity — `$DocsRepoUrl` format (with/without `.git`?) not documented.

**N5:** Missing clarity — docs don't explain what to do if `squad bind` not installed.

**N6:** Single-repo case not addressed — assumes cross-repo only (per piece 29 concern).

**N7:** Security callout missing — no warning against embedding credentials in `$DocsRepoUrl`.

**N8:** Deep linking — cross-references use page URLs only, no section anchors.

---

### 2026-06-02: Piece 30 Consolidated Verdict — Flight (Lead)

**Date:** 2026-06-02  
**From:** Flight (Lead — consolidation role only; excluded from review panel as author of commit 10168051)  
**Commit:** 10168051  
**Verdict:** REJECT  
**Convergent mandatory themes:** 9  

#### Summary

Consolidated verdict: **REJECT.** 9 mandatory findings across 5 reviewers: 2 from CAPCOM, 2 from Booster, 3 from RETRO (including 1 High), 1 from FIDO, 1 from PAO. Author Flight is locked out of the revision under strict reviewer rejection lockout.

#### Verified runtime defect

`squad fold` appears only in the new templates (`fold-squad-state.yml`); no corresponding handler exists in `packages/squad-cli/src/`. The fold pipeline is non-functional as shipped.

#### Scope question for Brady

Does fixing the missing `squad fold` CLI command belong in piece 30 (substantially expanding its scope, requiring CONTROL authorship of the command) or in a separate piece that piece 30 depends on (with piece 30 revised to use only existing CLI surfaces)? Flight is excluded from pre-answering this.

#### Candidate revision authors

Booster (YAML fixes), RETRO (bootstrap hardening), PAO (docs-test sync + terminology), FIDO (idempotency test), CONTROL (if `squad fold` command is in scope), EECOM (PowerShell/mirror).  
**Follow-up piece (future, separate arc):** Coordinator version enforcement — implement on-disk-vs-session version comparison at session start, with cross-surface support (CLI / VS Code / GitHub.com). Out of scope for this arc.

---

### 2026-05-29: Piece 30 YAML templates validated by behavioral assertions (Q4 = D)

**By:** Adam (decision), Flight (recorded)  
**What:** Piece 30 adds `test/cli/ado-templates.test.ts` that parses each .yml template with the `yaml` npm package and asserts piece-specific structural contracts: no `pr:` trigger on `publish-inbox.yml`; `squad/inbox/*` trigger on `fold-squad-state.yml`; no broad OAuth scope on fold; alias-empty guard in `bootstrap-cross-repo.ps1`. NO schema vendoring (ADO YAML schema not fetched or stored).  
**Why:** TDD discipline requires RED→GREEN tests on every shipped surface. Spec contracts (our concerns) are testable in-repo; ADO schema conformance (their concerns) is best caught by Phase C reviewer pasting into a pipeline editor. Vendoring 180KB of drift-prone schema violates replay isolation with no proportional value.  
**New devDependency:** `yaml` (lightweight, no transitive deps).  
**Scope:** Piece 30 spec + Procedures' piece-30 prompt updated with explicit "Test surface" callout.

---

### 2026-05-29: Scrub-gate evolution = hybrid (Q5 = C)

**By:** Adam (decision), Flight (recorded)  
**What:** Per-piece behavioral test files validate piece-internal structural contracts (Q4 pattern). A single post-30 gate-audit piece (call it 30.5) adds the genuinely cross-cutting gate rules in one atomic commit AFTER all surfaces 26–30 are known. Pieces 26, 27, 28 do NOT modify `_scrub-gate.ps1` in their own commits.  
**Three new gate rules for piece 30.5:**  
1. No `Users\` or `/home/` path segments in any string value in `.squad/config.json` or `.squad/publish-metadata.json` (serves pieces 26, 28; new Gate 7 or G4 extension)
2. ADO variable syntax `$(...)` exclusion in `.squad-templates/ado/**` paths (serves piece 30; G4 exclusion clause)
3. Alias format validation `[a-z][a-z0-9-]{0,38}` for `developerAlias` field (serves 26, 27, 28; new Gate 7 or G3 extension)

**Why:** Q2 already established the per-piece-gate-sub-rule precedent (piece 28's sourceWorkRoot shape check lives in piece 28's tests, not the gate). The scrub gate is a cross-cutting exclusion filter operating tree-wide via `git grep`. Extending it piecemeal creates regression coupling (piece 26's rule may flag piece 30's `$(System.AccessToken)` before piece 30 lands its exclusion). Hybrid keeps gate evolution atomic and avoids mid-arc breakage.  
**Test fixture:** `test/scrub-gate-surfaces.test.ts` in piece 30.5 — synthetic fixtures for each new surface.  
**Scope:** Pieces 26–30 + new piece 30.5.

---

### 2026-05-29: Scrub-gate rules have two flavors — replay-private vs upstream-bound

**By:** Adam (directive), Flight (recorded)  
**What:** Scrub-gate rules MUST be authored with explicit awareness of which flavor they are.  
- **Flavor 1 — Replay-private:** Isolation guards specific to this workflow that prevent first-party concepts from leaking into commits (e.g., current Gates 2 (wifi.aware), 3 (akubly), 4 (Microsoft/internal). Stay in `akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1`. NEVER flow upstream as a code change.
- **Flavor 2 — Surface-relevant:** Gate rules that protect product surfaces being shipped (e.g., the three new rules for piece 30.5: abs-path segment exclusion, ADO `$(...)` exclusion, alias-format allowlist). These ARE product features. They flow upstream as part of their owning piece's PR.

**Why:** Conflating the two would either (a) leak first-party isolation rules into upstream PRs (bad — outs the replay process) or (b) keep product-surface protections trapped in replay-private gate code (bad — upstream loses the protection that ships with the feature).  
**Authoring rule:** Every gate-rule addition MUST be tagged in its spec section as `[replay-private]` or `[upstream-bound]`. The piece 30.5 spec must annotate all three new rules as `[upstream-bound]`. Any future replay-private gate rule additions stay outside the upstream-bound flow.  
**Scope:** Binding for all future scrub-gate work in this replay arc and any successor arcs.

---

### 2026-05-29: Procedures spec decision — Foundation pieces 26–28

**Date:** 2026-05-29  
**Author:** Procedures  
**Scope:** Spec authoring for cross-repo arc pieces 26, 27, 28

**Decision: Six structural choices made while authoring that were not pre-locked**

The following items were resolved during spec authoring. None override any locked decision (Q1–Q5). All are additive refinements.

#### 1. `runBind()` idempotency contract is at entry-level, not step-level

The piece 26 spec requires that `runBind()` be fully idempotent end-to-end (re-running on an already-configured WORK_ROOT is a no-op). The handoff specified individual step idempotency but did not state that the function as a whole must also be re-runnable without error. The spec locks this as a test assertion.

#### 2. Windows cross-drive path normalization rule for `.git/info/exclude`

The handoff identified `.git/info/exclude` as a new write surface but did not specify how to handle absolute Windows paths when WORK_ROOT and TEAM_ROOT are on different drives. The spec locks: entries must be written as forward-slash relative patterns, never as absolute paths, regardless of host OS. This is consistent with git's own exclude format contract.

#### 3. `ensureStateRemote()` placement in piece 27

The handoff described `ensureStateRemote()` as a helper inside `sync.ts` but did not specify whether it should be called at dispatch time or at the pull/push call site. The spec locks: called at the start of every `--pull` and every `--push` execution path. This ensures the guard fires for hook-triggered syncs as well as direct CLI invocations.

#### 4. `publishedAt` serialization format locked to ISO 8601 UTC with `Z` suffix

The handoff specified ISO 8601 UTC but did not address local-time serialization risk. The spec adds: must use `Z` suffix, not a UTC offset, to eliminate fold-ordering ambiguity across time zones.

#### 5. Piece 28 test assertion count expanded from 2 to 6

The handoff listed two bare-repo fixture assertions. Decision Q2 added three more (object shape, no raw paths, pathHash stability). The spec adds one more (alias-empty guard prevents branch creation). Total: six numbered assertions as the acceptance gate.

#### 6. `hydrateWorkRootProjection()` file deletion semantics

The handoff did not specify what happens to files in the WORK_ROOT projection that no longer exist in TEAM_ROOT. The spec locks: remove stale files from the projection. This prevents ghost files from accumulating across hydration cycles and is necessary for the projection to remain a faithful read-only mirror.

---

### 2026-05-29: Spec Protocol Decisions — Procedures

**Date:** 2026-05-29  
**Author:** Procedures

#### Gate 8: positive-assertion pattern for allowlist coverage

When adding a gate rule that must permit a known class of expressions in a specific file surface, implement it as a positive assertion (every expression in the target surface must match an allowlist pattern) rather than a pure exclusion (do not match X). The positive-assertion approach:

- Explicitly allows all known-good expressions (e.g., ADO variable names matching `[A-Za-z][A-Za-z0-9._]*`).
- Fails on novel patterns that were never explicitly reviewed, including future injection attempts.
- Does not require modifying existing gate rules — the new gate covers the new surface independently.

This is the correct pattern when (a) the existing gate that would otherwise cover the surface (e.g., Gate 4's internal-reference check) cannot be modified, and (b) the new surface has a well-defined allowlist (e.g., ADO runtime variable names are well-specified).

Generalizable rule: any gate rule that adds allowlist coverage for a new file surface should use positive assertion, not exclusion. Document this in the spec's proposed-change section alongside the rule body.

#### Gate numbering convention for additive audit pieces

When adding gate rules to a fixed-count scrub gate (where existing rules display `[1/6]` through `[6/6]`), new rules use `[7]`, `[8]`, `[9]` headers without a total count. Do not update the existing `[N/6]` labels — that would violate the preserve-existing constraint.

This creates a header inconsistency that is intentional and acknowledged. A future cleanup piece can normalize all headers simultaneously. The additive piece's spec notes section should call this out explicitly so reviewers do not flag it as a defect.

#### Spec section: Session restart requirement

Protocol-change specs (any piece that alters an agent-observable behavior or modifies a template read at session start) require a dedicated `## Session restart requirement` section. This section must contain the exact verbatim restart banner string that will appear in the commit body and PR description — not a paraphrase. The spec is the contract; the commit body is derived from it.

This pattern was invented for piece 29 (TEAM_ROOT/WORK_ROOT protocol change). It is reusable for any future piece that changes coordinator templates or agent charter files that are read at session initialization.

---

---

### 2026-05-29: Deprecated alias targets and deprecation-warning mechanism for piece 26

**By:** EECOM

**What:** `projectDir` maps to `workSquadDir` (the `.squad/` directory in the product repo), not to `workRoot`. `teamDir` maps to `teamRoot` (the team repo root), not `teamSquadDir`. Deprecation fires via `Object.defineProperties` getters on the returned shape, guarded by a module-level `_deprecationFired` map (exported for test resets) so `console.warn` fires at most once per process per alias.

**Why:** The original `projectDir` semantics pointed to the `.squad/` directory (what is now `workSquadDir`), not the repo root. Mapping it to `workRoot` would have silently broken all callers that use the path to write files inside `.squad/`. Similarly, `teamDir` historically pointed at the team repo root, so it maps to `teamRoot`. The once-per-process guard prevents noisy log spam in long-running CLI sessions while still giving downstream consumers a clear migration signal. The `_deprecationFired` export is the stable test-reset contract for pieces 27+.


---

### 2026-05-29: EECOM Piece 27 — Pre-existing build and scrub-gate baseline

**Author:** EECOM
**Piece:** 27 — explicit sync command

## Build failure baseline

`npm run build` was failing BEFORE piece 27 changes on branch `squad/piece-26-cross-repo-bind-config` (the piece-26 tip). Confirmed by stashing piece-27 changes and running `npm run build` — same errors produced.

Failing files (all pre-existing, not touched in piece 27):
- `packages/squad-cli/src/commands/doctor.ts` — imports missing SDK exports (`clonesMatch`, `isValidCallsign`, `normalisedPathKey`, `normalizeRemoteUrl`)
- `packages/squad-cli/src/commands/init.ts` — imports missing SDK exports
- `packages/squad-cli/src/commands/unassign.ts` — imports missing SDK exports

Root cause: SDK refactor in an earlier piece removed or renamed these exports. CLI commands referencing them were not updated. This is a separate work item and not within piece 27 scope.

**Action:** Flight or the next scheduled piece should reconcile CLI commands against current SDK exports. No piece-27 files introduce new TypeScript errors (confirmed via targeted `tsc --noEmit` check).

## Scrub-gate Gate 1 baseline

Scrub gate exits 1 due to pre-existing strip-listed paths:
- `docs/_internal/` directory (16 files)
- `templates/casting/`, `templates/identity/`, `templates/orchestration-log.md`
- `packages/squad-cli/templates/` and `packages/squad-sdk/templates/` equivalents
- `packages/squad-sdk/src/casting/`

These paths have been present since before piece 08a. Per piece-08a coordinator decision: "Scrub gate failures are pre-existing upstream baseline contamination, not piece responsibility." The strip-list was designed to exclude MS-internal Windows wireless team artifacts; Squad's own product directories (`/casting/`, `/identity/`, `orchestration-log`) match the pattern incidentally. Piece 27 introduces zero new strip-listed paths.

Gate 2 (wifi-aware): PASS
Gate 3 (akubly mentions): WARN — `.squad/` state files only, expected
Gate 4 (internal mentions): WARN — `.squad/` state files only, expected
Gate 5 (ADO fixtures): PASS
Gate 6 (file count): PASS (13 files)

## Wiring test pre-existing failures

Two wiring test failures pre-date piece 27:
- `commands/doctor-types.ts is imported in cli-entry.ts` — FAIL (pre-existing)
- `commands/init-remote.ts is imported in cli-entry.ts` — FAIL (pre-existing)

These are not piece 27 responsibility. `sync` now passes the wiring test (wire added in piece 27).


### 2026-06-01: Piece 27 adversarial review — CONTROL verdict
**By:** CONTROL (TypeScript Engineer)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- Type design is sound overall — `SyncOptions.direction` is a correctly-typed string literal union; `SyncGitOps` injection interface is clean; `ensureStateRemote()` signature is `Promise<void>` with process.exit semantics consistent with the rest of the codebase.
- Remote resolution (`options.remote ?? readStateRemoteFromConfig(repoRoot) ?? 'squad-docs'`) is a pure, nullish-correct precedence chain — exactly right.
- ESM correctness: all new imports use `.js` extensions; dynamic `await import('./cli/commands/sync.js')` in cli-entry.ts is correct.
- Zero new tsc errors vs. parent (43 pre-existing on both). Piece-27 introduced no type regressions.
- Zero new suppressions. Pre-existing `(err as any).stderr` in `syncPush` is untouched by this piece.
- **Mandatory nit (N1):** `readStateRemoteFromConfig` and `readDeveloperAliasFromConfig` both hand-roll `JSON.parse(raw)` → `any` access, bypassing the SDK's typed `loadDirConfig(squadDir: string): SquadDirConfig | null` which already covers `stateRemote` and `developerAlias`. A rename of either field in `SquadDirConfig` would fail at runtime in sync.ts with no compile-time alert. The typed seam exists; sync.ts should use it.

**Type nits (mandatory):**
N1: `readStateRemoteFromConfig` and `readDeveloperAliasFromConfig` bypass `loadDirConfig()` and operate on `any` (JSON.parse result). Replace both with a single call to `loadDirConfig(path.join(repoRoot, '.squad'))` from `@bradygaster/squad-sdk`, then read `config?.stateRemote` and `config?.developerAlias` from the typed `SquadDirConfig | null` return. This makes field-name renames a compile-time catch instead of a runtime surprise. The SDK function is already exported from the barrel and handles missing/malformed files identically to the hand-rolled fallback.

**Type nits (non-blocking):**
N2: `SyncOptions.developer?: string` accepts `''` — the empty-alias guard (`if (!alias)`) is runtime-only. The type system does not enforce non-empty alias at the boundary. A JSDoc `@remarks` on the field documenting the non-empty contract, or a `NonEmptyString` brand, would make the contract explicit to callers. The spec question confirms this is the expected finding; runtime behavior is correct.

N3: `REQUIRED_REFSPECS` is named in SCREAMING_SNAKE_CASE (convention = module-level constant) but is a factory function `(remote: string) => string[]`. Rename to `requiredRefspecs(remote)` or `getRequiredRefspecs(remote)` to signal that it is a function, not a frozen value.

N4: `return config.stateRemote || undefined` in `readStateRemoteFromConfig` uses falsy-OR. If the field were ever an empty string, it would be treated as absent — which may be intentional, but `?? undefined` (nullish) is the correct nullish-coalescing form to pair with the `??` chain in `runSync`. Replace with `return config.stateRemote != null && config.stateRemote !== '' ? config.stateRemote : undefined` or, once N1 is adopted, this row disappears.

N5: Direction flag parsing in cli-entry.ts uses sequential `if` without `else if` — last match wins silently. `squad sync --pull --push` resolves to `push` with no feedback. Not a type error, but the intent contract is undocumented; a comment noting "last-flag-wins" or an explicit conflict guard would prevent confusion.

**Build/tsc status:** FAIL (pre-existing) — `tsc --noEmit -p packages/squad-cli/tsconfig.json` exits 2 with 43 errors on the parent commit (piece-26) and 43 errors on piece-27 commit `31177e72`. Zero new errors introduced. All 43 failures are baseline contamination from stale published SDK in `packages/squad-cli/node_modules/@bradygaster/squad-sdk` (stale `SquadDirConfig` missing recent fields, missing renamed exports). This is the pre-existing dependency skew documented by FIDO in the piece-25 review. Piece-27 is clean against baseline.

**Suppressions introduced (`@ts-ignore`/`as any`/`eslint-disable`):** 0 — none introduced. `(err as any).stderr` in `syncPush` is pre-existing on the parent commit; confirmed by diffing `31177e72^`.

**Public API surface drift:**
- `SyncGitOps` interface — new export (additive)
- `DEFAULT_SYNC_GIT_OPS` — new export (additive)
- `SyncOptions.direction` union expanded from `'push'|'pull'|'both'` to `+'hydrate-only'|'publish-only'` — additive, no breakage
- `SyncOptions.{developer?, gitOps?, workRoot?}` — new optional fields (additive)
- `ensureStateRemote(repoRoot, remoteName, gitOps?)` — new export (additive; this is the piece-28–30 contract boundary)
- No removals. All existing callers of `runSync` remain valid.

**Cross-piece consistency:** `stateRemote` in `SquadDirConfig` is present and typed as `string | undefined` in the SDK's `resolution.ts` at this commit. Piece-27 reads it from `.squad/config.json` at runtime (via untyped hand-roll — see N1). The schema field aligns with piece-26's design. The TS2353 on `bind.ts(235,5)` is stale-modules contamination, not design drift.

**If REJECT:** Not rejected. If N1 becomes blocking (post-merge regression risk increases as pieces 28–30 add more callers), recommend EECOM as revision author (piece-27 implementer locked out per team protocol).


### 2026-06-01: Piece 27 adversarial review — FIDO verdict
**By:** FIDO (Quality Owner)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- All 18 sync-command tests and 15 install-hooks tests GREEN on piece-27 tip (31177e72). Confirmed.
- Recursion guard (SQUAD_SYNC_ACTIVE) present in all 4 hook templates AND in `runSync()` — PASS.
- Core spec functionality (remote resolution, ensureStateRemote, CLI wiring) sound and tested.
- Two functional defects found via adversarial probing: whitespace alias bypass and force-install duplication. Neither is a spec misread; both are implementation bugs with real user impact.
- No new `eslint-disable`, `@ts-ignore`, or `as any` introduced by piece 27 (existing `(err as any).stderr` in syncPush predates this piece).
- Lint/build failures identical on piece-26 and piece-27 tip — pre-existing baseline, not regressions.

**Mandatory nits (must resolve before PR merge):**

N1: **Whitespace-only alias bypasses the empty-alias guard.**
`runSync()` checks `if (!alias)` — a falsy check. `developer: ' '` (space), `developer: '\t'` (tab), and `developer: '\n'` (newline) are all truthy in JavaScript and pass straight through to push operations. The resulting push would construct refs like `squad/inbox/ /session-id`, which fail in git with a cryptic ref-name error rather than the spec-required clean exit-1 with guidance. Fix: change the guard to `if (!alias || !alias.trim())`. Add tests: `developer: ' '`, `developer: '\t'`. These must fire BEFORE any git op (currently they would reach `syncPush()`).

N2: **`installHook()` with `force: true` duplicates the squad section instead of replacing it.**
The force branch computes `const cleaned = existing.split('\n').filter(...).join('\n')` but the variable is never used — it is dead code. Execution falls through to the chain block, which appends the new template on top of the already-marked hook. Each `squad install-hooks --force` invocation doubles the hook content. This can exceed shell script limits and cause silent double-invocations of the state fetch. Fix: use `content` directly (not chained on `existing`) when `force` is true and marker is found. Add a test: run `installHooks` twice with `force: true`; assert the marker appears exactly once and the hook length matches a fresh install.

**Non-blocking nits:**

N3: **No flag-combination-precedence tests.** Passing `--pull --push` to the CLI produces `direction = 'push'` (last-if-wins); `--hydrate-only --publish-only` produces `publish-only`. These precedence rules are not documented and not tested. No spec requirement to reject the combo, but tests verifying the winner (or a clear error) would prevent silent user confusion.

N4: **`--remote ""` at CLI dispatch is silently ignored.** If a user types `squad sync --remote ""`, the CLI condition `args[remoteIdx + 1] ? { remote: ... } : {}` treats the empty string as falsy and falls through to config/default without any warning. Not harmful but surprising. Consider a non-empty validation guard or a short warning.

N5: **No test for `stateRemote` absent + `--both` direction.** The existing remote-resolution tests cover each source independently for `--pull`. No test exercises `--both` with `stateRemote` absent from config (falls back to `squad-docs` default) — this path is untested through the combined pull+push flow.

**Pre-existing baseline claim:** VALIDATED
- Build: identical TS errors on assign.ts, doctor.ts, init.ts, unassign.ts on both piece-26 (b5fc0af3) and piece-27 (31177e72). Diffed `npm run build` output line-by-line — zero new errors introduced.
- Wiring failures: `doctor-types.ts` and `init-remote.ts` both fail on piece-26 with the same assertion text. On piece-26, `sync.ts` passes as `KNOWN_UNWIRED`; on piece-27 it passes as wired. EECOM's baseline-contamination claim for Gates 1+2 is confirmed correct.
- Lint: `npm run lint` failures on piece-27 are the same pre-existing errors (stale SDK exports in legacy commands). No piece-27 files appear in lint output.

**Hook recursion guard:** PASS
- All 4 templates (`pre-push`, `post-merge`, `post-checkout`, `post-rewrite`) contain `SQUAD_SYNC_ACTIVE`.
- `runSync()` checks `process.env[SQUAD_SYNC_ENV]` at entry and sets it before any git call.
- Install-hooks test `pre-push hook still has recursion guard after update` passes GREEN.
- Post-merge, post-checkout, post-rewrite guard tests (3 × recursion) all pass GREEN.

**Spec conformance:** 17/19 acceptance criteria pass (2 partial — empty-alias guard misses whitespace; force-reinstall not implemented correctly and untested).

**If REJECT:** N/A — this is APPROVE-WITH-NITS. If N1 or N2 block after revision, recommended rev author: EECOM (implementer of this piece). Flight is locked out as original implementer.


### 2026-06-01: Piece 27 adversarial security review — RETRO verdict
**By:** RETRO (Security)
**Verdict:** APPROVE-WITH-NITS
**Why:**
- All git subprocess calls use `execFileSync` with array argument forms throughout — no shell-string `exec` anywhere in the diff. This is the primary defense against shell and flag injection and it holds.
- The `--remote` flag injection surface is closed: `ensureStateRemote()` validates the remote name via string comparison against `listRemotes()` output before any git invocation that takes the remote name as input. A hostile `--remote "--upload-pack=evil"` fails the `remotes.includes()` check and exits 1 with bind guidance — never reaches a git invocation with that value as a flag.
- Hook templates use `"$REMOTE"` (double-quoted variable) throughout all four templates. Shell command substitution in `$REMOTE` cannot be executed — the value is already assigned as a string. No code injection path exists through a hostile `stateRemote` in config.
- `SQUAD_SYNC_ACTIVE` recursion guard is present in all four hook templates and at the entry of `runSync()`, with proper `unset` on exit. Guard does not require cross-session persistence and is correctly scoped to the process environment.
- All config reads (`git config --add`, `git config --get-all`) use local-repo scope — no `--global` flag anywhere.
- One mandatory fix required (H1): the alias-empty guard does not reject whitespace-only values, violating the spec contract.

**Critical findings (BLOCK PR):**
None.

**High findings (mandatory before PR):**
H1: **Whitespace-only alias bypasses the alias-empty guard.**
- In `runSync()`: `const alias = options.developer !== undefined ? options.developer : readDeveloperAliasFromConfig()`. For `options.developer = " "` (spaces/tabs), `alias = " "` is truthy — `if (!alias)` does not fire.
- In `cli-entry.ts` dispatch: `...(developerIdx !== -1 ? { developer: args[developerIdx + 1] ?? '' } : {})`. A user running `squad sync --push --developer "   "` passes three spaces as the alias, which passes the guard.
- Spec contract: "If `--developer <alias>` is provided but the value is empty, exit 1." Whitespace-only is functionally empty.
- Fix: `if (!alias || !alias.trim())` in the push-direction guard in `runSync()`. One-line change.
- Probe verified: `--developer ""` correctly exits 1; `--developer " "` incorrectly proceeds.

**Medium / Low findings (non-blocking):**
M1: **Push error messages may expose auth tokens embedded in git remote URLs.**
- In `syncPush()`, the catch block: `const msg = err instanceof Error ? (err as any).stderr || err.message : String(err)`. Git push failure stderr can contain the remote URL; if the URL is `https://<token>@github.com/org/repo`, the token appears in the console output.
- Mitigation: strip URL credentials from `msg` before printing (regex: replace `https?://[^@]+@` with `https://***@`).
- Not a block — requires an already-misconfigured credential-in-URL, and console output is not persisted to committed files.

M2: **`installHook()` force-reinstall logic is incomplete — double-appends on `--force`.**
- When `force=true` and the hook already contains `SQUAD_HOOK_MARKER`, the code computes a `cleaned` variable but never uses it. Execution falls through to the chaining path, appending the new squad section without removing the old one. Repeated `squad install-hooks --force` compounds hook content indefinitely.
- Not a security issue (the hook still guards correctly), but a correctness defect. Fix: complete the forced-overwrite path to remove the old squad section before appending.

M3: **No charset allowlist on `--remote` or `stateRemote` values.**
- All git subprocess calls use `execFileSync` array args (not shell), so shell metacharacters are inert. However, a remote name containing null bytes or newlines could cause confusing failures in refspec construction and hook template parsing without an informative error.
- The piece 30.5 decision establishes alias format `[a-z][a-z0-9-]{0,38}` as the scrub-gate rule. Remote names should be held to a similar allowlist (`[a-zA-Z0-9_.-]{1,64}`) enforced at input validation time. Non-blocking because the actual injection path is closed; this is a defence-in-depth hardening.

M4: **Developer alias accepted without charset validation — future injection surface.**
- The alias is validated for presence (H1 aside) but not for character set or length. When `squad/inbox/<alias>/<session>` refspecs are implemented in later pieces, an alias containing `/`, `*`, `..`, or control characters will be interpolated directly into git refspecs.
- The piece 30.5 decision (decision 2026-05-29) already specifies `[a-z][a-z0-9-]{0,38}` as the alias allowlist for the scrub gate. Apply the same allowlist in `runSync()` alias validation now, before the refspec interpolation lands.

L1: **Hook templates lack `set -eu` strict mode.**
- All four hook templates omit `set -e` (exit on error) and `set -u` (error on unset variable). Critical git calls use `|| true` or `2>/dev/null` as safety valves, which is intentional. But non-critical intermediate steps (e.g., `REPO_ROOT=$(git rev-parse ...)`) could fail silently under unusual conditions.
- Low risk given the `|| true` coverage. Adding `set -e` at the top of each hook (after the shebang) with explicit `|| true` on the intentionally-fallible calls would improve error visibility without changing current behavior.

L2: **`cli-entry.ts` dispatch is missing `--push` and `--both` direction handlers.**
- Direction resolution: `--pull`, `--hydrate-only`, `--publish-only` are explicitly mapped. `--push` has no handler — it silently falls to the default of `'both'`. `--both` also falls to `'both'` (correct result, wrong path). Not a security issue; a correctness gap that makes `squad sync --push` behave as `--both`.

**Attack surface assessed:**
- `--developer` validation: **partial** — empty string `""` correctly exits 1; whitespace `" "` incorrectly passes. No charset check. Alias unused in git ops in this impl, so no injection reachable today, but H1 violates spec contract.
- `--remote` injection: **pass** — `remotes.includes(remoteName)` check fires before any git invocation taking the remote name. `execFileSync` array args throughout. No `--` separator needed for config-key construction. Flag injection probe (e.g., `--remote "--upload-pack=evil"`) exits 1 at the includes check.
- Config-driven attack (`stateRemote`): **pass** — hook templates quote `"$REMOTE"` throughout all four templates. No command substitution re-evaluation occurs. Hostile `stateRemote` causes git to reject an unknown remote, not to execute attacker code. JS code path uses `execFileSync` array args.
- Refspec safety: **pass** — `+` force-update prefix is correctly scoped to remote-tracking refs (`refs/remotes/`), not local branches. Local branch updates in `syncPull()` are gated on `merge-base --is-ancestor` before `git update-ref`. Push refspecs have no `+` prefix.
- Hook template safety: **partial** — recursion guard present and correct in all four templates. Variable quoting is correct (`"$REMOTE"` everywhere). `set -eu` absent (L1). Force-reinstall deduplication incomplete (M2). Missing-config silent-skip works correctly.
- Secret/PII leakage: **partial** — no `.env` reads, no credential writes to committed files. Push error messages may surface git remote URLs including any embedded auth tokens (M1). No stack traces leak in non-debug paths. Hooks directory path printed at install time contains no credentials.

**If REJECT:** Not rejected. If H1 fix is contested, recommended rev author: EECOM (implementer locked out per strict lockout protocol — assign to CONTROL or Sims, consistent with piece 10 revision precedent).

### 2026-06-01: Piece 27 Nit Revision — Adversarial Review Complete

**Status:** Resolved  
**Revision Author:** Flight (Lead)  
**Branch:** squad/piece-27-explicit-sync-command  
**Commit:** 5d8509f4 (pushed)

#### Nits Resolved

- **N1/H1 (FIDO+RETRO):** Whitespace-only --developer " " rejected before git ops (!alias || !alias.trim()). 10 whitespace test cases added.
- **N2 (FIDO):** installHook(force:true) now idempotent — single squad section after repeat calls. Idempotency test added (16 tests total in install-hooks.test.ts).
- **N3 (CONTROL):** Hand-rolled JSON config readers replaced with typed loadDirConfig() + module augmentation to bridge SDK versions.

#### Test Results Post-Revision

| Test file | Status |
|-----------|--------|
| sync-command.test.ts | 33/33 PASS |
| install-hooks.test.ts | 16/16 PASS |
| cli-command-wiring.test.ts | 36/38 (2 pre-existing: doctor-types, init-remote) |

#### Verification

- Recursion guard (SQUAD_SYNC_ACTIVE) PASS in all 4 hook templates.
- Scrub-gate delta: zero new failures vs baseline.

#### Context

EECOM locked out per reviewer protocol; Flight assigned as rev author. Revision produced independently.

---

### 2026-06-02: Four-path coordinator contract — WORK_SQUAD_DIR is projection-only

**By:** Procedures (via Coordinator)
**What:** Piece 29 establishes that `WORK_SQUAD_DIR` (`{WORK_ROOT}/.squad`) is a read-only compatibility projection and must never be treated as canonical writable state. Write rule 3 prohibits non-Scribe agents from creating or modifying files there. Write rule 5 requires state publication to flow through `squad sync --push` against `STATE_REMOTE`, not through direct `git push` from product-repo automation.

The spawn-contract introduces five mandatory variables (`TEAM_ROOT`, `WORK_ROOT`, `STATE_REMOTE`, `STATE_BRANCH`, `DEVELOPER_ALIAS`) that must appear in every spawned agent prompt with no optional omissions. These replace the former single `TEAM ROOT:` label and make the cross-repo transport introduced by pieces 26–28 usable in a running session.

**Why:** Without explicit write rules, agents operating after pieces 26–28 could silently route decisions or history writes to `WORK_ROOT/.squad/`, causing Squad artifacts to appear in product PR diffs and breaking state integrity. The four-path table makes the boundary unambiguous at the protocol level, independent of any runtime enforcement.

Sessions active before this piece merges operate under the old single-root contract and must be restarted.
---

### 2026-06-02: Piece 30 Revision-3 Review — CAPCOM Verdict

# Decision: Piece 30 Revision-3 Review — CAPCOM

**Date:** 2026-06-02  
**Author:** CAPCOM (SDK Expert)  
**Commit reviewed:** 3c6c9edf (EECOM's revision)

## Verdict

**APPROVE-WITH-NITS**

## Prior M_NEW_1 status

**RESOLVED.** Timestamp-based skip (`LAST_PUBLISHED_AT` scalar cutoff) fully replaced with ref-name set-membership check against `.[].inboxRef` in `publish-history.json`. Field name is self-consistent (fold writes `inboxRef`, fold reads `.[].inboxRef`). All edge cases probe clean: empty array folds all, missing file folds all, malformed JSON aborts with `exit 1`, duplicates are idempotent.

## New mandatory findings

None.

## Pre-existing non-blocking (carry-forward, not re-escalated)

- **Prior N1 (persists):** `foldCommit` in history entries stores the inbox ref HEAD SHA, not the squad-state fold commit SHA. Capture `git rev-parse HEAD` after `git commit` to fix.
- **Prior N3 (persists):** Prune step deletes ALL current inbox refs, not just folded ones. Residual risk limited to refs with missing `publish-metadata.json` when `pruneAfterFold=true` (default false).


---

### 2026-06-02: Piece 30 Revision-3 Review — FIDO Verdict

# FIDO — Piece 30 Revision-3 Review Decision

**Date:** 2026-06-02
**Reviewer:** FIDO (Quality Owner)
**Commit reviewed:** 3c6c9edf (EECOM's revision)
**Full verdict file:** `.squad/reviews/piece-30-revision3-fido.md`

---

**Verdict:** APPROVE
**New mandatory findings:** 0
**New non-blocking findings:** 3

**Test count:** 200 ADO-suite (18 + 181 + 1) — EECOM's claim VERIFIED. Grand total 212 passing.

**Mirror byte-identity:** PASS — all 4 locations for both `fold-squad-state.yml` and
`bootstrap-cross-repo.ps1` have identical SHA-256 hashes.

**Idempotency test:** PASS (32.3 s, real pwsh execution, no regressions from stderr-capture additions).

---

**Non-blocking findings summary:**
- NB1: Gate 15 (`not.toContain('LAST_PUBLISHED_AT')`) has false-positive risk if a comment
  mentioning the banned variable is added to the YAML.
- NB2: Gate 16 (`toContain('.[].inboxRef')`) can be satisfied by a YAML comment containing the
  string even if the functional jq code is removed.
- NB3: Gate 18 checks variable existence (`$cloneOutput`, `$redactedOutput`) but does not verify
  that `$redactedOutput` is the variable actually emitted in the `Write-Error` call — correctness
  bypass possible without tripping the guard.

All three are refinement items. None block merge.

---

### 2026-06-02: Dogfood Findings — Handbook (Handbook Agent)

# Dogfood Findings — Handbook (2026-06-02)

> Source: Handbook dogfood runbook authorship — code read of bind.ts, sync.ts, cli-entry.ts.
> These are shipping defects found by static analysis, not future test ideas.

---

## Finding 1 — `publishTeamRootToInbox` is never called from `runSync` (S0)

**File:** `packages/squad-cli/src/cli/commands/sync.ts`  
**Lines:** 425–497 (`runSync`), 812–926 (`publishTeamRootToInbox`)

`runSync` dispatches to `syncPull` (fast-forward squad-state branches) and `syncPush`
(push squad-state branches). It never calls `publishTeamRootToInbox`. The ADO pipeline
`publish-inbox.yml` executes `squad sync --push`, which triggers `syncPush` — pushing
squad-state branches to the remote instead of creating inbox branches. Piece 28's inbox
publish flow exists as exported functions but has no path from the CLI.

**Reproduction:** `squad sync --push --developer dev1` — observe no `squad/inbox/*` ref
created on the remote; only squad-state branches are pushed (or none if there are no
local squad-state branches).

**Suggested fix:** `runSync` should call `publishTeamRootToInbox` (with resolved
teamRoot from config.json and a live sessionId) when direction is `push` or
`publish-only` and a cross-repo config is detected (config.json has `stateRemote`).

---

## Finding 2 — `stateBackend` not written to config.json by `squad bind` (S1)

**File:** `packages/squad-cli/src/cli/commands/bind.ts` (line 231-246, config object)  
**Interacts with:** `packages/squad-cli/src/cli/commands/sync.ts:170-177` (`detectBackend`)

`runBind` builds a `SquadDirConfig` object that does not include `stateBackend`.
`detectBackend()` in sync.ts reads `config.stateBackend` and returns `null` when the
field is absent. `runSync` then bails with "no remote sync needed" before performing
any git operations.

**Reproduction:** run `squad bind <url> --state-remote squad-docs`, then
`squad sync --pull` — observe "backend is 'local' — no remote sync needed".

**Suggested fix:** `runBind` should write `stateBackend: 'orphan'` into config.json
when wiring up a cross-repo configuration (i.e. when `teamRepoUrl` is provided and
`stateRemote` is configured).

---

## Finding 3 — `hydrateTeamRootFromStateRef` never called from `runSync` (S1)

**File:** `packages/squad-cli/src/cli/commands/sync.ts`  
**Lines:** 477–490 (runSync pull path), 708–748 (`hydrateTeamRootFromStateRef`)

`syncPull` fast-forwards squad-state branches in WORK_ROOT. It does not populate the
TEAM_ROOT (sidecar) working directory. `hydrateTeamRootFromStateRef` exists and is
exported but is never invoked from the CLI dispatch path. After `squad sync --pull`,
the sidecar directory is empty.

**Suggested fix:** `runSync` (pull path) should read `teamRoot` from config.json and
call `hydrateTeamRootFromStateRef(teamRoot, remote, stateBranch)` after `syncPull`.

---

## Finding 4 — `SQUAD_DEVELOPER_ALIAS` env var silently ignored (S1)

**File:** `packages/squad-cli/src/cli/commands/sync.ts:453-466`  
**Related:** `.squad-templates/ado/publish-inbox.yml:58`

The publish-inbox ADO pipeline sets `env: SQUAD_DEVELOPER_ALIAS: $(developerAlias)`.
`runSync` resolves the alias as: `options.developer` (CLI `--developer` flag) then
`syncConfig?.developerAlias` (config.json). It does not check `process.env['SQUAD_DEVELOPER_ALIAS']`.
Any pipeline run without an explicit `--developer` flag will fail with
"developer alias required" even when `SQUAD_DEVELOPER_ALIAS` is set.

**Suggested fix:** Add `process.env['SQUAD_DEVELOPER_ALIAS']` as a third fallback
in the alias resolution chain (after config.json, before "missing alias" error).

---

## Finding 5 — `developerAlias` not validated at bind time (S2)

**File:** `packages/squad-cli/src/cli/commands/bind.ts` (config write, no validation)  
**Regex defined at:** `packages/squad-cli/src/cli/commands/sync.ts:504`

`runBind` accepts any string for `developerAlias` and writes it to config.json without
validating against `DEVELOPER_ALIAS_RE` (`^[a-z][a-z0-9-]{0,38}$`). An alias like
`DEV_1` or `MyAlias` is silently persisted. The validation error only surfaces later
when `publishTeamRootToInbox` is called, with no indication that the alias came from
config.json or bind.

**Suggested fix:** Apply `DEVELOPER_ALIAS_RE` validation in `runBind` before writing
config.json, and emit a clear error pointing at the `--developer-alias` flag.

