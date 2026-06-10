# 38 — Multi-clone publish model & Tier-2 completion

## Summary

Complete all remaining cross-repo work surfaced during pieces 32–37 dogfooding: the previously-deferred piece-37 Tier-2 items (J, K, L, M, N, O) plus the reframed publish model that decouples the publish trigger from the publish source. Every decision in this spec is **already ratified** by the user — each sub-proposal states the accepted design and is implementation-ready. No further design discussion is required before code lands.

Stack position: Part 38 of the cross-repo arc. Branches off piece 37 (`squad/piece-37-dogfood-fixes-and-publish-model`). Implementation branch: `squad/piece-38-multi-clone-publish-model`. Depends on pieces 26–37 all being present on the branch.

Changeset requirement: this piece touches both `packages/squad-cli/src/` and `packages/squad-sdk/src/` (the inbox-handle rename and the registry backend-enum reconciliation cross both packages). Include a `patch` changeset entry for **both** `@bradygaster/squad-cli` and `@bradygaster/squad-sdk`.

Supersession: installing the cross-repo hook in **both** the host clone and the product clone explicitly supersedes the piece-34 host-only constraint ("Hooks install in docs-repo clone ONLY", `.squad/decisions.md:998`). The implementation must record this supersession in the kickoff and in a decision note.

> **Line-number drift notice.** All `file:line` references below are taken from the piece-37 base (`squad/piece-37-dogfood-fixes-and-publish-model`, HEAD `deb94a26`). Lines drift as Tier-1 items land. The implementer **must** verify each line against the actual working tree before editing; treat the symbol name and surrounding context as authoritative, the line number as a hint.

---

## Problem

Piece 37 split its work into Tier 1 (mechanical fixes A–H, all landed) and Tier 2 (design-required items I–P). The Tier-2 items were deferred as "decision required" — none could be implemented until a decision was recorded. Those decisions have now been made. Piece 38 implements the ratified set.

Two threads must be completed:

1. **Reframed publish model (the dogfood correction).** Initial end-to-end dogfooding established that the publish trigger and the publish source are different concerns and must be decoupled. A publish always snapshots the **host** clone's `.squad/` working tree and pushes it to an inbox branch; it should fire in response to a commit in **any** assigned repo — host or product. The product clone's commit is only the trigger; the host `.squad/` is the source the next publish snapshots. This is mechanically already true of `publishTeamRootToInbox` and `runSync` (both resolve `teamRoot` to the host clone via the registry `clones[]` lookup), but the hook is installed host-only today, so the primary developer workflow (commit in the product repo) never fires it. Product `.squad/` ownership is ratified as **ephemeral**: product clones never track `.squad/`; product-side agents write to the local host clone's `.squad/` (the piece-29 work-root/team-root protocol). The orphan backend must be enforced so `.squad/` stays out of PRs in both clone kinds.

2. **Tier-2 mechanical/architecture completion.** The naming, guard, prefix, dual-role, and backend-enum items raised in piece 37 are now ratified and must be executed: rename "developer alias" to the canonical inbox-handle family (J); keep the inbox prefix hardcoded but document it (L); add an actionable sync-from-host guard (M); allow a handle-only update from the host directory (K); and reconcile the fractured `stateBackend` enum so `orphan` is a first-class, accepted value (O).

Sub-proposal P (host self-publish) and the Option-3 "host-sync as first-class" path are explicitly **deferred / out of scope** for this piece (see the Deferred section).

---

## Proposed change

The sub-proposals are organized into two groupings:

**Tier 1 — Independent mechanical items (J, L, M, K).** Each is self-contained with a specified file:line, ratified behavior, hard constraints, and test surface. J (the rename) must land first because K consumes the renamed `--inbox-handle` flag.

**Tier 2 — Publish model (O, the two-hook decoupled model, the product `.squad/`-forbid guard, N).** These deliver the reframed publish trigger/source model and its supporting registry and ownership changes. O (enum reconciliation) is a hard precondition for the orphan-enforcement behavior the rest of the tier relies on.

