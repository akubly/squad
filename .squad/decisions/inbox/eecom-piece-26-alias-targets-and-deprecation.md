### 2026-05-29: Deprecated alias targets and deprecation-warning mechanism for piece 26

**By:** EECOM

**What:** `projectDir` maps to `workSquadDir` (the `.squad/` directory in the product repo), not to `workRoot`. `teamDir` maps to `teamRoot` (the team repo root), not `teamSquadDir`. Deprecation fires via `Object.defineProperties` getters on the returned shape, guarded by a module-level `_deprecationFired` map (exported for test resets) so `console.warn` fires at most once per process per alias.

**Why:** The original `projectDir` semantics pointed to the `.squad/` directory (what is now `workSquadDir`), not the repo root. Mapping it to `workRoot` would have silently broken all callers that use the path to write files inside `.squad/`. Similarly, `teamDir` historically pointed at the team repo root, so it maps to `teamRoot`. The once-per-process guard prevents noisy log spam in long-running CLI sessions while still giving downstream consumers a clear migration signal. The `_deprecationFired` export is the stable test-reset contract for pieces 27+.
