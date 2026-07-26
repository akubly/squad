---
'@bradygaster/squad-sdk': patch
'@bradygaster/squad-cli': patch
---

feat(sdk,cli): registry state fields and assign flags (piece 32)

Extend RegistryEntry with optional stateRemote, stateBranch, and developerAlias fields. Add --state-remote, --state-branch, and --developer-alias flags to squad assign with persistence in both warm and cold-start paths (additive merge on re-assign). Extract DEVELOPER_ALIAS_RE to packages/squad-sdk/src/validation.ts; validate developerAlias before any registry read; add INVALID_ALIAS to AssignErrorCode.
