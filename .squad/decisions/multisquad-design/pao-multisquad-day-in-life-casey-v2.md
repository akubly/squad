### PAO — Day in the Life: Casey's First Day with Squad

I open my new laptop expecting the usual first-day ritual: sign into six things, fail at three of them, and spend the morning learning which internal wiki page still matters.

Instead I get one short onboarding note from IT.

```text
Your box is ready.
`squad-cli` is already on your path.
The org call-sign and your team call-signs are reachable.
Clone what you need and start working.
```

That is such a suspiciously short note that I trust it immediately.

I clone the repos Aaron mentioned in my setup mail.

```powershell
PS D:\work> git clone https://example.com/Foo.git
PS D:\work> git clone https://example.com/Bar.git
PS D:\work> git clone https://example.com/Baz.git
```

By the time the progress bars stop, I know just enough to be dangerous.

- `Foo` is where Team A keeps Project X and Project Y.
- `Baz` is where Team B keeps Project Z.
- `Bar` is not a product repo at all. Team A publishes its `team-a` call-sign there so other projects can assign it without copying a whole `.squad` tree around.

That third point is the first thing that feels new in a good way. The call-sign is its own thing. The code can live in one repo. The squad can live in another. My first-day brain understands that faster than I expect to.

I start with Project Z in `Baz`, because I want one clean success before I learn any new nouns.

```powershell
PS D:\work\Baz\Project-Z> squad-cli
```

It behaves exactly like the getting-started docs said it would.

One Lead. One set of helpers. One session. No extra questions. No new terminology. No explanation banner teaching me a new mental model before I have written a line of code.

That matters more than it sounds like it does.

Project Z is Team B's project, and the out-of-the-box Squad experience just works there. If nobody had told me there was a bigger multi-squad story anywhere in the company, I would not learn about it from this repo. I would just think, "Nice. The CLI works." For a first day, that is a gift.

I spend half an hour following a README, fixing a tiny config path, and proving to myself that my terminal, editor, and Git setup are all normal. It is gloriously boring.

Then I move to `Foo`, where the interesting part starts.

Project X belongs to Team A, but Team A does not keep its squad files in `Foo`. They publish the `team-a` call-sign from `Bar`, and projects that need it assign that call-sign where it belongs. I open the project folder, type the obvious thing, and hope the obvious thing exists.

```powershell
PS D:\work\Foo\Project-X> squad-cli assign team-a
```

It does.

```text
Assigned call-sign: team-a
Source: Bar
Recorded in assignment ledger
Cached in squad home

Org call-sign will report in here automatically.
Run `squad-cli explain` if you want to see why.
```

I actually laugh at "Source: Bar." It is so matter-of-fact that it makes the whole design feel normal. Of course the Team A call-sign can live in `Bar` while the code lives in `Foo`. Of course the assignment ledger is the thing that remembers that relationship. Of course my squad home keeps the cached copy so I do not have to think about where it came from after the first assignment.

This is the first small moment of delight on the day: I do not copy files. I do not vendor a team setup into my repo. I point Project X at the right call-sign and keep going.

I am still new enough to want proof, so I ask for it.

```powershell
PS D:\work\Foo\Project-X> squad-cli explain
```

```text
Project X uses:
  owner: team-a
  constraining: org

Why:
  - this workspace is assigned to the `team-a` call-sign
  - your company marks the org call-sign as active for shared engineering policy
  - Team A owns execution here

If you say "Lead," Squad routes to Team A's Lead for local work.
Org guidance still applies where your company says it does.
```

That is exactly the answer a new person needs.

Not a lecture. Not a theory. Just plain English: Team A owns the work here, the org call-sign reports in because the company wants shared guardrails, and I do not need to guess which Lead I am talking to.

The phrase that sticks in my head is **active roster**. I can feel myself learning it by example instead of by glossary. Project X has an active roster of more than one squad. I can see who is in the room and why.

Project Y is one folder over, so I try the same question there.

```powershell
PS D:\work\Foo\Project-Y> squad-cli explain
```

```text
Project Y uses:
  owner: org

Why:
  - no team assignment is recorded for this workspace
  - the org call-sign applies by default here
```

That is my first friction beat of the day, and it is the good kind.

I stare at the screen for a second and think: wait, same repo, different answer?

Then I remember what the assignment ledger is for. Repo boundaries are not the same thing as workspace intent. Project X is assigned to Team A. Project Y is not. The CLI tells me that without making me reverse-engineer folder conventions or bother a teammate. It is one of those tiny trust-building moments where the system does the obvious right thing and then bothers to explain itself.

By lunch I am ready to start real work in Project X: a setup task with a very first-day flavor, half bug fix and half archaeology. A request handler needs to call a shared service, and the README in the folder still points at an old helper package.

I start a session.

```powershell
PS D:\work\Foo\Project-X> squad-cli
```

This time the banner is different.

```text
Project X • active roster: team-a, org
Local execution: team-a
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
Routing to Team A Lead for Project X.
Org guidance is active for approved auth paths.
```

Then Team A's Lead responds first, because Team A owns the code in front of me. The org side reports in one beat later with the boring constraint my company has already declared for this kind of work: use the approved auth package line, keep the existing audit hooks, and do not invent a local exception.

