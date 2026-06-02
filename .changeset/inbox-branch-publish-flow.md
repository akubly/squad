---
'@bradygaster/squad-cli': minor
'@bradygaster/squad-sdk': minor
---

Add inbox branch publish flow: `hydrateTeamRootFromStateRef`, `hydrateWorkRootProjection`, `publishTeamRootToInbox` helpers in squad-cli sync command; `sessionShardPath` helper in squad-sdk resolution module. Provenance metadata uses alias-only identity with SHA-256 pathHash for WORK_ROOT — no raw paths stored.
