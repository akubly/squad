# Piece 30 Adversarial Review — Consolidated Verdict

**Date:** 2026-06-02
**Branch:** squad/piece-30-ado-cross-repo-templates
**Commit under review:** 10168051
**Implementer:** Flight (excluded from review panel)
**Reviewers (5, parallel):** CAPCOM, Booster, FIDO, RETRO, PAO

---

## Reviewer verdicts

| Reviewer | Angle | Verdict | Mandatory | Non-blocking |
|----------|-------|---------|-----------|--------------|
| CAPCOM   | Architecture/Contract | REJECT | 2 | 3 |
| Booster  | CI/CD | REJECT | 2 | 5 |
| FIDO     | Quality/Tests | APPROVE-WITH-NITS | 1 | 4 |
| RETRO    | Security | APPROVE-WITH-NITS | 3 (1 High + 2 Medium) | 4 (Low) |
| PAO      | Docs/DevRel | APPROVE-WITH-NITS | 1 | 8 |

---

## Consolidated verdict

**REJECT**

Two independent REJECTs (CAPCOM, Booster) cannot be overridden by the three APPROVE-WITH-NITS verdicts without explicit user override. Total mandatory findings: **9 across 5 reviewers**. No angle found the piece ready to merge.

---

## Convergent mandatory themes (deduped across reviewers)

---

### 1. Missing `squad fold` command — VERIFIED RUNTIME DEFECT

**Reviewers raising it:** CAPCOM M1 (primary)

**What:** `fold-squad-state.yml` lines 60–63 call `squad fold --state-branch squad-state --history-file .squad/publish-history.json --order published-at,developer-alias`. No `fold` command is registered in `packages/squad-cli/src/cli-entry.ts`. The registered command set includes `sync`, `bind`, `status`, `cast`, `upstream`, and others — no `fold`. The SDK's `resolution.ts` and `sync.ts` reference "the Piece 30 fold pipeline" in comments as a future consumer, but no command was wired up. The pipeline fails at step 4 with "Unknown command: fold" on every execution.

**VERIFIED EXTERNAL FACT:** Squad confirmed `squad fold` appears only in the new templates, with no corresponding handler in `packages/squad-cli/src/`. This is ground truth, not a disputed claim.

**Where:** `fold-squad-state.yml` lines 60–63; `packages/squad-cli/src/cli-entry.ts` (absence of `fold` entry)

**Severity:** block

**Suggested fix (from CAPCOM):** Either (a) ship a `squad fold` command that wraps the already-exported `publishTeamRootToInbox`/`hydrateTeamRootFromStateRef` internals and register it in `cli-entry.ts`; or (b) replace the `squad fold` call with `squad sync --pull` + inline git operations that achieve equivalent fold behavior without a new command. Option (a) is architecturally cleaner and matches the spec contract.

**Scope question for user — see below.**

---

### 2. `publish-inbox.yml` CI trigger is unreachable in the product repo

**Reviewers raising it:** CAPCOM M2 (primary)

**What:** `publish-inbox.yml` is spec'd for the product repo (WORK_ROOT). Its CI trigger is `include: squad/inbox/**`. In the cross-repo architecture from pieces 26–29, inbox branches (`squad/inbox/<alias>/<session>`) are created in TEAM_ROOT (the docs/specs repo) by `squad sync --push`. The product repo (WORK_ROOT) never receives pushes to `squad/inbox/**`; those refs go to the state remote. ADO evaluates CI triggers against pushes to the repo where the pipeline YAML lives. The trigger condition is permanently unsatisfiable — the publish pipeline can never auto-trigger. Additionally, the test at `test/cli/ado-templates.test.ts` lines 51–57 asserts the wrong trigger pattern and must be corrected alongside the fix.

**Secondary:** The spec's intent is "trigger on all feature-branch pushes to the product repo except squad-state, main, and dev." The narrow `include: squad/inbox/**` contradicts that intent even if the branches existed.

**Where:** `publish-inbox.yml` lines 12–19; `test/cli/ado-templates.test.ts` lines 51–57

**Severity:** block

**Suggested fix (from CAPCOM):** Remove the `include:` clause entirely; keep only the `exclude:` list (`squad-state`, `main`, `dev`). Update the test to check that no narrow include pattern is present, and that the excluded branches are listed.

---

### 3. Fold concurrency not serialized (`batch: true` absent)

**Reviewers raising it:** Booster M1

