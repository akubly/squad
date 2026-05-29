# FIDO

> Flight Dynamics Officer

## Core Context

Quality gate authority for all PRs. Test assertion arrays (EXPECTED_GUIDES, EXPECTED_FEATURES, EXPECTED_SCENARIOS, etc.) MUST stay in sync with files on disk. When reviewing PRs with CI failures, always check if dev branch has the same failures — don't block PRs for pre-existing issues. 3,931 tests passing, 149 test files, ~89s runtime.

## Current Session — Piece 34 Review Cycle (2026-06-06)

### Piece 34 Adversarial Review & A3 Test Standard

**Initial Review (Commit `b0045b27`):**
- A3 recursion-guard test asserts exit 0 but does not prove guard fired
- Test is not load-bearing; would pass if guard removed
- Verdict: REJECT until test corrected

**Reviewer-Rejection Lockout:**
- EECOM locked out; FIDO required to revise (owns test-standard)
- Implemented sh-function sentinel + marker-file approach
- Three-case structure with load-bearing guard-absent case (Case 3)
- Re-verification: APPROVE

**Binding Standard (for all future hook tests):**

> Any test claiming to verify a recursion guard MUST detect whether the guarded command was invoked, not merely whether the script exited 0.

Acceptable approaches:
1. Sentinel binary on PATH with exit code / marker file
2. Marker file approach
3. Stderr check (if guard path produces no stderr)

**Outcome:** FIDO owns this standard. All future recursion-guard test assertions must pass FIDO's invocation-detection check.

## Key Patterns

- Test suite timeout/contention produces 10–20× apparent regressions vs real failure count — always spot-check in isolation
- Observable-behavior regression guards (e.g., absence of refs on remote) provide protection but are mode-fragile vs spy-based NOT-called assertions
- Full idempotency checks comparing HEAD to orphan SHA are structurally broken unless HEAD is explicitly updated
- sessionId flows into git ref names — must validate for git-ref legality, not just alias/branch-name fields

## Archive

Older reviews (pieces 04–33) documented in `history-archive.md`.

Consequence: if the `if [ -z "$SQUAD_SYNC_ACTIVE" ]; then ... fi` guard were removed, the test assertion `expect(result.status).toBe(0)` would STILL PASS — `squad sync` would be called (and possibly fail), `unset` would run, script exits 0. The kill-list criterion requires "a test that would fail if the guard were removed." This test would not fail. The test is effectively a more expensive version of the template-grep pattern (A2 already checks the guard string is present).

A compliant A3 must detect INVOCATION of `squad sync`, not just exit code. Options: (a) write a sentinel `squad` script to a temp dir on PATH that exits non-zero, assert the hook exits non-zero without the guard; (b) write a sentinel `squad` script that creates a marker file, assert the marker does NOT exist after running with `SQUAD_SYNC_ACTIVE=1`; (c) assert the process's stderr is empty (no "squad: command not found" or squad output).

---

**A3 REVISION (FIDO owns this fix; reviewer-rejection lockout applies to EECOM)**

Applied fix in working tree (uncommitted). Design:

- **Approach:** sh function preamble. Define `squad() { printf "" > "$MARKER"; }` before the hook body. A sh function shadows any PATH entry, so `squad sync --push --quiet` always invokes our function. No PATH manipulation, no file-permission issues — identical behavior on Windows (MSYS2 sh.exe) and Unix.
- **Why not PATH injection:** git's sh.exe (MSYS2) does not ship `touch` on PATH. PATH-based sentinels require `chmod +x` which is a no-op on Windows NTFS from Node.js. Function preamble is unambiguous.
- **Three cases:**
  1. Guard active (`SQUAD_SYNC_ACTIVE=1`) → marker ABSENT ✓ (guard fires, if-block skipped)
  2. Guard inactive (unset) → marker PRESENT ✓ (if-block runs, `squad` function invoked)
  3. Guard-removal proof: strip `if [...]` and `fi` from a local copy of the hook body; run with `SQUAD_SYNC_ACTIVE=1`; assert marker PRESENT ✓ (proves Case 1 would FAIL if guard removed)

**Results after fix:** `install-hooks.test.ts` — 6/6 PASS (A1–A6), 1 SKIP (B). All assertions GREEN.

---

**NON-BLOCKING GAP — Single-repo push path has no piece-34 regression test**

