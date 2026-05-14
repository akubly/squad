# Decision: Piece 06 Revision — Register Installs Agent

**Author:** CONTROL  
**Date:** 2026-05-14T10:51:52-07:00  
**Piece:** 06 — Register Installs Coordinator Agent

## Decisions Made

### 1. Git mechanics: Option A (interactive rebase) over Option B (soft reset)

Used interactive rebase with an automated `GIT_SEQUENCE_EDITOR` batch script to pause at the EECOM code commit and amend it. This preserves the Scribe state commit as a direct descendant, keeping EECOM's session record intact in the branch history.

### 2. CLI dispatch testability: child process over exported `main`

Tested the `--no-install-agent` CLI dispatch by spawning `node dist/cli-entry.js` as a child process rather than exporting `main` from cli-entry.ts. Rationale: exporting `main` would require guarding the auto-invocation at the bottom of the entry file, which risks subtle entry-point bugs. Child process spawning is unambiguous and tests the real CLI surface including arg parsing.

### 3. `--home` flag added to register CLI dispatch

Added `--home <dir>` as a CLI flag for the register command. This routes the existing `home` seam (already present in `RunRegisterOpts`) to the CLI boundary, making the install target testable without process-global `HOME`/`USERPROFILE` mutation. It also has practical value for users on shared machines.

### 4. `templatesDir` injection on `RunRegisterOpts`

Added `templatesDir?: string` to `RunRegisterOpts` as the injection point for testing the primary template candidate path and the neither-exists warning path. This avoids exporting the internal `installCoordinatorAgent` helper and avoids `vi.mock` module interception.

### 5. Symlink test uses `it.skipIf` on Windows without Developer Mode

The production symlink-safety fix ships on all platforms. Only the test is conditionally skipped on Windows when `symlinkSync` is unavailable (no Developer Mode). This ensures Windows users get the protection; CI on Linux/macOS exercises the test.
