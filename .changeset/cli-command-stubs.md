---
'@bradygaster/squad-cli': minor
---

feat(cli): add registry-aware init/register/list/doctor command modules

- `runInit` — scaffolds a squad project; registers to registry when `--callsign` or `--registry-path` provided
- `runRegister` — registers an existing squad project into the registry by callsign and path
- `runList` — prints a tab-separated table of all registry entries with path validity status
- `runDoctor` — checks registry health: callsign env, registry readability, entry path validity
- `isUrlLikeArg` — utility to reject URL strings passed as project paths
- CLI dispatch in `cli-entry.ts` updated to route `init`, `register`, `list`, and `doctor` to new modules
- `squad doctor` now runs both legacy system health check and new registry health check in sequence
- New subpath exports: `./commands/init`, `./commands/register`, `./commands/list`, `./commands/doctor`
- Legacy doctor preserved at `./cli/commands/doctor` for backward compatibility
