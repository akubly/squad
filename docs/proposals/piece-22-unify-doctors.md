# Proposal: Piece 22 — Unify the Dual Doctors

**Author:** Flight (Lead)  
**Date:** 2026-05-22  
**Status:** Draft  
**Scope:** Single PR, mechanical unification  
**Branch:** `squad/piece-22-unify-doctors`

---

## 1. Problem Statement

Squad currently maintains two independent doctor implementations that run sequentially when a user invokes `squad doctor`. The **legacy system doctor** (`packages/squad-cli/src/cli/commands/doctor.ts`) was the original diagnostic surface, returning an array of `DoctorCheck` objects (`{ name, status: 'pass'|'fail'|'warn', message, severity? }`). When piece 18 introduced the registry-aware resolution layer, a **second doctor** (`packages/squad-cli/src/commands/doctor.ts`) was added alongside it rather than extending the original — returning a completely different `RunDoctorResult` shape (`{ severity: 'info'|'warn'|'error', findings: string[] }`). The CLI entry point (`cli-entry.ts:1052–1086`) calls them sequentially under separate `=== System doctor ===` and `=== Registry doctor ===` banners with independent rendering logic, independent severity models, and no shared type system. This creates: (a) two unrelated severity vocabularies, (b) no ability to correlate findings across subsystems, (c) inconsistent exit-code semantics (system doctor always exits 0; registry doctor exits 1 on error), and (d) five `// TODO(piece-22): merge into unified doctor` markers left by piece 21's FIX-3/FIX-9 that require cleanup.

---

## 2. Target Architecture

### 2.1 Unified Finding Type

```typescript
// packages/squad-cli/src/cli/commands/doctor-types.ts (NEW FILE)

/** Severity levels for unified doctor findings. */
export type DoctorSeverity = 'info' | 'warn' | 'error';

/** Source subsystem that produced the finding. */
export type DoctorSource = 'system' | 'registry';

/** Optional repair action for a finding. */
export interface DoctorRepair {
  command: string;
  description: string;
}

/** A single diagnostic finding from the unified doctor. */
export interface DoctorFinding {
  severity: DoctorSeverity;
  label: string;
  message: string;
  source: DoctorSource;
  /** Optional repair hint — deferred to future piece unless trivially included. */
  repair?: DoctorRepair;
}
```

**Location:** `packages/squad-cli/src/cli/commands/doctor-types.ts` — new file, exported from the `cli/commands` barrel.

### 2.2 Conversion Strategy

- Legacy `DoctorCheck` → `DoctorFinding`:
  - `status: 'pass'` → omit (pass findings are not displayed in unified output; tracked only for summary counts)
  - `status: 'fail'` → `severity: 'error'`
  - `status: 'warn'` → `severity: 'warn'`
  - `severity: 'info'` override → `severity: 'info'`
  - `source: 'system'` for all legacy checks
  - `label` = `DoctorCheck.name`
  - `message` = `DoctorCheck.message`

- Registry `RunDoctorResult` → `DoctorFinding[]`:
  - Each `finding` string → one `DoctorFinding` with `source: 'registry'`
  - The overall `severity` applies to all findings from that run (existing behavior preserved)
  - `label` derived from finding prefix pattern (e.g., "Stale entry" → label `stale-entry`)

### 2.3 Unified Renderer (cli-entry.ts)

Replace lines 1052–1086 with:
1. Import unified runner (see below)
2. Single `const findings = await runUnifiedDoctor(...)` call
3. Group findings by source for display
4. Derive exit code from max severity: `info` → 0, `warn` → 0 (warnings to stderr), `error` → 2

**Exit code policy:** Match existing registry doctor convention (currently exits 1 on error at `cli-entry.ts:1083–1085`). Change to exit 2 for consistency with `assign` error exit codes already established in piece 14. Verify: the current `process.exit(1)` at line 1084 is the only doctor-triggered exit; no CI scripts parse this specific code. Safe to change to 2.

### 2.4 Unified Runner

```typescript
// packages/squad-cli/src/cli/commands/doctor.ts (modified)
export async function runUnifiedDoctor(opts: UnifiedDoctorOpts): Promise<{
  findings: DoctorFinding[];
  passCount: number;
}> { ... }
```

The existing `runDoctor()` and the registry `runDoctor()` become internal helpers called by the unified runner.

