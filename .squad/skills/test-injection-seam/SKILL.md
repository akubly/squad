---
name: "test-injection-seam"
description: "Inject side-effectful helpers through options for focused command tests"
domain: "testing"
confidence: "medium"
source: "extracted from FIX-1/FIX-2 upgrade seams"
---

## Context

Command code often needs to call side-effectful SDK or filesystem helpers near the end of a larger flow. Tests should verify the command's branching and arguments without performing the real side effect or relying on module-level mocks.

## Pattern

- Add an optional function property to the command options interface, e.g. `someInstaller?: typeof realInstaller`.
- In production code, select `const installer = options.someInstaller ?? realInstaller` at the call site.
- In tests, pass a recording stub for happy-path argument assertions or a throwing stub for non-fatal warning paths.
- Keep the seam narrow: inject only the helper being tested, not the whole command dependency graph.

## Example

```ts
export interface UpgradeOptions {
  copilotPayloadInstaller?: typeof installCopilotPayload;
}

const payloadInstaller = options.copilotPayloadInstaller ?? installCopilotPayload;
const result = payloadInstaller({ hostDir, callsign, copilotHome });
```

## Anti-Patterns

- Replacing static imports with dynamic imports only to make tests mockable.
- Injecting broad service objects when a single helper function is enough.
- Adding a seam without tests that exercise both success and failure behavior.
