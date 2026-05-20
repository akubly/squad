# 21 — Post-stack adversarial review fixes

## Summary

This piece collects the defects and small gaps that surface when an adversarial reviewer reads the complete twenty-piece stack end to end. Each item below is a discrete, optional sub-proposal. The team evaluates each one and decides whether to include it, defer it, or reject it. The piece ships as a single squashed commit containing only the sub-proposals the team accepts.

Stack position: Part 21 of the registry-backed resolution and shared-squad command surface stack. Depends on 20 — CLI reference and shared-squad guide. The piece is purely additive — every change is either a new test, a new helper, a corrected behavior on an existing surface, or a clearer error message. No public command shape changes.

## Problem

After the lifecycle surface and its documentation are complete, a reviewer reading the stack as a whole identifies eight categories of small defects and gaps. None of them block the stack from being usable. All of them are visible to a careful user, a CI run on a less-common platform, or a developer following the docs strictly. Left alone they will appear as user-facing issues after release.

The categories:

1. Path equality fails for users whose clone is reached through a symlink, junction, or `fs.realpath`-resolved path. The same problem makes exit-3 disambiguation silent when origin matching finds more than one candidate.
2. Azure DevOps URL normalization stops at the generic SSH branch, so an SSH-cloned consumer does not match an HTTPS-registered origin even though both refer to the same repository.
3. The Azure DevOps platform adapter accepts `@me` for the current user but never resolves it to an identity.
4. `squad init <url>` silently accepts the URL and proceeds with an unintended scaffold instead of guiding the user to `squad assign <url> --clone-to <path>`.
5. `squad status` reports the same single-line summary whether the squad was resolved from a local `.squad/` directory or from the registry, so users cannot see which entry matched, why, or where the registry lives.
6. `squad doctor --help` does not list `--purge` or `--normalize-callsigns`, even though both flags are documented in the CLI reference.
7. The Copilot payload source path documentation and the assignment deploy step do not consistently agree on the canonical location of the squad agent file.
8. `squad init --callsign <name>` is not idempotent on an existing scaffold, so a repeat invocation fails instead of refreshing the registry entry.

The piece proposes one focused sub-proposal per category. Sub-proposal G is the only one rooted in end-to-end smoke testing; the others are review findings.

## Proposed change

Each sub-proposal below is independently evaluable. For each one the team decides **accept**, **defer**, or **reject** before implementation begins. The spec captures the full delta so the decisions are concrete.

### A. Resolver robustness — symlink-aware path equality and disambiguation messaging

Add a bidirectional, symlink-aware path equality helper to the SDK and use it for clone matching. Update the exit-3 messaging on Step 3 and Step 4 so both phrasings begin with "Ambiguous" and both include the `SQUAD_CALLSIGN` disambiguation hint.

Rationale: a user whose clone path traverses a symlink (Unix), a junction (Windows), or differs in case from the registered clone today fails to resolve even though the location is correct. The same code path silently picks one candidate when origin URLs match more than one entry, leaving the user with no visible reason for the wrong selection.

Helper contract for `pathsRefSameLocation(a, b)`:

- compare `lit(a) == lit(b)`, `realpath(a) == lit(b)`, `lit(a) == realpath(b)`, `realpath(a) == realpath(b)`; return true on first match;
- case-insensitive on win32 and darwin, case-sensitive on linux;
- one `realpathSync` call per side per call, errors caught and treated as "realpath unavailable, fall back to literal";
- ELOOP and ENOENT do not throw out of the helper.

The helper is exported from the SDK index for use by adapters and tests.

### B. Azure DevOps URL normalization

Extend `normalizeRemoteUrl` so all four documented Azure DevOps URL flavors collapse to the canonical form `dev.azure.com/{org}/{proj}/_git/{repo}`:

- modern SSH: `git@ssh.dev.azure.com:v3/{org}/{proj}/{repo}`;
- legacy SSH: `{org}@vs-ssh.visualstudio.com:v3/{org}/{proj}/{repo}`;
- modern HTTPS: `https://[user@]dev.azure.com/{org}/{proj}/_git/{repo}`;
- legacy HTTPS: `https://{org}.visualstudio.com/{proj}/_git/{repo}`.

Strip a trailing `.git` and a trailing slash. Preserve path casing. Generic SSH for non-ADO hosts is unchanged.

Rationale: a host repository registered through the HTTPS form should still match a consumer that clones it through SSH. Without this, the user sees an unresolved squad on machines that prefer SSH.

### C. Azure DevOps `@me` sentinel resolution

When the Azure DevOps adapter receives `@me` as an identity, resolve it to the authenticated user via the existing adapter call instead of passing the literal string through. The behavior matches the GitHub adapter and is the documented expectation in the platform-adapter contract.

### D. `squad init` URL-redirect guard

