# 07 — register merges clones[] and origins[]

## Summary

This piece updates `squad register` so repeated registration of the same shared callsign records every local checkout that participates in that squad. When a user runs `register --callsign foo` from another clone of the same shared squad, the existing registry entry is updated by merging `clones[]` and `origins[]` instead of rejecting the call or overwriting prior discovery data.

The result is additive, non-breaking behavior: a squad that is already registered remains the same squad, while later registrations from additional clones make resolver discovery work from any recorded checkout or repository remote.

## Context

Pieces 01 through 06 establish the registry contract, resolver chain, shared path helpers, command stubs, and agent-template install behavior. Piece 03 defines the resolver semantics for `clones[]` and `origins[]`; this piece ensures the CLI writes enough data for those resolver steps to be useful across more than one checkout.

Today, a duplicate callsign can be treated as a conflict even when it points to the same shared squad. That blocks a common shared-squad flow:

1. A user registers callsign `foo` from clone A.
2. The same user later works in clone B of the same shared squad or related repository.
3. Running `register --callsign foo` from clone B should preserve clone A and add clone B.
4. Later commands can resolve `foo` from either clone through `clones[]` or through normalized remote URL matches in `origins[]`.

This piece keeps registry entry identity anchored by callsign and stored squad path. It does not introduce command migration, assignment behavior, or resolver priority changes.

## Scope and files

In scope:

- Add `cwd?: string` to the register command options as a test seam and runtime source for Git context collection.
- Update `packages/squad-cli/src/commands/register.ts` so duplicate callsigns with the same stored squad path merge `clones[]` and `origins[]`.
- Add shared Git-root detection for CLI commands in `packages/squad-cli/src/lib/git-root.ts` if it is not already available from a predecessor piece.
- Ensure `packages/squad-cli/src/commands/init.ts` uses the shared Git-root helper rather than duplicating command-level Git-root logic.
- Reuse `collectCwdRemoteUrls()` and `normalizeRemoteUrl()` from `packages/squad-sdk/src/resolution-v2.ts` for remote collection and origin deduplication.
- Add focused CLI tests for merge, deduplication, path-conflict, and inference behavior.
- Update existing register tests so the duplicate-callsign same-path case is a merge, not an error.
- Add changesets for CLI behavior and test-specified command behavior.

Out of scope:

- Changing the registry JSON schema.
- Rewriting existing registry entries during read.
- Changing resolver priority or resolver error behavior.
- Adding a force-overwrite path replacement mode.
- Migrating users from `register` to later lifecycle commands.
- Changing `--origin` or `--clone` explicit append modes beyond any deduplication needed for consistency.

Expected files from the manifest:

- `.changeset/*register*merge*.md`
- `packages/squad-cli/src/commands/init.ts`
- `packages/squad-cli/src/commands/register.ts`
- `packages/squad-cli/src/lib/git-root.ts`
- `packages/squad-sdk/src/resolution-v2.ts`
- `test/cli/register-merge.test.ts`
- `test/cli/register.test.ts`

If implementation finds that a listed file no longer exists after predecessor pieces, update the closest current equivalent and document the substitution in the PR description. Do not add unrelated files to reach the manifest count.

## Proposal

### Command modes

`runRegister()` supports these modes:

| Mode | Behavior |
| --- | --- |
| `--callsign foo --path <parent>` and no existing callsign | Create a new entry at `<parent>/.squad` and populate `clones[]` and `origins[]` from the current Git context when available. |
| `--callsign foo --path <parent>` and existing callsign at the same squad path | Merge current Git context into the existing entry. Do not create a duplicate entry. |
| `--callsign foo --path <parent>` and existing callsign at a different squad path | Throw a path-conflict error. Preserve the existing registry entry. |
| `--callsign foo` and existing callsign | Merge current Git context into the existing entry using the entry's stored path. |
| `--callsign foo` and no existing callsign | Infer the squad path from the current Git root when a `.squad/` directory exists, then create a new entry. |
| `--callsign foo --origin <url>` | Append an origin to an existing entry. Unknown callsigns remain an error. |
| `--callsign foo --clone <path>` | Append a clone path to an existing entry. Unknown callsigns remain an error. |

### Merge semantics

For an existing callsign, registration is a merge only when the effective stored squad path is the same as the existing entry's `path`.

- `--path` continues to mean the parent directory. The command stores `<parent>/.squad`.
- A parent path with trailing slashes resolves to the same effective stored squad path as the same parent without trailing slashes.
- Path equality uses the shared path comparison contract from piece 04: resolve paths before comparison, compare case-insensitively on Windows and macOS, and compare case-sensitively on Linux.
- If the effective stored squad path differs from the existing entry path, throw a configuration error that clearly identifies a path conflict and suggests using a different callsign or a future explicit overwrite mechanism. Do not overwrite `path`, `clones[]`, or `origins[]`.
- If no new clone or origin is discovered from the current working directory, the merge is a no-op and succeeds.

