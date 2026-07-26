# Skill: Resolver Guard Threading

**Owner:** Sims (Integration / E2E)  
**Created:** 2026-05-14  
**Applicable pieces:** 08b and any future command-migration pieces

---

## Pattern: Dispatch-Level Guard with Runner Threading

When a CLI command requires resolver precondition checks before performing side effects, use a dispatch-level guard in `cli-entry.ts` that threads the resolved result into the runner. This eliminates dead variables, documents intent, and ensures guard and runner operate on the same resolved context.

### Shape

```typescript
// cli-entry.ts dispatch block
if (cmd === 'some-command') {
  const guardResult = resolveSquadV2({ cwd: getSquadStartDir(), env: process.env });
  if (!guardResult) {
    fatal('No squad found.\n   ...');
    return;
  }
  const { runSomeCommand } = await import('./commands/some-command.js');
  await runSomeCommand({
    cwd: getSquadStartDir(),
    env: process.env,
    resolved: guardResult,   // thread through
    // ...other opts
  });
}
```

```typescript
// commands/some-command.ts
export interface RunSomeCommandOpts {
  cwd: string;
  env?: Record<string, string | undefined>;
  /**
   * Pre-resolved squad from dispatch guard. When provided, internal resolution
   * is skipped. Callers that bypass CLI dispatch (e.g., tests) may omit this
   * and the function will resolve internally.
   */
  resolved?: ResolvedSquad;
}

export async function runSomeCommand(opts: RunSomeCommandOpts): Promise<void> {
  const resolved = opts.resolved ?? resolveSquad({
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  if (!resolved) { fatal('No squad found.'); return; }
  // ... side effects after this point only
}
```

### When Guard Result Is Not Needed by Runner

For commands where the runner handles its own context (e.g., `runConsult`, `runLink`), use an inline boolean guard and avoid storing the resolved value:

```typescript
if (!resolveSquadV2({ cwd: getSquadStartDir(), env: process.env })) {
  fatal('No squad found.\n   ...');
  return;
}
const { runLink } = await import('./cli/commands/link.js');
runLink(getSquadStartDir(), teamPath);
```

This makes gate-only semantics explicit: the dispatch layer checks existence; the runner operates from its own inputs.

### Testing This Pattern

Required tests for any guarded command:

1. **Failure path:** Assert non-zero exit AND that all named side-effect files (`config.json`, `.gitignore`, `.git/info/exclude`) are absent or unmodified.
2. **Success path:** Assert the guarded path goes GREEN — resolver finds a squad, runner reaches its normal behavior.
3. **Threading proof (if runner uses resolved value):** Assert the runner output contains data from the resolved struct (e.g., `resolved.path`), proving the guard result was used rather than re-resolved.

### Path Validation Before File Writes

Add `path.isAbsolute()` and `..`-segment checks before any user-supplied path flows into file-write operations:

```typescript
if (!path.isAbsolute(opts.cwd) || opts.cwd.replace(/\\/g, '/').split('/').includes('..')) {
  fatal(`cwd must be an absolute path without ".." traversal, got: "${opts.cwd}"`);
  return;
}
```

Apply this pattern to any opts that directly influence `mkdirSync`, `writeFileSync`, `copyFileSync`, or equivalent.
