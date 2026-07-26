---
"@bradygaster/squad-cli": patch
---

`squad init` now validates scaffold, callsign, clone path, and `.squad` symbolic-link conflicts before writing files. Each conflict exits with code 2 and prints a structured error code to stderr.
