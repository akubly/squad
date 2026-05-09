# 18 — Doctor command enhancements

## Summary

This piece expands `squad doctor` from a local setup check into a registry maintenance command. It adds read-only registry warnings, a callsign case-collision normalizer, and an explicit purge path for removing a registry entry when the user intends to wipe it from the registry.

Stack position: Part 18/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 16 — init refactor. This is a non-breaking CLI diagnostic and maintenance improvement.

## Context

The registry is the source of truth for shared squad resolution. Earlier pieces add lifecycle commands that create entries, bind clones, and remove active consumer bindings. Those commands intentionally avoid broad cleanup: `assign` appends current consumers, `unassign` removes one consumer and demotes an empty entry, and resolution fails closed when a path or origin is ambiguous.

`doctor` is the right command for registry-wide diagnostics because it already answers “is this setup healthy?” It can inspect all entries without changing resolver priority, and it can provide explicit repair actions for cases that should not be handled implicitly during normal command execution.

Three gaps remain:

- registry entries can drift into inconsistent or ambiguous states that resolution should not silently repair;
- callsigns are logical identifiers, but case collisions still cause practical trouble on case-insensitive filesystems and in shared registry files;
- `unassign` deliberately keeps an inactive entry, so users need a separate, explicit escape hatch when they want to remove an entry entirely.

## Scope and files

In scope:

- Extend the testable doctor command module with registry health warnings.
- Add `squad doctor --normalize-callsigns` as a dry-run report and `--apply` repair mode.
- Add `squad doctor --purge <callsign>` for full registry entry removal.
- Wire the new flags into CLI help and command dispatch.
- Preserve existing doctor behavior for the no-flag path.
- Add command tests for all three sub-features.
- Add a CLI changeset.

Out of scope:

- Changing registry schema validation.
- Changing resolver priority or ambiguity behavior.
- Deleting squad host directories from disk.
- Making `unassign` delete registry entries.
- Automatically changing callsign casing during `assign`, `init`, or resolution.
- Bulk stale-path deletion for arbitrary clone paths.

Expected files from the manifest:

| Path | Role |
| --- | --- |
| `.changeset/doctor-enhancements.md` | CLI changeset, or equivalent focused changeset name |
| `packages/squad-cli/src/cli-entry.ts` | flag parsing, help text, output, exit codes |
| `packages/squad-cli/src/commands/doctor.ts` | diagnostic and maintenance implementation |
| `packages/squad-cli/src/commands/__tests__/doctor.test.ts` | command behavior tests |

If replay finds an equivalent file has moved after predecessor pieces, update the current equivalent and call out the substitution in the pull request description.

## Proposed change

### API surface

Add these CLI signatures:

```text
squad doctor [--registry-path <file>]
squad doctor --normalize-callsigns [--apply] [--yes] [--registry-path <file>]
squad doctor --purge <callsign> [--yes] [--registry-path <file>]
```

The no-flag command remains read-only. `--registry-path` continues to select an isolated registry for tests and user override scenarios. `--yes` skips confirmation only on mutating doctor actions.

The command module should expose testable helpers with result shapes equivalent to:

```ts
export interface RunDoctorOpts {
  cwd: string;
  registryPath?: string;
  env?: Record<string, string>;
  copilotHome?: string;
}

export interface RunDoctorResult {
  severity: 'info' | 'warn' | 'error';
  findings: string[];
}

export interface NormalizeCallsignsOpts {
  registryPath?: string;
  env?: Record<string, string>;
  apply?: boolean;
  yes?: boolean;
  promptFn?: (question: string) => Promise<string>;
}

export interface NormalizeCallsignsResult {
  lines: string[];
  pairsFound: number;
  mergedCount: number;
}

export interface RunDoctorPurgeOpts {
  callsign: string;
  registryPath?: string;
  yes?: boolean;
  readLine?: () => string;
}

export interface RunDoctorPurgeResult {
  notFound?: { suggestion: string | null };
  refused?: { consumers: string[] };
  cancelled?: boolean;
  removed?: boolean;
  hostPath?: string;
}
```

The helper APIs keep prompts injectable so tests do not read from standard input. They also keep registry path injection local to the command module.

### Warnings

The no-flag `squad doctor` path should continue to report the current directory's resolution state, then merge registry-wide health findings into the final severity.

Add these registry warnings:

1. **Empty `clones[]` entries.** An active entry with an empty `clones[]` is inconsistent and should produce a warning. An inactive entry with an empty `clones[]` is expected after last-consumer unassign and should produce informational guidance instead of a warning.
2. **Multi-entry CWD ambiguity.** If the same clone path, or a containment-equivalent clone path, appears in more than one entry, report a warning that names the affected entries and tells the user to disambiguate with an explicit callsign.
3. **Origin overlap across registry entries.** If two active entries share a normalized origin URL, report a warning because origin-based resolution can become ambiguous. Inactive entries do not participate in this overlap check.

These checks are read-only. They should not rewrite `status`, remove clone paths, deduplicate origins, or choose a preferred callsign.

### `--normalize-callsigns`

`--normalize-callsigns` detects callsign pairs whose lowercased values are equal while their original values differ, such as `MyTeam` and `myteam`. This is a repair tool for registry files that may be shared across case-sensitive and case-insensitive environments.

Default behavior is dry-run:

