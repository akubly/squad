# 37 — Dogfood fixes and publish-model decisions

## Summary

Repair a cluster of defects — two blockers, two correctness bugs, and four UX items — surfaced during initial end-to-end dogfooding of the cross-repo sync workflow delivered by pieces 32–36. Additionally, surface a set of publish-model design questions that must be decided before the workflow can be considered production-ready.

Stack position: Part 37 of the cross-repo arc. Branches off piece 36 (`squad/piece-36-cross-repo-publish-loop-repair`). Depends on pieces 26–36 all being present on the branch.

Changeset requirement: `packages/squad-cli/src/` is touched by Tier-1 items — include a `patch` changeset entry for `@bradygaster/squad-cli`. Tier-2 items do not land without their recorded decisions; no changeset is required until those decisions are made.

---

## Problem

First end-to-end dogfooding of the cross-repo sync workflow (pieces 32–36) surfaced two blockers that make `squad sync` unusable as delivered, plus a cluster of UX and correctness defects, plus several unresolved design questions about the publish model.

### Blockers

1. `squad sync push` (positional) silently becomes `--both`. The direction-flag parsing at `cli-entry.ts:1437–1443` matches only `--push`/`--pull`/`--both` (double-dash flags). A bare positional `push` or `pull` never matches any flag, so `hasPush` and `hasPull` are both false, and the else-branch fires: `direction = 'both'`. The `status` positional IS handled specially at `cli-entry.ts:1430` — so the inconsistency is not structural. Users attempting push-only inadvertently trigger a pull/hydrate first, which then hits the second blocker.

2. `stateRemote` defaults to the nonexistent remote `'squad-docs'`; the status line prints the wrong remote. Three `'squad-docs'` literals appear at `sync.ts:693, 722, 734` as the fallback for an unset `entry.stateRemote`. But the fold pipeline templates (`templates/fold/github/fold-squad-state.yml:33,103-104,219`; `templates/fold/ado/fold-squad-state.yml:36,99-101,205`) hardcode `origin` for all git operations. Result: inbox branches are pushed to a `squad-docs` remote that most repositories do not have, while the fold pipeline reads from `origin` — the pipeline receives nothing, silently. For pull/hydrate, `git fetch squad-docs ...` fails fatally. Additionally, the status line (`sync.ts:715`) prints `remote` (the single-repo `resolveRemote` result, typically `'origin'`) while hydrate and publish use `stateRemote ?? 'squad-docs'` — two different variables, so the status line lies.

### Correctness bugs

3. `ERR_ASSIGN_ORIGIN_AMBIGUITY` advises `--callsign`, which is ignored in the warm path. `assign.ts:519–523` tells users to use `--callsign` to resolve ambiguity, but `opts.callsign` is consumed only in `_coldStart` (URL path). In `_warmPath`, the filter at `assign.ts:511–512` matches only the positional argument, not `opts.callsign`. The advice is wrong.

4. `install-fold-pipeline` is absent from `squad --help`. The command is dispatched correctly at `cli-entry.ts:1457` but has no row in the commands table at `cli-entry.ts:213–252`, making it invisible to users.

### UX defects

5. User-facing strings use `"docs-repo"` where the canonical term is `"shared-squad host clone"`. Occurrences: `assign.ts:591`, `install-fold-pipeline.ts:88,106`, `install-hooks.ts:272`, `sync.ts:588`.

6. `squad assign --help` falls through to the main help page (or runs the assign handler). The per-command help dispatch at `cli-entry.ts:284–347` handles only `init`, `list`, `doctor`, `sync`. `assign --help` is not caught and falls through.

7. `squad --help` command-table column is not padded to a fixed width. `cli-entry.ts:217–252` uses two fixed spaces; `install-fold-pipeline` (22 characters) overflows and misaligns the description column.

8. The ADO fold pipeline is installed to `.azure-pipelines/` (`install-fold-pipeline.ts:97`), which is not the Microsoft-convention directory name. `.azuredevops/` is the more recognizable choice and is closer to Microsoft's own public documentation convention.

