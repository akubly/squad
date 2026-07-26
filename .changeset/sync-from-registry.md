---
'@bradygaster/squad-cli': patch
---

Wire registry-first TEAM_ROOT resolution and cross-repo transport helpers into runSync (piece 33)

- Sub-proposal A: Replace config.json resolution with registry lookup via `loadRegistryFromDisk`.
  TEAM_ROOT order: (1) SQUAD_TEAM_ROOT env var; (2) registry entry whose `clones[]` contains the
  current git root (compared via `normalisedPathKey`); TEAM_ROOT = path.dirname(entry.path).
  stateRemote/stateBranch/developerAlias pulled from the same registry entry. Backward-compat:
  no registry match falls back to WORK_ROOT/.squad/config.json when present. Neither + push
  direction exits 1 directing to `squad assign`.
- Sub-proposal B: Wire publishTeamRootToInbox into push path. Cross-repo push (teamRoot defined)
  uses sessionId from COPILOT_SESSION_ID or randomUUID(). Single-repo push remains syncPush.
- Sub-proposal C: Wire hydrateTeamRootFromStateRef into pull path. After syncPull, if teamRoot
  is present, hydrate TEAM_ROOT sidecar from stateBranch. No sidecar hydration for single-repo.
- Sub-proposal D: SQUAD_DEVELOPER_ALIAS alias chain. Precedence: --developer flag >
  SQUAD_DEVELOPER_ALIAS env var > registry developerAlias > exit 1 (push only) referencing
  `squad assign --developer-alias`.
- detectBackend disposition: call removed from runSync; backend derived from registry presence.
- `squad sync` command wired in cli-entry.ts with --push/--pull/--both/--remote/--developer/--quiet flags.
- Adds test/cli/sync-registry-resolution.test.ts (12 unit tests, A+D sub-proposals).
- Extends test/cli/cross-repo-sync.test.ts (5 integration tests, B+C sub-proposals).