- scan entries with callsigns;
- group case-colliding entries;
- print each collision and the proposed survivor;
- exit without writing the registry;
- tell the user to rerun with `--apply` to repair.

With `--apply`, merge each collision into one survivor. The survivor selection should be deterministic: prefer active entries, then prefer the entry with more clone bindings, then use existing registry order as the tie-breaker. Merge `clones[]` with platform-aware path deduplication, merge `origins[]` with normalized URL deduplication, and preserve forward-compatible fields from the survivor. The merged status is active when either side is active.

Without `--yes`, prompt before each merge. A negative or skip answer leaves that pair unchanged. With `--yes`, apply all deterministic merges without prompting.

### `--purge <callsign>`

`--purge` removes a whole registry entry by callsign. This is intentionally stronger than `unassign` and should be explicit in help text and output.

Behavior:

- If the callsign does not exist, return a not-found result and include a close-match suggestion when available.
- If the entry is active and has one or more clone consumers, refuse the purge and list the consumers. The CLI exits with code `2` for this refusal.
- If the entry is inactive, or active with an empty `clones[]`, allow removal after confirmation.
- `--yes` skips confirmation.
- The registry entry is removed from `squads[]`; all other entries remain unchanged.
- The squad host directory on disk is never deleted.

Use raw registry read-modify-write for removal so forward-compatible registry fields on other entries round-trip unchanged. The purge path should not call an upsert helper because deletion is the intended operation.

## Tests

Required warning tests:

| Test | Assertion |
| --- | --- |
| clean registry | no registry health warnings beyond the CWD resolution message |
| inactive empty clones | emits informational guidance and keeps severity `info` |
| active empty clones | emits warning and elevates severity to `warn` |
| missing status with empty clones | treats status as active and emits warning |
| exact multi-entry clone path | warns when two entries contain the same clone path |
| containment multi-entry clone path | warns when one registered clone path contains another |
| inactive summary | lists inactive entries without making the command fail |
| active origin overlap | warns when two active entries share a normalized origin |
| inactive origin excluded | does not warn for origin overlap involving inactive entries |
| severity merge | registry warnings elevate an otherwise informational CWD result |

Required `--normalize-callsigns` tests:

| Test | Assertion |
| --- | --- |
| no collisions | reports no pairs and makes no changes |
| one pair dry-run | reports the pair and leaves registry unchanged |
| one pair apply yes | merges into the deterministic survivor and deduplicates clones and origins |
| multiple pairs dry-run | reports each independent pair |
| prompt skip | leaves a prompted pair unchanged when the answer is skip or no |
| tie handling | uses registry order when activity score ties |
| forward-compatible fields | preserves survivor unknown fields through the merge |
| no callsign entries | ignores entries without callsigns |

Required `--purge` tests:

| Test | Assertion |
| --- | --- |
| active populated entry | refuses purge and returns consumers |
| inactive entry | removes entry with `--yes` |
| active empty entry | removes entry with `--yes` |
| unknown callsign | returns not-found with a close-match suggestion when available |
| unknown no suggestion | returns not-found with null suggestion |
| confirmation no | returns cancelled and leaves registry unchanged |
| confirmation yes | removes entry |
| host directory preserved | does not delete the host directory or `.squad` directory |
| repeat purge | second purge returns not-found after first removal |
| other entries preserved | removing one entry does not mutate unrelated entries |

Required CLI coverage:

- help text lists both new doctor flags;
- missing `--purge` argument exits with usage error;
- purge refusal maps to exit code `2`;
- cancelled purge exits `0`;
- normalize dry-run exits `0` without writing;
- normalize apply writes only when a pair is merged.

Validation commands:

```powershell
npm run build
npx vitest run packages\squad-cli\src\commands\__tests__\doctor.test.ts
npm test
```

Run the upstream scrub gate before opening the pull request.

## Compatibility and rollback

This piece is non-breaking. The no-flag doctor command remains available, registry JSON remains backward-compatible, and the new mutating actions require explicit flags.

Compatibility shape:

- existing registry entries remain readable;
- inactive entries created by `unassign` remain valid;
- callsign matching stays case-sensitive for normal command resolution;
- `--normalize-callsigns` only merges exact case-collision groups;
- `--purge` removes registry metadata only and does not delete host files;
- unknown registry fields on unaffected entries are preserved.

Rollback shape:

- remove the new doctor helper exports;
- remove CLI parsing, help text, and exit-code mapping for the new flags;
- remove the doctor tests for warnings, normalization, and purge;
- remove the changeset.

No data migration is required. Registries changed by `--purge` have fewer entries, and registries changed by `--normalize-callsigns --apply` have fewer case-colliding entries; both shapes remain valid registry JSON.

## Notes

Follow Microsoft Style Guide: use sentence-case headings, active voice, present tense, and direct guidance. Error and warning text should say what happened and what action is available. Avoid claims about automatic repair when the command is only reporting diagnostics.

`unassign` and `doctor --purge` serve different user intents. Use `unassign` when removing the current repository as an active consumer; it keeps the registry entry, reserves the callsign, and marks the squad inactive when the last consumer is removed. Use `doctor --purge <callsign>` only when the user wants to remove the registry entry itself. Purge is the explicit “wipe it from the registry” escape hatch, and it still leaves the host directory on disk.

Keep the design forward-looking. The warnings surface drift without changing resolution behavior, normalization repairs only a narrow callsign collision class, and purge is explicit enough to avoid surprising data loss.