### Publish-model design questions

The following questions were raised during dogfooding and architecture review. Each must be answered before the corresponding code lands. None block the Tier-1 fixes.

---

## Proposed change

Sub-proposals are divided into two tiers.

**Tier 1 (sub-proposals A–H):** Concrete, implementation-ready fixes. Each has a specified file:line, required behavior, hard constraints, and test surface. These form a clean sub-stack that unblocks end-to-end dogfooding and can ship without waiting on any Tier-2 decisions.

**Tier 2 (sub-proposals I–P):** Design-required items. Each presents options, tradeoffs, and a recommendation, but no code lands until the corresponding decision is recorded. Sub-proposal I (hook placement) is explicitly marked DECISION PENDING and must not be implemented until the user and Lead resolve it in a design discussion.

**Recommended implementation order:** Implement Tier-1 items A–H first, in the order listed. Record Tier-2 decisions in `.squad/decisions/inbox/` as they are made; implementation of each Tier-2 item follows its recorded decision.

---

## Tier 1 — Mechanical fixes

### A. `squad sync push`/`pull` positional ignored; silently runs `--both` (BLOCKER)

**Current behavior:** `cli-entry.ts:1437–1443` detects direction via `args.includes('--push')`, `args.includes('--pull')`, `args.includes('--both')`. A bare positional `push` or `pull` (no `--` prefix) never matches these checks, so `hasPush = false` and `hasPull = false`, causing the else-branch to set `direction = 'both'`. The `status` positional is handled at `cli-entry.ts:1430` — positionals are not structurally unsupported.

**Required behavior:** After the `status` positional check (~`cli-entry.ts:1430`), parse `push` and `pull` bare positionals into `direction`. Explicit `--push`/`--pull`/`--both` flags take precedence over the positional (i.e., flags are checked first; the positional is the fallback). The `status` subcommand path must remain unaffected.

**Hard constraints:**
- `squad sync status` behavior is unchanged.
- `squad sync --push` (flag form) continues to work identically.
- `squad sync --both` continues to work identically.
- No behavior change when neither positional nor flags are provided (current default applies).

**Test surface:** (a) `squad sync push` (positional) routes to push-only; (b) `squad sync pull` (positional) routes to pull-only; (c) `squad sync --push` (flag) still works; (d) `squad sync status` is unaffected.

---

### B. `stateRemote` defaults to nonexistent `'squad-docs'`; status line shows wrong remote (BLOCKER)

**Current behavior:** Three literals `'squad-docs'` appear at `sync.ts:693, 722, 734` as the fallback value for `stateRemote ?? 'squad-docs'`. The fold pipeline templates hardcode `origin` for all operations, so if `entry.stateRemote` is unset, inbox pushes target a `squad-docs` remote that almost never exists. `sync.ts:715` prints `remote` (the single-repo `resolveRemote` result) in the status line, while hydrate and publish use the `stateRemote` value — these are two different variables.

**Required behavior:** Introduce `const DEFAULT_STATE_REMOTE = 'origin'` and replace all three `'squad-docs'` literals with `DEFAULT_STATE_REMOTE`. In cross-repo mode, the status line must display the effective `stateRemote` (i.e., `stateRemote ?? DEFAULT_STATE_REMOTE`), not the single-repo `remote` variable.

**Hard constraints:**
- `DEFAULT_STATE_REMOTE` must be a named constant (not an inline string literal replacement).
- If `entry.stateRemote` is explicitly set to a value other than `'origin'`, that value must be used without override.
- Single-repo mode (no registry match, `crossRepo = false`) status output must remain unchanged.

**Test surface:** (a) Cross-repo push with unset `entry.stateRemote` resolves to `'origin'` for hydrate and publish; (b) status line in cross-repo mode prints the effective `stateRemote`, not the single-repo `remote`; (c) explicit `entry.stateRemote` is honored when set.

---

### C. `install-fold-pipeline` absent from `squad --help` (BUG)

**Current behavior:** `install-fold-pipeline` is dispatched correctly at `cli-entry.ts:1457` but has no row in the commands table at `cli-entry.ts:213–252`. Users cannot discover the command from `squad --help`.