The `writeLastPublish(repoRoot)` call is inserted after `syncPush()` on the single-repo path. Risk is extremely low (`writeLastPublish` is try-catch wrapped and cannot throw), but no new test exercises the single-repo push path under piece-34. Pre-existing `cross-repo-sync.test.ts` B2 exercises the single-repo fallback but was written before `writeLastPublish` was added. Not a blocker given the non-throwing best-effort nature of `writeLastPublish`, but coverage is incomplete per FIDO scope item 5.

---

**Kill-list items assessed:**

| Kill-list constraint | Test | Status |
|---|---|---|
| Docs-repo clone ONLY; no CWD fallback | A1 (installs in docsRepo not productRepo) | ✅ |
| Recursion guard exercised behaviorally | A3 (sentinel function; invocation-detection; guard-removal proof) | ✅ (after fix) |
| Error (not warning) on non-git path | A4 (expects throw matching /not a git repository/i) | ✅ |
| Idempotent: marker appears exactly once | A5 (marker count = 1 after two calls) | ✅ |
| No hook from ensureHooksForBackend | A6 (calls ensureHooksForBackend; asserts no post-commit) | ✅ |
| B determination documented before commit | it.skip stub + decisions/inbox/piece-34-B-deferred.md | ✅ |
| --dry-run does NOT call publishTeamRootToInbox | C1 (spy asserts not.toHaveBeenCalled) | ✅ |
| squad sync status: all six fields | C2 (regex match for each field label + values) | ✅ |
| .last-publish read when present / "never" when absent | C3, C4 | ✅ |
| --quiet suppresses stdout, errors reach stderr | C6 (logSpy and publishSpy asserted) | ✅ |
| assign with developerAlias triggers hook install | P34.A1 | ✅ |
| assign gracefully degrades when hook throws | P34.A2 (warning in result.warnings) | ✅ |
| Registry-first topology preserved | All registry mock tests pass; config.json not primary | ✅ |

---

**Conditional APPROVE:** Fix must be folded into the product commit (`b0045b27`) before the branch is pushed. No other changes needed.

---

**Patterns learned:**

- **Exit-0 guard tests fail when the last shell command is a cleanup step.** When a hook template ends with `unset VARIABLE`, any intermediate command failure is masked. A behavioral guard test must detect invocation, not just exit code. Pattern to watch: any `unset`/`trap`/`exec` at the end of a hook template neutralizes exit-code-based guard assertions.
- **Recursion guard tests need a sentinel function or a failing-binary, not just exit-code.** Define `squad() { ... }` before the hook body to intercept invocations — sh functions shadow PATH entries, works on all platforms.
- **git's sh.exe (MSYS2) does not ship `touch` on PATH.** Use `printf "" > file` or `> file` (empty redirect) for cross-platform file creation in sh tests. Do not assume POSIX utilities beyond what git-bash guarantees.
- **Full-suite worker-timeout count fluctuates** but is always pre-existing IPC noise; isolated runs are the reliable signal.

---

## Piece 35 Review — Fold Pipeline in Docs Repo (2026-06-07)

**SHA reviewed:** `64eecd475605a8f9cc1d6f9707d6ae72f055d59a`  
**Branch:** `squad/piece-35-fold-pipeline-in-docs-repo`  
**Verdict:** **APPROVE**

### What passed

