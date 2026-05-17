---
date: 2026-05-17
requested_by: Copilot (Scribe)
topic: Tone leak pattern in gate documentation
---

# Decision: Avoid Reproducing Prohibited Terms When Documenting Tone Gates

## Problem

Orchestration logs and agent histories leaked prohibited preview-channel terminology by quoting scrub-gate check-point names verbatim. Gate 2 is designed to prevent this pattern from shipping; paradoxically, documenting what the gate filters can introduce the very terms the gate forbids.

**Incident:** Session logs inadvertently reproduced a preview-channel term that Gate 2 forbids when documenting scrub-gate results. The source was copying gate-check labels from the scrub-gate script directly into committed prose.

## Root Cause

- Scrub-gate check-point names may use prohibited terminology (the gate must know what to forbid).
- When logging scrub-gate results, the natural documentation instinct is to quote the check name.
- No guidance exists for safe gate documentation within tone constraints.

## Solution

**Principle:** When documenting scrub-gate results or lessons in committed files, never reproduce prohibited terms even when explaining why those terms are forbidden. Instead:

1. Describe the *check category* (e.g., "preview-channel terminology detection") instead of the check name.
2. Refer readers to the authoritative source: `.docs/proposals/upstream-bradygaster/_scrub-gate.ps1` (Gate 2 section).
3. When documenting gates, focus on the *result* and *pattern*, not the literal string being filtered.
4. Use neutral placeholders: "the legacy preview-channel codename", "a prohibited term Gate 2 forbids", "preview-channel-specific language".

## Consequences

- Lesson documentation itself can't violate what it teaches.
- Scrub-gate audit becomes zero-false-positive for committed docs (no mention means no violation).
- Clearer separation: gate internals can name things; committed prose cannot.

## Owner

Scribe — applies to all session logging and decision documentation going forward.

