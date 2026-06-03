# Piece 30 Adversarial Review — Booster (CI/CD)

**Verdict:** REJECT
**Mandatory findings:** 2
**Non-blocking findings:** 5

## Summary

The three pipeline templates are structurally sound — correct trigger shapes, no PR triggers, sole-writer comment present, mirrors byte-identical. However, two mandatory gaps exist that would cause operational failures in any real multi-developer deployment: the fold pipeline has no concurrency serialization control, and the publish pipeline's checkout omits `persistCredentials: true`, which would break `squad sync --push` in standard ADO configurations. Both are fix-forward candidates; nothing is architecturally wrong.

## Mandatory (M1, M2)

### M1 — `fold-squad-state.yml`: No concurrency serialization control

**Where:** `.squad-templates/ado/fold-squad-state.yml` — `trigger:` block (lines 15–18), no pipeline-level `batch:` or queue limit.

**Why blocks:** The sole-writer invariant is preserved by ADO pipeline identity (only one pipeline has permission to write squad-state), but it does NOT prevent two fold pipeline *instances* from running concurrently. If two developers push to their inbox branches within seconds of each other, ADO queues two fold runs. Both execute `squad fold`, compute a new HEAD, and race to `git push origin HEAD:squad-state`. The loser sees a non-fast-forward rejection and the pipeline run fails. No data corruption — but reliability breaks, and the affected developer gets no automated re-try. With any team larger than two, this race is routine.

**Evidence:** YAML parse confirms no `batch:`, no `concurrency`, no `lockBehavior` at the top level or in the trigger block. ADO's own concurrency-limit setting is UI-only; YAML pipelines must use `batch: true` to serialize.

**Suggested fix:**
```yaml
trigger:
  batch: true          # serialize fold runs — at most one active, then one queued
  branches:
    include:
      - squad/inbox/**
```
`batch: true` in ADO: when a run is active, subsequent trigger events are coalesced and enqueue at most one pending run. On completion the pending run picks up all batched inbox refs. This is the correct ADO serialization primitive for this pattern. Alternatively, add a pull-fetch-rebase-retry loop around the `git push` step (3 attempts) as belt-and-suspenders behind `batch: true`.

---

### M2 — `publish-inbox.yml`: `persistCredentials: true` absent from checkout

**Where:** `.squad-templates/ado/publish-inbox.yml`, `checkout: self` block (line 31).

```yaml
- checkout: self
  fetchDepth: 0
  displayName: 'Checkout product repo'
```

**Why blocks:** Azure Pipelines' default for `checkout` is `persistCredentials: false`. When false, the OAuth token is injected as an HTTP extraheader for the duration of the checkout call, then stripped. Subsequent script steps — specifically `squad sync --push`, which must push to the `squad/inbox/<alias>/...` branch — cannot authenticate git operations. The result is a 401/403 or an interactive credentials prompt that hangs and times out in a non-interactive runner.

**Contrast:** `fold-squad-state.yml` correctly sets `persistCredentials: true` for the same reason (it needs `git push origin HEAD:squad-state` to authenticate). The publish pipeline must follow the same pattern.

**Evidence:** YAML parse of publish-inbox.yml confirms `fetchDepth: 0` present, `persistCredentials` key absent. Fold's checkout has both. The inconsistency is unambiguous.

**Suggested fix:**
```yaml
- checkout: self
  fetchDepth: 0
  persistCredentials: true
  displayName: 'Checkout product repo'
```

---

## Non-blocking (N1–N5)

### N1 — `fold-squad-state.yml`: `git push` lacks `--ff-only`

**Where:** `.squad-templates/ado/fold-squad-state.yml`, "Fast-forward squad-state" step.

The push reads `git push origin HEAD:squad-state` with no `--ff-only` flag. While `git push` without `--force` already refuses non-fast-forward pushes by default, the `--ff-only` flag makes the intent explicit and ensures no future configuration change (e.g., an accidental `-f` added by a well-meaning editor) can silently rewrite squad-state history. The comment says "Fast-forward squad-state" — the flag should match the prose.

**Non-blocking because:** The default git push behavior already provides the safety; `--ff-only` is defense-in-depth.

---

