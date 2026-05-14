# Sims — 08b Revision Decision Drop

**By:** Sims (Integration / E2E)  
**Date:** 2026-05-14  
**Branch:** `akubly/upstream-08b-migrate-user-action-commands`  
**Revision of:** commit `012d6d16` (EECOM)  
**Commit strategy:** Follow-on commit on top of `ca413407` (Scribe closure). Phase C will squash with `012d6d16` before PR. EECOM remains locked out per Reviewer Rejection Protocol.

---

## Verdict-by-Verdict Resolution

### FIDO Gap #1 — Consult setup-mode success path absent

**Ruling:** Closed.

Added test `consult setup creates .squad/config.json when resolver succeeds and personal squad exists` in `test/cli/legacy-resolver-migration.test.ts`. The test:
1. Runs `git init` on `consumerRepo` (proper git tree needed for `setupConsultMode` to write `.git/info/exclude`).
2. Runs `squad init --global` with a test-local XDG config location to create a personal squad.
3. Runs `squad consult` from `consumerRepo` (registered clone in the fixture registry) — the dispatch-level resolver guard passes, `runConsult` receives control, and `setupConsultMode` writes `.squad/config.json`.
4. Asserts `exitCode === 0`, stdout contains `Consult mode activated`, config file exists, and `.git/info/exclude` contains `.squad/`.

**Evidence:** `test/cli/legacy-resolver-migration.test.ts` — test at end of `user-action CLI command resolver migration` describe block.

---

### FIDO Gap #2 — `.gitignore` non-mutation unverified

**Ruling:** Closed.

Extended both consult failure tests and the link failure test with ignore/exclude assertions:

- `consult setup does not create local .squad/ when no squad is found` — added assertion that `TEST_ROOT/.gitignore` does not exist, and that `.git/info/exclude` (if present) does not contain `.squad/`.
- `consult --check does not create .squad/config.json when no squad is found` — same assertions.
- `link does not create .squad/config.json when no squad is found` — added assertion that `TEST_ROOT/.gitignore` does not exist.

**Evidence:** `test/cli/legacy-resolver-migration.test.ts` lines in updated consult and link failure tests.

---

### FIDO Gap #3 — Three assign-to-copilot failure modes

**Ruling: Deferred to a future piece.**

**Spec citation:** 08b spec §`assign-to-copilot` says "Preserve explicit callsign and URL handling. Resolver adoption must not make a URL without the required clone destination perform an implicit clone. Preserve rollback behavior for clone failures and host-verification failures."

**Reasoning:** The verb "preserve" implies these behaviors exist in a prior implementation. The `assign-to-copilot` command is introduced as new work in 08b — there is no prior implementation to preserve. URL-based resolution, git clone operations, and host verification are distinct product features that require their own spec section, not part of the resolver-migration scope. The 08b spec's stated purpose is "each command must settle squad resolution before it performs any file write, registry update, payload installation, clone operation, or other external call." That precondition contract is satisfied.

Deferring these three modes does not leave a safety gap: the current implementation accepts only `--callsign` (a registry key lookup, not a URL), performs no git clone, and has no host-verification step — so there is nothing to preserve and no silent failure to guard against. A future piece that adds URL-based assign or clone-on-assign behavior should spec and test those paths at introduction time.

**Existing coverage for resolver failure and registry non-mutation:** `assign-to-copilot does not mutate registry when callsign is not found` covers the case where the callsign lookup fails after the dispatch guard passes.

---

### FIDO Gap #4 — Dead `resolved` variable

**Ruling:** Closed via two complementary fixes.

**consult and link dispatch (cli-entry.ts):** The dispatch guard for both commands previously stored the result in a named variable that was never used: `const resolved = resolveSquadV2(...)`. Since the runner functions (`runConsult`, `runLink`) handle their own context independently and do not need the resolved struct, the correct fix is to remove the dead variable and use an inline guard check:

```typescript
// Before:
const resolved = resolveSquadV2({ cwd: getSquadStartDir(), env: process.env });
if (!resolved) { ... }

// After:
if (!resolveSquadV2({ cwd: getSquadStartDir(), env: process.env })) { ... }
```

This makes the gate-only semantics explicit: the dispatch layer checks existence; the runner operates from its own inputs.

**assign-to-copilot (cli-entry.ts + assign.ts):** The runner needs the resolved struct (for callsign, path). Added `resolved?: ResolvedSquad` to `RunAssignOpts`. The dispatch guard stores its result and passes it:

```typescript
const guardResult = resolveSquadV2({ cwd: getSquadStartDir(), env: process.env });
if (!guardResult) { fatal(...); return; }
// ...
await runAssignToCopilot({ ..., resolved: guardResult });
```

The runner uses `opts.resolved ?? resolveSquad(...)`, so CLI invocations skip re-resolution while direct (test) invocations fall back gracefully.

**Threading proof test:** Extended `assign-to-copilot reports already-assigned` to assert `result.stdout.toContain(fixture.hostSquad)`. The runner output includes `resolved.path` only if it received the correct resolved struct — proving guard and runner operated on the same context.

**Evidence:** `packages/squad-cli/src/cli-entry.ts` (consult, link, assign dispatch blocks), `packages/squad-cli/src/commands/assign.ts` (`RunAssignOpts.resolved`, implementation), `test/cli/legacy-resolver-migration.test.ts` (threading assertion).

---

### Flight Nit — Dual `resolveSquadV2` / `resolveSquad` imports, guard placement inconsistency

**Ruling:** Closed.

**Import harmonization:** `resolveSquadV2` in `cli-entry.ts` is a local alias for `resolveSquad` from `@bradygaster/squad-sdk` (the alias exists to avoid collision with the legacy `sdk.resolveSquad(path)` call pattern still present in that file). In `assign.ts`, the same function is imported directly as `resolveSquad`. With the threading change (dispatch guard passes result to runner), `assign.ts` no longer calls `resolveSquad` on the primary CLI path — the function is a fallback for direct programmatic invocation. This makes the two call sites non-competing.

**Guard placement:** All three commands now use dispatch-level guards in `cli-entry.ts` as the primary protection. `assign.ts` retains an internal fallback guard (`opts.resolved ?? resolveSquad(...)`) for non-CLI callers only. This is consistent: dispatch is the authority for CLI invocations; internal resolution is a safety net for direct API use.

---

### RETRO Nit — Path validation on `--home` and `opts.cwd`

**Ruling:** Closed.

Added `path.isAbsolute()` checks and `..`-segment detection in two locations:

1. `runAssignToCopilot` (assign.ts): validates `opts.cwd` and `opts.home` before any file-write operation. Rejects non-absolute paths and paths containing `..` traversal segments.
2. CLI dispatch block for `assign-to-copilot` (cli-entry.ts): validates the `--home` flag value before it is passed to the runner.

**Evidence:** `packages/squad-cli/src/commands/assign.ts` top of `runAssignToCopilot`; `packages/squad-cli/src/cli-entry.ts` `assign-to-copilot` block.

---

## Commit Strategy

Follow-on commit on top of `ca413407` (Scribe adversarial-review-closure). Phase C will squash this with `012d6d16` before opening the upstream PR, maintaining the "single squashed commit per piece" invariant in the PR diff.

Scrub gate: Gate 1 FAIL and Gate 3 WARN are pre-existing baseline contamination — accepted by akubly in all prior Phase B pieces. No new strip-listed paths introduced by this revision.

Tests: 31 GREEN (17 `legacy-resolver-migration.test.ts` + 14 `consult.test.ts`). Build: clean.
