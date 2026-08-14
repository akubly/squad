---
"@wifi-aware/squad-cli": patch
"@wifi-aware/squad-sdk": patch
---

Piece 58 — managed-onboarding ergonomics and shared-host state-bridge correctness.

- §A: register the `squad_state` bridge at the user level (local-bin `squad state-mcp`) for
  orphan/two-layer backends and skip the repo-local `.mcp.json` for those backends; `local` keeps
  the repo-local writer (decision G1). The single user-level writer is the backend-gated
  `ensureSquadStateMcpInUserConfig`, which registers ONE stable `squad_state` key (review: not a
  per-path `squad_state_<hash>`, which polluted HOME with one redundant, cwd-resolving entry per
  clone); a HOME-level GC (`tombstoneStaleHashedSquadStateInUserMcp`) reaps any stale hashed
  entries an earlier build wrote. `copilot-payload` no longer synthesizes a second, callsign-keyed
  `squad_state` entry (review F1/F2) — that duplicated the sanctioned writer during managed
  cold-start and leaked a user-level entry for `local` backends via `squad upgrade`, violating G1.
- §B: reduce `squad assign` to `--callsign` — derive the state/config branches, default
  `--skills-from host`, resolve the inbox handle by precedence (flag → `SQUAD_INBOX_HANDLE` →
  sanitized `git config user.name`, decision I), and resolve the state remote system-wide
  (flag → `SQUAD_STATE_REMOTE` → `registry.defaults.stateRemote`, decision H1). The registry
  schema/validator now tolerates and round-trips a top-level `defaults` block. Origin collisions
  are auto-detected and prompted interactively while `--yes`/non-interactive still require
  `--allow-origin-collision` (decision J). Warm-entry detection now runs before inbox-handle
  resolution so a bad `SQUAD_INBOX_HANDLE` no longer preempts the warm-assign teaching path
  (review F4).
- §C: restore the unconditional `agent_type: general-purpose|explore` dispatch invariant plus the
  explicit plugin-agent prohibition to the always-loaded coordinator body.
- §D: case-fold `normalizeRemoteUrl` (ADO + GitHub canonical outputs) in both the public
  resolver (`resolution-v2.ts`) and the registry-dedup copy (`platform/detect.ts`, review F3), so
  origins differing only in case dedup consistently for case-insensitive git hosts.
- §E: anchor `resolveSquadState` at the team `.squad/` for managed consumers (dual-root, gated on
  `paths.mode === 'remote'`) so a linked consumer resolves the host orphan backend.
