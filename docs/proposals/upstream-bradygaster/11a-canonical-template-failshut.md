# 11a — Canonical `squad.agent.md` fail-shut resolution chain

## Summary

This piece updates the canonical coordinator governance template at `templates/squad.agent.md.template`. The team-root resolution chain must be fail-shut: each lookup step is a probe, a miss continues to the next probe, and only the final step may conclude that no team exists after it records evidence that every earlier probe was exhausted.

Stack position: Part 11a/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 10 — init fail-fast.

## Problem

The coordinator reads `squad.agent.md` before it decides whether it is in Team Mode or Init Mode. If the prompt text lets the coordinator treat an early miss as terminal, the coordinator can silently fall through to a no-team state even though a later registry, platform, or worktree lookup would have resolved a team.

The governance text must make the resolution chain deterministic. It must distinguish "this probe missed" from "the full chain is exhausted."

## Proposed change

### API surface

This piece changes prompt content rather than TypeScript APIs. The public surface is the resolution-chain text embedded in the installed `squad.agent.md`.

Before text shape:

```md
**Team root resolution (on startup):**

1. **CWD check:** Does `.squad/team.md` exist in CWD? → If yes, team root = CWD. Stop.
2. **Git root check:** `git rev-parse --show-toplevel` → check `.squad/team.md` (or `.ai-team/team.md`) at that root. If found, team root = git root. Stop.
3. **Registry lookup (`~/.squad/registry.json`):**
   - If `SQUAD_CALLSIGN` env var is set → look up by callsign in `squads[]`. If match, team root = `entry.path`. Stop.
   - Run `git remote -v` from CWD. Normalize URLs. Match against `squads[].origins[]`. If single match, team root = `entry.path`. Stop.
   - Match CWD against `squads[].clones[]`. If single match, team root = `entry.path`. Stop.
4. **Platform fallback:** Check the platform registry. Same matching logic as step 3.
5. **Worktree fallback:** `git worktree list --porcelain` → check the main working tree for `.squad/`.
6. **None matched** → no team found. Suggest `squad init` or `squad register --callsign <name>`. Then proceed to Init Mode.
```

After text shape:

```md
**Team root resolution (on startup):**

**⚠️ Each step is a probe, not a gate. A miss on step N means continue to step N+1. Only step 6 may terminate the chain — and only with evidence of exhaustion.**

1. **CWD check:** Does `.squad/team.md` exist in CWD? → If yes, team root = CWD. Stop.
2. **Git root check:** `git rev-parse --show-toplevel` → check `.squad/team.md` (or `.ai-team/team.md`) at that root. If found, team root = git root. Stop.
3. **Registry lookup (`~/.squad/registry.json`):**
   - If `SQUAD_CALLSIGN` env var is set → look up by callsign in `squads[]`. If match, team root = `entry.path`. Stop.
   - Run `git remote -v` from CWD. Normalize URLs. Match against `squads[].origins[]`. If single match, team root = `entry.path`. Stop.
   - Match CWD against `squads[].clones[]`. If single match, team root = `entry.path`. Stop.
4. **Platform fallback:** Check the platform registry. Same matching logic as step 3.
5. **Worktree fallback:** `git worktree list --porcelain` → check the main working tree for `.squad/`.
6. **None matched** — you may ONLY conclude this after explicitly attempting steps 1–5. Before declaring "no team found", cite the negative results from steps 1–5. If you cannot show this, you have not exhausted the chain. Then proceed to Init Mode and suggest `squad init` or `squad register --callsign <name>`.
```

### Mechanism

Update the canonical template in `templates/squad.agent.md.template` so the first instruction under "Team root resolution" states that each step is a probe. Rewrite the final "None matched" step so it requires explicit negative evidence for steps 1 through 5 before Init Mode can begin.

Keep the existing resolution order and existing lookup semantics. This piece does not add a new resolver step, change registry schema, remove `.ai-team/` fallback text, or change command behavior. If the repository contains generated mirrors of `squad.agent.md`, sync them from the canonical template in the same change and keep byte-for-byte parity tests green.

## Files

| Path | Role | Expected change |
|------|------|-----------------|
| `templates/squad.agent.md.template` | Canonical governance template | Add anti-short-circuit warning and strengthen final no-team step. |
| `.github/agents/squad.agent.md` | Installed mirror, if present | Mirror the canonical text. |
| `.squad-templates/squad.agent.md` | Template mirror, if present | Mirror the canonical text when required by the current sync script. |
| `packages/squad-cli/templates/squad.agent.md.template` | Package mirror, if present | Mirror the canonical text. |
| `packages/squad-sdk/templates/squad.agent.md.template` | Package mirror, if present | Mirror the canonical text. |
| `test/template-sync.test.ts` or equivalent template-content test | Behavior assertion | Assert the fail-shut warning and final-step exhaustion requirement. |

Do not add command implementation work to this piece unless the current repository topology requires a template source-path adjustment for the canonical file to be installed correctly.

## Test surface

Required assertions:

| Test | Assertion |
|------|-----------|
| `template-sync.test.ts: squad.agent.md fail-shut resolution chain` or equivalent | The canonical template contains "Each step is a probe, not a gate." |
| `template-sync.test.ts: squad.agent.md fail-shut resolution chain` or equivalent | The final "None matched" step requires evidence from steps 1 through 5 before "no team found" can be declared. |
| Existing template parity test | Mirror templates match the canonical template after sync. |

Suggested targeted validation:

```powershell
npx vitest run test/template-sync.test.ts
npm run build
```

Run the upstream scrub gate before opening the pull request.

## Acceptance criteria

- A coordinator that misses the CWD probe is instructed to continue through git-root, registry, platform, and worktree probes.
- The no-team path can only start from the final step.
- The no-team response must cite negative results for steps 1 through 5.
- Existing registry terms remain current: `registry.json`, `squads[]`, `origins[]`, `clones[]`, and `SQUAD_CALLSIGN`.
- The no-team path still suggests both `squad init` and `squad register --callsign <name>`.
- Template mirrors remain synchronized where mirrors exist.
- User-facing text follows Microsoft Style Guide expectations: direct wording, active voice, sentence-style capitalization, and no unsupported claims.

## Rollback

Rollback is a template-only revert. Restore the prior `templates/squad.agent.md.template` resolution-chain text, re-sync any mirrors that exist in the repository, and remove the fail-shut assertions from the template-content test.

Do not roll back registry, command, or resolver behavior in this piece; they are outside this proposal's scope.
