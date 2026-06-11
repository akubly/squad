# 39 — Dogfood fixes and fold-pipeline repair

## Summary

Repair four fold-pipeline blockers that prevent a complete automated run, four CLI bugs
surfaced during dogfooding, and implement two accepted design-informed items that close
identified gaps in the single-squad workflow. Two additional design items are deferred
pending recorded decisions.

Stack position: Part 39 of the cross-repo arc. Branches off piece 38
(`squad/piece-38-multi-clone-publish-model`). Depends on pieces 26–38 all being present
on the branch.

Changeset requirement: `packages/squad-cli/src/` is touched by Tier-1 items — include a
`patch` changeset entry for `@bradygaster/squad-cli`. Fold-pipeline templates distributed
with the package are also touched; include them in the same changeset. Tier-2
(decision-required) items carry no changeset until their decisions are recorded.

---

## Problem

Dogfooding the shared-squad fold pipeline on an ADO-hosted repository surfaced four
structural blockers that make automated folding impossible as delivered, plus a cluster of
CLI UX and correctness defects, plus two design gaps that have recorded verdicts and are
ready to implement.

### Fold-pipeline blockers (A–D)

**Trigger never fires on inbox pushes.** Inbox branches are orphan commits whose tree
contains only allowlisted `.squad/` content; the pipeline YAML is absent from those
branches. ADO evaluates whether to fire a CI trigger by reading the pipeline YAML from
the pushed branch — if the file is absent, no trigger fires. A scheduled fallback is
needed as insurance.

**Every commit in the pipeline fails with "empty ident name".** The ADO fold template
has no `git config user.email`/`user.name` step. ADO-hosted agents carry no default git
identity (unlike GitHub-hosted runners). Every `git commit` in the template — the per-ref
fold commit, the publish-history update, and the orphan-init commit — exits with a fatal
error.

**The publish-history update produces invalid JSON, breaking `jq`.** The ADO template
wraps the expanded `$(foldRefs.foldedEntries)` output variable in double quotes
(`fold-squad-state.yml:187`). Bash treats embedded `"` inside a double-quoted assignment
as string delimiters, corrupting the value before it reaches `--argjson`. The cascading
failure breaks two `jq` calls. The GitHub template uses single quotes correctly at its
equivalent line and is unaffected.

**Folding two or more inbox refs in one run fails with an index overlap error.** The fold
loop calls `git read-tree --prefix=.squad/ -u` for each inbox ref. After the first ref,
the index retains `.squad/` entries; `git read-tree` refuses to overwrite existing index
entries on the second iteration, emitting "Entry '.squad/decisions.md' overlaps … Cannot
bind." This bug is present in both the ADO and GitHub templates.

### CLI defects (E–H)

`squad sync --dry-run` always shows push-facing output regardless of `--push` or `--pull`.
The dry-run block fires before direction dispatch and never reads the direction variables.

`squad sync --dry-run` enumerates all `.squad/` files without applying the publish
allowlist, showing a far larger file set than what actually publishes.

The `--inbox-handle` flag in `squad assign --help` is over-indented by two columns
compared with peer flags.

`squad sync` uses the flag name `--developer` for the inbox-handle parameter while
`squad assign` uses `--inbox-handle` for the same concept. The inconsistency misleads
users and the sync error message at `sync.ts:733` already says `--inbox-handle`, creating
a secondary mismatch within sync itself.

### Design-informed items (I–J)

Two design questions have recorded verdicts and are ready to implement: (I) a git-config
fallback for the inbox-handle resolution chain, and (J) gitignore-on-init scoped to
allowlist paths only, per the two-layer context/state verdict.

---

## Proposed change

Sub-proposals are divided into two tiers.

**Tier 1 (sub-proposals A–J):** Concrete, implementation-ready items. A–D repair the
fold pipeline; E–H repair CLI defects; I–J implement accepted design verdicts. These
form a clean sub-stack and can ship together.

**Tier 2 (sub-proposals K–L):** Design-required items. Each presents options, tradeoffs,
and a recommendation. No code lands until the corresponding decision is recorded in
`.squad/decisions/inbox/`.

**Recommended implementation order:** A–D (fold-pipeline blockers, cleanest sub-stack),
then E–H (CLI bugs), then I–J (design-informed). K–L are gated on their recorded
decisions and may slip to a follow-on piece if unresolved.

---

## Tier 1 — Fold-pipeline blockers

### A. Fold pipeline trigger never fires on inbox pushes (BLOCKER)

