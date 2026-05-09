# 16 — init command refactor

> Stack position: Tier 7, depends on piece 15.
>
> ⚠️ **BREAKING CHANGE:** `squad init <url>` is removed. The supported shape is `squad init [--target-dir DIR] [--registry-path PATH] [--no-register]`. This piece requires a **major** changeset.

## Problem

`squad init` currently combines multiple responsibilities behind one positional command shape: interpreting a repository URL, choosing where the scaffold should be created, and updating the user registry. That makes the command hard to test because local filesystem effects and registry effects are coupled to the same positional argument.

The command should have a forward design that separates local scaffold creation from global registry mutation. The user should be able to choose the target directory, choose the registry file used for read/write, or skip registration entirely without relying on implicit URL behavior.

## Breaking change and migration path

⚠️ **Breaking:** remove the URL positional argument from `squad init`.

Old command:

```bash
squad init <url>
```

New command:

```bash
squad init [--target-dir DIR] [--registry-path PATH] [--no-register]
```

Migration:

| Old use | New use |
|---------|---------|
| `squad init https://example.com/org/repo.git` | Clone the repository with Git, then run `squad init --target-dir <local-dir>`. |
| `squad init git@example.com:org/repo.git` | Clone the repository with Git, then run `squad init --target-dir <local-dir>`. |
| `squad init <url>` when only local files are wanted | Clone or create the local directory, then run `squad init --target-dir <local-dir> --no-register`. |
| `squad init <url>` when a non-default registry is needed | Clone or create the local directory, then run `squad init --target-dir <local-dir> --registry-path <registry.json>`. |

The CLI should reject URL-like positional arguments early and print an actionable teaching error. That error should explain that `squad init` no longer clones or accepts repository URLs, then show the local-scaffold replacement using `--target-dir` and, where appropriate, registration through the registry-backed lifecycle commands.

## Proposed change

Refactor the init command so the core operation is:

1. Resolve the target directory from `--target-dir` or the current working directory.
2. Scaffold `.squad/` in that directory.
3. Unless `--no-register` is present, read and update the registry at `--registry-path` or the default registry path.
4. If the requested registry entry already exists with inactive status, reactivate it instead of rejecting it.
5. Preserve existing active-entry collision protections.

The implementation should keep the command deterministic and testable: filesystem writes, registry reads, and registry writes are selected by explicit inputs. The design follows Microsoft Style Guide principles for command output: direct, user-focused, and action-oriented.

## API surface

Command surface:

```bash
# removed
squad init <url>

# supported
squad init [--target-dir DIR] [--registry-path PATH] [--no-register]
```

Flag behavior:

| Flag | Behavior |
|------|----------|
| `--target-dir DIR` | Create or reuse the local `.squad/` scaffold under `DIR` instead of the current working directory. |
| `--registry-path PATH` | Use `PATH` for registry read/write. This enables isolated tests and alternate registry locations. |
| `--no-register` | Create the local `.squad/` scaffold but do not add or update a registry entry. |

Old-to-new mapping:

| Previous behavior | Replacement |
|-------------------|-------------|
| Positional URL selected a repository source | The user clones or creates the local directory outside `squad init`. |
| Positional URL implied where initialization should happen | `--target-dir DIR` names the local target explicitly. |
| Init always coupled scaffold and registry intent | Omit `--no-register` to register; include `--no-register` to scaffold only. |
| Tests needed global registry state | `--registry-path PATH` provides an isolated registry file. |
| Inactive registry entry blocked reuse | Matching inactive entries are reactivated and reported as reactivated. |

If the command already supports a callsign option from earlier lifecycle work, keep it compatible with this refactor. It should continue to control the registry entry name while the three new flags control target selection, registry location, and registration intent.

## Test surface

| Test | Asserts |
|------|---------|
| `commands/init.test.ts: target-dir scaffolds outside cwd` | `runInit({ targetDir })` creates `.squad/team.md`, `.squad/routing.md`, and `.squad/decisions.md` under the supplied directory. |
| `commands/init.test.ts: target-dir derives callsign from target basename` | When no explicit name is supplied, registration uses the target directory basename rather than the process cwd basename. |
| `commands/init.test.ts: registry-path reads and writes custom file` | The command reads existing entries from the supplied registry file and writes the new entry back to the same file. |
| `commands/init.test.ts: no-register scaffolds only` | `--no-register` creates local scaffold files but does not create or append a registry entry. |
| `commands/init.test.ts: no-register does not reactivate` | With `--no-register`, an inactive registry entry is left unchanged because registry mutation is disabled. |
| `commands/init.test.ts: inactive entry reactivates` | A matching inactive registry entry becomes active and the command returns a reactivation result instead of a new registration result. |
| `commands/init.test.ts: reactivation preserves existing metadata` | Reactivation updates only status and the fields intentionally owned by init; unrelated registry fields remain intact. |
| `commands/init.test.ts: active callsign at different path rejects` | Active registry entries at another path still fail with a collision error and remediation. |
| `commands/init.test.ts: existing scaffold can be registered` | If `.squad/` already exists and registration is requested, the command can write the registry entry without clobbering local files. |
| `commands/init.test.ts: repeated existing scaffold registration is idempotent` | Re-running the same registration does not duplicate registry entries. |
| `commands/init-url-guard.test.ts: URL-like positional args are detected` | `https://`, `http://`, `ssh://`, and `git@host:path` forms trigger the breaking-change guard. |
| `commands/init-url-guard.test.ts: non-URL args are not rejected by URL guard` | Normal flags and local path-like strings continue through normal argument parsing. |
| CLI routing test: URL positional prints migration help | `squad init <url>` exits non-zero before filesystem or registry mutation and prints the new command shape. |

## Files

| Path | Role | Approx. LOC |
|------|------|-------------|
| `.changeset/init-command-refactor.md` | major changeset for the CLI package | +10 |
| `packages/squad-cli/src/commands/init.ts` | registry-aware init implementation and URL guard helper | +220 |
| `packages/squad-cli/src/cli-entry.ts` | argument parsing, help text, URL rejection, success messages | +310 |
| `packages/squad-cli/src/commands/__tests__/init.test.ts` | unit tests for new flags, idempotency, and reactivation | +260 |
| `packages/squad-cli/src/commands/__tests__/init-url-guard.test.ts` | URL guard unit tests | +55 |
| `test/cli/init-scope.test.ts` | CLI/integration coverage for scope and registry behavior | +255 |
| `vitest.config.ts` | test configuration update if needed for the new command tests | +35 |

## Rollback and implementer notes

Rollback reverts the single commit for this piece and restores the previous `squad init` command shape. Because this is a breaking command-surface change, rollback also removes the major changeset and the URL guard tests.

Implementer notes:

- Keep the command output factual and actionable.
- Do not introduce cloning behavior into `squad init`; cloning remains outside this command.
- Ensure URL positional rejection happens before scaffold or registry writes.
- Keep registry mutation disabled when `--no-register` is present.
- Run the scrub gate after authoring and before replay. The proposal must not contain internal URLs, preview-channel names, fork-comparison framing, or record-prefix breadcrumbs.
