# Scribe — Session History

*Fresh start — Apollo 13 rebirth. Previous session logs archived.*

## Learnings

### Tone Leak Pattern: Verbatim Gate Label Quoting (2026-05-17)

**Pattern:** When writing orchestration logs, quoting scrub-gate report lines verbatim can leak prohibited tone terminology into committed files. Specifically, Gate 2 forbids a certain preview-channel codename; gate-check labels themselves may use that codename. The gate is designed to prevent it from shipping; ironically, documenting what the gate checks for can introduce it.

**Incident:** `.squad/orchestration-log/2026-05-16T070315Z-eecom.md` contained a gate-check label (drawn from the scrub-gate script's check-point name) in a scrub-gate results table. `.squad/agents/retro/history.md` included a description of a scan result that inadvertently quoted the prohibited preview-channel term. Both violations were caught by Gate 2.

**Fix Strategy:** 
1. Capture gate *results* (PASS/FAIL/WARN status) in orchestration logs, not gate *names* or check-labels.
2. When documenting what gates check, use neutral, non-prohibited terminology (e.g., "Preview-channel term references" instead of using the actual gate label).
3. Strip prohibited terms from scan report quotes — describe the result and the category, not the filter name or the term itself.
4. When writing lessons about tone violations: describe the *pattern* and *category* without reproducing the literal prohibited term. Refer to the scrub-gate source as the authoritative list.

**Examples of compliant rewrites:**
- Instead of reproducing a gate-check name: "Gate 4 — [preview-channel term check]: WARN"
- Instead of: "scan result: no [prohibited preview-channel codename]" → Use: "scan result: no preview-channel-specific terminology detected"

**Future:** The scrub-gate script (`docs/proposals/upstream-bradygaster/_scrub-gate.ps1`) is the authoritative reference for what each gate forbids. Point to that file, not to the literal terms.

