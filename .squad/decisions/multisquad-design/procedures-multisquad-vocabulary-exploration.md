### Procedures — Multi-Squad Vocabulary Exploration

**Date:** 2026-05-17T22:41:30-07:00  
**Requested by:** Aaron  
**Author:** Procedures

This note explores candidate vocabularies for the multi-squad design. It is self-contained: every term used in the candidate sets is defined in the tables below before it is relied on in the prose. The goal is not merely to rename technical objects, but to choose language that fits Squad’s existing Mission Control / casting identity, stays teachable, and preserves Aaron’s zero-impact directive: a single-squad user should be able to keep using Squad exactly as they do today without learning multi-squad terminology.

## Concepts that need names

The vocabulary work covers nine concepts:

1. the persistent identity of a squad as a distributable thing
2. the relationship between a workspace and a squad
3. the act of establishing that relationship
4. the place where workspace ↔ squad relationships are recorded
5. the act of making a squad’s content available to a session
6. the per-machine store for caches, records, and bookkeeping
7. the situation where multiple squads are simultaneously active in a session
8. the kind of squad (org / team / personal)
9. the engineering-side person using the system

## Evaluation criteria

I evaluated each vocabulary against five constraints:

- **Fit with Squad’s voice.** Does it sound like Squad, not like a generic configuration system?
- **Precision.** Can the terms carry technical meaning without becoming vague or cute to the point of confusion?
- **Teachability.** Can a new reader understand the model quickly from the terms alone?
- **Extensibility.** Will the language still work if we later add richer collaboration or precedence rules?
- **Zero-impact default.** Can the vocabulary stay largely invisible to single-squad users?

---

## Candidate A — Technical / current vocabulary

This is the control case: keep most of the existing implementation-shaped words.

| # | Concept | Term in this vocabulary | Definition | One-line example |
|---|---|---|---|---|
| 1 | Persistent squad identity | **squad manifest** | The distributable definition of a squad and its `.squad/` content. | “The `foo-team` squad manifest defines the Foo team’s members, charters, and defaults.” |
| 2 | Workspace ↔ squad relationship | **binding** | A recorded association between a workspace and a squad manifest. | “This clone has a binding to the Foo team squad.” |
| 3 | Act of establishing relationship | **bind** | To create or apply a binding between a workspace and a squad manifest. | “Run `squad bind foo-team` in this workspace.” |
| 4 | Place relationship is recorded | **binding record** | The file or record where a binding is stored. | “The binding record can live in-repo or in the host-local store.” |
| 5 | Make squad available to session | **materialize** | To resolve a squad manifest into concrete content available to the current session. | “At session start, Squad materializes the bound manifests.” |
| 6 | Per-machine store | **backend** | The machine-local state root for caches, records, and bookkeeping. | “The backend keeps cached manifests and binding records.” |
| 7 | Multiple squads active together | **stack** | The ordered set of squads active in one session. | “Today’s session stack includes org, team, and personal squads.” |
| 8 | Kind of squad | **scope** | The publication scope of the squad: org, team, or personal. | “This manifest has team scope.” |
| 9 | Engineering-side person | **user** | The person operating Squad in a workspace. | “The user can override the default binding for this repo.” |

**Example prose:** Casey binds the `foo-team` squad manifest to her clone. Squad writes a binding record, looks up the record during resolution, materializes the manifest into the session, and merges it into the active stack with any org- or personal-scope manifests already in effect.

**Strengths**
- Precise and implementation-friendly; engineers immediately understand what the terms mean.
- Maps closely to the current design discussion, so it minimizes translation effort.
- Easy to document against actual files and runtime behavior.
- Scales well if the system grows more complex, because the terms are generic.

**Weaknesses**
- The vocabulary sounds like infrastructure plumbing, not like Squad.
- Several words are cold or overloaded: “manifest,” “backend,” “materialize,” and “stack” bring heavy systems connotations.
- “Binding” and “resolution” are accurate but emotionally flat; they do not build a memorable mental model.
- It violates Aaron’s instinct in spirit even if it is technically workable; it feels deliberate only if we explicitly want the design to sound like middleware.

---

## Candidate B — Squad-native / Mission Control vocabulary

This candidate leans into Squad’s existing voice: teams, casting, charters, ledgers, rosters, and mission-style coordination. It keeps the model human-readable without abandoning precision.

