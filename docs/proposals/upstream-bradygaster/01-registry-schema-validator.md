# 01 — Registry schema validator

> Stack position: Tier 1, depends on none.

## Problem

Squad does not have a typed, validated `registry.json` contract for shared squad entries. Invalid registry files can reach command and resolution code before the user receives a clear validation error. The SDK needs one parser and validator that define the registry shape before later resolver and CLI pieces consume it.

## Proposed change

This piece introduces an SDK registry module and subpath export for parsing, validating, loading, and writing `registry.json`.

- Add `packages/squad-sdk/src/registry.ts`.
- Add `@bradygaster/squad-sdk/registry` to `packages/squad-sdk/package.json` exports.
- Export the registry types from the main SDK barrel.
- Add registry schema tests in `test/registry-schema.test.ts`.
- Add a changeset for the SDK package.
- If the resolver test corpus is introduced in this stack at the same time, keep resolver assertions outside this piece's acceptance surface; only the registry schema tests are parity criteria for piece 01.

### API surface

```ts
export interface RegistryEntry {
  callsign?: string;
  path: string;
  origins?: string[];
  clones?: string[];
}

export interface Registry {
  version: number;
  squads: RegistryEntry[];
}

export function parseRegistry(jsonText: string): Registry;
export function validateRegistry(obj: unknown): Registry;
export function registerEntry(
  entry: RegistryEntry,
  opts?: { onWarn?: (msg: string) => void },
): RegistryEntry;
export function writeRegistry(filePath: string, registry: Registry): void;
export function loadRegistryFromDisk(opts?: {
  registryPath?: string;
  legacyPath?: string;
  onWarn?: (msg: string) => void;
}): { registry: Registry | null; warnings: string[] };
```

The package exposes these symbols through `@bradygaster/squad-sdk/registry`. The main SDK entry point exports the `Registry` and `RegistryEntry` types only.

### Mechanism

`parseRegistry` rejects empty input, parses JSON text, and delegates to `validateRegistry`. `validateRegistry` accepts only an object with `version: 1` and `squads: RegistryEntry[]`; it throws `SquadError` with validation severity for malformed input.

Each entry must have an absolute `path` that ends with `.squad`. Optional `callsign`, `origins`, and `clones` fields keep their input shape: missing `origins` stays missing, while `origins: []` stays an empty array. `clones` entries must be absolute paths. Paths, clone paths, and callsigns reject `..` path-traversal segments; scoped callsigns that contain `/` remain valid.

Registry-level validation enforces unique callsigns and unique squad paths. Path uniqueness uses the existing path-key helper so case handling follows the current platform rules.

The stale-path policy is split by lifecycle stage:

| Stage | Behavior |
|-------|----------|
| Read | `parseRegistry` and `validateRegistry` do not check whether entry paths exist. |
| Register | `registerEntry` validates shape and warns through `onWarn` when the path is absent. |
| Resolve | Later resolver pieces turn stale resolved paths into errors. |
| Doctor | Later doctor pieces surface stale-path diagnostics. |

`writeRegistry` validates the registry before writing formatted JSON with a trailing newline. Permission failures such as read-only files become `SquadError` messages that name the registry file and suggest checking file permissions.

`loadRegistryFromDisk` reads `registry.json` from the supplied path or the user registry path. If both `registry.json` and `squad-repos.json` exist, `registry.json` wins. If only `squad-repos.json` exists, the function warns, returns `{ registry: null, warnings }`, and performs no automatic migration.

## Test surface