---

## 3. Migration Plan — Per-Check Mapping

### Legacy System Doctor (cli/commands/doctor.ts)

| Check Function | Current Return Type | New DoctorFinding Shape | Source Tag | TODO Marker? |
|---|---|---|---|---|
| `checkSquadDir` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: '.squad/ directory exists', source: 'system'}` | system | No |
| `checkConfigJson` | `DoctorCheck \| undefined` (pass/fail) | `{severity: 'error', label: 'config.json valid', source: 'system'}` | system | No |
| `checkAbsoluteTeamRoot` | `DoctorCheck \| undefined` (warn) | `{severity: 'warn', label: 'absolute path warning', source: 'system'}` | system | No |
| `checkTeamRootResolves` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: 'team root resolves', source: 'system'}` | system | No |
| `checkTeamMd` | `DoctorCheck` (pass/fail/warn) | `{severity: varies, label: 'team.md...', source: 'system'}` | system | No |
| `checkRoutingMd` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: 'routing.md found', source: 'system'}` | system | No |
| `checkAgentsDir` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: 'agents/ directory exists', source: 'system'}` | system | No |
| `checkCastingRegistry` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: 'casting/registry.json exists', source: 'system'}` | system | No |
| `checkDecisionsMd` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: 'decisions.md exists', source: 'system'}` | system | No |
| `checkRateLimitStatus` | `DoctorCheck \| undefined` (pass/warn) | `{severity: 'warn', label: 'rate limit status', source: 'system'}` | system | No |
| `checkGitattributes` | `DoctorCheck` (pass/fail/warn) | `{severity: varies, label: '.gitattributes upgrade rules', source: 'system'}` | system | **Yes** (line 291) |
| `checkGitignore` | `DoctorCheck` (pass/fail/warn) | `{severity: varies, label: '.gitignore upgrade entries', source: 'system'}` | system | **Yes** (line 319) |
| `checkCopilotSkillsSync` | `DoctorCheck \| undefined` (pass/warn) | `{severity: 'warn', label: '.copilot/skills sync', source: 'system'}` | system | **Yes** (line 347) |
| `checkCopilotInstructions` | `DoctorCheck \| undefined` (pass/fail) | `{severity: 'error', label: '.github/copilot-instructions.md', source: 'system'}` | system | **Yes** (line 384) |
| `checkGlobalAgent` | `DoctorCheck` (pass/warn) | `{severity: 'warn', label: '~/.copilot/agents/squad.agent.md', source: 'system'}` | system | **Yes** (line 401) |
| `checkNodeVersion` | `DoctorCheck` (pass/fail) | `{severity: 'error', label: 'Node.js ≥22.5.0', source: 'system'}` | system | No |
| `checkVscodeJsonrpcExports` | `DoctorCheck` (pass/fail/warn) | `{severity: varies, label: 'vscode-jsonrpc exports field', source: 'system'}` | system | No |
| `checkCopilotSdkSessionPatch` | `DoctorCheck` (pass/fail/warn) | `{severity: varies, label: 'copilot-sdk session.js ESM patch', source: 'system'}` | system | No |
| `checkSquadAgentMd` | `DoctorCheck` (pass/fail/warn) | `{severity: varies, label: '.github/agents/squad.agent.md', source: 'system'}` | system | No |

### Registry-Aware Doctor (commands/doctor.ts)

| Check Area | Current Return | New DoctorFinding Shape | Source Tag | TODO Marker? |
|---|---|---|---|---|
| Local .squad/ presence | string finding | `{severity: 'info', label: 'local-squad-dir', source: 'registry'}` | registry | No |
| Callsign resolution | string finding, escalate('error') | `{severity: 'error', label: 'callsign-resolution', source: 'registry'}` | registry | No |
| Origin resolution | string finding, escalate('warn') on ambiguous | `{severity: 'warn', label: 'origin-resolution', source: 'registry'}` | registry | No |
| Clone resolution | string finding, escalate('warn') on ambiguous | `{severity: 'warn', label: 'clone-resolution', source: 'registry'}` | registry | No |
| CWD write leak detection | string finding, escalate('warn') | `{severity: 'warn', label: 'cwd-write-leak', source: 'registry'}` | registry | No |
| Stale path check | string finding per entry, escalate('warn') | `{severity: 'warn', label: 'stale-entry', source: 'registry'}` | registry | No |
| Inactive empty clones | string finding | `{severity: 'info', label: 'inactive-empty-clones', source: 'registry'}` | registry | No |
| Active empty clones | string finding, escalate('warn') | `{severity: 'warn', label: 'active-empty-clones', source: 'registry'}` | registry | No |
| Clone path ambiguity | string finding, escalate('warn') | `{severity: 'warn', label: 'clone-path-ambiguity', source: 'registry'}` | registry | No |
| Origin overlap | string finding, escalate('warn') | `{severity: 'warn', label: 'origin-overlap', source: 'registry'}` | registry | No |
| Orphaned payload entries | string finding, escalate('warn') | `{severity: 'warn', label: 'orphan-payload', source: 'registry'}` | registry | No |
| Registry corruption | string finding, escalate('warn') | `{severity: 'warn', label: 'registry-corruption', source: 'registry'}` | registry | No |

