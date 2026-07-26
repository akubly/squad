---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

install-fold-pipeline: also deploy the durable config pipeline (config-inbox → auto-PR consumer) with `--runner` parity so it runs on a self-hosted host; sync publish: batch blob-hash + index-stage into two spawns (was O(2·N)); `sync --push-config --dry-run`: preview the durable lane; canonicalize Pole-A `.gitignore` placement.
