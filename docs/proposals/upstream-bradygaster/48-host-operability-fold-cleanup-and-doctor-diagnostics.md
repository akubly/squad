# 48 — Shared-host operability: install-fold ergonomics, fold inbox-branch cleanup, and doctor host/payload diagnostics

## Summary

A fresh end-to-end dogfooding pass against the landed stack (piece-47 tip) exercised the
shared-host operator path — installing the fold pipeline into a host repository, running the
fold loop, and diagnosing a host with `squad doctor` — and surfaced seven operability gaps that
make the cross-repo workflow harder to set up and harder to keep healthy than it needs to be.
None is a transport-correctness defect (the fold loop folds correctly once configured); each is
an ergonomics, lifecycle-hygiene, diagnostics, pipeline-identity, or CLI-affordance gap that cost
real time during the pass.

1. **`install-fold-pipeline` cannot update an out-of-date pipeline file.** The command already
   declares a `force` option but never wires it into the conflict gate: when the destination
   `fold-squad-state[.<callsign>].yml` exists with different content (the common case after the
   hardened template evolves), the command hard-exits and tells the operator to delete the file
   by hand. Re-installing an upgraded template is a manual two-step.

2. **The fold pipeline's inbox-branch cleanup is present but unsafe and unreachable.** Both fold
   templates already contain a delete-folded-refs step, gated behind a `DELETE_FOLDED_REFS`
   variable that defaults to `false` and that `install-fold-pipeline` offers no way to set.
   Worse, the delete loop iterates **every discovered inbox ref** (`$SORTED_REFS`), not the
   subset that was **successfully folded** (`$FOLDED_ENTRIES`): a ref whose fold commit failed
   (and was rolled back with `git reset --hard`) would still be deleted — destroying an
   unfolded snapshot. So the feature is both off-by-default-with-no-switch and incorrect if
   turned on.

3. **`squad doctor` is silent about host-repo problems when run from a product clone.** The
   missing-fold-YAML defect that silently broke folding for an entire host (no pipeline file in
   the host working tree → every snapshot shipped without a trigger → CI never ran) is invisible
   to `doctor`. When the current directory resolves to a registered clone whose shared-squad
   **host is elsewhere**, doctor checks local registry health but never inspects the host for the
   things that actually break the loop: a missing host `.squad/`, a missing or empty fold
   pipeline YAML, or a missing in-repo coordinator agent.

4. **`doctor`'s orphan-payload diagnostic mis-identifies the owning callsign and misses
   re-namespaced orphans.** `diagnoseCopilotPayload` extracts a candidate callsign from a
   `squad-…` payload directory by splitting on the **last** hyphen, so an orphan skill
   `squad-probe-agent-collaboration` is reported as belonging to callsign `probe-agent` and the
   suggested remedy (`squad assign probe-agent`) is wrong — the real callsign is `probe`. The
   `owned` check (`startsWith("squad-<knownCallsign>-")`) also false-negatives doubly-prefixed
   payloads left by an older install era (e.g. `squad-<callsign>-squad-…`), so those stale
   directories are never flagged at all.

5. **`install-fold-pipeline` fails fast when the destination directory is absent** (`.azuredevops`
   or `.github/workflows`). This is deliberate — it prevents scaffolding a pipeline directory in
   the wrong repository when the host root is mistyped or unresolved — but it makes first-time
   install on an otherwise-correctly-resolved host a manual `mkdir` step. Whether (and how) the
   command should create the directory once the host clone is confirmed is a decision, captured
   here as Tier 2.

   6. **The fold pipeline's state-branch write-back depends on an over-privileged build-service
      account.** The automated fold runs `git push` back to `squad/state/<callsign>` using the
      pipeline's implicit `System.AccessToken` (the checkout persists credentials), so the push only
      succeeds once the operator grants the **Project Build Service** account **Contribute** on the
      state branch — the manual unblock that this dogfooding pass required before the first automated
      fold succeeded. Granting build-service accounts (PBS/PCBS) elevated repository permissions is
      precisely the pattern the platform's "Securing Azure DevOps Build Service Accounts" security
      control flags as over-privileged and places on an active remediation path; the recommended
      replacement is an Azure DevOps **service connection** backed by a managed identity or service
      principal (`aka.ms/azdosc`), giving the pipeline a per-resource, least-privilege identity
      instead of a shared, broadly-scoped account. The fold template hard-codes the `System.AccessToken`
      path and the setup docs say nothing about either the minimum permission required or the
      compliant alternative, so every operator rediscovers the grant by hitting a push failure and is
      steered toward the non-compliant fix.

