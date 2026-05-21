# Decisions

> Team decisions that all agents must respect. Managed by Scribe.

---

## 2026-05-20: Multi-Squad Proposal Landing

**By:** Aaron (with Flight, full team)
**Date:** 2026-05-20
**Status:** LANDED

Multi-squad management proposal approved and landed as authoritative design artifact. Flight led proposal refinement through multiple iterations with Aaron, Flight 10-13. Final document: `.squad/decisions/multisquad-design/flight-multisquad-proposal.md`.

**Key adoptions:**
- Call-sign vs squad terminology discipline (call-sign = identifier only; squad = conceptual unit)
- User story anchored to realistic repos (Contoso mono-repo, Project Z repo, personal dotfiles)
- Human-in-the-loop as final tiebreaker in chain-of-command
- Multi-squad workspace model (org squad, project squad, personal squad)
- Vocabulary: muster (load), report in (squad activation), active roster (simultaneously-active squads)

**Open questions deferred:**
- Better verb than "deploy" for loading assigned squad into workspace
- Default personal squad UX (should multiple personal squads be discoverable from day 1?)

**Rationale:** Closes multi-squad design phase. Ready for implementation phase planning.

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

---

## 2026-05-21: Transparent Artifact/Dotfile Management — P0 Elevation

**Author:** Flight  
**Date:** 2026-05-21  
**Status:** Landed — integrated into authoritative proposal  
**Target:** `.squad/decisions/multisquad-design/flight-multisquad-proposal-and-spec.md`

### The Requirement

Squad's mutable state — decisions, agent histories, session logs, orchestration records, inbox files — MUST NOT appear in developer pull requests in organizational settings. Developers must not pay a git/repo tax (manual file separation, separate PR workflows, branch-policy negotiation) to use Squad in organizations with PR review and branch protection. The SDK/agents and any organization layer are responsible for keeping state invisible; the developer should be unaware this problem even exists.

This is a **P0 requirement** for any org-scale Squad deployment. It was missing from the initial multi-squad proposal and has been elevated now.

Crucially, this does not change Squad's default behavior. The `worktree` backend remains the out-of-the-box default for solo developers and personal projects. The P0 is a capability for org use, not a forced migration.

### The Mechanism (Already Exists)

Squad's `stateBackend` field in `.squad/config.json` already supports the backends that solve this:

- **`orphan`** — mutable state lives on a dedicated `squad-state` orphan branch; the working branch is completely clean.
- **`two-layer`** — static config (charters, team.md, routing.md) stays on the working branch; mutable state goes to the orphan branch.
- **`git-notes`** — state stored in `refs/notes/squad`; branch-invisible.

For org use, `orphan` or `two-layer` should be the registered default. The org's tool layer sets this when registering a new squad. Individual developers never touch the setting.

### The Three File Classes

| Class | Examples | Should appear in PR diffs? |
|---|---|---|
| Working product changes | Feature code, tests, build config | Yes — normal peer review |
| Squad static config | `charters/`, `team.md`, `routing.md`, `ceremonies.md` | Yes — intentional reviewable artifacts |
| Squad mutable state | `decisions.md`, `agents/*/history.md`, `log/*`, `orchestration-log/*`, `decisions/inbox/*` | **No** — owned by Squad infrastructure |

### Ownership

| Owner | Responsibility |
|---|---|
| SDK | `stateBackend` abstraction and backend implementations |
| `squad-cli` | Reads `stateBackend` from config and plumbs it to the runtime |
| Scribe | Executes orphan-branch commit/push transparently |
| Org tool layer | Sets org default (`"stateBackend": "orphan"`) at squad registration time |
| Developer | Unaware — this is the success condition |

### Proposal Artifacts Updated

- Section 4 (Goals) — converted to requirements summary table; new P0 row added
- Section 4a (new) — "How transparent state isolation works": three file classes, backend comparison, before/after diff, ownership table
- Section 26 (Glossary) — added: State backend, Transparent state isolation, Orphan-branch backend
- Section 27 (Appendix A) — added cross-reference note: Casey narratives depend on this P0; PAO refreshing in parallel
- Section 29 (Appendix C) — added three new vocabulary terms

---

## 2026-05-21: State Isolation Audit — Transparent State Backend Verification

**Audit Lead:** EECOM  
**Date:** 2026-05-21  
**Scope:** Verify that existing state-backend work (`worktree`/`orphan`/`git-notes`/`two-layer`) truly solves P0: "Squad's mutable state must NOT pollute developer PRs transparently."

### Summary

Orphan and two-layer backends are **genuinely git-native** and **don't pollute PRs** if used correctly. No temporary branches, no working-tree cruft. The architecture is sound. However, the **transparency claim is currently overstated** because developers must explicitly opt in and infrastructure work (state leak guards, hook bootstrap automation, CI recipes) is incomplete.

### What's Fully Working ✅
- State backend configuration plumbing (config.json → resolveStateBackend → runtime)
- Orphan branch backend (git-native, working-tree-clean, fully tested)
- Two-layer backend (orphan + notes, designed for team use)
- Git hooks for orphan branch sync (pre-push, post-merge, post-checkout, post-rewrite)
- Migration command (local → orphan/two-layer)

### Critical Gaps 🔴
1. **State Leak Guard** — Pre-commit validation missing; if code bypasses backend abstraction and writes directly to `.squad/decisions.md` on working tree when backend is `orphan`/`two-layer`, the file will be committed despite being meant for orphan branch.
2. **Hook Bootstrap Automation** — No automatic installation on new clone; CI runners need manual setup; new developers must run `squad upgrade --state-backend orphan` manually.
3. **Stale On-Disk State After Migration** — `squad upgrade --state-backend orphan` creates orphan branch but leaves old `.squad/` files on disk; developers and reviewers see stale files until manually cleaned up.

### Top Priorities for Full P0 Delivery

**MUST-HAVE (blocking P0 claim):**
1. State Leak Guard: Scribe or git hook pre-commit validation that rejects `.squad/decisions.md` and `.squad/agents/*/history.md` when backend is `orphan`/`two-layer`
2. Hook Bootstrap: Automatic installation of git hooks on `squad init` or first `squad` command

**SHOULD-HAVE (high-impact):**
3. Post-Migration Cleanup: `squad upgrade --state-backend orphan --cleanup` option
4. CI Recipe: Documented GitHub Actions example showing `squad sync --push`

### Recommended Defaults

- **Single-repo single-dev** (`squad init`): Keep `local` (current behavior) — zero-impact P0
- **Org tool / shared squad consumer**: Flip default to `orphan` when registering
- **CI/Host runners**: Explicit opt-in required; provide well-documented recipe

### Takeaway

The state backend framework is **95% implemented and architecturally sound**. The last 5% is ecosystem support (guards, bootstrap automation, CI integration). Prioritize the ecosystem work if P0 is "state isolation must be transparent and unavoidable to developers."
