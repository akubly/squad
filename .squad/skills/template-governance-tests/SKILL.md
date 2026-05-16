---
name: template-governance-tests
description: Keep coordinator governance template changes deterministic and mirrored
---

## Context

Coordinator template text is executable governance. A wording change can alter startup behavior even when no TypeScript API changes.

## Pattern

1. Change the canonical source in `.squad-templates/` first.
2. Run `node scripts/sync-templates.mjs` so all mirrors match the canonical source.
3. Add semantic assertions to `test/template-sync.test.ts` for required behavior, not just byte-for-byte parity.
4. Keep assertions resilient to Markdown formatting around labels while still checking the exact behavioral requirement.
5. If runtime packaging needs an unsuffixed package-local `squad.agent.md`, keep it generated from sync and assert that it collapses back to the canonical bytes when present.

## Anti-patterns

- Editing only a mirror template.
- Relying on parity tests to catch missing governance requirements.
- Asserting an entire prompt paragraph when a focused behavior phrase is sufficient.
- Hand-maintaining optional package-local `squad.agent.md` copies outside the sync path.