7. **`squad assign`'s `--callsign` flag is overloaded, forcing a redundant restatement of the
   callsign to clear an origin-collision guard.** In the warm path the positional argument already
   names the squad to assign to (e.g. `squad assign teamx`). When the current clone's fetch remotes
   also match the recorded `origins[]` of two or more *other* registered squads, the origin-collision
   guard (Guard 8) aborts with `ERR_ASSIGN_ORIGIN_AMBIGUITY` and tells the operator to "use an
   explicit `--callsign` to disambiguate". The only value that clears it is the callsign **already
   given positionally** — `squad assign teamx --callsign teamx` — because the guard's filter merely
   drops collision candidates whose callsign differs from `--callsign`, and the target's own entry is
   already excluded, so naming it a second time empties the candidate set as a side effect rather than
   by any intentional selection. The same `--callsign` flag means something genuinely different on the
   cold-start (URL) path — there it supplies the callsign to register the freshly-cloned squad under,
   which a URL cannot provide. The result is a flag that does two unrelated jobs, an error message
   that names neither the colliding squads nor the exact remediation, and a warm-path invocation that
   makes the operator type the same callsign twice for no apparent reason.

   This piece delivers (A) `install-fold-pipeline --force`, (B) a corrected, install-time-enableable
   fold inbox-branch cleanup, (C) host-repo diagnostics in `doctor`, (D) accurate orphan-payload
   callsign attribution in `doctor`, (F) a compliant, documented state-branch write-back identity
   for the fold pipeline, and (G) de-overloaded `squad assign` origin-collision disambiguation; and
   resolves a Tier-2 decision (E) about destination-directory creation in `install-fold-pipeline`.

Stack position: Part 48 of the cross-repo arc. Branches off piece 47
(`squad/piece-47-monorepo-gitdir-and-sync-registry-robustness`). Piece 47 reopened the stack
from a dogfooding pass that found a monorepo transport defect; piece 48 continues from the next
pass, which moved past transport correctness into the host-operator experience. It depends on the
fold-pipeline install command and templates established by pieces 41/44, the callsign-scoped
install filename from piece 44, the registry `callsign` / clone resolution used by `doctor`, and
the copilot-payload namespacing from the original stack (piece 19).

Inputs: `00-stack-overview.md`, `REPLAY-PROTOCOL.md`, specs
`41-fold-pipeline-repo-root-and-generic-discovery.md`,
`44-pipeline-file-injection-hygiene-on-shared-hosts.md`,
`47-monorepo-gitdir-and-sync-registry-robustness.md`, and the
`_planning/dogfood-backlog.md` roadmap.

Changeset requirement: `packages/squad-cli/src/` is touched (the install-fold-pipeline and doctor
changes) — include a `patch` changeset entry for `@bradygaster/squad-cli`. The orphan-callsign
helper lives in `@bradygaster/squad-sdk` (`copilot-payload.ts`); if that package's source is
modified, include a `patch` changeset for `@bradygaster/squad-sdk` as well.

---

## Problem

### 1. `install-fold-pipeline`'s `force` option is declared but not wired

`InstallFoldPipelineOptions` declares `force?: boolean`, but `installFoldPipeline` never reads it.
The three-way idempotency/conflict gate is:

```ts
if (fs.existsSync(destPath)) {
  const existing = fs.readFileSync(destPath, 'utf-8');
  if (existing === templateContent) {
    console.log(`✓ ${filename} already installed and up to date.`);
    return;
  }
  // Content differs — conflict guard.
  console.error(
    `✗ ${filename} exists at ${destPath} with different content.\n` +
    `  Review and delete it manually before re-running install-fold-pipeline.`,
  );
  process.exit(1);
  return;
}
```

