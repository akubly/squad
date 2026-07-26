---
'@bradygaster/squad-cli': minor
---

Add publishTeamRootToInbox and hydrateTeamRootFromStateRef state transport helpers (piece 32.5)

- Export `publishTeamRootToInbox(teamRoot, remote, developerAlias, sessionId)` — snapshots the
  allowlisted `.squad/` subtree into an orphan commit and pushes it to a per-session inbox branch
  (`squad/inbox/<alias>/<timestamp>-<sessionId>`). Validates `developerAlias` against
  `DEVELOPER_ALIAS_RE` before any git operation. Enforces allowlist hard guard before staging.
  Embeds PII-safe `publish-metadata.json` (sourceWorkRoot as `{repo, pathHash}`, no raw paths).
- Export `hydrateTeamRootFromStateRef(teamRoot, remote, stateBranch)` — fetches a state branch and
  writes its tree into the TEAM_ROOT working directory without altering HEAD. Idempotent when HEAD
  already matches the fetched commit.
- Both helpers are fully parameterized (no config.json reads, no detectBackend, no env-var
  resolution — Piece 33 owns all resolution).
- Adds test/cli/cross-repo-sync.test.ts with 8 direct assertions covering concurrent publish,
  round-trip hydrate, PII metadata, pathHash stability, idempotency, alias validation, and
  allowlist enforcement.
