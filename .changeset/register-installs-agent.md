---
'@bradygaster/squad-cli': minor
---

feat(cli): register installs coordinator agent file at user-global Copilot agents directory

- `runRegister` accepts `installAgent` option (defaults `true`) and `home` override for testing
- After a successful registry write, the canonical `squad.agent.md` template is copied to `<home>/.copilot/agents/squad.agent.md` with the current CLI version stamped in
- New `--no-install-agent` flag on `squad register` skips the install while preserving the registry entry
- Install step is best-effort: registry write succeeds even if the file copy or directory creation fails; a warning is emitted to stderr with the target path and underlying error
- Existing target file is overwritten so the user-global coordinator file always reflects the most recent register
