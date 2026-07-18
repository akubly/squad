---
"@bradygaster/squad-cli": patch
---

Harden managed cold-start onboarding and add idempotent fold inbox-ref garbage-collection:

- Cold-start now binds the invoking product clone (`--no-bind` to opt out).
- Bulk managed hydrate fetches each lane ref tip once so first hydrate is O(1) network calls per lane instead of O(files).
- Cold-start stamps `.squad/.last-publish` so the first `sync --dry-run` reports an honest publish baseline (no whole-squad no-op re-publish).
- `doctor` validates the fold pipeline against the remote default-branch tree for checkout-free managed hosts, and suppresses local false positives when run from a bound product clone.
- Fold pipeline templates re-delete recorded-but-present `squad/inbox/<callsign>/*` refs, so a prior failed delete is retried and orphan inbox branches no longer leak.
