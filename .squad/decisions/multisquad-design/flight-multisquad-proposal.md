# Multi-Squad Management for Squad

**A proposal & functional specification**

**Author:** Flight (Squad Lead)  
**Date:** 2026-05-18  
**Status:** Proposal — pending approval

## Part I — Proposal

### 1. Executive summary

Squad already works well for the simplest and most important case: one project, one squad, one familiar command-line experience. This proposal keeps that experience intact while adding a new capability for larger organizations: the ability to let more than one squad participate in the same workspace without turning every project into an administrative exercise.

The core idea is straightforward. A squad can be published as a reusable identity, a workspace can be connected to one or more of those published identities, and the runtime can compose the right set of participants for the work at hand. That makes it possible for an organization to share common guidance across many projects, for a team to reuse its own squad across multiple repositories, and for a local project to keep day-to-day ownership of its own implementation details.

The design is intentionally conservative. Existing users of `squad-sdk` and `squad-cli` keep the same out-of-the-box behavior they have today. No new default prompts are introduced. No existing single-squad workflow is redefined. Multi-squad behavior appears only when a workspace is explicitly connected to published squad identities, when a host deliberately enables broader organizational participation, or when a developer has already created personal squads that match the workspace under ambient discovery. Users who have not opted into any of those paths see no change.

The proposal also keeps a clean separation of concerns. The Squad SDK provides the shared mechanics: mustering published squad identities, reading workspace-to-squad relationships, composing the active participants for a session, and exposing routing and write-location primitives. It does not try to freeze one organization’s chain of command, storage preference, authentication flow, or management policy into the core runtime. Those decisions belong in host tooling and organization-specific layers built on top of Squad.

In practice, this gives four audiences something useful. The solo developer experiences no disruption. The engineer working across team and organizational contexts gets clear participation and routing. The organization admin gains a flexible model that supports multiple storage locations and distribution media. The upstream maintainer gets a proposal shaped as an additive, upstream-friendly kernel rather than a private fork of product policy.

### 2. Vocabulary

#### About Squad

Squad is a multi-agent AI runtime that organizes a team of specialist agents inside your repo’s `.squad/` directory. Those agents have named identities and charters, share decisions, keep individual histories, and work through a Coordinator that routes requests to the right specialist. Out of the box, one squad lives with one repo and serves that repo; that default remains exactly the same in this proposal. Nothing here changes the classic single-squad experience. This proposal only extends that model for organizations where more than one squad may matter in the same workspace.

This proposal uses **muster** for the act of bringing an assigned squad into a session. It fits the squad metaphor, avoids `deploy`’s ship-to-prod baggage, and leaves **report in** free to mean what the squad does once it is present: surface its members into the active roster.

| Term | Definition | Example |
|---|---|---|
| **call-sign** | The identifier string for a squad. It is the squad’s published name. | “Project X is assigned the `a-team` call-sign even though the squad lives in `contoso/a-team-squad`.” |
| **assign / assignment** | **Assign** is the act of connecting a workspace to a squad by call-sign; an **assignment** is the recorded relationship. | “Casey assigns `a-team` to Project X, and that assignment stays with the workspace until changed.” |
| **assignment ledger** | The record that stores which squads, identified by call-sign, apply to which workspace paths. | “The assignment ledger says Project X uses the `a-team` squad, while Project Y in the same repo does not.” |
| **muster / mustering** | **Muster** is the act of bringing an assigned or otherwise applicable squad into a specific session; **mustering** is that session-start load step. | “When Casey opens Project X, the SDK musters the `a-team` squad from assignment and the org squad from policy.” |
| **active roster** | The set of squads and members that are active in the current session. | “When Casey opens Project X, the active roster includes the A-Team squad for execution and the org squad for shared constraints.” |
| **report in** | What a mustered squad does once present: it surfaces its members into the active roster for the current session. | “Once the org squad is mustered for Project X, it reports in with the policy specialists that apply there.” |
| **squad home** | The machine-local Squad directory used for cached squads, local records, and bookkeeping. | “After the first assignment, Squad keeps a cached copy of the `a-team` squad in squad home.” |
| **org / team / personal** | The three kinds of squad identity used by the model: organization-wide, team-scoped, and person-scoped. | “`org` sets shared guardrails, `team` owns local repo work, and `personal` stays advisory unless explicitly opted in.” |

### 3. User Story — Casey’s First Day

I open my new laptop expecting the usual first-day ritual: sign into six things, fail at three of them, and spend the morning learning which internal wiki page still matters.

Instead I get one short onboarding note from IT.

```text
Your box is ready.
`squad-cli` is already on your path.
The org squad and your team squads are reachable.
Clone what you need and start working.
```

That is such a suspiciously short note that I trust it immediately.

I clone the repos from my setup mail.

```powershell
PS D:\work> git clone https://example.com/contoso/platform.git
PS D:\work> git clone https://example.com/contoso/a-team-squad.git
PS D:\work> git clone https://example.com/contoso/project-z.git
```

By the time the progress bars stop, I know just enough to be dangerous.

- `contoso/platform` is Contoso’s mono-repo, where the A-Team keeps Project X and Project Y.
- `contoso/project-z` is a tightly scoped repo used by Contoso for Project Z. Team B owns it.
- `contoso/a-team-squad` is not a product repo at all. It is an ancillary repo where the A-Team publishes its `a-team` squad so other projects can assign it without copying a whole `.squad` tree around.

That third point is the first thing that feels new in a good way. The `a-team` call-sign is just the squad’s name. The squad can live in one repo. The code can live in another. My first-day brain understands that faster than I expect to.

