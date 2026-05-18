---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Add `squad assign` command (piece 14)

Links a product clone to a registered squad host by callsign (warm path)
or clones a squad host first then binds the product clone (cold-start path
via `--clone-to`).

Registry schema additions: `status`, `initUri`, `stateBackend` fields on
`RegistryEntry`; unknown forward-compatible fields now round-trip through
`validateEntry` unchanged.
