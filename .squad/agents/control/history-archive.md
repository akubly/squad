# CONTROL History Archive

> Summarized entries (2026-03-22 through 2026-05-13) archived to keep active history under 15KB.

## 2026-03-22: Issue Triage Assignment (2026-03-22T06:44:01Z)

**Summary:** Flight completed triage of 6 unlabeled issues. CONTROL assigned StorageProvider PRD (#481, with EECOM). Identified state abstraction gap as critical for type system design.

---

## 2026-05-10: Model Registry Architecture Learnings

**Summary:** Documented model registry single sources of truth:
- `MODELS` constant in `runtime/constants.ts` (default names, fallback chains)
- `MODEL_CATALOG` in `config/models.ts` (authoritative model list)
- `model-selector.ts` (task-to-model mappings, must sync with MODELS.FALLBACK_CHAINS)
- Haiku ceiling: `claude-haiku-4.5` only; no 4.6 variant exists
- Standard tier fallback: `claude-sonnet-4.6 → gpt-5.4 → claude-sonnet-4.5 → ...`
- Template copies renamed to `.template` suffix to prevent discovery conflicts
- Model updates touch 7 files in sequence: SKILL.md → .github/agents → runtime/constants → model-selector → config/models → runtime/benchmarks → tests

---

## 2026-05-13: Piece 02 Adversarial Review

**Summary:** FIDO, RETRO, Flight completed reviews. Verdict: CONDITIONAL (blocking test gaps + should-fix recommendations). RETRO clear on security. Flight proposes non-breaking decisions on module naming (`-vN` suffix policy) and typed error codes. CONTROL not locked out; remediation routing pending.

---

## 2026-05-14: Piece 06 Revision (2026-05-14T10:51:52-07:00)

**Summary:** Quality refinement addressing 5 blocker+major findings from Flight + FIDO reviews.

Key patterns:
- Symlink-safety: lstatSync (not statSync) + unlinkSync before copyFileSync
- CLI output: helpers return paths, CLI dispatch owns logging
- Portable write-failure tests: pre-create target as directory (EISDIR/ENOTDIR cross-platform)
- Warning assertion: split regex into two assertions (path pattern + error class)
- CLI dispatch testability: spawn `node dist/cli-entry.js` or export `main(argv)` with guard
- Primary/fallback template coverage: `templatesDir?: string` injection

Git: interactive rebase with automated pause + amend + cherry-pick replay. 16/16 tests pass.

---

## 2026-05-15: Piece 07 Revision (2026-05-15)

**Summary:** CONTROL-led revision of EECOM's rejected piece 07 (3 independent REJECT verdicts). EECOM locked out. All 5 blockers resolved:
- B1: Stripped `.squad/` from product commit via hard-reset + selective checkout + cherry-pick
- B2: Added path-uniqueness conflict guard + eliminated `'reactivated'` dead value
- B3: Fixed 3 failing dispatch-help tests by isolating CLI with `cwd: tempDir` + `--registry-path <clean>`
- B4: Updated register help text (`--path` optional, added `--origin`/`--clone` docs)
- B5: Applied nits (variable renames, mutation→spread-copy, dead values removed, `RunRegisterOutcome` narrowed)

Result: 45/45 tests pass. Git: two product commits (`9c3f0885` + `9ac6cd81`) with Scribe state sandwich.

---

## 2026-05-14: Piece 08a — Read-only command resolver migration

**Summary:** Migrated read-only command paths (`discover`, `config model`, `status`) to structured squad resolver for registered clones. 7 files changed. Preserved working-tree drift in local stash. Validation: new tests RED before implementation, GREEN after. Build clean. Scrub gate: no new violations introduced.

---

## Archive Notes

This archive captures CONTROL's session history from Phase A onboarding through Phase B piece 07 revision. The active history.md now focuses on current-sprint findings and cross-agent notifications. Entries older than 30 days are candidates for subsequent rotation per Scribe archival policy.
