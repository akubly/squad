# CONTROL

> Control System Engineer

## Archive — 2026-06-08 (History Summarized)

Detailed learnings from pieces 18, 32–35 archived to `history-archive.md` to preserve context. This file now contains current & forward-looking patterns only.

---

📌 **SUMMARIZED (2026-06-05–06): Pieces 18, 32–35 Adversarial Review Cycle Completed**

Adversarial reviews across five pieces. Core patterns reusable: regex flag statefulness (no /g confirmed), conditional-spread JSON absence, CFA non-null assertion pattern, platform literal-union dispatch. All verdicts issued. Piece 35 confirmed zero new type errors.

## Learnings

### Piece 35 — Fold pipeline installer adversarial review (2026-06-06)

**Verdict: ✅ APPROVE** — commit `64eecd47`, author EECOM.

**Build (type-check):** `npm run build` exits code 2 with many errors — all pre-existing from piece-32/33/34 SDK-mismatch failures (cli-entry.ts lines 93/173/420/1034, assign.ts, doctor.ts, init.ts, unassign.ts, preset.ts, watch/startup.ts, migrations.ts, upgrade.ts, squad-resolver.ts). Verified same errors exist at 763c2451 base. `install-fold-pipeline.ts` introduces **zero new type errors**. The piece-35 cli-entry.ts changes (lines 1452–1465) also introduce zero new type errors.

**Gate (a) — `InstallFoldPipelineOptions`:** Interface is `{ cwd?: string; force?: boolean }`. Exactly matches kickoff signature. Both fields optional with correct primitive types. PASS.

**Gate (b) — `platform: 'github' | 'ado'` union tightness:** `installFoldPipeline` signature uses `platform: 'github' | 'ado'` literally (no widening). `platformDirMap: Record<'github' | 'ado', string>` is tight — no `string` widening. In cli-entry.ts: `platform` is cast `as string | undefined`, narrowed by the inequality guard (`!== 'github' && !== 'ado'`) backed by `fatal()` which returns `never` — TypeScript CFA narrows the fall-through to `'github' | 'ado'`, confirmed by no type error at the call site. PASS.

**Gate (c) — cli-entry.ts dispatch typing:** Dynamic import uses `.js` extension for ESM compatibility. Destructured `installFoldPipeline` exists in the source file. Options object `{ cwd: getSquadStartDir() }` is structurally valid for `InstallFoldPipelineOptions`. PASS.

**Gate (d) — exit-code paths:** Missing target directory → `process.exit(1)` + `console.error`. Conflict (existing file with different content) → `process.exit(1)` + actionable message naming the path. Invalid platform arg → `fatal()` (returns `never` → `process.exit(1)`). Could not resolve docs-repo path → `process.exit(1)`. Template not found → `process.exit(1)`. All `process.exit(1)` calls followed by `return;` for TypeScript control-flow safety. No path silently swallows an error or exits 0 on failure. PASS.

**Registry API correct:** `registry?.squads.find(...)` matches the actual `Registry` type (`squads: RegistryEntry[]`). `clones?: string[]` on `RegistryEntry` is correct. `path.dirname(entry.path)` matches the registry-first pattern from sync.ts. PASS.

**Pattern confirmed:** `fatal(): never` + inequality narrowing of `string | undefined` to `'github' | 'ado'` is a valid TypeScript CFA pattern. Verified build produces no type error at the dispatch call site. Reusable pattern for future platform-literal dispatch blocks.

### Piece 34 — Client-side publish triggers adversarial review (2026-06-06)

**Verdict: ✅ APPROVE** — commit `b0045b27`, author EECOM.

**Build (type-check):** `npx tsc --noEmit` exits code 2, but ALL errors in touched files (`cli-entry.ts`, `assign.ts`) are pre-existing SDK-mismatch failures carried forward from piece 32. `install-hooks.ts` and `sync.ts` introduce **zero new type errors**. Filtering output to the four touched files confirms no new diagnostics. The SDK (`packages/squad-sdk`) compiles cleanly.

**Surface A — `installCrossRepoHook` / `InstallHooksOptions`:** Exported function signature `(docsRepoPath: string, options?: InstallHooksOptions): void` is clean. `InstallHooksOptions` reused correctly; `options.force ?? false` propagated to `installHook`. Error thrown (not warned) on non-git-root as kill-list requires. Normalization via `normalisedPathKey` before root comparison is correct. No `@ts-ignore`, no implicit `any`.

