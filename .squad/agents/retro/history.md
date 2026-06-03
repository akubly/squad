# RETRO

> Retrofire Officer

## Learnings

### 2026-06-02: Piece 30 Adversarial Security Review

**Agent:** RETRO  
**Task:** Security-focused adversarial review of piece 30 ADO templates (commit 10168051)  
**Verdict:** APPROVE-WITH-NITS  
**Severity counts:** Critical: 0 | High: 1 | Medium: 2 | Low: 4  
**Mandatory findings:** 3  

Identified 3 mandatory findings that block merge:
1. **M1 (High):** `bootstrap-cross-repo.ps1` echoes `$DocsRepoUrl` verbatim via `Write-Host` — PAT-embedded URL leak to pipeline/console logs; also exposed in ADO's command-line log when passed as argument to `pwsh -File`.
2. **M2 (Medium):** Missing `--` separator before `$DocsRepoUrl` in `git clone` — violates team convention from piece 14; git-argument injection vector for URLs beginning with `--`.
3. **M3 (Medium):** No URL scheme allowlist for `$DocsRepoUrl` — `file://` and arbitrary HTTPS origins accepted; `https://attacker.com/.git` blind-clone probe does NOT safe-fail.

Additional 4 non-blocking observations on branch-policy enforcement, scope comments, error output, documentation. Recommendation: add callout in all three docs warning against embedding credentials in `$DocsRepoUrl`.

Consolidated to REJECT verdict by Flight due to convergent mandatory findings across 5 reviewers.

### Early Pieces Summary (2026-03-22 through 2026-05-14)

**Pieces 01–03 Foundation:** Established core security model — registry validation, callsign character-set restrictions, symlink defense via `lstatSync`. All git invocations injection-free (`execFileSync` array args, no shell).

📌 **Team update (2026-06-02T19:27:39Z — Piece 28 Revision R2 Complete):** Your RETRO adversarial findings (validation ordering, atomic metadata write, fail-closed semantics) were fully addressed in CONTROL R2 commit aff12874. Flight gate approved; both guards confirmed live via independent mutation tests.

📌 **Team update (2026-06-02T21:16:49Z — Piece 29 Nit Revision Complete):** Piece 29 adversarial review security assessment approved. All 3 mandatory nits resolved in same-branch revision by Flight (SHA b7ff4f99). No new security surfaces introduced; attack-surface assessment confirmed SAFE-FAIL on all vectors. Pushed to origin. Ready for Phase C.

**Pieces 08–10 Lifecycle:** Hardened path validation. Piece 08b: added `path.isAbsolute()` and `..`-segment detection for `--home` and `--cwd`; env isolation. Piece 10: registry guards unified across all callsign sources (flag, env, default); symlink sentinel logic prevents redirect-escape. Result: fail-closed pattern established across init and assignment flows.

**Key hardening pattern:** Validation at resolver boundary + atomic file operations. Applied in 05bd332f (piece 02), revisions 1a47e601 (piece 14), ff55ecf7 (piece 08c), and piece 10 revisions.

**Piece 11b mirror-sync:** All scans CLEAN (PII, path, tone, record). Established template sync safety. Changeset and history entries professional.

### Piece 14 Adversarial Review — Security Findings Landed (2026-05-18)

📌 **RETRO security findings from piece 14 adversarial pass successfully addressed in revision.**

Initial review identified git subprocess shell-injection vector (S1): `_defaultCloneCommand` invoked git clone without `--` separator before URL, enabling git-argument-injection attack when URL starts with `--`. Revision commit 1a47e601 added `--` separator to all git subprocess calls (clone, fetch, checkout). All 3 minor hardening recommendations also addressed: registered callsign validated as absolute paths with `..`-segment detection; test env isolation completed. Branch ready for Phase C. Security decision merged: git subprocess `--` separator convention now team-wide standard.

**Cleared threat vectors:** Registry traversal, env-var trust boundary, symlink following, JSON injection, TOCTOU races — all non-exploitable from unprivileged inputs given current design. Validation at resolver boundary completes the security model begun in piece 01 registry validation.


### Piece 10 init fail-fast guard review (2026-05-15)

**Verdict:** APPROVE-WITH-FIXES (revised to APPROVE after CONTROL + Sims revision).

RETRO found two must-fix guard-correctness issues before upstream: registry conflict checks are skipped when the caller relies on `SQUAD_REGISTRY_PATH` or the default registry without `--callsign` / `--registry-path`, and `.squad` symlinks without sentinel files can redirect scaffold writes outside the target directory. Additional non-blocking concerns: no atomic guard for concurrent init, callsign validation is looser than resolver validation, and sentinel-only detection can miss partial scaffold directories.

📌 **Team update — Piece 10 Revision Complete (2026-05-15T23:15:56Z):** Per strict lockout protocol, EECOM locked out for this cycle. CONTROL + Sims assigned joint revision and delivered fix: CONTROL unified init validation routing through one path so registry from all sources (flag, env, default) receives same conflict checks; added lstat-based `.squad` symlink sentinel to prevent redirect-escape. All guards now execute before scaffold creation. Build CLEAN. 28/28 tests GREEN. Approved for Phase C.

