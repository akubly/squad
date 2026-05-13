---
"@bradygaster/squad-sdk": patch
---

Add origin URL resolution to `resolveSquad()` (step 5): collects fetch URLs from `git remote -v`, canonicalizes both sides — GitHub SSH/HTTPS equivalence; Azure DevOps modern and legacy SSH/HTTPS forms all normalize to `dev.azure.com/{org}/{project}/_git/{repo}`; `.git` suffix and trailing-slash stripping; userinfo removal — then compares. A single match returns `{ source: 'origins', matchedOrigin }` where `matchedOrigin` is the original registry string. Multiple matches throw `AMBIGUOUS_ORIGINS`. Also adds platform fallback (step 6) probing `%APPDATA%`, `~/Library/Application Support`, or `$XDG_DATA_HOME/.local/share` for a user-scoped `.squad/` directory (`source: 'platform'`), and linked-worktree fallback (step 7) parsing `git worktree list --porcelain` when the current root is a linked worktree marker (`source: 'worktree'`). Exports `collectCwdRemoteUrls` and `normalizeRemoteUrl` from the SDK barrel.
