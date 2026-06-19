---
"@bradygaster/squad-cli": patch
---

Resolve the team root's real git directory via `git rev-parse --absolute-git-dir` in the cross-repo publish and hydrate paths (fixing monorepo subdirectory team roots whose real `.git` is at the repo root), thread `--registry-path` through `sync`, and make the `SQUAD_TEAM_ROOT` override resolve the registry callsign/state config.