**Surface B — `_installCrossRepoHookFn` seam / `SquadAssignOpts`:** Seam typed as `(docsRepoPath: string) => void`. TypeScript structural function subtyping: the real `installCrossRepoHook(docsRepoPath: string, options?: InstallHooksOptions): void` is assignable to that seam type (optional extra params do not break assignability). `opts._installCrossRepoHookFn ?? installCrossRepoHook` is well-typed. No `developerAlias` added to `RunAssignOpts` — the two interfaces remain non-conflated.  `RegistryEntry.developerAlias?: string` confirmed typed in SDK (`registry.ts:21`). All assignments `stateRemote = entry.stateRemote`, `developerAlias = entry.developerAlias` flow `string | undefined` to matching local types.

**Surface C — `dryRun?: boolean` in `SyncOptions` / cli-entry dispatch:** Field optional, consumed with `if (options.dryRun)`. CLI picks it up via `args.includes('--dry-run')` → `boolean` → passed as `dryRun: syncDryRun`. Dry-run exits via `return` inside the `try/finally` recursion-guard block — `finally { delete process.env[SQUAD_SYNC_ENV] }` runs correctly on early return. Exit 0. `--quiet` flag does not suppress dry-run console output (all dry-run output goes through `console.log`, not the `quiet`-gated path). `status` subcommand dispatch: `args[1]` is `string | undefined` under `noUncheckedIndexedAccess`; comparing to `'status'` is valid.

**Exit-code paths correct:** Non-git docsRepoPath → `installCrossRepoHook` throws `Error`; `_warmPath` catches, pushes to `warnings[]`, does NOT abort. Exit is 0. No silent swallowing of errors — they surface as printed warnings. `--dry-run` → return (exit 0). `--quiet` does not affect `process.exit(1)` calls in `runSync`; `quiet` gates only `console.log` not `console.error`.

**EDGE CASE (non-blocking) — `alreadyAssigned` path misses hook install:** `_warmPath` Guard 6 returns `{ kind: 'alreadyAssigned' }` before reaching the hook install block. Running `squad assign <callsign> --developer-alias <alias>` on a repo already in `clones[]` returns `alreadyAssigned` and the cross-repo hook is silently not installed. Spec compliance maintained (spec says "after successful registry write" — Guard 6 skips the write). Practical workaround: `squad install-hooks` on the docs-repo path. Documented here for follow-up if EECOM extends `alreadyAssigned` handling.

**EDGE CASE (non-blocking) — `runSyncStatus` has no git-root guard:** `getRepoRoot(cwd)` throws raw `execFileSync` error outside a git repo. Caller in `cli-entry.ts` has no try/catch; raw error surfaces to process exit. Consistent with `runSync` behavior in the same file. Not a regression, just a UX rough edge.

**Pattern confirmed:** `args[1]` for subcommand dispatch is correct under `noUncheckedIndexedAccess: true` — `string | undefined` is a valid type for equality comparison against a string literal. The status subcommand early-return pattern before flag parsing prevents spurious `--direction` validation for `squad sync status`.

### Piece 33 — Sync from registry adversarial review (2026-06-06)

**Verdict: ✅ APPROVE** — commit `0ce892e2`, author EECOM.

**Build:** `npm run build` exits code 2 on pre-existing piece-32 errors (assign.ts, doctor.ts, init.ts, unassign.ts, preset.ts, watch/startup.ts, migrations.ts, upgrade.ts, and pre-existing cli-entry.ts errors at lines 93–94/173/420/1034). Zero new type errors introduced in `sync.ts` or the sync dispatch section of `cli-entry.ts`. SDK compiles cleanly.

