---
name: "team-root-write-discipline"
description: "Anchor spawn-template squad state writes at TEAM_ROOT or SQUAD_DIR to avoid CWD leaks in shared-squad repos"
domain: "prompt-architecture"
confidence: "high"
source: "earned"
---

## Context
This skill applies when editing Squad spawn templates, Scribe prompts, or any agent instructions that read or write `.squad/` state. In shared-squad consumer repos, agent CWD can differ from the owning team root.

## Patterns
- Every agent write path must use `{TEAM_ROOT}/.squad/...` or `{SQUAD_DIR}/...`.
- If a prompt needs many squad-state paths, define `SQUAD_DIR: {TEAM_ROOT}/.squad` once and reuse it.
- Keep init-mode scaffold instructions bare `.squad/` only when the current repo is becoming TEAM_ROOT.
- Keep git-root-relative `git add` / `git checkout` examples explicitly marked when they intentionally differ from `SQUAD_DIR` file writes.

## Examples
- `APPEND to {TEAM_ROOT}/.squad/agents/{name}/history.md under "## Learnings":`
- `If you made a meaningful decision, write to {TEAM_ROOT}/.squad/decisions/inbox/{name}-{brief-slug}.md`
- `SQUAD_DIR: {TEAM_ROOT}/.squad`
- `Write {SQUAD_DIR}/orchestration-log/{timestamp}-{agent}.md`

## Anti-Patterns
- `APPEND to .squad/agents/{name}/history.md ...`
- `write to .squad/decisions/inbox/...`
- `powershell .squad/scripts/notes/write-note.ps1 ...` when the prompt may run outside TEAM_ROOT
- Mixing `SQUAD_DIR` writes with unmarked git-root-relative paths
