---
'@bradygaster/squad-sdk': patch
'@bradygaster/squad-cli': patch
---

Fix registry path mismatch: unify writer and reader through `defaultRegistryFilePath` helper in path-utils — closes the `platformDefaultRegistryPath` vs `~/.squad` divergence that caused `squad status` to miss registry entries
