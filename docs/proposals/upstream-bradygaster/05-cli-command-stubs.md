# 05 — CLI command stubs

> Stack position: Tier 4, depends on 04.

## Problem

The registry-backed resolver exists after pieces 01 through 04, but the CLI entry point does not yet expose the registry command surface that users need to create, register, inspect, and diagnose shared squads. Without explicit command routes, callers must depend on library imports or older command paths, and later lifecycle pieces cannot add behavior behind stable command names.

This piece wires `init`, `register`, `list`, and `doctor` into the CLI bin entry point and gives each command a small, testable module boundary. The command modules should return structured values or formatted strings so tests can verify behavior without intercepting process output.

## Proposed change

Add command modules and CLI routing for the first registry-aware command surface:

- `squad init` can create a `.squad/` scaffold and, when directed by flags, write the first registry entry.
- `squad register` can create a registry entry for an existing squad path.
- `squad list` can print the registry contents in a script-friendly table.
- `squad doctor` can report the resolution state and registry health with structured severity.

Keep existing non-registry `init` behavior available for legacy flags. This piece should add only the minimum command behavior needed to establish the public routes and test seams; later pieces own template installation, clone/origin merging, assignment lifecycle, and deeper doctor repair actions.

### API surface

Expose command modules from the CLI package subpath exports so tests and downstream callers can import them directly.

```ts
export interface RunInitOpts {
  targetDir?: string;
  callsign?: string;
  noRegister?: boolean;
  registryPath?: string;
  cwd?: string;
}

export interface RunInitResult {
  registered?: { callsign: string; path: string };
  reactivated?: { callsign: string; path: string };
}

export function runInit(opts?: RunInitOpts): Promise<RunInitResult>;
export function isUrlLikeArg(arg: string): boolean;
```

```ts
export interface RunRegisterOpts {
  callsign: string;
  path: string;
  registryPath?: string;
  cwd?: string;
}

export interface RunRegisterResult {
  registered: { callsign: string; path: string };
}

export function runRegister(opts: RunRegisterOpts): Promise<RunRegisterResult>;
```

```ts
export interface RunListOpts {
  registryPath?: string;
}

export function runList(opts?: RunListOpts): Promise<string>;
```

```ts
export interface RunDoctorOpts {
  cwd: string;
  registryPath?: string;
  env?: Record<string, string>;
}

export interface RunDoctorResult {
  severity: 'info' | 'warn' | 'error';
  findings: string[];
}

export function runDoctor(opts: RunDoctorOpts): Promise<RunDoctorResult>;
```

Package exports should include:

- `@bradygaster/squad-cli/commands/init`
- `@bradygaster/squad-cli/commands/register`
- `@bradygaster/squad-cli/commands/list`
- `@bradygaster/squad-cli/commands/doctor`

### Mechanism

Update `packages/squad-cli/src/cli-entry.ts` so the bin entry point parses the shared registry flags once, then dispatches command-specific arguments to the new command modules.

Required routing behavior:

| Command | Route behavior |
|---------|----------------|
| `init` | Parse `--target-dir`, `--callsign`, `--no-register`, and `--registry-path`. Use the registry-aware command path when one of those flags is present. Preserve existing `init` behavior for existing flags that this piece does not own. Reject URL-like positional input with a clear usage message instead of ignoring it. |
| `register` | Parse `--callsign`, `--path`, and `--registry-path`. Validate that required flags are present, call `runRegister`, print a success line, and exit with a non-zero code for validation errors. |
| `list` | Call `runList`, print the returned string, and exit successfully. |
| `doctor` | Call `runDoctor` for the current working directory, render each finding, and exit non-zero only for `error` severity. |

The command modules should use the registry helpers introduced in earlier pieces:

- Resolve the registry path from an explicit option, `SQUAD_REGISTRY_PATH`, or the user registry default.
- Use the canonical registry write helper when preparing entries.
- Preserve unknown registry entry fields during read-modify-write flows.
- Treat `.squad/` scaffold writes as non-destructive: create missing files and do not overwrite user-authored files.
- Use the shared path helpers for collision and stale-path checks.

`runInit` should scaffold the target directory, derive a callsign from the target directory name when needed, and optionally add a registry entry. It should reactivate an inactive entry with the same callsign instead of creating a duplicate. It should fail with a clear collision error when an active callsign points at a different path.

`runRegister` should register an existing `.squad/` path and return the entry it wrote. This piece should not copy agent templates or merge additional clone/origin aliases; later pieces own those extensions.

`runList` should return a tab-separated table with `CALLSIGN`, `PATH`, `ORIGINS`, `CLONES`, and `STATUS` columns. It should return guidance text when no registry exists or when the registry has no entries. A missing path should be visible in the status column.

