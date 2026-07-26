---
"@bradygaster/squad-sdk": patch
"@bradygaster/squad-cli": patch
---

Resolve watch and triage startup through the captured state context. The state context now carries the registry-aware squad result, and watch startup uses that resolved path before fallback directory detection so long-running polling keeps a stable squad identity.
