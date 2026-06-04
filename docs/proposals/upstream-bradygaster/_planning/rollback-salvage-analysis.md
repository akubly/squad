# Rollback Salvage Analysis — Pieces 26–29

**Date:** 2026-06-04  
**Author:** Flight (Lead)  
**Context:** Architectural reset declared pieces 26 + 30 dead; this analysis evaluates whether pieces 27, 28, 29 can survive or must be reimplemented.

---

## 1. Per-Piece Code-Survival Walkthrough

### Piece 26 — `feat(sdk,cli): cross-repo bind config`

**Product code added:**

| File | Change |
|------|--------|
| `packages/squad-cli/src/cli/commands/bind.ts` | NEW — 282 lines. Entire `squad bind` command. |
| `packages/squad-sdk/src/resolution.ts` | MODIFIED — expanded `SquadDirConfig` interface (+6 fields), rewrote `ResolvedSquadPaths` interface. |
| `packages/squad-cli/src/cli-entry.ts` | MODIFIED — wired `bind` dispatch at line ~1126. |
| `test/cli/bind.test.ts` | NEW — 283 lines. |
| `test/dual-root-resolver.test.ts` | MODIFIED — +190 lines testing new path shapes. |
| `test/cli/init-remote.test.ts` | MODIFIED — +110 lines. |

**Critical type-shape changes in `resolution.ts`:**

```typescript
// BEFORE (piece 25) — resolution.ts:43-50
export interface SquadDirConfig {
  version: number;
  teamRoot: string;
  projectKey: string | null;
  consult?: boolean;
  extractionDisabled?: boolean;
  stateLocation?: string;
  stateBackend?: string;
}

// AFTER (piece 26) — resolution.ts:43-87 — six new fields:
  stateRemote?: string;       // default 'squad-docs'
  stateBranch?: string;       // default 'squad-state'
  inboxBranchPrefix?: string; // default 'squad/inbox'
  developerAlias?: string;    // developer identity for cross-repo
  teamCachePath?: string;     // sidecar clone path override
  hydrateWorkRoot?: boolean;  // sync projection flag
```

**`ResolvedSquadPaths` rewrite (resolution.ts:~90-110):**

```typescript
// BEFORE: { mode, projectDir, teamDir }
// AFTER:  { mode, workRoot, workSquadDir, teamRoot, ... }
```

**Survives topology reset?** No. The reset kills `runBind` (which writes these fields) and declares the product-repo config.json schema invalid. The entire `bind.ts` module is dead. The `SquadDirConfig` expansion is the dead topology's type-level DNA — every downstream piece imports or augments it.

**Salvage rating:** ☠️ **Dead with the topology.**

---

### Piece 27 — `feat(cli): explicit sync command`

**Product code added/modified:**

| File | Change |
|------|--------|
| `packages/squad-cli/src/cli/commands/sync.ts` | MODIFIED — +120 lines. Added `SyncGitOps` interface, `ensureStateRemote()`, `readSyncConfig()`, expanded `SyncOptions`, `declare module` augmentation. |
| `packages/squad-cli/src/cli-entry.ts` | MODIFIED — wired `sync` dispatch at line ~1127 with `--hydrate-only`, `--publish-only`, `--developer` flags. |
| `packages/squad-cli/src/cli/commands/install-hooks.ts` | MODIFIED — hooks read `stateRemote` from `.squad/config.json` via grep; guard against missing config; added `hooksDir` injection seam. |

**Dead-infrastructure dependencies (with line citations from piece-27 state):**

1. **Type augmentation — sync.ts:20-27:**
   ```typescript
   import type { SquadDirConfig } from '@bradygaster/squad-sdk';
   declare module '@bradygaster/squad-sdk' {
     interface SquadDirConfig {
       stateRemote?: string;
       developerAlias?: string;
     }
   }
   ```
   This augments piece 26's expanded `SquadDirConfig`. Without piece 26's schema, this augmentation targets an interface that doesn't have the shape these callers expect.

