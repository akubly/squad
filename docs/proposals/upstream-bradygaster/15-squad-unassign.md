# 15 — squad unassign

## Summary

This piece adds `squad unassign`, the lifecycle command that removes the current repository binding from a shared squad registry entry. It is the counterpart to piece 14: `assign` increments the active consumer set by adding a clone path and origin, while `unassign` decrements that set by removing the matched clone path and refcounting origins.

Stack position: Part 15/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 14 — `squad assign`. This is a non-breaking CLI lifecycle addition.

## Context

Shared squads are registered once and consumed by multiple repositories through the registry entry's `clones[]` and `origins[]` fields. Users need a safe way to remove one consumer binding without damaging the shared squad's identity or disrupting other consumers.

Deleting the registry entry on the last unassign would make the callsign immediately reusable and would lose the provenance needed for later diagnostics. The command should instead demote the entry: keep the registry entry, reserve the callsign, mark it inactive, and leave enough metadata for a later `squad assign <callsign>` to reactivate it without a fresh clone.

## Scope and files

In scope:

- Add `packages/squad-cli/src/commands/unassign.ts`.
- Wire `squad unassign` into `packages/squad-cli/src/cli-entry.ts`.
- Add command help for `unassign [--callsign <name>] [--registry-path <file>] [--target-dir <path>]`.
- Add tests for clone removal, idempotency, ambiguity, refcounted origins, host-path guard, demotion, and forward-compatible field preservation.
- Add or update package exports so the command test can import `runUnassign`.
- Add a CLI changeset.

Out of scope:

- Removing the `assign` command's reactivation behavior.
- Changing registry schema validation.
- Adding bulk cleanup for stale clone paths.
- Purging inactive registry entries.
- Changing resolver priority order.
- Adding automatic clone behavior.

Expected files from the manifest:

| Path | Role |
| --- | --- |
| `.changeset/squad-unassign.md` | CLI changeset |
| `packages/squad-cli/package.json` | package export and script surface |
| `packages/squad-cli/src/cli-entry.ts` | command wiring and output |
| `packages/squad-cli/src/commands/unassign.ts` | implementation |
| `packages/squad-cli/src/commands/__tests__/unassign.test.ts` | command behavior tests |
| `vitest.config.ts` | test configuration only if the command subpath requires it |

If replay finds that an expected integration file no longer needs changes after predecessor pieces, do not touch it only to match the manifest. Keep the diff surgical and document the substitution in the pull request description.

## Proposal

### Command surface

```text
squad unassign [--callsign <name>] [--registry-path <file>] [--target-dir <path>]
```

`--target-dir` defaults to the current working directory. `--registry-path` defaults to the normal user registry location or the existing registry override environment variable. `--callsign` is optional and is used only to disambiguate the registry entry when the target directory appears in more than one entry's `clones[]`.

The public command helper should expose a testable API:

```ts
export interface RunUnassignOpts {
  callsign?: string;
  registryPath?: string;
  cwd?: string;
  targetDir?: string;
  copilotHome?: string;
}

export interface RunUnassignResult {
  alreadyUnassigned?: boolean;
  hostPathGuard?: boolean;
  demoted?: boolean;
  warnings?: string[];
}

export function runUnassign(opts: RunUnassignOpts): Promise<RunUnassignResult>;
```

### Lookup and removal

When `--callsign` is supplied, resolve exactly that registry entry. If the callsign is unknown, fail with a clear not-found error and include a suggestion when a close registered callsign exists. If the callsign exists but the target directory is not in that entry's `clones[]`, return success with `alreadyUnassigned: true`.

When `--callsign` is omitted, resolve by scanning registry entries whose `clones[]` contains the target directory's git root. Matching must use the same path semantics as `assign`: literal path comparison with realpath-aware equality where available. If no entries match, return success with `alreadyUnassigned: true`. If more than one entry matches, fail as ambiguous and tell the user to pass `--callsign <name>`; the CLI exits with code `3` for this case.

For a single match, remove only the matched clone path from that entry's `clones[]`. Other clone paths remain in their original order.

### Refcounted origins

After removing a clone, collect the remote URLs from the removed repository and normalize them with the same URL normalization used by `assign`. For each registry `origins[]` value that matches a removed URL:

