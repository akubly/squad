@Lead and Team, this is the Phase B replay session for piece 25.5 of the upstream-bradygaster effort.
Phase A staged piece 25.5 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 25.5 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-25-resolver-rename-and-cli-hardening
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/25.5-doctor-cleanup-test-regression-repair.md
```

If `25.5-doctor-cleanup-test-regression-repair.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Procedures to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. No comparison framing, no version leaks, no fork residue.

---

## Piece 25.5 — Doctor cleanup test regression repair

Piece 25.5 closes fork-introduced test regressions that accumulated through the doctor cleanup arc. The branch tip of piece 25 has approximately 32 failing tests across 16 files. After upstream comparison, 5 are upstream-inherited (out of scope); the rest are fork-introduced and must be fixed. This piece ships a single squashed commit restoring a fully green baseline (modulo the 5 acknowledged upstream-inherited failures).

**This piece is not a feature piece.** The tests are already written and already red. The work is: make the existing failing tests pass. No new test files are added except when sub-proposal G discovery reveals the need for fixture adjustments.

### Scope (sub-proposals A–G)

- **A** — Wire `doctor-types.ts` and `init-remote.ts` into `cli-entry.ts` dispatch
- **B** — Repair Doctor output headers (`System doctor`, `Registry doctor`, `Squad Doctor`) and exit-code behavior (doctor must exit 0 when system checks fail; only registry errors drive non-zero exit)
- **C** — Repair Consult precondition check: emit `Not a git repository` before squad resolution, not `No squad found`
- **D** — Wire `getRalphScanCommands('planner')` to `getPlannerRalphCommands()` in the switch
- **E** — Change `detectPlatformFromUrl` and `detectWorkItemSource` fallbacks from `'unknown'` to `'github'`
- **F** — Identify and repair the 1 failing test in `register.test.ts` and confirm dispatch-help failures are fully closed by sub-proposals A–B
- **G** — Run the full suite, enumerate remaining failures beyond the 10 sampled, fix fork-introduced failures, and document upstream-inherited ones

### Triage

Sub-proposals A through F are evaluable against the spec and should be accepted or deferred before implementation begins. They are independent and can be implemented in any order once accepted.

Sub-proposal G is open-scope discovery. The implementer cannot triage G before running the suite. Execute A–F first, then run `npx vitest run`, then address whatever G reveals.

### Verify-first probe (MANDATORY — do this before implementing anything)

Before writing a single line of fix code, run the full test suite on the newly created branch and capture the output:

```
npx vitest run 2>&1 | Tee-Object failing-baseline.txt
```

Save `failing-baseline.txt` in the repo root. This file goes into the commit so reviewers can see exactly what was red before the fixes. It also anchors sub-proposal G — you cannot enumerate unknown failures without a baseline.

The expected baseline failure count is approximately 32 tests. If the count is significantly different (e.g., <10 or >50), pause and assess — the branch or build state may not match the spec's assumptions.

---

### Workflow

**a.** Create the branch:

```
git checkout squad/piece-25-resolver-rename-and-cli-hardening
git pull origin squad/piece-25-resolver-rename-and-cli-hardening
git checkout -b squad/piece-25.5-doctor-cleanup-test-regression-repair
```

**b.** Run the verify-first probe (see above). Capture `failing-baseline.txt`.

**c.** Triage sub-proposals A–F: accept or defer each. Record deferred sub-proposals in `.squad/decisions/inbox/` with rationale. Sub-proposals that are accepted proceed to step d.

