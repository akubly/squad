---
'@wifi-aware/squad-sdk': patch
'@wifi-aware/squad-cli': patch
---

fix(release): restore lockstep version consistency (root + sdk → .11) and harden bump-build against workspace double-invocation.

**Root cause:** Commit `0f5ac1d2` manually bumped `packages/squad-cli/package.json` from `.10` to `.11` (to realign the CLI's `@wifi-aware/squad-sdk` dep pin with a published release) without bumping `package.json` (root) or `packages/squad-sdk/package.json`. The three files drifted: root=`.10`, sdk=`.10`, cli=`.11`, cli's sdk-pin=`.11`. The pinned SDK version (`.11`) did not exist on disk, which would explode at publish time.

**Fix:**
- Bring root and `packages/squad-sdk` up to `0.9.6-mc.preview.11` — the canonical "highest on disk wins" value.
- Add an idempotency guard to `scripts/bump-build.mjs`: checks `npm_package_name` env var (set by npm for every script invocation). If the calling package is a workspace package (`@wifi-aware/squad-*`), the script exits without bumping. This prevents a future workspace-level `prebuild` from double-bumping if one is ever added.
- The `prebuild` remains at root level only, which is the correct single-invocation point.