| # | Concept | Term in this vocabulary | Definition | One-line example |
|---|---|---|---|---|
| 1 | Persistent squad identity | **call-sign** | The stable published identity of a squad that can be assigned to workspaces. | “The Foo team publishes the `foo-team` call-sign.” |
| 2 | Workspace ↔ squad relationship | **assignment** | The recorded fact that a workspace uses a particular squad call-sign. | “This clone has an assignment to `foo-team`.” |
| 3 | Act of establishing relationship | **assign** | To connect a workspace to a squad call-sign. | “Casey assigns `foo-team` to her clone.” |
| 4 | Place relationship is recorded | **assignment ledger** | The place where workspace-to-squad assignments are recorded. | “The assignment ledger may be local to the repo or local to the machine.” |
| 5 | Make squad available to session | **report in** | To load a squad’s content into the session so it participates in the current run. | “When the session starts, the assigned squads report in.” |
| 6 | Per-machine store | **squad home** | The machine-local Squad directory that holds caches, ledgers, and bookkeeping. | “Squad home keeps cached call-signs and local assignment ledgers.” |
| 7 | Multiple squads active together | **active roster** | The set of squads simultaneously active in a session. | “The active roster includes Casey’s personal squad plus her team and org squads.” |
| 8 | Kind of squad | **lane** | The publication lane of a squad: org lane, team lane, or personal lane. | “`foo-team` is published in the team lane.” |
| 9 | Engineering-side person | **operator** | The person using Squad from a workspace. | “The operator can assign a different call-sign for this repo.” |

**Example prose:** Casey assigns the Foo team’s `foo-team` call-sign to her clone. Squad records that assignment in the assignment ledger, then on session start the assigned squads report in from squad home and form the active roster. If Casey also has a personal squad and her org publishes one, the roster can include all three without changing how a single-squad workspace behaves.

**Strengths**
- Feels native to Squad’s existing Mission Control personality rather than imported from generic systems design.
- “Call-sign” and “assign” are memorable, concrete, and already validated by prior discussion.
- “Active roster” is more human and more legible than “stack,” especially for collaboration-oriented explanations.
- The terms can mostly stay off the happy path for single-squad users; they surface when multi-squad behavior is actually in play.

**Weaknesses**
- A few terms are slightly softer than their technical equivalents; “report in” is evocative but less implementation-shaped than “materialize.”
- “Lane” is serviceable, but weaker than “call-sign” and “assign”; it may need explanation the first time it appears.
- “Operator” is a bit formal and may read as more tooling-centric than “developer” in some docs.
- Some readers may hear “active roster” as unordered even if the system preserves precedence; that ordering must still be defined explicitly.

---

## Candidate C — Law-enforcement / task-force vocabulary

This candidate extends Aaron’s FBI / State / Local mental model. It gives a clean story for collaboration, jurisdiction, and combined participation, but it risks pulling Squad into a second metaphor family.

| # | Concept | Term in this vocabulary | Definition | One-line example |
|---|---|---|---|---|
| 1 | Persistent squad identity | **unit** | The published squad identity treated as a standing unit. | “The Foo team publishes a unit called `foo-team`.” |
| 2 | Workspace ↔ squad relationship | **jurisdiction** | The relationship stating which unit has standing in a workspace. | “This repo is under the jurisdiction of the Foo team unit.” |
| 3 | Act of establishing relationship | **deputize** | To grant a unit standing in a workspace. | “Casey deputizes `foo-team` for this clone.” |
| 4 | Place relationship is recorded | **case file** | The place where jurisdiction records are kept. | “The case file records which units have standing here.” |
| 5 | Make squad available to session | **activate** | To bring a unit into the live working session. | “At startup, Squad activates the units assigned to this case.” |
| 6 | Per-machine store | **precinct** | The machine-local store for cached units and case files. | “Her precinct holds local case files and cached unit data.” |
| 7 | Multiple squads active together | **task force** | Multiple units working the same session together. | “The session runs as a task force of org, team, and personal units.” |
| 8 | Kind of squad | **jurisdiction level** | The publication level: federal, state, or local. | “Her personal unit is local; the org unit is federal.” |
| 9 | Engineering-side person | **case lead** | The engineer operating Squad for a workspace. | “The case lead can deputize a different unit for a one-off repo.” |

**Example prose:** Casey, acting as case lead, deputizes the Foo team unit for her clone. Squad records that decision in the case file, activates the unit at session start, and, when needed, forms a task force that combines federal, state, and local units working the same case.

**Strengths**
- Gives a vivid collaboration story, especially for simultaneous multi-squad participation.
- “Task force” is a strong, intuitive replacement for “stack” or “layering.”
- Jurisdiction language makes authority and source distinctions easy to explain.
- The model fits Aaron’s stated mental picture for some collaboration scenarios.

