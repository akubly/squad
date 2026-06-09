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