**Current behavior:** `publishTeamRootToInbox` at `sync.ts:338–401` builds an isolated
index (`GIT_INDEX_FILE`, `sync.ts:343`) containing only allowlisted `.squad/` files
(filter at `sync.ts:335–336`), then calls `commit-tree` with no parent (`sync.ts:396`)
and pushes the result as a new orphan branch (`sync.ts:401`). The pipeline YAML
(`.azuredevops/fold-squad-state.yml` or `.github/workflows/fold-squad-state.yml`) is
never staged and is therefore absent from every inbox branch tree. ADO evaluates CI
triggers from the YAML on the pushed branch; no YAML → no trigger.

**Required behavior:** After all `.squad/` files are staged in the isolated index (after
`sync.ts:388`, before `write-tree` at `sync.ts:390`), probe for both platform pipeline
YAML files relative to `teamRoot`:
- `.azuredevops/fold-squad-state.yml`
- `.github/workflows/fold-squad-state.yml`

For each file that exists (`fs.existsSync` guard), read its content and insert it into
the isolated index using `git hash-object -w --stdin` followed by
`git update-index --add --cacheinfo 100644,<sha>,<path>` with `env: indexEnv`. If neither
file exists (fold pipeline not yet installed), publish proceeds silently with no YAML in
the snapshot — graceful degradation, no error. This preserves the no-drift property: the
YAML embedded in the snapshot is read fresh from `teamRoot` at publish time, always
matching the installed version.

Additionally, add a `schedules:` block to both fold pipeline templates as a fallback
trigger (every 15–30 minutes, running from the default branch, `always: false`). The
`trigger:` block remains for event-driven operation; the schedule is additive insurance.

**Explicit tradeoff note:** Embedding the pipeline YAML breaks the invariant that inbox
snapshots contain only allowlisted `.squad/` content. This is a deliberate, guarded
exception: the YAML is published only when present, and its presence enables event-driven
folding. The allowlist remains the rule for `.squad/` content; this exception applies only
to platform-specific pipeline YAML files at known paths.

**Unconfirmed edge:** Whether ADO fires a CI trigger when an orphan branch is first
created requires a manual verification test: push a synthetic orphan branch containing
the YAML and confirm the pipeline queues. The kickoff prompt instructs the implementer
to document the verification result.

**Hard constraints:**
- `fs.existsSync` guard is required: absence of the YAML must not fail or warn.
- Both `.azuredevops/` and `.github/workflows/` paths are probed independently.
- `GIT_INDEX_FILE` / `env: indexEnv` must be passed to all git commands on the isolated
  index.
- Scheduled trigger must use `always: false`.
- Single-repo mode (no registry match) is unaffected.

**Test surface:** (a) When both YAML files are installed, inbox snapshot tree contains
both at their canonical paths. (b) When neither is installed, publish completes without
error and snapshot contains no YAML. (c) The scheduled trigger block appears in both
platform templates.

---

### B. Fold commit fails: no git identity on ADO agents (BLOCKER)

**Current behavior:** The ADO fold template (`templates/fold/ado/fold-squad-state.yml`)
has no `git config user.email` or `user.name` step anywhere in its steps (lines 1–224).
`--author="Squad Fold Pipeline <squad-fold@noreply>"` at line 155 sets author identity
only; git still requires a separate committer identity. ADO-hosted Ubuntu agents carry no
default git identity. Every commit in the pipeline — the per-ref fold commit
(`fold-squad-state.yml:153`), the publish-history update (`fold-squad-state.yml:197`),
and the orphan-init commit (`fold-squad-state.yml:105`) — exits with
`fatal: empty ident name`.

**Required behavior:** Add a "Configure git identity" step to the ADO template,
immediately after the `checkout` step and before any commit can run:

```yaml
- bash: |
    git config user.email "squad-fold@noreply"
    git config user.name "Squad Fold Pipeline"
  displayName: Configure git identity
```

This step must have no `condition:` — it must always run. Verify whether the GitHub
template requires the same step; GitHub-hosted runners preset a default identity, but
confirm and add the step if that assumption cannot be relied upon.

**Hard constraints:**
- The step must execute before the first commit site in the template.
- Identity strings are fixed (`squad-fold@noreply`, `Squad Fold Pipeline`); not
  parameterized as pipeline variables.
- GitHub template must be inspected and patched if runner default is absent.

**Test surface:** All three pipeline commit sites exit 0 with git identity configured.

---

### C. jq `--argjson` receives corrupted JSON in ADO template (BLOCKER)