**What:** `fold-squad-state.yml` has no `batch:`, no `concurrency`, and no `lockBehavior` at the top level or in the trigger block. When two developers push to their inbox branches within seconds of each other, ADO queues two fold runs that execute concurrently. Both compute a new HEAD and race to `git push origin HEAD:squad-state`. The loser receives a non-fast-forward rejection and the pipeline run fails. No data corruption, but reliability breaks in any real multi-developer scenario. `batch: true` is the correct ADO serialization primitive for this pattern.

**Where:** `.squad-templates/ado/fold-squad-state.yml` — `trigger:` block (lines 15–18); absence of `batch:`

**Severity:** block

**Suggested fix (from Booster):**
```yaml
trigger:
  batch: true          # serialize fold runs — at most one active, then one queued
  branches:
    include:
      - squad/inbox/**
```
Optionally add a pull-fetch-rebase-retry loop around the `git push` step (3 attempts) as belt-and-suspenders.

---

### 4. `publish-inbox.yml` missing `persistCredentials: true`

**Reviewers raising it:** Booster M2

**What:** Azure Pipelines' default for `checkout` is `persistCredentials: false`. When false, the OAuth token is stripped after checkout. The subsequent `squad sync --push` step — which must push to the `squad/inbox/<alias>/...` branch — cannot authenticate git operations. The result is a 401/403 or an interactive credentials prompt that hangs in a non-interactive runner. `fold-squad-state.yml` correctly sets `persistCredentials: true` for exactly this reason. The inconsistency is unambiguous: both YAML files were parsed and compared.

**Where:** `.squad-templates/ado/publish-inbox.yml` — `checkout: self` block (line 31)

**Severity:** block

**Suggested fix (from Booster):**
```yaml
- checkout: self
  fetchDepth: 0
  persistCredentials: true
  displayName: 'Checkout product repo'
```

---

### 5. Bootstrap leaks PAT-in-URL via Write-Host

**Reviewers raising it:** RETRO M1 (High); PAO N7 echoes the docs-side gap

**What:** `bootstrap-cross-repo.ps1` line 108 echoes `$DocsRepoUrl` verbatim:
```powershell
Write-Host "[3/5] Adding remote '$DocsRemoteName' → $DocsRepoUrl ..."
```
`publish-inbox.yml` also passes `$(docsRepoUrl)` as a command-line argument to `pwsh -File bootstrap.ps1`; ADO logs command arguments. If `docsRepoUrl` contains an embedded PAT (`https://user:PAT@dev.azure.com/…`) — a documented enterprise ADO pattern — the token appears in: (1) the ADO step's command-line log, and (2) the `Write-Host` output at step 3. No doc warns against PAT-in-URL. The docs-side gap (PAO N7) compounds this: none of the three new docs pages carry a credential-embedding warning.

**Where:** `bootstrap-cross-repo.ps1` line 108; `publish-inbox.yml` bootstrap invocation step

**Severity:** high

**Suggested fix (from RETRO):** Remove `$DocsRepoUrl` from all `Write-Host` messages. Log only the remote name and resolved `$TeamRoot` path. Add param-block comment: `# IMPORTANT: Never embed credentials in DocsRepoUrl. Use SSH keys or ADO service connections.` Add credential-warning callout to all three docs pages.

---

### 6. Bootstrap missing `--` separator on `git clone`

**Reviewers raising it:** RETRO M2 (Medium)

**What:** `bootstrap-cross-repo.ps1` line 89:
```powershell
git clone "$DocsRepoUrl" "$TeamRoot"
```
The team established the `--` separator convention in piece 14. `$DocsRepoUrl` is not format-validated (see theme 7). A URL beginning with `--` (e.g., `--upload-pack=evil-script`) is parsed by git as an option flag, not a URL — a social-engineering vector on a workstation and a privilege-escalation vector in a pipeline where `$(docsRepoUrl)` comes from a shared variable library.

**Where:** `bootstrap-cross-repo.ps1` line 89

**Severity:** medium

**Suggested fix (from RETRO):**
```powershell
git clone -- "$DocsRepoUrl" "$TeamRoot"
```
Apply to all `git clone` calls in the script. This is the established team convention.

---

### 7. Bootstrap accepts unsafe URL schemes (no scheme allowlist)

**Reviewers raising it:** RETRO M3 (Medium); FIDO N4 echoes (rated non-blocking by FIDO — see Contradictions section)

