# GNC

> Guidance, Navigation, and Control Officer

## Learnings

### ESM Compatibility Layer
@github/copilot-sdk@0.1.32 has broken ESM import (session.js uses 'vscode-jsonrpc/node' missing .js extension). Two-layer fix: (1) lazy-load copilot-sdk so init/build/watch don't trigger it, (2) postinstall patch in packages/squad-cli/scripts/patch-esm-imports.mjs. Runtime Module._resolveFilename patch in cli-entry.ts for npx where postinstall doesn't run.

### Node Version Requirements
Node.js ≥20 required. Node 24+ enforces strict ESM resolution (no extensionless imports). cli-entry.ts has runtime check that warns about node:sqlite availability (≥22.5.0).

### PR #474 Review & Merge — Node 22 ESM Fix (2026-03-22)

Reviewed and merged PR #474 (Node 22 ESM compatibility + bonus exports key fix). Addresses module resolution failures on Node 22 strict ESM enforcement.

**Fix pattern:** Node 22 ESM compatibility requires two checks: (1) explicit exports map in package.json (exports key with conditions), (2) actual module paths must match exports map entries. Mismatch between declared exports and actual files causes MODULE_NOT_FOUND errors. Build-time validation: check that every exports entry points to a file that exists.

**Key learning:** ESM exports key and actual module structure must stay in sync. When adding new entry points, update both package.json (exports) and create the corresponding module file. Missing either step breaks consumers on Node 22+. Test matrix must include Node 22+ to catch these errors early.
### Dual-Layer ESM Fix (Issue #449)
Upgraded from single-layer session.js patch to dual-layer approach: (1) Inject `exports` field into vscode-jsonrpc@8.2.1 package.json at postinstall — this is the canonical fix that resolves ALL subpath imports at once, matching vscode-jsonrpc v9.x. (2) Keep session.js `.js` extension patch as defense-in-depth. Added `squad doctor` detection for both layers (checks vscode-jsonrpc exports field and copilot-sdk session.js import syntax). Runtime Module._resolveFilename patch in cli-entry.ts remains as Layer 3 for npx cache hits where postinstall never runs.

📌 **Team update (2026-03-25T18:11Z):** Routing regression research complete — root cause identified as combination of Squad code changes (v0.9.0 prompt saturation +33%, inlined workflows, missing 
ame param in templates #577) AND Copilot CLI platform changes (CAPCOM report). Coordinator prompt grew 711→946 lines, diluting routing constraint. Workstream config replacement broke existing routing. Agent name fix exists on dev (#577) but not shipped. Recommendations: ship #577 immediately, move features to skills, optimize coordinator prompt, create regression tests. Report in decisions inbox.

📌 **Team update (2026-05-13T18:28:28Z — Piece 04 Adversarial Review Complete):** Piece 04 (path-utils) approved. Future pieces (init fail-fast, assign, unassign, doctor) will import from centralized `@bradygaster/squad-sdk/path-utils` module. Path-safety standard established: symlink identity audit, trust boundary declaration, write-path documentation. See `.squad/decisions.md` "### 2026-05-13: Path normalization safety checks as standard" for integration test patterns and deferred findings relevant to pieces 05+.

### Piece 08c Revision — Lifecycle Fail-Closed Validation (2026-05-14T17:54:18Z)

Revised VOX's lifecycle command migration (Piece 08c) after RETRO rejection. Two RETRO blockers and two FIDO majors addressed.

**Fail-closed lifecycle resolution pattern:** After `resolveSquadV2()` returns a path from clone/origin registry matching, always validate the path still exists on disk with `existsSync + statSync().isDirectory()` before importing runners. The resolver can return a valid-looking path from a stale registry entry. The STALE_PATH check in callsign resolution (`resolveByCallsign`, lines ~175-184 of resolution-v2.ts) already did this — clone/origin matching steps 4-5 did not. Parity is now enforced.

**Malformed explicit registry throws:** Registry parse failures silently continue to the next resolution strategy by design (glob-matching fallback is reasonable). But when the caller explicitly sets `SQUAD_REGISTRY_PATH` or `opts.registryPath`, they declared an authoritative source — falling back silently is wrong. Check `!!(opts.registryPath ?? opts.env?.['SQUAD_REGISTRY_PATH'])` to detect explicit registry; throw `REGISTRY_INVALID` if parse fails. This fires before any bridge/PTY state is created.

**Dispatch-layer error surface:** Wrap `resolveSquadV2()` in a focused try/catch in `cli-entry.ts` that calls `fatal(err.message)`. This converts SDK `SquadError` instances (using the SDK's error class from `packages/squad-sdk/src/adapter/errors.ts`) into CLI SquadErrors (from `packages/squad-cli/src/cli/core/errors.ts`) so they print as `✗ {message}` through the main().catch() handler rather than a raw stack trace.

**Two different SquadError classes:** The SDK and CLI each define their own `SquadError` extending `Error`. The main() catch block checks `instanceof` against the CLI version. The `fatal()` function throws a CLI SquadError, so SDK errors must be caught and re-thrown via `fatal()` to display cleanly.

**Dispatch-level passthrough test technique:** To prove copilot args survive the squadFlags filter at the dispatch layer (not just runner-level mocks), use `runCliShort()` against the actual CLI binary with `['start', '--extra-copilot-flag', '--command', 'cmd.exe', '/c', 'exit']`. The `'Copilot flags: ...'` line is printed before PTY spawn, so it appears in stdout even if the process times out. This is the right level of test for dispatch-layer concerns — runner-level mocks only verify what the runner receives after filtering, not what the filter passes through.

**vi.waitFor vs fixed timeouts:** Runner-level tests use `void runStart(...)` then wait for mocks. `remoteBridgeCtor` is called synchronously in the mock constructor; `mockPtySpawn` is called after `await bridge.start()` resolves. Use `vi.waitFor(() => expect(mockPtySpawn).toHaveBeenCalled(), { timeout: 5_000 })` for deterministic async completion without wall-clock timing dependency.

