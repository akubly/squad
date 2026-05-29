---
'@bradygaster/squad-cli': patch
---

piece 27 — explicit sync command

Promotes `squad sync` from internal engine to first-class CLI command.

Flags added: --pull, --push, --both, --hydrate-only, --publish-only, --remote, --developer.
Remote resolution order: CLI --remote → config stateRemote → "squad-docs".
New `ensureStateRemote()`: verifies remote exists and idempotently adds required fetch refspecs.
Hook templates (post-merge, post-checkout, post-rewrite) updated to read stateRemote from config.
