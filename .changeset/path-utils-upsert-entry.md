---
'@bradygaster/squad-sdk': minor
'@bradygaster/squad-cli': patch
---

feat(sdk): extract path-utils module; rename registerEntry to upsertEntry

- Add `normalisedPathKey` export to `path-utils.ts` for OS-aware path deduplication
- Registry validates duplicate paths using `normalisedPathKey` from path-utils
- `upsertEntry` is the canonical registry write-preparation helper
- `registerEntry` retained as a deprecated alias delegating to `upsertEntry`
- `resolution-v2.ts` re-exports `normalisedPathKey` alongside existing path helpers
- SDK index exports `upsertEntry`, `registerEntry`, and `normalisedPathKey`
