### PAO — Day in the Life: Casey via the Org Tool

It is Casey’s first morning with a fresh corp laptop. She has heard that the company has an internal developer tool called `eng`, and that if `eng` works, most of the other setup pain usually disappears with it. She has not heard the word “Squad.” She does not need to.

The machine already came from IT with `eng` installed through the standard devbox image, so Casey starts the way every new engineer around here starts:

```powershell
eng doctor
```

What she sees feels reassuringly corporate instead of hobbyist:

```text
Contoso Engineering Workstation Check

✓ Device compliant
✓ Corp SSO session available
✓ Git configured for GitHub Enterprise
✓ Copilot entitlement verified
✓ Internal package feed reachable
✓ AI workspace runtime installed

Next step: clone a repo or run 'eng ai status' inside an existing repo.
```

That is the first big relief point. Casey does not choose a runtime, a state backend, a template source, or an auth flow. `eng` already knows the company identity provider, the right Git host, and that company-managed AI tooling is allowed on this machine. The org made those calls for her.

She clones the repos she needs:

```powershell
eng clone Foo
eng clone Bar
eng clone Baz
```

`Foo` lands in `C:\src\Foo`, `Bar` in `C:\src\Bar`, and `Baz` in `C:\src\Baz`. Casey opens `Foo` first because it contains two projects.

At the repo root, she tries the obvious thing:

```powershell
cd C:\src\Foo
eng ai status
```

And this is the first moment where the org tool is smart enough to stop her before she makes the wrong mental model:

```text
Multiple registered projects found in this repo:

1. services\project-a   → Org-wide engineering squad
   Reason: Foo team coverage below staffing threshold
2. services\project-b   → Foo team squad

Run this command from a project directory, or choose now with:
  eng ai status --project services\project-a
  eng ai status --project services\project-b
```

Casey blinks at the first line. Project A is in the Foo repo, so she expects the Foo team assistant. Instead, `eng` explains the staffing override up front. That explanation matters. Without it, this would feel like a bug. With it, it feels like policy.

She moves into Project A:

```powershell
cd C:\src\Foo\services\project-a
eng ai status
```

This time the tool resolves everything for her:

```text
AI workspace ready

Project: Foo / Project A
Workspace owner: Org-wide engineering squad
Selection reason: Team fallback policy triggered for lightly staffed project
Identity: casey@contoso.com
State backend: worktree
Memory scope: project + org-shared
Approved tools: GitHub, work items, internal docs, repo search
```

This is a quiet magic moment. Casey never typed a squad URL. She never picked a roster. She never asked which agents exist. `eng` inferred the project from the repo URL and subdirectory, looked up the org catalog, checked the staffing rule, bound her identity through SSO, and presented a ready-to-use workspace. The company-specific knowledge is doing real work: repo topology, team ownership, fallback policy, approved tools, and auth are all pre-wired.

She starts a session:

```powershell
eng ai start
```

The session feels fast and contextual. More important, there is no “pick your state store,” “install these extensions,” or “sign in again” detour. The org tool already decided those defaults.

A little later she switches to Project B in the same repo:

```powershell
cd C:\src\Foo\services\project-b
eng ai status
```

The output is almost the same shape, but the binding changes:

```text
AI workspace ready

Project: Foo / Project B
Workspace owner: Foo team squad
Selection reason: Direct team match
Identity: casey@contoso.com
State backend: worktree
Memory scope: project + team-shared
Approved tools: GitHub, work items, internal docs, repo search
```

This is the second magic moment: one repo, two subdirectories, two different AI workspaces, no manual rebinding. Casey does not need to learn a new abstraction; she only needs to trust that `eng` treats the current directory as the unit of intent. The friction is mild but real: she learns quickly that running from the repo root is ambiguous in a multi-project monorepo. The tool can narrow choices, but it cannot always guess which subproject she means.

Project C is cleaner. `Bar` is its own repo, and Bar has its own team workspace.

