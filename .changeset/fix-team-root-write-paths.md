---
'@bradygaster/squad-cli': patch
---

Spawn templates now use TEAM_ROOT-prefixed paths for all agent writes, preventing .squad/ state file pollution in consumer repos when using shared squads.
