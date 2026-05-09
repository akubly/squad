# Squad Registry-Backed Resolution & Shared-Squad Command Surface

## Summary

This proposal delivers the squad command surface for registry-backed resolution and shared-squad lifecycle management as a series of 23 stacked PRs (20 numerical IDs, with sub-pieces at 08a/b/c and 11a/b) against `bradygaster/dev`.The stack introduces a registry-backed squad resolution chain, migrates all CLI commands to use it, adds platform-adapter support for both GitHub and Azure DevOps, introduces shared-squad lifecycle commands (`assign`, `unassign`, `init` refactor), and delivers `.copilot/` payload integration for Copilot CLI. Each PR is a single squash-committed change targeting ≤30 files.

## Stack Table

| ID | Title | Tier | Depends | Files | Breaking | Scope |
|----|-------|------|---------|-------|----------|-------|
| 01 | Registry schema validator (SDK) | 1 | — | 6 | | JSON-schema validation for `registry.json` entries |
| 02 | Worktree-local + callsign resolver | 2 | 01 | 6 | | Resolution steps 1a (worktree) + 1b (callsign/env-var) |
| 03 | clones/origins resolver + init-mode guard | 2 | 02 | 9 | | Resolution steps 2–5: `clones[]`, `origins[]`, URL normalization, init-mode fallback |
| 04 | Path-utils extraction + upsertEntry rename | 3 | 03 | 19 | | Extract `clonesMatch`/path helpers; rename `registerEntry` → `upsertEntry` |
| 05 | CLI command stubs | 4 | 04 | 14 | | Wire `init`/`register`/`list`/`doctor` into CLI bin entry |
| 06 | register installs squad.agent.md | 4 | 05 | 6 | | `register` copies agent template to user-global |
| 07 | register merges clones[]/origins[] | 4 | 06 | 8 | | `register` deduplicates clone/origin entries for shared callsigns |
| 08a | Migrate read-only commands | 4 | 07 | ~30 | | `status`, `list-related`, `dev` → v2 resolver |
| 08b | Migrate user-action commands | 4 | 08a | ~30 | | `assign-to-copilot`, `consult`, `link` → v2 resolver |
| 08c | Migrate lifecycle commands | 4 | 08b | ~30 | | `start`, `rc` → v2 resolver |
| 09 | watch/triage v2 resolution | 4 | 08c | 6 | | `watch`/`triage` use v2 resolution from `stateContext` |
| 10 | init fail-fast | 4 | 09 | 6 | | `squad init` fails early on existing callsign/path/clone |
| 11a | Canonical template + fail-shut | 5 | 10 | 16 | | `squad.agent.md` fail-shut resolution chain + behavior test |
| 11b | Mirror sync | 5 | 11a | 4 | | Sync template to 4 secondary locations |
| 12 | Platform adapter + GitHub + ADO | 6 | 11b | 20 | | Platform-adapter abstraction; GitHub + Azure DevOps adapters |
| 13 | Hard-remove register | 7 | 12 | 6 | ⚠️ | Remove `register` command; redirect to `assign` teaching error |
| 14 | squad assign | 7 | 13 | 6 | | `squad assign` with refcounted origins + cold-start clone |
| 15 | squad unassign | 7 | 14 | 6 | | `squad unassign` with refcount + demote-not-delete |
| 16 | squad init refactor | 7 | 15 | 7 | ⚠️ | Drop URL arg; add `--target-dir`/`--registry-path`/`--no-register`; reactivate inactive |
| 17 | Fuzzy-match Did-You-Mean | 7 | 13 | 3 | | Fuzzy command suggestion helper |
| 18 | Doctor enhancements | 8 | 16 | 5 | | Warnings (empty clones, CWD overlap, origin overlap) + `--normalize-callsigns` + `--purge` |
| 19 | .copilot/ payload on assign | 9 | 14 | 6 | | Deliver `.copilot/` payload at user-scope via `--skills-from` |
| 20 | CLI reference + shared-squad guide | 10 | 19 | 5 | | CLI help text + `shared-squad.md` update for command surface |

**Totals:** 23 PRs, ~132 unique files, 2 breaking changes (pieces 13, 16).

## Contribution Constraints

All PRs follow the `bradygaster/squad` contribution norms:

| Rule | Enforcement |
|------|-------------|
| Single-commit PRs (squash before review) | Required |
| ≤30 files per PR | CI Diff Size Guard warns above; pieces 08a/b/c verified during replay |
| Target branch: `dev` | All PRs target `bradygaster/dev` |
| Branch name: `akubly/upstream-{NN}-{slug}` | Per stack convention |
| Changeset required when `packages/*/src/` touched | `.changeset/{name}.md` with patch/minor/major bump |
| `Co-authored-by: Copilot` trailer | Mandatory on every commit |
| Tone ceiling: factual, no hype | Enforced by scrub gate |

## Strip Filters

The following content **never** appears in any upstream PR:

- `docs/_internal/**` — internal documentation
- `docs/proposals/windows-wireless-*` — internal team migration docs
- `.squad/orchestration-log/**` — agent routing logs
- `.squad/decisions/**` — team decision records
- `.squad/agents/*/history.md` — per-agent memory
- `.squad/log/**` — session transcripts
- `.squad/identity/**` — agent identity state
- `.squad/casting/**` — universe registry
- `.squad/specs/v0.5.x-*` — working specs
- Any `@wifi-aware` package scope references
- Any `-mc.preview.N` version suffixes
- Any specific internal tenant/organization URLs in test fixtures

## Tone & Record Rules

### Allowed in specs, proposals, and all replay-produced artifacts

- Problem statement (present tense)
- Proposed mechanism, API surface, behavior
- Test surface (RED tests, parity criteria)
- File manifest, stack position, dependencies, rollback shape

### Forbidden

- References to prior implementation history, fork comparison framing, or "porting" language
- Any form of "wifi-aware" or "Wi-Fi Aware" (any spelling, any context)
- Internal team or product names, internal feed names, preview channel naming
- Internal Microsoft contexts (specific tenant URLs, internal handles, share paths)
- Commit-history breadcrumbs (wave prefixes, agent-name attribution)
- "We tried X first" / "this replaces Y" / comparison language

## Replay Protocol

Each piece is implemented via a spec-driven replay session. The replay agent reads the piece's spec document (`docs/proposals/upstream-bradygaster/{NN}-{slug}.md`) and implements it as new design work — the agent does not see or reference any prior implementation.

Full replay runbook: [`REPLAY-PROTOCOL.md`](REPLAY-PROTOCOL.md).

## Spec Document Convention

Each piece's spec lives at:
```
docs/proposals/upstream-bradygaster/{NN}-{slug}.md
```

These docs are fork-internal coordination artifacts. They are read by replay agents during Phase B but do not ship upstream — only the code they produce ships.

## Branch & PR Convention

- Branch: `akubly/upstream-{NN}-{slug}` (e.g., `akubly/upstream-01-registry-schema-validator`)
- Each branch rebases onto its predecessor
- Draft PR opened against `bradygaster/dev` only after the predecessor PR lands
- PR description summarizes the spec's problem statement and proposed change
- Placeholder branch names used — no upstream issues filed upfront
