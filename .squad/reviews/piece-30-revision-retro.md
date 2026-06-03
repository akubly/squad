# Piece 30 Revision Follow-on Review — RETRO (Security)

**Reviewing:** commit a9da5453 (Booster's revision)
**Date:** 2026-06-02
**Scope:** bootstrap-cross-repo.ps1 only — verify 3 prior fixes + new attack surface

**Verdict on prior M1 (High — PAT leak):** PARTIALLY-RESOLVED
**Verdict on prior M2 (Medium — `--` separator):** RESOLVED
**Verdict on prior M3 (Medium — URL scheme):** RESOLVED

**Overall verdict on revision:** APPROVE-WITH-NITS
**Severity counts (new findings):** Critical: 0 | High: 0 | Medium: 1 | Low: 1
**New mandatory findings:** 1
**New non-blocking findings:** 1

---

## Prior-finding resolution

### M1 — PAT-in-URL leak via Write-Host: PARTIALLY-RESOLVED

**What changed:** Line 120 now uses `$($DocsRepoUrl -replace '://[^@/]+@', '://***@')` before emitting to Write-Host. All other Write-Host calls in the script were audited — none interpolate `$DocsRepoUrl` directly. No `##vso[task.setvariable...]` patterns exist. No `[CmdletBinding()]` decoration means no `-Verbose` mode with `$PSBoundParameters` dump.

**Residual gap (see new mandatory finding M_NEW_1):** Line 101 runs `git clone -- "$DocsRepoUrl" "$TeamRoot"` with no suppression of git's own stderr. When the clone fails — wrong credentials, unreachable host, expired token — git writes directly to stderr: e.g., `fatal: repository 'https://user:PAT@dev.azure.com/org/proj/_git/docs' not found`. With `$ErrorActionPreference = 'Stop'`, that stderr propagates as the terminating error message into pipeline logs. The Write-Host path is fixed; the git subprocess error path is not.

---

### M2 — Missing `--` separator on git clone: RESOLVED

**What changed:** Line 101 now reads `git clone -- "$DocsRepoUrl" "$TeamRoot"`. The `--` is correctly placed, quotes are intact, no string concatenation that could defeat it.

**Other git invocations audited:**
- `git -C "$WorkRoot" remote add "$DocsRemoteName" "$DocsRepoUrl"` (line 121) — no `--`. However, `git remote add` does not support a `--` end-of-options separator before the URL position. The injection risk for a `--`-prefixed URL is mitigated by M3's scheme validation running before this line: any URL not beginning with `https?://`, `git+ssh://`, `ssh://`, or `git@` is rejected before reaching line 121. The injection vector is closed.
- `git config --add` calls (lines 132, 142) use values derived from `$DocsRemoteName` and `$StateBranch`, not `$DocsRepoUrl`. These are unrelated to the `--` finding.

---

### M3 — No URL scheme allowlist: RESOLVED

**What changed:** Lines 72–76 add:
```powershell
if ($DocsRepoUrl -notmatch '^(https?://|git\+ssh://|ssh://|git@)') {
    Write-Error "DocsRepoUrl scheme not allowed. Use HTTPS or SSH. Got scheme: '$($DocsRepoUrl.Split('//')[0])://...'"
    exit 1
}
```

**Validation timing:** The allowlist check runs at lines 72–76, before the first `Write-Host` at line 89 and before any git call. A malicious URL is rejected before being echoed.

**Error message scheme extraction:** `$DocsRepoUrl.Split('//')[0]` — PowerShell passes `'//'` to `[string].Split([char[]])`, which splits on each `/` character. For `file:///etc/shadow` this yields `file:` as `[0]`. For all HTTPS/SSH URLs, `[0]` is always the scheme prefix only — no credential or hostname leaks in the rejection message. ✓

---

## New mandatory findings

### M_NEW_1 — git clone error stderr emits unredacted URL (Medium)

**Where:** bootstrap-cross-repo.ps1 line 101
```powershell
git clone -- "$DocsRepoUrl" "$TeamRoot"
```

**What happens:** When `git clone` fails (expired PAT, wrong credentials, unreachable host), git writes to stderr:
```
fatal: repository 'https://user:PAT@dev.azure.com/org/proj/_git/docs' not found
```
PowerShell's `$ErrorActionPreference = 'Stop'` causes this to surface as a terminating error whose message is captured by the ADO pipeline runner and written to the step log. The M1 fix redacted the Write-Host call but did not suppress git's own error output. A developer who follows common ADO credential-embedding patterns and whose clone fails will still leak their PAT to pipeline logs via this path.

**Severity:** Medium. Unlike the original always-log (which was High), this only fires on clone failure — conditional. The param-block comment now warns against embedding credentials. Risk is real but reduced.

**Suggested fix:**
```powershell
$cloneOutput = git clone -- "$DocsRepoUrl" "$TeamRoot" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error '[1/5] Clone failed. Verify DocsRepoUrl is reachable and credentials are valid. (URL not echoed — may contain credentials.)'
    exit 1
}
Write-Host '      Clone complete.'
```
Redirect stderr with `2>&1`, check `$LASTEXITCODE`, emit a sanitized error without the URL.

---

## New non-blocking findings

### N_NEW_1 — `$DocsRemoteName` and `$StateBranch` are unvalidated (Low)

**Where:** Parameter block; used at lines 124–143 in git config key names and refspecs.

`$DocsRemoteName` and `$StateBranch` are user-supplied strings used verbatim to construct:
- `remote.${DocsRemoteName}.fetch` (git config key)
- `+refs/heads/${StateBranch}:refs/remotes/${DocsRemoteName}/...` (refspec value)

A value containing newlines or special characters (e.g., `$DocsRemoteName = "squad-docs`\n[credential]\nhelper=evil"`) could corrupt `.git/config`. Exploitability is limited to operators who control pipeline parameters — the same trust level that can edit the pipeline YAML. Not a meaningful escalation vector, but the team convention (piece 27) is to validate all user-controlled identifiers with a charset allowlist before use.

**Suggested fix:** Add the same regex pattern used for `$DeveloperAlias` but adapted for remote names (git remote names permit letters, digits, hyphens, dots, underscores, slashes):
```powershell
if ($DocsRemoteName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$') {
    Write-Error "DocsRemoteName contains disallowed characters: '$DocsRemoteName'"
    exit 1
}
if ($StateBranch -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$') {
    Write-Error "StateBranch contains disallowed characters: '$StateBranch'"
    exit 1
}
```

---

## Hostile-input probes (verification)

| Input | Validation result | Write-Host / error output | Verdict |
|---|---|---|---|
| `https://user:PAT@host.com/repo.git` | PASSES allowlist | Redacted: `https://***@host.com/repo.git` | ✅ SAFE (log path). ⚠️ git clone error path not covered |
| `https://PAT@host.com/repo.git` | PASSES allowlist | Redacted: `https://***@host.com/repo.git` | ✅ SAFE (log path). ⚠️ git clone error path not covered |
| `git+ssh://user@host.com/repo.git` | PASSES allowlist | Redacted: `git+ssh://***@host.com/repo.git` (over-redacts SSH user) | ✅ SAFE. Minor: SSH username is not a credential; nit only |
| `https://user%40org:PAT@host.com/repo.git` | PASSES allowlist | `%40` is not literal `@`; `[^@/]+` matches `user%40org:PAT`; correctly redacted | ✅ SAFE |
| `file:///etc/shadow` | REJECTED at line 72 | Error: scheme `file:` logged only | ✅ SAFE-FAIL |
| `ftp://attacker.com/.git` | REJECTED at line 72 | Error: scheme `ftp:` logged only | ✅ SAFE-FAIL |
| `https:` (no `//host`) | REJECTED — no `://` substring; does not match `^https?://` | Error message | ✅ SAFE-FAIL |
| `HTTPS://valid.com/repo.git` | PASSES — PowerShell `-match` is case-insensitive | No credential in URL, shown as-is | ✅ SAFE. Uppercase scheme canonically valid |
| `https://valid.com/repo.git#javascript:alert(1)` | PASSES allowlist | Fragment passed to git; git transport ignores fragments | ✅ LOW RISK. Not dangerous in git clone context |
| `https://valid.com/repo.git?ref=../etc/passwd` | PASSES allowlist | Query string sent to server; server-side only | ✅ LOW RISK. No local traversal |
| URL beginning with `--` (e.g., `--upload-pack=evil`) | REJECTED at line 72 | Doesn't start with any allowed scheme prefix | ✅ SAFE-FAIL |

---

## Regex coverage analysis

Redaction regex: `://[^@/]+@`

| Test case | Match? | Redacted output | Verdict |
|---|---|---|---|
| `https://user:PAT@host.com/repo.git` | ✅ `://user:PAT@` | `https://***@host.com/repo.git` | CORRECT |
| `https://PAT@host.com/repo.git` | ✅ `://PAT@` | `https://***@host.com/repo.git` | CORRECT |
| `git+ssh://user@host.com/repo.git` | ✅ `://user@` | `git+ssh://***@host.com/repo.git` | OVER-REDACTS SSH user (not a credential) — low risk nit |
| `https://user%40org:PAT@host.com/repo.git` | ✅ `://user%40org:PAT@` — `%40` is not a literal `@`, so `[^@/]+` matches the encoded segment | `https://***@host.com/repo.git` | CORRECT |
| `https://host.com/no-credentials/repo.git` | ❌ no `@` in URL | Shown as-is (no credential to redact) | CORRECT |
| `HTTPS://user:PAT@host.com/repo.git` | ✅ `-replace` is case-insensitive in PowerShell | `HTTPS://***@host.com/repo.git` | CORRECT |

The `[^@/]+` character class correctly stops at both `@` and `/`. This prevents over-matching into the host segment in URLs with paths that contain `@`-like patterns elsewhere. The regex does not handle multiple credentials segments (multiple `@`) but this is not a real-world URL form and the leftmost `://[^@/]+@` match handles all standard forms.

---

## New attack surface

The revision adds three narrowly-scoped constructs. No expansion of privilege footprint.

| Change | Assessment |
|---|---|
| URL allowlist block (lines 72–76) | Pure input validation. No external calls, no file writes. ✅ |
| `://[^@/]+@` redaction in Write-Host (line 120) | String replace inline. No external calls. ✅ |
| `--` separator added to git clone (line 101) | Argument hardening. No new external commands. ✅ |
| No new `Invoke-WebRequest`, `Invoke-Expression`, `Start-Process` | Confirmed by full git-invocation audit. ✅ |
| No new file writes | Only existing `.git/info/exclude` and `.squad/config.json` paths unchanged. ✅ |
| No new environment variable reads | None introduced. ✅ |
