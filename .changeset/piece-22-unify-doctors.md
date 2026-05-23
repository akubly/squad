---
"@bradygaster/squad-cli": patch
---

Unify legacy system doctor and registry doctor under a shared `DoctorFinding` type. Both subsystems are now run in a single pass via `runUnifiedDoctor`, with results grouped by source for display. Exit code for error-severity findings changes from 1 to 2 for consistency with other squad commands.
