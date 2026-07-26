---
"@bradygaster/squad-sdk": patch
---

Harden `resolveSquad()` init-mode guard: reject whitespace-only `cwd` with a configuration error, and throw a configuration error with code `ERR_CWD_UNREACHABLE` when `cwd` does not exist on disk or is a file rather than a directory. A reachable directory with no squad match still returns `null` — the init-mode signal that the caller may proceed to initialize.