When the hardened template changes (it has changed repeatedly across pieces 41/42/44) every host
with a previously-installed pipeline hits the `present+differ` branch and must delete the file by
hand before re-installing. The option to do this in one step already exists in the type but does
nothing.

### 2. The fold inbox-branch cleanup is gated off and deletes the wrong set

Both fold templates (`packages/squad-cli/templates/fold/{ado,github}/fold-squad-state.yml`, and
their `packages/squad-sdk/templates/...` mirrors) end the fold with a cleanup step. In the ADO
variant:

```yaml
variables:
  - name: DELETE_FOLDED_REFS
    value: 'false'
```

```bash
git push origin HEAD:refs/heads/${STATE_BRANCH} --force-with-lease

if [ "$(DELETE_FOLDED_REFS)" = "true" ]; then
  while IFS= read -r REF; do
    [ -z "$REF" ] && continue
    echo "  Deleting folded Squad inbox ref: $REF"
    git push origin --delete "${REF#refs/heads/}" || echo "  WARNING: Failed to delete $REF — continuing."
  done <<< "$SORTED_REFS"
fi
```

The GitHub variant is equivalent (`if [ "${DELETE_FOLDED_REFS:-false}" = "true" ]; then … done <<< "$SORTED_REFS"`).

Two problems:

- **Unreachable by install.** `DELETE_FOLDED_REFS` defaults to `false` and `install-fold-pipeline`
  exposes no way to set it, so an operator cannot enable cleanup without hand-editing the
  generated YAML — and a hand-edit collides with problem (1)'s conflict gate on the next
  re-install.
- **Deletes unfolded snapshots.** The delete loop reads `$SORTED_REFS` — **all** inbox refs
  discovered for the callsign this run — not `$FOLDED_ENTRIES`, the set whose fold commit
  actually succeeded. A ref whose commit hit the failure branch (the `else` that logs a warning
  and `git reset --hard`s) is **still deleted**, so its snapshot is destroyed without ever being
  folded into `squad/state/<callsign>`. Cleanup must be driven by what was folded, never by what
  was discovered.

Inbox branches accumulate without cleanup (a dogfooding host reached 14 stale inbox branches),
so a correct, enableable cleanup is wanted — but it must only ever delete refs that were proven
folded.

### 3. `doctor` does not inspect the host repo from a product clone

`runDoctor` checks for a local `.squad/` directory, loads and validates the registry, reports
clone-match / origin-overlap health, and (via `diagnoseCopilotPayload`) reports orphaned payload
files. It never inspects the **shared-squad host** that a registered product clone points at.
The failure that silently broke folding for a whole host — the host working tree having **no**
fold-pipeline YAML, so every published snapshot shipped without a CI trigger — produces no
finding. Neither does a missing host `.squad/` directory or a missing in-repo coordinator agent
(`squad.agent.md`). The operator only discovers the problem by noticing that folds never run.

### 4. `diagnoseCopilotPayload` mis-attributes the orphan callsign and misses double-prefixed payloads

The orphan scanner walks `~/.copilot/skills` and `~/.copilot/agents`, treats any `squad-…` entry
not owned by a known callsign as an orphan, and derives the owning callsign with:

```ts
function _extractCandidateCallsign(name: string): string | null {
  if (!name.startsWith('squad-')) return null;
  const withoutPrefix = name.slice('squad-'.length);
  const lastDash = withoutPrefix.lastIndexOf('-');
  if (lastDash <= 0) return null;
  return withoutPrefix.slice(0, lastDash);
}
```

Splitting on the **last** hyphen assumes the skill name is a single dash-free token, which is
false for every multi-word skill. `squad-probe-agent-collaboration` yields `probe-agent`, so the
finding names the wrong callsign and the suggested `squad assign probe-agent` would not re-bind
the real `probe` squad. Separately, the `owned` check is `entry.name.startsWith("squad-<cs>-")`,
which treats a doubly-prefixed stale directory like `squad-<cs>-squad-conventions` (left by an
older install that namespaced already-namespaced source skills) as **owned** by `<cs>` — so it is
never flagged for cleanup even though it is dead weight.

