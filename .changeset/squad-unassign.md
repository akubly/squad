---
"@bradygaster/squad-cli": minor
---

Add `squad unassign` command — removes the current repository binding from a shared squad registry entry. Implements demote-not-delete semantics: the last-clone unassign sets the entry to `inactive` (preserving callsign, path, initUri, and unknown fields) rather than deleting it, allowing `squad assign <callsign>` to reactivate later. Includes refcounted origin removal and host-path guard.