### Piece 11b mirror-sync (2026-05-16)

**Verdict:** PASS

Commit ea655861 implements template sync for optional package-local `squad.agent.md` mirrors. All scans CLEAN (PII, paths, tone, record). Established template sync safety pattern. Changeset and history entries professional. Decision file proper format, clear consequences, no leaks.

### Scrub Gate Cleanup — Pre-Phase C (2026-05-19)

**Task:** Diagnose and fix Gate 1 (strip-listed paths) and Gate 2 (wifi-aware mentions) failures on `akubly/upstream-18-doctor-enhancements` before Phase C begins.

**FINDING — All violations baseline, zero in piece-18 diff:**

- **Gate 1 (131+ violations):** `docs/_internal/` (17 files from 482fd58d), product dirs `/casting/`, `/identity/` (15 files from df4fafe6), `.squad/` infrastructure (99+ files). **No Gate 1 violations from piece 18.**
- **Gate 2 (4 violations):** All trace to `.squad/reviews/piece-13-adversarial-review.md:160` false positive (grep command in diagnostic block). **No Gate 2 violations from piece 18.**

**Scrub gate boundary discovery:** The pattern `/identity/`, `/casting/`, `orchestration-log` matches Squad's own product directories (not just MS-internal content). The `.squad/` directory should be excluded from both Gate 1 (path scan) and Gate 2 (content scan), as these are team infrastructure files destined for team record-keeping, not upstream-destined code.

### Piece 27 Nit Revision Landed (2026-06-02T01:00Z)

📌 **Team update:** Flight (Lead) completed amendment commit `5d8509f4` on `squad/piece-27-explicit-sync-command`. RETRO H1 nit (whitespace-alias security finding from piece-27 adversarial review) fully resolved: `!alias` guard upgraded to `!alias || !alias.trim()` in `sync.ts`. Blocks empty, single-space, multi-space, tab, newline, control chars before any git invocation. 10 whitespace test cases added; sync-command 33/33 PASS. Recursion guard remains active in all 4 hook templates. Decision merged; branch push confirmed.

**Proposed remedies:** (A) Exclude `.squad/` from gates [recommended, low-risk]; (B) Rename `docs/_internal/` → `docs/design/` [medium-risk]; (C) Refine product directory pattern [requires coordinator decision].

**Status:** No source commits made. Diagnostic decision drop filed for coordinator action.

### Option A Applied — Scrub Gate .squad/ Exclusion (2026-05-19)

**Task:** Apply coordinator-selected Option A: exclude `.squad/` and `.squad-templates/` from Gate 1 and Gate 2.

**Changes made to `docs/proposals/upstream-bradygaster/_scrub-gate.ps1` on `akubly/upstream-specs` (commit `907d6026`):**

- **Gate 1:** Inserted `Where-Object { $_ -notmatch '^\.squad(-templates)?/' }` filter between `git ls-files` and `Select-String`. Pipes away all `.squad/` and `.squad-templates/` paths before the strip-list pattern match. Two-line surgical edit preserves full script structure.
- **Gate 2:** Added `':!.squad/'` and `':!.squad-templates/'` pathspec exclusions to the `git grep` invocation. Eliminates content scan of team infrastructure files.

**Verified against `akubly/upstream-18-doctor-enhancements` HEAD:**

- Gate 1: Reduced from 131+ violations to 31 (true baseline: 17 `docs/_internal/` files + 14 product template/source files). `.squad/` false-positives eliminated.
- Gate 2: PASS — all 4 prior violations cleared.
- Gates 3–6: Unchanged (WARN, WARN, PASS, PASS).

**Key lesson:** When a scrub gate pattern is broad enough to match team-internal infrastructure files that were never upstream-destined, the correct fix is a targeted exclusion at the gate — not a rename or content change. The `.squad/` directory is canonical team state, not upstream content.


---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

### Piece 27 Adversarial Review — Security Findings (2026-06-01)

**Verdict:** APPROVE-WITH-NITS (0 critical, 1 high, 4 medium/low)

**Key attack patterns probed and resolved:**

**Injection surface — CLOSED:** All git subprocess calls in `sync.ts` use `execFileSync` with array argument forms (`['git', 'config', '--add', key, value]`). No shell-string `exec` anywhere in the diff. This closes shell metacharacter and flag injection across all paths.

**`--remote` flag injection — BLOCKED:** `ensureStateRemote()` validates remoteName via `remotes.includes(remoteName)` against the `listRemotes()` output before any git call that uses the name. Probes like `--remote "--upload-pack=evil"` and `--remote "-c core.sshCommand=evil"` exit 1 at the includes check, never reaching a git invocation. The `--` separator question does not apply here because the remote name is embedded in a config key string (not a positional argument), and the key is passed as a single array element.

**Config-driven hook attack — NEUTRALIZED:** Hook templates assign `STATE_REMOTE` via `grep | tr -d '"'` then use `"$REMOTE"` (double-quoted) throughout all fetch invocations. Command substitution in `stateRemote` values cannot be re-executed once the variable is assigned. Refspec concatenation uses `'literal/'"$VAR"'/literal'` form — single-quote fragments bracket the variable, and double quotes prevent word splitting. No injection path exists through a hostile `stateRemote` in `.squad/config.json`.

