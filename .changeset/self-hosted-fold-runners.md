---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Fold pipeline: drop a stale local state branch before checkout and treat a no-op fold as a recorded skip (self-hosted-runner durability), add a manual `workflow_dispatch`/manual-run trigger; `squad assign`: resolve a subfolder `<callsign>/.squad` team root so a multi-squad host can be onboarded; `install-fold-pipeline`: D1 `.squad/`-gated self-install into the current state repo.