| Test | Asserts |
|------|---------|
| `registry-schema.test.ts: S1 accepts a minimal entry with path only` | `parseRegistry` accepts `{ version: 1, squads: [{ path }] }` and leaves optional fields undefined. |
| `registry-schema.test.ts: S2 accepts a full entry with callsign, path, origins[], clones[]` | `parseRegistry` preserves all supported entry fields. |
| `registry-schema.test.ts: S3 rejects entry missing required path field` | Missing `path` throws `SquadError` with a required-path message. |
| `registry-schema.test.ts: S4 rejects path that does not end with .squad` | Non-sentinel entry paths throw `SquadError`. |
| `registry-schema.test.ts: S5 rejects relative path` | Relative entry paths throw `SquadError`. |
| `registry-schema.test.ts: S6 accepts missing origins field` | Missing `origins` remains `undefined`. |
| `registry-schema.test.ts: S6 accepts empty origins array` | Empty `origins` remains `[]`. |
| `registry-schema.test.ts: S7 rejects clones[] entry with relative path` | Relative clone paths throw `SquadError`. |
| `registry-schema.test.ts: S8 rejects registry with duplicate callsigns` | Duplicate callsigns throw `SquadError`. |
| `registry-schema.test.ts: S9 rejects registry with two entries pointing to the same path` | Duplicate normalized squad paths throw `SquadError`. |
| `registry-schema.test.ts: S10 rejects registry with missing version field` | Missing `version` throws `SquadError` with a required-version message. |
| `registry-schema.test.ts: S11 rejects version 0 with migration hint` | Version `0` throws `SquadError` and tells the user to create a current registry. |
| `registry-schema.test.ts: S12 rejects unknown future version` | Unsupported versions such as `99` throw `SquadError`. |
| `registry-schema.test.ts: S13 rejects registry where squads field is not an array` | Non-array `squads` throws `SquadError`. |
| `registry-schema.test.ts: S14a tolerates stale path at read time` | `parseRegistry` accepts a syntactically valid path even when it is absent on disk. |
| `registry-schema.test.ts: S14b warns when path does not exist at register time` | `registerEntry` returns the entry and emits a warning through `onWarn`. |
| `registry-schema.test.ts: S15 accepts callsign with slash for scoped names` | Callsigns such as `org/api` are valid. |
| `registry-schema.test.ts: S16 rejects callsign containing path-traversal segment` | Callsigns with `..` segments throw `SquadError`. |
| `registry-schema.test.ts: S17 accepts origins[] containing multiple repository URL forms` | `origins` accepts repository URLs as strings without platform-specific validation. |
| `registry-schema.test.ts: S18 throws parse error with remediation on empty file` | Empty registry text throws `SquadError` with an empty-file message. |
| `registry-schema.test.ts: S19 throws parse error with remediation on malformed JSON` | Malformed JSON throws `SquadError` with a syntax-remediation message. |
| `registry-schema.test.ts: S20 throws helpful error on write when registry.json is read-only` | `writeRegistry` wraps permission failures in `SquadError`. |
| `registry-schema.test.ts: SC1 uses registry.json when both registry.json and squad-repos.json are present` | `loadRegistryFromDisk` reads `registry.json` and emits no warning. |
| `registry-schema.test.ts: SC2 ignores squad-repos.json and emits warning when only squad-repos.json is present` | `loadRegistryFromDisk` returns `null` and records a warning without migration. |

## Files

| Path | Role | Approx. LOC |
|------|------|-------------|
| `.changeset/registry-schema-validator.md` | changeset | +15 |
| `packages/squad-sdk/package.json` | subpath export | +24 |
| `packages/squad-sdk/src/index.ts` | public type exports | +9 |
| `packages/squad-sdk/src/registry.ts` | implementation | +454 |
| `test/registry-schema.test.ts` | parity tests | +364 |
| `test/resolution-v2.test.ts` | resolver test corpus placeholder; not a piece 01 parity gate | +1643 |

## Rollback

Revert the single commit for this piece. Rollback removes the registry module, package export, type exports, changeset, and registry schema tests; no persisted data migration is required because this piece only reads and writes user-supplied registry files.

## Notes for the implementer

Use `registerEntry` in this piece. A later piece owns the rename to an upsert-oriented API, so do not introduce that name early.

Do not add resolver behavior in this piece. The registry module must remain a schema and disk-I/O boundary so later pieces can consume it deterministically.
