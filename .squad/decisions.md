# Decisions

> Team decisions that all agents must respect. Managed by Scribe.


---

### 2026-05-22: Piece 22 Scope + Ship-Debt Priority

**Author:** Flight (Lead)  
**Date:** 2026-05-22  
**Status:** Proposed

---

## Decision A: Piece 22 Scope — Mechanical Unification Only

**Context:** FIX-8 was deferred from piece 21 to piece 22 with TODO markers. The question is whether piece 22 should be "just" the dual-doctor unification or expand to include related debt cleanup.

**Decision:** Piece 22 is mechanical unification of the dual-doctor implementations plus four trivial co-located fixes (D-4, D-7, D-12, D-15). It does NOT include semantic enrichment (repair commands, correlated findings, new checks).

**Boundary:** ≤200 LOC production code net change (excluding tests). If the PR exceeds this, split D-15 (workflow stub deduplication) into piece 23.

**Rationale:** Piece 21's ship gate taught us that bundling "just one more fix" compounds scope. Mechanical-only means the reviewer can approve on type-correctness alone without evaluating behavioral changes.

---

## Decision B: Ship-Debt Priority Queue

| Priority | Piece # | Theme | Debt Items |
|---|---|---|---|
| 1 | 22 | Doctor unification + trivial cleanup | D-1, D-2, D-4, D-7, D-12, D-15 |
| 2 | 23 | Typing hygiene + convention decisions | D-3, D-5, D-11, D-13 |
| 3 | 24 | OTel hardening + SDK adapter typing | D-6, D-8, D-9, D-14, D-16 |
| 4 | 25 | SDK naming cleanup (breaking) | D-18 |
| — | — | Won't fix | D-10, D-17 |

**Rationale:** Priority follows dependency order. Piece 22 removes the type fragmentation that blocks 23's cross-cutting cleanup. Piece 24 is SDK-internal and can proceed independently. Piece 25 requires a deprecation strategy decision (potential major version bump).

---

## Applies To

All squad agents working on pieces 22–25. Coordinators should use this priority when routing work.

## Consequences

- Pieces 23–25 are not urgent but should be scheduled before any piece that adds NEW doctor checks or OTel instrumentation
- The "won't fix" items (D-10, D-17) should not appear in future debt audits — they are explicitly accepted

---

### 2026-05-18: Guard-Ordering Test Discipline

**Author:** Flight (Lead)  
**Date:** 2026-05-18  
**Context:** Piece 14 adversarial review — containment guard ordering test gap

## Decision

When a command implements numbered guards where ordering prevents misclassification (e.g., containment before git-root resolution before idempotency), the test for guard N must mock guard N+1's transformation to its **realistic output**, not use an identity mock.

### Rationale

Identity mocks (`getGitRoot: (dir) => dir`) prove the guard fires for a given input but don't demonstrate that ordering prevents a downstream guard from incorrectly handling the same input after transformation. The real value of ordered guards is that earlier guards intercept before later guards normalize the input into a different scenario.

### Applies to

All commands with spec-defined guard ordering (currently: `init`, `assign`). Future pieces that introduce numbered guard sequences.

### Test pattern

```typescript
// WRONG: identity mock doesn't prove ordering matters
getGitRoot: (dir) => dir

// RIGHT: simulates what real git-root resolution would return
getGitRoot: () => registeredCloneRoot  // collapses subdir to parent
```

Then assert the EARLIER guard (containment) fires, not the LATER guard (idempotency).

---

### 2026-05-18: Security Decision — git subprocess `--` separator convention

**Author:** RETRO  
**Date:** 2026-05-18  
**Status:** Proposed

## Decision

All `execFileSync` / `execFile` calls that pass a user-supplied or URL-derived string as a positional argument to git (e.g., `git clone <url>`, `git fetch <remote>`) MUST include `--` immediately before the positional argument(s) to prevent git from interpreting strings beginning with `--` as option flags.

## Rationale

During the piece-14 security review, `_defaultCloneCommand` at `packages/squad-cli/src/commands/assign.ts:267` was found to invoke `git clone` as:

```ts
_assignExecFileSync('git', ['clone', url, dest], { stdio: 'inherit' });
```

Without `--`, a `url` value of `--upload-pack=/path/program` is treated by git as a flag, not as the repository URL. The `--upload-pack` option specifies an executable used to serve repository pack objects, making this a git-argument-injection vector. While no privilege escalation beyond the invoking user is possible (same-user execution), the behavior is unintended and violates least-surprise.

The fix is one token:

```ts
_assignExecFileSync('git', ['clone', '--', url, dest], { stdio: 'inherit' });
```

## Scope

Apply this convention to every call site that passes user-supplied or derived data as a positional argument after the git subcommand. Existing call sites in `lib/git-root.ts` use only fixed positional arguments (`rev-parse --show-toplevel`) and are not affected.

## Consequences

- **Adopting:** Eliminates the flag-injection surface for all git subcommand calls. One-token change per call site.
- **Not adopting:** Any refactor that adds a new git call with a user-supplied URL could silently introduce the same vector.

---

### 2026-05-18: Decision Proposal — TypeScript Patterns from Piece 14 Review

**Author:** CONTROL  
**Date:** 2026-05-18  
**Source:** Adversarial TypeScript review of piece 14 (`squad assign`, commit 971a9d0a)

---

## Decision 1 — Error codes must be discriminable properties, not message prefixes

**Context:** All `ERR_ASSIGN_*` codes in `assign.ts` are concatenated into the human-readable message string on `ConfigurationError`. There is no `.code` property and no exported type union.

**Proposed rule:** Any command module that throws typed errors must:

1. Export a `type FooErrorCode = 'ERR_FOO_BAR' | 'ERR_FOO_BAZ' | ...;` union.
2. Attach `code: FooErrorCode` as a discriminable property on the thrown error (either as a field on `ConfigurationError` or via a thin typed wrapper).
3. Test assertions check `err.code === 'ERR_FOO_BAR'`, not `err.message.match(/ERR_FOO_BAR/)`.

**Rationale:** Programmatic callers (tests, orchestration layers, future SDK consumers) need to switch on error identity without parsing human text. String-embedded codes are brittle — a copy-paste typo in the code prefix silently diverges between thrower and catcher with no compile-time signal.

---

## Decision 2 — `--key=value` form must be handled in all CLI arg parsers

**Context:** The piece 14 `assign` arg parser uses `args.indexOf('--clone-to')`, which returns `-1` when the user writes `--clone-to=./path`. This produces a misleading `ERR_ASSIGN_URL_WITHOUT_CLONE_TO` error even though the user correctly supplied the flag.

**Proposed rule:** All arg-parsing blocks in `cli-entry.ts` must handle both `--flag value` and `--flag=value` forms. Introduce a shared `argValue(args, flag)` helper function in `cli-entry.ts` that checks the `=`-delimited form first, then falls back to positional lookup.

---

## Decision 3 — Exhaustiveness guards required on `kind` discriminants

**Context:** The switch on `result.kind` in `cli-entry.ts:1171` covers all four current `AssignKind` variants but has no `default: { const _exhaustive: never = result.kind; }` arm. A future fifth variant would silently fall through.

**Proposed rule:** Every switch on a discriminant property of a team-defined union type must end with:
```ts
default: {
  const _exhaustive: never = result.kind;
  break;
}
```

This is a compile-time gate, not a runtime check — zero performance cost.

---

### 2026-05-17: Platform Adapter Seam — Piece 12

**Status:** Accepted  
**By:** CAPCOM (SDK Expert)  
**Branch:** `akubly/upstream-12-platform-adapter`  
**Commit:** `30e7602c`

#### Decisions Made

**1. `detectPlatform` throws on unknown origin (breaking change accepted)**

Changed `detectPlatform` from silently returning `'github'` on failure to throwing a typed `Error` with a `SQUAD_PLATFORM` env var remediation hint.

**Rationale:** Spec requires honoring `SQUAD_PLATFORM` env var and explicit failure signaling. Callers that need a safe fallback (e.g., `comms.ts`, `detectWorkItemSource`) have been updated with try/catch guards. Silent fallback to `'github'` masked misconfiguration.