### 5. `install-fold-pipeline` fail-fast on a missing destination directory

The command refuses to run when the platform directory is absent:

```ts
if (!fs.existsSync(targetDir)) {
  console.error(
    `✗ Target directory does not exist: ${targetDir}\n` +
    `  Bootstrap the shared-squad host clone pipeline directory before running install-fold-pipeline.`,
  );
  process.exit(1);
  return;
}
```

The comment is explicit that this is intentional — *"Do NOT create missing parent directories —
host clone must be bootstrapped first"* — to avoid scaffolding `.azuredevops/` or
`.github/workflows/` in the wrong repository when the host root is wrong. The cost is a manual
`mkdir` on every first-time host install even when the host root resolved correctly from the
registry. Whether to keep the fail-fast, add an explicit opt-in, or auto-create once the host
clone is registry-confirmed is the Tier-2 decision (E).

---

## Proposed change

Sub-proposals A, B, C, D, F, and G are Tier 1 (concrete, implementation-ready). Sub-proposal E is
Tier 2 (a decision with a safety/surprise cost) gated on the maintainer's choice.

**Recommended implementation order:** A (small, self-contained install flag), then B (fold-template
correctness + the install flag that enables it), then C and D (the two `doctor` enhancements,
which share the host/registry resolution already in `runDoctor`), then F (fold-template identity
parameter + docs, which touches the same templates as B), then G (the self-contained `squad assign`
disambiguation fix), then resolve E and implement the chosen behavior.

---

## Tier 1

### A. Wire `install-fold-pipeline --force` to overwrite a differing pipeline file

**Current behavior:** the `force` option is declared on `InstallFoldPipelineOptions` but never
read; a `present+differ` destination hard-exits with a "delete it manually" message.

**Required behavior:** when `--force` is passed and the destination exists with different content,
overwrite it with the freshly-rendered template after preserving the prior content as a sibling
backup (e.g. `<filename>.bak`). Without `--force`, the `present+differ` branch is unchanged
(still exits non-zero with the actionable message). The `present+match` (idempotent no-op) and
`absent` (write) branches are unchanged in both modes. `--force` is surfaced in the command help.

**Hard constraints:**
- `--force` only changes the `present+differ` branch; `absent` and `present+match` behavior is
  identical to today.
- A backup of the replaced file is written before overwrite (no silent loss of a hand-customized
  pipeline).
- Without `--force`, the conflict gate exits non-zero exactly as today.
- The flag is parsed by the CLI entry for `install-fold-pipeline` and shown in its `--help`.

**Test surface:** (a) `present+differ` without `--force` exits non-zero and leaves the file
unchanged (regression guard); (b) `present+differ` with `--force` overwrites the file with the
template and writes a `.bak` of the prior content; (c) `present+match` with `--force` is still a
no-op; (d) `absent` with `--force` writes the template (no spurious backup).

### B. Correct the fold inbox-branch cleanup and make it install-time enableable

**Current behavior:** the cleanup step is gated by `DELETE_FOLDED_REFS` (default `false`, no
install switch) and deletes `$SORTED_REFS` — every discovered inbox ref — rather than only the
successfully-folded refs.

**Required behavior:**
- The delete loop iterates **only the refs that were successfully folded** this run (the refs
  recorded in `$FOLDED_ENTRIES`), never the full discovered set. A ref whose fold commit failed
  and was rolled back is **not** deleted.
- `install-fold-pipeline` gains a `--delete-folded-refs` flag that sets the template's
  `DELETE_FOLDED_REFS` default to `true` at install time (callsign-scoped and generic installs
  alike); without the flag the installed pipeline keeps cleanup **off** (the safe default).
- The correction is applied to **all four** fold-template copies — `squad-cli` and `squad-sdk`,
  `ado` and `github` variants — kept byte-identical per the mirror guardrail.
