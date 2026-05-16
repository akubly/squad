# Decision — Optional package-local squad.agent.md mirrors stay generated

- **Date:** 2026-05-15T23:49:57.391-07:00
- **Owner:** EECOM
- **Status:** Accepted

## Context

Some package runtime flows may materialize an unsuffixed `squad.agent.md` inside `packages/*/templates/` for install-time behavior. The tracked package mirrors remain the `.template` files, but any unsuffixed package-local copies still need to carry the same governance bytes.

## Decision

Keep `.squad-templates/squad.agent.md` as the only authored source. When an unsuffixed package-local `squad.agent.md` already exists, `scripts/sync-templates.mjs` refreshes it from the canonical source, and `test/template-sync.test.ts` verifies parity.

## Consequences

- Package-local active copies do not drift away from the canonical governance template.
- The `.template` mirrors remain the default distribution files, so local agent discovery still sees only `.github/agents/squad.agent.md` as the active repository mirror.