---

## 4. Renderer Changes

**Current state** (`cli-entry.ts:1052–1086`):
```typescript
// Two separate imports, two console banners, two independent render loops
const { doctorCommand } = await import('./cli/commands/doctor.js');
console.log('=== System doctor ===');
await doctorCommand();

const { runDoctor: runRegistryDoctor } = await import('./commands/doctor.js');
console.log('\n=== Registry doctor ===');
const result = await runRegistryDoctor({ cwd, registryPath });
// per-finding severity switch with exhaustiveness guard
if (result.severity === 'error') process.exit(1);
```

**Target state:**
```typescript
const { runUnifiedDoctor } = await import('./cli/commands/doctor.js');
const { findings, passCount } = await runUnifiedDoctor({
  cwd: getSquadStartDir(),
  registryPath,
});

// Group by source for display
const systemFindings = findings.filter(f => f.source === 'system');
const registryFindings = findings.filter(f => f.source === 'registry');

if (systemFindings.length > 0) {
  console.log(noColor ? '=== System ===' : `${BOLD}=== System ===${RESET}`);
  for (const f of systemFindings) renderFinding(f, noColor);
}
if (registryFindings.length > 0) {
  console.log(noColor ? '\n=== Registry ===' : `\n${BOLD}=== Registry ===${RESET}`);
  for (const f of registryFindings) renderFinding(f, noColor);
}

// Summary
const warnCount = findings.filter(f => f.severity === 'warn').length;
const errorCount = findings.filter(f => f.severity === 'error').length;
console.log(`\n${passCount} passed, ${errorCount} errors, ${warnCount} warnings`);

// Exit code: error → 2, else 0
if (errorCount > 0) process.exit(2);
```

The `renderFinding` helper applies the same color-coded prefix logic currently at lines 1063–1078, but keyed off each individual finding's severity (not the batch severity).

---

## 5. Test Strategy

### Existing Test Files

| File | Covers | Import Source |
|---|---|---|
| `test/cli/doctor.test.ts` | Legacy system doctor checks (lines 1–40: imports `runDoctor`, `checkNodeVersion`, `checkGitattributes`, etc.) | `@bradygaster/squad-cli/cli/commands/doctor` |
| `test/cli/list-doctor.test.ts` | Registry `runDoctor` resolution findings | `@bradygaster/squad-cli/commands/doctor` |
| `test/cli/doctor-registry-cli.test.ts` | CLI-layer spawn tests for `--normalize-callsigns`, `--purge` | CLI binary spawn |
| `packages/squad-cli/src/commands/__tests__/doctor.test.ts` | Unit tests for registry doctor, normalize, purge | `../doctor.js` (relative) |

### Required Changes

1. **`test/cli/doctor.test.ts`** — Update imports: `runDoctor` → `runUnifiedDoctor`. Assertions change from `DoctorCheck[]` to `DoctorFinding[]`. Every existing assertion on `.status === 'pass'` becomes an assertion that the finding is absent from the returned array (passes are counted but not returned as findings).

2. **`test/cli/list-doctor.test.ts`** — `RunDoctorResult` type import changes. The registry `runDoctor` helper remains as an internal function; tests that call it directly still work, but add parallel assertions via the unified runner.

3. **`packages/squad-cli/src/commands/__tests__/doctor.test.ts`** — No changes needed; these test the registry module's internal API which remains intact.

