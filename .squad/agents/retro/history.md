# RETRO

> Retrofire Officer

## Team Updates

📌 **Team update (2026-06-02 — Piece 30 Revision Follow-On Review):** RETRO participated in 3-reviewer follow-on adversarial review of Booster's revision (commit a9da5453). Verdict: APPROVE-WITH-NITS. 1 new mandatory finding (Medium): `git clone` failure paths emit unredacted URL with embedded PAT to stderr without `2>&1` suppression. 1 new Low finding: `$DocsRemoteName` and `$StateBranch` parameters unvalidated. Prior M1 PARTIALLY-RESOLVED (Write-Host redaction correct; stderr gap remains); M2 + M3 RESOLVED. Safe to merge; follow-on patch recommended.

📌 **Team update (2026-06-02 — Piece 30 Revision follow-on, commit a9da5453):** RETRO conducted focused re-review of bootstrap-cross-repo.ps1. M2 (-- separator) and M3 (scheme allowlist) are fully resolved. M1 (PAT leak) is PARTIALLY-RESOLVED: Write-Host is correctly redacted; residual gap is git clone stderr on failure — git may emit the raw URL (with embedded PAT) to stderr which propagates through ErrorActionPreference=Stop into pipeline logs. Suppress with `2>&1` redirect and sanitized error message. New findings: M_NEW_1 (Medium) — git clone error path not redacted; N_NEW_1 (Low) — DocsRemoteName/StateBranch parameters unvalidated, could corrupt .git/config. Overall verdict: APPROVE-WITH-NITS. Safe to merge; follow-on patch recommended for M_NEW_1.

## Current Security Learnings

### Piece 30 — Bootstrap Security Hardening (2026-06-02)

**Key attack patterns resolved:**

1. **PAT-in-URL leak via Write-Host (HIGH):** Redacted DocsRepoUrl using `://***@` pattern before console emission. Prevents credential leaks to pipeline logs and ADO command-line logs.
2. **Git clone argument injection (MEDIUM):** Added `--` separator before DocsRepoUrl. Team convention established in piece 14; blocks URLs starting with `--`.
3. **URL scheme validation (MEDIUM):** Implemented positive-assertion allowlist (https, http, git+ssh, ssh, git@). Rejects file://, ftp://, others. Blind-clone probes now safe-fail.
4. **SYSTEM_ACCESSTOKEN scoping (CORRECT):** Token scoped to specific fast-forward step via `env:`. Portable pattern for ADO pipeline token management.
5. **Alias validation inheritance (CORRECT):** Reuses piece-27 pattern `^[a-z][a-z0-9-]{0,38}$`. Charset allowlist prevents injection through hostname. Validated before any write operation.

**Portable lesson:** Any script or pipeline accepting a repo URL must (a) never echo URL to console, (b) add `--` separator before URL-position git args, (c) validate URL scheme before cloning.

---

## Historical Security Archive

**Summary:** RETRO oversees injection prevention, authentication boundaries, fail-closed semantics, and path-traversal defense across the Stack. Key contributions: registry validation (pieces 01–03), callsign charset restrictions, symlink sentinel defense, git subprocess hardening via `execFileSync` array args + `--` separators (piece 14 convention), validation-at-resolver-boundary pattern, atomic metadata writes, whitespace-alias bypass detection, hook recursion guards, DEVELOPER_ALIAS charset validation at CLI boundary.

**Archived sections:** Early pieces 01–03 foundation, pieces 08–10 lifecycle hardening, piece 14 adversarial findings, piece 10 init fail-fast review, piece 11b mirror-sync, scrub-gate cleanup (piece 18), piece 27 nit revision, piece 29 adversarial findings, piece 30 detailed adversarial analysis.

**Key patterns:** All git subprocess calls use `execFileSync` with array arguments (no shell). Remote names validated against `listRemotes()` output before use. Hook templates use literal refspec concatenation with proper quoting. SQUAD_SYNC_ACTIVE env guard prevents recursion. No cross-repo privilege escalation vectors. Charset allowlists for all user-controlled git identifiers (callsigns, aliases, remote names).