2. **`readSyncConfig()` — sync.ts:~285-300:**
   ```typescript
   function readSyncConfig(repoRoot: string): SyncConfig | null {
     const configPath = path.join(repoRoot, '.squad', 'config.json');
     // reads stateRemote and developerAlias from config
   }
   ```
   These fields are ONLY written by piece 26's `runBind`. Without bind, `.squad/config.json` never contains `stateRemote` or `developerAlias`.

3. **`ensureStateRemote()` — sync.ts:~306-325:**
   ```typescript
   export async function ensureStateRemote(repoRoot, remoteName, gitOps): Promise<void> {
     const remotes = gitOps.listRemotes(repoRoot);
     if (!remotes.includes(remoteName)) {
       console.error(`squad sync: remote '${remoteName}' not found.\n` +
         `  Run 'squad bind <team-repo-url>' to configure...`);
       process.exit(1);
     }
   }
   ```
   Error message literally tells the user to run `squad bind` — the dead command.

4. **Default remote fallback — sync.ts:~350:**
   ```typescript
   const remote = options.remote ?? syncConfig?.stateRemote ?? 'squad-docs';
   ```
   `'squad-docs'` is the remote name that `bind.ts` creates. Under the new topology, this remote doesn't exist.

5. **Hook templates — install-hooks.ts:~55-100:**
   ```bash
   STATE_REMOTE=$(grep -o '"stateRemote"[[:space:]]*:[[:space:]]*"[^"]*"' "$REPO_ROOT/.squad/config.json" ...)
   [ -z "$STATE_REMOTE" ] && { unset SQUAD_SYNC_ACTIVE; exit 0; }
   ```
   Hooks become no-ops when `stateRemote` is missing from config — which is always, without bind.