**2. `createAdapterForOrigin` factory "fails closed" for unknown hosts**

Factory throws `Error` for unrecognized hosts (returning PlatformType `'unknown'`), rather than returning a no-op adapter or defaulting to GitHub.

**Rationale:** Spec requirement. A no-op adapter would silently swallow work item operations. Explicit failure at construction time is safer — callers can catch and fall back to FileLog or display user-facing guidance.

**3. `@me` sentinel no-ops silently when `az` CLI unavailable**

`AzureDevOpsAdapter.assignWorkItem('@me')` calls `getCurrentUser()`, but if `getCurrentUser()` returns `undefined` (az CLI absent or unauthenticated), the assignment is silently skipped rather than throwing.

**Rationale:** Spec says `@me` resolves the current authenticated user. In offline/unauthenticated environments, failing loudly on assignment would block all work item operations. Silent no-op degrades gracefully and matches the existing ADO pattern for unavailable CLI features (e.g., `getAvailableWorkItemTypes` fallback).

**4. Optional methods on `PlatformAdapter` — callers use optional chaining**

`assignWorkItem?()` and `getCurrentUser?()` are declared as optional on the interface. All callers must use `adapter.assignWorkItem?.()`.

**Rationale:** Existing adapter implementations (e.g., `FileLog`) are not required to implement these methods. Optional interface keeps backward compatibility. Piece 13+ can implement them as needed.

---

### 2026-05-17: Platform Adapter Revision — Type System Tightening

**Status:** Accepted  
**By:** EECOM  
**Branch:** `akubly/upstream-12-platform-adapter`  
**Commit:** `6f1251cb`

#### Decision 1: Remove `'planner'` from `PlatformType`

**Question:** Should `'planner'` be removed from `PlatformType` (option a) or kept as `'unknown'` (option b)?

**Decision:** Option a — remove `'planner'` entirely from `PlatformType`.

**Rationale:** `PlatformType` represents a _git hosting platform_ (GitHub, Azure DevOps). A git platform must have a detectable remote URL pattern and a corresponding `PlatformAdapter` that can be constructed from that URL. Planner has no git remote URL form — no factory can create a planner adapter from a URL. `PlannerAdapter` is a _work-item source_ adapter, not a git platform adapter.

**Impact:** `PlannerAdapter.type` is now `'planner' as const` — not typed as `PlatformType`. All structural typing constraints are satisfied. `SQUAD_PLATFORM=planner` now throws a `PlatformConfigError` with a remediation message pointing users to configure a work-item source separately.

#### Decision 2: Introduce `PlatformConfigError` typed error class

**Question:** Should platform configuration failures use `new Error(...)` or a typed subclass?

**Decision:** Use `PlatformConfigError extends Error` with `name = 'PlatformConfigError'`.

**Rationale:** Callers (e.g. `comms.ts`, CLI commands) need to distinguish "platform not configured" errors from unexpected runtime errors to provide actionable diagnostics and graceful fallback paths. A typed class enables `catch (e) { if (e instanceof PlatformConfigError) { ... } }` at call sites.

**Impact:** `detectPlatform`, `createAdapterForOrigin`, and future factory functions throw `PlatformConfigError`. Tests assert `toThrow(PlatformConfigError)` for typed coverage. The class is exported from the `@bradygaster/squad-sdk/platform` barrel.

---

### 2026-05-17: Mock-Typing Pattern for CLI Spawn Tests

**Status:** Accepted  
**By:** FIDO (Quality)  
**Scope:** Piece 12 test-quality pass; pattern applies to all future platform-adapter and CLI-spawn test files

#### Context

Piece 12 introduced two test files that mock `node:child_process.execFileSync` to drive the ADO and GitHub adapter implementations. The initial mock setup used `vi.mocked(execFileSync)` and scattered `as any` on every `.mockReturnValue` and `.mockReturnValueOnce` call site — 37 occurrences. This was a quality concern flagged in the prior review round.

#### Decision

**Use strategy A (typed `MockedFunction<>` cast at declaration) for all CLI-spawn mock surfaces.**

At the mock declaration, cast once to a simplified single-overload type:

```ts
const mockedExecFileSync = vi.mocked(execFileSync) as MockedFunction<
  (file: string, args?: readonly string[], options?: object) => string
>;
```

This collapses the multi-overload signature to the string-returning form actually used in tests, giving full mock API (chaining, `mock.calls` access, full `MockedFunction<>` surface) with zero `as any` at call sites.

**When to prefer strategy A vs B:**

- **Strategy A** (`MockedFunction<simplified-sig>` cast): Use when the mock needs to chain (`mockReturnValueOnce(...).mockReturnValueOnce(...)`) and when more than ~5 call sites would otherwise need `as any`. The cast is a one-liner and the type is self-documenting.
- **Strategy B** (local typed interface): Use when the mock surface is narrow (1-2 methods), the function is not overloaded, or the test file is short-lived. Writing a full interface for a function with 8 overloads is busywork.

The `as unknown as MockedFunction<...>` cast is intentional and documented; it is NOT an `as any` escape — the `as unknown as` pattern pinpoints "I know the runtime value is this type; TypeScript's overload inference cannot follow." A comment explaining why belongs at the declaration site, not on every call.

**Applies To:** Any future test file that mocks an overloaded Node.js built-in (`execFileSync`, `spawnSync`, `readFileSync` with encoding overloads), uses Vitest 2.x+ with TypeScript strict mode, and has more than 3 mock call sites that would otherwise need `as any`.

**Rationale:** `as any` in test mocks is not a "good enough for tests" exception — it silently defeats TypeScript's return-type checking on the mock return value. A mock returning `42 as any` where `string` is expected passes the compiler but makes the test wrong. Typed mocks catch mismatches between test fixture data and the types the implementation consumes.

---

### 2026-05-17: Piece 12 Platform Adapter — Package Export Strategy

**Status:** Accepted  
**By:** GNC (Compiler)  
**Branch:** `akubly/upstream-12-platform-adapter`  
**Commit:** `93f64716`

#### Package export choice: Option (a) — add `./adapter-factory` subpath

The spec (12-platform-adapter.md) states: "The SDK package exports the platform barrel and the adapter-factory subpath." This is unambiguous. `./adapter-factory` was added to `package.json` exports, wired to `dist/platform/adapter-factory.js`.

`./platform` already re-exports `createAdapterForOrigin`, so callers that import through the platform barrel continue to work. The `./adapter-factory` subpath gives direct entry-point access for tree-shaking or callers that want only the factory without the full platform barrel.

#### Barrel scope decision

The `packages/squad-sdk/src/platform/index.ts` barrel was narrowed to the spec public surface:
- `PlatformType`, `WorkItem`, `PullRequest`, `PlatformAdapter`
- `PlatformConfigError`
- `createAdapterForOrigin`, `normalizeRemoteUrl`
- `parseGitHubRemote`, `parseAzureDevOpsRemote`
- `createPlatformAdapter` (repoRoot convenience, used by squad-cli/loop.ts)

Removed from barrel (not in spec surface):
- Concrete adapter classes: `GitHubAdapter`, `AzureDevOpsAdapter`, `PlannerAdapter`
- ADO-specific types: `AdoWorkItemConfig`, `WorkItemTypeInfo`
- Detection helpers: `detectPlatform`, `detectPlatformFromUrl`, `detectWorkItemSource`, `getRemoteUrl`
- Comms adapters: `FileLogCommunicationAdapter`, `GitHubDiscussionsCommunicationAdapter`, `ADODiscussionCommunicationAdapter`, `createCommunicationAdapter`
- Ralph helpers: `getRalphScanCommands`, `getPlannerRalphCommands`, `RalphCommands`
- Extra types: `WorkItemSource`, `HybridPlatformConfig`, `CommunicationChannel`, etc.

No squad-cli code was importing these via the barrel, so no cross-package callers needed migration.

---

### 2026-05-17: Tone Leak Pattern — Gate Documentation Safety

