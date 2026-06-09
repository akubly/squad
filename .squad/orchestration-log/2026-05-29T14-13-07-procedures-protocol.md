# Orchestration Log — Procedures Protocol Specs (Pieces 29–30.5)

**Timestamp:** 2026-05-29T14:13:07-07:00  
**Agent:** Procedures  
**Mode:** background  
**Duration:** 2 follow-up turns (initial + corrections)  
**Outcome:** ✅ SUCCESS

## Summary

Authored protocol-change specs for pieces 29, 30, and 30.5 gate audit. Extended `_scrub-gate.ps1` with Gates 7, 8, 9 (81 lines ps1 + 392 spec lines). Two follow-up turns required for corrections:
1. **Turn 1 correction**: PowerShell variable interpolation bug (`$cf:` → `${cf}:`).
2. **Turn 2 correction**: Test-fixture illustration variables normalized (akubly → dev1).

## Gate Rules Added (Upstream-Bound)

1. **Gate 7**: Absolute path segment exclusion (no `Users\`, `/home/` in config/metadata).
2. **Gate 8**: ADO `$(...)` exclusion in template paths.
3. **Gate 9**: Alias format allowlist `[a-z][a-z0-9-]{0,38}`.

## Protocol Decisions Locked

### Piece 29 (Session Restart)
- Restart requirement section with verbatim banner string
- Banner: "🔄 squad.agent.md updated — restart sessions to pick up new path semantics (TEAM_ROOT/WORK_ROOT split). Pre-29 sessions will silently route writes to wrong roots."

### Piece 30 (YAML Templates)
- Behavioral assertion tests (YAML parse + structural contracts)
- No schema vendoring
- New devDependency: `yaml` package

### Piece 30.5 (Gate Audit)
- Hybrid scrub-gate evolution: per-piece tests + atomic post-30 gate extension
- All three new rules tagged `[upstream-bound]` (flow upstream with pieces)
- Replay-private vs upstream-bound authoring distinction established

## Corrections Applied

**Turn 1:** PowerShell syntax fix in gate 8 rule:
```powershell
# BEFORE (syntax error)
if ($cf: -match ...)
# AFTER (correct)
if (${cf}: -match ...)
```

**Turn 2:** Test fixture rebase:
- Illustration variables normalized from `akubly` workspace naming to generic `dev1` for replay isolation.

## Deliverables

- `29-spec.md`: Coordinator protocol change, session restart requirement
- `30-spec.md`: YAML template validation, behavioral assertion tests
- `30.5-spec.md`: Gate audit piece, Gate 7/8/9 rules, upstream-bound/replay-private distinction
- `_scrub-gate.ps1`: Extended with Gates 7, 8, 9 (81 lines added)

## Status

All specs + extended gate file delivered to `akubly/upstream-specs` (commit e31b1b92 contains 837 insertions across 7 files: 6 specs + scrub-gate extension). Arc is spec-ready; piece 26 can execute in next session.

## No Unresolved Issues

Protocol specs are complete. Procedures workflow finished after 2 follow-up turns.
