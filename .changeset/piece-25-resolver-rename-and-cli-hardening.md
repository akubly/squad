---
"@bradygaster/squad-sdk": minor
"@bradygaster/squad-cli": patch
---

Piece 25: rename `resolveSquad` to `resolveSquadDir` (deprecated alias retained per Brady's Option A) + CLI hardening.

**`@bradygaster/squad-sdk` (minor):**
- `resolveSquadDir` is now the canonical export for locating the `.squad/` directory. Same implementation, clearer name — consistent with the `Dir` suffix convention for directory-path resolvers.
- `resolveSquad` is retained as a `@deprecated` const alias pointing to `resolveSquadDir`. All existing consumers continue to work; no removal in this piece.
- This is additive (new export added); no existing signature changes. Removal of `resolveSquad` is deferred to a future major-version cleanup piece.

**`@bradygaster/squad-cli` (patch):**
- `cli/core/squad-resolver.ts`: updated import to use `resolveSquadDir` directly from SDK (alias `sdkResolveSquadDir`), eliminating the `resolveSquadV2` alias chain.
- `cli-entry.ts`: direct SDK import updated from `resolveSquad as resolveSquadV2` to `resolveSquadDir as sdkResolveSquadDir`.
- `renderFinding` (doctor.ts): the `f.source` dispatch is now an exhaustive switch with a `never` default arm. Adding a new `DoctorSource` variant without updating this renderer now causes a compile-time error (CONTROL N2).
