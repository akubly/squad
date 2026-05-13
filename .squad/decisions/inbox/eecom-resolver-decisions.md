# EECOM Resolver Decisions — piece 03

**Date:** 2026-05-13  
**Author:** EECOM  
**Piece:** 03 — clones/origins resolver + init-mode guard

---

## Decision 1: Sentinel-bounded containment uses `clone + path.sep`

**Context:** `clonesMatch(cwd, clone)` must not match sibling directories with a shared prefix (e.g., `D:\git\repo` must not match `D:\git\repo-tools`).

**Decision:** Containment check is `cwd.startsWith(clone + path.sep)`, not `cwd.startsWith(clone)`. Exact equality is checked first via `pathsRefSameLocation`. A realpath-based fallback handles symlinked directories.

**Rationale:** The `path.sep` sentinel is the minimum-sufficient guard. Prefix-only matching introduces false positives that are difficult to diagnose in production. The sentinel approach is O(1) and requires no filesystem access for the common case.

---

## Decision 2: INVALID_CLONE_ENTRY throws, does not fall through

**Context:** A relative path in `registry.clones[]` cannot be resolved without the caller's cwd — which is already consumed before `clonesMatch` is called.

**Decision:** `clonesMatch` throws `SquadError('INVALID_CLONE_ENTRY')` for relative clone entries rather than returning false or skipping. This surfaces misconfigured registries immediately rather than silently producing incorrect results.

**Rationale:** Silent skip would allow a misconfigured registry to pass all gates and then fail at runtime when the clone entry matters. Throwing makes the misconfiguration visible and actionable.

---

## Decision 3: Steps 4–5 silently fall through on missing registry

**Context:** Steps 1 and 3 (callsign-based) throw `REGISTRY_MISSING` when the registry file is absent, because a callsign resolution without a registry is always a caller error. Steps 4–5 (clones/origins) have no such precondition.

**Decision:** Steps 4–5 are wrapped in `try/catch` with an `fs.existsSync` guard. A missing or malformed registry causes fallthrough to the next step, not a throw.

**Rationale:** A caller that passes no callsign and is in a repo with no relevant registry entries is a normal state (e.g., first-time setup). Throwing would break the init-mode flow where `resolveSquad` returning null is the expected signal.

---

## Decision 4: collectCwdRemoteUrls deduplicates by canonical URL

**Context:** A repository may have the same remote in both SSH and HTTPS forms, or may have duplicate remotes added under different names.

**Decision:** `collectCwdRemoteUrls` deduplicates by the normalized/canonical form of each URL but returns the original raw strings. Only `(fetch)` lines are parsed.

**Rationale:** Returning raw strings preserves the registry contract (stored entries are verbatim). Deduplication by canonical form prevents the same logical remote from generating multiple origin matches.

---

## Decision 5: Platform fallback uses XDG_DATA_HOME, not XDG_CONFIG_HOME

**Context:** Two different path-resolution concepts exist in the codebase: registry file location and platform `.squad/` location.

**Decision:** Registry file: `XDG_CONFIG_HOME` → `~/.config/squad/registry.json`. Platform `.squad/` directory: `XDG_DATA_HOME` → `~/.local/share/squad/.squad`. These are different directories with different env var overrides.

**Rationale:** Config files (registry.json) and data directories (.squad/) follow different XDG conventions. Conflating them would cause unexpected behavior when users override only one.
