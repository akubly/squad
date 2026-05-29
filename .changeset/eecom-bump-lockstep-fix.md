---
'@wifi-aware/squad-sdk': patch
'@wifi-aware/squad-cli': patch
---

fix(release): restore version lockstep — root and sdk brought to `0.9.6-mc.preview.11`.

**Root cause:** Commit `0f5ac1d2` manually bumped only `packages/squad-cli/package.json` (version + `@wifi-aware/squad-sdk` dep pin) from `.10` to `.11` to re-align CLI with a previously published SDK release, without touching `package.json` (root) or `packages/squad-sdk/package.json`. Left state: root=`.10`, sdk=`.10`, cli=`.11`, cli sdk-pin=`.11`. The pinned SDK version (`.11`) did not exist on disk — publish-time bomb.

**Fix:** Bring root and `packages/squad-sdk` to `0.9.6-mc.preview.11` (highest-on-disk-wins). `scripts/bump-build.mjs` was not involved in the drift and is unchanged.
