@Lead and Team, this is the Phase B replay session for piece 39 of the upstream stack.
Phase A staged the piece 39 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted Tier-1 sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 39 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay` (clone of akubly/squad).
- Branch to create: `squad/piece-39-dogfood-fixes-and-fold-pipeline-repair` off
  `squad/piece-38-multi-clone-publish-model`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve
  that isolation — do not add remotes pointing to source material, do not browse other
  paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch —
do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/39-dogfood-fixes-and-fold-pipeline-repair.md
```

If `39-dogfood-fixes-and-fold-pipeline-repair.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

Piece 39 addresses dogfood-surfaced defects in the fold pipeline and CLI, plus two
accepted design items. The implementation in Phase B covers all Tier-1 items (A–J).
Tier-2 items K and L require recorded decisions before any code lands — do not implement
K or L under any circumstances this session even if the user provides guidance mid-session.
If the user asks about K or L implementation during Phase B, note the decision gate and
defer.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-39-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Fold trigger: embed pipeline YAML in inbox snapshot | **BLOCKER** | Accept — also add scheduled fallback trigger |
| B — Git identity: add `git config` step to ADO template | **BLOCKER** | Accept — verify GitHub template too |
| C — jq double-quote: single-quote `FOLDED_ENTRIES` assignment (ADO) | **BLOCKER** | Accept |
| D — `git read-tree` overlap: `git rm --cached .squad/` before each iteration | **BLOCKER** | Accept — both ADO and GitHub templates |
| E — `--dry-run` direction: branch on push/pull in dry-run block | BUG | Accept |
| F — `--dry-run` allowlist: apply `isAllowlisted` filter in dry-run enumeration | BUG | Accept |
| G — `--inbox-handle` spacing: align to peer flags in assign help | BUG, cosmetic | Accept |
| H — `--developer` → `--inbox-handle`: canonical flag rename on sync | UX | Accept — retain `--developer` as deprecated alias |
| I — git-config fallback for inbox handle (4th resolution step) | DESIGN-ACCEPTED | Accept |
| J — gitignore-on-init: allowlist-scoped only; do NOT blanket-gitignore `.squad/` | DESIGN-ACCEPTED | Accept |
| K — `agents/*/history.md` fold-or-not | **DECISION PENDING** | **Do not implement until the decision is recorded. Recommendation is K2 (keep on working branch). If unresolved at implementation time, defer and proceed with A–J.** |
| L — Default `stateBackend` at `squad init --callsign` | **DECISION PENDING** | **Do not implement until the decision is recorded. Recommendation is L1 (write explicit orphan default). If unresolved at implementation time, defer.** |

Record accept/defer for each sub-proposal in `.squad/decisions/inbox/piece-39-triage.md`
before writing any product code.

---

## Workflow for piece 39

**a.** Create the implementation branch off piece 38:

```
git fetch origin
git checkout squad/piece-38-multi-clone-publish-model
git checkout -b squad/piece-39-dogfood-fixes-and-fold-pipeline-repair
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-39-triage.md`.
The triage document must exist before the first product file is modified.

**c.** For each accepted sub-proposal (A–J), implement TDD: write failing tests first,
then implementation, red-to-green. Recommended order: A–D (fold-pipeline blockers as a
clean sub-stack), then E–H (CLI bugs), then I–J (design-informed). K and L are DECISION
PENDING — do not touch their code paths.

See implementation notes below for per-sub-proposal file:line guidance.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items from `_internal/`, `REPLAY-PROTOCOL.md`,
and `00-stack-overview.md` are not blocking.

**e.** Add a changeset — `packages/squad-cli/src/` is touched:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Repair fold-pipeline blockers
(embed YAML, git identity, jq quoting, read-tree overlap); fix dry-run direction and
allowlist; rename sync flag to --inbox-handle; add git-config handle fallback;
gitignore-on-init for allowlist paths."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body must list: sub-proposals accepted (A–J), K/L deferral status, triage
outcome, scrub gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-39-dogfood-fixes-and-fold-pipeline-repair
```

**h.** STOP. Do not open a PR. Phase C handles PR opening as a separate, deliberate
workflow.

---

## Implementation notes

### Sub-proposals A–D — Fold-pipeline blockers (implement first, as a clean sub-stack)

**Sub-proposal A — Embed pipeline YAML in inbox snapshot (`sync.ts:388–390`)**

Insertion point: after all `.squad/` staging is complete (after `sync.ts:388`), before
`write-tree` (`sync.ts:390`). The `teamRoot` path is in scope at this point (available
from the caller chain; see `sync.ts:759`).

Probe pattern (insert both probes independently):
```typescript
const adoYamlPath = path.join(teamRoot, '.azuredevops', 'fold-squad-state.yml');
if (fs.existsSync(adoYamlPath)) {
  const content = fs.readFileSync(adoYamlPath);
  const sha = execFileSync('git', ['hash-object', '-w', '--stdin'],
    { cwd: teamRoot, env: indexEnv, input: content, encoding: 'utf-8' }).trim();
  execFileSync('git', ['update-index', '--add', '--cacheinfo',
    `100644,${sha},.azuredevops/fold-squad-state.yml`],
    { cwd: teamRoot, env: indexEnv });
}
// Repeat the same pattern for .github/workflows/fold-squad-state.yml
```

For the scheduled fallback, add a `schedules:` block to both templates:
```yaml
schedules:
  - cron: '*/15 * * * *'
    displayName: Fold squad inbox every 15 minutes (fallback)
    branches:
      include:
        - main    # adjust to repo default branch
    always: false