- Cleanup remains best-effort and non-fatal: a failed delete logs a warning and the run still
  succeeds (the state push has already happened).

**Hard constraints:**
- No inbox ref is deleted unless it appears in the successfully-folded set for this run.
- The state push (`squad/state/<callsign>`) happens before any deletion, and a delete failure
  never fails the fold.
- Default installed behavior is cleanup-off; `--delete-folded-refs` is the only way to ship it on.
- All four fold-template copies remain byte-identical; the canonical source is edited and mirrors
  re-synced (no copy edited in isolation).
- The ADO and GitHub gating expressions are equivalent and both read the folded set.

**Test surface:** template-level assertions that (a) the delete loop is driven by the folded-refs
set, not the discovered-refs set, in both variants; (b) `install-fold-pipeline --delete-folded-refs`
renders a pipeline whose `DELETE_FOLDED_REFS` default is `true`, and the plain install renders
`false`; (c) the four template copies are byte-identical after the change.

### C. `doctor` host-repo diagnostics for a registered product clone

**Current behavior:** `runDoctor` inspects the local `.squad/`, the registry, clone-match and
origin-overlap health, and orphaned payloads, but never inspects the shared-squad host a
registered clone points at.

**Required behavior:** when the current directory resolves to a registered clone whose host
(`path.dirname(entry.path)`, the team-root's repo) is a **different** location than the current
directory, doctor additionally inspects the host working tree and emits `warn`-level findings for:
- a missing host `.squad/` directory;
- a missing **or empty** fold-pipeline YAML on the host (no `.azuredevops/fold-squad-state*.yml`
  and no `.github/workflows/fold-squad-state*.yml`) — the exact gap that silently disables
  folding — with remediation pointing at `install-fold-pipeline`;
- a missing in-repo coordinator agent (`squad.agent.md`) on the host.

Each finding is actionable (names the host path and the command that fixes it). These checks run
only when the host is resolvable and distinct from the current directory; they never fire for a
single-repo / local-only squad (no duplicate of the existing local `.squad/` finding), and they
do not duplicate the existing `.gitattributes` / `.gitignore` upgrade checks.

**Hard constraints:**
- The host inspection runs only when a registry entry matches the current directory as a clone
  **and** the resolved host path differs from the current directory.
- A missing/empty host fold YAML produces a distinct, actionable `warn` finding.
- Severity escalates to `warn` (not `error`) for these host findings; a requested-callsign-missing
  error remains the only `error`-level escalation in its existing path.
- No finding is emitted when the host cannot be resolved (best-effort; never throws).

**Test surface:** a registered product clone whose host has **no** fold YAML yields the
missing-fold-YAML `warn` finding; a host missing `.squad/` yields the missing-host-`.squad`
finding; a host missing `squad.agent.md` yields that finding; a fully-configured host yields none
of the three; a single-repo / local squad yields none of them (regression guard).

### D. Accurate orphan-payload callsign attribution in `doctor`

**Current behavior:** `_extractCandidateCallsign` splits on the last hyphen (mis-naming the
callsign for every multi-word skill), and the `owned` check treats doubly-prefixed
`squad-<cs>-squad-…` directories as owned, so they are never flagged.

**Required behavior:** resolve the owning callsign of a `squad-…` payload **against the set of
known source payload names** rather than a positional hyphen split — i.e. for a payload
`squad-<X>-<rest>`, treat `<X>` as the callsign when `<rest>` is a known source skill/agent base
name (or, failing a catalog, prefer the **longest** known registered callsign that prefixes the
name), so `squad-probe-agent-collaboration` attributes to `probe` and the remedy names the real
callsign. Additionally, recognize doubly-prefixed re-namespaced payloads
(`squad-<knownCallsign>-squad-…`) as **orphans to clean up**, not as owned, so stale
double-prefixed directories are surfaced.

**Hard constraints:**
- For a known multi-word source skill, the attributed callsign is the registry-style callsign,
  not a callsign-plus-skill-fragment (`probe`, never `probe-agent`).
- A doubly-prefixed `squad-<cs>-squad-…` directory is reported as an orphan with an actionable
  remediation, not silently treated as owned.
- A correctly-namespaced, registered payload (`squad-<registeredCallsign>-<skill>`) is **not**
  reported as an orphan (no false positives).
- The remediation message names the corrected callsign.

**Test surface:** `squad-probe-agent-collaboration` (callsign `probe` not registered) is reported
as an orphan attributed to `probe`; a doubly-prefixed `squad-teamx-squad-conventions` is
reported as an orphan (not owned); a correctly-namespaced registered payload is not reported;
the corrected callsign appears in the remediation text.

### F. Compliant, documented state-branch write-back identity for the fold pipeline

**Current behavior:** the ADO fold template checks out `self` with `persistCredentials: true` and
pushes the folded state to `squad/state/<callsign>` using the implicit `System.AccessToken`. That
push succeeds only after the operator manually grants the Project Build Service account
**Contribute** on the state branch — an over-privileged build-service-account grant that the
platform's "Securing Azure DevOps Build Service Accounts" control flags for remediation. The
template offers no alternative and the setup docs document neither the required permission nor the
compliant path.

**Required behavior:** make the fold pipeline's write-back identity explicit and configurable, and
document both the minimum-permission and the compliant least-privilege paths, **without changing
the default behavior** for existing installs:

1. **Template parameterization.** The ADO fold template exposes the write-back identity as a
   templated input (e.g. an optional `serviceConnection` / `azureSubscription` parameter consumed
   by the checkout and push steps). When the operator supplies a service connection (backed by a
   managed identity or service principal — `aka.ms/azdosc`), the fold pushes under that
   per-resource least-privilege identity. When none is supplied, the template renders exactly
   today's `System.AccessToken` path (no behavior change for current installs).
2. **Install wiring.** `install-fold-pipeline` accepts an optional flag (e.g.
   `--fold-service-connection <name>`) that renders the template with the service-connection
   identity wired in; absent the flag, the rendered pipeline is byte-identical to today's output.
3. **Documentation.** The fold-pipeline install / shared-host setup docs state, with a generic
   placeholder (`dev.azure.com/contoso/MyProject`): (a) the minimum write permission the default
   `System.AccessToken` path requires on the state branch, and that granting the shared build
   service account Contribute is flagged by the build-service-account security control as
   over-privileged; and (b) the recommended compliant alternative — an Azure DevOps service
   connection backed by a managed identity / service principal (`aka.ms/azdosc`) scoped to the
   state branch — including how to pass it via the install flag.

**Hard constraints:**
- Default rendering (no service connection supplied) is byte-identical to today's template output;
  existing installs and the four-copy byte-identity invariant (with B) are preserved.
- The service-connection path is opt-in and never silently changes an existing pipeline.
- No internal tenant/organization URL appears in the template or docs; placeholders use
  `dev.azure.com/contoso/MyProject`, and the compliant alternative is referenced via the public
  `aka.ms/azdosc` short link and the control name, not an internal portal URL.
- The GitHub fold template is unaffected by the ADO service-connection mechanism; if a parallel
  GitHub identity note is added it stays documentation-only and preserves byte-identity of the
  rendered default.

**Test surface:** (a) a default install (no `--fold-service-connection`) renders an ADO pipeline
byte-identical to the current template; (b) an install with `--fold-service-connection <name>`
renders a pipeline whose checkout/push run under the named service connection and that contains no
reliance on a manually-granted build-service Contribute; (c) the setup docs contain both the
minimum-permission note and the `aka.ms/azdosc` compliant-alternative guidance with the generic
placeholder; (d) the four fold-template copies remain byte-identical for the default rendering.

### G. De-overload `squad assign` origin-collision disambiguation

**Current behavior:** when the current clone's fetch remotes match the recorded `origins[]` of two
or more *other* registered squads, the warm-path origin-collision guard throws
`ERR_ASSIGN_ORIGIN_AMBIGUITY` and instructs the operator to pass an explicit `--callsign`. The only
value that clears the guard is the callsign already supplied positionally (the guard filter drops
candidates whose callsign differs from `--callsign`, and the target's own entry is already
excluded), so the operator must restate the same callsign — `squad assign teamx --callsign teamx` —
to clear it by side effect. The same `--callsign` flag has an unrelated, legitimate meaning on the
cold-start (URL) path, where it names the callsign to register the cloned squad under. The error
message names neither the colliding squads nor the precise remediation.

**Required behavior:** make the warm-path disambiguation explicit and non-redundant, and make the
error actionable, **without changing the cold-start meaning of `--callsign`**:

1. **No redundant restatement.** When the positional callsign is present (warm path), the
   origin-collision guard treats *that* callsign as the operator's intended target for
   disambiguation — supplying `--callsign <sameValue>` is no longer required to proceed. (The
   positional callsign is the squad being assigned to; a remote that also matches other squads'
   recorded origins should not block assigning to the explicitly-named target.)
2. **Purpose-named override for the genuine multi-match case.** Add a dedicated, self-documenting
   flag (e.g. `--allow-origin-collision`) that records the assignment while acknowledging the shared
   origin, for the case where the operator deliberately wants the current remotes associated with the
   target despite overlapping another squad's origins. `--callsign` retains its cold-start role
   (naming the registration callsign for a URL assign) and is no longer the warm-path disambiguator.
3. **Actionable error.** When the guard still fires (genuinely ambiguous and unresolved), the
   message names the colliding squads, restates the target being assigned to, and gives the exact
   remediation — e.g. *"Your fetch remotes also match squads `alpha`, `beta`. You are assigning to
   `teamx`; re-run with `--allow-origin-collision` to record this assignment, or remove the
   overlapping remote."*

**Hard constraints:**
- The cold-start (URL) semantics of `--callsign` are unchanged; only the warm-path disambiguation
  affordance changes.
- The warm path no longer requires restating the positional callsign via `--callsign` to clear the
  origin-collision guard.
- A genuine, unresolved multi-squad origin collision still fails closed (no silent mis-assignment);
  the new override flag is the explicit opt-in.
- The error message names the colliding squads and the exact remediation flag.

**Test surface:** (a) a warm-path `squad assign teamx` whose remotes also match two other squads'
origins succeeds (assigns to `teamx`) without requiring `--callsign teamx`; (b) the
`ERR_ASSIGN_ORIGIN_AMBIGUITY` path, where it still applies, emits a message naming the colliding
squads, the target, and the `--allow-origin-collision` remediation; (c) `--allow-origin-collision`
records the assignment in the multi-match case; (d) the cold-start (URL) path still accepts
`--callsign` to name the registration callsign, unchanged.

---

## Tier 2 (decision)

### E. `install-fold-pipeline` destination-directory creation

**Decision required:** what `install-fold-pipeline` does when the platform directory
(`.azuredevops` or `.github/workflows`) is absent. Today it fails fast to avoid scaffolding a
pipeline directory in the wrong repository.

**Option E1 — Registry-gated auto-create (recommended).** Create the missing platform directory
**only** when the host root was resolved from a matching registry entry (the
`entry`-resolved path, not the config-fallback or a bare `git rev-parse`), i.e. only once the
target repository is confirmed to be a registered shared-squad host. When the host root came
from the fallback path or is unconfirmed, keep today's fail-fast. This removes the manual `mkdir`
for the normal registered-host install while preserving the guard against scaffolding in an
unintended repo.

**Option E2 — Explicit `--create-dirs` opt-in.** Keep fail-fast by default; create the directory
only when the operator passes `--create-dirs`. Simpler and fully explicit, at the cost of one more
flag on first install.

**Recommendation: E1.** Auto-create only on a registry-confirmed host, fail-fast otherwise — it
fixes the common case without weakening the wrong-repo guard. (E1 and E2 are not mutually
exclusive; `--create-dirs` could be added later as an override for the unconfirmed-host case.)

**Hard constraints (whichever is chosen):**
- The fail-fast guard remains in place for the case the chosen option does not cover (unconfirmed
  host for E1; absence of the flag for E2).
- Directory creation never occurs in a repository that was not resolved as the intended host.
- The decision and rationale are recorded in the Phase-B triage file.

**Test surface:** for E1, a registry-confirmed host with no `.azuredevops/` directory installs
successfully (directory created); an unconfirmed/fallback host with no directory still fails fast.
For E2, install with `--create-dirs` creates the directory; without it, fail-fast is unchanged.

---

## Acceptance

- Build exits 0.
- `install-fold-pipeline --force` overwrites a `present+differ` destination with the rendered
  template and writes a `.bak` of the prior content; without `--force` the conflict gate exits
  non-zero unchanged; `present+match` and `absent` are unchanged in both modes; `--force` appears
  in the command help (A).
- The fold templates' inbox-branch cleanup deletes **only** successfully-folded refs (driven by
  the folded-refs set, never the full discovered set) in both the ADO and GitHub variants; a
  ref whose fold commit failed is never deleted (B).
