# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

## Recent Pieces — Phase B Active

### Piece 19 — Copilot payload orchestration (2026-05-19T22:30:35Z)
🔐 **Reviewer Lockout Applied.** EECOM authored piece 19 (Copilot payload load + callsign extraction + frontmatter rewriting). Adversarial review cycle: Flight ✅ (spec parity), FIDO ❌ (coverage gaps), CAPCOM ❌ (contract/security). GNC + CAPCOM (Round 2) completed revision under lockout. Blocker fixes: symlink-safe copy, `assertValidCallsign` guard, `CopilotPayloadError` wrapping, 3 FIDO test gaps. Final: `2377c3a8` (amended), 143/143 tests GREEN, build CLEAN. ✅ Ship approved to dev.

### Piece 18 — doctor enhancements (2026-05-19)
Extended `runDoctor` with registry health checks (empty clones, clone-path ambiguity, origin overlap); `runDoctorNormalize` for dedup; `runDoctorPurge` for removal. Key: `_pickSurvivor` (active status → clone count → registry order). Merge insertion preserves order. Tests 28/28 GREEN. Gotcha: normalize test dirs avoid case collisions on Windows.

### Piece 17 — fuzzy-match utility (2026-05-18)
`levenshteinDistance` (two-row DP, Unicode-safe) and `suggestSimilar` (linear scan, stable tie-break). Tests 24/24 GREEN. Gotcha: vitest config `include` glob must expand for new paths.

### Piece 16 — squad init refactor (2026-05-18)
Dropped URL positional; added `--target-dir`, `--registry-path`, `--no-register`. Reactivates inactive entries. Scaffold/symlink logic split. Tests 28/28 GREEN (10 unit + 26 integration). Gotcha: integration tests need `npm run build` first.

### Piece 15 — squad unassign (2026-05-18)
Demote-not-delete semantics. Last-clone removal → `status: 'inactive'`. Origin refcounting via `normalizeRemoteUrl`. Revision F1–F8 applied. Tests 67/67 GREEN.

### Piece 09 Revision (2026-05-15)
Moved `resolveWatchStartupSquadDir` to internal startup.ts. Build CLEAN, 5/5 tests GREEN.

### Piece 10 Revision (2026-05-15)
Addressed all 6 blocking test gaps + 3 guard gaps. Unified init validation routing. Build CLEAN, 28/28 tests GREEN.

## Team Updates — Recent

📌 **2026-05-27 Piece 23 Revision Complete + Piece 24 Spec Ready:** EECOM completed piece 23 revision with all nits addressed (F1–F4 applied, F2 false-positive documented). All gates green. Flight authored piece 24 spec + handoff. Decisions merged, orchestration logs prepared.

📌 **2026-05-19 Piece 18 Revision Complete:** CONTROL completed piece 18 revision under Strict Lockout Protocol (EECOM locked out). Applied F1–F7 fixes + N1–N5 nits. 33 unit + 7 CLI tests GREEN. Build CLEAN. Re-verify flight for Flight (architecture) and FIDO (test/build/scrub).

📌 **2026-05-18 Piece 14 Revision Complete:** All findings addressed (git `--` separator, typed error codes, CLI `--flag=value` parsing, exhaustiveness guards). Build CLEAN, 47 tests GREEN. Branch ready for Phase C.

📌 **2026-05-15 Piece 09/10 Revisions:** Both completed independent revision cycles post-rejection. All blocking gaps closed. Decisions merged.

## Learnings

### Writer/reader path divergence: always route both through a single helper

When a CLI writer and SDK reader compute the same "default" path independently, they will eventually drift (e.g., platform-specific APPDATA logic on one side vs `~/.squad` on the other). The fix pattern: extract a `defaultRegistryFilePath(homeDir?, env?)` helper in the SDK, export it, and have both call it. Never let writer and reader compute their own independent defaults.

### Stash-and-verify gate for path-fix tests

After adding path-parity regression tests (RRP.5, RRP.6), the stash gate confirms they fail when the old code is restored. Without it you cannot distinguish "test that always passes" from "test that actually guards the fix." Procedure: stash the changed file, run targeted tests (expect FAIL), pop stash, run again (expect PASS).

### Sub-directory temp paths escape to repo root during walk-up

End-to-end tests using `os.tmpdir()` subdirs sometimes create paths that are children of the repo root on CI machines where TEMP is inside the workspace. Add a `.git` marker at the temp root to serve as a boundary for `gitRoot` walk-up, preventing the real `.squad/` from contaminating resolution tests.

### Phase B verify-first sub-proposals are real

When prior pieces already shipped the surface, the correct disposition is 'verified-already-green' with concrete test ID citations — not re-implementation. Sub-proposals that find the surface already in place should be marked verified and closed with a reference, not treated as unimplemented gaps.

### Build re-stamps package.json versions; never include those in a feature commit

