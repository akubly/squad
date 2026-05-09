# 14 — squad assign

**Stack position:** 14 of 20  
**Depends on:** 13 — hard-remove register  
**Tier:** 7  
**Breaking change:** No  
**Primary scope:** CLI shared-squad assignment

## Summary

Piece 14 adds `squad assign`, the command that links the current product clone to an existing shared squad by callsign. It also supports an explicit cold-start path where the user passes a repository URL and `--clone-to <path>` so the shared squad host is cloned before the current clone is attached.

The command is additive. It replaces no existing behavior from piece 13; piece 13 owns the removed-command teaching path, while this piece provides the target command users are redirected to.

## Problem

After registry-backed resolution exists, a product repository still needs a safe write path that records “this clone uses that squad.” Without `squad assign`, users can list or resolve registered squads, but they cannot attach a new product clone to one without editing the registry by hand.

The write path must be careful because registry entries are shared by multiple local clones. Assigning one clone must not erase another clone’s origin information, and repeating the same assign must not inflate the registry with duplicate paths or duplicate origin URLs.

## Proposed change

Add a CLI command and testable command module:

```text
squad assign <callsign> [--registry-path <file>] [--target-dir <path>]
squad assign <url> --clone-to <path> [--callsign <name>] [--registry-path <file>] [--target-dir <path>]
```

The command has two paths:

1. **Warm path:** `<callsign>` resolves an existing registry entry, validates the host path, and appends the target clone root to that entry’s `clones[]`.
2. **Cold-start path:** `<url> --clone-to <path>` clones the squad host repository first, verifies it contains `.squad/team.md`, creates or reactivates the registry entry, and then binds the current target clone.

The command writes only the user registry. It must not write marker files, configuration files, or assignment metadata into the product repository. `--target-dir` selects the product clone to bind; when omitted, the current working directory is used. `--registry-path` is passed through for tests and isolated user registries.

### Registry mutation

The registry entry remains the single source of truth:

```ts
interface RegistryEntry {
  callsign?: string;
  path: string;        // absolute path to the host .squad directory
  origins?: string[];  // normalized repository origins known for consumers
  clones?: string[];   // absolute product clone roots currently assigned
  status?: 'active' | 'inactive';
  initUri?: string;
  stateBackend?: 'worktree' | 'local' | 'external';
}
```

Assign must preserve unknown and forward-compatible fields during read-modify-write. It may set `status: 'active'` when reactivating an inactive entry. It must not create or change `stateBackend`.

### Refcount semantics

Do not add a separate `originRefCount`, `originRefs`, or per-origin counter field. The refcount is logical and is derived from `clones[]`:

- Assign increments the logical reference by adding the product clone root once to `clones[]`.
- Assign adds each current fetch remote to `origins[]` only when its normalized URL is not already present.
- Unassign in piece 15 decrements the logical reference by removing a clone root, then checks remaining clone roots to decide whether each origin URL is still referenced.

This keeps the registry format stable. `origins[]` stores the deduplicated URL set used by resolution; `clones[]` stores the consumer set that makes later clean unassign possible.

### Idempotency

Running `squad assign <callsign>` twice from the same product clone is a success and does not mutate the registry the second time. The command detects that the target Git root is already present in the target entry’s `clones[]`, returns an `alreadyAssigned` result, exits 0, and does not append duplicate clone or origin values.

If the same clone is already assigned to a different callsign, assign fails with a conflict and tells the user to unassign first. Callsign matching is case-sensitive on every platform.

### Guard order

The warm path uses this guard order:

1. Missing argument and unknown callsign errors, including a close-match suggestion when available.
2. Host path exists and contains a squad host.
3. Host-path guard: assigning from the squad host itself is a no-op.
4. Containment guard: assigning from inside an already assigned clone fails; users must run from the clone root.
5. Git-root resolution for the target clone.
6. Idempotency check for the target callsign.
7. Cross-entry `clones[]` collision check.
8. Origin collision check: one other entry sharing an origin warns and continues; two or more produce an ambiguity error.
9. Registry write.

This order prevents a subdirectory of an assigned clone from being collapsed to the Git root and incorrectly treated as idempotent.

## Cold-start clone behavior