`runDoctor` should return structured findings instead of printing directly. It should report successful local resolution, callsign resolution, clone/origin resolution, no-setup guidance, stale paths, and ambiguous matches. The CLI entry point owns console rendering and exit-code mapping.

## Test surface

Add command tests with direct module imports and CLI dispatch tests for the bin entry point.

| Test area | Asserts |
|-----------|---------|
| `init` clean repository | Creates `.squad/` in the expected root and does not write a registry entry unless registry-aware flags request it. |
| `init` existing scaffold | Does not overwrite existing `.squad/team.md`; returns or throws according to the registry-aware mode being exercised. |
| `init` target directory | Creates intermediate directories, writes `.squad/`, derives the callsign, and writes a registry entry when auto-registration is enabled. |
| `init` `--no-register` | Creates the scaffold but does not create or modify `registry.json`. |
| `init` collisions | Throws on callsign collision and on clone/path collisions detected through shared path helpers. |
| `register` required flags | Fails with usage text when `--callsign` or `--path` is missing. |
| `register` entry write | Writes a valid registry entry for an existing `.squad/` path and returns the registered callsign and path. |
| `list` missing registry | Returns actionable guidance text. |
| `list` empty registry | Returns actionable guidance text. |
| `list` populated registry | Prints callsign, path, origin count, clone count, and status for each entry. |
| `list` stale path | Marks missing paths in output. |
| `doctor` no setup | Returns `info` severity and guidance to initialize a squad. |
| `doctor` local resolution | Reports that a local `.squad/` directory was found. |
| `doctor` callsign resolution | Reports the selected callsign when the environment points at a registry entry. |
| `doctor` missing callsign | Returns `error` severity when the requested callsign is not found. |
| `doctor` origin and clone resolution | Reports the matched source and selected entry. |
| `doctor` stale or ambiguous entries | Surfaces stale paths and ambiguous clone matches with `warn` or `error` severity as appropriate. |
| CLI dispatch | `squad init`, `squad register`, `squad list`, and `squad doctor` reach the new command modules and preserve existing non-registry command behavior. |

Validation commands:

```powershell
npm run build
npm test
```

During implementation, run the focused CLI command tests first, then run the full verification before the PR is ready.

## Files

Expected files from the manifest:

| Path | Role | Notes |
|------|------|-------|
| `.changeset/cli-command-stubs.md` | changeset | Required because CLI source and package exports change. |
| `.github/workflows/squad-ci.yml` | CI | Keep only if package export or bin verification requires it; otherwise omit from the replay diff. |
| `.github/workflows/squad-insider-publish.yml` | CI | Keep only if package packaging needs the new subpaths. |
| `.github/workflows/squad-npm-publish.yml` | CI | Keep only if package packaging needs the new subpaths. |
| `packages/squad-cli/package.json` | package config | Add command subpath exports and keep the existing bin entry. |
| `packages/squad-cli/src/cli-entry.ts` | implementation | Add command dispatch and help text. |
| `packages/squad-cli/src/commands/doctor.ts` | implementation | Add structured doctor command module. |
| `packages/squad-cli/src/commands/init.ts` | implementation | Add registry-aware init command module. |
| `packages/squad-cli/src/commands/list.ts` | implementation | Add registry list command module. |
| `packages/squad-cli/src/commands/register.ts` | implementation | Add registry register command module. |
| `test/cli/cast.test.ts` | regression test | Update only if command routing changes expose an existing fixture isolation issue. |
| `test/cli/init-v2.test.ts` | test | Rename or adapt to the clean command-stub test name during replay. |
| `test/cli/list-doctor.test.ts` | test | Covers list and doctor command modules. |
| `test/cli/register.test.ts` | test | Add register module and dispatch coverage. |

If replay finds that a listed file no longer exists after predecessor pieces, update the closest current equivalent and document the substitution in the PR description. Do not add unrelated files to reach the manifest count.

## Rollback

Revert the single commit for this piece. Rollback removes the command modules, package subpath exports, CLI routes, help text, command tests, and changeset. Registry files written by users are compatible with the registry schema from earlier pieces, so no data migration is required.

If rollback is partial during development, keep tests and command exports aligned. A package export that points at a missing command file, or a command file without matching tests, is not an acceptable intermediate state for review.

## Notes for the implementer

Follow Microsoft Style Guide: use sentence-case headings, active voice, present tense, and direct user guidance. Keep comments and test names factual.

Do not add later lifecycle behavior in this piece. Template installation, alias merging, assign/unassign lifecycle, purge actions, and command removal belong to later pieces. This piece succeeds when the CLI routes exist, the module APIs are testable, and the tests move with the command API in the same commit.