**Required behavior:** Add a row for `install-fold-pipeline` to the commands table. Description should match the command's function (install the fold pipeline YAML into the host repository).

**Hard constraints:** Row style (spacing, column alignment) must be consistent with other rows in the table. If sub-proposal G (column padding) lands in the same piece, the row must use the same padded format.

**Test surface:** `squad --help` output contains `install-fold-pipeline`.

---

### D. `ERR_ASSIGN_ORIGIN_AMBIGUITY` advises `--callsign`, which is dead in the warm path (BUG)

**Current behavior:** `assign.ts:519–523` emits an error that says to use `--callsign` for disambiguation. The filter at `assign.ts:511–512` checks only the positional argument (`e.callsign === callsign`); `opts.callsign` is read only in `_coldStart` (the URL path) and is ignored entirely in `_warmPath`. The flag advice in the error message describes behavior that does not exist.

**Required behavior:** Wire `opts.callsign` in the warm-path filter so that `squad assign smfx --callsign mobcon` resolves the ambiguity by excluding registry entries whose callsign does not match `opts.callsign`. Specifically: modify the filter at `assign.ts:511–512` to also reject entries where `e.callsign !== opts.callsign` when `opts.callsign` is provided. If this is judged overly complex, the minimum-viable alternative is to correct the error message to remove the `--callsign` advice and describe the actual working resolution (registry cleanup via `squad doctor` or re-assign). The full wiring fix is preferred.

**Hard constraints:**
- Cold-start `--callsign` behavior (URL path, `_coldStart`) must remain unchanged.
- When `opts.callsign` is absent, the warm-path filter behavior is identical to current.
- The error code `ERR_ASSIGN_ORIGIN_AMBIGUITY` is unchanged.

**Test surface:** `squad assign <callsign> --callsign <name>` in an ambiguous warm-path state disambiguates to the registry entry whose callsign matches `<name>`, without error.

---

### E. Terminology "docs-repo" → "shared-squad host clone" in user-facing strings (UX)

**Current behavior:** User-facing output strings at `assign.ts:591`, `install-fold-pipeline.ts:88,106`, `install-hooks.ts:272`, and `sync.ts:588` use the informal term `"docs-repo"`. This term is inconsistent with the canonical description in documentation.

**Required behavior:** Replace `"docs-repo"` in all four user-facing string locations with the canonical term `"shared-squad host clone"` (or the shortest unambiguous form agreed upon for the codebase — `"host clone"` is acceptable if the full phrase is too long for a status line). Variable names (`docsRepoPath`, `docsRepoClone`) are internal and not in scope for this sub-proposal; their rename is deferred to a coordinated follow-up.

**Hard constraints:**
- Only user-facing string literals are in scope. No internal variable or function renames.
- Documentation file changes (`.md` files) are noted here for a documentation follow-up but are not required for this sub-proposal's acceptance test.

**Test surface:** Each updated string location asserted to contain the new term and not the old `"docs-repo"` literal.

---

### F. `squad assign --help` falls through to main help (UX)

**Current behavior:** The per-command help dispatch at `cli-entry.ts:284–347` handles only `init`, `list`, `doctor`, and `sync`. `squad assign --help` does not match the early `--help`/`-h` check (which requires `--help` as `args[0]`) and falls through to the assign handler, which then errors for a missing callsign.

