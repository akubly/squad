### 2026-05-21: TEAM_ROOT-prefixed spawn template writes

**Author:** Procedures  
**Date:** 2026-05-21T13:45:30-07:00  
**Context:** Shared-squad consumer repos run agents from the consumer repo CWD, so bare `.squad/` write paths in spawn templates leak state into the wrong repository.

## Decision

All agent-facing write paths in `squad.agent.md` spawn templates must be anchored at `TEAM_ROOT`, or at `SQUAD_DIR` when the prompt defines `SQUAD_DIR` as `{TEAM_ROOT}/.squad`.

## Rationale

`TEAM_ROOT` is the actual owner of squad state. Agent CWD is not a safe anchor in shared-squad mode, so bare relative `.squad/` paths create state pollution and break decision/history hygiene.

## Applies to

- Agent AFTER-work writes
- Lightweight template decision writes
- Scribe prompt file operations
- Team-root-resolved read instructions that should stay aligned with write paths
