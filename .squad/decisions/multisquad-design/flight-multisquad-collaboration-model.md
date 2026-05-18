### Flight — Multi-Squad Collaboration Model (replacing the fallback frame)

**Date:** 2026-05-17T22:41:30-07:00  
**Author:** Flight  
**Requester:** Aaron  
**Context:** This document replaces the layered-fallback frame with a collaboration model for sessions where two or more squads are simultaneously active.

Multiple active squads should be modeled as a single session with a larger, provenance-aware cast, not as a stack where one squad speaks and the rest disappear. The FBI / State Police / Local Police analogy is useful only if translated into software semantics: broader squads set constraints and bring specialized agents; closer squads own the local case file, day-to-day execution, and session-local state. In other words, collaboration is real, authority is structured, and state ownership stays explicit.

The goal is not to make every squad equal, and it is not to silently merge all behavior. The goal is to let several squads participate in one session without losing answerability about three things: who is in the room, who gets to decide, and where the resulting state is written. The model below keeps those answers explicit while preserving today’s single-squad behavior unchanged when only one squad is active.

## 1. The collaboration model

### Simultaneously active squads

A session may be associated with one or more active squads. An active squad is a squad whose agents, guidance, and state roots are admitted into the session contract for the current working directory. In the collaboration model, those squads are present at the same time. They do not shadow one another out of existence. They contribute members to the session cast, but they do not contribute the same kind of authority.

The law-enforcement analogy maps cleanly here:

- A broader squad is like a broader jurisdiction: it can bring policy, mandatory procedure, and specialized expertise.
- A closer squad is like the local case owner: it handles the concrete repo, files, backlog, and execution details.
- A personal squad is like a trusted private advisor: useful, sometimes very useful, but not the agency of record when shared project work is underway.

That means a multi-squad session is not “one real squad plus optional fallbacks.” It is one working session with multiple participating squads, each carrying a declared relationship to the work: owning, constraining, or advisory.

### Roster composition

The effective agent roster is the union of all members from all active squads, plus the session’s coordinator behavior. Every member keeps its squad provenance. Internally, identity is therefore the pair `(squad, agent)` rather than bare agent name. That is the only safe way to support real collaboration once several squads are active.

Human-facing rules should remain simple:

1. **Unique short names stay short.** If only one active agent is named Flight, “Flight” still means Flight.
2. **Colliding names stay distinct.** If two active squads both have a Lead named Flight, the session must retain both as separate members, not collapse them. The host may display disambiguated labels such as “org/Flight” and “project/Flight,” but the underlying rule is provenance, not renaming.
3. **Hidden collisions are not allowed.** If two active agents share the same name or role in a way that changes routing, the host must mark the ambiguity instead of silently choosing one.
4. **Visibility is provenance-aware.** The coordinator can see the full union roster. User-facing surfaces may collapse the roster when there is no ambiguity, but once ambiguity exists the host must show enough provenance for the user to understand who is responding.

This gives the right behavior in the common case and the safe behavior in the hard case. A single visible “Lead” is fine when there is only one. It is not fine when the session actually contains three Leads with different jurisdictions.

### Routing

Routing should follow **execution jurisdiction first, then authority checks, then ambiguity handling**.

When a user directly addresses an agent by unique name, routing is straightforward: that exact agent responds. When a user addresses by role (“Lead, do X”), the host should not simply choose the highest-tier squad. Instead, it should ask which active squad owns execution for the requested work.

The default routing rule should be:

1. Identify the squad that owns execution for the target workspace or change surface.
2. If that squad has a matching role, route there first.
3. Before execution proceeds, apply any constraining rules from broader active squads.
4. If multiple matching agents remain after jurisdiction filtering, surface ambiguity rather than guessing.

Concretely:

- In a repo-local implementation task, the project or nearest bound squad’s Lead answers first, because that squad owns the work.
- In a team-wide convention dispute, the team squad’s Lead answers first.
- In an org policy or compliance question, the org squad’s Lead answers first.
- A personal Lead may answer only as an advisor unless the session is explicitly personal-only.

