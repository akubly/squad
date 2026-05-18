# Decisions

> Team decisions that all agents must respect. Managed by Scribe.

---

## 2026-05-15: Fork Relationship & Integration Strategy

### Strategic relationship to tamirdresher/squad fork

**By:** Flight  
**Date:** 2026-05-15T22:57:50-07:00

Treat `tamirdresher/squad` as an **incubation lane**, not an alternate trunk. When a Tamir branch addresses a capability that already exists in `bradygaster/squad`, use mainline as the reference implementation. When a Tamir branch proposes a capability beyond current mainline scope, treat it as a proposal candidate first. Keep `feat/upstream-auto-sync` on the watchlist as the clearest branch extending beyond current upstream inheritance semantics.

**Rationale:** Fork convergence on problem selection (scheduler-backed automation, persistent Ralph, cross-squad discovery, state backends) with divergence in delivery shape (Tamir packages whole loops, Brady productizes safer primitives). `feat/state-backend-global-996` demonstrates pattern: now behind-only, meaning core direction was accepted upstream then evolved further. Fork most useful as early-warning stream, not long-lived source of truth.

**Operating Guidance:**
1. Read Tamir branch names as signals about where community energy concentrates
2. Compare concepts and operator model for overlapping branches, not raw diff size
3. Require proposal-first framing for new automation-heavy branches before upstream adoption
4. Revisit if Squad moves toward stronger fork-to-fork propagation workflows

---

### Fork prompt ideas should land as lazy-loaded skills first

**Date:** 2026-05-15T22:57:50-07:00  
**Author:** Procedures

When borrowing prompt-layer ideas from fork, prefer **lazy-loaded skills, templates, or reference files** over adding more always-loaded coordinator text. Only promote a fork idea into `.github/agents/squad.agent.md` when it closes a verified coordinator failure or establishes a hard governance rule.

**Why:** Fork's strongest ideas (`fact-checking`, `iterative-retrieval`, `error-recovery`, `notification-routing`, `scheduled-tasks`) are packaged as skills/templates—matching existing direction. Weaker candidates make optional behavior mandatory at coordinator layer, increasing ceremony cost and prompt weight without addressing known coordinator failure as directly.

**Implications:**
- Good fork candidates should enter Squad as optional skills/templates first
- Ceremony/scheduler/reviewer behavior should stay opt-in unless Flight approves governance change
- Prompt reviews should ask: "Does this need always-loaded coordinator text, or can it be a skill?"

---

### State backend integration priority: evaluate feat/state-backend-global-996

**Date:** 2026-05-15T22:57:50-07:00
**Author:** EECOM

Before adding more squad-home / cross-machine state work on `dev`, evaluate Tamir's `feat/state-backend-global-996` design as the primary integration candidate rather than building a second parallel state mobility stack.

**Why:** It's the fork's heaviest code branch, landing in modules Squad already owns: `packages/squad-sdk/src/state-backend.ts`, `resolution.ts`, `presets/*`, and CLI commands. The branch has a concrete persistence model (`local`, `git-notes`, `external`, `orphan`, `two-layer`) with distinctive `git notes --ref=squad` backend anchored to repo root commit—avoiding branch-local state loss while staying git-native.

**Suggested team takeaway:** If Squad wants portable/shared `.squad` state, prefer one deliberate review of the `state-backend-global-996` backend abstraction over ad hoc additions to `resolution.ts`, personal squad sync, or preset roaming.

---

## Foundational Directives (carried from beta, updated for Mission Control)

### Type safety — strict mode non-negotiable
**By:** CONTROL (formerly Edie)
**What:** `strict: true`, `noUncheckedIndexedAccess: true`, no `@ts-ignore` allowed.
**Why:** Types are contracts. If it compiles, it works.

### Hook-based governance over prompt instructions
**By:** RETRO (formerly Baer)
**What:** Security, PII, and file-write guards are implemented via the hooks module, NOT prompt instructions.
**Why:** Prompts can be ignored. Hooks are code — they execute deterministically.