**Current behavior:** `fold-squad-state.yml:187` (ADO) assigns the expanded output
variable in double quotes:
```bash
FOLDED_ENTRIES="$(foldRefs.foldedEntries)"
```
ADO expands `$(foldRefs.foldedEntries)` to a JSON array before shell execution. Inside a
double-quoted bash assignment, embedded `"` characters close the outer quote, corrupting
the value. `--argjson entries "$FOLDED_ENTRIES"` at line 192 receives invalid JSON →
first jq error. `$NEW_RECORD` is empty or corrupted → second jq error at line 195. The
GitHub template uses single quotes at its equivalent line (`fold-squad-state.yml:201`)
and is unaffected.

**Required behavior:** Change line 187 in the ADO template from double quotes to single
quotes:
```bash
FOLDED_ENTRIES='$(foldRefs.foldedEntries)'
```
ADO still expands the macro before shell execution regardless of quote style; bash then
treats the result as a literal single-quoted string, preserving all embedded `"` safely.

**Hard constraints:**
- Only the quoting change on line 187 is in scope.
- The GitHub template equivalent is not changed (it is already correct).

**Test surface:** The publish-history step completes without jq errors;
`publish-history.json` is updated correctly after a successful fold run.

---

### D. `git read-tree --prefix=.squad/` overlap on second inbox ref (BLOCKER)

**Current behavior:** The fold loop calls
`git read-tree --prefix=.squad/ -u "$INBOX_SQUAD_TREE"` at `fold-squad-state.yml:150`
(ADO) and at `fold-squad-state.yml:158` (GitHub) for each inbox ref. After iteration 1,
the index retains all `.squad/` entries. On iteration 2, `git read-tree` refuses to
overwrite existing entries: "Entry '.squad/decisions.md' overlaps … Cannot bind." This
bug is present identically in both templates.

**Required behavior:** Insert `git rm -r --cached .squad/ 2>/dev/null || true` immediately
before each `git read-tree --prefix=.squad/ -u` call in both templates. This clears the
`.squad/` prefix from the index before each iteration without touching the working tree.
The `2>/dev/null || true` prevents pipeline failure on iteration 1 when `.squad/` may
not yet be in the index.

**Hard constraints:**
- The fix applies to **both** ADO and GitHub templates.
- `|| true` is required to avoid failure on the first iteration.
- No other loop logic is modified.

**Test surface:** A fold run with two or more inbox refs completes without overlap errors;
all refs are folded into the state branch.

---

## Tier 1 — CLI defects

### E. `squad sync --dry-run` ignores direction; always shows push preview (BUG)

**Current behavior:** The dry-run block at `sync.ts:714–728` fires before direction
dispatch and never reads `isPush`/`isPull` computed at `sync.ts:621–622`. `--dry-run
--pull` prints "Target inbox branch: squad/inbox/..." — a push-facing message meaningless
for pull.

**Required behavior:** In the dry-run block, branch on the resolved direction to produce
direction-appropriate output. Push dry-run shows inbox branch preview; pull dry-run shows
the state branch and remote it would fetch from; both-mode shows both. The early return
must not fire before reading the direction.

**Hard constraints:**
- Dry-run executes no actual git operations in any direction.
- The early-return behavior of dry-run (skip live publish/hydrate) is preserved.

**Test surface:** (a) `--dry-run --push` output contains inbox branch name. (b)
`--dry-run --pull` output does not contain "Target inbox branch" and describes the pull
source. (c) `--dry-run --both` covers both directions.

---

### F. `squad sync --dry-run` lists all `.squad/` files, not the allowlisted subset (BUG)

**Current behavior:** `sync.ts:715` calls `enumerateSquadFiles(teamRoot)` without filter.
The actual publish path at `sync.ts:335–336` applies `filter(isAllowlisted)`. Dry-run
output includes non-allowlisted files (`agents/`, `team.md`, `routing.md`, `skills/`,
etc.) giving false signal.

**Required behavior:** Apply `filter(isAllowlisted)` to the dry-run enumeration at
`sync.ts:715`. Output both totals: files that would be published and (optionally) count
excluded by the allowlist. Example: "Would publish 4 files (12 others excluded by
allowlist)."

**Hard constraints:**
- `isAllowlisted` must be the same function used in the publish path.
- The output label must make the allowlist-filtering explicit.

**Test surface:** (a) Dry-run file count equals the count a live push would publish. (b)
Non-allowlisted files do not appear in dry-run output.

---

### G. `--inbox-handle` flag description over-indented in `squad assign --help` (BUG, cosmetic)

**Current behavior:** `cli-entry.ts:355` has 7 trailing spaces between the flag
definition and its description. Peer flags at lines 356–359 have consistent alignment 2
columns earlier.

