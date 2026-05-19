---
'@bradygaster/squad-cli': major
---

Refactor `squad init`: drop URL positional; add `--target-dir`, `--registry-path`, `--no-register`; reactivate inactive entries.

**Breaking change:** `squad init <url>` is removed. Clone the repository with git first, then run `squad init --target-dir <local-dir>`.

New flags:
- `--target-dir DIR` — scaffold `.squad/` under DIR (default: cwd); callsign derived from target basename
- `--registry-path PATH` — read/write a specific registry file
- `--no-register` — scaffold local files without updating the registry

Behavior changes:
- Existing `.squad/` directories with sentinel files are accepted; scaffold creation is skipped and the directory can be registered without clobbering local files
- Inactive registry entries with a matching callsign and path are reactivated (status flipped to active, all other fields preserved)
- URL-like positional arguments trigger a teaching error that shows the migration path before any filesystem or registry write