`npm run build` automatically updates `package.json` and `packages/*/package.json` version fields. These are build artifacts, not source. Feature commits must use `git add -- <explicit path>` to exclude them. Staged files that include version changes will be reverted by the Coordinator.

### Scope hygiene: a feature commit MUST exclude .github/agents/squad.agent.md unless that file is actually being changed for the piece

The squad agent discovery file is governance infrastructure, maintained separately. If a piece does not explicitly modify it per spec, do not include it in the code commit. The Coordinator will remove it during cleanup.

### Upgrade logic must refresh every installed copy of a managed artifact

If a command owns both an in-repo mirror and a user-scoped install of the same template, upgrade cannot stop at the repo copy. Reuse the same installer helper for upgrade-time refresh, gate it on the global artifact already existing, and add a regression test that seeds the installed copy with stale bytes so consumer repos do not stay pinned forever.

### Registry corruption diagnostics (2026-05-22T14:08:38-07:00)

`loadRegistryFromDisk` surfaces registry parse/schema problems as SDK `SquadError` instances with `category === ErrorCategory.VALIDATION`, `context.operation === "registry"`, and non-recoverable error severity. The exported `validateEntry(value: unknown, entryIndex: number): RegistryEntry` contract validates only one entry, preserves forward-compatible unknown fields, and throws `SquadError` messages that include the registry index. Doctor's seam pattern: catch only registry validation errors, re-read raw JSON, split syntax failures from per-entry validation failures, and rethrow non-validation I/O/permission errors to preserve existing behavior.

### Upgrade payload refresh seam and registry matching (2026-05-22)

`installCopilotPayload` takes `{ hostDir, callsign, copilotHome?, skillsFrom?, cwd? }` and returns counts for coordinator, skills, agents, instructions, and MCP servers. `runUpgrade` follows FIX-1's direct `UpgradeOptions` seam style with `copilotPayloadInstaller?: typeof installCopilotPayload`, defaulting to the SDK function so tests can inject a recording or throwing stub. Registry matching is by `normalisedPathKey(entry.path) === normalisedPathKey(squadDirInfo.path)` before using the matched entry's `callsign`; raw path equality is not safe across separators, relative segments, or OS casing rules.

## Learnings

### Piece 23 Rev — Nit follow-up (2026-05-27)

**Addressed (F1, F4, N1, N2):**
- **F1** — Added `.git`-absent failure-path test in `test/cli/squad-file-conventions.test.ts`: `"returns null when .squad/ exists but .git/ does not (no git root — documented SDK boundary)"`. Companion `.git`-with-no-.squad null test already existed; no duplicate needed.
- **F4** — Renamed `hasCopilot` → `agentEnabled` throughout `watch/index.ts` (4 sites: function param declaration line ~319, `if` guard line ~354, `const` assignment line ~766, call-site line ~920). Handoff §5 step 5 mandate now satisfied.
- **N1** — Replaced `export default { generate }` in `qrcode-terminal.d.ts` with idiomatic two-step `declare const _default: { generate(...) }; export default _default;`. Free `function generate` declaration removed; `QRCodeOptions` interface retained. Build + tsc --noEmit clean.
- **N2** — Added `env: NodeJS.ProcessEnv = process.env` as defaulted second param to `resolveSquadDir`. Fully backward-compatible — all existing callers unchanged. Added test `"accepts an injectable env parameter (env seam — future-proofing; ...)"` in `squad-file-conventions.test.ts`. Note: SDK does not currently vary resolution behavior on env contents, so the seam is structural future-proofing per D-13.

**Skipped (F2, F3):**
- **F2** — FALSE POSITIVE. `flight-piece-23-options-bag-seam.md` follows the agent drop-box convention (`{agent}-{brief-slug}.md`), not the Coordinator-capture convention (`copilot-{brief-slug}.md`). No rename performed. See `.squad/decisions/inbox/eecom-piece-23-rev.md` for full rationale.
- **F3** — Amending `fced6e99` would invalidate the literal hash both reviewers approved. Cosmetic gain not worth the audit-trail churn. Noted in rev commit message instead.

**Final LOC delta for this rev:** ~+30 LOC (production: ~6 LOC across 3 files; tests: ~24 LOC in 2 new test cases).

**New test names (for grep):**
- `"returns null when .squad/ exists but .git/ does not (no git root — documented SDK boundary)"`
- `"accepts an injectable env parameter (env seam — future-proofing; SDK does not currently vary behavior on env)"`



Gate 1 & 2 scrub-gate baseline contamination — pre-existing on all Phase B pieces. Accepted per coordinator directive in `.squad/decisions.md`.

## Archive

Older context (pieces 1–8, Q1 2026) in `history-archive.md`: template sync patterns, cherry-pick conflicts, loop command refactors, pre-Phase B lifecycle.

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.