I also create one tiny ancillary repo of my own: `contoso/casey-helpers`. It is one of my personal squads: the personal mirror of `contoso/a-team-squad` — dotfiles, helper scripts, a little squad whose call-sign is `casey-helpers`, and the coding-style preferences I would rather not re-explain to myself every week. Mostly it stays politely advisory, but it means those preferences and helpers can follow me onto Project X when they are useful. If I later spin up a `casey-cs` squad for .NET work, it should join that kind of repo the same ambient way. I do not want to assign my own helper squads one workspace at a time.

I start with Project Z in `contoso/project-z`, because I want one clean success before I learn any new nouns.

```powershell
PS D:\work\project-z> squad-cli
```

It behaves exactly like the getting-started docs said it would.

One Lead. One set of helpers. One session. No extra questions. No new terminology. No explanation banner teaching me a new mental model before I have written a line of code.

That matters more than it sounds like it does.

Project Z is Team B’s project, and the out-of-the-box Squad experience just works there. If nobody had told me there was a bigger multi-squad story anywhere in the company, I would not learn about it from this repo. I would just think, “Nice. The CLI works.” For a first day, that is a gift.

I spend half an hour following a README, fixing a tiny config path, and proving to myself that my terminal, editor, and Git setup are all normal. It is gloriously boring.

Then I move to `contoso/platform`, where the interesting part starts.

Project X belongs to the A-Team, but the A-Team does not keep its squad files in `contoso/platform`. They publish the squad from `contoso/a-team-squad`, and projects that need it assign the `a-team` call-sign where it belongs. I open the project folder, type the obvious thing, and hope the obvious thing exists.

```powershell
PS D:\work\platform\Project-X> squad-cli assign a-team
```

It does.

```text
Assigned squad: a-team
Source: contoso/a-team-squad
Recorded in assignment ledger
Cached in squad home

Org squad will be mustered here automatically.
Run `squad-cli explain` if you want to see why.
```

I actually laugh at “Source: contoso/a-team-squad.” It is so matter-of-fact that it makes the whole design feel normal. Of course the A-Team squad can live in `contoso/a-team-squad` while the code lives in `contoso/platform`. Of course the assignment ledger is the thing that remembers that relationship. Of course my squad home keeps the cached copy so I do not have to think about where it came from after the first assignment.

This is the first small moment of delight on the day: I do not copy files. I do not vendor a team setup into my repo. I point Project X at the right call-sign and keep going.

I am still new enough to want proof, so I ask for it.

```powershell
PS D:\work\platform\Project-X> squad-cli explain
```

```text
Project X uses:
  owner: a-team
  constraining: org

Why:
  - this workspace is assigned to the `a-team` squad
  - your company marks the org squad as active for shared engineering policy
  - the A-Team owns execution here

If you say "Lead," Squad routes to the A-Team’s Lead for local work.
Org guidance still applies where your company says it does.
```

That is exactly the answer a new person needs.

Not a lecture. Not a theory. Just plain English: the A-Team owns the work here, the org squad is mustered because the company wants shared guardrails, and I do not need to guess which Lead I am talking to.

The phrase that sticks in my head is **active roster**. I can feel myself learning it by example instead of by glossary. Project X has an active roster of more than one squad. I can see who is in the room and why.

Project Y is one folder over, so I try the same question there.

```powershell
PS D:\work\platform\Project-Y> squad-cli explain
```

```text
Project Y uses:
  owner: org

Why:
  - no team assignment is recorded for this workspace
  - the org squad applies by default here
```

That is my first friction beat of the day, and it is the good kind.

I stare at the screen for a second and think: wait, same repo, different answer?

Then I remember what the assignment ledger is for. Repo boundaries are not the same thing as workspace intent. Project X is assigned to the A-Team. Project Y is not. The CLI tells me that without making me reverse-engineer folder conventions or bother a teammate. It is one of those tiny trust-building moments where the system does the obvious right thing and then bothers to explain itself.

By lunch I am ready to start real work in Project X: a setup task with a very first-day flavor, half bug fix and half archaeology. A request handler needs to call a shared service, and the README in the folder still points at an old helper package.

I start a session.

```powershell
PS D:\work\platform\Project-X> squad-cli
```

This time the banner is different.

```text
Project X • active roster: a-team, org
Local execution: a-team
Shared constraints: org
```

That is the second moment of delight. The CLI does not flood the screen. It gives me exactly enough truth to orient myself and then gets out of the way.

A few minutes later I hit the exact kind of question that could have become a whole weird essay if the design were bad.

I type:

```text
Lead, should we just bump the shared client and use the new auth flow?
```

The answer comes back with no drama at all.

```text
Routing to A-Team Lead for Project X.
Org guidance is active for approved auth paths.
```

Then the A-Team’s Lead responds first, because the A-Team owns the code in front of me. The org squad, already mustered as a constraining participant, reports in one beat later with the boring constraint my company has already declared for this kind of work: use the approved auth package line, keep the existing audit hooks, and do not invent a local exception.

That is the collaboration moment, and it earns its place because it feels like real work instead of a brochure.

The broader squad constrains. The closer squad executes. Nobody gives me a sermon about hierarchy. Nobody stages a showdown between two Leads. The org policy for this class of question is already configured, so the whole chain-of-command issue lands with the emotional intensity of a lint rule.

The A-Team’s Lead says, in effect, “Fine, same local fix, different package choice,” and keeps moving.