**Status:** Accepted  
**By:** Scribe  
**Topic:** Avoid reproducing prohibited terms when documenting tone gates

#### Problem

Orchestration logs and agent histories leaked prohibited preview-channel terminology by quoting scrub-gate check-point names verbatim. Gate 2 is designed to prevent this pattern from shipping; paradoxically, documenting what the gate filters can introduce the very terms the gate forbids.

#### Root Cause

- Scrub-gate check-point names may use prohibited terminology (the gate must know what to forbid).
- When logging scrub-gate results, the natural documentation instinct is to quote the check name.
- No guidance existed for safe gate documentation within tone constraints.

#### Solution

**Principle:** When documenting scrub-gate results or lessons in committed files, never reproduce prohibited terms even when explaining why those terms are forbidden. Instead:

1. Describe the *check category* (e.g., "preview-channel terminology detection") instead of the check name.
2. Refer readers to the authoritative source: `.docs/proposals/upstream-bradygaster/_scrub-gate.ps1` (Gate 2 section).
3. When documenting gates, focus on the *result* and *pattern*, not the literal string being filtered.
4. Use neutral placeholders: "the legacy preview-channel codename", "a prohibited term Gate 2 forbids", "preview-channel-specific language".

#### Consequences

- Lesson documentation itself can't violate what it teaches.
- Scrub-gate audit becomes zero-false-positive for committed docs (no mention means no violation).
- Clearer separation: gate internals can name things; committed prose cannot.

**Owner:** Scribe — applies to all session logging and decision documentation going forward.

---

### 2026-05-18: Commit Messages with Backticks — Safe Quoting Pattern

---

### 2026-05-18: Piece 14 Quality Review — squad assign

**Verdict:** APPROVED

**Build:** CLEAN. **Tests:** 21/21 GREEN. All 21 spec scenarios covered (A1–A21). Each test asserts structured behavior: registry state on disk, `result.kind`, error code/text. No test is a bare exit-code check.

**Commit hygiene:** 7 files only (`.changeset`, `packages/squad-cli/package.json`, `cli-entry.ts`, `assign.ts`, `assign.test.ts`, `registry.ts`, `vitest.config.ts`). No `.squad/` state files in the code commit. PASS.

**Scrub gate:** Gate 1 (strip-listed paths) and Gate 2 (wifi-aware mention in `.squad/reviews/piece-13-adversarial-review.md`) FAIL — both confirmed pre-existing at HEAD~1. No new strip-listed paths or wifi-aware content introduced by piece 14 diff. Not attributable to piece 14.

**Observable:** Injectable-seam guard-order test pattern — when a command has ordered guards where guard N uses raw `cwd` and guard N+1 normalizes via git/FS, the guard N test mock must simulate the normalized output guard N+1 would produce, to prove guard N intercepts BEFORE that normalization occurs. Test A15 uses `getGitRoot: (dir) => dir` (returns subdir as-is). This proves the containment guard fires for a subdir, but does NOT demonstrate the most dangerous ordering failure: if `getGitRoot` were called first and returned the parent clone root (as real git would), Guard 6 idempotency would match the clone root and return a spurious `alreadyAssigned`. A companion variant using `getGitRoot: () => cloneDir` would prove the guard runs before git-root resolution and prevents that false positive. For future pieces with ordered guards, apply this pattern.

**Status:** APPROVED  
**By:** Surgeon (Release Manager)  
**Impact:** All contributors writing commit messages with code backticks

#### Problem

