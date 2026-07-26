---
name: "doctor-check-pattern"
description: "Reusable pattern for adding legacy squad doctor checks with deterministic tests"
domain: "diagnostics"
confidence: "high"
source: "extracted from piece 21 FIX-3/FIX-9"
---

## Context

Legacy `squad doctor` checks live in `packages/squad-cli/src/cli/commands/doctor.ts`. Until piece 22 unifies doctor surfaces, new legacy checks should be small, exported predicates that return one `DoctorCheck` or `undefined` for an intentional skip.

## Pattern

1. Define the check as `export function checkThing(cwdOrSquadDir: string, optionalTestSeam?: string): DoctorCheck | undefined`.
2. Return `undefined` only when the check is inapplicable, not when the artifact is missing.
3. Missing upgrade-repairable artifacts should include the hint `Run 'squad upgrade'`.
4. Wire mandatory checks with `checks.push(checkThing(...))` and optional checks with a temporary variable plus `if (result) checks.push(result)`.
5. Add `// TODO(piece-22): merge into unified doctor` above checks added before the unified doctor refactor.
6. Test the check function directly for pass/warn/fail/skip cases, using injectable seams such as `homeDir` instead of touching user-global paths.

## Parent-Pattern Coverage

For file convention checks, split each configured rule or existing line on whitespace and compare only the path/pattern token. Ignore blank lines, comments, and negated gitignore lines. Treat an existing parent directory pattern as coverage when the candidate path starts with that parent plus `/`; for example, `.squad/` covers `.squad/log/**` and `.squad/log/`, but does not cover `.squad-workstream`.