That is the part I find reassuring. The active roster is larger, but the work is not mushier. More expertise is present, not more confusion.

The rest of the session feels like a team that is slightly bigger than the repo around it.

The A-Team contributes the local runbook, the repo habits, and the part where someone clearly remembers why this handler was split in the first place. The org squad contributes exactly the broad things I want broad guidance for: approved auth paths, logging expectations, and one quiet reminder about which internal tool boundary I should not cross on a Tuesday afternoon when I still have not learned everyone’s name.

What I do not get is just as important.

I do not get the org side picking variable names.  
I do not get my personal preferences pretending to outrank shared repo rules.  
I do not get one merged blob of advice that makes it impossible to tell who is responsible for what.

At one point I get curious and ask to see the active roster spelled out.

```powershell
PS D:\work\platform\Project-X> squad-cli roster
```

```text
Active roster

  a-team  (owner)
    - Lead
    - PAO
    - FIDO

  org  (constraining)
    - Lead
    - RETRO
    - CAPCOM

Unique names stay short.
Ask for provenance only when you need it.
```

That last line is another nice touch. It matches how the whole thing feels. I am not forced to speak in prefixes all day. The provenance is there when I need it, but it is not taped to every noun.

When the work is done, the session closes with one tiny line that tells me the state model is sane.

```text
Scribe recorded the implementation note under the `a-team` squad.
Org history received a breadcrumb because shared policy constrained this session.
```

Perfect. One session Scribe. One canonical home for the local decision. A breadcrumb where the broader squad needs to remember it. I do not need to know the file layout to appreciate that somebody thought carefully about ownership.

By late afternoon, the whole day has sorted itself into a mental model I can actually carry.

- Project Z in `contoso/project-z` is the classic case. It is just Squad, exactly the way a normal single-squad project expects it.
- Project X in `contoso/platform` is the collaboration case. I assign the A-Team squad, the org squad is mustered, and the active roster gets bigger without getting sloppy.
- Project Y in the same repo proves the system is paying attention to the workspace, not just the clone. No assignment there means no surprise A-Team context there.
- `contoso/a-team-squad` proves the squad artifacts are distributable. The A-Team squad can live in one repo and serve work in another.

That last point keeps coming back to me because it feels like the design crossed from clever to useful. The assignment is the important thing, not the storage coincidence. A workspace can be assigned the right call-sign whether the squad lives beside the code, somewhere else in the org, or in my own squad home.

My `casey-helpers` squad barely shows up in the work today, and that is correct. Personal squads attach quietly when their declared scope fits, but they stay advisory. Work comes first in the work repos. Personal help is there when I need it, not waving its arms in front of every prompt.

By the time I close my laptop, I trust two things.

First, the default experience was protected. Team B’s Project Z in `contoso/project-z` did not suddenly become a lesson in organizational topology just because the company happens to use multi-squad features elsewhere.

Second, the more advanced experience was still understandable. When Project X needed more than one squad active at once, the vocabulary held. Call-sign. Assign. Assignment ledger. Muster. Active roster. Report in. None of it felt like I had wandered into an API reference by accident.

It just felt like the system telling me, plainly, who was helping, who owned the work, and why.

The next morning I open Project X again, and everything is right where I left it.

### 4. Goals

**P0 — Org-scale multi-squad flexibility.** Support many squads, varied applicability, multiple storage media, multiple source locations, sharing across repos, and real collaboration in one session.

**P0 — Zero impact to existing `squad-sdk` and `squad-cli` users.** The default out-of-the-box experience remains unchanged for single-squad use.

**P1 — Maintain as little custom code as possible.** Prefer a compact shared kernel and thin additive surfaces over bespoke end-to-end flows.

**P1 — Contribute value upstream to `bradygaster/squad`.** Keep the proposal aligned with upstream-friendly primitives.

**P1 — Minimize changes to existing `squad-cli` semantics.** Prefer additive commands and flags; gate any changed behavior on explicit multi-squad participation.

### 5. Non-goals

- Defining one universal corporate deployment tool.
- Requiring one storage medium or one hosting location for every squad.
- Solving every compliance framework or enterprise policy system.
- Baking a universal chain-of-command rule for all non-safety, non-policy disagreements into the SDK.
- Making personal participation the default experience for ordinary single-squad use.
- Requiring every host to surface the same session-resume or comparison behavior.
- Turning Squad SDK into an identity catalog, authentication broker, or organization management product.

### 6. Audiences served

**Single-squad solo developer.** This user gets zero disruption. They keep the current Squad experience and do not need new vocabulary unless they opt into multi-squad behavior.

**Team member working across team and org squads.** This user needs a clear way to see who owns work, who constrains work, and why two workspaces in the same repo may behave differently.

**Org admin.** This user needs flexible storage and distribution choices, a stable assignment model, trust boundaries, and a predictable runtime contract that can support host-specific policy.

**Upstream maintainer.** This audience needs the smallest credible additive kernel: reusable primitives, minimal semantic churn, and a clean separation between shared mechanism and organization-specific layering.

### 7. Design principles

#### Protect the default experience

The default experience is today’s experience. If a developer clones a classic single-squad repo and runs Squad, nothing in this proposal should make that interaction noisier, more ceremonial, or more surprising. Multi-squad participation is additive and opt-in, not a migration that everyone must mentally carry.

#### Flexibility begins with location neutrality

A published squad may live beside the code, in another repo, in a package, behind an HTTP endpoint, or in a machine-local store. The SDK should support both in-repo and squad-home assignment records without privileging one location as the “real” one. The workspace-to-squad relationship matters more than where the published files were first stored.

