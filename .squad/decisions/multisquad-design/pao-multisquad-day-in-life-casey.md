### PAO — Day in the Life: Casey's First Day with Squad

I open my new laptop on Friday morning, still half expecting setup to be a scavenger hunt. Brady's onboarding note in Teams is short enough that I trust it.

```text
Install done by IT. Open PowerShell and run:

squad welcome
```

That is the whole note. No wiki maze. No warning that I need to understand how Squad is wired.

So I do it.

```powershell
PS C:\Users\Casey> squad welcome
```

The screen pauses for a second, then fills in like a travel itinerary.

```text
Welcome to Contoso Engineering.

Signed in as: casey@contoso.com
Copilot access: ready
Company tools: installed by your org
Shared help available to you:
  • Contoso Engineering
  • A-Team
  • B-Team

Next steps:
  1. Clone a repo
  2. Open a folder
  3. Run squad status if you want to see what help applies there
```

I smile at “what help applies there.” That phrasing tells me more than any internal noun would. I do not need to know where those squads live. I only need to know they exist, I can use them, and the machine already trusts them.

That is the first moment of magic: the org has already handled the boring part. Tools show up. Shared help shows up. I did not paste tokens or browse for configuration files.

I clone the three repos I need.

```powershell
PS C:\Users\Casey\src> git clone https://github.com/contoso/Foo.git
PS C:\Users\Casey\src> git clone https://github.com/contoso/Bar.git
PS C:\Users\Casey\src> git clone https://github.com/contoso/Baz.git
```

My first real assignment is split across two services inside the same Foo repo, which is exactly the kind of thing I expect to get weird.

I start in Project X.

```powershell
PS C:\Users\Casey\src\a-team\services\project-x> squad status
```

```text
This folder is ready.

Using now: Contoso Engineering
Why: your company help applies here, and no team help has claimed this folder.
Also available: personal help (none yet)
Tools added automatically by your org: 12

Tip: run squad start to open a session here.
      run squad choose if this doesn't look right.
```

I actually say “oh, good” out loud.

Not because it picked the org-wide squad. Because it told me why in plain English.

I still hesitate. Both Project X and Project Y are owned by the A-Team. My new-person instinct says the whole repo should probably use the A-Team squad. The screen says otherwise. This is my first friction point: I do not know whether the system is being smart or whether I am about to build context on top of the wrong guidance.

So I message my teammate Maya.

> Hey — for project-x, should I be on A-Team or just the company squad?

She replies in under a minute.

> project-x stays on company defaults. We never made a dedicated A-Team setup for it. project-y uses A-Team.

That exchange is important. The system got the answer right, but as a new developer I still needed social confirmation because the repo shape and the help shape did not match. If Squad wants me to trust it faster, it should be able to show me one more sentence: “This project intentionally uses the company squad.” That would remove a teammate ping.

I move to Project Y.

```powershell
PS C:\Users\Casey\src\a-team\services\project-y> squad status
```

```text
This folder is ready.

Using now: A-Team + Contoso Engineering
Why: A-Team covers this service. Company help fills in the shared tools and guardrails.
From A-Team: code owners, local runbook, release habits
From Contoso Engineering: company tools, security rules, onboarding links

Tip: run squad explain if you want the short version you can paste to a teammate.
```

This is the second moment of magic: the same clone, different subfolder, different answer, and the answer feels obvious once I see it. I do not have to clone a-team twice. I do not have to turn anything on. The session simply fits the folder I am in.

I try the extra command because I am curious.

```powershell
PS C:\Users\Casey\src\a-team\services\project-y> squad explain
```

```text
You are in a-team/services/project-y.
Active help order here:
  1. A-Team
  2. Contoso Engineering

In plain language:
  This service uses the A-Team playbook, plus the company defaults everyone gets.
```

That is the kind of output I would screenshot for a teammate. No internals. No lecture.

By lunch I switch to Project Z in the B-Team repo.

```powershell
PS C:\Users\Casey\src\b-team> squad status
```

```text
This folder is ready.

Using now: B-Team + Contoso Engineering
Why: B-Team is the shared help for this repo.
Fetched from:
  • B-Team — GitHub
  • Contoso Engineering — company catalog
```

I notice the little “Fetched from” lines because they explain a subtle thing without making it my problem. Squad is quietly telling me it can pull help from different places and still make one coherent experience out of it. I do not need to know why B-Team is in GitHub while A-Team apparently came from an internal system. I only need to trust that it all arrived and that it is current.

The third repo, casey-tools, is mine. No team owns it. I do not want company defaults or team playbooks nudging my little helper-tools project.

This is the biggest moment of choice all day, because only I can answer the question “do I want my own squad here?” and only I can say whether it should be private to this repo or follow me elsewhere.

```powershell
PS C:\Users\Casey\src\casey-tools> squad status
```

```text
No shared help applies to this folder.

You can:
  1. Use Contoso Engineering here anyway
  2. Create personal help for this repo
  3. Keep this folder plain for now

Tip: if this is your own project, most people choose option 2.
```

I pick option 2.

```powershell
PS C:\Users\Casey\src\casey-tools> squad choose
```

The prompt feels like a person, not a config wizard.

```text
What do you want to call your personal help?
> Casey's Bench

Where should it live?
  [1] On this machine only
  [2] My OneDrive so it follows me
> 2

Where should it apply?
  [1] Only this repo
  [2] Any repo I choose later
> 1

Should company or team help also apply here?
  [y/N]
> n
```

Then:

```text
Created: Casey's Bench
Saved to: OneDrive
Applies to: casey-tools only
Company and team help: off for this repo

Next step: run squad start
```

I love that last confirmation line. “Company and team help: off for this repo.” That is the whole contract in one sentence. It means I do not have to wonder whether some invisible company rule is still whispering in the background.

That is the fourth moment of magic: exclusion is explicit. Squad does not make me learn a negative form of configuration. It just says what is off.

By the end of the day, “done” looks surprisingly concrete.

On disk, I have three normal clones: a-team, b-team, and casey-tools. Inside them, there are tiny human-readable Squad files that I can inspect if I care, but I do not need to hand-edit them. a-team remembers that project-x uses the company squad while project-y uses A-Team plus company defaults. b-team points at B-Team plus company defaults. casey-tools points only at Casey's Bench. My personal squad itself lives in OneDrive, which means if I replace this laptop next month, I do not lose the tone, shortcuts, and habits I add to it.

In my head, I now understand Squad in one sentence: it gives me the right help for the folder I am standing in. Sometimes that help comes from the company, sometimes from a team, sometimes from me, and sometimes from all three. What matters is that Squad can explain the choice in plain English whenever I ask.

If a friend asks me how Squad works for me, I say: “It is like opening a project and having the right teammate already in the room. If I move folders, the teammate changes. If I want my own setup, I can say ‘only mine here’ and it listens.”

The next morning, I open Project X first.

```powershell
PS C:\Users\Casey\src\a-team\services\project-x> squad start
```

Before the prompt even appears, I get a one-line banner.

```text
Contoso Engineering active here • no team help for this service • last checked: today 8:14 AM
```

That banner is the confirmation I need. It tells me the machine still remembers yesterday's answer. It also tells me what would be wrong. If I ever open Project X and see “A-Team active here,” I know something drifted. If I open Baz and see company help turned back on, I know my personal-only rule was not respected. If Squad cannot tell me why it picked what it picked, I know the design has become too clever for its own good.

But this morning it does tell me. So I get to do the thing new developers actually want to do: start working, without first becoming an expert in the plumbing.