**What:** The guard on `$DocsRepoUrl` is `[string]::IsNullOrWhiteSpace` only. A `file:///etc/shadow` URL, `javascript:` scheme, or `https://attacker.com/.git` all pass the guard and reach `git clone`. The RETRO hostile-input probe confirms: `$DocsRepoUrl = "https://attacker.com/.git"` — git clone proceeds against an attacker-controlled server that can serve malicious git objects or hooks. The `file://` case also causes the URL to be echoed to logs (M1 compound). RETRO rates this mandatory because the script is documented as a developer workstation tool (higher exploitability surface than pipeline-only).

**Where:** `bootstrap-cross-repo.ps1` — no URL validation block beyond null/whitespace check

**Severity:** medium

**Suggested fix (from RETRO):**
```powershell
if ($DocsRepoUrl -notmatch '^(https?://|git\+ssh://|ssh://|git@)') {
    Write-Error "DocsRepoUrl scheme not allowed. Use HTTPS or SSH. Got: '$($DocsRepoUrl.Split('//')[0])://...'"
    exit 1
}
```
Do NOT include the full URL in the error message (respects M1 fix). Reject `file://` explicitly.

---

### 8. No execution-based idempotency test for `bootstrap-cross-repo.ps1`

**Reviewers raising it:** FIDO M1

**What:** The spec mandates idempotent behavior as a first-class correctness requirement ("The script must tolerate being run against an already-bootstrapped WORK_ROOT without overwriting existing config or duplicating exclude entries"). The two bootstrap tests in `test/cli/ado-templates.test.ts` are regex scans of the raw `.ps1` source text. They verify that the guard pattern exists in the file but never execute the script. Source-reading tests can miss: (a) bugs in the exclude-file regex (`[regex]::Escape($entry)` with `\r\n` EOL handling); (b) edge cases in the refspec idempotency logic (`$existingRefspecs -contains $StateRefspec` as exact string match, subject to git normalization variance).

**Where:** `test/cli/ado-templates.test.ts` (entire bootstrap test section)

**Severity:** block

**Suggested fix (from FIDO):** Add a Vitest test using `execSync`/`spawnSync` in a temp sandbox git repo (following the `withSyncSandbox` pattern already in `template-sync.test.ts`). Run the script twice (or simulate two runs by pre-seeding expected outputs), then assert `git remote -v` contains exactly one `squad-docs` entry and `.git/info/exclude` contains each exclusion pattern exactly once.

---

### 9. Docs-test sync violation: `state-backends` missing from EXPECTED_FEATURES

**Reviewers raising it:** PAO M1

**What:** A new docs page was added at `docs/src/content/docs/features/state-backends.md`. `test/docs-build.test.ts` lines 52–89 define the `EXPECTED_FEATURES` array, which currently lists 38 features. `state-backends` is not in the array. Per PAO charter (and PAO history, 2026-05-14): "when adding new docs pages, update `test/docs-build.test.ts` in the SAME commit." If `state-backends.md` is deleted in a future commit, the test will not catch the deletion.

**Where:** `docs/src/content/docs/features/state-backends.md` (new); `test/docs-build.test.ts` lines 52–89

**Severity:** block

**Suggested fix (from PAO):**
```typescript
const EXPECTED_FEATURES = [
  // ...
  'squad-rc',
  'state-backends',  // ← ADD THIS LINE
  'storage-provider',
  // ...
];
```

---

## Contradictions / disagreements

**FIDO N4 vs. RETRO M3 — `$DocsRepoUrl` URL scheme validation:**
FIDO rates the missing URL-scheme validation as non-blocking (N4): "In the intended pipeline use case, `$(docsRepoUrl)` is set by a pipeline admin. An empty or whitespace value is the primary accidental error; the guard handles it. No injection vector exists because PowerShell parameter binding does not invoke a shell." RETRO escalates the same gap to mandatory (M3): the `https://attacker.com/.git` blind-clone probe does NOT safe-fail, and the script is documented as a developer workstation tool (higher surface). RETRO's escalation holds in this consolidation — the workstation context expands the threat model beyond the pipeline-admin assumption that FIDO's analysis rests on.

No other material contradictions. The five review angles are largely orthogonal; where they overlap (e.g., docs credential warning — RETRO M1 docs gap + PAO N7) they converge, not conflict.

---

## Locked-out authors

- **Flight** — author of commit 10168051 — locked out of the revision under strict reviewer rejection lockout. Flight may not author, co-author, review, or approve the revision branch until user adjudication lifts the lockout explicitly.

---

## Candidate revision authors (excluding Flight)