#### Squad ships mechanism, not org policy

The SDK’s job is to answer stable questions: what squads are active here, what members do they contribute, which call-sign identifies each one, what relationship does each one have to the work, and where should state land. It is not the SDK’s job to hard-code one organization’s approval ladder, naming scheme, auth flow, or exception process.

#### Broader squads constrain; closer squads execute

The model only works if authority is split cleanly. Broader squads bring standing rules, policy, and cross-cutting expertise. Closer squads own repo-local implementation and day-to-day execution. Personal participation can be valuable, but shared work cannot quietly become personal work just because a personal squad is present.

#### One session, one coherent ownership model

Multi-squad collaboration must still feel like one working session, not several half-overlapping sessions taped together. That requires one active roster, one routing model, one session Scribe, and one canonical home for each durable decision. Cross-squad breadcrumbs are useful; duplicated authority is not.

#### Additive CLI surface beats semantic rewrites

When the CLI needs new power, add new commands or flags. Do not repurpose familiar commands for everybody and hope users infer the difference. Existing muscle memory is an asset, and upstream contribution gets easier when the new surface is narrow and opt-in.

### 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Vocabulary overload makes the feature feel heavier than it is.** | Medium | High | Keep multi-squad terms invisible in the single-squad path; define them once up front; keep CLI output plain and sparse. |
| **Organizations expect the SDK to decide every conflict automatically.** | High | High | Make the policy seam explicit; document that the SDK exposes relationships and constraints, while host or org policy resolves situational non-policy disagreements. |
| **Assignment records in two supported locations create confusion.** | Medium | Medium | Enforce a location-neutral lookup rule based on workspace specificity; report same-specificity conflicts as ambiguity instead of silently picking a winner. |
| **State ownership becomes muddy when several squads participate.** | Medium | High | Keep one session Scribe, one canonical decision home by jurisdiction, and cross-squad breadcrumbs rather than duplicate durable writes by default. |
| **Ambient personal discovery feels magical or noisy.** | Medium | Medium | Use manifest-declared scope as the primary relevance signal, keep `SQUAD_NO_PERSONAL`, allow explicit ledger force/suppress overrides, and ship the single-match case before multi-personal polish. |
| **CLI scope grows beyond what upstream can reasonably absorb.** | Medium | High | Keep existing commands unchanged; limit new surface to opt-in multi-squad commands that directly support Casey’s day-1 flow and leave org tooling above the CLI. |

### 9. Phased delivery

**Phase 1 — MVP.** Deliver the behaviors required to make **User Story — Casey’s First Day** work for the demonstrated cases: published squad mustering by call-sign, workspace assignment recording, active roster composition, `assign`, `explain`, and `roster` surfaces, jurisdiction-aware routing primitives, one-session state ownership, and ambient personal discovery for the zero-or-one relevant personal squad case. The relevance rule in this phase is manifest-declared personal scope plus explicit ledger override, and `SQUAD_NO_PERSONAL` must disable the whole personal path cleanly. This phase must preserve the unchanged single-squad path.

**Phase 2 — Parity and polish.** Add refresh flows, pinning and provenance improvements, better ambiguity reporting, stronger trust metadata, richer diagnostics, refined host hooks for organizational policy, and the full multi-personal-squad expansion: multiple simultaneous advisory personal squads, overlap diagnostics, and clearer per-workspace force/suppress controls on top of the same scope model. This phase makes the model easier to operate without expanding the core semantic footprint.

**Phase 3 — Optional org-tool extensions and upstream contribution waves.** Build or refine organization-specific catalog, policy, and rollout layers above the kernel; upstream the reusable SDK and CLI primitives in small waves. This phase is where differentiated host behavior lives, not where the core model is invented.

### 10. Success criteria

The proposal counts as shipped when the following checks are true:

- A single-squad repo still opens with the same `squad-cli` experience it has today.
- A workspace can be assigned a team squad that lives in a different repo, and that relationship survives across sessions.
- Two workspaces in the same repo can resolve to different active rosters based on assignment, as shown in **User Story — Casey’s First Day**.
- `squad-cli explain` can tell a developer, in plain English, which squad owns execution, which squads were mustered as constraints, and why.
- A multi-squad session routes local implementation questions to the closer squad while still honoring broader constraints.
- One session Scribe records the local outcome once and leaves a breadcrumb for broader participants when appropriate.
- A user with no personal squads sees no new behavior, while a user with one relevant personal squad gets advisory-only ambient help without assigning it workspace by workspace.
- Existing users who never assign a call-sign, never create personal squads, and never opt into org participation do not encounter any new ceremony.

## Part II — Functional Specification

### 11. Architecture overview

```text
+--------------------------------------------------------------+
|                         Host tooling                          |
|  - squad-cli                                                  |
|  - org-specific shell / dashboard / catalog / policy tools    |
+-------------------------------+------------------------------+
                                |
                                v
+--------------------------------------------------------------+
|                         Squad SDK kernel                      |
| muster squads by call-sign • read ledger • compute roster     |
| route by jurisdiction • plan state writes • compare stamps    |
+-------------------+----------------------+-------------------+
                    |                      |
                    v                      v
        +--------------------+   +---------------------------+
        | Assignment ledger   |   | Published squad sources   |
        | workspace ↔ squad  |   | in-repo / separate repo / |
        | relationships      |   | GitHub / ADO / HTTP / npm |
        +--------------------+   +---------------------------+
                    |
                    v
        +---------------------------------------------+
        | Active roster for the current session        |
        | owner • constraining • advisory squads      |
        | provenance-aware members                    |
        +---------------------------------------------+
                    |
                    v
        +---------------------------------------------+
        | Session state outputs                        |
        | one Scribe • canonical decision home         |
        | cross-squad breadcrumbs • shared logs        |
        +---------------------------------------------+
```