This is the important correction to the fallback model. The user saying “Lead” does not mean “highest ranking person in any active squad.” It means “the Lead for the work I am asking about.” Broader squads participate through constraints, review, or escalation, not by hijacking every addressable role.

### Jurisdiction

Jurisdiction answers the question: *what kinds of decisions and actions belong to which squad?*

The cleanest model is to divide authority by the kind of thing being decided.

**Broader squads own constraints and standing rules for their scope.** Examples:
- organization-wide policy
- compliance requirements
- mandatory review or logging rules
- approved tool boundaries
- shared enterprise defaults

**Closer squads own local execution and local product choices within that envelope.** Examples:
- repository implementation details
- project-specific agent charters and skills
- local backlog prioritization
- refactor shape inside the repo
- repo-local logs and day-to-day operating history

**Team squads sit between those layers where they exist.** They are the right home for decisions that are broader than a single repo but narrower than the organization: team conventions, shared code ownership, common review expectations, or area-specific playbooks.

**Personal squads remain advisory in shared project contexts.** They can provide preferences, memory, review heuristics, and specialized analysis, but they do not become the owner of shared project files or shared squad state merely because they are present.

This creates a useful split:

- broad squads constrain
- local squads execute
- personal squads advise

### Chain of command

The collaboration model needs a decisive answer for disagreements. The correct rule is **not** “higher tier always wins everything.” That is too blunt and would turn local squads into clerks. The correct rule is a two-part chain of command:

1. **Constraint authority flows outward-to-inward.** A broader squad may impose constraints that a narrower squad cannot relax.
2. **Execution authority flows inward-to-outward.** The closest squad with ownership of the target workspace decides how to do the work inside those constraints.

This yields predictable conflict resolution:

- If an org squad forbids an action, the project squad cannot override that.
- If an org squad requires an approval step, the project squad must comply.
- If the work is otherwise allowed, the project squad chooses the implementation.
- If the change spans multiple sibling squads or multiple owned workspaces, the issue escalates to the nearest squad whose scope actually covers the combined change.
- If a personal squad disagrees with a project or team squad, the personal squad records advice; it does not override the owning squad.

Using the analogy: the FBI can prevent the local department from violating federal constraints, but it does not automatically tell the local department which variable name to use. The local department still runs the case unless the case has genuinely moved into broader jurisdiction.

That is the richer model Aaron is asking for. Authority is not a single global ranking. It is a structured split between **what may be done** and **who gets to do the local work**.

### Personal squad relationship

The existing Ghost Protocol pattern generalizes well, but only if kept explicit.

A personal squad should remain **advisory by default whenever any non-personal squad is active**. That preserves the current trust model: personal agents can help, review, and recommend, but they do not silently become owners of shared repo state. In a multi-squad session, the personal squad is simply one more participating squad with a special relation: advisory, read-mostly, and non-owning.

This means the relationship among active squads is not purely “higher tier is always more authoritative than lower tier.” Instead:

- org/team/project squads can each be authoritative within their jurisdiction
- broader squads can constrain narrower squads
- narrower squads own local execution
- personal squads advise across those layers without displacing them

That is richer than the fallback model and richer than a single strict hierarchy. It preserves the practical value of personal memory without letting personal state quietly outrank shared project governance.

## 2. State maintenance

The state model matters because collaboration is only real if the session can remember what happened without corrupting ownership boundaries.

### Scribes

There should be **one session Scribe**, not one concurrently writing Scribe per active squad.

The reason is straightforward: there is one session, one orchestration timeline, and one need for write serialization. Running several Scribes against the same batch would multiply coordination complexity, duplicate logs, and re-create the very race and ownership problems Scribe exists to prevent.

The session Scribe is a session role, not a squad-election contest. If several active squads define a Scribe member, the host resolves one Scribe implementation for the session and gives it the collaboration contract. In practice, the safest rule is: the Scribe attached to the session’s owning write root runs, while broader/advisory squads contribute routing constraints, not competing Scribe processes.

So the answer to Aaron’s question is: **one Scribe per session, but that Scribe may write to more than one squad-owned state location when the collaboration contract requires it.**