When `squad init` receives a positional argument that looks like a URL (`http://`, `https://`, `git@`, `ssh://`), exit 1 with a redirect error that points the user to `squad assign <url> --clone-to <path>`. The detection logic is exported as `isUrlLikeArg(arg)` so the routing layer and a new test file share one source of truth.

Rationale: users with shell history from earlier installs still type `squad init <url>`. Today the URL is silently ignored and init proceeds with the current working directory, which is not what the user intended. A redirect is a one-line correction.

This sub-proposal is flagged for explicit team evaluation. It is the only change in the piece that introduces a new exit-1 path on an existing command surface. The alternative is to leave the URL silently ignored with no guard.

### E. `squad status` registry resolution fields

When the active squad was resolved through `~/.squad/registry.json`, append a small block of fields after the existing status output:

```text
Resolution: registry
Callsign: <name>
Registry path: <path-to-registry-file>
Match via: env var (SQUAD_CALLSIGN) | clone path | origin URL
Matched origin: <normalized-origin> (only when match via is origin URL)
Host repo: <host-checkout-path>
```

When the active squad was resolved from a local `.squad/` directory, the new fields are omitted entirely. Existing status output is unchanged in that case.

The new field block is produced by a small, testable function in `packages/squad-cli/src/commands/status.ts` and called from the existing status command path in `cli-entry.ts`.

Rationale: when a user has more than one squad registered, status is the natural place to confirm which one is active and why. Today the user has to read the registry by hand to understand the match.

### F. `squad doctor --help` completeness

Update the doctor command's help block (both `squad doctor --help` and the top-level `squad help` entry for doctor) to list `--purge` and `--normalize-callsigns` with one-line descriptions for each. The flags themselves and their behavior are unchanged.

### G. Assignment deploys the canonical squad agent file

Confirm that `squad assign` deploys the canonical squad agent file from the host repository into the consumer repository's `.github/agents/` directory, and that the Copilot payload code reads from `.github/agents/` consistently. Update any inconsistent path reference. Add a smoke-level test that asserts a consumer repository has the agent file present after a successful assign.

Rationale: this is the only sub-proposal in the piece sourced from end-to-end smoke testing rather than static review. The agent file is the user-visible artifact that proves assignment is wired through; an inconsistent source path produces a silent gap.

Implementation note: if pieces 11a, 11b, and 19 already use the canonical path consistently, the code delta for this sub-proposal is a no-op and only the smoke test is new.

### H. `squad init --callsign` idempotency

When `squad init --callsign <name>` is invoked against a directory that already contains a complete `.squad/` scaffold, treat the invocation as a refresh of the registry entry instead of an error. Specifically:

- if the scaffold exists and the registry already has the callsign pointing at this path, exit 0 with a "already registered" message;
- if the scaffold exists and the registry has the callsign pointing somewhere else, exit 1 with a callsign-collision message;
- if the scaffold exists and the registry does not list the callsign, register it and exit 0.

The fail-fast guards from the existing init command remain in place for the cases they were designed to catch: differing target directory, differing registry path, or scaffold corruption.

Rationale: a user who runs `squad init --callsign` against an existing host repository (for example after a fresh clone of the host on a new machine) expects to register, not to be told to delete and recreate.

### I. Test stability sweep (verify-first)

Two small test-side items are included only if they still apply against the current tip:

- a single test in `test/cli/legacy-resolver-migration.test.ts` is currently skipped; if its underlying behavior now passes, remove the skip;
- `test/cli/cast.test.ts` historically had a version-stamp and git-boundary brittleness; if either still reproduces, apply the minimum fix.

Implementation rule: run the affected test file once on the current tip before changing anything. If the test passes, the sub-proposal is dropped from the piece. The replay session records the verification outcome in the pull request description.

## API surface

No public command shape changes. The piece adds:

- one new SDK export, `pathsRefSameLocation(a: string, b: string): boolean`;
- one new CLI helper export, `isUrlLikeArg(arg: string): boolean`, used by the routing layer and tests;
- one new CLI module, `packages/squad-cli/src/commands/status.ts`, that produces the registry-resolution field block.

Existing exit codes change as follows:

- `squad init <url>` (sub-proposal D, if accepted): currently silent fall-through, becomes exit 1 with a redirect message;
- `squad doctor --help` and `squad help doctor` (sub-proposal F): help text only, no exit code change;
- exit-3 disambiguation messages (sub-proposal A): wording change only, no new exit codes.

All other commands keep their exit codes, flags, and synopses.

## Test surface

Tests are grouped per sub-proposal so the team can include or drop them with the corresponding code.