**Required behavior:** Align `--inbox-handle`'s trailing spaces to match peer flags in
the same block (reduce from 7 to 5 trailing spaces or use a consistent padding constant).

**Hard constraints:** Only the spacing on `cli-entry.ts:355` is in scope. No help text
content changes.

**Test surface:** `squad assign --help` output — `--inbox-handle` description starts at
the same column as all peer flag descriptions.

---

### H. Flag inconsistency: `--developer` (sync) vs `--inbox-handle` (assign) (UX)

**Current behavior:** `squad assign` uses `--inbox-handle` (`assign-args.ts:28`).
`squad sync` uses `--developer` for the same concept (`cli-entry.ts:340`,
`SyncOptions.developer` at `sync.ts:32`), despite the sync error message at `sync.ts:733`
already referencing `--inbox-handle`. Both flags write to the same resolved handle value.

**Required behavior:** Add `--inbox-handle` as the canonical flag for `squad sync`.
Retain `--developer` as a deprecated alias: accept it silently, do not error, omit from
help or mark as deprecated. Update touch points:
- `cli-entry.ts:340` — add `--inbox-handle` alongside `--developer` in the parse block
- `cli-entry.ts:1465` — honor `--inbox-handle` value in sync argument construction
- `SyncOptions` (`sync.ts:32`) — add `inboxHandle?: string`; keep `developer?` or unify
  with a coalesce

The `squad sync --help` text must show `--inbox-handle` as the primary flag.

**Hard constraints:**
- `--developer` must continue to work without error (back-compat alias, not removed).
- Both flags must resolve to the same handle value.
- `sync.ts:733` error message is unchanged.

**Test surface:** (a) `squad sync --inbox-handle <h>` resolves the handle. (b)
`squad sync --developer <h>` also resolves the handle. (c) `squad sync --help` shows
`--inbox-handle` as primary.

---

## Tier 1 — Design-informed

### I. Git-config fallback for inbox handle (ACCEPTED)

**Current behavior:** The resolution chain at `sync.ts:706–710` has three steps: (1)
`--inbox-handle`/`--developer` CLI flag, (2) `SQUAD_INBOX_HANDLE` env var, (3) registry
`inboxHandle`. When none is set, the command errors with "inbox handle required." No
derivable fallback exists.

**Required behavior:** Add a 4th fallback after step 3: derive from `git config
user.email` local-part (before `@`), sanitized to
`INBOX_HANDLE_RE = /^[a-z][a-z0-9-]{1,38}$/`:
- Lowercase all characters
- Replace `.` with `-`
- Strip characters outside `[a-z0-9-]`
- Prepend `u-` if result begins with a digit
- Truncate to 39 characters

Emit a warning when the fallback fires:
"Derived inbox handle '<handle>' from git user.email — run 'squad assign --inbox-handle
<handle>' to persist."

If `git config user.email` returns nothing or the sanitized result is empty, fall through
to the existing error.

**Hard constraints:**
- Warning must always be emitted when the fallback fires; it must not be suppressed.
- Derivation logic must be a named helper function (not inline) for testability.
- `user.name` is not used (spaces and non-ASCII make it unreliable).

**Test surface:** (a) `user.email = "john.doe@example.com"` → handle `john-doe`. (b)
Email with digit-leading local-part → `u-<sanitized>`. (c) Warning emitted on fallback.
(d) Error (not derivation) when `user.email` is unset.

---

### J. Gitignore-on-init scoped to allowlist paths only (ACCEPTED, per two-layer verdict)

**Current behavior:** `squad init` (and `squad assign`) install no `.gitignore` entry for
`.squad/` state content and do not offer `git rm --cached` for tracked allowlisted paths.
Host clones with `.squad/` tracked on their working branch continue including state files
in PR diffs, defeating the orphan backend's purpose.

**Required behavior:** When `squad init` (or `squad assign`) runs in orphan-backend mode
and detects that any allowlisted `.squad/` path is currently tracked (`git ls-files --
<allowlist-paths>`), offer the user:
1. `git rm --cached` for each tracked allowlisted path
2. Install or append to `.gitignore` covering only the allowlist paths:
   - `.squad/decisions.md`
   - `.squad/.last-publish`
   - `.squad/decisions/inbox/`
   - `.squad/log/`
   - `.squad/orchestration-log/`
   - `.squad/sessions/`
   - `.squad/identity/`

Context files — `team.md`, `routing.md`, `agents/*/charter.md`, `skills/`, `templates/`
— must NOT be added to `.gitignore`. They remain tracked and reviewed via normal PR
workflow.

