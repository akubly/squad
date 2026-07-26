---
"@bradygaster/squad-sdk": patch
---

Add clone-path resolution to `resolveSquad()` (step 4): matches the caller's working directory against registered `clones[]` entries using sentinel-bounded path containment and bidirectional realpath equality. A single match returns `{ source: 'clones', matchedOrigin: null }`. Multiple matches throw a configuration error with code `AMBIGUOUS_CLONES`. Missing registry falls through silently. Adds `packages/squad-sdk/src/path-utils.ts` with `clonesMatch()` and `pathsRefSameLocation()`, and exposes them via the `./path-utils` package subpath and the SDK barrel.
