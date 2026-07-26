# Skill: OS-Aware Path Dedup Integration Test

**Version:** 1.0  
**Author:** EECOM  
**Date:** 2026-05-13T11:28:28.990-07:00

## Purpose

Whenever a piece adds or modifies OS-aware path equality logic (case-insensitive on win32/darwin, case-sensitive on linux), write a cross-case dedup integration test that exercises the full registry or resolver layer — not just the unit helper.

## When to Apply

- Any piece touching `normalisedPathKey`, `pathsRefSameLocation`, or `clonesMatch`.
- Any piece that adds path deduplication logic to the registry schema validator.
- Any piece that gates logic on `process.platform`.

## Pattern

```typescript
it('S9b rejects registry with case-variant duplicate paths on win32/darwin', () => {
  // Construct two paths that differ only in case of the directory segment.
  // Keep the filename itself lowercase so `.endsWith('.squad')` validation passes.
  const pathA = path.join(dir.toLowerCase(), 'alpha.squad');
  const pathB = path.join(dir.toUpperCase(), 'alpha.squad');
  const registry = JSON.stringify({
    version: 1,
    squads: [
      { callsign: 'one', path: pathA },
      { callsign: 'two', path: pathB },
    ],
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    // Case-insensitive: both paths normalize to the same key → duplicate error.
    expect(() => parseRegistry(registry)).toThrow(/duplicate.*path/i);
  } else {
    // linux: case-sensitive — the two paths are distinct, no duplicate.
    expect(() => parseRegistry(registry)).not.toThrow();
  }
});
```

## Key Constraints

1. **Filename stays lowercase.** Only lowercase/uppercase the _directory_ portion of the path (`dir.toLowerCase()`, `dir.toUpperCase()`). The `.squad` extension must remain lowercase to pass the `endsWith('.squad')` validation in `validateEntry`.

2. **Use in-test platform branching** — not separate `it` blocks with `if (platform !== ...) return`. In-test branching makes both outcomes visible and explicit.

3. **Target the real layer, not the unit helper.** S9b calls `parseRegistry` (the registry schema validator), not `normalisedPathKey` directly. The integration path confirms that the validator correctly propagates OS-aware key comparison.

4. **Error matcher:** Assert `toThrow(/duplicate.*path/i)` to match the actual error message emitted by `validateRegistry`. Do not hardcode the full message string (it may change); use the regex.

## Companion Unit Tests

Unit tests for the helper itself (e.g., PK.4, PK.5, PK.6 in `path-utils.test.ts`) verify the helper's own behavior. S9b is the integration layer. Both are required; they are not redundant.

## Reference

- Piece 04 spec: `docs/proposals/upstream-bradygaster/04-path-utils-upsert-rename.md`
- First use: `test/registry-schema.test.ts` — S9b test
- Implementation: `packages/squad-sdk/src/path-utils.ts` — `normalisedPathKey`, `normCase`
- Registry validator: `packages/squad-sdk/src/registry.ts` — `validateRegistry`