### Node.js >=20, ESM-only, streaming-first
**By:** GNC (formerly Fortier)
**What:** Runtime target is Node.js 20+. ESM-only. Async iterators over buffers.
**Why:** Modern Node.js features enable cleaner async patterns.

### Casting — Apollo 13, mission identity
**By:** Squad Coordinator
**What:** Team names drawn from Apollo 13 / NASA Mission Control. Scribe is always Scribe. Ralph is always Ralph. Previous universe (The Usual Suspects) retired to alumni.
**Why:** The team outgrew its original universe. Apollo 13 captures collaborative pressure, technical precision, and mission-critical coordination — perfect for an AI agent framework.

### Proposal-first workflow
**By:** Flight (formerly Keaton)
**What:** Meaningful changes require a proposal in `docs/proposals/` before execution.
**Why:** Proposals create alignment before code is written.

### Tone ceiling — always enforced
**By:** PAO (formerly McManus)
**What:** No hype, no hand-waving, no claims without citations.
**Why:** Trust is earned through accuracy, not enthusiasm.

### Zero-dependency scaffolding preserved
**By:** Network (formerly Rabin)
**What:** CLI remains thin. Zero runtime dependencies for the CLI scaffolding path.
**Why:** Users should be able to run `npx` without downloading a dependency tree.

### Merge driver for append-only files
**By:** Squad Coordinator
**What:** `.gitattributes` uses `merge=union` for `.squad/decisions.md`, `agents/*/history.md`, `log/**`, `orchestration-log/**`.
**Why:** Enables conflict-free merging of team state across branches.

### Interactive Shell as Primary UX
**By:** Brady
**What:** Squad becomes its own interactive CLI shell. `squad` with no args enters a REPL.
**Why:** Squad needs to own the full interactive experience.

### Root Cause Analysis

Three factors combine to create the VS Code routing failure. Ranked by dominance:

#### 1. 🔴 CLI-Centric Enforcement Language (DOMINANT)

The routing constraint is expressed exclusively in CLI terms. The CRITICAL RULE references 	ask tool only. When the coordinator reads this in VS Code, where the tool is unSubagent, it doesn't reliably make the substitution. It falls through to Platform Detection's Fallback mode: 'work inline.' This enforcement language creates a logical gap.

#### 2. 🟡 Prompt Saturation (AMPLIFYING)

The coordinator prompt is 950 lines / ~80KB. The routing constraint is buried at line 1010 under irrelevant sections (Init Mode, ceremonies, Ralph work monitor, worktree lifecycle). The core dispatch loop accounts for ~200 lines, competing for attention with ~750 lines of governance and reference material.

#### 3. 🟡 Template Duplication (AMPLIFYING)

CLI 1.0.11 discovers all \*.agent.md\ files from cwd to git root. Squad has 5 copies: .squad-templates, templates/, packages/squad-cli/templates, packages/squad-sdk/templates, and .github/agents/. Only .github/agents/ should be discoverable. CLI 1.0.11 merges ALL of them, multiplying the coordinator instructions by 5x and diluting the routing constraint.

### Proposed Fixes

**Fix 1: Platform-Neutral Enforcement Language (P0)**
- Rewrite CRITICAL RULE to be platform-neutral: 'You are a DISPATCHER, not a DOER. Every task that needs domain expertise MUST be dispatched to a specialist agent.'
- List dispatch mechanisms: CLI (\	ask\ tool), VS Code (\unSubagent\ tool), or fallback (work inline)
- Update anti-patterns and constraints sections with same substitution

**Fix 2: Top-and-Bottom Reinforcement (P0)**
- Add reinforcement block at end of prompt (LLMs weight beginning/end more heavily than middle)
- Emphasize: Squad ROUTES, it does not BUILD. Do not produce domain artifacts inline.

**Fix 3: Prompt Slimming — Move to Lazy-Loaded References (P1)**
- Extract ~350 lines (~37%) to lazy-loaded templates: worktree-reference.md, ralph-reference.md, casting-reference.md, mcp-reference.md
- Reduce from 950→600 lines, making routing constraint a larger percentage of total prompt