**Weaknesses**
- It collides with Squad’s existing Mission Control / casting aesthetic; the product suddenly sounds like a different universe.
- Terms like “deputize,” “jurisdiction,” and “precinct” are more metaphorical than operational and may feel theatrical in CLI/docs text.
- Federal/state/local is not a clean fit for org/team/personal; “team” is not really “state.”
- The law-enforcement frame is culturally narrower and carries more baggage than the Mission Control frame.

---

## Recommendation — Use a Squad-native primary vocabulary

I recommend a **Squad-native primary vocabulary**, with a disciplined hybrid that stays inside the Mission Control / team-casting world:

- persistent squad identity → **call-sign**
- workspace ↔ squad relationship → **assignment**
- act of establishing relationship → **assign**
- place relationship is recorded → **assignment ledger**
- act of making squad available → **report in**
- per-machine store → **squad home**
- multiple squads active together → **active roster**
- kind of squad → **org / team / personal** (keep these plain)
- engineering-side person → **developer** in user-facing docs, **operator** only where system behavior specifically matters

This recommendation is intentionally hybrid in only one narrow sense: it keeps the plain existing kind labels **org / team / personal** rather than forcing a reskin for concept #8. Those words are already understandable, low-drama, and aligned with the zero-impact directive. Everything else stays coherent because it still lives inside the same Squad-native frame: named squads have call-signs, workspaces assign them, ledgers record that, squads report in, and a session ends up with an active roster.

### Why this is the best fit

First, it matches the product we already have. Squad is not a generic policy engine; it is a humanized, character-forward system with charters, routing, ledgers, history, casting, and a coordinator that spawns named specialists. “Call-sign,” “assign,” and “active roster” sound like they belong in that world. “Binding,” “materialization,” and “stack” do not.

Second, the recommended set is strong exactly where it matters most: on the concepts users are likeliest to see or speak aloud. If the CLI eventually exposes commands or explanations, “assign `foo-team`” is friendlier and more memorable than “bind `foo-team`.” Likewise, “call-sign” gives the distributable squad identity a durable label that feels specific rather than generic. And “active roster” is better prose than “stack” when explaining that multiple squads can be active together in one session.

Third, the hybrid keeps discipline. I do **not** recommend re-skinning every noun just because we can. The kind labels “org,” “team,” and “personal” are already clear, low-cost, and unlikely to burden single-squad users. Replacing them with something more decorative would add novelty without adding understanding. The right move is to stylize the genuinely new multi-squad concepts while leaving already-good generic terms alone.

Fourth, this vocabulary respects the self-contained-docs directive. Each term can be defined in-line the first time it appears, without needing a glossary appendix or back-reference to design history. The reader can learn the system from the proposal itself: a squad has a call-sign; a workspace can be assigned one; assignments live in an assignment ledger; assigned squads report in; the session sees an active roster.

Fifth, it satisfies the zero-impact directive better than the alternatives. A single-squad user does not need to learn “active roster,” “assignment ledger,” or “squad home” to keep using Squad as they do today. Those concepts matter only when the user opts into multi-squad behavior, debugging, or administrative setup.

## Single-squad compatibility and multi-squad-only terms

**Yes — this vocabulary works for a single-squad user who never engages multi-squad.** The default experience can remain exactly what it is today. A single-squad user can continue to think in the existing, simpler language: “my project has a Squad team in `.squad/`; I run Squad here.” They do not need to learn the new terms unless they opt into published shared squads, workspace-specific selection, or simultaneous multi-squad participation.

The terms that should be treated as **multi-squad-only** are:

- **call-sign**
- **assignment** / **assign**
- **assignment ledger**
- **active roster**
- **report in** (when describing multiple assigned squads entering a session)
- **squad home** (mostly admin / implementation-facing)

The terms that can remain ordinary and need no special rebranding for single-squad flows are:

- **org / team / personal**
- **developer**
- **workspace / repo / clone / project**

## Final naming guidance

If we adopt this recommendation, we should be consistent and avoid half-mixing vocabularies in the same surface. In particular:

- Prefer **call-sign** over manifest/profile/package when referring to a published squad identity.
- Prefer **assign** / **assignment** over bind / binding.
- Prefer **active roster** over stack / layering in explanatory prose.
- Keep **org / team / personal** as plain classifiers, not themed replacements.
- Use **developer** in broad user-facing prose; reserve **operator** for narrow system/administrative descriptions if needed.

That gives Squad a vocabulary that feels deliberate, native, and memorable without turning the design into a wall of cute synonyms. It also preserves a clean line between the classic single-squad experience and the additive multi-squad story.