### decisions.md writes

There should be **no single shared cross-squad `decisions.md` file**. Each squad keeps its own `decisions.md`, because each squad still owns its own durable guidance.

The write rule should be **one canonical home per decision, chosen by jurisdiction**:

- A repo-local execution decision lands in the closest owning squad’s `decisions.md`.
- A team-wide operating decision lands in the team squad’s `decisions.md`.
- An org-wide policy decision lands in the org squad’s `decisions.md`.
- A personal preference or reusable personal heuristic lands in the personal squad’s `decisions.md`, not in the project’s.

When a session produces an outcome that affects several squads, Scribe should not spray the same decision into every `decisions.md` by default. Instead:

- write the canonical decision once, in the squad that owns it
- propagate cross-squad awareness through history updates and session logs
- write separate decisions only when distinct squads genuinely own distinct durable outcomes

Example: if an org rule blocks a repo action, the policy decision belongs in the org squad’s `decisions.md`; the project squad gets a history/update breadcrumb explaining that the session was constrained by org policy. By contrast, if the session both establishes a new team review rule and a separate project implementation convention, those are two durable decisions and should be written to two different squad `decisions.md` files.

That keeps decisions authoritative, local, and non-duplicative.

### History writes

`history.md` remains per-agent, but Scribe’s existing cross-agent update rule must generalize across squad boundaries.

When a team update crosses squads, Scribe should append the update to every affected agent’s `history.md` in that agent’s own squad root. The write itself is local to the agent’s home squad; the content records the cross-squad collaboration.

Each propagated history update should include:

- the session timestamp
- the participating squads
- the canonical decision or session-log reference when one exists
- a short explanation of why that agent was affected

This preserves the existing “knowledge is personal” rule while allowing collaboration to leave a trace in every relevant agent history. The org Lead can remember that a repo session triggered a policy escalation. The project Lead can remember that org policy constrained a local design choice. Neither requires a shared merged history file.

### Logs

Session logs and orchestration logs should be **shared per session, not per squad**.

A session is one collaboration event. Its orchestration record should therefore live in one place, with provenance inside the entries indicating which squad each agent came from. The correct home for those shared logs is the session’s owning write root: normally the closest squad that owns the workspace where the session is acting.

That gives the cleanest operational behavior:

- one session log for what happened
- one orchestration trail for who participated
- provenance tags inside the log entries for cross-squad visibility
- no duplicated per-squad log trees unless a host explicitly chooses to export them elsewhere

Mirroring or forwarding logs to broader systems may be useful for some organizations, but that is an org-tool concern, not a baseline Squad rule.

## 3. Single-squad invariance

The zero-impact requirement is strict: if exactly one squad is active, the collaboration model must collapse to today’s behavior without visible change.

That invariance condition is:

- effective roster = the current single squad roster
- routing = current name/role routing behavior
- Scribe = one Scribe writing to one squad root
- `decisions.md` = one canonical decisions file
- `history.md` propagation = current same-squad behavior
- session logs and orchestration logs = current single-root behavior
- no provenance labels shown unless explicitly requested by a host
- no new prompts, questions, or opt-out surfaces in the default single-squad path

Internally, the host may represent the session as a one-element active-squad set. Externally, the user should not notice. There is still one `TEAM_ROOT`-style experience, one visible Lead, one Scribe, and one place where state lands.

Any mechanism introduced for multi-squad collaboration must therefore be dormant when the active set size is one. In particular:

- **name-collision handling** should never appear in a single-squad session
- **provenance prefixes** should not clutter ordinary single-squad responses
- **state routing logic** should resolve to the existing single target without fan-out
- **CLI behavior** should remain additive and opt-in; existing commands keep their current semantics unless multi-squad config is actually present

If a proposed collaboration mechanism cannot disappear cleanly in the one-squad case, it violates the zero-impact requirement and should be rejected or reworked.

## 4. The minimum SDK seam for collaboration

The SDK should expose the smallest host-neutral mechanism set needed to support multi-squad collaboration. It should not encode organization-specific policy, staffing rules, enterprise rollout flows, or opinionated hierarchy meanings. Its job is to describe *which squads are active, which agents they contribute, how ambiguity is detected, and where state could be written*.

