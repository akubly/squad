---
name: "agent-prompt-reachability"
description: "Audit agent prompts top-down so critical routing logic stays reachable"
domain: "prompt-architecture"
confidence: "medium"
source: "procedures"
---

## SCOPE

**✅ THIS SKILL PRODUCES (exactly these, nothing more):**
- A top-down reachability audit of an agent prompt's opening decisions
- A concrete recommendation for where routing logic must live
- A short dead-zone diagnosis when a higher trigger bypasses deeper logic

**❌ THIS SKILL DOES NOT PRODUCE:**
- Product code changes unrelated to prompt structure
- New parallel top-level checks that duplicate existing routing
- Hand-wavy prompt advice without a specific reachability path

## Context

Agent prompts have control flow even when they look like prose. The opening checks define the reachability tree. If a top-level trigger short-circuits before critical logic runs, that deeper logic is effectively dead code.

## Patterns

### Core rule

> Audit decision triggers top-down: any branch that short-circuits before reaching critical logic creates a dead zone.

### Placement rule

Logic that decides session mode, routing mode, identity, or workspace resolution belongs at the top-level trigger point that governs those outcomes. Nested explanatory sections may reference the canonical algorithm, but they must not be the first place that algorithm appears.

### Canonical audit

1. Identify the first decision a fresh reader or model will encounter.
2. Trace each branch until it reaches a terminal mode or handoff.
3. Mark any critical logic that appears only after a branch can already terminate.
4. Lift that logic into the first reachable decision point.
5. Replace downstream duplicates with a back-reference to the canonical algorithm.

## AGENT WORKFLOW

1. **READ** the prompt from the top, not by jumping to the section you expect matters.
2. **TRACE** the first decision tree exactly as written.
3. **FLAG** any deeper logic that is unreachable for a real startup path.
4. **MOVE** the canonical routing logic to the topmost governing decision.
5. **VERIFY** that later sections reference the canonical logic instead of re-defining it.

## Anti-Patterns

- Burying critical routing under a later heading like "Worktree Awareness" or "Advanced Notes"
- Adding a second top-level check instead of extending the existing chain
- Keeping verbatim duplicate algorithms in multiple sections after lifting the canonical one
