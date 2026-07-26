---
"@bradygaster/squad-sdk": minor
---

Add callsign resolution to `resolveSquad()`: resolves `opts.callsign` and `SQUAD_CALLSIGN` env var through the registry, returning `{ source: 'env', callsign, matchedOrigin: null }`. Throws `SquadError` on empty callsign, missing registry, unknown callsign, or stale path.