**What survives WITHOUT piece 26?**
The pre-existing `syncPull()`/`syncPush()` functions (lines 1-228 in piece 25's version of sync.ts) are self-contained. Piece 27's incremental value is entirely in the config-reading/remote-validation layer — which is dead.

**Salvage rating:** ⚠️ **Salvageable with major refactor** — but the refactor removes ~60% of piece 27's incremental LOC. Rewriting from a correct spec is faster.

---

### Piece 28 — `feat(sync): inbox branch publish flow`

**Product code added/modified:**

| File | Change |
|------|--------|
| `packages/squad-cli/src/cli/commands/sync.ts` | MODIFIED — +300 lines. Added `InboxGitOps` interface (13 methods), `DEFAULT_INBOX_GIT_OPS`, `publishTeamRootToInbox()`, `hydrateTeamRootFromStateRef()`. |
| (imports) | Added `import crypto from 'node:crypto'` and `import { OrphanBranchBackend } from '@bradygaster/squad-sdk'`. |

**Dead-infrastructure dependencies:**

1. **Config resolution — inherited from piece 27's `readSyncConfig()`:**
   `publishTeamRootToInbox` gets its `developerAlias` from the same config path that piece 26 writes. Without bind, there is no alias.

2. **Remote assumption — sync.ts (piece 28 state):**
   The publish flow pushes to `squad/inbox/{developer}` on the `squad-docs` remote — a remote created by `bind`. The refspec `+refs/heads/squad/inbox/*:refs/remotes/squad-docs/squad/inbox/*` is configured by `bind`.

3. **`OrphanBranchBackend` import:**
   This import from `@bradygaster/squad-sdk` is topology-neutral — it's the SDK's git backend. This survives.

4. **`InboxGitOps` interface and `DEFAULT_INBOX_GIT_OPS`:**
   The 13-method injection seam (fetchRef, revParse, hashObject, updateIndex, writeTree, commitTree, push, etc.) is a clean abstraction layer over git plumbing. **This is topology-neutral** — it's pure git mechanics.

5. **`publishTeamRootToInbox()` algorithm:**
   The core algorithm (enumerate `.squad/` files → hash-object each → update-index → write-tree → commit-tree → push to inbox branch) is valid under ANY topology. The coupling is at the edges: where it gets the remote name, developer alias, and branch prefix.

**What's actually salvageable (algorithm breakdown):**
- `InboxGitOps` interface: ✅ Survives as-is
- `DEFAULT_INBOX_GIT_OPS`: ✅ Survives as-is
- `publishTeamRootToInbox` core logic: ✅ Algorithm survives
- `publishTeamRootToInbox` parameter resolution (remote, alias, branch prefix): ❌ Dead — reads from 26's config schema
- `hydrateTeamRootFromStateRef`: ✅ Algorithm survives, interface assumptions dead

**Salvage rating:** ⚠️ **Algorithm salvageable, interface layer dead.** The publish algorithm (~150 lines of git-plumbing orchestration) is genuinely reusable. The calling convention and config resolution (~100 lines wrapping it) are dead. Recommendation: re-implement from spec with the algorithm logic as a reference — not a copy-paste, since the injection seams need to match the new topology's bootstrap mechanism.

---

### Piece 29 — `feat(coordinator): team-root / work-root protocol`

**Product code added/modified:**

| File | Change |
|------|--------|
| `packages/squad-cli/templates/squad.agent.md.template` | MODIFIED — +85 lines. Added Working Directory Model section, spawn prompt variable threading, write rules, WORK_ROOT resolution procedure. |
| `packages/squad-sdk/templates/squad.agent.md.template` | MODIFIED — mirror of above (templates synced). |

**Dead-infrastructure dependencies:**

1. **WORK_ROOT resolution procedure — template line (within the added block):**
   > "Read `{WORK_ROOT}/.squad/config.json` via `loadDirConfig()`. If... `teamRoot` field (a relative path written by `squad bind`)..."

   The phrase "written by `squad bind`" references the dead command. However, the CONCEPT (config.json contains teamRoot → resolves to TEAM_ROOT) may still be valid under the new topology if bootstrap writes that field differently.

2. **Variable definitions — all five are topology-neutral:**
   - `TEAM_ROOT`: valid concept regardless of how it's bootstrapped
   - `WORK_ROOT`: valid concept
   - `STATE_REMOTE`: valid concept (just the remote name)
   - `STATE_BRANCH`: valid concept
   - `DEVELOPER_ALIAS`: valid concept

3. **Write rules (1-5) — entirely topology-neutral:**
   These describe WHERE agents write (TEAM_SQUAD_DIR vs WORK_SQUAD_DIR). This is a protocol rule, not an infrastructure dependency.

4. **Spawn prompt variable threading — topology-neutral:**
   The template changes from `TEAM ROOT: {team_root}` → five-variable expansion. This is purely coordinaton protocol.

**What needs editing to survive:**
- Remove 1 sentence referencing "written by `squad bind`" in the resolution procedure paragraph.
- Possibly update the resolution procedure to say "written by `squad bootstrap`" or whatever piece 32 calls the new mechanism.
- That's it. ~5 words changed out of ~800 words added.

**Salvage rating:** ✅ **Salvageable as-is with trivial text edit** (1 sentence, <10 words). The template content is protocol documentation, not infrastructure wiring.

---

## 2. Three Options Compared

| Dimension | A: Hard reset to piece 25 | B: Build forward on piece 30 HEAD | C: Branch from 25, port selectively |
|-----------|---------------------------|-------------------------------------|--------------------------------------|
| **Wall-clock cost** | 4 sessions (32-35 from scratch) | 5 sessions (32-35 + deprecation/guard overhead per piece) | 3–4 sessions (32-35 from scratch; piece 34 trivial port of 29's text) |
| **History cleanliness** | Perfect — HEAD carries only live code after piece 25 | Dirty — 282-line bind.ts, 6 dead config fields, pipeline YAMLs, dead hooks all ship permanently | Perfect — same as A |
| **Dead-code risk** | Zero | High — `bind.ts` exports, `fold-squad-state.yml`, `bootstrap-cross-repo.ps1`, expanded `SquadDirConfig` fields all present but non-functional | Zero |
| **Replay-protocol compliance** | ✅ — Feature branches are personal (`akubly/upstream-*`), never merged to `dev`. Protocol allows force-push to own branches and rebasing onto any predecessor. | ✅ — Linear chain preserved, no protocol violation. | ✅ — Same as A. Protocol permits new chain from any landed predecessor with continued numbering. |
| **Spec branch hygiene** | Specs 26-31 stay as archival. New specs 32-35 carry `Supersedes: piece NN` headers. | Same. | Same. |
| **Cognitive load for future contributors** | Low — code matches reality | High — must distinguish live code from dead artifacts, no compiler enforcement | Low — code matches reality |
| **Build/test maintenance** | Clean — dead tests removed | Ongoing — 283 lines of bind.test.ts test code running against dead module | Clean |

**Verdict:** Options A and C are functionally equivalent (C is just A with the additional step of porting piece 29's template text, which takes <5 minutes). Option B is strictly worse on every dimension except "zero branch manipulation required."

---

## 3. If We Roll Back — The New Piece Chain

```
squad/piece-25-resolver-rename-and-cli-hardening  ← FOUNDATION (existing, unchanged)
│
└── squad/piece-32-bootstrap-and-sync-config
│     Scope: New bootstrap mechanism (replaces bind). Minimal config schema
│     (stateRemote + developerAlias + stateBranch only). Sync command reads
│     new config shape. No sidecar clone, no .git/info/exclude writes.
│     Re-implements from scratch: config schema, sync config reader,
│     ensureStateRemote validation, CLI dispatch for sync flags.
│     Lifts forward: nothing (piece 25's syncPull/syncPush baseline is adequate).
│
└── squad/piece-33-inbox-publish-flow
│     Scope: publishTeamRootToInbox + hydrateTeamRootFromStateRef, wired
│     into squad sync --publish-only / --hydrate-only. InboxGitOps injection
│     seam. Developer alias validation on push paths.
│     Re-implements from scratch: full module (interface layer + algorithm).
│     Reference: piece 28's git-plumbing algorithm is a valid design reference
│     but must be reimplemented against piece 32's config shape, not copy-pasted.
│
└── squad/piece-34-coordinator-working-directory-model
│     Scope: Coordinator template — Working Directory Model section, five-variable
│     spawn threading, write rules, resolution procedure.
│     Lifts forward: piece 29's template text nearly verbatim (~800 words).
│     Only change: resolution procedure paragraph updated to reference
│     piece 32's bootstrap mechanism instead of "squad bind".
│
└── squad/piece-35-cli-defect-fixes
      Scope: The 5 shipping defects from piece 31 analysis (S0: publishTeamRootToInbox
      unreachable, S1a-c: CLI wiring incomplete, S2: validation gaps). Now implemented
      against piece 33's publish flow rather than piece 28's dead interface.
      Re-implements from scratch: all fixes target new code from pieces 32-33.
```

**Total new LOC estimate:** ~600-800 lines of product code across pieces 32-35 (vs ~700 lines in pieces 26-29 that would need rewriting anyway).

---

## 4. Spec Branch Hygiene Plan

**Branch:** `akubly/upstream-specs`  
**Current contents:** Specs 26, 27, 28, 29, 30, 30.5, 31 + REPLAY-PROTOCOL.md

**Actions:**

| Spec | Action | Rationale |
|------|--------|-----------|
| Spec 26 (`26-cross-repo-bind-config.md`) | Leave as-is. No modification. | Archival artifact. Documents the design intent that was invalidated. |
| Spec 27 (`27-explicit-sync-command.md`) | Leave as-is. | The sync command concept lives on in piece 32; spec 27 documents the original framing. |
| Spec 28 (`28-inbox-branch-publish-flow.md`) | Leave as-is. | Algorithm design is reused in piece 33; spec is valid reference material. |
| Spec 29 (`29-team-root-work-root-protocol.md`) | Leave as-is. | Content ports nearly 1:1 to piece 34. Spec remains accurate. |
| Spec 30 (`30-ado-cross-repo-templates.md`) | Leave as-is. | Documents the pipeline approach that was invalidated by deployer constraints. |
| Spec 30.5 | Leave as-is. | Addendum to 30; same archival status. |
| Spec 31 (`31-cross-repo-cli-wiring-fixes.md`) | Leave as-is. | Defect catalog remains valid; piece 35 implements the same fixes. |
| **New: Spec 32** | Author fresh. Header: `Supersedes: pieces 26, 27 (config schema and sync dispatch)` | Required before piece 32 implementation per replay protocol Step 1. |
| **New: Spec 33** | Author fresh. Header: `Supersedes: piece 28 (publish flow)` | Required before piece 33 implementation. |
| **New: Spec 34** | Author fresh. Header: `Supersedes: piece 29 (coordinator protocol)` | May be minimal — mostly "port piece 29 template text with resolution-procedure update." |
| **New: Spec 35** | Author fresh. Header: `Supersedes: piece 31 subset (defect D+E)` | Targets new code surface from pieces 32-33. |
| REPLAY-PROTOCOL.md | Add a "Chain Reset" section documenting the 2026-06-04 branch point and rationale. | Future readers need to understand why numbering jumps from 25 → 32. |

**What we do NOT do:**
- ❌ Force-push delete specs 26-31 (violates archival principle)
- ❌ Edit specs 26-31 to add "SUPERSEDED" banners (specs are immutable after approval)
- ❌ Renumber new specs to 26-29 (confuses the historical record)

---

## 5. Pre-Flight Checklist Before Executing Rollback

Before authoring piece 32's spec and starting implementation, Adam verifies:

- [ ] **1. Tag current product HEAD for archival.**
  Run: `git tag archive/pieces-26-30-dead HEAD` on the `squad/piece-30-ado-cross-repo-templates` branch. This preserves the full implementation history even after we stop building on this chain.

- [ ] **2. Confirm piece 25 branch tip is the correct foundation.**
  Run: `git log --oneline -1 squad/piece-25-resolver-rename-and-cli-hardening` — verify this is the commit where all pre-existing tests pass and no cross-repo config fields exist in `SquadDirConfig`.

- [ ] **3. Verify `npm run build && npm test` passes on piece 25.**
  Checkout piece 25 branch, run build + tests. This is the baseline we're building on — must be green.

- [ ] **4. Confirm `akubly/upstream-specs` HEAD SHA matches expectations.**
  Run: `git log --oneline -3 akubly/upstream-specs` — verify specs 26-31 are present and no unexpected commits landed.

- [ ] **5. Draft piece 32 spec on `akubly/upstream-specs`.**
  New spec must exist and be reviewed by Lead before implementation begins (per REPLAY-PROTOCOL.md Step 1: "Spec approved").

- [ ] **6. Decide the new bootstrap mechanism's user-facing command name.**
  Is it `squad init --cross-repo`? `squad bootstrap`? `squad connect`? This decision shapes piece 32's spec and must be resolved before spec authorship.

- [ ] **7. Confirm the 5 deployer constraints from the architectural reset still hold.**
  Re-read the reset decision (`.squad/decisions.md`, entry "2026-06-04 Cross-Repo Topology Reset"). Verify no new information has emerged that would change the constraint set (no sidecar, no pipeline relay, no squad artifacts in product repo, no .git/info/exclude manipulation, no product-repo config.json expansion).

---

*End of analysis. Ready for piece 32 spec authorship on Adam's go.*
