1. @Lead and Team, this is the Phase B replay session for piece 47 of the upstream stack.
2. Phase A staged the piece 47 spec on the `akubly/upstream-specs` branch.
3. Phase B implements the accepted sub-proposals on their own branch, fully tested.
4. Phase C (later, separate sessions) opens the PRs against the upstream repository.
5.
6. You implement piece 47 this session. No PR creation in Phase B. Piece 47 REOPENS the stack
7. past the previously-"final" piece 46: a fresh dogfooding pass found a monorepo team-root
8. transport defect (live-reproduced) plus two sync registry-resolution gaps that piece 47
9. closes.
10.
11. Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
12. - Branch to create: `squad/piece-47-monorepo-gitdir-and-sync-registry-robustness`
13.   off `squad/piece-46-state-remote-resolution-hardening-and-transport-coverage` (tip 583543b9)
14. - origin → akubly/squad. Do NOT add other remotes.
15. - Upstream source material is not reachable from any git ref in this clone. Preserve
16.   that isolation.
17. - Work in an isolated git worktree so this session does not disturb other checkouts of
18.   the clone.
19.
20. Read these inputs in order before any work (use `git show` from the spec branch —
21. do NOT copy specs into your working branch):
22.
23. ```
24. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
25. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
26. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/41-fold-pipeline-repo-root-and-generic-discovery.md
27. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md
28. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/46-state-remote-resolution-hardening-and-transport-coverage.md
29. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/47-monorepo-gitdir-and-sync-registry-robustness.md
30. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
31. ```
32.
33. If `47-monorepo-gitdir-and-sync-registry-robustness.md` does not exist on
34. `akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
35. staged before this session proceeds.
36.
37. `_planning/dogfood-backlog.md` is the roadmap context. The backlog's "Operational
38. follow-ups" are host administrative actions, NOT stack pieces — ignore them as
39. implementation scope.
40.
41. Piece 47 fixes a monorepo team-root transport defect: the cross-repo transport assumes the
42. team root is the top of its own git repo and constructs the git directory as the literal
43. `<teamRoot>/.git` in two places. On a monorepo host whose `.squad` team root is in a
44. subdirectory (real `.git` at the repo root), both `--push` (isolated index under a
45. non-existent `<teamRoot>/.git`) and `--pull` (`git --git-dir <teamRoot>/.git ls-tree`) fail.
46. A, B, C are Tier 1 (implement). D is a Tier-2 decision (the `SQUAD_TEAM_ROOT` override's
47. interaction with registry-sourced callsign/state config) — triage it first and either
48. implement D1 (augment the override from a matching registry entry; **recommended**) or D2
49. (add explicit `--callsign`/state flags to `sync`) and record the rationale.
50.
51. ---
52.
53. ## Verify-first (before specifying or writing any change)
54.
55. Confirm the actual code shape on the piece-46 base; do not assume signatures or line numbers.
56.
57. - `publishTeamRootToInbox` in `packages/squad-cli/src/cli/commands/sync.ts` (~line 447).
58.   Step 5 builds the isolated index path as `path.join(teamRoot, '.git', 'squad-publish-index-...')`
59.   and passes it as `GIT_INDEX_FILE`. Confirm the neighbouring plumbing that uses `cwd: teamRoot`
60.   (e.g. the base-commit `git rev-parse HEAD` at Step 3, ~line 436) works on a monorepo subdir
61.   team root via upward repo discovery, while ONLY the explicit `<teamRoot>/.git` construction
62.   fails. Confirm the live failure: a monorepo team root in a subdirectory aborts `--push` with
63.   `fatal: Unable to create '<teamRoot>/.git/squad-publish-index-...lock': No such file or directory`.
64. - `hydrateTeamRootFromStateRef` in `sync.ts` (~line 601). Step 4 sets
65.   `normalizedGitDir = path.join(teamRoot, '.git').replace(/\\/g, '/')` and passes it as
66.   `--git-dir` to the `ls-tree` (~line 608) and per-file `cat-file blob` (~line 614) calls. The
67.   Step 1 fetch (~line 570) already uses `cwd: teamRoot` and so discovers the repo correctly —
68.   confirm that only the explicit `--git-dir` usage breaks on a monorepo subdir team root.
69. - Registry resolution in `runSync`: `loadRegistryFromDisk()` is called with NO arguments at
70.   both resolution sites (~lines 679 and 796). Confirm the SDK helper already accepts
71.   `loadRegistryFromDisk({ registryPath })` (`packages/squad-sdk/src/registry.ts` ~line 299 →
72.   `resolveRegistryPath` ~line 321) and that `init` exposes `--registry-path` while `sync` does
73.   not thread it. Confirm `sync` currently has no `--registry-path` in its help.
74. - The `SQUAD_TEAM_ROOT` override branch in `runSync` (~lines 792-794): when set, it adopts the
75.   env value as `teamRoot` and BYPASSES the registry `else` branch, leaving `registryCallsign` /
76.   `stateRemote` / `stateBranch` / `registryAlias` undefined. Confirm a cross-repo `--push` from
77.   an env-overridden team root then hits the callsign guard (~line 949) and exits
78.   `FATAL: no callsign set for this registry entry`, with no `--callsign` flag to compensate.
79. - The transport seam: `_transport` (export at `sync.ts` ~line 592:
80.   `hydrateTeamRootFromStateRef` / `publishTeamRootToInbox`). The existing piece-43/46 cross-repo
81.   integration tests (`test/cli/cross-repo-sync.test.ts`, `test/cli/cross-repo-pull-resolution.test.ts`)
82.   set up REAL bare git repos with single-repo team roots. Add NEW integration tests that use a
83.   MONOREPO host (team root in a subdirectory) end-to-end. Do not weaken the existing ones.
84.
85. ---
86.
87. ## Triage
88.
89. Before any code changes, triage the sub-proposals below and record decisions in
90. `.squad/decisions/inbox/piece-47-triage.md`.
91.
92. | Sub-proposal | Tier | Decision |
93. |---|---|---|
94. | A — Resolve the team root's real git dir via `git rev-parse --absolute-git-dir` (cwd = teamRoot) and place the isolated index inside it in `publishTeamRootToInbox`, replacing `<teamRoot>/.git` | Tier 1 | Accept |
95. | B — Use the same resolved git dir as `--git-dir` for the `ls-tree` / `cat-file` calls in `hydrateTeamRootFromStateRef`, replacing `<teamRoot>/.git` | Tier 1 | Accept |
96. | C — Thread `--registry-path` through `sync` into every `loadRegistryFromDisk({ registryPath })` call in `runSync`; surface it in `sync --help`; default behavior unchanged when absent | Tier 1 | Accept |
97. | D — `SQUAD_TEAM_ROOT` override + registry-sourced callsign/state: D1 augment from a matching registry entry, best-effort, env-only fallback when none matches (**recommended**); or D2 add explicit `--callsign`/state flags to `sync` | Tier 2 | Decide — record D1 or D2 with rationale |
98.
99. Record the triage outcome in `.squad/decisions/inbox/piece-47-triage.md` before writing any
100. product code.
101.
102. ---
103.
104. ## Workflow for piece 47
105.
106. **a.** Create the implementation branch off piece 46 (in a dedicated worktree):
107.
108. ```
109. git fetch origin
110. git worktree add -b squad/piece-47-monorepo-gitdir-and-sync-registry-robustness <worktree-path> squad/piece-46-state-remote-resolution-hardening-and-transport-coverage
111. ```
112.
113. **b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-47-triage.md`
114. before the first product file is modified.
115.
116. **c.** Implement TDD: write failing tests first, then implementation, red-to-green. A and B
117. are the git-dir correctness fix (share one small resolver helper); C is option threading; D is
118. the decided behavior. See implementation notes below.
119.
120. **d.** Run the scrub gate before committing:
121.
122. ```
123. git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
124. pwsh _scrub-gate-run.ps1
125. Remove-Item _scrub-gate-run.ps1
126. ```
127.
128. All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
129. contribute **no new** hits (compare against the piece-46 base — the count must not grow). The
130. stack's package scope is `@bradygaster/squad-*`; keep it as-is — do not introduce
131. any internal release scope into clean files.
132.
133. **e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched):
134.
135. ```
136. npx changeset add
137. ```
138.
139. Select `patch` for `@bradygaster/squad-cli`. Summary: "Resolve the team root's real git
140. directory via `git rev-parse --absolute-git-dir` in the cross-repo publish and hydrate paths
141. (fixing monorepo subdirectory team roots), thread `--registry-path` through `sync`, and make
142. the `SQUAD_TEAM_ROOT` override resolve the registry callsign/state config."
143.
144. **f.** Single squashed commit with the required trailer:
145.
146. ```
147. Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
148. ```
149.
150. Commit body: sub-proposals accepted (A/B/C and the D1/D2 outcome), triage outcome, scrub
151. gate result, and changeset classification.
152.
153. **g.** Push the branch:
154.
155. ```
156. git push -u origin squad/piece-47-monorepo-gitdir-and-sync-registry-robustness
157. ```
158.
159. **h.** STOP. Do not open a PR. When the branch is pushed, report piece 47 complete.
160.
161. ---
162.
163. ## Implementation notes
164.
165. ### Gotchas (established by prior pieces)
166.
167. - Use `npm install`, not `npm ci`.
168. - If a published `@bradygaster/squad-sdk` is nested under
169.   `packages/squad-cli/node_modules` and shadows the workspace source, remove it so the
170.   workspace source resolves.
171. - Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is
172.   `tsc --noEmit` (no churn).
173. - Run heavy git-integration test files isolated
174.   (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
175.   worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is
176.   infra flakiness — the "Tests N passed" line is the signal). The real-git fetch/push tests
177.   are slow on Windows — keep them isolated and give them headroom.
178. - Revert any incidental `package.json` / `package-lock.json` / build-stamp churn (the prebuild
179.   stamps a version into `package.json` x3 and `.github/agents/squad.agent.md`, and runs
180.   `sync-templates`) before committing.
181. - Known pre-existing failures on this stack (piece-38 sync/publish J6/J7/M2/O6/N2/PM1/PM2 and
182.   assign P34.A1/A3) — confirm they remain unchanged; do not attribute them to piece 47.
183.   Classify every regression-sweep failure as pre-existing-on-base vs. caused-by-this-piece
184.   (run the same file on the piece-46 base worktree to confirm).
185.
186. ### Sub-proposals A, B — resolve the real git dir
187.
188. Add a small helper (e.g. `resolveTeamRootGitDir(teamRoot)`) that runs
189. `git rev-parse --absolute-git-dir` with `cwd: teamRoot` and returns the trimmed path
190. (normalize separators the same way the current hydrate code does for the `--git-dir`
191. argument). `--absolute-git-dir` returns the repo's own `.git` for a single-repo host, the
192. repo-root `.git` for a monorepo subdirectory team root, and the correct linked-worktree git
193. directory for a worktree checkout.
194. - A (publish): build `GIT_INDEX_FILE` as `path.join(resolvedGitDir, 'squad-publish-index-...')`.
195.   Ensure the existing isolated-index cleanup (`fs.unlinkSync(indexFile)`) targets the new path.
196.   If git-dir resolution fails (team root not in a git repo), surface an actionable `SquadError`
197.   (from `packages/squad-cli/src/cli/core/errors.ts`), not a write under a non-existent path.
198. - B (hydrate): use the resolved git dir for the `--git-dir` args of the `ls-tree` and
199.   `cat-file blob` calls. Leave the Step 1 fetch (`cwd: teamRoot`) and the sentinel/idempotency
200.   logic unchanged.
201.
202. Tests (integration, real bare repos — model the fixtures on the existing
203. `test/cli/cross-repo-sync.test.ts` helpers; do NOT spy on `_transport`):
204. - Single-repo team root (team root == repo root): push publishes and pull hydrates exactly as
205.   today (regression guard).
206. - Monorepo team root in a subdirectory (init a working repo, create the `.squad` team root
207.   under e.g. `teams/<callsign>/.squad`, real `.git` at the repo root): `--push` publishes the
208.   inbox ref to a real bare remote (the live-defect regression test); `--pull` from a real bare
209.   state remote hydrates a known `.squad` file into the subdirectory team root.
210. - After a successful publish, the temporary isolated-index file does not remain in the resolved
211.   git directory.
212.
213. ### Sub-proposal C — thread `--registry-path`
214.
215. Add the `--registry-path` option to the `sync` command (match `init`'s flag name and
216. semantics — a file path, or a directory in which `registry.json` is resolved per the SDK's
217. `resolveRegistryPath`). Thread it into EVERY `loadRegistryFromDisk` call in `runSync` as
218. `loadRegistryFromDisk({ registryPath })`. When absent, the default registry path resolution is
219. unchanged. Surface the option in `sync --help`.
220.
221. Test: `runSync` with an explicit registry path resolves the team-root entry from THAT registry
222. (not the default user registry); without the option, the default path is used.
223.
224. ### Sub-proposal D — `SQUAD_TEAM_ROOT` override + registry config (decision)
225.
226. Default recommendation D1: when `SQUAD_TEAM_ROOT` is set, still load the registry (honouring
227. C's `--registry-path`) and look for the entry whose team root (`path.dirname(entry.path)`)
228. matches the override; if found, adopt its `callsign` / `stateRemote` / `stateBranch` /
229. `inboxHandle` (the env value still wins for the team-root PATH). If no entry matches, proceed
230. exactly as today (env-only, no registry config). The registry read is BEST-EFFORT — a missing
231. or unreadable registry must not turn a previously-working env-only sync into a failure.
232.
233. Test (D1): `SQUAD_TEAM_ROOT` pointed at a REGISTERED team root yields a cross-repo `--push`
234. that resolves the registry callsign and publishes a `squad/inbox/<callsign>/...` ref (no
235. callsign-guard failure); `SQUAD_TEAM_ROOT` pointed at an UNREGISTERED path behaves as today
236. (and an absent/unreadable registry does not newly fail). If D2 is chosen instead, add a
237. `--callsign` flag and test `sync --push --callsign <name>` under the env override.
