---
"@bradygaster/squad-cli": patch
---

Fix piece-56 §B bulk managed hydrate silently no-opping on the real cold-start path (regression of decision G1):

- `hydrateTeamRootFromRef` gated its bulk unfiltered `git fetch` on `remote.<remote>.promisor === true`, keyed on the remote *token* the caller threads. But `git clone --filter=blob:none` records the promisor flag under the clone's own remote **name** (`origin`), while `assign` threads the resolved state/config remote token — a URL or a distinct remote name such as `squad-config` — so the name-keyed lookup missed, the bulk fetch was skipped, and the per-file `cat-file blob` loop fell back to O(files) promisor fetches (a ~1,600-file cold-start took ~41 min).
- The partial clone is now detected **remote-agnostically** by scanning `git config --get-regexp '^remote\..*\.promisor$'` for any `true`, so the single blob-materializing fetch fires regardless of which token the hydrate is driven with. A full clone has no promisor remote, so non-managed `--pull` stays byte-identical (no extra network); the `.last-hydrate-sha` fast-path skip ordering and monorepo `--absolute-git-dir` handling are unchanged.
- The §B regression test now drives the hydrate with a remote token that is NOT the clone's promisor remote name (the production calling convention) and asserts the network-touching fetch count is O(1) per lane, independent of file count.
