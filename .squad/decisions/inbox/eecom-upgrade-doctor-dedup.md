# EECOM Decision — upgrade global agent sync, doctor misplaced `.squad`, registry dedup

## Decision

1. `squad upgrade` must refresh the global coordinator agent install when `~/.copilot/agents/squad.agent.md` already exists.
2. `squad doctor` should warn when a consumer repo contains a leaked `.squad/` directory but registry resolution points to a different squad root.
3. `upsertEntry()` is the defense-in-depth boundary for registry normalization and must deduplicate canonical `origins[]` and normalized `clones[]` before returning.

## Rationale

- Upgrade owns both the repo-local `.github/agents/squad.agent.md` mirror and the user-scoped coordinator install created by `squad assign`; letting only one refresh causes silent drift.
- The leaked consumer `.squad/` directory is real user-facing contamination but not a blocking runtime failure, so doctor reports it as `warn` severity with cleanup guidance.
- CLI callers already try to deduplicate registry values, but SDK callers can bypass that path. The registry write-preparation helper must enforce canonical uniqueness itself.

## Verification

- `npm run build`
- `npx vitest run test/cli/upgrade.test.ts packages/squad-cli/src/commands/__tests__/doctor.test.ts test/registry-schema.test.ts`