| Sub-proposal | Test file | Coverage |
| --- | --- | --- |
| A | `test/path-utils.test.ts` | literal equality, case sensitivity per platform, symlink bidirectional, broken symlink fallback, containment sentinel, symlinked clone containment, exit-3 message contract |
| A | `test/resolution-v2.test.ts` | exit-3 Step 3 and Step 4 message both start with "Ambiguous" and include the `SQUAD_CALLSIGN` hint |
| B | `test/resolution-v2.test.ts` | four flavor-to-canonical cases, two round-trip cases, trailing `.git`/slash, mixed-case host, PAT auth prefix, three negative cases for GitHub and GitLab, three end-to-end integration cases for origin matching through SSH-cloned ADO consumers |
| C | `test/platform-adapter-ado.test.ts` | `@me` resolves to the authenticated identity, error path when no identity is available |
| D | `test/commands/init-url-guard.test.ts` | URL-like positional argument detection across `http://`, `https://`, `git@`, `ssh://`; redirect message includes the assign command; exit code is 1; non-URL positionals fall through unchanged |
| E | `test/commands/status.test.ts` | local `.squad/` resolution omits the new block; registry resolution via env, clone, and origin each produce the expected `Match via` label; absent fields are not printed; the function is exported and unit-testable |
| F | the closest existing CLI help test, or a small addition to it | `squad doctor --help` output includes both `--purge` and `--normalize-callsigns` |
| G | `packages/squad-cli/src/commands/__tests__/copilot-payload.test.ts` and/or a small smoke test | after `squad assign`, the consumer's `.github/agents/<file>` exists with expected content |
| H | `packages/squad-cli/src/commands/__tests__/init.test.ts` | three cases: same path same callsign, same path different callsign in registry, same path callsign not in registry |
| I | unchanged file paths | one test un-skipped, one cast test stabilized — only if reproduced |

Validation commands:

```powershell
npm run build
npm test
```

The piece passes only when the full suite is green and no new gate violations are introduced.

## Files

The full file set is the union of files touched by accepted sub-proposals. If the team rejects a sub-proposal, its files are not part of the commit.

| Sub-proposal | Path | Role |
| --- | --- | --- |
| A | `packages/squad-sdk/src/path-utils.ts` | add `pathsRefSameLocation`, update `clonesMatch` |
| A | `packages/squad-sdk/src/index.ts` | export `pathsRefSameLocation` |
| A | `packages/squad-sdk/src/resolution-v2.ts` | update Step 3 and Step 4 error messages |
| A | `test/path-utils.test.ts` | new unit tests |
| B | `packages/squad-sdk/src/resolution-v2.ts` | extend `normalizeRemoteUrl` |
| B | `test/resolution-v2.test.ts` | new unit and integration tests |
| C | `packages/squad-sdk/src/platform/azure-devops.ts` | resolve `@me` |
| C | `test/platform-adapter-ado.test.ts` | new tests |
| D | `packages/squad-cli/src/commands/init.ts` | export `isUrlLikeArg` |
| D | `packages/squad-cli/src/cli-entry.ts` | route URL-like positional to redirect error |
| D | `packages/squad-cli/src/commands/__tests__/init-url-guard.test.ts` | new tests |
| E | `packages/squad-cli/src/commands/status.ts` | new module: registry-resolution field block |
| E | `packages/squad-cli/src/cli-entry.ts` | call into status module when source is registry |
| E | `packages/squad-cli/src/commands/__tests__/status.test.ts` | new tests |
| F | `packages/squad-cli/src/cli-entry.ts` | doctor help text additions |
| G | `packages/squad-cli/src/commands/assign.ts` | confirm deploy step uses `.github/agents/` |
| G | `packages/squad-sdk/src/copilot-payload.ts` | confirm source path uses `.github/agents/` |
| G | `packages/squad-cli/src/commands/__tests__/copilot-payload.test.ts` | smoke test for deployed agent file |
| H | `packages/squad-cli/src/commands/init.ts` | idempotent `--callsign` on existing scaffold |
| H | `packages/squad-cli/src/commands/__tests__/init.test.ts` | new tests |
| I | `test/cli/legacy-resolver-migration.test.ts` | remove skip (only if test passes on tip) |
| I | `test/cli/cast.test.ts` | minimum fix (only if brittleness reproduces) |
| — | `.changeset/post-stack-review.md` | patch changeset listing accepted sub-proposals |

Sub-proposal G may resolve to a no-op on the code side if the canonical path is already correct in pieces 11a, 11b, and 19. In that case only the smoke test ships.

## Notes

The piece is a single commit by design. The team evaluates each sub-proposal before implementation, the accepted set is implemented and tested together, the full test suite must be green, and the scrub gate must pass with no net-new violations beyond the existing baseline.

Tone and record discipline applies fully. The proposal, the commit message, the docs, the tests, and the pull request text describe the current product behavior, the specific defect, and the forward design. No branch history, no implementation provenance, no internal channel names, no comparative framing.

Rollback is a single-piece revert. The accepted sub-proposals are additive enough that a revert restores the predecessor surface without data migration.