**Annotation.** The SDK kernel is the reusable center. Hosts sit above it. Published squads are distributable artifacts the kernel can muster from several media. The assignment ledger records which squads apply to which workspace paths. The kernel combines those inputs into an active roster, exposes routing and write-location primitives, and leaves org-specific policy behavior to the host layer.

### 12. Concepts

#### 12.1 What a published squad looks like on disk and over the wire

A published squad package carries a call-sign plus the Squad content required to participate in a session.

**Recommended layout**

```text
squad-root/
  call-sign.json
  .squad/
    team.md
    routing.md
    decisions.md
    agents/
      <agent>/charter.md
      <agent>/history.md
    skills/
      <skill>/SKILL.md
```

The distributable unit is the squad root. The `.squad/` directory inside it carries the familiar Squad material. `call-sign.json` is the transport-facing manifest.

**Manifest fields**

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | Manifest schema version for wire compatibility. |
| `id` | string | Stable call-sign identity, such as `org` or `a-team`. |
| `kind` | `org | team | personal` | Classification used for trust posture and default relationship hints. |
| `version` | string | Published version of the call-sign package or snapshot. |
| `displayName` | string | Human-facing name for hosts and diagnostics. |
| `source` | object | Source location metadata: repo URL, package name, filesystem path, or HTTP origin. |
| `revision` | string optional | Source revision, pin, tag, or digest for reproducibility. |
| `identity` | object | Publisher and provenance metadata, such as issuer, signature, or digest. |
| `squadPath` | string | Relative path to the embedded `.squad/` content when the package layout is not flat. |
| `ambientScope` | object optional | For personal squads, declarative scope hints such as repo globs, workspace globs, languages, or file globs used for ambient relevance matching. |
| `capabilities` | string[] optional | Advertised optional capabilities for hosts and policy layers. |

Over the wire, hosts and the SDK exchange this manifest plus a resolved path or fetch result. The `.squad/` content remains the payload the squad actually uses once it has been mustered and reports in.

#### 12.2 How assignment works

An assignment connects a workspace path to one or more squads by call-sign. At minimum, an assignment records:

- workspace path or workspace root
- assigned call-sign id
- optional source override or pin
- relation hint when explicitly declared by the host
- creation and refresh metadata

Assignments are path-aware rather than repo-wide by default. That is what allows Project X and Project Y in the same repo to resolve differently.

#### 12.3 How the assignment ledger stores relationships

The assignment ledger is supported in exactly two locations:

1. **In-repo:** `.squad/assignment-ledger.json`
2. **Host-local in squad home:** `%USERPROFILE%\.squad\assignment-ledger.json` on Windows, with platform-appropriate equivalents elsewhere

Neither location is privileged at the SDK level. The SDK reads both and evaluates them with one lookup rule:

1. Gather all ledger entries from both supported locations.
2. Keep only entries whose workspace path matches the current path or an ancestor of it.
3. Prefer an exact workspace match over an ancestor match.
4. Among ancestor matches, prefer the most specific path.
5. If two entries of the same specificity point to different owning squad answers, report ambiguity instead of silently choosing by location.
6. If the host provides an explicit policy hook for resolving same-specificity ambiguity, the SDK may surface both candidates to that hook and accept the host’s decision.

This rule makes path specificity authoritative and location secondary. A repo-local ledger does not automatically outrank squad home, and squad home does not automatically override repo-local intent.

#### 12.4 How the active roster is composed

The active roster is the union of participating squads for the session, each tagged with a relationship to the work.

A minimal composition rule is:

- **one owner** — the squad that owns execution for the workspace
- **zero or more constraining squads** — broader participants that apply standing rules or cross-cutting expertise
- **zero or more advisory squads** — optional participants such as personal helpers

The active roster is therefore a provenance-aware set, not a flattened blob. Each member retains its source call-sign, even if the host chooses to keep the short display compact when there is no ambiguity.

#### 12.5 Ambient personal squad discovery

Ambient personal participation should extend the existing coordinator pattern rather than replace it. Personal squads live under squad home by default — for example `~/.squad/personal/{call-sign}/` or a host-provided equivalent — and the SDK may discover them by reading their manifests at session start. If `SQUAD_NO_PERSONAL` is set, or if the host disables ambient personal discovery, the SDK skips that entire path.

The primary relevance signal is declarative scope on the personal squad’s own manifest. A personal squad says where it applies — repo patterns, workspace patterns, languages, or file globs — and the SDK attaches only the matching personal squads as advisory participants. The manual escape hatch is the assignment ledger: a workspace may explicitly force or suppress a personal squad when the developer wants an exception to the manifest defaults. Ghost Protocol carries over unchanged: ambient personal squads are advisory, read-only against shared project state, and present to help without becoming the default character of the session.

Phase 1 only needs to guarantee the simple ambient case: zero or one relevant personal squad attaches automatically. Phase 2 generalizes the same mechanism to multiple simultaneous personal squads, overlap diagnostics, and richer host UX.

### 13. The collaboration model

A multi-squad session is one session with more people in the room, not one “real” squad plus hidden shadow context. The active roster is built as a provenance-aware union. Every active squad contributes members, but not every active squad contributes the same kind of authority.