Cold start is explicit. A URL without `--clone-to` fails with a teaching message that offers either manual `git clone` followed by `squad assign <callsign>`, or `squad assign <url> --clone-to <path>`.

When `--clone-to` is present:

- The destination is resolved to an absolute path and must not be an existing non-empty directory.
- The default callsign is derived from the final URL path segment, lowercased, with a trailing `.git` removed.
- `--callsign <name>` overrides the derived callsign.
- A callsign collision is checked before cloning. A different existing host path for the same callsign fails with a conflict and suggests choosing another callsign.
- The clone lands exactly at `--clone-to`; Squad does not choose an implicit cache or workspace location.
- If `git clone` fails, any directory created by the command is removed.
- If the cloned repository does not contain `.squad/team.md`, the clone is rolled back and the registry is left unchanged.
- If clone checkout succeeds but the default branch points to no checked-out files, the command may check out the first available remote branch before validating `.squad/team.md`.

The command must not create or modify `.npmrc`. If the cloned host repository already contains package manager configuration, that file remains repository content from the clone; assign does not copy it into the product clone, the user home directory, or the registry. Proposal and fixture review must verify no package registry configuration or tenant-specific feed setting is introduced by this piece.

## Files

Expected source and test surface:

- `.changeset/*assign*.md` — patch changeset for CLI package behavior.
- `packages/squad-cli/package.json` — export `./commands/assign` for tests and consumers.
- `packages/squad-cli/src/cli-entry.ts` — parse `assign` arguments, pass registry and target options, print success and warning output, map command errors to documented exit codes.
- `packages/squad-cli/src/commands/assign.ts` — testable implementation for warm path, cold-start path, guard ordering, registry mutation, and result shape.
- `packages/squad-cli/src/commands/__tests__/assign.test.ts` — RED/GREEN coverage for the behavior matrix.
- `vitest.config.ts` — include package command tests and add source aliasing only as needed for local test resolution.

Keep the implementation within the stack file-count target. If replay finds an equivalent file has moved after predecessor pieces, update the current equivalent and call out the substitution in the pull request description.

## Test plan

Add or keep tests for:

- Warm-path success appends the Git root to `clones[]` and normalized fetch remotes to `origins[]`.
- Repeating assign for the same callsign and clone is idempotent and creates no duplicates.
- Unknown callsign, missing argument, and close-match suggestion errors.
- Inactive entry reactivation.
- Existing assignment to another callsign fails with a conflict.
- Missing host path fails with an actionable message.
- URL without `--clone-to` fails with the cold-start guidance.
- Non-empty clone destination, pre-clone callsign collision, clone failure rollback, and no-`.squad/team.md` rollback.
- Cold-start success creates the registry entry, stores the cloned host path, records `initUri`, and binds the product clone.
- `--callsign` overrides the URL-derived callsign.
- Containment guard, host-path guard, cross-entry clone collision, one-entry origin warning, and multi-entry origin ambiguity.
- Case-sensitive callsign matching.
- Forward-compatible registry fields survive assignment unchanged.

Validation commands for the replay branch:

```powershell
npm run build
npx vitest run packages\squad-cli\src\commands\__tests__\assign.test.ts
npm test
```

## Acceptance criteria

- `squad assign <callsign>` binds the selected product clone to an existing active or inactive registry entry without writing to the product repository.
- `squad assign <url> --clone-to <path>` clones the squad host into the requested path, validates `.squad/team.md`, creates or reactivates the entry, and rolls back clone and registry changes on failure.
- Registry writes preserve existing fields and use `clones[]` plus deduplicated `origins[]` for logical refcounting; no separate counter field is introduced.
- Repeating assign for the same callsign and clone exits 0 with no duplicate registry data.
- Collision and ambiguity cases fail closed with documented exit codes and actionable messages.
- Tests cover the command API in the same commit as the CLI wiring.
- User-facing text follows Microsoft Style Guide expectations: sentence case, active voice, present tense, and no unsupported claims.

Rollback is a single-piece revert: remove the command module, CLI routing, package export, command tests, test resolver alias, and changeset. Persisted registries remain readable because this piece only uses existing optional fields and does not introduce a migration-only schema.