**Type safety confirmed clean:** `strict: true` + `noUncheckedIndexedAccess: true` (confirmed in root tsconfig.json). No `@ts-ignore`, no implicit `any`, no unjustified casts. Two non-null assertions confirmed justified: `teamRoot!` gated by `crossRepo = teamRoot !== undefined` (TypeScript can't narrow through boolean alias); `resolvedAlias!` gated by preceding compound `process.exit(1)` guard. Both safe at runtime.

**SyncOptions surface correct:** `developer?: string` added with JSDoc. All prior fields (`direction`, `remote?`, `cwd?`, `quiet?`) intact. CLI dispatch in `cli-entry.ts` uses `args.indexOf('--developer')` / `args[developerIdx + 1]` pattern — same as `--remote` and other flags in the same file. Type flows `string | undefined` → `developer?: string`. Under noUncheckedIndexedAccess, `args[developerIdx + 1]` is `string | undefined` at compile time; consistent with existing pattern.

**Resolution-order branching correct:** SQUAD_TEAM_ROOT env → registry lookup → config.json fallback. Env truly bypasses registry (else branch not entered). Config.json only entered when `!teamRoot`. Alias chain: `options.developer !== undefined` → `process.env['SQUAD_DEVELOPER_ALIAS'] ?? registryAlias` — `??` on env var means empty string is NOT bypassed (passes as `""`, then caught by `!resolvedAlias` guard).

**Exit-code paths correct:** Registry-miss + no config.json + push → `process.exit(1)` naming `squad assign`. Missing alias on `push && crossRepo` → `process.exit(1)` referencing `squad assign --developer-alias`. Both guards correctly require `isPush`; alias guard also requires `crossRepo`. Pull direction cannot trigger either exit.

**MEDIUM NOTE — whitespace alias not trimmed:** `options.developer = " "`, `SQUAD_DEVELOPER_ALIAS = " "`, or a whitespace `developerAlias` from the registry all pass the `!resolvedAlias` guard and then throw inside `publishTeamRootToInbox` from `DEVELOPER_ALIAS_RE.test()` rather than producing the spec's `process.exit(1)` with "squad assign" guidance. Kickoff doc explicitly asked "trim before falsy check?" — answer is no. Inconsistent error path for whitespace-only values. Not blocking; edge case.

**Pattern learned:** When a non-null assertion follows a compound guard (`if (A && B && C) { process.exit(1); }`), TypeScript's control-flow narrowing does not track the implication across later nested blocks. The `!` assertion is necessary AND safe. Always verify the guard covers all paths to the assertion site.

### Piece 32.5 — State transport helpers adversarial review (2026-06-05)

**Verdict: ✅ APPROVE** — uncommitted working-tree changes, author EECOM.

**Build**: `npm run build` exits with code 2, but ALL errors are pre-existing from piece 32 SDK API changes in OTHER files (cli-entry.ts, preset.ts, etc.). `sync.ts` introduces zero new TypeScript errors. The SDK compiles cleanly.

**Type-safety confirmed clean:** No new `any` leaks. EECOM's `hydrateTeamRootFromStateRef` error extraction uses the proper intersection type `NodeJS.ErrnoException & { stderr?: string }` rather than `as any`, which is an improvement over the pre-existing `syncPush` cast. No `@ts-ignore`. No unjustified non-null assertions. `noUncheckedIndexedAccess` respected — no numeric indexing on post-filter arrays in production code. `as string[]` cast on `readdirSync({ recursive: true })` is a necessary overload-inference workaround; `as Buffer` on `encoding: null` execFileSync is redundant but correct.

**Timestamp formatter verified correct:** `iso.slice(0,4)+iso.slice(5,7)+iso.slice(8,10)+'-'+iso.slice(11,13)+iso.slice(14,16)+iso.slice(17,19)` on `"2026-06-05T17:05:43.000Z"` yields `"20260605-170543"`. UTC, 0-padded, no off-by-one.

**pathHash normalization confirmed stable:** `replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()` — backslashes converted, drive letter lowercased, trailing slash removed. Same work-tree with or without trailing separator produces identical SHA-256 hash.

**Allowlist prefix-collision SAFE:** All PUBLISH_ALLOWLIST_PREFIX entries carry trailing slashes. `.squad/logger/x` does NOT start with `.squad/log/`. Verified all boundary cases programmatically.

**Isolated index confirmed safe:** `GIT_INDEX_FILE` env var applied to every staging operation (`hash-object`, `update-index`, `write-tree`). `git commit-tree` correctly uses `commitEnv` (identity only, does not read the index). `finally` block cleans up index file. Real `.git/index` is never touched.

**Error ordering correct:** alias validation (Step 1) throws BEFORE `inboxBranch` is used, BEFORE any git object created. `git rev-parse HEAD` (Step 3) reads an existing ref but creates nothing. Allowlist guard (Step 4) fires before `hash-object -w` writes any blobs. Push is the final step.

**MEDIUM FINDING — Idempotency guard is dead code:** `hydrateTeamRootFromStateRef` checks `headSha === fetchedSha` for early return, but the function never updates HEAD — it only writes files to the working tree via `cat-file` + `writeFileSync`. On every invocation, `headSha` (initial commit) will differ from `fetchedSha` (orphan publish commit), so the guard never fires. Files are re-written on every call. Outcome is still correct (same content); it is not a true no-op. Test 6 (`resolves.toBeUndefined()`) would pass regardless since all void functions resolve to `undefined`. The guard as written could only fire if the caller had previously checked out the orphan commit as HEAD — a scenario not part of the expected usage. Fix: use a sentinel file or a separate notes ref to record the last hydrated SHA; OR document that the function is idempotent-in-outcome but not a no-op. Not blocking since correctness is preserved.

**Both functions confirmed NOT called from `runSync`.** Export-only. ✅

### Piece 32 — Registry state fields adversarial review (2026-06-05)

**Verdict: ⚠️ APPROVE-WITH-NITS** — commit `f35fa9b5`, author EECOM.

**Critical regex /g flag trap (confirmed safe):** `DEVELOPER_ALIAS_RE = /^[a-z][a-z0-9-]{1,38}$/` has no flags. A `/g` flag on a shared exported regex causes `lastIndex` statefulness: the first `.test()` on a matching string advances `lastIndex`, so the second call returns `false`. This is a real, non-obvious failure mode for exported regex constants. Always check the flags of any exported regex during review. Confirmed: `re.flags === ""`, repeated `.test()` calls are stateless. Simulated `/g` version confirmed 1st=true, 2nd=false on same input.

**Trailing/consecutive hyphens: forward-risk from spec-faithful regex.** The spec defined the regex exactly as `/^[a-z][a-z0-9-]{1,38}$/` without prohibiting trailing or consecutive hyphens. `"ab-"` and `"a--b"` are both accepted. This is correct for piece 32 but becomes a problem when piece 33/34 interpolates `developerAlias` into `squad/inbox/<alias>/...` branch names. The downstream piece author must not assume the stored alias is safe for raw branch-name interpolation. Tighten the regex to `/^[a-z][a-z0-9]([a-z0-9-]*[a-z0-9])?$/` before piece 33 ships, OR add a sanitiser at interpolation time.

**Conditional spread JSON-absence confirmed:** `...(x !== undefined ? { key: x } : {})` correctly omits the key entirely from `JSON.stringify` output when the flag is not supplied. Property is truly absent (not `undefined`-valued). `toMatchObject` and `.not.toHaveProperty()` in Vitest cover this correctly.

**Build emit verification process:** After adding a new subpath export, the required verification is: (1) `npm run build` exits 0, (2) `dist/<name>.js` exists, (3) `dist/<name>.d.ts` exists and exports the correct symbol, (4) JSON structure of package.json `exports` is valid via `node -e "require('./package.json')"`. All four passed for `./validation`.

### Piece 40 — Callsign-namespaced transport adversarial revision (2026-06-12)

**BLOCK → ✅ FIXED** — Independent revision of EECOM's commit `b64bef25`. Build: `npm run build` exits 0 (strict, zero new errors). Tests: **33 piece-40 + 16 cross-repo = 49 tests, all pass**.

**H1 (HIGH) — Enumeration fetch/ls-remote not scoped (fixed: install-fold-pipeline.ts)**
- The original callsign block only rewrote the trigger glob and the state-branch target. Step-2 enumeration (`git fetch origin '+refs/heads/squad/inbox/**:…'` and `git ls-remote --heads origin 'refs/heads/squad/inbox/*'`) continued to match all squads' inbox refs — guaranteed cross-contamination on cron.
- Fix: replaced the many specific `.replace()` chains with three targeted pattern replacements (trigger, H1 fetch refspec, H1 ls-remote pattern) plus a **broad `/squad-state/g`** catch-all. The broad catch-all is safe because `squad-state` is not a substring of `squad/state/<callsign>` after substitution, so no double-apply is possible.
- **Pattern**: when `squad-state` appears in both display names/comments AND executable YAML, a broad `/squad-state/g` replacement is simpler and more complete than an enumeration of specific patterns. Verify no false positives before applying.

**M4 (MED) — Orphan local branch name not parameterized (fixed: install-fold-pipeline.ts)**
- `git checkout --orphan squad-state` was not being rewritten. After the broad replacement, it becomes `git checkout --orphan squad/state/<callsign>` automatically.
- After H1+M4 fixes, a callsign-scoped install produces ZERO bare `squad-state` tokens.

**H2 (HIGH) — assign cold-start does not default stateBranch (fixed: assign.ts)**
- `_coldStart` built `updatedEntry` with no `stateBranch` for new entries. Now: when `!reactivating && opts.stateBranch === undefined`, defaults to `squad/state/<callsign>`. Explicit `--state-branch` always wins. Reactivating entries preserve existing `stateBranch` via `baseEntry` spread.
- Added `CALLSIGN_RE` import and explicit callsign validation before branch construction.
- **Pattern**: `...(!reactivating ? { stateBranch: `squad/state/${callsign}` } : {})` is the idiomatic conditional-spread for stateful defaulting without clobbering existing values.

**M3 (MED) — init builds stateBranch from unvalidated callsign (fixed: init.ts)**
- Added `CALLSIGN_RE` import and early validation of `opts?.callsign` before any scaffold or registry write. Throws `ConfigurationError` with `ERR_SQUAD_INIT_INVALID_CALLSIGN` on invalid explicit callsign.
- **Pattern**: callsign validation belongs at the entry point (before any side effects), not inline at the interpolation site.

**M5 (MED) — C5/C6 tests strengthened to byte-identical (test file)**
- Changed from `toContain()` substring checks to `toBe(fs.readFileSync(templatePath,'utf-8'))` for both github and ado no-callsign paths. C5 and C6 pass, confirming the no-callsign output is still byte-for-byte identical to the raw template. Added `TEMPLATES_ROOT` constant at module scope.

**M6 (MED) — INT1 cross-contamination negative assertion added (test file)**
- Added `expect(refsA.some(r => r.includes('team-b'))).toBe(false)` and vice versa to INT1.

**LOW — sync.ts dry-run inbox branch preview includes callsign (sync.ts)**
- Updated dry-run output from `squad/inbox/${effectiveAlias}/...` to `squad/inbox/${callsignPrefix}${effectiveAlias}/...` when `registryCallsign` is set. Matches the actual runtime branch structure.

**New tests added (6):**
- `M3`: init rejects invalid callsigns before registry write (5 bad callsigns, writeRegistry call count = 0)
- `H2-1`: cold-start `--callsign team-b`, no `--state-branch` → `stateBranch: 'squad/state/team-b'`
- `H2-2`: explicit `--state-branch` overrides callsign default
- `H2-3`: reactivating existing entry preserves existing `stateBranch`
- `H2-4`: invalid explicit `--callsign` in cold-start throws `AssignError` before clone
- `C8`: callsign set → no bare `squad-state` token, no global inbox glob (both platforms); namespaced enumeration patterns present

**No-callsign byte-identical confirmed:** C5 (`toBe`) and C6 (`toBe`) pass.



**Pattern reusable:** `fatal(): never` + inequality narrowing of `string | undefined` to `'github' | 'ado'` is a valid TypeScript CFA pattern for platform-literal dispatch. No type errors at call site; confirmed by clean build on piece-35 files. Registry API correct: `registry?.squads.find(...)` matches actual type; `path.dirname(entry.path)` matches registry-first pattern from sync.ts.

**All five gates passed:**
1. InstallFoldPipelineOptions signature exact
2. Platform union tight (`'github' | 'ado'`)
3. cli-entry.ts dispatch typing clean
4. All exit-code paths route to process.exit(1)
5. Zero new build errors

**Key learnings stored for future pieces:**
- YAML comment assertion must use `raw.toContain()` — parser strips comments
- Registry-first adversarial test: pre-write wrong config, verify registry wins
- fatal():never + inequality guard is reusable CFA pattern for literal unions



