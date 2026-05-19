---
"@bradygaster/squad-cli": patch
---

doctor: add registry health warnings, --normalize-callsigns, and --purge

Extends `squad doctor` with three registry maintenance capabilities:

- **Registry health warnings**: active entries with empty `clones[]`, clone
  path ambiguity across entries, and origin overlap across active entries are
  now reported with `warn` severity in the default doctor path.

- **`--normalize-callsigns`**: detects callsign pairs whose lowercased values
  collide (e.g. `MyTeam` and `myteam`). Default is dry-run; `--apply` merges
  each pair into a deterministic survivor (prefer active, then more clones,
  then registry order). `--yes` skips per-merge confirmation.

- **`--purge <callsign>`**: removes a registry entry entirely. Refuses when the
  entry is active with clone consumers (exit 2). Leaves the squad host directory
  on disk untouched.

The no-flag `squad doctor` path is unchanged.
