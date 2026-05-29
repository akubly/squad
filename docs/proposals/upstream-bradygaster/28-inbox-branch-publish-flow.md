# 28 — Inbox branch publish flow

## Summary

This piece splits the read path (`squad-state`) from the write path (`squad/inbox/*`). Developer machines become pull-only with respect to canonical state. Local state changes are published to per-developer inbox branches. A fold pipeline (defined in Piece 30) is the only writer to `squad-state`. This piece ships the three hydration/publish helpers, the provenance metadata schema, and the session shard path format.

Stack position: Part 28 of the cross-repo transport arc. Depends on Piece 26 (config schema and TEAM_ROOT/WORK_ROOT separation) and Piece 27 (`squad sync` command and `ensureStateRemote()` plumbing).

## Problem

There is no separation between authoritative state and developer publication. All developers write directly to a shared branch. This produces two failure modes:

- Concurrent publishes from separate developer machines race on a single ref. A second push after a diverging commit is a non-fast-forward conflict that requires manual resolution.
- There is no provenance record linking a published snapshot to the developer session that produced it, the base commit it was derived from, or the WORK_ROOT it was authored against.

The fold pipeline design that resolves the concurrency problem (Piece 30) requires per-developer inbox branches as its input. This piece creates that input surface.

## Proposed change

### Three helpers in `sync.ts`

Add three functions to `packages/squad-cli/src/cli/commands/sync.ts`:

**`hydrateTeamRootFromStateRef(teamRoot: string, remote: string, stateBranch: string): Promise<void>`**

Fetches `refs/remotes/<remote>/<stateBranch>` into TEAM_ROOT and checks out its tree into the TEAM_ROOT working directory. Idempotent: if TEAM_ROOT is already at the fetched commit, no work is done. Uses the existing `OrphanBranchBackend` from `state-backend.ts` rather than raw git commands.

**`hydrateWorkRootProjection(workRoot: string, teamRoot: string): Promise<void>`**

Copies the subset of TEAM_ROOT content that belongs in the ignored WORK_ROOT projection. The projection is write-through only: files in WORK_SQUAD_DIR are never treated as canonical state. Files that no longer exist in TEAM_ROOT are removed from the projection. Does not touch any file outside the `.squad/` subdirectory of WORK_ROOT.

**`publishTeamRootToInbox(teamRoot: string, remote: string, inboxBranch: string): Promise<void>`**

Creates a commit on a new branch named `squad/inbox/<developerAlias>/<yyyyMMdd-HHmmss>-<sessionId>` in TEAM_ROOT (using `inboxBranchPrefix` from config), then pushes it to the state remote. The branch is isolated to the developer's session; concurrent publishes from different developers create independent refs with no non-fast-forward relationship.

### Publish branch format

```text
squad/inbox/<developerAlias>/<yyyyMMdd-HHmmss>-<sessionId>
```

`developerAlias` must match `[a-z][a-z0-9-]{0,38}`. If the alias is absent or malformed, `publishTeamRootToInbox()` exits with a clear error before creating any branch. This validation is separate from the alias-empty guard in Piece 27; both must fire.

### Snapshot payload

Each publish commit includes the following paths from TEAM_ROOT:

- `.squad/decisions.md`
- `.squad/decisions/inbox/**`
- `.squad/log/**`
- `.squad/orchestration-log/**`
- `.squad/sessions/**`
- `.squad/identity/**`

No product-repo files may appear in the snapshot. If `publishTeamRootToInbox()` encounters a staged path outside the above list, it exits with an error.

### Session shard path format

Session files are stored under:

```text
.squad/sessions/<projectKey>/<workstream>/<sessionId>/
```

This shard format reduces fold conflicts when two developers publish sessions in the same workstream: paths diverge at the `<sessionId>` level and do not conflict.

### Provenance metadata — `.squad/publish-metadata.json`

Each publish commit includes `.squad/publish-metadata.json` with the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `developerAlias` | string | The alias from config or `--developer` flag |
| `sessionId` | string (UUID) | The session identifier |
| `sourceWorkRoot` | object | See schema below |
| `publishedAt` | string (ISO 8601 UTC) | Timestamp of the publish |
| `baseStateCommit` | string | The `squad-state` commit SHA this publish is derived from |

