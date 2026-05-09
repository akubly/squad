# 17 — Fuzzy-match Did-You-Mean helper

## Summary

This piece adds a small CLI utility for suggesting the closest known command or callsign when user input is not recognized. It keeps suggestion logic deterministic, dependency-free, and shared by the error paths that already know the valid candidate set.

Stack position: Part 17/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 13 — Hard-remove register. This is a non-breaking CLI usability improvement.

## Context

Several CLI paths can identify the complete list of valid alternatives at the point where they report an error:

- top-level command dispatch knows supported commands;
- interactive slash-command dispatch knows supported slash commands;
- callsign-based flows can read available registry callsigns;
- lifecycle and health commands can decide whether a missing callsign should include a suggestion.

Without one shared helper, each path either omits a suggestion or implements its own matching rule. That creates inconsistent output and makes thresholds hard to test.

## Scope and files

In scope:

- Add a pure fuzzy-match helper in `packages/squad-cli/src/utils/fuzzy-match.ts`.
- Export two functions: a string-distance primitive and a suggestion helper.
- Use the helper only from error paths where the caller already has a finite candidate list.
- Keep suggestion text optional: no close candidate means no `Did you mean` clause.
- Add focused unit tests for exact matches, close matches, threshold misses, ties, empty input, and Unicode safety.
- Add a CLI changeset.

Out of scope:

- Adding a runtime dependency for fuzzy matching.
- Ranking or printing multiple suggestions.
- Changing command parsing, callsign validation, registry shape, or resolver priority.
- Performing filesystem or registry I/O inside the utility.

Expected files from the manifest:

| Path | Role |
| --- | --- |
| `.changeset/fuzzy-match-helper.md` | CLI changeset |
| `packages/squad-cli/src/utils/fuzzy-match.ts` | implementation |
| `packages/squad-cli/src/utils/__tests__/fuzzy-match.test.ts` | unit tests |

Consumer touchpoints should stay surgical. If the replay branch still has local prefix matching or no suggestion in an unknown-command or unknown-callsign branch, replace only that branch with this helper and keep the existing error wording otherwise.

## Proposal

### API surface

```ts
export function levenshteinDistance(a: string, b: string): number;

export function suggestSimilar(
  needle: string,
  candidates: readonly string[],
  maxDistance?: number,
): string | null;
```

`levenshteinDistance()` is case-sensitive and returns the edit distance between two strings. `suggestSimilar()` returns the closest candidate whose distance is less than or equal to `maxDistance`; the default threshold is `2`. It returns `null` when the candidate list is empty or when no candidate is close enough.

Tie behavior is stable: when two candidates have the same best distance, return the first candidate in input order. This lets callers preserve their existing command ordering or registry ordering without adding another sort rule.

### Algorithm choice

Use Levenshtein distance rather than Jaro-Winkler.

Levenshtein is a better fit for short commands and callsigns because the threshold maps directly to user-visible edits: insertion, deletion, and substitution. A default threshold of `2` catches common mistakes such as a missing character, one extra character, or two substitutions, while avoiding broad matches for unrelated short strings.

Jaro-Winkler is useful for name matching and prefix-favored ranking, but its score threshold is less obvious in CLI errors. Prefix weighting can also over-suggest commands that share the first characters but differ in action. The CLI should prefer predictable edit distance over a similarity score that needs calibration.

### Behavior

The helper must be pure and deterministic:

- no filesystem access;
- no registry access;
- no process environment reads;
- no logging;
- no package dependencies;
- case-sensitive comparisons;
- Unicode-safe iteration using code points rather than UTF-16 code units where practical.

Recommended implementation shape:

- Convert both input strings with `Array.from()` before distance computation.
- Use a dynamic-programming implementation with two rows to keep memory bounded.
- Track only the current best candidate and best distance in `suggestSimilar()`.
- Do not special-case exact matches beyond the normal distance result of `0`.

Callers format output. For example:

```text
Unknown command: stats. Did you mean status? Run 'squad help' for usage information.
```

If `suggestSimilar()` returns `null`, callers omit the suggestion clause:

```text
Unknown command: xyz. Run 'squad help' for usage information.
```

The same rule applies to callsign errors:

- close match: include `Did you mean '<callsign>'?`;
- no match above threshold: keep the existing not-found guidance without a suggestion.

## Tests

Required utility tests:

| Test | Assertion |
| --- | --- |
| exact match | distance is `0`; suggestion returns that candidate |
| one-character typo | suggestion returns the closest candidate |
| two-edit difference | suggestion returns the candidate at the default threshold |
| three-edit difference | suggestion returns `null` at the default threshold |
| empty candidate list | suggestion returns `null` |
| empty input | suggestion returns `null` unless a candidate is within the explicit threshold |
| tie | first candidate in input order wins |
| case sensitivity | differently cased strings are not distance `0` |
| Unicode safety | accented characters and emoji do not throw |
| custom threshold | wider thresholds can opt in to a farther match |

Required caller coverage when a caller is touched:

- unknown top-level command includes a suggestion for a close known command;
- unknown slash command includes a suggestion for a close slash command;
- unknown callsign includes a suggestion when a registry callsign is within distance `2`;
- unknown callsign omits the suggestion when every callsign is farther than distance `2`.

Validation commands:

```powershell
npm run build
npm test
```

For targeted development, run the fuzzy-match unit test first, then the affected command tests before the full verification pass.

## Compatibility and rollback

This piece is non-breaking. It changes only error text for unrecognized inputs that have a close known candidate. Exit codes, command parsing, registry data, and resolver behavior stay unchanged.

Rollback shape:

- remove the fuzzy-match utility;
- remove its unit test file;
- revert any touched error branches to their previous inline behavior or no-suggestion behavior;
- remove the changeset.

No persisted data migration is required.

## Notes

Follow Microsoft Style Guide: keep error messages direct, short, and action-oriented. Use `Did you mean ...?` only when the helper returns a concrete candidate; do not apologize, speculate, or print multiple alternatives.

Keep the design forward-compatible by making the helper generic over strings. Today it can serve commands and callsigns; later command groups can reuse the same function as long as they pass a bounded candidate list and keep formatting in the caller.
