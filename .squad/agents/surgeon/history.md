# SURGEON

> Flight Surgeon

## 📌 Recent Learnings

### Piece 21 Ship Gate Cleared (2026-05-22)

**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

---

### Rebase-onto-piece-36 Pattern (2026-06-08)

**Context:** `akubly/upstream-npm-release` (18 release/rescope commits) rebased onto `squad/piece-36-cross-repo-publish-loop-repair` (1 new commit: feee37f7, A–I defect repairs). merge-base was piece-35 HEAD (8e7000a6).

**Outcome:** Rebase completed with zero conflicts. The rescope commits on npm-release had already surgically aligned all TS import specifiers to `@wifi-aware`, so when piece-36's source rewrites landed as the base, no mechanical conflict arose. Git applied all 18 commits cleanly in a single `git rebase` invocation.

**Key insight:** The `@bradygaster → @wifi-aware` scope-scrub commits on the npm-release branch were scoped tightly enough that they did not collide with piece-36's logic rewrites. If the scrub had been done as a bulk sed-style batch touching the same lines as piece-36, conflicts would have been unavoidable.

**Post-rebase scope-scrub step:** After rebasing a feature branch onto a branch authored on the old `@bradygaster` scope, always run: `git grep -n "@bradygaster" -- "packages/**/src/**/*.ts"`. If any hits exist, replace `@bradygaster/squad-sdk` → `@wifi-aware/squad-sdk` and commit as `fix(rescope): align <branch> SDK imports to @wifi-aware after rebase`. In this case the grep was clean — no new stale imports were introduced.

**npm install required after scope-rename rebase:** When the workspace package names changed scope (from `@bradygaster/squad-*` to `@wifi-aware/squad-*`), the `node_modules/@wifi-aware/` directory was empty (workspace symlinks not re-created). Running `npm install` is required after any rebase that changes workspace package names. Without it, `tsc` cannot resolve `@wifi-aware/squad-sdk` and the build fails with TS2307 errors across all CLI commands. This is NOT a code error — it is a workspace-link regeneration artifact.

### Selective Stash Restore Recipe (2026-06-08)

**Scenario:** `stash@{0}` contains 4 desired `.squad/` artifact files PLUS 3 stale `package.json` files (at old version scheme). Need to restore `.squad/` files only; discard `package.json` churn.

**Recipe:**
1. Confirm `.gitattributes` has `merge=union` for `.squad/decisions.md` and `.squad/agents/*/history.md` (append-only files). Report what you find.
2. `git stash apply "stash@{0}"` — apply without dropping. 3-way merge runs.
3. For `package.json` conflicts: `git checkout HEAD -- package.json packages/squad-cli/package.json packages/squad-sdk/package.json` (restores committed lockstep, discards stash churn).
4. For `.squad/decisions.md` union-merge failure: git may report "Cannot merge binary files" even for text files if the file is large or has encoding quirks. The conflict leaves HEAD version in working tree. Extract the NEW section from stash (`git show "stash@{0}:.squad/decisions.md"`) and append it manually to the working tree file. Use `[System.IO.File]::WriteAllText()` with explicit UTF8 encoding. Stage resolved file (`git add -f .squad/decisions.md`), then immediately unstage it (`git reset HEAD -- .squad/`).
5. `git reset HEAD -- .squad/` — unstage all `.squad/` files (leave in working tree as restored changes for Scribe to commit separately).
6. Verify: `git status` shows 4 `.squad/` files as working-tree-modified, all 3 `package.json` clean. `git grep "^<<<<" -- .squad/ package.json` empty. Stash intact (`git stash list`).

**Do NOT drop stash@{0}** — keep as safety net. User/Scribe will commit the `.squad/` changes in a separate commit.

---

## Learnings

### Rebase-onto-piece-38 Pattern (2026-06-09)

**Context:** `akubly/upstream-npm-release` (22 release/rescope/docs commits) rebased onto `squad/piece-38-multi-clone-publish-model`. merge-base was `feee37f7` (piece-36 HEAD — where npm-release was last rebased onto piece-36). piece-38 added 2 commits on top of that base: `deb94a26` (piece-37 dogfood fixes) and `ad239eeb` (piece-38 multi-clone publish model).

**Outcome:** Rebase hit conflicts at commit 13/22 (`db15652b` — the npm-release rescope commit). Two files conflicted: `packages/squad-cli/src/cli/commands/sync.ts` and `packages/squad-cli/src/commands/assign.ts`. Conflict class: piece-38 (HEAD) used `INBOX_HANDLE_RE` from `@bradygaster/squad-sdk` while the npm-release rescope commit used `DEVELOPER_ALIAS_RE` from `@wifi-aware/squad-sdk`. Additionally, assign.ts HEAD included `installProductSquadForbidHook` which the npm-release side had dropped. Resolution: kept piece-38 wiring (`INBOX_HANDLE_RE`, `installProductSquadForbidHook`) and applied `@wifi-aware` scope. Commits 14–22 applied cleanly. Rebase succeeded.

**Post-rebase scope-scrub:** `git grep -n "@bradygaster" -- "packages/**/src/**/*.ts"` returned **zero hits** — the 22 npm-release commits had already done a complete rescope of all TS source files. No separate scope-fix commit was needed. This is a well-worn pattern: the npm-release branch carries authoritative scope, and after conflict resolution at the rescope commit the rest of the source is already clean.

**Scale:** 22 commits, 2 conflict files, 0 post-rebase stale imports. The conflict was entirely mechanical (symbol rename + scope rename at the same lines) — no genuine logic tangle.

**npm install:** Run after rebase (as always) to regenerate `node_modules/@wifi-aware/` workspace symlinks before `SKIP_BUILD_BUMP=1 npm run build`. Build exited 0.

### Stash@{0} — Clean Stash (2026-06-09)

**Scenario:** stash@{0} ("WIP on squad/piece-38-multi-clone-publish-model") contained ONLY 2 files: `.squad/agents/eecom/history.md` and `.squad/agents/gnc/history.md`. No `package.json` churn, no version deltas. `git stash apply stash@{0}` applied with zero conflicts (union driver merged both history files cleanly). No NUL bytes in either file. No manual extraction required. Both files restored as working-tree-modified; not staged; left for Scribe to commit. stash@{0} retained as safety net.

**Key insight:** When a stash is "clean" (only `.squad/` append-only files, no package.json churn), the apply is trivial. The complexity documented in the prior recipe (selective-restore + manual decisions.md extraction) only applies when the stash carries stale version bumps or large-file union-merge failures. Confirm stash contents before applying — `git stash show stash@{0}` tells you exactly what's inside.

