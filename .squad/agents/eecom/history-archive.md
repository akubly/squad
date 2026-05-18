# EECOM History Archive — Q1 2026

> Archived entries from EECOM history.md (archival date: 2026-05-18). Recent activity preserved in main history.

## Archived Entries (Pre-2026-04-18)

### Cross-Platform Filename and Config Fixes (#348, #356) (2026-03-15)

**Context:** Two cross-platform bugs broke Squad on Windows: (1) log filenames contained colons in ISO 8601 timestamps (illegal on Windows), (2) `.squad/config.json` contained absolute machine-specific `teamRoot` path.

**Investigation:**
- Searched SDK for all timestamp usage in filenames — found `safeTimestamp()` utility already existed but wasn't consistently used
- `comms-file-log.ts` (line 32) used inline `toISOString().replace(/:/g, '-')` instead of utility
- `init.ts` (line 612) wrote absolute `teamRoot` to config.json on every init
- Session-store already used `safeTimestamp()` correctly (line 71)

**Fixes:**
1. **Bug #348:** Updated `comms-file-log.ts` to import and use `safeTimestamp()` utility instead of inline timestamp formatting
2. **Bug #356:** Removed `teamRoot` field from config.json (can be computed at runtime via `git rev-parse --show-toplevel`)
3. Updated live `.squad/config.json` in repo to remove machine-specific path

**Pattern:** Centralized timestamp formatting in `safeTimestamp()` utility (replaces colons + truncates milliseconds). Windows-safe format: `2026-03-15T05-30-00Z` instead of `2026-03-15T05:30:00.123Z`.

**Test Impact:** All 150 tests pass. Communication adapter test doesn't validate specific filename format (structural test, not behavioral).

---

### CastingEngine CLI Integration (#342) (2026-03-15)

**Context:** CastingEngine class (Issue #138, M3-2) existed in SDK with curated universe templates (The Usual Suspects, Ocean's Eleven) but was completely bypassed during `squad init`. LLM picked arbitrary names, and charter generation used regex-based `personalityForRole()` instead of template backstories.

---

### Init scaffolding: casting dir + no-remote stderr (#579) (2025-07-18)

**Context:** `squad init` in a fresh `git init` repo (no remote) printed `error: No such remote 'origin'` to stderr and `squad doctor` reported `casting/registry.json` missing. Two independent bugs in `packages/squad-sdk/src/config/init.ts`.

---

### Loop command: streaming output, worktree CWD, docs alignment (#767) (2025-07-25)

**Context:** Copilot code review on PR #767 flagged three issues in the loop command.

---

## Note

Full historical context preserved. Summarized entries moved to this archive to reduce primary history size. Main history.md now contains only recent/active entries.