```
Place this after the existing `trigger:` block in both templates.

**IMPORTANT — Manual verification required for the ADO orphan-branch trigger:** After
implementing sub-proposal A, document in the triage file whether ADO fires a CI trigger
when an orphan branch (no git parent) is pushed. Test: push a synthetic orphan containing
the YAML via `git push origin <sha>:refs/heads/squad/inbox/test/<ts>` and observe whether
the pipeline queues. This behavior is not verified from this repository — record the
empirical result as a triage annotation.

---

**Sub-proposal B — Git identity step (`fold-squad-state.yml`, ADO template)**

Insert immediately after the `checkout` step in the ADO template (before any bash step
that runs `git commit`). The step has no `condition:`:

```yaml
- bash: |
    git config user.email "squad-fold@noreply"
    git config user.name "Squad Fold Pipeline"
  displayName: Configure git identity
```

For the GitHub template: inspect whether GitHub-hosted runners preset `user.email` and
`user.name` in their git config. If not, add the same step. Document the finding in the
triage file.

---

**Sub-proposal C — jq quoting fix (`fold-squad-state.yml:187`, ADO template)**

Single-character change. Before:
```bash
FOLDED_ENTRIES="$(foldRefs.foldedEntries)"
```
After:
```bash
FOLDED_ENTRIES='$(foldRefs.foldedEntries)'
```
No other lines in the publish-history block are modified. Do not change the GitHub
template equivalent.

---

**Sub-proposal D — read-tree overlap fix (both templates)**

In the ADO template, before line 150; in the GitHub template, before line 158 (or
wherever `git read-tree --prefix=.squad/ -u` appears in the fold loop):

```bash
git rm -r --cached .squad/ 2>/dev/null || true
git read-tree --prefix=.squad/ -u "$INBOX_SQUAD_TREE"
git add .squad/
```

The `|| true` is required. Both templates need this fix.

Write one test per template: fold run with 2 inbox refs completes without overlap error
and both refs are present in the resulting state branch tree.

---

### Sub-proposal E — `--dry-run` direction (`sync.ts:714–728`)

Read `isPush` and `isPull` (or the resolved `direction` variable) in the dry-run block.
Pattern:

```typescript
if (dryRun) {
  if (isPush || direction === 'push' || direction === 'both') {
    console.log(`Target inbox branch: ${inboxBranch}`);
  }
  if (isPull || direction === 'pull' || direction === 'both') {
    console.log(`Would pull from remote: ${stateRemote ?? DEFAULT_STATE_REMOTE}, branch: ${stateBranch ?? 'squad-state'}`);
  }
  return;
}
```

Adjust to match the actual variable names in scope at the dry-run block. The return must
come after direction branching, not before it.

---

### Sub-proposal F — `--dry-run` allowlist filter (`sync.ts:715`)

Change the dry-run enumeration to apply `isAllowlisted`:
```typescript
const files = (teamRoot ? enumerateSquadFiles(teamRoot) : enumerateSquadFiles(repoRoot))
  .filter(isAllowlisted);
