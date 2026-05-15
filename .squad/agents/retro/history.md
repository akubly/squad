# RETRO

> Retrofire Officer

## Learnings

### Issue Triage (2026-03-22T06:44:01Z)

**Flight triaged 6 unlabeled issues and filed 1 new issue.**

RETRO assigned:
- **#479 (history-shadow race condition)** → squad:eecom + squad:retro (production bug; mitigation through StorageProvider atomicity)

Pattern: Critical production bug identified. Race condition in history-shadow requires atomicity guarantees from StorageProvider abstraction (CONTROL/EECOM).

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. RETRO owns #479 mitigation strategy. Production bug severity high; blocks stable history-shadow operation. Depends on StorageProvider PRD completion (#481). Coordinated rollout required.

### Piece 03 adversarial review (2026-05-13T10:21:19-07:00)

**Verdict:** APPROVE (no blocking issues)

All git invocations use `execFileSync` with array args, no shell, stderr ignored — injection-free. Sentinel-bounded containment in `clonesMatch` correctly blocks sibling-prefix false positives; realpath fallbacks catch all exceptions. URL parsing avoids `new URL()` constructor entirely; credential stripping handles `user:pass@` form. Two non-blocking hardening candidates: (1) add `path.isAbsolute()` guard on worktree porcelain paths; (2) piece 01 schema should reject root-level clone entries (`C:\`, `/`).

### Piece 02 adversarial review (2026-05-12T23:06:58-07:00)

**Verdict:** CLEAR (no blocking issues, 2 hardening recommendations accepted)

**Hardening recommendations implemented in commit `05bd332f`:**
1. **Callsign character-set validation** — Restrict to `^[A-Za-z0-9_-]+$` at resolver boundary (both `opts.callsign` and `SQUAD_CALLSIGN` env var), max length 64.
2. **Symlink defense** — Use `fs.lstatSync` (not `fs.statSync`) when checking registry entry stored paths. Prevents symlinks to nonexistent targets from silently being followed.

**Risk assessment:** Low today (strict equality validation prevents injection). Future-proofing: if callsigns are used in file paths or URLs downstream, character validation acts as first-line defense.

**Cleared threat vectors:** Registry traversal, env-var trust boundary, symlink following, JSON injection, TOCTOU races — all non-exploitable from unprivileged inputs given current design. Validation at resolver boundary completes the security model begun in piece 01 registry validation.

### Piece 08b adversarial review (2026-05-14T16:12:01.302-07:00)

**Verdict:** APPROVE WITH NITS (no blocking issues, 4 hardening candidates)

**PII/Secret scan:** CLEAN. Only `@.*\.com` hit is the standard git author/co-authored-by trailer. No tokens, no `ghp_`, no `github_pat_`. Zero committed artifact PII.

**Risk inventory (all LOW):**

1. **`--home` flag accepts arbitrary path without absolute-path or bounds check** — `assign.ts:81-82,129`. `home` from CLI args flows directly into `path.join(home, '.copilot', 'agents', ...)` with no validation. OS permissions generally block escalation and the written content is a fixed internal template; LOW. Mitigation: `path.isAbsolute(home)` guard; optionally reject paths outside `os.homedir()`.

2. **`normalizedCwd` registered as clone without absolute-path guard** — `assign.ts:108`. `path.normalize(opts.cwd)` does not guarantee an absolute result if `opts.cwd` is relative; a relative clone path confuses future resolver comparisons. Echoes piece 03 hardening. Mitigation: `path.isAbsolute(opts.cwd)` check before normalize and write.

3. **`consult --status` deliberately skips resolver guard** — `cli-entry.ts` `showStatus` bypass. Intentional per spec; `--status` is read-only and no registry or project writes occur. The inline comment documents the intent. LOW; no remediation required for approval.

4. **Test fixture env isolation incomplete** — `legacy-resolver-migration.test.ts:44-68`. `runCli` spreads `process.env` but does not suppress `XDG_CONFIG_HOME`/`APPDATA`. The randomBytes suffix makes real-path collision very unlikely; LOW in practice. Mitigation: add `XDG_CONFIG_HOME`/`APPDATA` overrides to the env seam for resolver-guard tests.

**Additional confirmed-clean vectors:** No dry-run output writes to `.squad/` files. `_installCoordinatorAgent` correctly uses `lstatSync` (not `statSync`) to detect and unlink symlinks before copying — consistent with piece 02 symlink hardening pattern. Template source is package-internal (`getTemplatesDir()` walk bounded to 6 levels); no user-controlled template path injection possible. Resolver guard in `assign.ts` fires before all side effects; the two-phase pattern (resolve → side-effects) is correctly implemented.

### Piece 08a adversarial review (2026-05-14T14:19:34-07:00)

**Verdict:** APPROVE

**Scrub gate cross-reference:** Gate 1 flagged 80+ pre-existing strip-listed paths (orchestration-log, identity, casting, templates, docs/_internal). Gate 3 flagged 20+ pre-existing references in orchestration logs, decisions archive, and prior review entries. Cross-referencing against the 7 files touched by `fcb0cf1a`: **zero intersection**. No piece-08a file appears in any strip list or reference list. Coordinator's acceptance of Gate 1 FAIL + Gate 3 WARN as baseline contamination is valid.

**Tone scan:** Four pattern classes flagged, all acceptable: (1) `upstream.json` — established data model field name used in 13+ files across packages/test, not fork residue; (2) `resolveSquadV2` and `resolution-v2` — actual module identifiers in `@bradygaster/squad-sdk`; (3) `@bradygaster/squad-cli` package namespace — the project's own npm scope; (4) "previously" — appears in pre-existing context line, not in 08a additions.

**PII scan:** Zero emails, zero tokens, zero credential patterns. One false-positive absolute-path hit: a regex assertion `.*repo` in test output matching — not a real path.

**Co-authored-by trailer:** Exact match confirmed: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

**Decision entry review:** `.squad/decisions/inbox/control-08a-working-tree-drift.md` and the merged entry in `.squad/decisions.md` are both clean — no PII, no comparison framing, no version leaks.

### Piece 08b Revision — Sims Applied RETRO Hardening (2026-05-14T16:12:01Z)

📌 **Sims successfully applied all 4 RETRO LOW hardening candidates.**

RETRO identified 4 LOW-severity hardening improvements during adversarial review. Sims applied all in the revision:

1. **`--home` path validation (assign.ts):** Added `path.isAbsolute()` check and `..`-segment detection before `path.join(home, '.copilot', 'agents', ...)`. Prevents relative path confusion.

2. **`--cwd` absolute-path guarantee (assign.ts):** Added `path.isAbsolute(opts.cwd)` check before `path.normalize()` and registry write. Ensures registered clone paths remain absolute.

3. **`--status` read-only verification (cli-entry.ts):** Inline comment documents intentional bypass; confirmed via code inspection that `runConsult --status` never acquires write locks. No remediation needed; documentation added.

4. **Test env isolation (legacy-resolver-migration.test.ts):** Added `XDG_CONFIG_HOME`/`APPDATA` overrides to resolver-guard tests. Eliminates potential fixture collision via real-path seam.

**Pattern:** Path validation should be standard for all user-provided paths flowing into file operations. Resolved variable threading + hardened path checks establish the model for 08c+.

### Piece 08c adversarial review (2026-05-14T17:54:18.903-07:00)

**Verdict:** REJECT

Lifecycle command dispatch now resolves before starting bridges, tunnels, PTYs, or child processes, and subprocess CWD stays on the user-facing start directory. However, clone/origin registry matches can return a registry path without checking that the resolved squad directory exists, and malformed registry content can be ignored for clone/origin matching. That is not fail-closed enough for long-running commands: a stale or malformed registry can still lead to a bridge session using the wrong squad identity or fallback squad. Revision should be owned by GNC, not the original author, and should add fail-closed lifecycle tests for stale resolved paths and explicit registry parse failures.

### Piece 08c Revision — GNC Applied Fail-Closed Lifecycle Validation (2026-05-15T00:54:18Z)

📌 **GNC successfully addressed RETRO blocker and both FIDO majors.**

Blocker resolved: Added `lstatSync` stale-path guards after clone/origin registry matches (mirrors callsign pattern), and explicit registry parse errors now throw `REGISTRY_INVALID` before any state creation. FIDO major #1 (error assertion): `rc does not start bridge when resolution throws` now asserts error text visible. FIDO major #2 (dispatch passthrough): Dispatch-level copilot args passthrough now tested via `runCliShort(['start', '--extra-copilot-flag'])` subprocess, proving dispatch filter preserves non-squad args. Test count 27/27 GREEN, scrub gate passed, commit ff55ecf7.

