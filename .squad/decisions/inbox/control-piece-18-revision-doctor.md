# Decision: Piece 18 Doctor Enhancements Revision

**Author:** CONTROL  
**Date:** 2026-05-19  
**Branch:** `akubly/upstream-18-doctor-enhancements` → `c515745b`

## Context

EECOM authored piece 18 (`feat(doctor)`) at commit `1a55178a`. The adversarial review (Flight + FIDO REJECT + RETRO) produced 7 blocking fixes and 5 nit fixes. EECOM is locked out per strict lockout protocol. CONTROL was assigned revision.

## Decisions Made

### 1. `noRegistry` variant for absent/corrupt registry

**Decision:** `runDoctorPurge` now returns `{ noRegistry: true }` when the registry file is absent or corrupt, rather than bubbling a `SquadError` or returning `{ notFound: ... }`. CLI dispatch prints "No registry found." and exits 1.

**Rationale:** Corrupt/absent registry is a different error class than "callsign not found in a valid registry." Callers (CLI and tests) need to distinguish these to provide actionable messages without catching exceptions in the dispatch layer.

### 2. Try/catch around `loadRegistryFromDisk` in `runDoctorPurge`

**Decision:** Wrap `loadRegistryFromDisk` in try/catch so corrupt JSON (which throws `SquadError`) is caught and mapped to `{ noRegistry: true }` rather than propagating.

**Rationale:** `loadRegistryFromDisk` throws on malformed JSON by design (in `packages/squad-sdk/src/registry.ts`). The purge function must handle this gracefully rather than letting the CLI catch block print an unhandled error.

### 3. Async `promptFn` replaces sync `readLine`

**Decision:** `RunDoctorPurgeOpts.readLine?: () => string` is replaced by `promptFn?: (question: string) => Promise<string>`. Default implementation uses readline with a Promise.

**Rationale:** Sync readline blocks the event loop in non-TTY test environments. The async pattern matches the promptFn convention used in `runDoctorNormalize` and allows proper test injection without blocking.

### 4. CRLF normalization via `git add --renormalize`

**Decision:** Applied `git add --renormalize` to force LF normalization in the index for all modified `.ts` files. Also cleaned up 7 pre-existing trailing-whitespace lines in `cli-entry.ts` that were exposed by the normalization.

**Rationale:** `core.autocrlf=true` does not re-normalize files already committed as CRLF. `--renormalize` is the correct tool. Pre-existing trailing whitespace was a latent `git diff --check` failure that needed cleanup to pass the whitespace gate.

### 5. Callsign validation regex `^[A-Za-z0-9_-]+$` (max 64 chars)

**Decision:** Added `_CALLSIGN_RE = /^[A-Za-z0-9_-]+$/` validation in `runDoctorPurge` before any registry I/O. Returns `{ invalidCallsign: true }` for violations.

**Rationale:** Prevents path traversal and injection attacks via crafted callsign arguments. Pattern matches the piece-02 callsign format constraint and mirrors the validation in `runInit`.