PowerShell double-quoted strings and heredocs parse backticks (`) as escape sequences. When a commit message contains backticks (e.g., `` `register` ``), PowerShell silently consumes the backtick AND the following character before the message reaches git. This corrupts the message irreversibly and ships broken history to upstream.

**Example Failure:**
- Input: `The \`register\` subcommand has been removed`
- PowerShell parsed: `The register` (backtick + 'r' eaten)
- Committed: `The egister subcommand has been removed` ✗

This happened in Piece 13 (commit 01ae3060), requiring a message-only amend and force-push to fix.

#### Decision

**Commit messages with backticks MUST be written using one of these patterns:**

1. **PRIMARY (Recommended):** Use the `create` tool with `file_text` parameter
   - Avoids all PowerShell quoting/escaping
   - Message written directly to file, git reads raw bytes
   - Works for all markdown/code-containing messages

2. **SECONDARY (Manual fallback):** Single-quoted PowerShell Here-String
   ```powershell
   $msg = @'
   feat: remove `register` command
   
   The `register` subcommand has been removed.
   '@
   git commit -m $msg
   ```
   - Single quotes prevent backtick escape processing
   - Manual but reliable

3. **TERTIARY (Last resort):** `git commit --amend` with editor
   ```bash
   EDITOR=vim git commit --amend
   ```
   - Editor receives message bytes directly (no shell parsing)

#### Forbidden Pattern

❌ **NEVER use double-quoted PowerShell heredocs:**
```powershell
git commit -m "feat: remove `register` command"  # ✗ Backtick eaten
```

#### Verification Before Push

After writing a commit message with backticks, always verify:
```bash
git log -1 --format="%b" HEAD | findstr /C:"exact string with backticks"
```

Example:
```bash
git --no-pager log -1 --format="%B" HEAD | Out-File -NoNewline $env:TEMP\verify.txt -Encoding utf8
Get-Content $env:TEMP\verify.txt -Raw
# MUST show: The `register` subcommand, `squad assign`, etc. — all backticks intact
```

#### References

- **Incident:** Piece 13 commit message corruption (2026-05-18)
- **Fix Applied:** Message-only amend via `git commit --amend --only -F <file>` (SHA 01ae3060 → 9a9c7b06)
- **Skill Documentation:** `.squad/skills/commit-message-quoting/SKILL.md`
- **Surgeon History:** `.squad/agents/surgeon/history.md` (2026-05-18 learning entry)


---




---

# Decision Drop — Scrub Gate Cleanup Policy (Pre-Phase C)

**Author:** RETRO  
**Date:** 2026-05-19  
**Status:** Proposed — requires Scribe merge + coordinator action  
**Requested by:** akubly

---

## Context

Gate 1 (strip-listed paths) and Gate 2 (wifi-aware mentions) have failed on every Phase B piece. FIDO accepted this as pre-existing baseline contamination per decisions.md policy. The coordinator has now directed cleanup before Phase C regardless of that policy.

RETRO performed a full scrub gate diagnosis on `akubly/upstream-18-doctor-enhancements` (HEAD `38cbc69e`). All violations are baseline — none were introduced by piece 18.

---

## Findings

### Gate 1 — Strip-listed path violations (all baseline)

The three violation categories and their earliest birth commits:

| Category | Example paths | Birth commit | Count |
|---|---|---|---|
| `docs/_internal/` | 17 design/PRD docs | `482fd58d` | 17 |
| Product dirs (`/casting/`, `/identity/`, `orchestration-log`) | `packages/squad-sdk/src/casting/`, `templates/identity/`, `**/orchestration-log.md` | `df4fafe6` | ~15 |
| `.squad/` infrastructure | `.squad/orchestration-log/`, `.squad/identity/`, `.squad/casting/` | earliest pieces | ~99 |

**Zero Gate 1 violations were introduced by piece 18.**

### Gate 2 — Wifi-aware content (all baseline, all in `.squad/`)

Single root source: `.squad/reviews/piece-13-adversarial-review.md` line 160 contains the literal text `git grep -i 'wifi.aware'` as a shell command in a scrub-gate report block. This is a **false positive** — the file records that the search returned 0 actual hits. Three downstream files (fido history, decisions.md, an orchestration log) mention this as the source of the failure; they do not contain wifi-aware content independently.

**Zero Gate 2 violations were introduced by piece 18.**

---

## Proposed Decisions

### Decision A — Scrub Gate `.squad/` exclusion (recommended, low risk)

Update `_scrub-gate.ps1` to exclude `.squad/` from both Gate 1 (path scan) and Gate 2 (content scan). The gate already excludes itself (`':!docs/proposals/upstream-bradygaster/_scrub-gate.ps1'`). The `.squad/` directory is team infrastructure — history files, casting records, identity documents, orchestration logs. None of it is destined for the upstream push; it is not in the submission diff.

**Effect:** Removes ~116 of the 131+ Gate 1 violations. Removes all 4 Gate 2 violations.  
**Risk:** Low. Does not touch source code. `.squad/` content is already excluded from the upstream submission by convention.

**Implementation:** In `_scrub-gate.ps1` Gate 1, filter out `.squad/` and `.squad-templates/` paths from `git ls-files` output before matching. In Gate 2, add `':!.squad/'` and `':!.squad-templates/'` to the `git grep` exclusion list.

---

### Decision B — `docs/_internal/` rename (required for full Gate 1 pass)

Rename `docs/_internal/` → `docs/design/` to remove the `_internal` path component that matches the strip pattern.

**Effect:** Removes 17 additional Gate 1 violations.  
**Risk:** Medium. Requires a rebase-style cleanup commit touching 17 files + any cross-references to the `_internal/` path. Must be applied to a branch rebased on top of piece 18 (not a mid-stack edit).

**Recommended vehicle:** A dedicated Phase C cleanup commit (`chore(docs): rename docs/_internal to docs/design for upstream scrub compliance`) on a new branch from `akubly/upstream-18-doctor-enhancements`, NOT an amendment to any piece-N commit.

---

### Decision C — Product directory strip-list refinement (requires coordinator input)

Squad's own product directories — `/casting/`, `/identity/`, `orchestration-log` in `templates/` and `packages/squad-sdk/src/` — match the strip-list pattern. These are intended for the upstream push. The strip-list was designed to exclude MS-internal Windows wireless team artifacts, not Squad's own features.

**Options:**
1. **Refine the pattern** in `_scrub-gate.ps1` to anchor these terms more tightly (e.g., require a prefix like `windows-wireless/casting` rather than bare `/casting/`).
2. **Accept as false positives** and exclude Squad product paths explicitly in the gate.
3. **Coordinator confirms** that Squad's casting/identity/orchestration-log directories are NOT intended for the upstream push — in which case Gate 1 is correctly flagging them and a larger architectural scoping decision is needed.

**This decision requires coordinator input before action.**

---

## Scrub Gate Boundary Discovery

The scrub gate's path patterns are too broad for a codebase that uses `casting`, `identity`, and `orchestration-log` as product feature names. The `.squad/` exclusion is the highest-confidence, lowest-risk fix. The `docs/_internal/` rename is the next step. Product directory scoping requires a coordinator ruling.

---

## No Commit Required

RETRO made no source changes. All violations are baseline. Per procedure: STOP and report. Do not silently modify earlier branches. This decision drop is the artifact for Scribe to process and the coordinator to act on.


---

# Decision: Piece 18 Doctor Enhancements Revision

**Author:** CONTROL  
**Date:** 2026-05-19  
**Branch:** `akubly/upstream-18-doctor-enhancements` → `c515745b`

## Context

EECOM authored piece 18 (`feat(doctor)`) at commit `1a55178a`. The adversarial review (Flight + FIDO REJECT + RETRO) produced 7 blocking fixes and 5 nit fixes. EECOM is locked out per strict lockout protocol. CONTROL was assigned revision.

## Decisions Made

### 1. `noRegistry` variant for absent/corrupt registry

**Decision:** `runDoctorPurge` now returns `{ noRegistry: true }` when the registry file is absent or corrupt, rather than bubbling a `SquadError` or returning `{ notFound: ... }`. CLI dispatch prints "No registry found." and exits 1.

**Rationale:** Corrupt/absent registry is a different error class than "callsign not found in a valid registry." Callers (CLI and tests) need to distinguish these to provide actionable messages without catching exceptions in the dispatch layer.

### 2. Try/catch around `loadRegistryFromDisk` in `runDoctorPurge`

**Decision:** Wrap `loadRegistryFromDisk` in try/catch so corrupt JSON (which throws `SquadError`) is caught and mapped to `{ noRegistry: true }` rather than propagating.

**Rationale:** `loadRegistryFromDisk` throws on malformed JSON by design (in `packages/squad-sdk/src/registry.ts`). The purge function must handle this gracefully rather than letting the CLI catch block print an unhandled error.

### 3. Async `promptFn` replaces sync `readLine`

**Decision:** `RunDoctorPurgeOpts.readLine?: () => string` is replaced by `promptFn?: (question: string) => Promise<string>`. Default implementation uses readline with a Promise.

**Rationale:** Sync readline blocks the event loop in non-TTY test environments. The async pattern matches the promptFn convention used in `runDoctorNormalize` and allows proper test injection without blocking.

### 4. CRLF normalization via `git add --renormalize`

**Decision:** Applied `git add --renormalize` to force LF normalization in the index for all modified `.ts` files. Also cleaned up 7 pre-existing trailing-whitespace lines in `cli-entry.ts` that were exposed by the normalization.

**Rationale:** `core.autocrlf=true` does not re-normalize files already committed as CRLF. `--renormalize` is the correct tool. Pre-existing trailing whitespace was a latent `git diff --check` failure that needed cleanup to pass the whitespace gate.

### 5. Callsign validation regex `^[A-Za-z0-9_-]+$` (max 64 chars)

**Decision:** Added `_CALLSIGN_RE = /^[A-Za-z0-9_-]+$/` validation in `runDoctorPurge` before any registry I/O. Returns `{ invalidCallsign: true }` for violations.

**Rationale:** Prevents path traversal and injection attacks via crafted callsign arguments. Pattern matches the piece-02 callsign format constraint and mirrors the validation in `runInit`.


---

# Decision: Shared close-match helper — piece 15 revision

**Date:** 2026-05-18T16:19:28-07:00  
**Author:** EECOM  
**Subject:** Extract `findCloseMatch` to shared `lib/close-match.ts`

## Context

Both `assign.ts` and `unassign.ts` independently contained a 25-line Levenshtein/prefix-suggestion helper (`_findCloseMatch`). The duplication was flagged by Flight (F7) during adversarial review of piece 15.

## Decision

Extract to `packages/squad-cli/src/lib/close-match.ts` as a named export `findCloseMatch`. Both commands import and alias it as `_findCloseMatch` to minimize call-site diff noise. The export surface is minimal — one function, no dependencies.

## Rationale

- Eliminates maintenance risk from divergent edits to two copies of the same algorithm.
- `packages/squad-cli/src/lib/` is the established location for non-command utilities (compare `git-root.ts`).
- The function has no side effects and no external dependencies; extraction is safe.

## Applies to

All future commands that need callsign suggestion should import from `../lib/close-match.js` rather than implementing their own Levenshtein variant.


---

# Decision: Piece 16 — scaffold-state behavior change and reactivation result shape

**Date:** 2026-05-18  
**Piece:** 16 — squad init refactor  

## Topics

### 1. Scaffold-state detection: no longer throws for existing `.squad/` directories

**Decision:** `resolveScaffoldState` returns `'present'` (no throw) when `.squad/` exists and contains sentinel files. `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` is only raised for **symbolic links**. Existing directories with sentinel files proceed to registration logic.

**Rationale:** The spec (piece 16) requires "registering an existing scaffold" and "idempotent registration" as first-class flows. The prior throw-on-existing behavior blocked both. Symlinks remain rejected because writing through a symlink is a dangerous side-channel with no valid recovery path.

**Impact:** Guard-order tests in `test/cli/init-scope.test.ts` that expected `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` when scaffold + callsign conflict were both present now expect `ERR_SQUAD_INIT_CALLSIGN_EXISTS`. The scaffold-state check is no longer the first guard in the conflict chain; registry guards run first.

### 2. Reactivation result shape

**Decision:** `runInit` returns `{ reactivated: { callsign, path } }` for both:
- Inactive-at-same-path (writes `status: 'active'` to registry), and  
- Active-at-same-path (idempotent, no write).

Callers that need to distinguish the two cases can check whether the registry file changed — the result shape intentionally does not expose this. Both cases represent "this squad is now registered and active."

**Rationale:** Simplicity. Callers (CLI, tests) only need to know the final state, not whether a write occurred. The spread `{ ...entry, status: 'active' }` pattern ensures unknown future fields are preserved across reactivation round-trips.


---

# Decision: Piece 18 Revision Verification — FIDO

**Author:** FIDO  
**Date:** 2026-05-19  
**Branch:** `akubly/upstream-18-doctor-enhancements` → `b7d669a4` (log commit over `c515745b`)

## Verdict: APPROVE

All three blocking items from FIDO's initial rejection are resolved.

## F5 — CLI-layer tests

7 subprocess tests in `test/cli/doctor-registry-cli.test.ts` (CLI1–CLI6b). All 6 required scenarios are covered:

| Test | Scenario | Assertion |
|------|----------|-----------|
| CLI1 | `--help` output | contains `--normalize-callsigns` and `--purge` |
| CLI2 | `--purge` no argument | exit code ≠ 0 |
| CLI3 | `--purge` active entry with consumers | exit code = 2 |
| CLI4 | Cancelled purge (stdin `n`) | exit 0; registry byte-identical |
| CLI5 | `--normalize-callsigns` dry-run | exit 0; registry byte-identical |
| CLI6a | `--apply` when collision pair exists | registry written, squads count = 1 |
| CLI6b | `--apply` when no collision exists | registry byte-identical |

## F6 — N03 origins dedup assertion

`doctor.test.ts` lines 391–393 assert `origins[]` has length 1 after merge. Not just clone dedup — origins array directly verified.

## F7 — N07 clone-count tiebreaker

`doctor.test.ts` lines 445–461: equal `active` status, `'first'` 1 clone vs `'First'` 2 clones. Test asserts `survivor.callsign === 'First'`. Higher clone count wins the tie. ✅

## Test Results

- Doctor unit tests (`packages/squad-cli/src/commands/__tests__/doctor.test.ts`): **33 tests, all GREEN**
- CLI-layer tests (`test/cli/doctor-registry-cli.test.ts`): **7 tests, all GREEN**
- Build: **CLEAN** (exit 0)

Full-suite failures (24 tests across `register.test.ts` and `team-root-resolution.test.ts`) confirmed pre-existing at upstream-17 baseline — not attributable to piece 18.

## Scrub Gate

2/6 passed. Gates 1 (strip-listed paths) and 2 (wifi-aware mentions) FAIL — pre-existing baseline contamination per `decisions.md` policy accepted across all Phase B pieces. No new strip-listed paths or wifi-aware content introduced in the piece-18 diff.


---

# Decision: Piece 18 Revision Verified — APPROVE

**Author:** Flight  
**Date:** 2026-05-19  
**Branch:** `akubly/upstream-18-doctor-enhancements` → `b7d669a4` (code at `c515745b`)

## Context

Flight rejected piece 18 v1 with 4 blocking issues. CONTROL revised under lockout protocol. This decision records the verification outcome.

## Verdict: APPROVE

All 4 blocking items and all claimed nit fixes are confirmed resolved.

## Blocking Items Resolved

### F1 — CRLF normalization
`git diff akubly/upstream-17-fuzzy-match..HEAD -- packages/squad-cli/src/cli-entry.ts | Select-String -Pattern "\`r$"` returns empty. LF-only confirmed. `git diff --check` flags only intentional Markdown trailing spaces in the decision file (not source code).

### F2 — Mutual exclusion guard
`cli-entry.ts` dispatch block:
```
if (hasApply && !hasNormalize) { fatal('--apply requires --normalize-callsigns') }
if (hasNormalize && hasPurge) { fatal('--normalize-callsigns and --purge are mutually exclusive') }
// --normalize-callsigns mode
if (hasNormalize) { ... }
// --purge mode
if (hasPurge) { ... }
```
Both exclusion checks land before either mode branch executes.

### F3 — copilotHome removed
No `+` line containing `copilotHome` in doctor.ts diff. Field is absent from `RunDoctorOpts` and the exported API surface.

### F4 — noRegistry variant
`RunDoctorPurgeResult` carries `noRegistry?: true`. Two distinct return sites cover absent registry path and corrupt/unloadable registry. CLI dispatch:
```typescript
if (result.noRegistry) {
  console.error('No registry found.');
  process.exit(1);
}
```
Cleanly separated from `result.notFound` path which prints "Callsign not found."

## Nit Fixes Confirmed

- **N1** async `promptFn?: (question: string) => Promise<string>` — replaces sync readline.
- **N2** `insertAt` recomputed against mutated `currentEntries` array — drift fixed.
- **N5** `--apply` without `--normalize-callsigns` emits `fatal('--apply requires --normalize-callsigns')`.

## New Issues Introduced

None that block merge. One observation: `git diff --check` exits 2 due to trailing spaces in `.squad/decisions/inbox/control-piece-18-revision-doctor.md`. These are intentional Markdown line-break spaces, not a source quality issue.

## Pattern Recorded

`noRegistry` as a dedicated result variant (not `notFound`, not thrown exception) is the correct disambiguation pattern when registry absence/corruption is a distinct error class from "entry not found in a valid registry." Future commands that read the registry should adopt this three-way result shape: `noRegistry | notFound | success`.


---

### 2026-05-19: Piece 19 — Copilot Payload Quality Review Cycle

**Author:** Scribe (Merge — Flight + FIDO + CAPCOM + GNC)  
**Date:** 2026-05-19  
**Branch:** kubly/upstream-19-copilot-payload → final commit 2377c3a8 (amended, force-pushed)  
**Predecessor:** kubly/upstream-18-doctor-enhancements

## Context

EECOM authored piece 19 (Copilot payload orchestration). Adversarial review cycle:
- **Flight (Lead):** 19/19 spec tests present, gates pass. ✅ APPROVE.
- **FIDO (Quality):** 3 blocking coverage gaps (cold-start ordering, hyphenated callsign extraction, 
unDoctor integration wiring). ❌ REJECT.
- **CAPCOM (SDK Expert):** 3 blocking contract issues (CopilotPayloadError surface leakage, symlink-safe copy, callsign format guard). ❌ REJECT.
- **GNC (Runtime):** Implemented security guards + test coverage (26 tests added). EECOM locked out per protocol.
- **CAPCOM (Round 2):** Wrapped error surface, demoted 
ewriteFrontmatterName, added FIDO test gaps, all 143 tests pass. ✅ SHIP.

## Blocking Findings (Resolved)

### FIDO Quality Gaps (Round 1)

1. **Cold-start payload ordering:** No test coverage for multi-payload load sequence behavior. **Fixed by CAPCOM Round 2** with new test case.
2. **Hyphenated callsign extraction:** _extractCandidateCallsign not tested against callsign-with-hyphens. **Fixed by CAPCOM Round 2** with new test case.
3. **
unDoctor orphan wiring:** 
unDoctor not integration-tested as part of payload assignment flow. **Fixed by CAPCOM Round 2** with integration test.

### CAPCOM SDK Gaps (Round 1)

1. **CopilotPayloadError surface leak:** Exception was leaking past AssignError wrapper in 
unAssign path. **Fixed by CAPCOM Round 2:** wrapped in both warm-path and cold-start paths.
2. **_copyDirRecursive symlink vulnerability:** Followed symlinks (file exfiltration on cold-start trust boundary). **Fixed by GNC:** new symlink-safe copy implementation + ssertValidCallsign guard.
3. **Callsign format guard missing:** No validation before path.join; normalizes .. attacks. **Fixed by GNC:** new ERR_PAYLOAD_INVALID_CALLSIGN error code + validation helper.

## Key Decisions Made

1. **ERR_PAYLOAD_INVALID_CALLSIGN post-write handling:** Surface as warnings[] entry, not throw. Rationale: registry write already succeeded; this is a programmer-error scenario.
2. **
ewriteFrontmatterName demoted to _rewriteFrontmatterName:** Removed from barrel export. Public API surface narrowed.
3. **Reviewer rejection lockout enforced:** EECOM locked out per strict protocol. CAPCOM and GNC owned the revision.
4. **Gate 1 baseline contamination accepted:** Pre-existing on predecessor branch; this revision introduces zero new violations.

## Outcome

- **Final commit:** 2377c3a8 (amended, single)
- **Tests:** 143/143 passing
- **Build:** Clean
- **Ship decision:** CAPCOM Round 2 approved for merge to dev.


---

# Decision: Piece 18 Doctor Enhancements Revision

**Author:** CONTROL  
**Date:** 2026-05-19  
**Branch:** `akubly/upstream-18-doctor-enhancements` → `c515745b`

## Context

EECOM authored piece 18 (`feat(doctor)`) at commit `1a55178a`. The adversarial review (Flight + FIDO REJECT + RETRO) produced 7 blocking fixes and 5 nit fixes. EECOM is locked out per strict lockout protocol. CONTROL was assigned revision.

## Decisions Made

### 1. `noRegistry` variant for absent/corrupt registry

**Decision:** `runDoctorPurge` now returns `{ noRegistry: true }` when the registry file is absent or corrupt, rather than bubbling a `SquadError` or returning `{ notFound: ... }`. CLI dispatch prints "No registry found." and exits 1.

**Rationale:** Corrupt/absent registry is a different error class than "callsign not found in a valid registry." Callers (CLI and tests) need to distinguish these to provide actionable messages without catching exceptions in the dispatch layer.

### 2. Try/catch around `loadRegistryFromDisk` in `runDoctorPurge`

**Decision:** Wrap `loadRegistryFromDisk` in try/catch so corrupt JSON (which throws `SquadError`) is caught and mapped to `{ noRegistry: true }` rather than propagating.

**Rationale:** `loadRegistryFromDisk` throws on malformed JSON by design (in `packages/squad-sdk/src/registry.ts`). The purge function must handle this gracefully rather than letting the CLI catch block print an unhandled error.

### 3. Async `promptFn` replaces sync `readLine`

**Decision:** `RunDoctorPurgeOpts.readLine?: () => string` is replaced by `promptFn?: (question: string) => Promise<string>`. Default implementation uses readline with a Promise.

**Rationale:** Sync readline blocks the event loop in non-TTY test environments. The async pattern matches the promptFn convention used in `runDoctorNormalize` and allows proper test injection without blocking.

### 4. CRLF normalization via `git add --renormalize`

**Decision:** Applied `git add --renormalize` to force LF normalization in the index for all modified `.ts` files. Also cleaned up 7 pre-existing trailing-whitespace lines in `cli-entry.ts` that were exposed by the normalization.

**Rationale:** `core.autocrlf=true` does not re-normalize files already committed as CRLF. `--renormalize` is the correct tool. Pre-existing trailing whitespace was a latent `git diff --check` failure that needed cleanup to pass the whitespace gate.

### 5. Callsign validation regex `^[A-Za-z0-9_-]+$` (max 64 chars)

**Decision:** Added `_CALLSIGN_RE = /^[A-Za-z0-9_-]+$/` validation in `runDoctorPurge` before any registry I/O. Returns `{ invalidCallsign: true }` for violations.

**Rationale:** Prevents path traversal and injection attacks via crafted callsign arguments. Pattern matches the piece-02 callsign format constraint and mirrors the validation in `runInit`.


---

# Decision: Shared close-match helper — piece 15 revision

**Date:** 2026-05-18T16:19:28-07:00  
**Author:** EECOM  
**Subject:** Extract `findCloseMatch` to shared `lib/close-match.ts`

## Context

Both `assign.ts` and `unassign.ts` independently contained a 25-line Levenshtein/prefix-suggestion helper (`_findCloseMatch`). The duplication was flagged by Flight (F7) during adversarial review of piece 15.

## Decision

Extract to `packages/squad-cli/src/lib/close-match.ts` as a named export `findCloseMatch`. Both commands import and alias it as `_findCloseMatch` to minimize call-site diff noise. The export surface is minimal — one function, no dependencies.

## Rationale

- Eliminates maintenance risk from divergent edits to two copies of the same algorithm.
- `packages/squad-cli/src/lib/` is the established location for non-command utilities (compare `git-root.ts`).
- The function has no side effects and no external dependencies; extraction is safe.

## Applies to

All future commands that need callsign suggestion should import from `../lib/close-match.js` rather than implementing their own Levenshtein variant.


---

# Decision: Piece 16 — scaffold-state behavior change and reactivation result shape

**Date:** 2026-05-18  
**Piece:** 16 — squad init refactor  

## Topics

### 1. Scaffold-state detection: no longer throws for existing `.squad/` directories

**Decision:** `resolveScaffoldState` returns `'present'` (no throw) when `.squad/` exists and contains sentinel files. `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` is only raised for **symbolic links**. Existing directories with sentinel files proceed to registration logic.

**Rationale:** The spec (piece 16) requires "registering an existing scaffold" and "idempotent registration" as first-class flows. The prior throw-on-existing behavior blocked both. Symlinks remain rejected because writing through a symlink is a dangerous side-channel with no valid recovery path.

**Impact:** Guard-order tests in `test/cli/init-scope.test.ts` that expected `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` when scaffold + callsign conflict were both present now expect `ERR_SQUAD_INIT_CALLSIGN_EXISTS`. The scaffold-state check is no longer the first guard in the conflict chain; registry guards run first.

### 2. Reactivation result shape

**Decision:** `runInit` returns `{ reactivated: { callsign, path } }` for both:
- Inactive-at-same-path (writes `status: 'active'` to registry), and  
- Active-at-same-path (idempotent, no write).

Callers that need to distinguish the two cases can check whether the registry file changed — the result shape intentionally does not expose this. Both cases represent "this squad is now registered and active."

**Rationale:** Simplicity. Callers (CLI, tests) only need to know the final state, not whether a write occurred. The spread `{ ...entry, status: 'active' }` pattern ensures unknown future fields are preserved across reactivation round-trips.


---

# Decision Drop — Scrub Gate Cleanup Policy (Pre-Phase C)

**Author:** RETRO  
**Date:** 2026-05-19  
**Status:** Proposed — requires Scribe merge + coordinator action  
**Requested by:** akubly

---

## Context

Gate 1 (strip-listed paths) and Gate 2 (wifi-aware mentions) have failed on every Phase B piece. FIDO accepted this as pre-existing baseline contamination per decisions.md policy. The coordinator has now directed cleanup before Phase C regardless of that policy.

RETRO performed a full scrub gate diagnosis on `akubly/upstream-18-doctor-enhancements` (HEAD `38cbc69e`). All violations are baseline — none were introduced by piece 18.

---

## Findings

### Gate 1 — Strip-listed path violations (all baseline)

The three violation categories and their earliest birth commits:

| Category | Example paths | Birth commit | Count |
|---|---|---|---|
| `docs/_internal/` | 17 design/PRD docs | `482fd58d` | 17 |
| Product dirs (`/casting/`, `/identity/`, `orchestration-log`) | `packages/squad-sdk/src/casting/`, `templates/identity/`, `**/orchestration-log.md` | `df4fafe6` | ~15 |
| `.squad/` infrastructure | `.squad/orchestration-log/`, `.squad/identity/`, `.squad/casting/` | earliest pieces | ~99 |

**Zero Gate 1 violations were introduced by piece 18.**

### Gate 2 — Wifi-aware content (all baseline, all in `.squad/`)

Single root source: `.squad/reviews/piece-13-adversarial-review.md` line 160 contains the literal text `git grep -i 'wifi.aware'` as a shell command in a scrub-gate report block. This is a **false positive** — the file records that the search returned 0 actual hits. Three downstream files (fido history, decisions.md, an orchestration log) mention this as the source of the failure; they do not contain wifi-aware content independently.

**Zero Gate 2 violations were introduced by piece 18.**

---

## Proposed Decisions

### Decision A — Scrub Gate `.squad/` exclusion (recommended, low risk)

Update `_scrub-gate.ps1` to exclude `.squad/` from both Gate 1 (path scan) and Gate 2 (content scan). The gate already excludes itself (`':!docs/proposals/upstream-bradygaster/_scrub-gate.ps1'`). The `.squad/` directory is team infrastructure — history files, casting records, identity documents, orchestration logs. None of it is destined for the upstream push; it is not in the submission diff.

**Effect:** Removes ~116 of the 131+ Gate 1 violations. Removes all 4 Gate 2 violations.  
**Risk:** Low. Does not touch source code. `.squad/` content is already excluded from the upstream submission by convention.

**Implementation:** In `_scrub-gate.ps1` Gate 1, filter out `.squad/` and `.squad-templates/` paths from `git ls-files` output before matching. In Gate 2, add `':!.squad/'` and `':!.squad-templates/'` to the `git grep` exclusion list.

---

### Decision B — `docs/_internal/` rename (required for full Gate 1 pass)

Rename `docs/_internal/` → `docs/design/` to remove the `_internal` path component that matches the strip pattern.

**Effect:** Removes 17 additional Gate 1 violations.  
**Risk:** Medium. Requires a rebase-style cleanup commit touching 17 files + any cross-references to the `_internal/` path. Must be applied to a branch rebased on top of piece 18 (not a mid-stack edit).

**Recommended vehicle:** A dedicated Phase C cleanup commit (`chore(docs): rename docs/_internal to docs/design for upstream scrub compliance`) on a new branch from `akubly/upstream-18-doctor-enhancements`, NOT an amendment to any piece-N commit.

---

### Decision C — Product directory strip-list refinement (requires coordinator input)

Squad's own product directories — `/casting/`, `/identity/`, `orchestration-log` in `templates/` and `packages/squad-sdk/src/` — match the strip-list pattern. These are intended for the upstream push. The strip-list was designed to exclude MS-internal Windows wireless team artifacts, not Squad's own features.

**Options:**
1. **Refine the pattern** in `_scrub-gate.ps1` to anchor these terms more tightly (e.g., require a prefix like `windows-wireless/casting` rather than bare `/casting/`).
2. **Accept as false positives** and exclude Squad product paths explicitly in the gate.
3. **Coordinator confirms** that Squad's casting/identity/orchestration-log directories are NOT intended for the upstream push — in which case Gate 1 is correctly flagging them and a larger architectural scoping decision is needed.

**This decision requires coordinator input before action.**

---

## Scrub Gate Boundary Discovery

The scrub gate's path patterns are too broad for a codebase that uses `casting`, `identity`, and `orchestration-log` as product feature names. The `.squad/` exclusion is the highest-confidence, lowest-risk fix. The `docs/_internal/` rename is the next step. Product directory scoping requires a coordinator ruling.

---

## No Commit Required

RETRO made no source changes. All violations are baseline. Per procedure: STOP and report. Do not silently modify earlier branches. This decision drop is the artifact for Scribe to process and the coordinator to act on.

---

# 2026-05-21 — Canonical callsign validation helper

## Decision

Callsign validation is centralized in `packages/squad-sdk/src/callsign.ts`.

The canonical rule is:
- lowercase alphanumeric plus internal hyphens only
- 1-64 characters
- no leading or trailing hyphen
- no uppercase letters, underscores, or periods

Future code MUST import the shared helper and MUST NEVER duplicate the callsign regex inline.

## Rationale

The SDK reader (`resolution-v2.ts`), Copilot payload namespace code (`copilot-payload.ts`), and CLI doctor purge guard had diverged into incompatible callsign checks. Centralizing the regex, max length, validator, and shared error text keeps writer/reader/CLI behavior aligned and gives one place to tighten or document the rule.

The earlier path-traversal hardening decisions in `.squad/decisions.md` (entries around 2168 and 2423) remain valid. The new callsign rule is strictly stricter than those guards and preserves the same security goal while eliminating uppercase/underscore drift.


---

# EECOM Decision — upgrade global agent sync, doctor misplaced `.squad`, registry dedup

## Decision

1. `squad upgrade` must refresh the global coordinator agent install when `~/.copilot/agents/squad.agent.md` already exists.
2. `squad doctor` should warn when a consumer repo contains a leaked `.squad/` directory but registry resolution points to a different squad root.
3. `upsertEntry()` is the defense-in-depth boundary for registry normalization and must deduplicate canonical `origins[]` and normalized `clones[]` before returning.

## Rationale

- Upgrade owns both the repo-local `.github/agents/squad.agent.md` mirror and the user-scoped coordinator install created by `squad assign`; letting only one refresh causes silent drift.
- The leaked consumer `.squad/` directory is real user-facing contamination but not a blocking runtime failure, so doctor reports it as `warn` severity with cleanup guidance.
- CLI callers already try to deduplicate registry values, but SDK callers can bypass that path. The registry write-preparation helper must enforce canonical uniqueness itself.

## Verification

- `npm run build`
- `npx vitest run test/cli/upgrade.test.ts packages/squad-cli/src/commands/__tests__/doctor.test.ts test/registry-schema.test.ts`


---

# Decision: Upgrade and Doctor are the Repair/Diagnosis Surfaces (Not Init)

**Author:** Flight (Lead)  
**Date:** 2026-05-21T17:10:56-07:00  
**Context:** Piece 21 smoke test revealed silent template no-ops in `squad init`. Audit of pieces 1–21 confirms the right fix surface.

## Decision

1. **`squad init` must NOT attempt repair.** Its contract is: create scaffold + register. If partial state exists, it short-circuits (by design). This is correct — repair belongs in `upgrade` and `doctor`.

2. **`squad upgrade` owns "bring to latest."** Any new artifact introduced by a piece (files, directory layout, agent files, copilot payloads, registry schema migrations) that should be refreshable → add to upgrade.

3. **`squad doctor` owns "diagnose drift."** For every artifact `upgrade` writes, `doctor` should verify presence/validity. For every invariant the registry or payload system maintains, `doctor` should detect violations.

4. **Cross-command coherence rule:** For every `doctor` finding with severity ≥ warn, there must be either (a) a corresponding `upgrade` repair path, or (b) an actionable user instruction in the finding message. Findings that say "something is wrong" without a path to resolution are UX failures.

## Rationale

The smoke test failure was caused by `init`'s scaffold-presence guard short-circuiting when partial scaffold exists — exactly its designed behavior. The correct response is to extend `upgrade` to repair the state `init` cannot safely re-create, and `doctor` to detect the drift before the user notices.

## Applies To

All future pieces that introduce:
- New files in `.squad/`, `.github/`, or `~/.copilot/`
- New registry fields or invariants
- New SDK exports that CLI commands depend on
- New failure modes the user can hit

Each such piece should include: (1) an upgrade handler for the new artifact, (2) a doctor check for its absence/corruption.

## Consequences

- **Adopting:** Upgrade/doctor become the canonical "squad health" surface. Users run `squad doctor` to diagnose, `squad upgrade` to repair. Init stays simple.
- **Not adopting:** Repair logic leaks into init (violating its fail-fast guard contract) or into ad-hoc command flags, fragmenting the UX.


---

### 2026-05-21: TEAM_ROOT-prefixed spawn template writes

**Author:** Procedures  
**Date:** 2026-05-21T13:45:30-07:00  
**Context:** Shared-squad consumer repos run agents from the consumer repo CWD, so bare `.squad/` write paths in spawn templates leak state into the wrong repository.

## Decision

All agent-facing write paths in `squad.agent.md` spawn templates must be anchored at `TEAM_ROOT`, or at `SQUAD_DIR` when the prompt defines `SQUAD_DIR` as `{TEAM_ROOT}/.squad`.

## Rationale

`TEAM_ROOT` is the actual owner of squad state. Agent CWD is not a safe anchor in shared-squad mode, so bare relative `.squad/` paths create state pollution and break decision/history hygiene.

## Applies to

- Agent AFTER-work writes
- Lightweight template decision writes
- Scribe prompt file operations
- Team-root-resolved read instructions that should stay aligned with write paths

---

### 2026-05-22: Piece 21 Branch-Relevant Fix Plan

# Decision: Piece 21 Branch-Relevant Fix Plan — Scope, Drops, and Ship Gate

**Author:** Flight  
**Date:** 2026-05-22  
**Context:** Turn 3 of the piece-21 audit thread. Prior turns: full gap audit (T1/T2/T3 + cross-command + dual-doctor), branch attribution pass.

---

## Scope Decision

### Gaps DROPPED from the fix plan

**T2-2 — Multi-format registry migration**  
*Reason:* The registry feature (`registry.ts`, `loadRegistryFromDisk`, `parseRegistry`) is entirely new on branch `akubly/upstream-21-post-stack-review`. No users on `origin/dev` have a registry file in any format. The `squad-repos.json` legacy detection in `loadRegistryFromDisk` (registry.ts:279–286) already emits a warning. Full migration code would add complexity with zero consumers. **DROP.**

**T3-6 — Backward-compatibility mode**  
*Reason:* Same logic as T2-2. No shipped pre-release builds used a different registry shape. Any user who ran the CLI while this branch was in development would be an internal tester who can re-run `squad init`. **DROP.**

### T2-5 vs T3-5 — Reconciliation

These are the same gap at different severity labels. T2-5 (cross-platform path display in *new* registry doctor output) and T3-5 (cross-platform path display polish across *all* doctor output) overlap completely — fixing one means fixing both. **Merge into single FIX-7 at T2-5 severity.** T3-5 is retired as a duplicate label.

---

## In-Scope Fix List

| ID    | Gap ID  | Bucket | Severity | Description |
|-------|---------|--------|----------|-------------|
| FIX-1 | T1-1    | (a)    | T1       | SDK export smoke-test in upgrade |
| FIX-2 | T1-2    | (a)(c) | T1       | Upgrade copilot payload repair path |
| FIX-3 | T1-4    | (b)    | T1       | Doctor verifies .gitattributes/.gitignore |
| FIX-4 | T1-5    | (a)(c) | T1       | Registry schema migration in upgrade |
| FIX-5 | T2-1    | (c)    | T2       | Per-entry corruption detection in doctor |
| FIX-6 | T2-3    | (c)    | T2       | Bulk stale-path repair via --normalize |
| FIX-7 | T2-5+T3-5 | (c) | T2       | Cross-platform path display (merged) |
| FIX-8 | DUAL-DOCTOR | (a) | STRUCT  | Dual-doctor structural unification |
| FIX-9 | CROSS-CMD | (b)  | T2       | Skills/instructions/global-agent doctor checks |

---

## Ship Gate Boundary

### Must ship before piece 21 merges to `dev`

FIX-1, FIX-2, FIX-3, FIX-4, FIX-5, FIX-9

Rationale: These 6 fixes are the minimum set needed for the shared-squad workflow to be correctly diagnosable and repairable. Without them, `squad upgrade` silently skips payload refresh for registered repos, `squad doctor` cannot verify the .gitattributes/.gitignore writes that enable team-state conflict resolution, and per-entry registry corruption causes silent "no registry found" responses.

### Can follow as immediate dev PRs post-merge

FIX-6, FIX-7, FIX-8

Rationale: FIX-6 (bulk stale repair) and FIX-7 (path display) are polish — current behavior is functional, just suboptimal. FIX-8 (dual-doctor unification) is deliberately deferred to piece 22: it is L complexity, doesn't unblock any piece-21 functionality, and the compounding architectural benefit is better captured as a standalone PR with its own test sweep.

---

## Dual-Doctor Architectural Ruling

**Decision: Defer FIX-8 to piece 22.**

Arguments for landing in piece 21:
- Unification removes the root cause of the asymmetries that generated FIX-3 and FIX-9
- Without it, FIX-3/FIX-9 add checks to the legacy doctor in a form that will need to be reworked when unification lands

Arguments for deferral:
- L complexity (new shared type, refactor of both rendering paths in cli-entry.ts, two doctor modules)
- FIX-3 and FIX-9 can be added to the legacy doctor with a comment marking them for unification
- Piece 21's PR blast radius is already large; adding an architectural refactor increases review risk
- The dual-doctor structural debt existed before this branch and isn't required for feature correctness

**Ruling:** Add FIX-3/FIX-9 checks to legacy doctor with `// TODO(piece-22): merge into unified doctor` markers. Piece 22 PR will be a pure refactor: no behavior change, only structural unification.

# EECOM FIX-2 Decision — upgrade payload refresh is warn-only

**Date:** 2026-05-22
**Author:** EECOM

## Decision

`squad upgrade` refreshes the per-repo Copilot payload after each `installCoordinatorAgent` call when the registry contains a matching `.squad` path with a callsign. The test seam is `UpgradeOptions.copilotPayloadInstaller?: typeof installCopilotPayload`, matching the existing direct option-injection pattern used for upgrade-time SDK seams.

Payload refresh failures are non-fatal: upgrade emits `warn(...)` and continues.

## Rationale

Upgrade owns repairing upgrade-managed artifacts, but a payload copy failure should not block template, workflow, migration, or coordinator-agent refresh. Matching registry entries with `normalisedPathKey` keeps the behavior aligned with registry path semantics instead of depending on platform-specific raw strings. 
--- # Decision: Expose Registry Entry Validator as Internal Diagnostic API

**Author:** EECOM
**Date:** 2026-05-22T14:08:38-07:00
**Context:** FIX-5 needed `squad doctor` to identify individual malformed registry entries after `loadRegistryFromDisk` rejects the whole registry.

## Decision

Export `validateEntry(value: unknown, entryIndex: number): RegistryEntry` from `packages/squad-sdk/src/registry.ts` with an `@internal` JSDoc marker, and consume it from `@bradygaster/squad-sdk/registry` in the registry-aware doctor.

## Rationale

The registry subpath is already the schema and disk-I/O boundary, so exposing the existing per-entry validator there keeps diagnostics aligned with canonical registry validation. I did not add `validateEntry` to the root SDK barrel because the root API already re-exports marketplace `validateEntry`, so a second root export would create a name collision and make the public API ambiguous.

## Consequences

- CLI diagnostics can report exact malformed registry entry indices without duplicating schema rules.
- Normal consumers should still prefer `parseRegistry`, `validateRegistry`, or `loadRegistryFromDisk`.
- If a future root-barrel export is desired, it should use an explicit alias such as `validateRegistryEntry` rather than `validateEntry`. 
--- # GNC FIX-1 SDK Smoke-Test Decision

Date: 2026-05-22

## Decision

`squad upgrade` uses a static import of SDK exports it needs to verify after a template refresh. The post-upgrade smoke-test calls `defaultRegistryFilePath()` after the global coordinator agent refresh and warns instead of throwing if the call path fails.

## Rationale

Static import keeps missing SDK exports visible at module load, matching the failure mode from the post-stack review. The runtime smoke-test gives users a recoverable warning when the symbol exists but cannot be called in the current install. 
--- # Decision: FIX-4 registry migration uses current package semver

**Author:** GNC
**Date:** 2026-05-22T14:08:38-07:00

## Decision

Register the legacy `squad-repos.json` cleanup migration at `0.9.6`, matching the current package feature version on this branch after stripping build metadata.

## Rationale

The existing CLI migration runner uses additive semver entries and strips prerelease/build suffixes during comparison. The branch packages report `0.9.6-build.*`, so a `0.9.6` migration runs during upgrades into this branch without inventing a prerelease-only migration key. 
--- # Procedures Decision — shared upgrade-managed file conventions

**Date:** 2026-05-22

## Context

Piece 21 FIX-3/FIX-9 added legacy doctor checks for artifacts managed by `squad upgrade`. Two convention lists, `.gitattributes` merge rules and `.gitignore` entries, were previously declared inline in `upgrade.ts`, but doctor needs to validate the exact same contract.

## Decision

Create `packages/squad-cli/src/cli/core/squad-file-conventions.ts` as the single source of truth for `GITATTRIBUTES_RULES` and `GITIGNORE_ENTRIES`. Both `upgrade.ts` and `doctor.ts` import the constants from that module instead of duplicating them.

## Consequences

- Upgrade and doctor cannot drift on required repository convention entries.
- Future artifact checks should prefer shared convention modules over re-declaration.
- The module remains dependency-light and safe for CLI core imports. 
---