If no allowlisted paths are tracked, no change is made (idempotent).

**Hard constraints:**
- Gitignore covers only allowlist paths. Blanket `.squad/` gitignore is forbidden — it
  suppresses context file tracking.
- The `git rm --cached` step is interactive (prompted or `--yes` flag), not silently
  destructive.
- Allowlist paths used for the gitignore are the same constants as
  `PUBLISH_ALLOWLIST_EXACT` and `PUBLISH_ALLOWLIST_PREFIX` at `sync.ts:250–256`.

**Test surface:** (a) After orphan-mode init with tracked `decisions.md`, `.gitignore`
contains `.squad/decisions.md`. (b) `team.md` is not gitignored. (c) Re-running init
does not duplicate gitignore entries. (d) No gitignore change occurs when no allowlist
paths are tracked.

---

## Tier 2 — Design decisions (DECISION REQUIRED before implementation)

### K. `agents/*/history.md` fold-or-not (DECISION REQUIRED)

**Context:** `agents/*/history.md` files are agent-appended state artifacts accumulating
session learnings, behaviorally similar to `decisions.md`. They are NOT in the publish
allowlist and live on the host working branch. The omission is implicit: the shipped
system did not add them to the allowlist.

**Option K1 (fold as state):** Add `.squad/agents/` to `PUBLISH_ALLOWLIST_PREFIX`.
History files flow through inbox → fold to squad-state. Clean separation; no histories
in PR diffs.
*Downside:* Reviewers lose visibility into agent memory evolution; histories require a
separate checkout to read.

**Option K2 (working-branch hybrid):** Keep histories on the host working branch with
documented commit discipline. Histories are useful in PR context; agents commit them
directly.
*Downside:* The serialization guarantee of fold does not apply; concurrent agent sessions
may conflict on history files.

**Recommendation:** K2. Histories on the working branch is coherent and preserves review
utility. The serialization risk is lower than for `decisions.md` (histories are
append-only per-agent, not convergently merged across agents). Document the asymmetry
explicitly rather than correcting it by folding.

**Implementation gate:** Record decision in `.squad/decisions/inbox/` before any code
changes. If unresolved at implementation time, defer to a follow-on piece and proceed
with A–J.

---

### L. Default state-backend at `squad init --callsign` (DECISION REQUIRED)

**Context:** `squad init --callsign <name>` without `--state-backend` writes no
`stateBackend` field to `.squad/config.json` (`cli-entry.ts:403–404`;
`cli/core/init.ts:270` — skipped when undefined). At sync time, `runSync` at
`sync.ts:655` enforces `backend = 'orphan'` for any registry-matched entry regardless
of what config.json says. Config.json is inconsistent with sync's effective behavior;
`squad doctor` may misreport the backend.

**Option L1 (explicit default at init):** When `--callsign` is provided and
`--state-backend` is not, write `stateBackend: "orphan"` to config.json at init time.
Config becomes self-documenting.

**Option L2 (status quo + doctor warning):** Leave the implicit orphan enforcement in
`runSync`; add a `squad doctor` warning when `stateBackend` is absent for a
callsign-registered entry.

**Recommendation:** L1. Writing the explicit default removes a hidden behavioral
assumption. The write is a one-liner at `cli/core/init.ts:270` guarded by
`if (opts.callsign && !opts.stateBackend)`.

**Implementation gate:** Record decision in `.squad/decisions/inbox/` before any code
changes. If unresolved at implementation time, defer to a follow-on piece.

---

## Acceptance

- Build exits 0.
- The fold pipeline completes a manually triggered run with zero errors (all four fold
  blockers A–D resolved; regression tests for each).
- Item A: inbox snapshot trees contain the pipeline YAML when installed; absent gracefully
  when not. **Manual verification required:** push a synthetic orphan branch with the YAML
  and confirm ADO queues the pipeline (ADO orphan-branch trigger behavior is not verified
  from this repository; document the result in the triage doc).
- Item B: pipeline commits succeed (all three commit sites exit 0).
- Item C: `publish-history.json` is updated correctly without jq errors.
- Item D: fold run with two or more inbox refs completes without overlap errors.
- Items E–H: `squad sync --dry-run` direction-aware, allowlist-filtered, help aligned,
  canonical flag — each verified with tests.
- Item I: git-config fallback resolves handle with correct sanitization, emits warning.
- Item J: gitignore covers allowlist paths only; context files remain tracked; idempotent.
- Items K–L: implemented only after their recorded decisions exist in
  `.squad/decisions/inbox/`; deferred without implementation if unresolved.
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