- `install-fold-pipeline --delete-folded-refs` renders a pipeline whose `DELETE_FOLDED_REFS`
  default is `true`; the plain install renders `false` (cleanup off by default) (B).
- All four fold-template copies (`squad-cli` and `squad-sdk`, `ado` and `github`) are
  byte-identical after the change (B).
- `squad doctor`, run from a registered product clone whose host is elsewhere, emits actionable
  `warn` findings for a missing host `.squad/`, a missing/empty host fold-pipeline YAML, and a
  missing in-repo `squad.agent.md`; a fully-configured host and a single-repo/local squad emit
  none of these (C).
- `doctor`'s orphan-payload findings attribute the correct registry-style callsign for multi-word
  skills (`probe`, not `probe-agent`) and report doubly-prefixed `squad-<cs>-squad-…` directories
  as orphans, while never reporting a correctly-namespaced registered payload (D).
- Sub-proposal E is resolved one way or the other (E1 registry-gated auto-create or E2
  `--create-dirs`), the wrong-repo guard is preserved for the uncovered case, and the choice and
  rationale are recorded in the Phase-B triage. (E)
- Tests cover: A's four force-mode branches; B's folded-set deletion and install-flag rendering
  and template byte-identity; C's host-finding matrix (missing host `.squad/`, missing/empty fold
  YAML, missing agent, configured host, local-only squad); D's callsign attribution and
  double-prefix detection; G's warm-path no-redundant-callsign assign, the actionable
  ambiguity error, and the `--allow-origin-collision` override; and the chosen E behavior. `squad assign <callsign>` whose fetch remotes also match two or more other squads'
  recorded origins assigns to the named callsign **without** requiring a redundant
  `--callsign <sameValue>`; a genuinely unresolved multi-squad origin collision still fails closed
  with an `ERR_ASSIGN_ORIGIN_AMBIGUITY` whose message names the colliding squads, the target, and
  the `--allow-origin-collision` remediation; `--allow-origin-collision` records the assignment in
  that case; the cold-start (URL) meaning of `--callsign` is unchanged (G).
- The ADO fold template renders byte-identical to today's output on a default install; an install
  with `--fold-service-connection <name>` renders a pipeline whose state-branch checkout and push
  run under the named service connection (managed-identity / service-principal backed) with no
  reliance on a manually-granted build-service-account Contribute; the GitHub template default
  rendering is unchanged (F).
- The fold-pipeline setup docs document both the minimum write permission the default
  `System.AccessToken` path needs on the state branch (noting the build-service-account control
  flags a shared-account Contribute grant as over-privileged) and the compliant least-privilege
  alternative via an Azure DevOps service connection (`aka.ms/azdosc`), using the
  `dev.azure.com/contoso/MyProject` placeholder and no internal portal URL (F).
- A `patch` changeset for `@bradygaster/squad-cli` is present (and one for
  `@bradygaster/squad-sdk` if its source is modified for D).
- No specific internal tenant/host URL appears in any documentation; placeholders use
  `dev.azure.com/contoso/MyProject`.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
