### PAO — Day in the Life: Casey via Rally

**Date:** 2026-05-15T23:45:52-07:00  
**Requested by:** Brady

Casey is brand new. Fresh laptop, fresh Slack channels, fresh uncertainty about which internal tool matters and which one is just lore. The good news in this variant is that nobody tells her to install `squad-cli`. They tell her one thing: install Rally. That is simpler. It gives her one front door.

She installs GitHub CLI, signs in, installs Rally, and tries the obvious first move:

```powershell
npm install -g github:jsturtevant/rally#v0.2.0
gh auth login
rally dashboard
```

Rally opens, but instead of a blank dashboard it gives her a useful first-run state:

```text
Rally Dashboard

No projects yet.
No squads connected yet.

Get started:
  1. Add the squads you use
  2. Onboard a repo

s squads  o onboard  q quit
```

That is the first place Rally’s existing dashboard-centric posture helps. Casey does not need to learn the product map first. The home screen can act like setup.

She hits `s`, gets a simple menu, and sees the first **new** command the org-scale story earns: `rally squad add`.

It exists because Casey’s squads do not all come from one place. Her personal squad lives in OneDrive. Foo team keeps theirs in GitHub. Bar team keeps theirs in ADO. The org-wide squad is published centrally. If Rally cannot register squad sources cleanly, Casey is dead in the water before she ever touches code.

She pastes what people send her.

```powershell
rally squad add C:\Users\Casey\OneDrive\Squad\personal --name casey-personal
rally squad add https://github.com/acme-internal/foo-squad --name foo-team
rally squad add https://dev.azure.com/acme/Developer%20Platform/_git/bar-squad --name bar-team
rally squad add https://github.com/acme-internal/org-squad --name acme-org
```

Rally answers in plain English, not storage jargon:

```text
Added squad "casey-personal" from OneDrive folder
Added squad "foo-team" from GitHub
Added squad "bar-team" from Azure DevOps
Added squad "acme-org" from GitHub

Tip: Rally keeps local copies in ~/rally/squads/ so you can work consistently across repos.
```

Casey likes that. She does not have to understand backend types. She just sees names she can trust.

Her first friction point arrives immediately, and it is real: this is still a lot of setup before one line of code. Casey has to know where those squad definitions live. Rally can smooth the commands, but it cannot invent org knowledge. The right design move is not more explanation. It is better discovery: an IT-provided starter file, team directory integration, or a paste-once company bootstrap command later. Day 1 should not depend on tribal knowledge in Slack.

Now she onboards repos. Rally’s existing `rally onboard` shape still works well here.

```powershell
rally onboard acme/Foo
rally onboard acme/Bar
rally onboard D:\src\Baz
```

What she sees is familiar Rally behavior:

```text
✓ Registered Foo
  Local path: C:\Users\Casey\rally\projects\Foo
  Worktrees: C:\Users\Casey\rally\projects\Foo\.worktrees\

✓ Registered Bar
  Local path: C:\Users\Casey\rally\projects\Bar

✓ Registered Baz
  Local path: D:\src\Baz
```

So far, so good. Then Casey hits the real org-scale problem: Foo contains both Project A and Project B, and they should not use the same squad.

This is where Rally’s current repo-centric model starts to strain. If onboarding only means “one repo, one squad,” Casey is stuck. The system needs a folder-level choice she can make without learning any internal theory words.

That earns the second **new** command: `rally squad use`.

Casey changes into each working area and tells Rally the obvious thing in the most human way possible.

```powershell
cd C:\Users\Casey\rally\projects\Foo\services\project-a
rally squad use acme-org

cd C:\Users\Casey\rally\projects\Foo\services\project-b
rally squad use foo-team

cd C:\Users\Casey\rally\projects\Bar
rally squad use bar-team

cd D:\src\Baz
rally squad use casey-personal --only
```

The output matters a lot:

```text
Using squad "acme-org" for Foo\services\project-a
Using squad "foo-team" for Foo\services\project-b
Using squad "bar-team" for Bar
Using squad "casey-personal" only for Baz

Baz will not inherit org or team squads.
```

`--only` earns itself. Casey absolutely needs a plain-English way to say “this repo is mine; do not drag my employer’s shared context in here.” If Rally makes her express that with words like layering or inheritance, the design has already failed.

There is a smaller but important moment of magic here. Project A is lightly staffed. Casey does not need to model “Foo team, but actually org-wide here.” She just picks `acme-org` for that folder. Rally stores the rule. The machine can keep the nuance; Casey should not have to.