**Roster composition.** The owner squad contributes the members responsible for local execution. Constraining squads contribute members whose guidance is relevant because their scope is broader than the current workspace. Advisory squads contribute members whose input is helpful but not authoritative for shared repo ownership.

**Jurisdiction-based routing.** Routing follows the work before it follows organizational breadth. If the user addresses a unique agent by name, route there. If the user addresses a role such as “Lead,” route first to the squad that owns execution for the workspace or change surface. Then apply any broader constraints that are relevant to that work. If multiple agents still match after jurisdiction filtering, surface ambiguity rather than guessing.

**Broader constrains; closer executes.** Broader squads may impose standing rules that narrower squads cannot relax: required package lines, review gates, compliance steps, logging rules, approved tool boundaries, and similar shared constraints. Within that envelope, the closer squad decides how to do the work locally: file shape, helper choice, refactor shape, test layout, and repo conventions.

**Personal as advisory.** Personal squads can be useful, but in shared project contexts they are advisory unless the host explicitly promotes them for a specific case. Ghost Protocol remains in force: they can recommend, consult, and supply context, but they do not silently outrank team or org ownership or write shared project state by default.

**Host policy seam for non-safety disagreement.** The SDK does **not** hard-code a universal answer to every non-safety, non-policy disagreement between active squads. That decision is situational and belongs to host or org policy. The SDK exposes relationship data and a policy seam; the host decides whether, for example, a broader Lead may direct architecture choices while the closer Lead keeps final say on tactical implementation. If host and org policy still cannot resolve the question cleanly, the system should surface it and let the human user decide.

### 14. State maintenance

**One session Scribe.** There is one session Scribe because there is one session timeline and one need for ordered durable writes. The Scribe role belongs to the session, not to each active squad independently.

**Per-squad `decisions.md` ownership.** There is no shared cross-squad `decisions.md`. Durable decisions land once, in the squad that owns them by jurisdiction. Repo-local implementation choices land under the owner squad. Team conventions land under the team squad. Org-wide policy lands under the org squad.

**Cross-squad history propagation.** When a session affects more than one squad, the canonical decision stays in one place, but affected agents may receive short history breadcrumbs in their own squad roots. That preserves local ownership while still making collaboration visible later.

**Shared logs rooted at the owning write location.** Session logs and orchestration logs are shared per session, not duplicated per squad. They live under the owning write location for the session, with provenance tags inside entries for cross-squad visibility.

**Single-squad degenerate case.** When only one squad is active, this entire model collapses to today’s behavior: one Scribe, one `decisions.md`, one set of histories, one log root, no provenance clutter, and no changed user workflow.

### 15. Zero-impact invariance proof

When exactly one squad is active, every new concept in this proposal reduces to the behavior a current Squad user already knows:

- **call-sign** collapses to “the squad already in this project.”
- **assignment** collapses to “nothing extra to do,” because the project already resolves to its one squad.
- **assignment ledger** does not need to exist for the common single-squad path.
- **muster** is the same squad-loading behavior that already happens today.
- **active roster** is just the current squad roster.
- **report in** is how that already-mustered squad surfaces its familiar roster.
- **one session Scribe** is today’s Scribe behavior.
- **per-squad decision ownership** is today’s single `decisions.md` ownership.

For `squad-cli`, the existing surface remains recognizable and unchanged:

- `squad-cli` with no additional multi-squad setup behaves as it does today.
- Existing single-squad commands keep their current meaning.
- No new prompts appear in a fresh classic setup.
- No personal opt-out explanation is injected into the default path.

What gets added is opt-in and additive:

- `squad-cli assign ...`
- `squad-cli explain`
- `squad-cli roster`
- assignment and refresh utilities for multi-squad users

If no assignment ledger is present and no host-level org participation is configured, none of those additions affect the ordinary single-squad flow. That is the invariance guarantee.

### 16. SDK contract

The SDK contract should stay small, explicit, and mostly mechanical.