**H1 finding — whitespace alias bypass:** `if (!alias)` does not catch `alias = " "`. `" ".trim()` is `""` (falsy). Fix is `if (!alias || !alias.trim())`. The alias is currently unused in git ops (no inbox refspecs yet), so this is not presently exploitable — but the spec contract requires rejection and later pieces will interpolate the alias into refspecs.

**Refspec force-update (`+`) — intentional and correctly scoped:** The `+` prefix in fetch refspecs only force-updates remote-tracking refs (`refs/remotes/`), not local branches. Local branch updates in `syncPull()` require `merge-base --is-ancestor` confirmation before `git update-ref`. Push has no `+`.

**Recursion guard — correct:** `SQUAD_SYNC_ACTIVE` present in all 4 hook templates and `runSync()`. Unset in `finally` block. Environment-scoped only (not file-persisted), so no cross-session leak.

**Privilege boundary — clean:** No `git config --global` anywhere. All config operations are repo-local.

**Pattern to carry forward:** When a remote name or alias will later be interpolated into a git refspec, add a charset allowlist at the validation boundary BEFORE the feature that uses it lands. Piece 27 validates presence only; piece 28+ inbox refspecs will need `[a-z][a-z0-9-]{0,38}` enforcement at the alias guard site in `runSync()`.

### Piece 29 Adversarial Review (2026-06-02)

**Verdict:** APPROVE-WITH-NITS (0 critical, 0 high, 2 medium, 2 low)

- Template-only changes that add spawn-contract variables do NOT introduce shell-injection risk because agent platforms consume prompt text as structured data, not shell scripts. Platform-level absolute-path enforcement on file tools is a defence layer beyond prompt guidance.
- Prompt-only write guards (WORK_SQUAD_DIR rule 3) are the current architectural norm. Flag for hook-based enforcement in a future governance piece, but do not block template changes that use the existing model.
- DEVELOPER_ALIAS charset validation at the CLI boundary (`[a-z][a-z0-9-]{0,38}$`) is the definitive injection defence for the alias surface. Confirm it remains intact when reviewing any piece that threads the alias into new contexts.
- Scribe orphan-push uses hardcoded `origin` — verify this remains true if STATE_REMOTE is ever generalized to Scribe's git operations.

### Piece 30 Adversarial Review — Security Findings (2026-06-02)

**Verdict:** APPROVE-WITH-NITS (0 critical, 1 high, 2 medium mandatory, 4 low/medium non-blocking)

**Key attack patterns probed:**

**M1 — Write-Host echoes DocsRepoUrl (HIGH, MANDATORY):** `bootstrap-cross-repo.ps1` line 108 echoes `$DocsRepoUrl` verbatim in a `Write-Host` message. PAT-embedded URLs (`https://user:PAT@dev.azure.com/...`) would appear in pipeline/console logs. Also compounded by `publish-inbox.yml` passing `$(docsRepoUrl)` as a command-line arg to `pwsh -File` — ADO logs all command arguments. Fix: remove URL from all `Write-Host` calls; add a parameter-block warning never to embed credentials.

**M2 — Missing `--` separator before DocsRepoUrl in git clone (MEDIUM, MANDATORY):** `git clone "$DocsRepoUrl" "$TeamRoot"` violates the team's piece-14 convention (RETRO history 2026-05-18). A URL beginning with `--` would be parsed as a git option flag. Fix: `git clone -- "$DocsRepoUrl" "$TeamRoot"`.

**M3 — No URL scheme validation (MEDIUM, MANDATORY):** `$DocsRepoUrl` accepts any scheme including `file://`. The `https://attacker.com/.git` probe does NOT safe-fail — git blindly clones. Fix: add a scheme allowlist (`https?://`, `git\+ssh://`, `ssh://`, `git@`) and reject `file://` before any clone.

**SYSTEM_ACCESSTOKEN scoping — CORRECT:** Token injected via `env:` on the fast-forward step only. No pool-level `allowScripts`. The SYSTEM_ACCESSTOKEN scope is correctly implemented per spec. `persistCredentials: true` is job-wide (required for git push) — the inline comment claiming step-scoped OAuth is misleading but not exploitable.

**Alias validation — CORRECT and inherited:** `'^[a-z][a-z0-9-]{0,38}$'` validated before any write. All hostile alias probes (`;rm -rf /`, `../../etc/passwd`) safe-fail at the guard. Charset validation consistent with piece-27 pattern.

**Pipeline trust boundary:** Fold pipeline fetches and folds all inbox branches without content validation. Trust is implicit — any developer with docs repo push access is trusted. Not a bug (by design) but a future governance surface. Sole-writer invariant is documented but enforced by branch-policy recommendation only; no CI gate verifies the policy is set.

**Portable lesson:** In any script or pipeline that accepts a repo URL as a parameter, (a) never echo the URL to console, (b) add a `--` separator before all URL-position git args, (c) validate URL scheme before cloning. Applies to any future bootstrap or pipeline template in the stack.
