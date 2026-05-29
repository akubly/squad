---
"@wifi-aware/squad-sdk": patch
"@wifi-aware/squad-cli": patch
---

Scrub stale `@bradygaster` package scope references from source, config, tests, samples, and skill templates.

All import paths, dedupe config, CLI error messages, JSDoc `@deprecated` notices, and skill template code examples now reference the canonical `@wifi-aware` scope. No public API changes; the `resolveSquad` deprecated alias re-export is unchanged.