```
Add a second count for context (total files before filter vs. files to be published).

---

### Sub-proposal G — Spacing fix (`cli-entry.ts:355`)

Reduce trailing spaces from 7 to 5 (or whatever count aligns with the peer flags at
lines 356–359). One-character diff.

---

### Sub-proposal H — Flag rename (`cli-entry.ts:340,1465`, `sync.ts:32`)

Add `--inbox-handle` in the parse block alongside `--developer` at `cli-entry.ts:340`.
At `cli-entry.ts:1465`, coalesce: `inboxHandle: opts['inbox-handle'] ?? opts['developer']`.
In `SyncOptions` at `sync.ts:32`, add `inboxHandle?: string` alongside (or replacing)
`developer?`. In `sync.ts:706–710`, resolve with `options.inboxHandle ?? options.developer`
so both names work. Update `squad sync --help` text to show `--inbox-handle` as primary.

---

### Sub-proposal I — git-config fallback (`sync.ts:706–710`)

Add a helper function (e.g., `deriveHandleFromGitEmail(cwd: string): string | undefined`):
1. Execute `git config user.email` in `cwd`.
2. Extract local-part (before `@`).
3. Apply sanitization pipeline: lowercase → `.` → `-` → strip non-`[a-z0-9-]` → prepend
   `u-` if leading digit → truncate at 39.
4. If result is empty or `user.email` is unset, return `undefined`.

In the resolution chain at `sync.ts:706–710`, after the registry lookup and before the
error: try `deriveHandleFromGitEmail(repoRoot ?? cwd)`. If it returns a handle, emit a
`console.warn()` and use the value.

Align new test import specifiers with the working branch's existing test file import
pattern (do not introduce a scope name that differs from what existing tests use).

---

### Sub-proposal J — Gitignore-on-init (`commands/assign.ts`, `commands/init.ts`)

The allowlist constants are at `sync.ts:250–256`. Import or re-export them for use in
the init/assign commands. The check logic:

```typescript
const trackedAllowlisted = execFileSync('git',
  ['ls-files', '--', ...PUBLISH_ALLOWLIST_EXACT, ...PUBLISH_ALLOWLIST_PREFIX],
  { cwd: repoRoot }).toString().trim().split('\n').filter(Boolean);
if (trackedAllowlisted.length > 0 && backendIsOrphan) {
  // prompt user: offer git rm --cached + .gitignore install
}
```

The `.gitignore` entries written are exactly the allowlist constants — NOT `.squad/` as
a blanket. If the `.gitignore` entry already exists (re-run), skip it (idempotent).

---

## Acceptance gate

- `npm run build` exits 0.
- All new tests pass (`npm test`).
- Fold-pipeline blockers A–D each have a regression test; the fold pipeline template
  tests cover single-ref and two-ref runs.
- Sub-proposal A: **manual ADO orphan-branch trigger verification documented in triage
  file** (the behavior is UNCONFIRMED from the repository; empirical result must be
  recorded, positive or negative).
- Sub-proposals E–J: each has at least one test per test-surface item in the spec.
- K and L: no code touching their logic; triage document records their decision-pending
  status and recommendations.
- Scrub gate: your changes contribute no new hits on Gates 1–4.
- Changeset: `patch` for `@bradygaster/squad-cli` is present.
- Commit: single squashed commit with `Co-authored-by: Copilot ...` trailer.
- Branch pushed to `origin`; no PR opened.