She still wants proof before she trusts it. That earns the third **new** command: `rally squad status`.

```powershell
cd C:\Users\Casey\rally\projects\Foo\services\project-a
rally squad status
```

Rally answers with confidence, not internals:

```text
Current location: Foo\services\project-a
Squad: acme-org
Why: this folder has its own squad choice
Also available nearby: foo-team
```

For Project B it says `foo-team`. For Bar it says `bar-team`. For Baz it says `casey-personal` and `Personal only: yes`.

That is a trust-building screen. Casey is new. She needs a fast “am I about to send this issue to the right AI team?” check.

Now the dashboard becomes useful again. This is where Rally’s existing shape fits the story almost perfectly. Casey does not want to remember four repos, three shared squads, one personal squad, and which folder maps to what. She wants one home screen.

She opens it:

```powershell
rally dashboard
```

And now the dashboard has one extra piece of information it did not need before at small scale: the active squad next to each item.

```text
Rally Dashboard

 Issue/PR                                      Squad           Status
Foo
❯ Issue #1284  Project A: fix timeout          acme-org        ready
  Issue #1291  Project B: rotate certs         foo-team        ready
Bar
  Issue #221   Improve cache warmup            bar-team        ready
Baz
  Issue #9     Add shell helpers               casey-personal  ready

4 ready

n new dispatch  d details  v VSCode  a attach  l logs  s squads  q quit
```

That is the second moment of magic. Same repo, different folders, different squad outcomes, visible without Casey drilling into configuration.

She dispatches work from the dashboard. Rally does the normal Rally things: issue selection, worktree creation, Copilot session launch, logs, attach, browser open. But under the covers, something has to be different for this org-scale variant to really work: Rally cannot keep thinking of `.squad/` as one static symlink at the root of Foo. For Foo, that would be wrong half the time.

The right implementation is worktree-time materialization. When Casey dispatches a Project A issue, Rally creates the worktree and places the **effective** squad there for that job. When she dispatches a Project B issue, the worktree gets the Foo team squad instead. Casey never sees the mechanism. She just sees the right team show up.

By the end of the afternoon, “done” on Casey’s machine looks like this:

```text
C:\Users\Casey\rally\
├── config.yaml
├── projects.yaml
├── squads.yaml                 # NEW: registered squad sources + friendly names
├── rules.yaml                  # NEW: folder/repo choices Casey made
├── active\
├── logs\
├── squads\
│   ├── casey-personal\
│   ├── foo-team\
│   ├── bar-team\
│   └── acme-org\
└── projects\
    ├── Foo\
    │   └── .worktrees\
    └── Bar\
        └── .worktrees\
```

And on disk outside `~/rally/`:

- `D:\src\Baz` stays Casey’s local repo, marked personal-only.
- `Foo` and `Bar` stay clean working copies.
- Dispatch-specific worktrees hold the effective `.squad/` state for the job that is running.
- Casey does **not** need four permanent `.squad/` check-ins across three repos just to get started.

That is where Rally’s central store maps cleanly to the problem. A shared external home for project registration, logs, active sessions, and squad source caching is exactly what this story needs.

But it also shows where Rally strains. Today Rally thinks naturally in projects and dispatches. Org-scale multi-squad forces it to think in **locations inside projects**. That is a bigger shift than adding one more config file. The moment two services in one repo need different squads, repo-root symlinking stops being a good mental model.

The next morning Casey comes back to Project A. She does not open `squad-cli`, because in this world she never installed it. She opens Rally.

```powershell
cd C:\Users\Casey\rally\projects\Foo\services\project-a
rally squad status
rally dashboard
```

The status check says `acme-org`. She presses `a` to attach to the existing session or `v` to open the worktree in VS Code. What changes because Rally exists is not just convenience. It removes the identity question at the start of the work.

Casey does not ask herself:

- Which squad should I use here?
- Is this the Foo squad repo or the org squad repo?
- Did I point this checkout at the wrong `.squad/` folder?
- Is Baz accidentally carrying employer context?

Rally answers those questions before she has to form them. That is the right day-1 experience.

## New commands this story earned

- **`rally squad add` (NEW):** Casey needs one place to register squad sources from GitHub, ADO, OneDrive, or filesystem paths.
- **`rally squad use` (NEW):** Casey needs a folder-or-repo-level choice, especially when two services in one repo should not use the same squad.
- **`rally squad status` (NEW):** Casey needs a plain-English confidence check before dispatching work.

If Rally can do those three things without leaking internal vocabulary, its existing dashboard-first posture carries the rest of the story well.