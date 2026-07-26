# Skill: Upgrade All Installed Artifacts

**Version:** 1.0  
**Author:** EECOM  
**Date:** 2026-05-21

## Purpose

When a command upgrades a managed template that exists in more than one install location, refresh every installed copy from the same canonical helper so repo-local and user-scoped artifacts cannot drift.

## When to Apply

- A command updates an in-repo template mirror during upgrade.
- The same artifact is also installed into a user home, global tool cache, or other secondary location.
- A stale secondary copy would keep users on old prompts, skills, or bootstrap files after upgrade.

## Pattern

1. Keep one installer helper that renders the final bytes for the artifact.
2. Let init/assign use that helper for first install.
3. Let upgrade call the same helper again with a `requireExisting`/`skipIfMissing` gate so upgrade only refreshes already-installed secondary copies.
4. Make the helper compare rendered content before writing so unchanged installs stay silent.
5. Add a regression test that seeds the secondary copy with old content, runs upgrade, and asserts it now matches the refreshed primary copy.

## Guardrails

- Compare the fully rendered content, not just the template source, when version stamping or token replacement is involved.
- Skip silently when the optional secondary install does not exist.
- Emit a user-facing success line only when the secondary artifact was actually rewritten.

## Reference

- `packages/squad-cli/src/commands/assign.ts`
- `packages/squad-cli/src/cli/core/upgrade.ts`
- `test/cli/upgrade.test.ts`
