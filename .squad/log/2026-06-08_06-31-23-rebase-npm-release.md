# Session Log — Rebase npm Release

**Timestamp:** 2026-06-08T06:31:23Z  
**Topic:** akubly/upstream-npm-release rebase onto piece-35  
**Agent:** Surgeon (Release Manager)  
**Requested by:** akubly

## Session Summary

Rebased 12 release/versioning commits cleanly onto `squad/piece-35-fold-pipeline-in-docs-repo` (HEAD `8e7000a6`). Zero conflicts. Build fails due to pre-existing scope-scrub gap in 4 files (verified pre-existing at df30d250, not caused by rebase). EECOM rescope pass required before branch is publishable.

**Branch HEAD:** `42da044d`  
**Status:** Local, not pushed per instructions

---

**Follow-up:** EECOM scope-fix pass needed for `@bradygaster/squad-sdk` → `@wifi-aware/squad-sdk` in:
- `packages/squad-cli/src/commands/assign.ts`
- `packages/squad-cli/src/cli/commands/install-hooks.ts`
- `packages/squad-cli/src/cli/commands/sync.ts`
- `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts`