```powershell
cd C:\src\Bar
eng ai status
```

```text
AI workspace ready

Project: Bar
Workspace owner: Bar team squad
Selection reason: Repo-to-team binding from org catalog
Identity: casey@contoso.com
State backend: worktree
Memory scope: project + team-shared
Approved tools: GitHub, work items, internal docs, repo search
```

By now the pattern is obvious. `eng` decides the things the org considers policy: approved workspace sources, org auth, connector set, team membership, and default memory scope. Casey still gets choices, but only where human judgment is useful: which repo to clone, which directory to work in, and when to start a session.

The most interesting case is Project D, her personal helper-tools repo in `Baz`.

She changes into it and runs the same command:

```powershell
cd C:\src\Baz
eng ai status
```

This time `eng` slows down and gets more explicit:

```text
Unregistered repo detected: Baz

This repo is not in the org project catalog.
You can start a personal AI workspace on this corp device with these limits:
  - local-only memory
  - no org-shared workspace publishing
  - corp connectors disabled by default
  - no automatic team binding

Continue? [Y/n]
```

Casey says yes, because this is exactly what she wants: help, but not a fake sense that her side project is somehow part of the company graph.

After confirmation, `eng` shows the boundary clearly:

```text
AI workspace ready

Project: Baz
Workspace owner: Casey personal workspace
Selection reason: personal fallback for unregistered repo
Identity: casey@contoso.com
State backend: worktree
Memory scope: local-only
Approved tools: local repo search, git, terminal
Restricted tools: org docs, work items, shared memory publish
```

This is where the org tool constrains Casey in ways a raw Squad-native experience might not. She cannot point the tool at any arbitrary shared squad source. She cannot publish Baz learnings into the company memory plane. She cannot casually blend personal work with corp connectors. On a corp machine, “personal” means sandboxed, not sovereign.

She is mildly annoyed for about thirty seconds, then mostly grateful. The guardrails make the boundary legible. Her personal project works, but it stays personal.

By late afternoon, “done” is surprisingly boring, which is the point. Casey has three cloned repos on disk: `C:\src\Foo`, `C:\src\Bar`, and `C:\src\Baz`. The org tool keeps its own worktree-backed session state, workspace resolution metadata, and connector caches under `%LOCALAPPDATA%\Contoso\eng\`, so the repo trees stay clean. Casey never sees where the canonical team definitions live, how repo-to-team fallback is mapped, or how corp SSO becomes approved tool access. That invisibility is part of the product promise.

The next morning is when the design either feels durable or fake. Casey opens a terminal in Project B and types:

```powershell
eng ai start
```

It feels immediate. The session opens with Foo-team context again. In Project A she gets the org-wide squad voice and memory. In `Bar`, the Bar context comes back. In `Baz`, the personal sandbox returns, still local-only, still missing corp connectors. The boundaries are noticeable, but not noisy.

That is probably the strongest signal that the org-tool variant works: the experience is not “learn one AI runtime.” It is “the right assistant shows up in the right place.”

She also loses something, even if she does not name it that way. She learns `eng`, not Squad. If she joins another company or goes home to a hobby repo, the repo bindings, policies, and commands do not come with her. A Squad-native CLI would likely expose more of the underlying model—sources, teams, storage choices, portable workflows. The org tool gives her less freedom and more safety.

From Casey’s point of view, that trade feels worth it. But the seam underneath has to be clean for this to work. `eng` has to be able to resolve everything before session start and hand the runtime a fully baked contract: the chosen workspace identity, memory scope, state location, approved tools, auth context, and per-directory binding. It also has to support more than one workspace inside a single repo, plus a sandboxed personal mode on the same machine. If the underlying runtime insisted on owning bootstrap, prompting for source URLs, or treating a repo root as the only binding unit, the illusion would break immediately.

Casey never says any of that out loud. She just notices that the company tool seems to know where she is, who she is, what she should get by default, and where the edges are. For a first day, that is exactly the right kind of magic.