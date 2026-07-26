---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Harden subfolder-hosted squads and self-hosted-runner fold pipelines. Cross-repo `sync` now resolves the state remote in the team-root git context (A); fold templates strip CR from ref lists so cleanup is CRLF-safe (B); `squad assign` installs the host-side cross-repo hook at the host git root instead of the `.squad` parent (C); `install-fold-pipeline` self-install recognizes the callsign-named subfolder host layout (D); `squad doctor` resolves the `squad.agent.md` check against the git root and suppresses the local `.squad/` advisory for a registered team root (E). Adds `install-fold-pipeline --runner "<labels>"` to render a self-hosted `runs-on` list (plus `defaults.run.shell: bash` for non-Linux labels), byte-identical to today when absent (F1).