### N2 — `fold-squad-state.yml`: No retry on `git push origin HEAD:squad-state`

**Where:** `.squad-templates/ado/fold-squad-state.yml`, "Fast-forward squad-state" step.

A transient ADO service interruption or network blip during the push step fails the entire pipeline run. There is no retry loop. Per Booster charter, external-service calls (git over HTTPS to ADO) must have retry logic. A 3-attempt loop with `sleep 5` between attempts is standard and sufficient.

**Non-blocking because:** ADO pipelines can be manually re-triggered; this is a resilience gap, not a data-safety gap.

---

### N3 — `bootstrap-cross-repo.ps1`: No PATH guard for `squad` command

**Where:** `.squad-templates/ado/bootstrap-cross-repo.ps1`, steps 2 and 5 (`squad bind`, `squad sync --pull`).

The script calls `squad bind` and `squad sync --pull` without first verifying `squad` is on PATH. When run standalone (not via the pipeline's preceding `npm install --global` step), the script fails with a cryptic "command not found" rather than a clear remediation message. A `Get-Command squad -ErrorAction SilentlyContinue` guard with a `Write-Error` and `exit 1` before any `squad` invocation would give operators an actionable error.

**Non-blocking because:** In the pipeline context, the preceding `npm install --global @bradygaster/squad-cli` step ensures `squad` is available. The gap is standalone-invocation UX.

---

### N4 — `fold-squad-state.yml`: Trigger has no `exclude:` list

**Where:** `.squad-templates/ado/fold-squad-state.yml`, `trigger.branches`.

`publish-inbox.yml` explicitly excludes `squad-state`, `main`, and `dev` from its trigger. `fold-squad-state.yml` does not. The wildcarded `squad/inbox/**` pattern would never match those branch names regardless, making the omission harmless today. But the defensive pattern in publish-inbox should be mirrored for consistency and for teams that might clone the template without fully understanding the scope of `**`.

**Non-blocking because:** The exclusion is structurally unreachable given the `squad/inbox/**` prefix.

---

### N5 — Test: sole-writer comment assertion does not enforce line position

**Where:** `test/cli/ado-templates.test.ts` — `fold-squad-state.yml` sole-writer assertion.

```ts
expect(raw).toContain('SOLE WRITER INVARIANT');
```

This assertion passes regardless of where in the file the comment appears. The spec stipulates lines 4–9 (near the top, before any reader starts editing). If the comment migrates to line 80 during future editing, the machine check still passes but the human-communication purpose is defeated. A stronger assertion would verify the comment appears within the first N bytes or within the first `trigger:` block, e.g.:

```ts
const firstBlock = raw.split('\n').slice(0, 15).join('\n');
expect(firstBlock).toContain('SOLE WRITER INVARIANT');
```

**Non-blocking because:** The comment is in the correct location at time of commit; this is a future-proofing gap in the test.

---

## Adversarial probes run

1. **YAML-parse of publish-inbox.yml via `yaml` package (node)** — Parsed cleanly. Top-level keys confirmed: `trigger`, `pool`, `variables`, `steps`. No `pr` key. Trigger branch include confirmed as `squad/inbox/**` with explicit excludes for `squad-state`, `main`, `dev`.

2. **YAML-parse of fold-squad-state.yml via `yaml` package (node)** — Parsed cleanly. Top-level keys confirmed: `trigger`, `pool`, `variables`, `steps`. No `pr` key. No `schedules` key. No `parameters` key. No `concurrency` or `batch` at top level. Trigger confirmed as `branches: include: [squad/inbox/**]` — no excludes.

3. **squad-state write scan across all 3 templates** — `publish-inbox.yml` and `bootstrap-cross-repo.ps1` searched for `squad-state` writes. Only reference in publish-inbox is in a comment ("this pipeline never writes to squad-state") and in the exclude list. No write operations to squad-state outside `fold-squad-state.yml`. Invariant holds.

4. **Concurrency control scan (both pipelines)** — Searched for `lockBehavior`, `concurrency`, `queue`, `batch` in both YAML files. Zero matches. Confirmed: no serialization control in either pipeline.

5. **persistCredentials scan (publish-inbox.yml)** — Searched for `persistCredentials`, `SYSTEM_ACCESSTOKEN`, `clean:`. `persistCredentials` absent from checkout. Fold has both `persistCredentials: true` and `SYSTEM_ACCESSTOKEN` on the push step. Mismatch confirmed.

6. **Retry/resilience scan** — Searched both YAML files for `retry`, `retryCount`, `continueOnError`, `timeoutInMinutes`. Zero matches for retry patterns. Gap confirmed.

7. **bootstrap-cross-repo.ps1 — fail-fast guard order** — Guards for `$DeveloperAlias` (line 47) and `$DocsRepoUrl` (line 52) both appear before Step 1 (clone at line 70). Format validation for alias (regex match) also present before any write. Order is correct.

8. **bootstrap-cross-repo.ps1 — idempotency guards** — Confirmed: `Test-Path $TeamRoot` (clone guard), `Test-Path $SquadConfig` (bind guard), `$existingRemotes -contains $DocsRemoteName` (remote guard), `$existingRefspecs -contains $StateRefspec` and `$existingRefspecs2 -contains $InboxRefspec` (refspec guards), regex match against existing exclude content (exclude guard). All 5 idempotency gates present.

9. **bootstrap-cross-repo.ps1 — exit codes** — `$ErrorActionPreference = 'Stop'` at top. Explicit `exit 1` after each `Write-Error`. Non-zero exit on failure confirmed.

10. **sync-templates.mjs recursive walk** — `collectFiles()` recursively descends into subdirectories. The `ado/` subdirectory is picked up automatically without script changes. Confirmed by source review.

11. **`ff-only` scan in fold** — `git push origin HEAD:squad-state` has no `--ff-only` flag. The "Fast-forward" comment in the step displayName is not enforced programmatically.

12. **Mirror file count** — Canonical: 3 files (`bootstrap-cross-repo.ps1`, `publish-inbox.yml`, `fold-squad-state.yml`). Mirrors: 3 × 3 = 9 files. Total: 12 ADO template files in commit. All 4 locations populated.

13. **No-PR-trigger assertion coverage** — Test uses `parseYaml(raw)` then checks `not.toHaveProperty('pr')`. This correctly catches: `pr: { branches: [...] }`, `pr: none`, `pr: false`, `pr: ~`. A commented-out `# pr:` line would be stripped by YAML parser before the check. Coverage is complete for all ADO pr-trigger forms.

---

## Mirror-byte-identity check

Verification method: git blob SHA comparison (`git rev-parse <commit>:<path>` for each file/location pair).

| Canonical | Mirror | Blob SHA | Result |
|---|---|---|---|
| `.squad-templates/ado/bootstrap-cross-repo.ps1` | `templates/ado/bootstrap-cross-repo.ps1` | `12887e92` | ✅ MATCH |
| `.squad-templates/ado/bootstrap-cross-repo.ps1` | `packages/squad-cli/templates/ado/bootstrap-cross-repo.ps1` | `12887e92` | ✅ MATCH |
| `.squad-templates/ado/bootstrap-cross-repo.ps1` | `packages/squad-sdk/templates/ado/bootstrap-cross-repo.ps1` | `12887e92` | ✅ MATCH |
| `.squad-templates/ado/publish-inbox.yml` | `templates/ado/publish-inbox.yml` | `bcfc1d4a` | ✅ MATCH |
| `.squad-templates/ado/publish-inbox.yml` | `packages/squad-cli/templates/ado/publish-inbox.yml` | `bcfc1d4a` | ✅ MATCH |
| `.squad-templates/ado/publish-inbox.yml` | `packages/squad-sdk/templates/ado/publish-inbox.yml` | `bcfc1d4a` | ✅ MATCH |
| `.squad-templates/ado/fold-squad-state.yml` | `templates/ado/fold-squad-state.yml` | `fa99e002` | ✅ MATCH |
| `.squad-templates/ado/fold-squad-state.yml` | `packages/squad-cli/templates/ado/fold-squad-state.yml` | `fa99e002` | ✅ MATCH |
| `.squad-templates/ado/fold-squad-state.yml` | `packages/squad-sdk/templates/ado/fold-squad-state.yml` | `fa99e002` | ✅ MATCH |

All 9 mirror files are byte-identical (same git blob object) to their canonical counterparts.
