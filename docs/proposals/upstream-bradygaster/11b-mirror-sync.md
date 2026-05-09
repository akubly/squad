# 11b — Mirror sync

## Summary

> Stack position: Tier 5, depends on 11a.

This piece keeps the canonical `squad.agent.md` template and its secondary template locations byte-for-byte identical. It is a mechanical follow-up to 11a: 11a defines the governance content, and this piece ensures every runtime context reads the same content.

## Problem

`squad.agent.md` is read from more than one location. The canonical source lives at `.squad-templates/squad.agent.md`, but package builds, repository-local agent discovery, and template consumers read from mirrored locations.

If only one copy is updated, users can receive different governance instructions depending on how Squad is invoked. That creates prompt drift: the same project can resolve teams differently, enforce different failure behavior, or describe different coordinator rules based only on which template path was loaded.

## Proposed change

Extend template synchronization so `.squad-templates/squad.agent.md` is propagated to all secondary template locations that need the agent file:

| Purpose | Path |
|---------|------|
| Canonical source | `.squad-templates/squad.agent.md` |
| Root template mirror | `templates/squad.agent.md.template` |
| CLI package template mirror | `packages/squad-cli/templates/squad.agent.md.template` |
| SDK package template mirror | `packages/squad-sdk/templates/squad.agent.md.template` |
| Repository agent mirror | `.github/agents/squad.agent.md` |

The package template mirrors use the `.template` suffix so local Copilot agent discovery does not load package template copies as active agents. The `.github/agents/` mirror remains unsuffixed because that directory is an active agent discovery location.

If package runtime code needs an unsuffixed package-local `squad.agent.md`, keep that copy generated from the same canonical source and include it in the parity test. Do not hand-edit any mirror content.

## Files

Expected touched files:

| File | Purpose |
|------|---------|
| `.github/agents/squad.agent.md` | Active repository mirror of the canonical governance template. |
| `scripts/sync-templates.mjs` | Sync logic for propagating `squad.agent.md` to the secondary locations. |
| `test/template-sync.test.ts` | Byte-equality gate for canonical and mirrored template content. |
| `.changeset/{name}.md` | Patch changeset for template packaging behavior. |

This piece should not change the governance wording from 11a. If the content itself needs edits, make them in 11a or in a later governance-content piece, then re-run sync.

## Test surface

`test/template-sync.test.ts` is the parity gate for this piece.

Required coverage:

1. `node scripts/sync-templates.mjs` exits successfully.
2. `.squad-templates/squad.agent.md` and each mirrored `squad.agent.md` copy compare equal at the byte level.
3. `.github/agents/` contains only the active `squad.agent.md` mirror from this sync path.
4. If unsuffixed CLI or SDK package copies exist for runtime install behavior, they also compare byte-for-byte equal to `.squad-templates/squad.agent.md`.

Verification commands:

```bash
npm test -- template-sync.test.ts
npm run build
```

## Acceptance criteria

- Updating `.squad-templates/squad.agent.md` and running the sync script refreshes every secondary template location listed above.
- `template-sync.test.ts` fails on any byte drift between the canonical template and a mirror.
- No mirror contains local edits that are not present in the canonical source.
- The change follows the Microsoft Style Guide: concise, factual naming and comments; no promotional or historical framing.
- The implementation is forward design: one canonical template, deterministic generated mirrors, and one automated parity gate.

## Notes

The mirrors exist because different runtime contexts read templates from different places: package consumers read package templates, repository-local agent discovery reads `.github/agents/`, and template tooling reads the root template mirror. The design should make those locations distribution details, not separate sources of governance truth.

Keep this piece small. It should be sync wiring plus parity tests, not a rewrite of the 11a governance content.