```ts
export type CallSignKind = 'org' | 'team' | 'personal';
export type CallSignRelation = 'owner' | 'constraining' | 'advisory';

export interface CallSignRef {
  id: string;
  source?: string;
  revision?: string;
}

export interface PersonalAmbientScope {
  repoGlobs?: string[];
  workspaceGlobs?: string[];
  languages?: string[];
  fileGlobs?: string[];
}

export interface CallSignManifest {
  schemaVersion: number;
  id: string;
  kind: CallSignKind;
  version: string;
  displayName: string;
  source: { kind: string; location: string };
  revision?: string;
  identity?: { issuer?: string; digest?: string; signature?: string };
  squadPath?: string;
  ambientScope?: PersonalAmbientScope;
}

export interface LoadedCallSign {
  manifest: CallSignManifest;
  rootPath: string;
  squadPath: string;
}

export interface AssignmentRecord {
  workspacePath: string;
  callSign: CallSignRef;
  relationHint?: CallSignRelation;
  activation?: 'default' | 'force' | 'suppress';
}

export interface AssignmentLedger {
  records: AssignmentRecord[];
}

export interface ActiveRosterOptions {
  personalSquadRoot?: string;
  includeAmbientPersonal?: boolean;
}

export interface ActiveRosterEntry {
  callSignId: string;
  kind: CallSignKind;
  relation: CallSignRelation;
  rootPath: string;
}

export interface ActiveRoster {
  workspacePath: string;
  entries: ActiveRosterEntry[];
}

export interface SessionMember {
  name: string;
  role: string;
  callSignId: string;
  relation: CallSignRelation;
  ambiguous: boolean;
}

export interface RoutingIntent {
  addressedName?: string;
  addressedRole?: string;
  targetPath?: string;
  actionKind?: string;
}

export interface JurisdictionHint {
  callSignId: string;
  relation: CallSignRelation;
  reason: string;
}

export interface CollaborationPolicyHook {
  resolveConflict?(hints: JurisdictionHint[], intent: RoutingIntent): Promise<JurisdictionHint | undefined>;
}

export interface ResolutionFingerprint {
  value: string;
}

export interface ResolutionFingerprintDiff {
  same: boolean;
  changedDimensions: Array<'owner' | 'constraints' | 'advisory' | 'source' | 'policy'>;
}

export function loadCallSign(ref: CallSignRef): Promise<LoadedCallSign>;
export function discoverPersonalCallSigns(options?: ActiveRosterOptions): Promise<LoadedCallSign[]>;
export function selectRelevantPersonalCallSigns(
  workspacePath: string,
  callSigns: LoadedCallSign[],
  ledger?: AssignmentLedger,
): Promise<LoadedCallSign[]>;
export function readAssignmentLedger(workspacePath: string): Promise<AssignmentLedger>;
export function computeActiveRoster(workspacePath: string, options?: ActiveRosterOptions): Promise<ActiveRoster>;
export function getJurisdictionHints(roster: ActiveRoster, intent: RoutingIntent): Promise<JurisdictionHint[]>;
export function createResolutionFingerprint(roster: ActiveRoster): ResolutionFingerprint;
export function compareResolutionFingerprints(
  previous: ResolutionFingerprint,
  current: ResolutionFingerprint,
): ResolutionFingerprintDiff;
```

| Entry | Behavior contract | Stability |
|---|---|---|
| `loadCallSign` | Load and identify a squad by call-sign from a supported source and return its manifest plus resolved paths. | **frozen** |
| `discoverPersonalCallSigns` | Discover personal squads from squad home or a host-supplied personal root without applying workspace policy yet. | **experimental** |
| `selectRelevantPersonalCallSigns` | Apply manifest-declared ambient scope plus ledger force/suppress overrides to determine which personal squads are relevant to the workspace. | **experimental** |
| `readAssignmentLedger` | Read applicable assignment records for a workspace from both supported ledger locations using the SDK lookup rule. | **frozen** |
| `computeActiveRoster` | Compute the owner, constraining, and advisory squad entries for a workspace, optionally including ambient personal squads. | **frozen** |
| `getJurisdictionHints` | Return routing hints that reflect local ownership, broader constraints, and advisory participants without choosing host policy for every conflict. | **frozen** |
| `CollaborationPolicyHook` | Optional host seam for situational disagreement handling beyond baseline relationship rules. | **experimental** |
| `createResolutionFingerprint` | Produce the thin comparable runtime stamp for the effective answer applied to the workspace. | **frozen** |
| `compareResolutionFingerprints` | Compare two runtime stamps and report whether the effective answer is materially the same. | **frozen** |

The comparison primitive is intentionally small. It is a runtime-contract detail, not a headline requirement. Hosts may use it for resume integrity or messaging, but the SDK does not force a universal user-visible flow around it.

Ambient personal discovery stays intentionally thin at the SDK layer. When `includeAmbientPersonal` is true and `SQUAD_NO_PERSONAL` is not set, the SDK may read `${squadHome}/personal/*/call-sign.json` — or the host-supplied `personalSquadRoot` — load those manifests, and keep only the personal squads whose declared `ambientScope` matches the workspace. Explicit ledger records can force or suppress a personal squad per workspace when the developer wants a manual exception. Phase 1 only needs to guarantee the simple single-match path; Phase 2 generalizes the same contract to multiple simultaneous matches and richer diagnostics.

### 17. `squad-cli` surface deltas

The CLI goal is additive surface with minimal semantic churn.

#### Existing behavior

- `squad-cli` with no args: unchanged
- Existing single-squad flows: unchanged
- Existing command meanings: unchanged

#### New commands

| Command | Purpose | Notes |
|---|---|---|
| `squad-cli assign <call-sign>` | Assign a call-sign to the current workspace. | New additive command; writes to the assignment ledger. |
| `squad-cli unassign <call-sign>` | Remove an assignment from the current workspace. | New additive command. |
| `squad-cli explain` | Explain the active roster and why each squad applies. | New additive command; plain-English output. |
| `squad-cli roster` | Show the active roster with provenance when needed. | New additive command. |
| `squad-cli assignments list` | List recorded assignments visible from the current workspace. | New additive command. |
| `squad-cli refresh [call-sign]` | Refresh cached call-sign content from its source. | New additive command. |

#### New flags

| Flag | Applies to | Purpose |
|---|---|---|
| `--source <location>` | `assign`, `refresh` | Override or declare the source location for a call-sign. |
| `--pin <revision>` | `assign`, `refresh` | Pin a specific revision, tag, digest, or package version. |
| `--ledger repo|home` | `assign`, `unassign` | Choose where to write the assignment record when the host exposes that choice. |
| `--json` | `explain`, `roster`, `assignments list` | Machine-readable output for automation or host composition. |

#### Behavior changes

Ideally none. The only visible difference is opt-in and gated: if multi-squad participation is active for the workspace, `squad-cli` may show a compact banner naming the active roster and relationships. If there is no multi-squad participation, the banner and commands are irrelevant and the default path remains unchanged.

### 18. Storage media support

