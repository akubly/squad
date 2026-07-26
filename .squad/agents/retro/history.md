# RETRO

> Retrofire Officer

## Learnings

### Early Pieces Summary (2026-03-22 through 2026-05-14)

**Pieces 01–03 Foundation:** Established core security model — registry validation, callsign character-set restrictions, symlink defense via `lstatSync`. All git invocations injection-free (`execFileSync` array args, no shell).

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
