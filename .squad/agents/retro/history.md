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

### Piece 08a adversarial review (2026-05-14T14:19:34-07:00)

**Verdict:** APPROVE

**Scrub gate cross-reference:** Gate 1 flagged 80+ pre-existing strip-listed paths (orchestration-log, identity, casting, templates, docs/_internal). Gate 3 flagged 20+ pre-existing references in orchestration logs, decisions archive, and prior review entries. Cross-referencing against the 7 files touched by `fcb0cf1a`: **zero intersection**. No piece-08a file appears in any strip list or reference list. Coordinator's acceptance of Gate 1 FAIL + Gate 3 WARN as baseline contamination is valid.

**Tone scan:** Four pattern classes flagged, all acceptable: (1) `upstream.json` — established data model field name used in 13+ files across packages/test, not fork residue; (2) `resolveSquadV2` and `resolution-v2` — actual module identifiers in `@bradygaster/squad-sdk`; (3) `@bradygaster/squad-cli` package namespace — the project's own npm scope; (4) "previously" — appears in pre-existing context line, not in 08a additions.

**PII scan:** Zero emails, zero tokens, zero credential patterns. One false-positive absolute-path hit: a regex assertion `.*repo` in test output matching — not a real path.

**Co-authored-by trailer:** Exact match confirmed: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

**Decision entry review:** `.squad/decisions/inbox/control-08a-working-tree-drift.md` and the merged entry in `.squad/decisions.md` are both clean — no PII, no comparison framing, no version leaks.
