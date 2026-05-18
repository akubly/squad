# Decisions Archive — 2026 Q1 (Archival Date: 2026-05-18)

> Entries archived from decisions.md to maintain performance. All decisions remain valid; these are historical records.

---

### 2026-03-26: CI deletion guard and source tree canary
**By:** Booster (CI/CD)
**What:** Added two safety checks to squad-ci.yml: (1) source tree canary verifying critical files exist, (2) large deletion guard failing PRs that delete >50 files without 'large-deletion-approved' label. Branch protection on dev requested (may need manual setup).
**Why:** Incident #631 — @copilot deleted 361 files on dev with no CI gate catching it.

---

### 2026-03-26: Copilot git safety rules
**By:** RETRO (Security)
**What:** Added mandatory Git Safety section to copilot-instructions.md: prohibits `git add .`, requires feature branches and PRs, adds pre-push checklist, defines red-flag stop conditions.
**Why:** Incident #631 — @copilot used destructive staging on an incomplete working tree, deleting 361 files.

---

### 2026-03-29: Versioning Policy — No Prerelease Versions on dev/main
**By:** Flight (Lead)
**Status:** DECIDED
**Confidence:** Medium (confirmed by PR #640 incident, PR #116 prerelease leak, CI gate implementation)

**Decision:**
1. All packages use strict semver (`MAJOR.MINOR.PATCH`). No prerelease suffixes on `dev` or `main`.
2. Prerelease versions are ephemeral. `bump-build.mjs` creates `-build.N` for local testing only — never committed.
3. SDK and CLI versions must stay in sync. Divergence silently breaks npm workspace resolution.
4. Surgeon owns version bumps. Other agents must not modify `version` fields in `package.json` unless fixing a prerelease leak.
5. CI enforcement via `prerelease-version-guard` blocks PRs with prerelease versions. `skip-version-check` label is Surgeon-only.

**Why:** The repo had no documented versioning policy. This caused two incidents:
- **PR #640:** Prerelease version `0.9.1-build.4` silently broke workspace resolution. The semver range `>=0.9.0` does not match prerelease versions, causing npm to install a stale registry package instead of the local workspace link. Four PRs (#637–#640) patched symptoms before the root cause was found.
- **PR #116:** Surgeon set versions to `0.9.1-build.1` instead of `0.9.1` on a release branch because there was no guidance on what constitutes a clean release version.

**Skill Reference:** Full policy documented in `.squad/skills/versioning-policy/SKILL.md`.

**Impact:** All agents must follow the versioning policy when touching `package.json`. Surgeon charter should reference this skill for release procedures. CI pipeline enforces the policy via automated gate.
