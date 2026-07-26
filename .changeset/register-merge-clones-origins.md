---
'@bradygaster/squad-cli': minor
---

feat(cli): register merges clones[] and origins[] on re-registration

- Re-registering an existing callsign at the same squad path now merges rather than rejects or overwrites
- `runRegister` accepts `origin` (remote URL) and `clone` (git root path) options to append to an existing registry entry
- `--path` is now optional: inferred from the git root's `.squad/` directory if omitted
- New `'merged'` outcome returned when an existing entry is updated with new git context
- `'reactivated'` and `'already-active'` outcomes removed: the type is now `'registered' | 'merged'`
- Different callsign registering the same squad path is now a hard error (path-uniqueness guard)
- New `--origin <url>` and `--clone <path>` CLI flags for targeted append operations
- `lib/git-root.ts` added as shared helper for OS-aware git root detection via `git rev-parse --show-toplevel`
- `init` command now uses shared `getGitRoot` helper for callsign derivation when target dir is the git root