**Recommended implementation order:** J → L → M → K → O (enum reconciliation) → two-hook decoupled model → product `.squad/`-forbid guard → N. This order lands the rename before its consumer (K), reconciles the backend enum before any orphan-enforcement code reads it, and installs the dual-clone hooks before the dual-role registration (N) that depends on both roles being live at the same host.

---

## Tier 1 — Independent mechanical items

### J. Rename "developer alias" → canonical `inbox-handle` family (RATIFIED) — do first; blocks K

**Ratified decision:** the concept currently namespaced as `developerAlias` (the `squad/inbox/<handle>/...` routing key) is renamed to the canonical **inbox-handle** family: `inboxHandle` (registry/type fields), `--inbox-handle` (CLI flag), `SQUAD_INBOX_HANDLE` (env var), `INBOX_HANDLE_RE` (validation regex). The term names the role (routing inbox branches) rather than the mechanism (aliasing a developer identity).

**Current state:** the `developerAlias` family is spread across both packages and docs. Representative anchors (verify all; the sweep is larger than piece 37's earlier "14" estimate — enumerate the touch-point categories below):
- `DEVELOPER_ALIAS_RE` — `packages/squad-sdk/src/validation.ts:11`
- `developerAlias` registry field + validator + `knownFields` set — `packages/squad-sdk/src/registry.ts:21,164–168,172`
- `developerAlias` parameter + validation in `publishTeamRootToInbox` — `packages/squad-cli/src/cli/commands/sync.ts:303–312`
- alias resolution chain (`--developer` flag → `SQUAD_DEVELOPER_ALIAS` env var → registry alias) — `packages/squad-cli/src/cli/commands/sync.ts:683–689`; the push-without-alias guard — `sync.ts:709–716`; status-line + config fallbacks — `sync.ts:543,552,587,645,659`
- `AssignCliArgs.developerAlias`, `--developer-alias` NAMED_FLAG — `packages/squad-cli/src/commands/assign-args.ts`
- `SquadAssignOpts.developerAlias` — `packages/squad-cli/src/commands/assign.ts`
- hook comment — `packages/squad-cli/src/cli/commands/install-hooks.ts`
- `--developer` / env-var help strings + dispatch destructure — `packages/squad-cli/src/cli-entry.ts`
- `docs/reference/cli.md`, `docs/guide/shared-squad.md`

**Touch-point categories to enumerate and convert** (verify each with a fresh grep across both packages + docs before sweeping):
1. Validation regex constant (`DEVELOPER_ALIAS_RE` → `INBOX_HANDLE_RE`) and its references.
2. SDK registry field, its JSON validator branch, and the `knownFields` allow-list entry.
3. CLI arg/opts type fields and the `--developer-alias` NAMED_FLAG definition.
4. Sync resolution chain: flag name, env-var name (`SQUAD_DEVELOPER_ALIAS` → `SQUAD_INBOX_HANDLE`), registry-field read, config-field fallbacks, status-line label.
5. User-facing error/help strings (including the `ERR_ASSIGN_INVALID_ALIAS` naming drift — fold this code/name into the inbox-handle family for consistency).
6. Documentation (`cli.md`, `shared-squad.md`).

**Hard constraints:**
- Single coordinated sweep — no half-renamed state in any landed commit. Build must pass after the sweep.
- The registry field rename is a wire-format change; rely on the registry's index-signature round-trip (`[key: string]: unknown`, `registry.ts:22`) only for **unknown** future fields, not as an excuse to skip migrating existing `developerAlias` entries. If backward read-compatibility for an already-written `developerAlias` key is required, accept it on read and rewrite it as `inboxHandle`; do not emit both.
- The validation regex pattern itself (`/^[a-z][a-z0-9-]{1,38}$/`) is unchanged — only the constant name changes.
- Zero residual `developerAlias` / `--developer-alias` / `SQUAD_DEVELOPER_ALIAS` / `DEVELOPER_ALIAS_RE` tokens in source or docs after the sweep (the dead `ERR_ASSIGN_INVALID_ALIAS` drift included).
- `patch` changeset for **both** `@bradygaster/squad-cli` and `@bradygaster/squad-sdk`.

**Test surface:** (a) a grep-style guard test asserts zero `developerAlias`/`--developer-alias`/`SQUAD_DEVELOPER_ALIAS` residue across `packages/*/src`; (b) `squad assign <callsign> --inbox-handle <h>` writes `inboxHandle` to the registry entry; (c) `SQUAD_INBOX_HANDLE` is honored in the sync resolution chain; (d) the SDK validator accepts an `inboxHandle` field and round-trips it through `writeRegistry`; (e) a regression test confirms the push-without-handle guard (`sync.ts:709–716`) still fires with the renamed symbols.

---

### L. Inbox-branch prefix stays hardcoded — document as a known limitation (RATIFIED)

**Ratified decision:** keep the `squad/inbox/` prefix hardcoded at `sync.ts:326`. Do **not** add a configuration surface. Record the non-change as a known limitation in the `install-fold-pipeline` help text, and note the pre-blessed future path (bake the prefix into the fold template at install time) so a later piece has a clear direction.

**Current state:** the prefix is hardcoded — `const inboxBranch = \`squad/inbox/${...}/${ts}-${seq}-${sessionId}\`` at `packages/squad-cli/src/cli/commands/sync.ts:326`. The fold pipeline trigger glob (`squad/inbox/**`) depends on this exact prefix in both the GitHub and ADO templates. There is no `inboxPrefix` field anywhere today.

**Required behavior:** no functional change to the prefix. Add a short "Known limitation" line to the `install-fold-pipeline` help/output stating that the inbox-branch prefix (`squad/inbox/`) is fixed and that operators who need a different prefix must change both the CLI and the fold templates together; reference the future direction (substitute the prefix into the template at install time).

**Hard constraints:**
- No new config field, flag, or registry key is introduced.
- The help-text addition must not alter exit codes or any machine-readable output.
- The documented prefix string must match the literal at `sync.ts:326` exactly (`squad/inbox/`).

**Test surface:** `install-fold-pipeline --help` (or the command's printed output) contains the known-limitation line referencing `squad/inbox/`.

---

### M. Actionable sync-from-host guard (RATIFIED — piece-37 Option 2)

**Ratified decision:** when `squad sync` is invoked from the host clone (the resolved directory matches `path.dirname(entry.path)` of a registry entry), emit a clear, actionable error and exit 1 — mirroring assign's Guard-3 host detection. Do not silently degrade to single-repo sync.

**Current state:** `sync.ts:635–675` resolves the team root by registry lookup. The host root is not in `clones[]` (only product repositories are), so running `squad sync` from the host finds no `clones[]` match. There is no host-detection guard in the sync path equivalent to assign's Guard 3 (`assign.ts:449–452`). The result is either an "run squad assign" error or a silent single-repo push of the `squad-state` branch that bypasses the inbox flow entirely — the most confusing outcome, because the `squad-state` branch appears updated while no fold pipeline run is triggered.

**Required behavior:** before falling through to the no-match / single-repo path, detect the host case: if the resolved directory equals `path.dirname(entry.path)` for any registry entry, print an actionable error such as: `"squad sync runs from a product clone. You are in the shared-squad host clone. To publish, run squad sync from your product repository."` Exit 1. This mirrors the host-detection predicate used by assign's Guard 3.

**Hard constraints:**
- The guard fires only on a host-directory match — a genuine product-clone match (`clones[]`) must proceed to cross-repo sync unchanged.
- Single-repo mode (no registry match at all, `crossRepo = false`) is unchanged — this guard does not touch the no-registry path.
- Error text is actionable (names the host clone, tells the user to run from the product clone) and exits 1, not 0.
- This is **not** the Option-3 host-sync-as-first-class path; that is deferred (folded into P). Do not add a host-sync codepath.

**Test surface:** (a) `squad sync --push` invoked with the resolved directory equal to a registry entry's host root exits 1 with the actionable message; (b) `squad sync` from a registered product clone is unaffected; (c) single-repo mode (no registry match) is unaffected.

---

### K. Handle-only update from the host directory (RATIFIED — piece-37 Option 2) — gated on J

**Ratified decision:** add a narrow Guard-3 exception allowing a **handle-only** update from the host directory: `squad assign <callsign> --inbox-handle <handle>` succeeds when the operation is handle-update-only AND the resolved directory is the host root for the matching registry entry (no clone creation). The handle stays in the registry where it belongs. Gated on J (uses the renamed `--inbox-handle` flag).

**Current state:** Guard 3 at `assign.ts:449–452` treats assigning from the squad host itself as a **silent no-op** — it returns `{ kind: 'noOp', callsign, hostPath: hostSquadDir }`, not a reject. A developer working only in the host clone therefore cannot persist an inbox handle via the normal assign path; the env-var workaround (`SQUAD_INBOX_HANDLE` after J) is undiscoverable and session-scoped.

**Required behavior:** narrow the Guard-3 no-op. When the invocation is a handle-only update (a `--inbox-handle` value is supplied AND no new clone/target-dir/cold-start work is requested) AND the resolved directory is the host root of the matched registry entry, update that entry's `inboxHandle` field and write the registry instead of returning `noOp`. Any non-handle-only assign from the host continues to hit the existing `noOp` behavior. No clone is created on this path.

**Hard constraints:**
- The exception predicate is exactly: handle-update-only AND resolved-dir == host root. Both conditions required; either alone keeps the current `noOp`.
- No clone creation, no origin refcount change, no cold-start on this path — registry write only.
- Depends on J: the flag is `--inbox-handle` and the field written is `inboxHandle`.
- The general host-self-assign protection (the reason Guard 3 exists) is preserved for every non-handle-only case.

**Test surface:** (a) `squad assign <callsign> --inbox-handle <h>` from the host root updates `inboxHandle` on the matching entry and persists it via `writeRegistry`; (b) `squad assign <callsign>` from the host root (no handle) still returns the `noOp`/host-path outcome; (c) `squad assign <callsign> --inbox-handle <h> --target-dir <other>` (clone-creating) is not treated as the handle-only exception.

---

## Tier 2 — Publish model

### O. Backend-enum reconciliation + orphan enforcement (RATIFIED in direction; enum reconciliation is a HARD precondition)

**Ratified decision:** enforce the orphan backend so `.squad/` stays out of PRs in both host and product clones. **Before** any enforcement code, the fractured backend enum must be reconciled — this is a hard precondition, not optional cleanup.

**Current state (the fracture):**
- SDK registry union accepts only `{ worktree, local, external }` — `packages/squad-sdk/src/registry.ts:16` — and the validator `validBackends = ['worktree', 'local', 'external']` (`registry.ts:143`) **rejects** `orphan`.
- The config.json runtime enum is effectively `{ local, external, orphan, two-layer }` — `install-hooks.ts:209–219` (backend read from `config.stateBackend`; `local`/`external`/`null` → "hooks not needed", else orphan/two-layer get hooks) and the parallel handling at `sync.ts:660,666`.
- The spec value `flat` referenced in piece-37 sub-proposal O exists in **no** enum and **no** handler — it is phantom.
- `sync.ts:646` **already hardcodes** `backend = 'orphan'` for any registry-matched entry, so orphan enforcement is de-facto true today for the cross-repo path — but the registry validator would reject an entry that wrote `stateBackend: 'orphan'` explicitly, and the runtime/registry field names and value sets disagree.

**Required behavior:**
1. **Unify the field name** to `stateBackend` across the registry schema and the config.json runtime (the two currently agree on the key name `stateBackend` but disagree on the accepted value set — converge them on one canonical set).
2. **One canonical value set that includes `orphan`.** Decide and document keep/drop for the two ambiguous values: `two-layer` (a real runtime branch in `install-hooks.ts`/`sync.ts`) and the runtime-dead `worktree` (in the registry union but with no runtime handler). Recommended canonical set: `{ orphan, local, external, two-layer }` — drop `worktree` from the registry union (it has no runtime handler), keep `two-layer` (it has live hook/notes handling). The implementer must confirm `two-layer` is still reachable before keeping it.
3. **Define-or-remove `flat`.** `flat` is phantom. Either remove every reference to it (preferred — it was only ever a piece-37 prose placeholder) or add it to the canonical set with a real handler. Recommended: remove.
4. **Extend the SDK registry** union (`registry.ts:16`) and `validBackends` (`registry.ts:143`) to the canonical set so a registry entry may legally carry `stateBackend: 'orphan'`.
5. **Decide the `sync.ts:646` read.** Either keep the hardcoded `backend = 'orphan'` (enforcement remains absolute) **or** read `entry.stateBackend` and enforce orphan with a warn-on-explicit-override path (warn, do not error, if an operator explicitly set a non-orphan backend on a shared-squad entry). Recommended: read `entry.stateBackend`, default to and enforce `orphan`, and emit a non-fatal warning when an explicit non-orphan value is overridden — this keeps enforcement while making the behavior inspectable. Document the chosen behavior.

**Hard constraints:**
- The registry validator must accept `orphan` after this item — a registry file with `stateBackend: 'orphan'` round-trips through read → `writeRegistry` → read without error.
- The canonical value set is identical in the SDK registry union, the registry `validBackends` validator, and the runtime handlers (`install-hooks.ts:209–219`, `sync.ts:660,666`). No value may be accepted by one layer and rejected by another.
- No phantom values remain (`flat` removed or backed by a handler).
- Orphan enforcement applies to both host and product clones (the orphan branch keeps `.squad/` out of PR diffs in either).
- If the warn-on-override path is chosen, the override warning is non-fatal (exit 0 for the warning itself) and names the entry and the overridden value.

**Test surface:** (a) the SDK validator accepts `stateBackend: 'orphan'` and rejects a value outside the canonical set; (b) a registry entry with `stateBackend: 'orphan'` round-trips through `writeRegistry`; (c) the runtime backend handlers accept exactly the canonical set; (d) no source reference to `flat` remains; (e) if the warn path is chosen, an explicit non-orphan `stateBackend` on a shared-squad entry produces the documented non-fatal warning while sync still uses orphan.

---

### Two-hook decoupled publish model (RATIFIED) — host filter-out + product unfiltered + install in both clones

**Ratified decision:** decouple the publish **trigger** from the publish **source**. A publish always snapshots the **host** clone's `.squad/` working tree and pushes it to an inbox branch; it fires in response to a commit in **any** assigned repo. Install the cross-repo `post-commit` hook in **both** the host clone and the product clone. The host hook filters **out** `.squad/`-only commits (publish only when non-`.squad/` files changed); the product hook fires on **any** commit.

**Current state:**
- The publish is already source-decoupled mechanically: `publishTeamRootToInbox` (`sync.ts:303–407`) takes `teamRoot` as a parameter and runs every git operation with `cwd: teamRoot`, enumerating the host `.squad/` working tree via `fs.readdir` + `hash-object` (`sync.ts:266–279,356–362`); `runSync` resolves `teamRoot = path.dirname(entry.path)` = the host clone even when invoked from a product clone, via the `clones[]` lookup (`sync.ts:638–642`). So a product-clone-triggered publish already snapshots the host `.squad/` — the only gap is that the hook is not installed in the product clone.
- The hook is installed **host-only** today: `assign.ts:586–588` calls `installCrossRepoHookFn(docsRepoPath)` where `docsRepoPath = path.dirname(entry.path)` (`assign.ts:586`). There is no install at the product `clonePath`.
- The cross-repo hook is a `post-commit` hook (`install-hooks.ts:118–129`; `installCrossRepoHook` at `install-hooks.ts:260`), body `if [ -z "$SQUAD_SYNC_ACTIVE" ]; then squad sync --push --quiet; fi` (`install-hooks.ts:125–129`). The current template is unfiltered.

**Required behavior:**
1. **Install in both clones.** In `assign.ts`, keep the host install (`installCrossRepoHookFn(docsRepoPath)`) and add a second install at the product `clonePath`, each in an **independent try/catch** so one failure does not prevent the other.
2. **Host hook = filter OUT `.squad/`.** The host-clone hook publishes only when a non-`.squad/` file changed. Use:
   `git diff-tree --no-commit-id --name-only -r --root HEAD | grep -qv '^\.squad/'`
   and proceed only when that predicate is true. The host hook must use `diff-tree --root` (correct on the root commit AND on shallow clones), **not** `HEAD~1` (which breaks on the first commit and on shallow clones).
3. **Product hook = fire on ANY commit.** The product-clone hook uses the existing unfiltered template (no diff, so no `HEAD~1` shallow-clone hazard).
4. Both hooks invoke `squad sync --push --quiet` under the `SQUAD_SYNC_ACTIVE` guard.

**Loop-freedom invariants (state these in the spec and preserve them):**
- Intra-process env guard `SQUAD_SYNC_ACTIVE` is set at the start of `runSync` and cleared in a `finally` (set ~`sync.ts:608–611`, cleared ~`sync.ts:754`; verify against the renamed symbols after J).
- The publish writes via `commit-tree` into an isolated `GIT_INDEX_FILE` (`sync.ts:343,396`), which fires **no** commit hooks.
- `hydrateTeamRootFromStateRef` (`sync.ts:418`) writes files directly and never creates a working-branch commit, so hydration cannot re-trigger a `post-commit` hook.
- These invariants hold for the product-triggers-host-publish case: the product `post-commit` fires `squad sync --push --quiet` with `SQUAD_SYNC_ACTIVE` set; the publish does its tree/commit-tree work in the host clone via an isolated index and never produces a working-tree commit in either clone.

**Supersession:** installing in both clones explicitly supersedes the piece-34 host-only constraint (`.squad/decisions.md:998`, "Hooks install in docs-repo clone ONLY"). State the supersession in the spec; the kickoff and implementation must record it in a decision note.

**Hard constraints:**
- Host hook predicate uses `git diff-tree --no-commit-id --name-only -r --root HEAD` — never `HEAD~1`.
- The two installs are independent (separate try/catch); a missing/locked `.git/hooks` in one clone must not abort the other.
- The product hook stays unfiltered (any commit triggers).
- No change to `publishTeamRootToInbox`'s source resolution — it already snapshots the host `.squad/`; this item only adds the second hook install and the host filter.
- The `SQUAD_SYNC_ACTIVE` guard, isolated-index publish, and commit-less hydration must remain intact (no regressions to the recursion invariants).

**Test surface:** (a) `assign` installs a `post-commit` hook in **both** the host clone and the product clone; (b) one install failing (e.g., product `.git/hooks` unwritable) still installs the other and surfaces a warning, not a hard failure; (c) the host hook body contains `diff-tree ... --root` and filters out `.squad/`-only commits (publishes when a non-`.squad/` file changed, skips when only `.squad/` changed); (d) the product hook body is unfiltered; (e) an **E2E**: a commit in the product clone triggers a publish that snapshots the **host** clone's `.squad/` to an inbox branch (no working-tree commit created in either clone; `SQUAD_SYNC_ACTIVE` set during the publish).

---

### Product `.squad/`-forbid pre-commit guard (RATIFIED — product `.squad/` is ephemeral)

**Ratified decision:** product clones **never track** `.squad/`. Product-side agents write generated history/logs/decisions to TEAM_ROOT = the local host clone's `.squad/` (piece-29 work-root/team-root protocol). The product commit is only the trigger. Enforce this with a product-repo **pre-commit** guard that rejects staging/committing any `.squad/` path on the product working branch. The guard forbids **tracking**, not the directory's existence on disk (a hydration cache / TEAM_ROOT may live there).

**Current state:** there is no product-side pre-commit guard. Nothing prevents a developer (or an agent) from `git add .squad/...` in the product clone and committing it onto the product working branch, which would put `.squad/` into the product's PR diff — exactly what the ephemeral-ownership model forbids. No orphan backend is needed on the product clone for this; the guard is sufficient.

**Required behavior:** install a `pre-commit` hook in the product clone that fails the commit if any staged path is under `.squad/`. Predicate:
`git diff --cached --name-only | grep -q '^\.squad/'` → if matched, print an explanatory error (the product clone must not track `.squad/`; write team state to the host clone's `.squad/` via TEAM_ROOT) and exit non-zero. The guard fires on the **product** working branch only and forbids tracking, not on-disk existence (a `.squad/` hydration cache may exist and is untracked).

**Hard constraints:**
- The guard rejects only **staged** `.squad/` paths (`git diff --cached --name-only`); it does not touch untracked or working-tree-only `.squad/` files.
- Installed in the product clone(s), not the host clone (the host legitimately tracks `.squad/` on its own branch model).
- No orphan backend or orphan branch is created on the product clone by this guard.
- The error message names the correct destination (host clone `.squad/` via TEAM_ROOT) so the developer/agent can self-correct.
- Install is in its own try/catch, independent of the cross-repo `post-commit` install (a failure to install the pre-commit guard must not abort the post-commit install, and vice versa).

**Test surface:** (a) staging a `.squad/...` path in the product clone and attempting a commit is rejected with the explanatory error and a non-zero exit; (b) a commit with no staged `.squad/` paths succeeds; (c) an untracked/un-staged `.squad/` cache on disk does not trip the guard; (d) the guard is installed only in the product clone, not the host clone.

---

### N. Dual-role registration — both-by-default, no schema change (RATIFIED)

**Ratified decision:** one `squad assign` registers **both** roles at the same host: an upstream READ-context role (always-on, read-only) and a shared-squad STATE role. State-sync activates only when an inbox handle is set. There is **no** schema change, **no** `role` discriminant field, and **no** separate registry file — the existing registry round-trips extra/unknown fields already.

**Current state:**
- `squad assign` writes the host clone's path under `entry.path` and (after J) the inbox handle under `entry.inboxHandle`.
- State-sync is already handle-gated: the push-without-handle guard at `sync.ts:709–716` (`if (!resolvedAlias && isPush && crossRepo) exit 1`) means the STATE role is inert until a handle resolves. The handle resolves through the chain at `sync.ts:683–689` (renamed flag → `SQUAD_INBOX_HANDLE` env → `entry.inboxHandle`).
- `writeRegistry` round-trips extra/unknown fields already (`registry.ts:171–177`), and the `RegistryEntry` index signature `[key: string]: unknown` (`registry.ts:22`) permits additional fields without a schema change.

**Required behavior:** confirm and document that a single `squad assign` already establishes both roles with the existing fields — the upstream READ-context role is served from the host clone's local `.squad/` (no new transport; the host `.squad/` is already local), and the shared-squad STATE role activates when the inbox handle is set. Do **not** add a `role`/`type` discriminant, a `upstreamPath` field, or a second registry file. If any code path currently assumes a single role per entry, adjust it to treat the same entry as serving both roles (read always-on, state handle-gated). The deliverable is primarily the wiring/confirmation that both roles coexist on one entry plus tests that pin the behavior — no schema migration.

**Hard constraints:**
- No new registry field, no discriminant, no separate registry file — both roles ride the existing `entry.path` (read context) and `entry.inboxHandle` (state activation).
- The READ-context role is read-only and always-on; it must never be gated by the inbox handle.
- The STATE role remains handle-gated exactly as today (`sync.ts:709–716`); with no handle, state-sync stays inert and the read role still functions.
- Depends on J (the handle field is `inboxHandle`) and on the two-hook model (both roles must be live at the same host once hooks fire from either clone).

**Test surface:** (a) a single `squad assign` produces one registry entry that serves the upstream read role (host `.squad/` is resolvable as context) regardless of handle presence; (b) with no inbox handle set, the state-sync push path is inert (the `sync.ts:709–716` guard fires) while the read role still resolves; (c) with an inbox handle set, the state role activates; (d) no `role`/`type` discriminant or second registry file is created; (e) `writeRegistry` round-trips the dual-role entry without dropping fields.

---

## Deferred / out of scope

- **P — host self-publish (`"selfPublish"` opt-in).** Explicitly deferred. This piece does **not** spec or implement a host-side self-publish flag or its bootstrap/hydration-idempotency mechanics. The two-hook model already covers host-direct commits (the host hook fires on non-`.squad/` changes), so self-publish is not required for the ratified workflow.
- **Option-3 host-sync-as-first-class (from piece-37 sub-proposal M).** Deferred and folded into the deferred P. Sub-proposal M in this piece delivers only the actionable guard (Option 2); a dedicated host-sync codepath is out of scope.

---

## Acceptance

This piece is complete when:

1. **Build exits 0.** `npm run build` completes without errors.
2. **Pre-existing tests pass without modification.** All tests from pieces 26–37 pass unchanged, except where a ratified behavior change in this piece necessitates a justified assertion update (each such update is documented in the PR with the reason).
3. **Per-item coverage.** Each sub-proposal (J, L, M, K, O, the two-hook model, the product `.squad/`-forbid guard, N) has at least one targeted test matching its Test surface.
4. **Publish-model E2E.** A commit in the **product** clone triggers a publish that snapshots the **host** clone's `.squad/` working tree to an inbox branch, with no working-tree commit created in either clone and `SQUAD_SYNC_ACTIVE` set during the publish.
5. **Product `.squad/`-forbid guard.** A test confirms that staging a `.squad/` path in the product clone and committing is rejected (non-zero exit, explanatory error), while a commit with no staged `.squad/` paths succeeds.
6. **J rename complete.** Zero `developerAlias` / `--developer-alias` / `SQUAD_DEVELOPER_ALIAS` / `DEVELOPER_ALIAS_RE` residue remains in `packages/*/src` or docs (the `ERR_ASSIGN_INVALID_ALIAS` drift folded in).
7. **O enum reconciled.** The SDK registry validator accepts `stateBackend: 'orphan'` and round-trips it through `writeRegistry`; the canonical backend value set is identical across the registry union, `validBackends`, and the runtime handlers; no `flat` reference remains.
8. **Hooks installed in both clones.** `squad assign` installs the cross-repo `post-commit` hook in both the host clone (filter-out `.squad/` via `diff-tree --root`) and the product clone (unfiltered), each in an independent try/catch.
9. **Dual-package patch changeset.** `.changeset/*.md` records a `patch` bump for **both** `@bradygaster/squad-cli` and `@bradygaster/squad-sdk`.
10. **Scrub gate passes.** `pwsh docs/proposals/upstream-bradygaster/_scrub-gate.ps1` exits 0 with all gates PASS (or the pre-existing WARN baseline unchanged).
11. **Supersession recorded.** The kickoff/implementation records that installing hooks in both clones supersedes the piece-34 host-only constraint (`.squad/decisions.md:998`).