**d.** For each accepted sub-proposal, fix the regression. The tests are ALREADY RED — RED → GREEN means making existing failing tests pass without breaking passing ones.

  Per sub-proposal fix sites (exact lines from the spec):
  - **A**: `packages/squad-cli/src/cli-entry.ts` — add `import type { DoctorFinding } from './cli/commands/doctor-types.js'` at the static import section (~line 93); add `const { writeRemoteConfig } = await import('./cli/commands/init-remote.js')` + call inside the `mode === 'remote'` init branch (~line 356).
  - **B**: `packages/squad-cli/src/cli-entry.ts` unified doctor block (~lines 1059–1079) — change section labels to `System doctor`/`Registry doctor`; add `Squad Doctor` header; add `Summary:` prefix to count line; filter to `source === 'registry'` before calling `deriveExitCode`.
  - **C**: `packages/squad-cli/src/cli-entry.ts` consult section (~line 1081) — add git repo check before squad resolution; emit `Not a git repository` and exit 1 when git is absent.
  - **D**: `packages/squad-sdk/src/platform/ralph-commands.ts` `getRalphScanCommands` switch (~line 26) — add `case 'planner': return getPlannerRalphCommands();`.
  - **E**: `packages/squad-sdk/src/platform/detect.ts` — change `return 'unknown'` to `return 'github'` in `detectPlatformFromUrl` (~line 139) and the `detectWorkItemSource` catch block (~line 216).
  - **F**: Run `npx vitest run test/cli/register.test.ts` in isolation; identify the 1 failing test; fix shipped code or adjust the test per implementer judgment; document in commit body.

**e.** After implementing A–F, run the full suite again:

```
npx vitest run
```

The failure count should drop significantly. Any remaining failures beyond the 5 acknowledged upstream-inherited tests are sub-proposal G work.

**f.** Sub-proposal G: for each failure not covered by A–F and not in the acknowledged upstream-inherited list, determine whether it is fork-introduced (fix it) or upstream-inherited (document it). A failure is upstream-inherited if the same behavior exists on `origin/dev`. Document the determination for every G failure in the commit body.

**g.** Run the scrub gate. Note: piece 25.5 branches from piece 25, which predates the gate additions in piece 30.5. Use only gates 1–6:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate-temp.ps1
pwsh scrub-gate-temp.ps1
Remove-Item scrub-gate-temp.ps1
```

All 6 gates must pass. If gate output references gates 7–9, those are from a future piece and do not apply here — ignore them only if the gate script itself exits 0. Do not bypass any failing gate.

**h.** Add a changeset. Sub-proposals A, B, C touch `packages/squad-cli/src/`; D, E touch `packages/squad-sdk/src/`. Both packages need a `patch` changeset entry:

```
npx changeset add
```

**i.** Commit as a single squashed commit:

```
git add packages/squad-cli/src/cli-entry.ts
git add packages/squad-sdk/src/platform/ralph-commands.ts
git add packages/squad-sdk/src/platform/detect.ts
git add failing-baseline.txt
# ... add any additional files touched by G
git add .changeset/
git diff --cached --stat    # verify: matches intent, no unintended files
git diff --cached --diff-filter=D --name-only    # verify: no unintended deletions
```

Commit message format:

```
piece 25.5: doctor cleanup test regression repair

Sub-proposals addressed: A (cli wiring), B (doctor headers + exit code),
C (consult precondition), D (ralph planner routing), E (detect fallbacks),
F (register test), G (discovery — N additional failures fixed)

Tests transitioned RED → GREEN: NN
Acknowledged upstream-inherited failures (unchanged): 5
  - dual-root-resolver → returns local mode when no config.json exists
  - dual-root-resolver → falls back to local mode on malformed JSON
  - scheduler → LocalPollingProvider should execute script tasks
  - acceptance → Init command: Init in existing project shows ready message
  - team-root-resolution → invalid SQUAD_TEAM_ROOT path → resolveSquad returns null

[Final failing-test list from failing-baseline.txt with each entry marked [upstream] or [fixed]]

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

**j.** Push:

```
git push -u origin squad/piece-25.5-doctor-cleanup-test-regression-repair
```

**k.** STOP. Do not open a PR. Phase B ends at push. Phase C handles PR opening as a separate workflow.

---

### Must-not violations

- The 5 upstream-inherited tests MUST NOT be addressed. If an implementation accidentally makes one of them pass, document it as a bonus but it does not count toward the completion criterion.
- Do NOT commit `failing-baseline.txt` with a stale or pre-implementation run — it must capture the state at the branch tip BEFORE any fix is applied.
- The commit body MUST include the final failing-test list with each entry marked `[upstream]` or `[fixed]`. No exceptions.
- Do NOT create a PR in this session.