A minimal surface looks like this:

```ts
export type SquadRelation = 'owner' | 'constraining' | 'advisory';

export interface ActiveSquad {
  id: string;
  root: string;
  relation: SquadRelation;
  precedence: number;
}

export interface SessionMember {
  name: string;
  role: string;
  squadId: string;
  relation: SquadRelation;
  shortNameAvailable: boolean;
}

export interface SessionCollaborationContract {
  squads: ActiveSquad[];
  members: SessionMember[];
  sessionStateRoot: string;
}

export interface AddressQuery {
  name?: string;
  role?: string;
}

export interface AgentMatch {
  squadId: string;
  name: string;
  role: string;
  relation: SquadRelation;
  ambiguous: boolean;
}

export type StateWriteKind =
  | 'decision'
  | 'history-update'
  | 'session-log'
  | 'orchestration-log';

export interface StateWriteIntent {
  kind: StateWriteKind;
  actorSquadId?: string;
  affectedSquadIds?: string[];
}

export interface StateWriteTarget {
  squadId: string;
  path: string;
  reason: string;
  exclusive: boolean;
}

export function resolveSessionCollaboration(
  cwd: string,
  options?: ResolveSessionOptions,
): Promise<SessionCollaborationContract>;

export function matchSessionAgents(
  contract: SessionCollaborationContract,
  query: AddressQuery,
): AgentMatch[];

export function planSessionStateWrites(
  contract: SessionCollaborationContract,
  intent: StateWriteIntent,
): StateWriteTarget[];
```

That is enough for hosts to build the rest.

- `resolveSessionCollaboration()` gives the host the active squads, their declared relationship, the composed roster, and the session state root.
- `matchSessionAgents()` exposes ambiguity instead of hiding it.
- `planSessionStateWrites()` gives the host a deterministic mechanical plan for where a given kind of state could land.

What the SDK should **not** hard-code:

- that “organization always wins” as a universal product rule
- which physical binding locations a company prefers
- how enterprise policy is authored or authenticated
- whether a host shows “org/Flight” versus some other display label
- when a company disables personal participation
- whether an organization mirrors logs into another system

Those are layering concerns. The SDK exposes the contract; the org tool interprets it.

## 5. Drift / re-entry — downscope it

Drift / re-entry should be **downscoped**, not treated as a large SDK invariant surface. The SDK should keep only a small comparison primitive: a session stamp that records the resolved squad ids, their revision fingerprints, their declared relations, and the chosen session state root. On the next entry, the SDK can compare the current collaboration contract to that prior stamp and report either “same resolution” or a structured list of changes. Richer behavior — warning language, remediation flows, auto-rebind, policy explanations, or enterprise dashboards — belongs in the host or org-tool layer. This keeps the trust-critical comparison in one place without freezing a lot of organization-specific recovery UX into upstream Squad.

## 6. What NOT to do

We are explicitly rejecting the older layered-fallback idea where one squad is the real squad, the nearest layer silently wins, and the rest become shadow context. That model breaks the mental model Aaron described because it hides real participants, over-simplifies authority, and makes state ownership muddy: if multiple squads are truly involved, pretending only one exists until escalation is the wrong abstraction. The collaboration model instead treats multi-squad sessions as provenance-aware union rosters with explicit jurisdiction, explicit chain-of-command rules, and explicit state-routing — real collaboration, not silent fallback.

## 7. Open questions for Aaron

1. When a broader squad and a closer squad disagree about a *non-safety, non-policy* implementation choice, do you want the closer squad to have the final say by default, or do you want broader Leads to be able to actively direct local execution when they are in the session?
2. For a session outcome that materially affects multiple squads, do you want one canonical owning `decisions.md` entry plus propagated history updates, or do you want deliberate mirrored decision entries in every affected squad when humans inspect each squad independently later?
3. Should the default user experience expose multiple same-role agents when they are simultaneously active, or should the host collapse them behind one visible role until ambiguity matters enough to show provenance?