**Required behavior:** Add an `assign` branch to the per-command help dispatch block at approximately `cli-entry.ts:346`. The branch must print assign-specific usage (flags: `--developer-alias`, `--state-remote`, `--state-branch`, `--skills-from`, `--callsign`; description of the command's function) and exit 0. It must NOT invoke the assign handler.

**Hard constraints:**
- `squad assign` (without `--help`) behavior is unchanged.
- Help text style must match the existing per-command help blocks (indentation, flag listing format).

**Test surface:** `squad assign --help` prints assign-specific usage and exits 0; `squad assign --help` does NOT invoke `runAssign`.

---

### G. `squad --help` command-table column not padded (UX)

**Current behavior:** `cli-entry.ts:217–252` uses two fixed trailing spaces between the command name and description. `install-fold-pipeline` (22 characters) is longer than the other commands, causing the description column to misalign for all rows if the column width is not normalized.

**Required behavior:** Apply `.padEnd()` to the command-name column at a fixed width wide enough to accommodate the longest command name currently in the table. The fixed width should be the length of the longest command name plus a minimum gap (e.g., 2 spaces). All rows in the table use the same padded width.

**Hard constraints:**
- If the command table is later extended with a longer command name, the pad width must be easy to update (a named constant or a computed value — not per-row inline padding).

**Test surface:** Help output command-name column alignment — all description strings begin at the same character offset.

---

### H. ADO fold pipeline installed to non-standard directory (UX)

**Current behavior:** `install-fold-pipeline.ts:97` writes the ADO template to `.azure-pipelines/`. Azure DevOps has no enforced pipeline YAML directory (unlike GitHub Actions), but `.azuredevops/` is the more recognizable convention per Microsoft's own public documentation.

**Required behavior:** Change the ADO install target from `.azure-pipelines/` to `.azuredevops/`. Update the trigger path in the ADO fold template (`templates/fold/ado/fold-squad-state.yml`) if it references the output directory. Document in the command output that the user must configure their ADO pipeline definition in the portal to point to `.azuredevops/fold-squad-state.yml`.

**Hard constraints:**
- Idempotency behavior (conflict detection on re-run) from piece 35 must be preserved at the new path.
- The GitHub fold pipeline path (`.github/workflows/`) is unaffected.

**Test surface:** ADO install writes the template to `.azuredevops/fold-squad-state.yml`, not `.azure-pipelines/`.

---

## Tier 2 — Design decisions (DECISION REQUIRED before implementation)

Each sub-proposal in this tier presents the current state, options, tradeoffs, and a recommendation. No Tier-2 code lands without a recorded decision in `.squad/decisions/inbox/`. Implementation follows the decision, not this spec.

---

### I. Hook placement — where should the post-commit hook be installed? (DECISION PENDING — needs design discussion before implementation)

> ⚠️ **DECISION PENDING.** The user has explicitly deferred this decision pending further design discussion. Do not implement this sub-proposal until the decision is recorded. If this decision is unresolved at implementation time, implement Tier-1 (A–H) only and defer this item.

**Motivation:** The post-commit hook currently installs only in the host clone (`docsRepoPath`). In the primary developer workflow, the developer commits in the product repository, not the host clone. The product repository's `.git/hooks/` has no hook, so the hook never fires for normal development commits. The host-only placement was chosen to satisfy the "hooks in docs-repo clone only" constraint from piece 34's constraint-compliance gate, but this placement means the hook is effectively inert for the primary use case.

**Current behavior:** `assign.ts:585` calls `installCrossRepoHookFn(docsRepoPath)` — hook is installed only in the host clone. Host-clone commits (charter edits, decisions, routing) trigger the hook; product-repo commits do not.

**Option 1 — Host-only (current).** No change. The hook fires only for direct commits to the host clone. Pros: simple; satisfies the piece-34 constraint. Cons: the primary developer workflow (commit in product repo → publish host's `.squad/`) is not covered automatically. The hook fires for an unusual commit pattern that most developers will not follow.

**Option 2 — Product-only + content-filter guard.** Install the hook only in the product clone (`clonePath`). Add a content-filter guard in the hook body: `git diff --name-only HEAD~1 | grep -q '^\.squad/'` — only proceed if the commit touched `.squad/` files. Pros: covers the primary workflow. Cons: the hook runs on every commit and incurs a `git diff` overhead; the filter depends on the product repo having a `.squad/` directory at the root (which is not universally true).

**Option 3 — Both product and host.** Install the hook in both `docsRepoPath` and `clonePath`, each in independent try/catch. The host hook has no filter (all host commits are relevant). The product hook has the content-filter guard from Option 2. Pros: covers both workflows; host-direct commits and product commits both trigger publish. Cons: two hooks to maintain; slightly more complex install logic; requires confirming that the `SQUAD_SYNC_ACTIVE` recursion guard correctly handles the two-process case (it does — the guard is environment-variable-based within a process; inbox branches are unique by timestamp+sequence+UUID; the fold pipeline is idempotent).

**Recommendation:** Option 3 (install in both). The primary workflow gap is the more important correctness problem. The content-filter guard on the product hook keeps overhead minimal. The recursion-guard analysis confirms no infinite-loop risk. This sub-proposal also subsumes the WHERE-does-the-host-`.squad/`-state-get-committed question from the piece-29 work-root/team-root protocol: if the product hook fires on `.squad/` file changes, the host `.squad/` state must be committed from the host, not the product repo.

**Prerequisite question:** Confirm where the host `.squad/` state is committed (piece-29 protocol). The product-hook content filter (`grep '^\.squad/'`) assumes `.squad/` files in the product repo represent host state mirrored there — if the product repo does not have a `.squad/` directory, Option 2/3's filter will never fire.

---

### J. "developer alias" → canonical inbox-handle terminology (DECISION REQUIRED)

**Current state:** The concept namespaced as `developerAlias` (the `squad/inbox/<alias>/...` routing key) is called "developer alias" throughout the codebase and documentation. The term is overloaded in corporate environments (email alias, ADO alias, GitHub handle) and does not communicate its function (routing inbox branches to a specific developer).

**Full rename surface (14+ touch points):**

| Symbol | File | Type |
|--------|------|------|
| `DEVELOPER_ALIAS_RE` | `packages/squad-sdk/src/validation.ts:11` | regex constant |
| `developerAlias` | `packages/squad-sdk/src/registry.ts:21,164–168,172` | registry field |
| `AssignCliArgs.developerAlias` | `packages/squad-cli/src/commands/assign-args.ts:17` | type field |
| `--developer-alias` NAMED_FLAG | `packages/squad-cli/src/commands/assign-args.ts:28,69` | CLI flag |
| `SquadAssignOpts.developerAlias` | `packages/squad-cli/src/commands/assign.ts:283,335` | type field |
| hook comment | `packages/squad-cli/src/cli/commands/install-hooks.ts:125` | comment |
| `SyncOptions.developer` | `packages/squad-cli/src/cli/commands/sync.ts:32` | type field |
| resolution comment + error strings | `packages/squad-cli/src/cli/commands/sync.ts:680,708–710` | user-facing |
| `SQUAD_DEVELOPER_ALIAS` env var | `packages/squad-cli/src/cli/commands/sync.ts:685` | env var name |
| `--developer` help | `packages/squad-cli/src/cli-entry.ts:337` | help string |
| env var help | `packages/squad-cli/src/cli-entry.ts:342` | help string |
| dispatch destructure | `packages/squad-cli/src/cli-entry.ts:1310` | code |
| docs/reference/cli.md | multiple lines | docs |
| docs/guide/shared-squad.md | multiple lines | docs |

**Decision required:** Agree on the canonical term before executing the sweep. Candidates: `inbox-handle`, `publish-handle`, `handle`. The recommendation is `inbox-handle` — it names the role (routing inbox branches) rather than the mechanism (aliasing a developer identity).

**Implementation note:** This rename supersedes and subsumes any `--developer`/`--developer-alias` flag-consistency item. All 14+ touch points are renamed in a single coordinated sweep. A `patch` changeset for `@bradygaster/squad-cli` and `@bradygaster/squad-sdk` is required.

---

### K. Handle setting at `squad init` / host-only workflow gap (DECISION REQUIRED)

**Current state:** `developerAlias` (inbox handle) is stored per `RegistryEntry` and written only by `squad assign`. Guard 3 in `assign.ts:449–452` rejects `squad assign` from the host directory, so a developer working exclusively in the host clone cannot set their alias via the normal assign path. The env-var workaround (`SQUAD_DEVELOPER_ALIAS` / `SQUAD_INBOX_HANDLE` after rename) exists but is undiscoverable.

**Option 1 — Accept handle at `squad init --callsign`.** Add an `--inbox-handle` flag to `squad init`; pre-populate the registry entry's handle field at init time. Pros: natural integration point for a developer setting up a new host. Cons: `squad init` creates the host; the registry binding (which holds the handle) is a per-developer entry created by `squad assign`. Conflating the two operations blurs the init/assign separation.

**Option 2 — Relax guard 3 for handle-only assign from the host.** Allow `squad assign <callsign> --inbox-handle <handle>` from the host directory when the callsign matches the already-registered host entry (update-only, no clone creation). Pros: reuses the assign command path. Cons: guard 3 exists for a reason (prevents accidental self-assign of the host); a narrow exception must be carefully specified.

**Option 3 — Document and surface the env-var path.** Keep current behavior; add prominent documentation and a `squad doctor` hint when `squad sync --push` fails due to missing handle. Pros: no code change. Cons: the env-var path is a workaround, not a first-class feature; it is session-scoped and does not persist to the registry.

**Recommendation:** Option 2. A narrow guard exception for handle-only update from the host is the cleanest long-term fix, and it keeps the handle in the registry (where it belongs) rather than in an env var. The exception predicate is: `operationIsHandleUpdateOnly && entry.path matches hostRoot`. Gate on the naming decision (sub-proposal J) before implementing.

---

### L. Inbox branch prefix configurability (DECISION REQUIRED)

**Current state:** The `squad/inbox/` prefix is hardcoded at `sync.ts:326`. The fold pipeline trigger glob depends on this prefix (both GitHub and ADO templates). Changing the prefix requires updating both the CLI and the templates — a coordinated change.

**Option 1 — Keep hardcoded.** Simple; no configuration surface. Cons: operators who want a different prefix (e.g., `squad/in/` for brevity) cannot change it.

**Option 2 — Configurable via `config.json` / registry entry.** Add an `inboxPrefix` field; default to `squad/inbox/`. The fold pipeline trigger glob would also need to be templated. Cons: the fold template is a static YAML file; making the trigger glob dynamic requires either template generation at install time or a catch-all trigger that the pipeline re-filters.

**Option 3 — Configurable via `squad init` flag only, baked into the installed template.** At `install-fold-pipeline` time, substitute the prefix into the template trigger glob and write a baked template. Pros: the YAML remains static at runtime. Cons: re-running `install-fold-pipeline` with a different prefix overwrites the existing template (idempotency break).

**Recommendation:** Option 1 (keep hardcoded) for now. The prefix is an implementation detail that most operators will not need to change. If a use case for configurability emerges, Option 3 is the cleanest path. Record this as a known limitation in the `install-fold-pipeline` help text.

---

### M. Sync-from-host guard (DECISION REQUIRED)

**Current state:** `sync.ts:635–675` uses registry lookup (`e.clones?.some(...)`) to detect whether the current directory is a registered product clone. The host root is not in `clones[]` (only product repositories are), so running `squad sync push` from the host finds no registry match, sets `teamRoot = undefined`, sets `crossRepo = false`, and either errors ("run squad assign") if no `config.json` is present, or silently runs single-repo sync (a plain push of the `squad-state` branch that skips the inbox flow entirely). There is no equivalent of `assign.ts:449–452` (guard 3) in the sync path — no warning that the caller is in the host and that cross-repo sync runs from a product clone.

**Option 1 — Silent current behavior.** No guard. Pros: no change. Cons: the most confusing outcome (cross-repo flow appears to succeed — the `squad-state` branch is updated — but the inbox flow is bypassed, so no fold pipeline run is triggered).

**Option 2 — Actionable host-detection guard.** When the resolved directory matches `path.dirname(entry.path)` of any registry entry (i.e., the caller is in a host clone), emit a clear error: "squad sync is intended to run from a product clone. You are in the shared-squad host clone. To publish from the host, run squad sync from your product repository." Exit 1.

**Option 3 — Host-sync as a first-class supported path.** Detect host directory and route to a dedicated host-sync codepath that publishes the host's `.squad/` state directly (bypassing the inbox flow — or via a short-circuit inbox push). Pros: enables host-direct commits to be published without a product-repo commit. Cons: significant new scope; overlaps with the hook-placement decision (sub-proposal I).

**Recommendation:** Option 2. The guard surfaces an actionable error rather than a silent degradation. Option 3 is architecturally interesting but should be gated on the hook-placement decision and treated as a separate piece.

---

### N. Upstream-as-context-read integration (DECISION — architecture)

**Background:** The upstream inheritance feature (introduced in the codebase at commit `3a53f823`) provides read-only hierarchical context inheritance — skills, routing guidance, wisdom, and policy — via a local `upstream` resolver entry. The shared-squad feature (pieces 26–36) provides bidirectional live team-state sync via `squad-state` and inbox branches. The two features have distinct roles: upstream is for READ (context), shared-squad is for STATE (coordination).

**Opportunity:** `squad assign` currently stores the host clone's path in the registry under `entry.path`. The upstream resolver could serve context from the host clone if the host were also registered as an `upstream` local entry. This would allow the upstream resolver to serve skills, routing, and policy from the host's `.squad/` without any additional transport layer — the host's `.squad/` is already local. The registry would then have two orthogonal roles per entry: (1) upstream local entry (context reads) and (2) shared-squad state entry (sync coordination).

**Option 1 — No integration.** Upstream and shared-squad remain structurally separate. Pros: no risk of coupling; each feature is independently evolvable. Cons: missed opportunity; the host `.squad/` contains skills and routing that the upstream resolver could serve automatically.

**Option 2 — `squad assign` registers the host as an `upstream` local entry in addition to the shared-squad entry.** The upstream resolver then serves context from the host automatically. The registry entry gains a `upstreamPath` field (or the existing `path` field is reused). Pros: context inheritance from the host becomes free; no new transport. Cons: the config-vs-state boundary blurs — upstream entries are conceptually config; shared-squad state entries are runtime state. The boundary policy must be explicit.

**Config-vs-state boundary policy question:** If `squad assign` writes both an upstream-context pointer and a state-coordination entry, which file owns each? Options: (a) same registry file (simple, blurs boundary); (b) separate files — upstream entries in `~/.squad/upstream-registry.json`, state entries in `~/.squad/registry.json` (clean boundary, two registry files); (c) single registry file with a typed discriminant field (`type: 'upstream' | 'state' | 'both'`).

**Recommendation:** Option 2, with boundary policy (c) (typed discriminant). This is the lowest-friction path to context inheritance from the host, and the discriminant field makes the dual role explicit. Defer until sub-proposal I (hook placement) is resolved — the hook-placement decision determines whether the product clone's commit path triggers a host-state read, which informs whether the upstream-path pointer needs to be on the product-clone registry entry or the host entry.

---

### O. Orphan-backend as enforced host default (DECISION — architecture)

**Background:** The orphan backend stores `.squad/` state on a detached `squad-state` branch, keeping it entirely out of the product repository's commit history and PR diffs. This is structurally cleaner than writing `.squad/` changes to the main branch. Piece 35 introduced the orphan backend as the default for cross-repo sync, but it is not enforced for host-direct commits.

**Option 1 — Opt-in (current).** Operators choose the orphan backend by configuration. Pros: flexibility. Cons: operators who do not configure it may create `.squad/` history noise in PRs.

**Option 2 — Enforce orphan backend for all registered hosts.** When `squad assign` registers a host, set `backend: 'orphan'` unconditionally. Emit a warning (not error) if the operator explicitly sets `backend: 'default'`. Pros: structurally eliminates PR noise. Cons: operators who intentionally want `.squad/` on the main branch are blocked.

**Option 3 — Enforce orphan for new registrations; grandfather existing.** New `squad assign` calls default to orphan. Existing registry entries without a `backend` field are treated as orphan on first sync. Pros: migration-safe. Cons: silent behavior change for existing users on first sync.

**Recommendation:** Option 2 (enforce). The orphan backend is correct for virtually all shared-squad use cases. The structural separation of `.squad/` state from PR history is a feature, not a constraint. Operators who intentionally want a different behavior can override by setting `stateBackend: 'flat'` explicitly with documented consequences. Gate sub-proposal P on this decision.

---

### P. Host-self-publish opt-in (DECISION — architecture)

**Background:** A `"selfPublish": true` flag on the host registry entry would allow the host to publish its own `.squad/` state to the `squad-state` branch without requiring a product-repo commit to trigger the sync. This would enable host-direct state management (charter edits, routing updates) to propagate to the state branch automatically.

**Current state:** The `SQUAD_SYNC_ACTIVE` environment variable provides an intra-process recursion guard; fold pipeline runs in CI and does not trigger local hooks; no infinite loop risk has been identified for the self-publish model.

**Dependency:** Sub-proposal O (orphan-backend enforcement) is a prerequisite. Self-publish from a host on the flat backend would write `.squad/` changes to the main branch on every commit — the orphan backend constraint keeps self-published state on the `squad-state` branch where it belongs.

**Bootstrap and hydration caveats:** On first self-publish, the `squad-state` branch does not yet exist. The bootstrap flow (create orphan branch, initial commit) must be triggered before self-publish can succeed. The hydration flow (pull `squad-state` → restore `.squad/`) must be idempotent when the host is also a publisher — the host must not overwrite its own uncommitted local changes with a fetched snapshot.

**Option 1 — No self-publish (current).** Host state is published only via product-repo commit triggers. Pros: simple; no bootstrap complexity. Cons: host-direct commits (charter edits) do not propagate unless a developer also commits from the product repo.

**Option 2 — `"selfPublish": true` as opt-in flag on the registry entry.** When set, `squad assign` or `install-hooks` installs a host-side hook that triggers sync on host commits. The hook must respect the content-filter guard from sub-proposal I (only fire on `.squad/` changes). Pros: covers host-direct commits. Cons: adds a new registry field; requires bootstrap guard; hydration idempotency must be verified.

**Option 3 — `"selfPublish": true` as a default for host entries (enforced).** Same as Option 2 but automatic. Pros: host state is always published. Cons: all bootstrap and hydration caveats apply to all host registrations; more complex onboarding.

**Recommendation:** Option 2 (opt-in). Self-publish is valuable for active host maintainers but adds non-trivial complexity (bootstrap, hydration idempotency, loop analysis). Make it opt-in first; promote to default only after the mechanics are proven. Gate on sub-proposal O and the hook-placement decision from sub-proposal I.

---

## Acceptance

### Tier 1 acceptance (A–H)

Tier-1 implementation is complete when:

1. **Build exits 0.** `npm run build` completes without errors.

2. **Pre-existing tests pass.** All tests from pieces 26–36 pass without modification.

3. **Blockers covered by regression tests.** Sub-proposals A and B each have at least one regression test confirming the corrected behavior persists.

4. **Per-sub-proposal coverage.** Each sub-proposal A–H has at least one targeted test.

5. **`squad sync push` is push-only.** A test confirms `squad sync push` (positional) invokes push direction only, not both.

6. **State remote resolves to `origin` by default.** A test confirms cross-repo push with unset `entry.stateRemote` uses `'origin'` as the effective remote for hydrate and publish.

7. **Changeset present.** `.changeset/*.md` records a `patch` bump for `@bradygaster/squad-cli`.

8. **Scrub gate passes.** `pwsh docs/proposals/upstream-bradygaster/_scrub-gate.ps1` exits 0 with all gates PASS (or pre-existing WARN baseline unchanged).

### Tier 2 acceptance (I–P)

Each Tier-2 sub-proposal is complete only when:

1. A decision document exists in `.squad/decisions/inbox/` recording the accepted option for that sub-proposal.
2. The implementation matches the recorded decision.
3. Sub-proposal I (hook placement) must not be implemented until the user and Lead have recorded the decision jointly — it is DECISION PENDING at spec-authoring time.
4. No Tier-2 code lands in the same commit as Tier-1 code.
