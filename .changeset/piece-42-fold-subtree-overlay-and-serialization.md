---
"@bradygaster/squad-cli": patch
---

Fold pipeline overlays the inbox `.squad` tree without a bind failure when the state branch already contains `.squad/`, and preserves the pipeline-owned `publish-history.json`. The per-ref placement now uses `git archive | tar -x --exclude='.squad/publish-history.json'` instead of `git read-tree --prefix=.squad/`, so the second and subsequent folds into a callsign's state branch no longer abort. The Azure DevOps fold runs as a stage with `lockBehavior: sequential` referencing a protected Environment, serializing runs through an exclusive lock; `trigger.batch: true` and `--force-with-lease` are retained as the coalescing and integrity backstops, and the GitHub `concurrency` group is unchanged.