4. **`test/cli/doctor-registry-cli.test.ts`** — Exit code assertions change from `1` to `2` for error cases. Verify: lines with `expect(result.exitCode).toBe(1)` → `toBe(2)`.

### New Tests Needed

- **Unified severity derivation:** A test where system doctor produces a `warn` and registry doctor produces an `error` → overall exit code is 2.
- **Source grouping:** Assert findings from both sources appear under correct display headers.
- **Pass-count accuracy:** Verify `passCount` reflects system checks that returned `status: 'pass'`.
- **Empty-findings path:** When both doctors report all-clear, exit code is 0 and output is clean summary only.

---

## 6. Risk + Rollback

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| CI scripts parsing exit code 1 from doctor | Low (doctor is diagnostic, not a gate) | Grep CI configs for `squad doctor` usage; verify no `|| exit 1` patterns |
| Missed `console.log` in legacy doctor (`printDoctorReport`) still printing directly | Medium | The unified runner replaces `doctorCommand()` call; `printDoctorReport` becomes dead code. Search for other callers. |
| Snapshot test drift in CLI tests | Medium | Update snapshots in same PR commit |
| `DoctorCheck` type still exported/used externally | Low | `DoctorCheck` is exported but only consumed by internal tests. Add `@deprecated` JSDoc; remove in piece 23. |

### Rollback Plan

Single PR revert. The `DoctorFinding` type file can remain (dead code is harmless). Reverting the cli-entry.ts and doctor.ts changes restores the two-banner sequential behavior. No data migration involved; no persistence layer touched.

---

## 7. Out of Scope for Piece 22

- ❌ Do NOT add new checks (no new `checkXxx` functions)
- ❌ Do NOT change severity for existing checks (preserve current pass/fail/warn semantics)
- ❌ Do NOT implement the `repair` field with actual commands (type is present; population is future work)
- ❌ Do NOT refactor `runDoctor` orchestration in `commands/doctor.ts` beyond converting its output to `DoctorFinding[]`
- ❌ Do NOT add correlation logic (matching system + registry findings for the same issue)
- ❌ Do NOT touch `--normalize-callsigns` or `--purge` subcommands
- ❌ Do NOT modify the shell/agent doctor checks (watch mode has its own health checks)

---

## 8. Owner + Sequencing

- **Owner:** Flight (Lead) — as planned in piece-21 fix plan (FIX-8 deferral)
- **Single PR:** One atomic PR to avoid merge conflict risk
- **No parallel agents:** Both doctor files are hot paths; concurrent edits would conflict
- **Depends on:** Piece 21 shipped (confirmed: 5 commits on `akubly/upstream-21-post-stack-review`)
- **Sequencing:** After piece 21 merge to dev. Before any piece that adds new doctor checks.

---

## 9. Acceptance Criteria

- [ ] `DoctorFinding` type exists in `packages/squad-cli/src/cli/commands/doctor-types.ts`
- [ ] All 5 `// TODO(piece-22): merge into unified doctor` markers are removed
- [ ] `cli-entry.ts` lines 1052–1086 replaced with single unified render pass
- [ ] Exit code is 0 for info/warn, 2 for error (not 1)
- [ ] `squad doctor` output shows both system and registry findings under source headers
- [ ] `passCount` shown in summary line
- [ ] All existing tests pass (updated for new types)
- [ ] New tests cover: unified severity derivation, source grouping, empty-findings path
- [ ] `DoctorCheck` type marked `@deprecated` with pointer to `DoctorFinding`
- [ ] `npm run build` passes clean
- [ ] No new `eslint-disable` or `@ts-expect-error` added
- [ ] `.changeset/piece-22-unify-doctors.md` present with `patch` bump
- [ ] PR references piece 22 and links this proposal

---

## References

- Legacy doctor: `packages/squad-cli/src/cli/commands/doctor.ts` (700 lines)
- Registry doctor: `packages/squad-cli/src/commands/doctor.ts` (500+ lines)
- CLI entry dual-call: `packages/squad-cli/src/cli-entry.ts:1052–1086`
- TODO markers: lines 291, 319, 347, 384, 401 of legacy doctor
- Piece 21 fix plan: `.squad/orchestration-log/20260522T210632Z-flight.md`
- FIX-8 deferral decision: `.squad/agents/flight/history.md` (line 43)
