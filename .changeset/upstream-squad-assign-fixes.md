---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Harden `squad assign` command (piece 14 revision)

Addresses all findings from adversarial review pass:

- Typed error codes via `AssignError` class with `code: AssignErrorCode`
- Discriminated union on `SquadAssignResult` — `warnings` only present when
  kind is `assigned` or `reactivated`
- Exhaustiveness guard (`never` check) in `cli-entry.ts` assign switch
- `--key=value` arg parsing via new `parseAssignArgs` / `argValue` helpers in
  `assign-args.ts`; flag values no longer accidentally captured as positional
- `--` separator in spawned `git clone` calls to prevent URL injection
- `env` seam threaded to `resolveRegistryFilePath` in both warm and cold paths
- Origins deduplication at write boundary (warm path and cold-start)
- Cold-start orphan rollback: cloned directory removed on registry write failure
- Atomic registry write with temp-file + `renameSync`, mode `0o600`
- `cloneTo: string` added to `_ColdStartCtx` (eliminates implicit string coercion)