**Fix 4: Template File Renaming (P1)**
- Rename template copies to .template extension to prevent CLI 1.0.11 discovery
- Update sync-templates.mjs and squad-cli/squad-sdk init code to reference new filenames

**Fix 5: VS Code-Specific Hardening Block (P1)**
- Move VS Code adaptations section higher (from line 458 to immediately after CRITICAL RULE)
- Restructure as active enforcement block with platform detection table
- Make clear: if \unSubagent\ is available, it MUST be used for domain work

### Priority Ordering

| Priority | Fix | Impact | Effort | Ships In |
|---|---|---|---|---|
| **P0** | Fix 1: Platform-neutral enforcement | 🔴 Directly closes logical gap | Low | Next patch |
| **P0** | Fix 2: Top-and-bottom reinforcement | 🔴 Exploits LLM attention patterns | Trivial | Next patch |
| **P1** | Fix 4: Template file renaming | 🟡 Eliminates 4x duplication | Medium | Next minor |
| **P1** | Fix 3: Prompt slimming | 🟡 Reduces 950→600 lines | Medium | Next minor |
| **P1** | Fix 5: VS Code hardening block | 🟡 Makes VS Code dispatch prominent | Low | Next minor |

**Ship order:** Fix 1 + Fix 2 together (one PR, immediate). Fix 4 next (requires code changes). Fix 3 + Fix 5 together (prompt restructure PR).

### Validation

After implementing, test with Andreas's reproduction case:
1. Open VS Code with squadified project
2. Ask coordinator to do domain work that matches routing rule
3. Verify: coordinator dispatches via \unSubagent\ instead of working inline
4. Verify: coordinator cites the routing rule when dispatching

FIDO should own the test scenario. GUIDO should validate the VS Code runtime behavior.

### Open Questions

1. Does CLI 1.0.11 support exclusion patterns (.copilotignore)? If yes, Fix 4 becomes simpler.
2. Should we version-gate the VS Code adaptations (detect CLI version)?
3. Is \unSubagent\ still the correct tool name, or has it changed?
---

# Decision: PR Review Batch — Overlap Resolution

**Date:** 2026-03-25  
**Reviewer:** FIDO (Quality Owner)  
**Context:** 10 open PRs reviewed, 3 duplicate/overlap pairs identified

## Problem

tamirdresher opened 6 PRs addressing related concerns (retro enforcement, challenger agent, tiered memory). Three pairs have significant overlap:

1. **#607 vs #605** — Both add weekly retro ceremony with Ralph enforcement
2. **#604 vs #603** — Both add Challenger agent template (complete duplicates)
3. **#606 vs #602** — Both add tiered memory/history skills (superset/subset)

## Decision

**Merge these:**
- **#607** (retro enforcement) — comprehensive, standalone ceremony file
- **#603** (Challenger + fact-checking) — correct file locations, follows project conventions
- **#606** (tiered memory) — superset of #602, 3-tier model vs 2-tier

**Close as duplicate:**
- **#605** — same scope as #607, less comprehensive
- **#604** — duplicate of #603, different file locations
- **#602** — subset of #606, narrower scope

## Rationale

- **#607 vs #605:** #607 provides standalone ceremony file (`ceremonies/retrospective.md`) + enforcement guide + skill, while #605 inlines into existing templates. Standalone file is more discoverable and modular.
- **#604 vs #603:** Functionally identical. #603 uses `.squad/` paths matching project conventions; #604 uses `templates/` (non-standard for agents).
- **#606 vs #602:** #606 is a superset — 3-tier model (hot/cold/wiki) vs 2-tier (hot/cold). Both cite same production data. Broader scope is more useful.

## Impact