Clone merging:

- Discover the current clone root by running `git rev-parse --show-toplevel` from `opts.cwd ?? process.cwd()`.
- Normalize Git's output to OS-native separators before storing it.
- Append the clone root only when it is not already present under the same path comparison contract used for clone matching.
- Preserve existing clone strings exactly as stored. Do not rewrite old entries to realpaths or normalized casing.
- Do not add a clone when the current working directory is not in a Git repository.

Origin merging:

- Discover fetch remotes through `collectCwdRemoteUrls(cwd)`.
- Deduplicate by the canonical key produced by `normalizeRemoteUrl()` from piece 03.
- Preserve the first stored string for a canonical URL. If the registry already contains `https://github.com/owner/repo.git`, a later `git@github.com:owner/repo` remote must not add a second origin for the same repository.
- Preserve original URL strings for newly added origins. Canonical URL strings are comparison keys only.
- If multiple remotes in the current checkout canonicalize to the same URL, record only one of them, matching the piece 03 remote collection contract.

### Path inference without `--path`

When a callsign does not already exist and the user omits `--path`, the command attempts a first-register inference from the current Git root:

1. If `<gitRoot>/<callsign>/.squad` exists, store that path. This supports a host repository that contains more than one shared squad directory.
2. Otherwise, if `<gitRoot>/.squad` exists, store that path. This supports a single-squad checkout.
3. If both exist, choose the callsign-suffixed path because it is more specific.
4. If neither exists, throw an error that names both tried paths and tells the user to pass `--path`.
5. If no Git root is available, throw the existing unknown-callsign/new-registration guidance.

### Conflict handling

Callsign conflict handling is deliberate:

- Same callsign + same stored squad path: merge.
- Same callsign + different stored squad path: error; do not overwrite.
- Different callsign + same stored squad path: error; preserve registry uniqueness.
- Clone or origin overlap with another entry remains a warning for append-style modes unless predecessor behavior already requires a stronger error.
- Ambiguous resolution caused by overlapping registry entries remains the resolver's responsibility. This piece avoids creating duplicates for the primary same-callsign shared-squad path.

## Tests

Add `test/cli/register-merge.test.ts` with focused coverage:

| Test | Assertion |
| --- | --- |
| First register with `--path` | Creates one entry and populates `clones[]` and `origins[]` from the current Git context. |
| Second register with `--path` from another clone | Extends the existing entry instead of throwing or creating a duplicate. |
| Callsign-only re-register | Uses the existing entry path and merges the current clone and remotes. |
| Multi-squad host inference | When `<gitRoot>/<callsign>/.squad` exists, stores that path. |
| Single-squad inference | When only `<gitRoot>/.squad` exists, stores that path. |
| Inference disambiguation | When both inferred paths exist, the callsign-suffixed path wins. |
| Inference failure message | Unknown callsign without `--path` names both tried `.squad` paths. |
| Idempotent repeat register | Re-registering the same clone produces no duplicate clone or origin entries. |
| Path conflict | Same callsign with a different explicit path throws a path-conflict error. |
| Path normalization | Trailing slash on the same parent path is treated as the same stored squad path. |
| Origin URL normalization | HTTPS and SSH forms for the same repository deduplicate to one origin entry. |

Update `test/cli/register.test.ts` so the same-callsign/no-path case reflects the merge contract. Keep explicit unknown callsign, relative path, parent-directory convention, `--origin`, and `--clone` tests aligned with the existing command surface.

Validation commands:

```powershell
npm run build
npm test
```

For targeted development, run the affected CLI register tests first, then run the full verification before the PR is ready.

## Compatibility and rollback

This piece is non-breaking for registry files and SDK consumers.

Compatibility shape:

- Registry entries keep the same `version: 1` shape.
- Existing `path`, `clones[]`, and `origins[]` strings are preserved unless a new clone or origin is appended.
- Duplicate callsign registration becomes more permissive only for the same stored squad path.
- Explicit `--origin` and `--clone` modes remain lookup-by-callsign flows and still fail for unknown callsigns.
- Resolver behavior stays compatible because this piece writes data in the format the resolver already reads.

Rollback shape:

- Revert the register command merge logic, Git-root helper extraction, related tests, and changesets together.
- If the helper extraction is retained by other commands, roll back only the register call sites and tests while preserving the shared helper.
- No registry migration is required. Entries created by this piece remain valid under the existing schema, even if later registration behavior is reverted.

## Notes

Follow Microsoft Style Guide: use direct, factual wording in code comments, test names, errors, and PR text.

Do not describe this work as copying older work. Treat the behavior as forward design for shared-squad discovery.

Keep piece 03 normalization rules authoritative for origin comparison. This piece should call the existing normalization helper rather than copying URL parsing into CLI command code.

Tests and API updates must move in the same commit. The merge behavior is not complete unless the register command, CLI tests, build, and full test run agree on the same callsign/path merge contract.