| Check | Result |
|---|---|
| (a) `pull_request`/`pr` absence — parsed YAML in both template tests | ✅ PASS — `not.toHaveProperty` on parsed object, not raw grep |
| (b) Single-writer invariant comment — exact verbatim string in both tests | ✅ PASS — raw.toContain appropriate (comments stripped by YAML parser) |
| (c) Installer: github→.github/workflows/, ado→.azure-pipelines/, idempotent, conflict→exit 1+path, missing dir→exit 1 | ✅ PASS — D1–D6 all GREEN |
| (d) Registry-first D7: entry.path ends in .squad; docsRepoPath = path.dirname; config.json wrong-path not used | ✅ PASS — adversarially strong (writes wrong path, proves it's not used) |
| (e) Piece-34 regression guard: install-hooks + sync-command | ✅ PASS — 12 GREEN, 1 pre-existing SKIP, zero new failures |
| (f) New test files 27/27 | ✅ PASS |
| (g) --force-with-lease in both templates + tests; permissions.contents=write parsed; no allowScripts at pool | ✅ PASS — permissions/allowScripts are REAL parsed-object assertions |

### Adversarial findings — no blockers

**Registry field name:** kickoff brief example used `registry?.entries.find(...)` but actual `Registry` type (registry.ts line 27) has `squads: RegistryEntry[]`. Implementation correctly uses `registry?.squads.find(...)`. Tests match. Not a defect — brief example was stale.

**`--force-with-lease` raw check:** `raw.toContain('--force-with-lease')` could be fooled by a comment-only occurrence. Actual templates have the flag in the push command, not a comment. Acceptable: bash script content is a YAML string; parsed-object assertion is not meaningful here.

**Idempotency key: ref-name vs SHA:** Spec step 3 says "skip refs whose SHA appears as `foldedRefs[].sha`". Templates use `.[].foldedRefs[].ref` (ref-name membership) instead. This is the **correct** approach per the ref-membership-fold-idempotency skill (immune to clock skew, immune to same-second ties). Deviation from spec wording is a deliberate improvement consistent with team canon.

**Non-blocking gap (same as piece 34):** No pipeline-execution-level test for fold bash logic (clock skew, malformed JSON abort, prune step). Template tests are structural only. Not a blocker for merge — bash execution testing would require a real git environment and is out of scope for unit test suite.

### Learnings

- **Raw string assertions for YAML comments are correct:** YAML `parse()` strips comments from the parsed object. `raw.toContain(...)` is the only valid assertion for comment presence. Don't downgrade these to "weak."
- **`Registry.squads` is the array field name** (not `entries`). The kickoff brief example used `entries` — that was an error in the brief. Always verify against `packages/squad-sdk/src/registry.ts` interface.
- **Registry-first adversarial test pattern proven:** D7 pre-writes a wrong `stateLocation` in config.json, then verifies the registry-derived path is used and the config.json path is NOT. This is the gold-standard pattern for registry-first regression tests. Carry forward.
- **`process.exit` spy pattern for CLI commands:** `vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error(...) })` is the correct pattern for testing CLI exit codes without actually terminating the test process. EECOM applied it correctly in D3/D4/D6.

---

## Piece 40 Adversarial Review — Callsign-namespaced transport (2026-06-11)

**Branch:** `squad/piece-40-callsign-namespaced-transport`  
**Base commit:** `ff86b81c` (piece-39 tip; all piece-40 changes are uncommitted working-tree)  
**Verdict:** **CONDITIONAL APPROVE — one non-blocking advisory for Flight**

### Build & Test Results

| Check | Result |
|---|---|
| `npm run build` | ✅ PASS (exit 0) |
| Piece-40 test file (22 EECOM + 5 FIDO edge) | ✅ 27/27 PASS |
| cross-repo-sync.test.ts B1/B3 (updated) | ✅ 16/16 PASS |
| test/cli/assign.test.ts P34.A1/P34.A3 | ❌ 2 FAIL — **confirmed pre-existing on clean piece-39 base** |
| Full suite worker-timeout pattern | ⚠️ Pre-existing IPC contention; all files pass in isolation |

### P34.A1/P34.A3 Pre-existing Verdict

Definitive: `git stash` to clean piece-39 HEAD (`ff86b81c`), ran `vitest run test/cli/assign.test.ts` — same 2 failures, same test names, 0 piece-40 files involved. Piece-40 did NOT introduce these failures.

### Scrub Gate

- **Gate 1 FAIL:** 32 strip-listed paths — **identical to baseline (32)**. Zero new paths introduced.
- **Gate 2 PASS:** No wifi.aware mentions. Unchanged.
- **Gate 3 WARN:** akubly refs in .squad/ state files — pre-existing, Scribe responsibility.
- **Gate 4 WARN:** Possible internal refs — pre-existing pattern (squad's own product dirs).
- **Gate 6:** PASS (22 files) — *improved* from baseline WARN.
- All other gates: PASS or SKIP (unchanged from baseline).

### Changeset / SDK Scope Finding (for Flight)

`INBOX_HANDLE_RE` is defined in `packages/squad-sdk/src/validation.ts` (confirmed). EECOM added `CALLSIGN_RE` to the same file — placement is consistent. The repository policy (CONTRIBUTING.md + `squad-ci.yml` `changelog-gate` step) requires a changeset entry when `packages/squad-sdk/src/` is modified. The current changeset (`callsign-namespaced-transport.md`) declares only `@bradygaster/squad-cli: patch`. **An `@bradygaster/squad-sdk: patch` entry is also required by policy.** FIDO reports the gap; Flight rules on whether to add it or apply `skip-changelog`.

### FIDO Edge Tests Added (5)

| Test | What it covers |
|---|---|
| FIDO-E1 | `publishTeamRootToInbox` rejects `/` in callsign, digit-start, single-char (distinct from A3's UPPERCASE/leading-dash/40-char) |
| FIDO-E2 | `installFoldPipeline` rejects same classes; no file written (distinct from C7's uppercase-only) |
| FIDO-E3 | GitHub `--callsign team-b` (different hyphenated name) injects correctly into BOTH trigger and target in one test |
| FIDO-E4 | ADO `--callsign team-b` injects correctly into BOTH trigger and target in one test |
| FIDO-E5 | `publish-metadata.json` callsign round-trips byte-for-byte (using `team-b`; confirms no normalisation side-effect) |

All 27 tests in the piece-40 file pass.

### Learnings

- **Full-suite IPC timeout pattern persists** (piece-32 observation confirmed again). Parallel git-operation-heavy tests cause `vitest-worker Timeout calling "onTaskUpdate"` — 200+ apparent failures reduce to zero genuine failures when files run in isolation. Standard spot-check procedure applies.
- **CALLSIGN_RE and INBOX_HANDLE_RE are byte-identical** — placing CALLSIGN_RE in `validation.ts` alongside INBOX_HANDLE_RE is the correct canonical location. However, modifying `squad-sdk/src/` requires a matching SDK changeset entry per repo policy.
- **Empty string callsign is a special case**: the implementation treats it as "no callsign" (falls back to 2-component branch), NOT as an invalid callsign. This is intentional per A5. Don't add empty-string to the "Invalid callsign" assertion list; it tests separately under A5.
- **Worker timeout count fluctuates across runs** but is always noise. Reported full-suite as 214 failed / 36 files, isolated runs all green — confirms piece-40 introduced zero regressions.



---

## Learnings — Piece 40 Adversarial Re-Review (2026-06-12)

**Commit reviewed:** `b64bef25` (diff base `ff86b81c`)  
**Verdict:** **BLOCK** on two findings: one HIGH (spec-mandated behavior absent in `assign.ts`) and one HIGH (fold template orphan case not parameterized — first-run pipeline uses wrong local branch name)

### Finding 1 — HIGH — `squad assign --callsign` does NOT set `stateBranch` default

**Location:** `assign.ts:570`, `assign.ts:830`  
**Defect:** `init.ts` was correctly updated (line 197) to write `stateBranch: "squad/state/<callsign>"` when `--callsign` is provided. `assign.ts` uses a pure additive-merge pattern (`...(opts.stateBranch !== undefined ? {stateBranch} : {})`) and does NOT auto-default `stateBranch` when a callsign is present.  
**Spec citation:** Sub-proposal B hard constraint: "When `squad init --callsign <name>` (or `squad assign`) sets up a new entry, the default `stateBranch` written to the registry entry should be `squad/state/<callsign>`."  
**Repro:** `squad assign myteam --callsign myteam` (no `--state-branch`) → registry entry has no `stateBranch` → `runSync --pull` falls back to `squad-state` fallback, pulling from wrong branch.  
**No test covers this path.** There is zero coverage for "squad assign + callsign → stateBranch defaulted."

### Finding 2 — MEDIUM — Fold template orphan case: `git checkout --orphan squad-state` not replaced

**Location:** `templates/fold/github/fold-squad-state.yml:115`, `templates/fold/ado/fold-squad-state.yml:115`  
**Defect:** The six regex substitutions in `install-fold-pipeline.ts:144-161` match `refs/heads/squad-state` (with prefix) and full-command forms, but NOT the bare `squad-state` in `git checkout --orphan squad-state`. The orphan case fires on first pipeline run when no state branch exists yet. The ephemeral runner creates a local branch named `squad-state` instead of `squad/state/<callsign>`. The push target IS correctly parameterized (`HEAD:refs/heads/squad/state/<callsign>`) so the remote branch name is correct — the defect is cosmetic on ephemeral runners and doesn't cause data corruption.  
**Repro:** `install-fold-pipeline --callsign team-a` then grep generated YAML for `checkout --orphan` — still shows `squad-state`.  
**No test asserts the orphan line is replaced.** C2/C4 check that `squad/state/team-a` is present but don't assert `--orphan squad-state` is absent.

### Finding 3 — MEDIUM — C5/C6 "byte-identical" backward-compat tests are substring checks only

**Location:** `piece-40-callsign-transport.test.ts:573-576`, `:595-597`  
**Gap:** Spec requires no-callsign output to be "verbatim" / "unchanged." Tests only check 2 substrings present. The code (`templateContent = rawTemplate`) guarantees identity, but no test does `expect(installed).toBe(rawTemplate)`. A future refactor introducing `.trim()` or CRLF normalization would silently pass.

### Finding 4 — MEDIUM — INT1 integration test lacks cross-contamination (negative) assertion

**Location:** `piece-40-callsign-transport.test.ts:849-907`  
**Gap:** INT1 verifies each squad creates refs under its own namespace and metadata matches. It does NOT assert Squad A's pull cannot observe Squad B's state refs. The hydrateTeamRootFromStateRef is mocked — no actual content isolation is verified. Happy-path test only.

### Finding 5 — LOW — `--dry-run` output shows old 2-component branch format in cross-repo mode

**Location:** `sync.ts:816`  
**Defect:** `console.log("Target inbox branch: squad/inbox/${effectiveAlias}/<timestamp>-<sessionId>")` omits the callsign segment. Cross-repo dry-run shows misleading branch format.

### Finding 6 — LOW — CALLSIGN_RE duplicates INBOX_HANDLE_RE without enforcement coupling

**Location:** `validation.ts:15-17`  
**Risk:** Two identical regex constants; a change to one won't propagate to the other. Fragile long-term.

### Finding 7 — CONFIRMED PRE-EXISTING — P34.A1/A3 failures not worsened by piece-40

`assign.ts` was NOT touched in this diff (confirmed: `git log ff86b81c..b64bef25 -- assign.ts` returns empty). P34.A1/A3 fail because `installCrossRepoHook` is called with unexpected count — a pre-piece-40 issue. Piece-40 cannot have introduced or worsened these.

### Test-discipline verdict on cross-repo-sync B1/B3 modifications

Adding `callsign: 'docs-squad'` and `callsign: 'dev-squad'` to registry entries in B1 and B3 is **CORRECT** — these tests exercise cross-repo push, which now requires a callsign per the new fatal guard. The tests still validate what they originally validated (cross-repo inbox ref created with correct session ID). A4 independently tests the "no callsign → fatal error" path. No regression suppression.

### Key new learnings

- **Regex replacement chains must enumerate ALL surface forms.** `refs/heads/squad-state` (with prefix) and `git fetch origin squad-state` (without prefix) are both present in templates. The orphan case `git checkout --orphan squad-state` is a third form — no prefix, no context command — that escaped all 6 substitutions. Pattern: when parameterizing YAML by string-replace, grep the raw template for ALL occurrences of the target string first and enumerate replacement patterns to cover each.
- **Spec "or assign" language requires verification of BOTH paths.** When a spec says "init (or assign)", check BOTH code paths. init.ts getting the change while assign.ts is silently skipped is the most common spec-compliance gap pattern in iterative feature work.
- **Substring backward-compat tests are insufficient for "verbatim/unchanged" contracts.** The correct assertion is `expect(installed).toBe(rawTemplateContent)` where rawTemplateContent is read from the actual template file. Checking 2 patterns are present only proves those 2 patterns — not that nothing else changed.
- **Integration isolation tests need negative assertions.** Verifying Squad A creates refs under `team-a/` is necessary but not sufficient. The isolation claim requires `expect(refsA.some(r => r.includes('team-b'))).toBe(false)` — a negative cross-contamination check.

---

## Piece 40 Re-review — CONTROL's Revision Pass (2026-06-12)

**Working-tree state:** CONTROL fixes applied, NOT yet committed. Prior BLOCK commit: `b64bef25`.

### H1 — install-fold-pipeline.ts callsign block (lines 143–174) ✓ RESOLVED

Both platforms now add two new replacement passes before the broad `/squad-state/g`:

- **GitHub:** `.replace(/'\+refs\/heads\/squad\/inbox\/\*\*:refs\/remotes\/origin\/squad\/inbox\/\*\*'/g, ...)` scopes the enumeration fetch refspec; `.replace(/'refs\/heads\/squad\/inbox\/\*'/g, ...)` scopes the ls-remote pattern.
- **ADO:** Matching replacements for `*` (single-level) glob variant.
- **Broad sweep:** `.replace(/squad-state/g, \`squad/state/${callsign}\`)` replaces ALL remaining tokens — commands, step names, comments, refs — including the previously-missed `git checkout --orphan squad-state` (M4).
- **Safety confirmed:** `fold-squad-state` does NOT appear anywhere in either template's YAML body, so the broad `/squad-state/g` cannot produce a corrupt `fold-squad/state/...` string.
- **No-callsign path unchanged:** `templateContent = rawTemplate` verbatim (byte-identical). ✓

### H2 — assign.ts cold-start stateBranch defaulting (line 842–846) ✓ RESOLVED

- `CALLSIGN_RE` imported at module level (line 28).
- Invalid callsign rejected at line 726 before any clone or registry write (`ERR_ASSIGN_MISSING_ARG`).
- New-entry default: `!reactivating ? { stateBranch: \`squad/state/${callsign}\` } : {}` — defaults only for genuinely new entries.
- Reactivating entries: `reactivating = true` → conditional spreads `{}` → existing `stateBranch` preserved via `...baseEntry` spread.
- Explicit `--state-branch` wins: `opts.stateBranch !== undefined` check takes precedence over default.
- P32.B4 (cold-start reactivation flag preservation): still PASSES — no regression. ✓
- **Note:** Warm path (lines 562–572, adding a clone to an existing entry) still doesn't auto-default stateBranch. Spec language says "sets up a new entry" — warm path is not creating a new entry. Accepted as per spec intent.

### M3 — init.ts callsign validation ✓ RESOLVED

- `CALLSIGN_RE` imported (line 23), guard at line 100 throws `ERR_SQUAD_INIT_INVALID_CALLSIGN` before any filesystem or registry write.
- Test M3: validates `['Bad/Name', 'UPPER', '-bad', '1squad', 'a']`; asserts `writeRegistry` not called. ✓

### M4 — Orphan branch parameterization ✓ RESOLVED (via broad replace in H1)

- `git checkout --orphan squad-state` → `git checkout --orphan squad/state/<callsign>` by broad `/squad-state/g`. ✓
- C8 asserts `ghContent.not.toContain('squad-state')` (total absence) and `.toContain('git checkout --orphan squad/state/team-b')`. ✓

### M5 — C5/C6 byte-identical assertions ✓ RESOLVED

- C5: `expect(installed).toBe(fs.readFileSync(templatePath, 'utf-8'))` — actual byte-equality against raw template. ✓
- C6: same for ADO. ✓
- `TEMPLATES_ROOT` in test (`process.cwd()/packages/squad-cli/templates/fold`) resolves to same directory as `install-fold-pipeline.ts`'s `TEMPLATES_ROOT` (`__dirname/../../../templates/fold`). ✓
- New C8: proves callsign-set output has zero bare `squad-state` tokens and zero global inbox glob on both platforms. ✓

### M6 — INT1 cross-contamination negative assertion ✓ RESOLVED

- Lines 1063–1065: `expect(refsA.some(r => r.includes('team-b'))).toBe(false)` and `expect(refsB.some(r => r.includes('team-a'))).toBe(false)`. ✓

### LOW — dry-run callsign in branch preview ✓ RESOLVED

- `sync.ts:816`: `const callsignPrefix = registryCallsign ? \`${registryCallsign}/\` : ''` prepended to inbox branch display string. ✓

### Test Results

| File | Result |
|---|---|
| `piece-40-callsign-transport.test.ts` | ✅ All pass (now 34 tests: 27 original + M3 + H2-1..H2-4 + C8) |
| `cross-repo-sync.test.ts` | ✅ 16/16 pass |
| `assign.test.ts` | ❌ 2 FAIL — P34.A1/A3 (pre-existing, unchanged from baseline) |
| `init.test.ts` | ✅ All pass |
| `init-v2.test.ts` | ✅ All pass |
| Full suite | ⚠️ 43 files reported failed — all pre-existing IPC worker-timeout contention; isolated runs all green |

### Scrub Gate

- Gate 1: 32 strip-listed paths — **identical to baseline**, zero new paths introduced. ✓
- Gate 2: PASS (no wifi-aware mentions). ✓
- Gate 3/4: WARN — pre-existing .squad/ state file references, Scribe responsibility. ✓
- Gate 6: PASS (18 files changed). ✓

### Learnings from Re-review

- **Broad `/squad-state/g` is the correct architecture** for a template parameterization that has many surface forms of the same token. Six fragmented regexes with coverage gaps are strictly worse than one comprehensive regex applied inside an `if (callsign)` guard with a verbatim no-callsign path. The only precondition is confirming the output file name (`fold-squad-state`) does not appear inside the template content — grep the template first, then apply the broad replace.
- **Confirming "fold-squad-state" absence from template body is the critical safety check** for the broad replace approach. If the pipeline YAML ever self-referenced its own filename, the broad replace would corrupt it. Add to review checklist.
- **H2 warm-path clarification**: Spec language "sets up a new entry" correctly scopes the stateBranch default to cold-start (new entries) only. Warm path (adding a clone to existing entry) deliberately preserves what the entry already has. Don't conflate "assigns a clone" with "creates a registry entry."
- **TEMPLATES_ROOT path equivalence test pattern**: When a test asserts byte-identity between installed output and a source template, verify that the test's hardcoded template path (`process.cwd()/...`) resolves to the same file as the production code's `__dirname`-relative path. A path mismatch would make C5/C6 compare against the wrong file and silently pass even when the template was wrong.

### Verdict: PASS

All prior BLOCK findings (H1, H2) and MEDIUM findings (M3–M6) are resolved. No new defects introduced. P34.A1/A3 pre-exist and are unchanged. Scrub baseline unchanged.

---

FIDO reviewed six pieces (24, 25, 32, 32-nits, 32-verify, 32.5) across May–June 2026. Key review patterns:

### Piece Outcomes
- **P24 (SDK Adapter):** APPROVE-WITH-NITS (three mandatory on testing/arity, one undisclosed return-type)
- **P25 (Resolver Rename):** APPROVE-WITH-NITS (dependency-mode control discovery; no blockers)
- **P32 (Registry State):** APPROVE-WITH-NITS (22 apparent test regressions = timeout contention, zero real failures)
- **P32 Nit-fix:** APPROVE (all nits verified; 27/27 GREEN)
- **P32.5 (Transport Helpers):** APPROVE (findings documented; implementation sound; 10/10 GREEN)

### Critical Learnings
- **Dependency-mode control required:** Clean npm install creates nested stale SDK; workspace-linked mode controls skew
- **Timeout contention cascades:** Full-suite runs produce 10–20× apparent regression count vs isolation; always spot-check before blocker
- **idempotency via orphan-SHA comparison is broken:** HEAD and snapshot commit SHAs can never match; three fix options documented
- **sessionId must validate for git-ref legality:** Caller strings flowing into ref names need pre-flight validation
- **Verify code presence before reviewing:** "not a function" errors indicate missing exports, not test logic issues

### Non-Blocking Patterns (All Pieces)
- Type-union return-type removals require explicit sign-off
- Multi-overload functions need 3+ tests per path for arity coverage
- Guard-order tests must simulate downstream behavior, not identity mock
- Test isolation needs pinned env vars across all test cases

Full details in entries above (Piece 32.5 entry contains adversarial findings re: idempotency, sessionId, PII-test robustness, boundary testing).
- 2026-05-28: Piece-25 adversarial review (commit e67e0959) — APPROVE-WITH-NITS, no blockers, 4 non-blocking nits.
- 2026-05-28: Piece-25 revision (commit 185617e) — EECOM folded all approved nits (N1+N2+N3); gates clean.

📌 **Team update (2026-05-28 — Scope Scrub & Version Parser Fix):** EECOM completed rescope across 179 files (stale @bradygaster → @wifi-aware). Bonus fix: resolved version parser bug blocking 0.9.6-mc.preview.NN builds. Pattern: `applyVersionStamp` regex needed widening to handle preview suffix chains. Commits: 1823d761 (fix regex), abaad5d1 (rescope+changeset), 23fa339d (docs). Classification heuristic learned: when rescoping references across test fixtures and CLI args, prioritize test contracts first (mocks lock expectations), then internal wire, then surface docs. Flagged two items pending Brady review: Watch Mode refs in squad.agent.md, upgradeSDK mock origin in cli.test.ts (pre-existing from 8600b1a4).