- Reduces PR count from 10 to 7 (close 3 duplicates)
- Eliminates conflicting file changes (e.g., both #607 and #605 modify `templates/ceremonies.md`)
- Preserves all unique value (no functionality lost)

## Affected PRs

| PR  | Action | Reason |
|-----|--------|--------|
| 607 | Merge  | Comprehensive retro enforcement |
| 605 | Close  | Duplicate of #607 (less comprehensive) |
| 604 | Close  | Duplicate of #603 (wrong file paths) |
| 603 | Merge  | Challenger template (correct paths) |
| 606 | Merge  | Tiered memory (superset) |
| 602 | Close  | Subset of #606 (narrower scope) |

## Next Steps

1. Comment on #605, #604, #602 explaining they are duplicates/subsets and will be closed
2. Merge #607, #603, #606 after author confirms deduplication is acceptable
3. All other PRs (#611, #608, #592, #567) can proceed independently

---

# Decision: Triage + Work Session Plan

**By:** Flight  
**Date:** 2026-03-25

## Context

Triaged 14 untriaged issues (3 docs, 6 community features, 3 bugs, 2 questions). Multiple overlap with existing P1 work. 10 open PRs (5 from tamirdresher, 2 from diberry, 1 from joniba, 1 from eric-vanartsdalen, 1 draft).

## Triage Decisions

### High-Value Quick Wins (P1)
- **#610** (docs broken link) → squad:pao, P1 — 5-minute fix blocking diberry's PR #611 CI
- **#590** (getPersonalSquadRoot bug) → squad:eecom, P0 — personal squad init broken for all users since v0.9.1
- **#591** (hiring wiring docs) → squad:procedures, P1 — matches PR #592 (joniba), docs-only, high clarity

### Community Feature Contributions (Defer to Review)
- **#601, #600, #598, #596, #595** (tamirdresher proposals) — all have matching PRs (#607, #606, #604, #602). Priority: review PRs first, triage issues after PR decisions.

### Maintenance Items (P2)
- **#597** (upgrade CLI docs) → squad:pao + squad:network, P2 — user confusion, docs fix + UX improvement
- **#588** (model list update) → squad:procedures, P2 — hardcoded model list in squad.agent.md + templates
- **#554** (broken external links) → squad:pao, P2 — automated link checker output, investigate failures

### Questions (No Squad Assignment)
- **#589** (skills placement) → community reply — clarify `.copilot/skills` vs `.github/skills` vs `.claude/skills`
- **#494** (model vs squad model) → community reply — clarify Copilot CLI `/models` vs squad.agent.md model preference

### Long-Horizon Feature Work (P2-P3)
- **#581** (ADO Support PRD) → squad:flight, P2 — comprehensive PRD, but blocked until SDK-first parity (#341) ships

## Work Session Priority (Top 5)

1. **#610** → PAO — fix broken link (5 min), unblocks #611
2. **#590** → EECOM — fix getPersonalSquadRoot(), critical user-facing bug
3. **PR #592** → Flight review — matches #591, validate joniba's wiring guide
4. **PR #611** → Flight review — diberry TypeDoc API reference (blocked on #610 fix)
5. **#588** → Procedures — update model lists in templates

## PR Review Strategy

**Merge-ready (after minimal validation):**
- #611 (diberry) — blocked on #610, then merge
- #592 (joniba) — high-quality wiring guide

**Tamir PRs (defer until proposal-first validated):**
- #607, #606, #605, #604, #603, #602 — all substantive feature proposals without prior proposals in `docs/proposals/`. Apply proposal-first policy: request `docs/proposals/{slug}.md` before reviewing implementation.

**Draft (not ready):**
- #567 (diberry) — explicitly marked DRAFT

## Patterns Noted

- **Tamir contributions:** High technical quality, but needs proposal-first discipline (6 PRs without proposals).
- **Joniba contributions:** Consistently high-quality, matches team standards (wiring guide is excellent).
- **Diberry contributions:** MSFT-level quality, merge-ready on delivery.

---

## 2026-05-17: Multi-Squad Management — Design Phase Closeout

**By:** Brady + Squad team (multi-round)

**What:** Adopted the "third path" multi-squad design: minimum invariant SDK kernel upstream-shaped, org-specific catalog/policy/deployment as a layer ON TOP of Squad, Rally as an optional consuming host with no hard dependency, pluggable binding-location lookup, pivot heuristic to flip to full independence if upstream kernel acceptance exceeds ~12 weeks.

**Authoritative artifact:** `.squad/decisions/multisquad-design/flight-multisquad-proposal-and-spec-v1.1.md` (supersedes v1.0). Status: Proposal — pending Brady approval.

**Decision trail:** `.squad/decisions/multisquad-design/` contains all Round 1–7 working artifacts:
- Round 1: Proposals from Flight/Procedures/EECOM/RETRO/Network/PAO
- Round 2: Convergence
- Round 3: Gap analysis
- Round 4: Solution shape recommendation
- Round 5: Priority-framed plan + reuse audit + rubber-duck devil's advocate
- Round 6: Proposal v1.0 + directives
- Round 7: Proposal v1.1 with directives folded in

**Why:** Closeout of design phase. Future implementation work references the v1.1 proposal as the source of truth. This entry is the index — DO NOT inline the proposal content.

---

## 2026-05-17: User directives — Binding location & layering

### Binding location flexibility

**By:** Brady  
**What:** Flexibility of `.squad/` source-of-truth location is a first principle. Some organizations / teams will want in-repo bindings; others will not. Treat this as one flavor of the broader "dotfiles can live anywhere" requirement. The SDK must support both modes without friction; neither is privileged.  
**Why:** User request — captured for team memory. Frames the binding-default design question (Round 6 open question #1).

### Squad layering principle

**By:** Brady  
**What:** Anything *specific to using Squad in an organizational setting* MUST be layered on top of Squad, not built into Squad itself. Squad's job is to provide the core flexibilities required so that the organizational layer works without friction or a custom fork. This is the canonical org-vs-public boundary rule.  
**Why:** User request — captured for team memory. Frames the SDK boundary question (Round 6 open question #2: managed-machine personal sandboxing). Implication: the SDK provides primitives for scoping/restricting personal mode; the *policy* of when to enforce it on corp boxes belongs in the org tool, not in upstream Squad.

### 2026-05-17 (rev): Multi-Squad Proposal — v1.2 revision

**By:** Brady + PAO + Flight
**What:** Added a "User Story — Casey's First Day" section to Part I of the multi-squad proposal, immediately after the executive summary. v1.2 supersedes v1.1; v1.1 preserved as historical artifact.
**Authoritative artifact:** `.squad/decisions/multisquad-design/flight-multisquad-proposal-and-spec-v1.2.md`
**Why:** Make the v1.1 design legible to non-engineer stakeholders by anchoring it in lived experience.
**Note:** v1.2 "Changes from v1.1" block flags one narrative↔spec discrepancy: the story uses illustrative `eng` org-tool commands and `squad-cli` flag spellings that Part II does not yet define normatively. Resolve in a future revision when those surfaces firm up.

## Deferred

- #357, #336, #335, #334, #333, #332, #316 (A2A) — stays shelved per existing decision
- #581 (ADO PRD) — P2, blocked until #341 (SDK-first parity) ships

---

### 2026-04-25: Release Process Skill Update — v0.9.4 Learnings
**Author:** Booster (CI/CD Engineer)
**Status:** Implemented

**Summary:** Updated both release-process skill files with critical learnings from the v0.9.4 release session. The v0.9.4 release was delayed by three distinct issues, each fixed by a separate PR.

**Files Updated:**
1. `.squad/skills/release-process/SKILL.md` (team-level skill)
2. `.copilot/skills/release-process/SKILL.md` (copilot-level skill)
3. `.squad/agents/booster/history.md` (learnings log)

**New Knowledge Added:**
| Issue | Root Cause | Fix PR | Skill Section |
|-------|-----------|--------|---------------|
| Root package.json version drift | squad-release.yml reads from root, not sub-packages | #1043 | Known Gotchas + v0.9.4 Incident Learnings |
| CHANGELOG missing `## [$VERSION]` | Workflow validates version entry exists | #1042 | Known Gotchas + Release Checklist |
| Lockfile integrity check rejects workspace packages | Check didn't filter for registry-only packages | #1044 | Known Gotchas + Common Failure Modes |
| GITHUB_TOKEN can't trigger downstream workflows | GitHub security feature prevents event propagation | N/A (design) | GITHUB_TOKEN section + Manual Publish |
| Prebuild bump breaks workspace linking | bump-build.mjs mutates versions breaking exact match | N/A (known) | Local Development section |

**Cross-References:** Added bidirectional cross-references between team-level and copilot-level skill files. Added PR references (#1042, #1043, #1044) as source evidence throughout.

**Rationale:** These are high-impact, recurring failure modes. Documenting them in the skill files ensures every agent (human or AI) working on releases has the knowledge to avoid repeating the v0.9.4 delays. The GITHUB_TOKEN limitation in particular is non-obvious and would catch any future release.

---

### 2026-05-15: Rally Relationship to Squad
**By:** Flight (Lead)
**Requested by:** Brady (via Rally familiarization request)
**Status:** DECIDED

**Decision:**
1. Squad remains the committable, in-repo team framework. Its home model is repository-visible team state (`.squad/`, decisions, histories, routing, prompts).
2. Rally is the sanctioned complementary path for non-committable/shared-repo workflows. It should be treated as the external dispatch/orchestration layer for solo devs, OSS maintainers, forks, and shared repos where committing Squad state is undesirable.
3. Consult mode is now a compatibility surface. Squad SDK/CLI changes to personal squad resolution, consult-mode wiring, or agent file layout must consider Rally as a downstream consumer.
4. Do not blur the products by accident. Features that belong to Rally's operator console (repo onboarding, worktree dispatch management, dashboard/session bookkeeping) should not drift into Squad core unless we explicitly choose to converge product lines.

**Why:** Rally is not a clone of Squad. It wraps Squad with worktree orchestration, repo registration, dashboard UX, trust gating, and read-only dispatch controls, while relying on Squad for team behavior and agent semantics. That makes the relationship complementary, but it also means Squad now has an external consumer whose workflow depends on stable consult-mode behavior.

**Impact:** Squad roadmap discussions should assume two deployment models: committable/in-repo (Squad) and non-committable/external (Rally). Changes to personal squad, consult mode, and `.github/agents/squad.agent.md` layout need compatibility review for Rally. Product overlap with Rally should require an explicit decision, not organic duplication.

---

### 2026-05-15: EECOM — Rally Technical Integration Notes
**By:** EECOM (Core Dev)
**Requested by:** Brady (via Rally familiarization request)

**Key Technical Notes:**
- Rally uses `gh`/`gh api` as its host-side GitHub control plane, not Octokit. Cloning, issue/PR fetches, PR checkout, browser open, and trust/org checks all go through GitHub CLI wrappers in `lib/onboard.js`, `lib/dispatch-issue.js`, `lib/dispatch-pr.js`, `lib/picker.js`, and `lib/dispatch-trust.js`.
- Rally intentionally flips that rule inside spawned agents. `lib/copilot.js` denies `shell(gh)` (and `git push`, `curl`, `wget`, `ssh`, etc.) for dispatched Copilot runs and tells the agent to use GitHub MCP read tools instead. Host orchestration uses `gh`; in-worktree agents get local edits + MCP reads, but not GitHub CLI mutation power.
- Rally's `.worktrees/` placement is an implementation detail worth borrowing. Dispatch worktrees live under `{repo}\.worktrees\...`, so Node.js projects can often reuse the main checkout's `node_modules` through normal parent-directory resolution without explicit junction/symlink setup. Current coordinator worktree guidance still documents sibling worktrees plus manual `node_modules` linking.

---

### 2026-05-15: Squad and Rally Positioning Strategy
**By:** PAO (DevRel)
**Requested by:** Brady (via Rally familiarization request)

**Proposed Positioning:**
- **Squad** is the primary multi-agent runtime and team operating model. It fits best when you want durable AI team state, explicit roles, and repo-visible or repo-adjacent team configuration as part of the way your team works.
- **Rally** is the external operator shell for that runtime. It fits best for solo developers, maintainers, and contributors working in shared repos where committing `.squad/` state is not appropriate.

**Why Record This:** Rally's docs are consistent on one key message: it brings Squad to shared repositories without repo pollution by keeping team state outside the repo, using worktrees, and automating the issue/PR lifecycle. That complements Squad well, but only if Squad's own docs keep the product hierarchy clear: Rally is a companion path, not the default or the replacement.

**Messaging Guidance:**
1. In Squad docs, describe Rally as the "shared-repo / solo-maintainer companion" to Squad.
2. Keep Squad centered as the durable team/runtime layer, not just memory or prompts.
3. Add explicit cross-links for users asking: "I want Squad, but I cannot commit `.squad/` into this repo."
4. Avoid framing Rally as required for normal Squad adoption.

**Suggested Doc Action:** Add a short README/FAQ comparison with scenarios:
- **Use Squad directly** when your project can adopt team files and wants the workflow in-repo.
- **Use Rally with Squad** when you want Squad's team memory and roles, but need worktree-driven, externalized state for shared or third-party repositories.

---

## 2026-05-18: Directives from Multi-Squad Design Phase

### User directive — Identity reset (Aaron, not Brady)

**By:** Aaron (via Copilot)
**Date:** 2026-05-17
**What:** For the purposes of this proposal and all multi-squad design work, the user/requester is **Aaron**. Brady owns the upstream Squad project (`bradygaster/squad`). All future spawn prompts, log entries, and decision records should reference Aaron as the requester and Brady as the upstream maintainer. Existing prior records that name Brady as requester remain accurate for their date — do not retroactively rewrite history.
**Why:** User request — clarifies relationship between the org-side proposal author (Aaron) and the upstream maintainer (Brady) for any future contribution conversations.

---

### User directive — Self-contained documents

**By:** Aaron (via Copilot)
**Date:** 2026-05-17
**What:** Proposal documents and downstream artifacts MUST be entirely self-contained and standalone. Do NOT reference earlier versions, the design / review process, internal version numbers ("v1.1", "v1.2"), or framing like "third path" / "Round N" / "in the prior version we…". The only exceptions are when narrating evolution adds clear value to the reader (e.g., a deliberate "Alternatives Considered" section if it teaches something). Default: write as if the reader is a stakeholder seeing this for the first time and has no context on how we got here.
**Why:** User request — proposals are for new readers, not artifacts of the design conversation. The decision trail belongs in our internal archive (`.squad/decisions/multisquad-design/`), not in the proposal body.

---

### User directive — Zero-impact P0 + default behavior is out-of-the-box, not "personal-only"

**By:** Aaron (via Copilot)
**Date:** 2026-05-17
**What:**

1. **New P0 (must-have):** Zero impact to existing users of squad-sdk and squad-cli or their default workflows. Basic squad-cli usage for a single-squad / single-repo project MUST continue to work, as-is, out-of-the-box. The multi-squad work is **additive**, never a default-changing migration.

2. **Default behavior is the existing "out-of-the-box" experience.** When a developer is not opted into the organizational features, Squad behaves exactly as it does today. The concept of "personal-only mode" is NOT the default and MUST NOT be forced or flagrantly surfaced. If a single-squad user never knew "personal-only" existed, that's correct — they didn't need to.

3. The "personal-only" UX, where it exists, is reserved for situations where a developer is *also* exposed to organizational squads and needs to opt out for a given workspace. It is not the canonical day-1 experience.

4. **Carefully think through interaction between organizational functionality and the default/classic/legacy squad behavior.** Anything that changes single-squad UX, prompts the user with new questions, adds new files to a fresh `squad init`, or alters existing CLI semantics is a violation of this P0 unless explicitly approved.

**Why:** User request — preserves user trust and respects the existing audience. Aaron explicitly called out that "personal-only" had bled into the default story in the prior draft, which is a design smell to fix.

---

### User directive — Rally exclusion unless unique value

**By:** Aaron (via Copilot)
**Date:** 2026-05-17
**What:** Rally was fed into this design process as a source of inspiration and ideas (worktree mechanics, `~/rally/` central store pattern, dispatch UX). It was NOT meant to be a required component of the user story. If Rally does not add UNIQUE value to the proposal's user story or technical contract, do NOT mention it in the proposal at all. Internal references in the decision archive are fine; the public-facing proposal should focus on Squad's own surfaces (SDK, squad-cli, and any new tooling we explicitly propose).
**Why:** User request — keeps the proposal scoped to what we're actually building and avoids confusing readers with peripheral projects that don't drive the design.

---

### User directive — P1: Minimize squad-cli semantic changes

**By:** Aaron (via Copilot)
**Date:** 2026-05-17
**What:** New P1 goal: modify `squad-cli` semantics as little as possible. Where new multi-squad functionality requires CLI surface, prefer **additive** new commands or flags over altering the meaning of existing commands. Where an existing command's behavior must change, prefer behavior that is **gated** on opt-in (e.g., presence of org config) so single-squad users see no change. This P1 sits alongside the existing P1s ("minimize custom code", "contribute upstream") and is consistent with the new P0 of zero-impact to existing users.
**Why:** User request — preserves muscle memory and existing workflows for current users; lowers cost of upstream contribution by reducing the surface area of breaking changes.

---

### User directive — Chain-of-command is host/org policy, not SDK rule

**By:** Aaron (via Copilot)
**Date:** 2026-05-17
**What:** When multiple squads are simultaneously active (collaboration), the SDK MUST NOT bake in a fixed answer to "who wins" non-safety, non-policy disagreements (e.g., tactical/local-implementation calls). That answer is situational — it depends on the nature of the decision, the nature of the involved squads/agents, and organizational/team norms. The SDK's job is to provide:

1. A **mechanism** for declaring relationships between active squads (which squad is broader, which is narrower, which is advisory, etc.).
2. A **seam** where host implementations and organizational policy can plug in to declare/resolve specific kinds of disagreements (e.g., "in this org, the broader squad's Lead may direct execution on architectural calls; the closer squad's Lead has final say on tactical calls").

Safety- and policy-level constraints (compliance, security, enterprise-mandated behaviors) MAY still be modeled as broader-squad-constrains-narrower at the SDK level if a clean primitive exists. Beyond that, the SDK stays out of it.

**Why:** User request — extends the existing layering principle. Trying to embed a universal chain-of-command would force one org's culture into all orgs and ignore the situational nature of inter-team collaboration. Aaron explicitly accepted the complexity tradeoff: SDK stays simple; org/host policy carries the situational nuance declaratively.

---

## 2026-05-18: Multi-Squad Management — Authoritative Proposal Landed

**By:** Aaron (with the full team — Flight, Procedures, EECOM, RETRO, Network, PAO, Rubber-duck)

**What:** Adopted the multi-squad management proposal as the authoritative design artifact. Key design choices:
- **Collaboration model (not fallback):** Broader squads constrain, closer squads execute, personal squads are advisory; user is the final escalation link.
- **Vocabulary:** `call-sign` (identifier string only), `squad` (the thing with personas/charters/history), `assign` (write the workspace ↔ squad relationship), `muster` (load assigned squads into a session at start), `report in` (what a squad does once mustered), `active roster` (the simultaneously-active squads).
- **Personal squads:** Ambient attach via manifest-declared scope, with assignment ledger as explicit override; multiple personal squads supported (Phase 2 for full overlap diagnostics).
- **Zero-impact P0:** Single-squad classic squad-cli UX is unchanged out-of-the-box.
- **Layering:** SDK provides mechanism; organizational policy lives on top of Squad.
- **Drift/re-entry:** Downscoped to a thin SDK comparison primitive only, not a headline feature.
- **No hard dependency on third-party tooling.**

**Authoritative artifact:** `.squad/decisions/multisquad-design/flight-multisquad-proposal.md`

**Working artifacts archive:** `.squad/decisions/multisquad-design/` — contains the full design trail (design rounds, gap analysis, strategy proposals, reuse audits, day-in-life scenarios).

**Directives from this cycle:** 6 user directives (identity, self-contained docs, zero-impact P0, rally exclusion, CLI semantic stability, chain-of-command layering) merged into decisions.md above.

**Status:** Proposal — approved by Aaron. Ready for implementation phase.

**Why:** Replaces all prior multi-squad design artifacts as the canonical reference. The older `flight-multisquad-proposal-and-spec-v1.0/1.1/1.2.md` files remain in the archive for historical context but are not authoritative.

