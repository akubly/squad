# RETRO

> Retrofire Officer

## Team Updates

📌 **Team update (2026-06-03 — Piece 30 Revision, commit a9da5453):** Booster (revision implementer) addressed all 3 mandatory security findings from RETRO's adversarial review: (1) PAT-in-URL leak redacted via `://***@` pattern before Write-Host emission, (2) git clone now protected with `--` separator (injection defense per piece 14 convention), (3) URL scheme allowlist implemented (https, http, git+ssh, ssh, git@; rejects file, ftp, others). 196 tests pass; security hardening complete. Ready for merge.

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

