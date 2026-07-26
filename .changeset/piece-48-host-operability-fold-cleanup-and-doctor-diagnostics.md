---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Host operability, fold-cleanup hygiene, and doctor diagnostics (piece 48).

`install-fold-pipeline` now wires the previously-inert `--force` flag into the conflict gate: when a differing pipeline file already exists, `--force` overwrites it after saving the prior version to a `.bak` sibling. A missing destination directory under a registry-confirmed host is now auto-created (registry-gated) instead of failing fast.

The fold inbox-branch cleanup is corrected and made install-time enableable. The cleanup loop now deletes only successfully-folded refs (derived from `$FOLDED_ENTRIES`), never the full discovered set (`$SORTED_REFS`), so a ref whose fold commit failed is never deleted unfolded. Cleanup stays off by default (`DELETE_FOLDED_REFS=false`); `install-fold-pipeline --delete-folded-refs` renders it enabled. All fold-template copies remain byte-identical.

`install-fold-pipeline --fold-service-connection <name>` (ADO only) renders the state-branch write-back to push under a named Azure DevOps service connection (managed identity / service principal, `aka.ms/azdosc`) instead of the implicit build-service `System.AccessToken`, providing a least-privilege path that avoids the over-privileged shared-account Contribute grant flagged by the Securing Azure DevOps Build Service Accounts control. Default rendering (no flag) is byte-identical to today. The CLI reference documents the minimum-permission and compliant alternative paths.

`squad doctor` gains host-repo diagnostics: when the current directory is a registered product clone whose shared host lives elsewhere, doctor inspects the host working tree and emits `warn`-level findings for a missing host `.squad/`, a missing or empty fold-pipeline YAML (the gap that silently disables folding), or a missing in-repo coordinator agent (`.github/agents/squad.agent.md`). These never fire for a single-repo / local-only squad and are best-effort (never throw).

`diagnoseCopilotPayload` now attributes the owning callsign of a `squad-…` payload against the set of known source skill/agent base names rather than a positional hyphen split, so a multi-word payload such as `squad-probe-agent-collaboration` attributes to `probe` (not `probe-agent`). Doubly-prefixed re-namespaced payloads (`squad-<callsign>-squad-…`) are now reported as orphans to clean up rather than silently treated as owned, and correctly-namespaced registered payloads are not flagged.

`squad assign` origin-collision disambiguation is de-overloaded. The warm path no longer requires restating the positional callsign via `--callsign` to clear the origin-collision guard; the named target is treated as the intended squad. A new `--allow-origin-collision` flag is the explicit opt-in to record an assignment when the current remotes also match two or more other squads' recorded origins, and the `ERR_ASSIGN_ORIGIN_AMBIGUITY` message now names the colliding squads, the target, and the remediation. The cold-start (URL) meaning of `--callsign` is unchanged.