| Source medium | Pull | Refresh | Pin | Authentication notes |
|---|---|---|---|---|
| **In-repo** | Yes | Yes | Yes | No extra auth beyond repo access. Useful when the squad ships beside the code. |
| **Separate repo** | Yes | Yes | Yes | Uses the auth already required for that repo. Example: Project X in `contoso/platform` assigns `a-team` from `contoso/a-team-squad`. |
| **GitHub repo** | Yes | Yes | Yes | Host may use Git credentials, GitHub CLI, token, or Contents API. SDK only needs a fetch result. |
| **ADO repo** | Yes | Yes | Yes | Host handles ADO auth and workspace access; SDK consumes the resolved files. |
| **Plain HTTP** | Yes | Yes | Yes | Host decides trusted origins, headers, caching, and signature checks. |
| **Plain filesystem** | Yes | Yes | Optional | Good for checked-out local mirrors, shared drives, and managed-machine provisioning. |
| **npm** | Yes | Yes | Yes | Host uses npm auth and package resolution; pinning follows package version rules. |

The important point is not the medium itself but the normalized outcome: a loaded call-sign manifest plus a readable `.squad/` payload.

### 19. Security & trust posture

**Trust tiers.** The baseline trust posture is `org > team > personal` for shared-work governance. That means broader shared squads may impose constraints the narrower squad cannot relax, while personal participation remains advisory unless explicitly elevated by host policy.

**Provenance matters.** Every loaded call-sign should carry publisher and source metadata sufficient for the host to decide whether it is trusted, stale, unsigned, or pinned. Trust evaluation belongs to the host or org layer; the SDK preserves the metadata.

**Cross-squad write rules.** The owner squad is the default home for repo-local decisions and logs. Broader squads receive breadcrumbs when they constrained the work. Advisory squads stay under Ghost Protocol and do not get durable shared-project writes by default.

**Default deny on surprising writes.** If the write target is ambiguous, crosses trust tiers unexpectedly, or would duplicate authority without a clear rule, the host should deny the write or require an explicit policy decision rather than guessing.

**Authentication is not an SDK concern.** Repository auth, package auth, HTTP auth, trusted-origin policy, and enterprise credential flows belong to the host or org-tool layer. The SDK should not embed opinionated auth stacks.

### 20. What lives where

| Responsibility | Squad SDK | `squad-cli` | Host tooling | Org-tool |
|---|---|---|---|---|
| Load call-sign manifests and payloads | Yes | Uses SDK | Uses SDK | Uses SDK |
| Read assignment ledger | Yes | Uses SDK | Uses SDK | Uses SDK |
| Compute active roster | Yes | Uses SDK | Uses SDK | Uses SDK |
| Jurisdiction and routing primitives | Yes | Uses SDK | Uses SDK | Uses SDK |
| Situational disagreement policy | Seam only | No | Yes | Yes |
| Assignment commands | No | Yes | Optional | Optional |
| Human-readable explanation surfaces | No | Yes | Yes | Yes |
| Catalog discovery | No | Optional thin wrapper | Yes | Yes |
| Authentication flows | No | Minimal host integration only | Yes | Yes |
| Trust policy and rollout controls | No | Minimal display only | Optional | Yes |
| Dashboards, fleet views, org reporting | No | No | Optional | Yes |
| Cross-system mirroring and enterprise logging | No | No | Optional | Yes |

This is the layering principle in practical form: Squad SDK provides mechanism; `squad-cli` demonstrates an additive reference surface; host and org layers carry the policy, discovery, and operating model that are specific to their environment.

### 21. Upstream contribution sketch

The upstream-ready pieces are the neutral kernel first: published squad mustering by call-sign, assignment ledger reading, active roster computation, ambient personal discovery primitives, routing hints, state-write planning primitives, and the thin resolution fingerprint. The CLI contribution wave should stay narrow and additive: assignment, explanation, roster, and refresh surfaces that are inert when unused. Organization-specific catalog, auth, rollout, and conflict-policy behavior should remain above the upstream line.

## Part III — Appendices

### 22. Appendix A — Alternatives considered

**Pure fallback model.** Rejected because it under-describes the real collaboration case. When more than one squad genuinely participates in a session, pretending one is the “real” one and the rest are merely latent context hides provenance, blurs state ownership, and makes routing harder to explain.

**`squad-cli`-host-only solution.** Rejected because it violates the layering principle. If the multi-squad model only exists inside one host, every other host has to reinvent published squad mustering by call-sign, assignment reading, ambient personal matching, and roster composition independently, which defeats the goal of an upstream-friendly kernel.

**Full private fork.** Rejected because it fails the P1 goal of contributing value upstream and creates long-term maintenance drag. The better approach is to upstream the reusable primitives and keep org-specific behavior in layers above Squad.

### 23. Appendix B — Vocabulary cross-reference

| Term | Quick definition |
|---|---|
| **call-sign** | Identifier string for a squad. |
| **assign** | Connect a workspace to a squad by call-sign. |
| **assignment** | Recorded workspace-to-squad relationship. |
| **assignment ledger** | Record of workspace assignments. |
| **muster** | Bring an assigned or otherwise applicable squad into a specific session. |
| **active roster** | Set of squads and members active in the current session. |
| **report in** | What a mustered squad does once present: surface its members into the active roster. |
| **squad home** | Machine-local Squad directory for cache and bookkeeping. |
| **org** | Organization-wide squad kind. |
| **team** | Team-scoped squad kind. |
| **personal** | Person-scoped squad kind, advisory by default in shared work. |