- keep it when any remaining clone for the same entry still reports the same normalized URL;
- remove it when no remaining clone reports that normalized URL;
- keep origins that were not contributed by the removed clone.

This makes `origins[]` behave like a reference-counted summary of active consumers instead of a write-only history list.

### Demote semantics

If the removal leaves one or more clone paths, the entry stays active. If the removal leaves zero clone paths, set `entry.status = 'inactive'` and keep the entry in the registry.

Demotion means:

- the registry entry remains present;
- `callsign`, `path`, `initUri`, and unknown forward-compatible fields are preserved;
- `clones[]` becomes an empty array after the last active binding is removed;
- `origins[]` is refcounted against remaining clones, so origin values with no active remaining consumer are removed;
- the callsign stays reserved and discoverable;
- a later `squad assign <callsign>` can reactivate the same entry by setting `status` back to `active` and adding the new clone binding.

Do not leave the removed clone path in `clones[]` for forensics. `clones[]` is an active-consumer list used by resolution and ambiguity checks. Keeping removed paths there would make the repository still appear assigned. Historical investigation belongs in diagnostic output, version control history, or future audit fields, not in the active resolution list.

Do not use `unassign` as a broad stale-path cleanup command. If other clone paths in the same entry no longer exist on disk, leave them unchanged. A later health or purge command can warn about or remove stale paths with explicit user intent.

### Host-path guard and payload cleanup

If the target directory is the shared squad host directory itself, return success with `hostPathGuard: true` and do not mutate the registry. The CLI should explain that `unassign` removes consumer bindings, while full de-registration is a separate purge operation.

When a consumer binding is removed, remove the user-scoped payload for that callsign through the existing payload cleanup helper. Shared coordinator cleanup must remain refcount-aware so one squad unassign does not remove files still needed by another assigned squad.

## Tests

Required command tests:

| Test | Assertion |
| --- | --- |
| happy path | removes the target git root from `clones[]` and preserves other clones |
| last clone demotion | sets `status` to `inactive` and preserves callsign, path, initialization URI, and unknown fields |
| demote not delete | the registry entry still exists after last-clone unassign |
| idempotent no match | target directory not present in any `clones[]` returns success |
| idempotent explicit callsign | target directory not present in the named entry returns success |
| ambiguous match | target directory in multiple entries without `--callsign` fails with exit code `3` |
| explicit callsign resolves ambiguity | removes only from the named entry |
| sole origin reference | removes an origin when the removed clone was the only remaining reference |
| shared origin reference | keeps an origin when another remaining clone still reports it |
| host-path guard | running from the squad host directory is a no-op success |
| forward-compatible fields | preserves `stateBackend` and unknown fields through read-modify-write |
| suggestion path | unknown callsign can include a close-match suggestion |

Validation commands:

```powershell
npm run build
npx vitest run packages\squad-cli\src\commands\__tests__\unassign.test.ts packages\squad-cli\src\commands\__tests__\assign.test.ts
npm test
```

Run the upstream scrub gate before opening the pull request.

## Compatibility and rollback

This piece is non-breaking. It adds a command and mutates only the registry entry selected by the target directory or explicit callsign.

Compatibility shape:

- registry JSON remains backward-compatible;
- active entries with multiple clones remain active after one clone is removed;
- inactive entries remain discoverable;
- `assign` is the reactivation path for inactive entries;
- unknown registry fields are preserved.

Rollback shape:

- remove the command implementation;
- remove command wiring and help text;
- remove the package subpath export if one was added;
- remove the command tests;
- remove the changeset.

No data migration is required. Registries that already contain inactive entries remain valid; older command surfaces simply do not provide this removal command.

## Notes

Follow Microsoft Style Guide: use sentence-case headings, active voice, present tense, and direct user guidance. User-facing messages should say what happened and what to do next; avoid speculative language.

Demote-not-delete is the right default because it prevents accidental callsign reuse, preserves the user's ability to rediscover the shared squad, and supports reassigning without a fresh clone. The registry entry represents the durable identity of a shared squad, while `clones[]` represents current consumers. Keeping those responsibilities separate makes runtime behavior safer and easier to explain.

Keep the design forward-looking. If future health commands add audit trails or stale-path cleanup, they should use explicit fields or explicit user action rather than overloading `clones[]` with inactive history.
