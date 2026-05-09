# 06 — Register installs `squad.agent.md`

## Stack position

Piece 06 sits after the CLI command stubs piece and before the register merge-semantics piece. The predecessor exposes the `register` command path and imports the command module. This piece adds one side effect to successful registration: install the coordinator instructions into the user-global Copilot agents directory so `copilot --agent squad` can discover Squad outside the original clone.

This piece is additive and non-breaking. It does not change the registry schema, resolver priority order, or command names.

## Problem

A user can register a shared squad from one clone and then work from another clone, but the Copilot CLI only discovers agents from its configured agent locations. If `squad.agent.md` exists only inside the squad package or the squad host repository, the coordinator instructions are not available from other clones on the same machine.

The `register` command already represents the user's intent to make a squad available on this machine. It should also ensure the machine has the global coordinator agent file required to use that registered squad from any clone.

## Proposed change

### API surface

Add one option to the register command API:

```ts
export interface RunRegisterOpts {
  callsign: string;
  path?: string;
  origin?: string;
  clone?: string;
  registryPath?: string;
  installAgent?: boolean;
}
```

`installAgent` defaults to `true`. Passing `false` skips the global agent-file install while preserving the registry behavior.

Add one CLI flag:

```text
squad register --callsign <name> --path <path> [--no-install-agent]
```

`--no-install-agent` maps to `installAgent: false`. It exists for CI, tests, and users who manage Copilot agent files themselves.

### Mechanism

After a successful register operation writes the registry entry, the CLI installs the coordinator agent file:

1. Locate the canonical template at `packages/squad-cli/templates/squad.agent.md` relative to the installed CLI package.
2. Resolve the target directory with Node's `os.homedir()` and `path.join(home, '.copilot', 'agents')`.
   - Windows: `%USERPROFILE%\.copilot\agents\squad.agent.md`
   - macOS and Linux: `$HOME/.copilot/agents/squad.agent.md`
3. Create the target directory recursively if it does not exist.
4. Copy the canonical template to `squad.agent.md` in that directory.
5. Apply the same version-stamp transform used by init and upgrade so the installed file records the current CLI package version instead of the source-template placeholder.
6. Print one informational line with the final target path.

Conflict handling is intentionally simple: if `squad.agent.md` already exists at the target, `register` overwrites it. The user-global coordinator file is singular, so the last successful register wins. This piece does not introduce per-squad filenames, symlinks, merge prompts, or backup files.

The install step is best-effort. Registry writes are the primary operation. If the template is missing, the target directory cannot be created, or the file cannot be written, `register` keeps the registry entry and emits a warning that includes the target path and the underlying file-system error message.

Tests must not write to the real user home directory. Use an isolated home-directory override seam in the install helper so tests can assert the target path under a temporary fixture directory.

## Test surface

Add focused tests for `runRegister` and the CLI flag parsing:

- Default registration creates `<home>/.copilot/agents/squad.agent.md`.
- The installed file matches the canonical template after applying the expected version stamp.
- An existing target file with different content is overwritten.
- Missing `.copilot/agents` parent directories are created.
- `installAgent: false` and `--no-install-agent` skip all writes under the Copilot agents directory.
- A write failure during agent install is non-fatal: the registry entry exists, the command resolves successfully, and a warning is emitted.
- CLI help or usage text includes `--no-install-agent` for `register`.

Validation commands:

```powershell
npm run build
npm test
```

For targeted development, run the register command tests and template sync tests before the full validation pass.

## Files

Expected files from the manifest:

- `.changeset/register-installs-agent.md`
- `packages/squad-cli/src/cli-entry.ts`
- `packages/squad-cli/src/commands/register.ts`
- `packages/squad-cli/templates/squad.agent.md`
- `test/cli/register-installs-agent.test.ts`

If replay finds the command module or test file has moved after predecessor pieces, update the closest current equivalent and document the substitution in the PR description. Keep product code, tests, and the changeset in the same commit.

## Rollback

Rollback is a single-piece revert:

- Remove `RunRegisterOpts.installAgent` and the `--no-install-agent` parser branch.
- Remove the register-time copy/stamp helper and its tests.
- Keep the registry write behavior unchanged.
- Remove the changeset for this piece if no other package change remains.

A rollback should leave registered squads usable by resolver paths exactly as before this piece, but users would again need to install the global Copilot agent file by another command.

## Notes

Follow Microsoft Style Guide: use direct, factual wording in code comments, test names, warnings, and PR text.

Do not broaden this piece into multi-squad projection behavior. The target remains one global coordinator file at `~/.copilot/agents/squad.agent.md`; conflict handling is overwrite-only. More advanced projection or repair workflows belong in a later, separately specified change.
