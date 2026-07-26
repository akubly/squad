---
"@bradygaster/squad-cli": major
---

Hard-remove the `register` subcommand. The shared-squad lifecycle is now `squad assign` (bind a checkout to a registered squad) and `squad init` (create a new squad host).

**Breaking changes:**

- `squad register` exits non-zero with `ERR_SQUAD_REGISTER_REMOVED` and a teaching error pointing at `squad assign` and `squad init`. Existing `squad register` scripts will fail with exit code `2`.
- The CLI package no longer exports the `./commands/register` subpath. Consumers importing `@bradygaster/squad-cli/commands/register` must migrate to `./commands/assign` (or `./commands/init` for host creation).
- `register` is removed from the help surface (`squad help`, `squad --help`).

**Migration:**

- To bind the current checkout to a registered squad: `squad assign <callsign>`.
- To create a new squad host: `squad init --callsign <name>`.
- To list registered squads: `squad list`.
- To diagnose registry state: `squad doctor`.

Existing registry files remain valid and require no migration.