### `sourceWorkRoot` schema (locked by decision Q2)

`sourceWorkRoot` is an object with exactly two fields:

```json
{
  "repo": "<basename of the git work-tree>",
  "pathHash": "sha256:<hex of SHA-256 of normalized absolute path>"
}
```

The `pathHash` value is the SHA-256 hexdigest of the WORK_ROOT absolute path after normalization: lowercased, forward-slash-separated, no trailing slash.

**Hard requirement:** Raw absolute paths MUST NOT appear in any string-typed field in `publish-metadata.json`. This includes `sourceWorkRoot`, any nested field, and any future extension field. The `pathHash` form preserves cross-clone debugging signal (two clones at the same path produce identical hashes; two clones at different paths do not) without exposing the OS username or host directory structure.

This requirement derives directly from the §9 NFR annotation: "Git commit author identity is the identity floor. Metadata fields must not add incremental identity or infrastructure surface beyond that floor."

Enforcing this rule in piece 28's tests is the in-piece guard. The cross-cutting scrub-gate rule that rejects raw `Users\` or `/home/` path segments in `.squad/config.json` and `.squad/publish-metadata.json` ships in Piece 30.5 `[upstream-bound]`.

### Special scrutiny

The concurrent-publish bare-repo fixture test is the acceptance gate for this piece. It must be purpose-built: do not reuse `.test-state-backend-*` fixtures without confirming they support multi-remote bare-repo scenarios. The test must demonstrate that two simultaneous `git push` calls targeting different branches on the same remote complete without non-fast-forward errors — inbox branches are per-developer per-session, so this property holds structurally, but the test must prove it mechanically.

`publishedAt` must be serialized in ISO 8601 UTC form with a `Z` suffix, not in local time or with a UTC offset. Using local time in provenance metadata would make fold ordering ambiguous across time zones.

## Test surface

TDD: write tests to RED before implementation; verify GREEN after.

| Test file | Assertions |
| --- | --- |
| `test/cli/cross-repo-sync.test.ts` (new integration test) | (1) Two developers publish concurrently to the same bare-repo fixture without non-fast-forward conflicts; (2) A synthetic fold commit on `squad-state` can be fetched and hydrated by a third clone using `hydrateTeamRootFromStateRef()`; (3) `publish-metadata.json` in each published commit contains an object-shaped `sourceWorkRoot` (not a string); (4) No raw absolute path string — containing OS-specific path separators or `Users` / `home` segments — appears anywhere in the serialized `publish-metadata.json` content; (5) `pathHash` for a given WORK_ROOT path is identical across two separate invocations from the same clone; (6) Publishing with a missing or malformed `developerAlias` exits 1 before creating a branch |

## Files

| Path | Role |
| --- | --- |
| `packages/squad-cli/src/cli/commands/sync.ts` | Add `hydrateTeamRootFromStateRef()`, `hydrateWorkRootProjection()`, `publishTeamRootToInbox()` |
| `packages/squad-sdk/src/resolution.ts` | Export session shard path helper if resolver logic is added |
| `test/cli/cross-repo-sync.test.ts` | New — bare-repo fixture integration tests |
| `.changeset/inbox-branch-publish-flow.md` | minor changeset for `squad-cli` and `squad-sdk` |

## Notes

The fold pipeline (Piece 30) is the only entity that may fast-forward `squad-state`. No client code in this piece writes to `squad-state` directly. `publishTeamRootToInbox()` must enforce this: the only remote refs it creates are under `squad/inbox/`.

The session shard path format `sessions/<projectKey>/<workstream>/<sessionId>/` is locked at this piece. Piece 30's fold logic depends on this structure to enumerate and merge inbox payloads deterministically. Do not change the shard format after this piece ships without a coordinated update to the fold template.

Tone and record discipline applies: the state separation in this piece is the "inbox branch publish flow" — not a fork model or a branch-protection workaround.

Rollback is a single-piece revert. Inbox branches already published to the docs remote are inert if this piece is reverted: no fold pipeline will process them until Piece 30 ships.