| Author | Role | Well-suited for |
|--------|------|-----------------|
| **EECOM** | Core Dev | PowerShell hardening fixes, `sync-templates.mjs` corrections, any mirror-sync changes |
| **Booster** | CI/CD | YAML pipeline fixes — theme 3 (`batch: true`), theme 4 (`persistCredentials: true`), theme 2 (trigger fix) |
| **RETRO** | Security | Bootstrap hardening trio — themes 5, 6, 7 (Write-Host PAT leak, `--` separator, scheme allowlist) |
| **PAO** | DevRel | Docs-test sync fix (theme 9), terminology corrections (N1 `old-squad-state.yml`), typos (N2, N3), credential warning callouts |
| **FIDO** | Quality | Idempotency execution test (theme 8), trigger structural-fidelity tests (FIDO N2) |
| **CONTROL** | TypeScript | If `squad fold` CLI command must be implemented (theme 1, option a) — see scope question |
| **Procedures** | Prompt Engineer | If any prompt or template wording needs surgical revision |

---

## ⚠️ Scope question for user

**Does fixing CAPCOM M1 (the missing `squad fold` CLI command) belong in piece 30, or in a separate piece that piece 30 depends on?**

- If in piece 30: the piece expands substantially — it now requires implementing a new CLI command (wiring up `publishTeamRootToInbox`/`hydrateTeamRootFromStateRef` in `cli-entry.ts`) in addition to the template/pipeline/bootstrap/docs fixes. CONTROL would need to author the command; the branch scope is significantly wider.
- If in a separate piece: piece 30 is revised to remove the `squad fold` call and replace it with an approach using only existing CLI surfaces (option b from CAPCOM). The new piece is a hard dependency of piece 30 before merge.

**This is a decision for Brady (akubly). Flight is the implementer and is excluded from pre-answering it.**

---

## Reviewer non-blocking findings

Brief roll-up — detail lives in the individual review files at `.squad/reviews/piece-30-{name}.md`.

| Reviewer | Non-blocking summary |
|----------|---------------------|
| **CAPCOM (3)** | N1: Required ADO pipeline variables undeclared in publish-inbox.yml. N2: `fold-squad-state.yml` hardcodes `squad-state` branch name (inconsistent with bootstrap's `$StateBranch` param). N3: Bootstrap ignores `SQUAD_TEAM_ROOT` env var when computing sidecar path. |
| **Booster (5)** | N1: `git push` in fold lacks `--ff-only`. N2: No retry loop on fold's `git push`. N3: No PATH guard for `squad` command in bootstrap. N4: Fold trigger missing `exclude:` list (harmless given `squad/inbox/**` prefix). N5: Sole-writer comment assertion does not enforce line position in test. |
| **FIDO (4)** | N1: Guard-ordering assertion is text-presence-only (position not verified). N2: Trigger structural fidelity gap — `include:` key-name mutations pass the test. N3: No assertion that `publish-inbox.yml` steps don't write to `squad-state`. N4: `$DocsRepoUrl` URL format unvalidated (compare: escalated to RETRO M3). |
| **RETRO (4)** | N1 (Medium): Sole-writer invariant is docs-only — no CI preflight validates branch policy. N2 (Low): Misleading `persistCredentials` scope comment in fold template. N3 (Low): Unconditional `cat publish-history.json` in fold report step. N4 (Low): `.git/info/exclude` masking `.squad/` warrants inline documentation note. |
| **PAO (8)** | N1: Terminology drift — `old-squad-state.yml` vs. `fold-squad-state.yml` (4 instances). N2: Typos — `ootstrap-cross-repo.ps1`, `ootstrapScriptPath`. N3: Code block language `ash` → `bash`. N4: Missing `$DocsRepoUrl` format guidance. N5: Missing guidance for missing Squad CLI. N6: Single-repo case unaddressed. N7: No credential-warning callout in docs. N8: Cross-reference links lack section anchors. |

---

## Archival notes

- 5 reviewer verdict files: `.squad/reviews/piece-30-{capcom,booster,fido,retro,pao}.md`
- 5 inbox drops: `.squad/decisions/inbox/{capcom,booster,fido,retro,pao}-piece-30-review.md` (Scribe will merge into decisions.md)
- This consolidated verdict: `.squad/reviews/piece-30-consolidated.md`
- Consolidated verdict inbox drop: `.squad/decisions/inbox/flight-piece-30-consolidated-verdict.md`
- Revision cannot begin until user adjudicates the scope question (piece 30 vs. separate piece for `squad fold`).