That is the collaboration moment, and it earns its place because it feels like real work instead of a brochure.

The broader squad constrains. The closer squad executes. Nobody gives me a sermon about hierarchy. Nobody stages a showdown between two Leads. The org policy for this class of question is already configured, so the whole chain-of-command issue lands with the emotional intensity of a lint rule.

Team A's Lead says, in effect, "Fine, same local fix, different package choice," and keeps moving.

That is the part I find reassuring. The active roster is larger, but the work is not mushier. More expertise is present, not more confusion.

The rest of the session feels like a team that is slightly bigger than the repo around it.

Team A contributes the local runbook, the repo habits, and the part where someone clearly remembers why this handler was split in the first place. The org call-sign contributes exactly the broad things I want broad guidance for: approved auth paths, logging expectations, and one quiet reminder about which internal tool boundary I should not cross on a Tuesday afternoon when I still have not learned everyone's name.

What I do not get is just as important.

I do not get the org side picking variable names.
I do not get my personal preferences pretending to outrank shared repo rules.
I do not get one merged blob of advice that makes it impossible to tell who is responsible for what.

At one point I get curious and ask to see the active roster spelled out.

```powershell
PS D:\work\Foo\Project-X> squad-cli roster
```

```text
Active roster

  team-a  (owner)
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
Scribe recorded the implementation note under team-a.
Org history received a breadcrumb because shared policy constrained this session.
```

Perfect. One session Scribe. One canonical home for the local decision. A breadcrumb where the broader squad needs to remember it. I do not need to know the file layout to appreciate that somebody thought carefully about ownership.

By late afternoon, the work is ready for review. I push my branch and open a pull request on the mono-repo. I half expect to see some squad noise in the diff — history files, decisions logs, session artifacts. The old way (or so I am told by a teammate over chat) would have meant choosing: commit the squad state alongside the product code and fight the branch policy to land it, or open a second PR just for the squad files and hope someone rubber-stamps it.

Instead, when I scroll through the diff, there is nothing but product code. The request handler. The test case. A note in the shared runbook. No `.squad/decisions.md` churn. No `agents/*/history.md` entries. No orchestration logs.

It is so clean that I have to ask.

I message my tech lead: "Did the squad state just... not land?"

The answer is matter-of-fact: "It landed. It is just not in your branch diff. Contoso's engineering team set the org squad to use an orphan-branch backend when they registered the call-sign. All the mutable state—decisions, histories, session logs—lives on a separate git branch that is invisible to your working branch and your PR. The static config stays on main so reviewers can see it. The noise is just... gone."

I read that twice. It hits like the assignment ledger hit this morning, except bigger.

No cherry-picking. No "can you review this PR?" in parallel to the actual work PR. No policy exceptions. No coordination tax. The squad state is there. The work is clean. They are just not the same thing anymore.

For a moment, I think about the cognitive load this removes. Every PR I open from here on, reviewers see only the product signal. The team decisions and squad histories are recorded, but they do not clutter the review. That is the kind of detail that compounds over time. A hundred PRs, a hundred clean diffs.

My teammate continues: "Your personal squad, your team's squad, the org squad—they all live on that same hidden branch. Mutable. Distributed. Transparent to the product repos. If you set up a project in one of the ancillary repos where there is no PR review policy, you could flip it back to the default `worktree` backend if you wanted the state on your working branch. But here, where everyone reviews code, the orphan branch is the sensible default."

I nod even though this is a chat window.

The contrast is sharp enough that I have to sit with it for a second. This is one of those features that sounds small until you realize it removes an entire category of friction. No more git tax. No more state-separation strategy. The framework just handles it.

By the time I close my laptop that evening, the whole day has sorted itself into a mental model I can actually carry.

- Project Z in `Baz` is the classic case. It is just Squad, exactly the way a normal single-squad project expects it.
- Project X in `Foo` is the collaboration case. I assign Team A's call-sign, the org call-sign reports in, and the active roster gets bigger without getting sloppy.
- Project Y in the same repo proves the system is paying attention to the workspace, not just the clone. No assignment there means no surprise Team A context there.
- `Bar` proves the squad artifacts are distributable. Team A's call-sign can live in one repo and serve work in another.

That last point keeps coming back to me because it feels like the design crossed from clever to useful. The assignment is the important thing, not the storage coincidence. A workspace can be assigned the right call-sign whether the squad lives beside the code, somewhere else in the org, or in my own squad home.

I do have a personal call-sign, a tiny `casey-helpers` setup I keep around for evening scripts and weekend nonsense, but it barely shows up today. That is correct. Work comes first in the work repos. Personal help is there when I need it, not waving its arms in front of every prompt.

By the time I close my laptop, I trust two things.

First, the default experience was protected. Team B's Project Z did not suddenly become a lesson in organizational topology just because the company happens to use multi-squad features elsewhere.

Second, the more advanced experience was still understandable. When Project X needed more than one squad active at once, the vocabulary held. Call-sign. Assign. Assignment ledger. Squad home. Active roster. Report in. None of it felt like I had wandered into an API reference by accident.

It just felt like the system telling me, plainly, who was helping, who owned the work, and why.

The next morning I open Project X again, and everything is right where I left it.
