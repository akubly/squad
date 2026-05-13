# Replay Protocol — Upstream Stack Implementation

> Fork-internal coordination document. This file never ships upstream.

## Purpose

This document defines the runbook for implementing each piece in the upstream stack. Each piece is derived from its spec document via a clean-room replay session — the implementing agent reads the spec and builds from it, without access to any prior implementation.

## Pre-Requisites

Before starting any replay session:

1. **Spec approved.** The piece's spec at `docs/proposals/upstream-bradygaster/{NN}-{slug}.md` must be reviewed and approved by Lead.
2. **Predecessor landed.** The previous piece's PR must be merged into `bradygaster/dev` (or its branch must be available for rebasing). Exception: piece 01 has no predecessor.
3. **Scrub gate passing.** Run `_scrub-gate.ps1` on the predecessor branch to confirm baseline is clean.

## Per-Piece Replay Session

### Step 1 — Branch Setup

```bash
git fetch origin
git checkout dev && git pull origin dev
git checkout -b akubly/upstream-{NN}-{slug}

# If rebasing onto a predecessor that hasn't landed yet:
git checkout akubly/upstream-{NN-1}-{predecessor-slug}
git pull
git checkout -b akubly/upstream-{NN}-{slug}
```

### Step 2 — Spawn Shape

Each replay session uses a three-agent spawn:

| Role | Agent | Responsibility |
|------|-------|---------------|
| **Lead** | Flight | Review against spec's parity criteria; enforce scrub gates; approve or reject |
| **Implementer** | General-purpose | Read spec → implement. RED tests first, then GREEN implementation |
| **Tester** | General-purpose | Write additional edge-case tests beyond spec minimums; verify no regressions |

**Critical instruction to implementer:**
> "Design and implement piece {NN} from the spec at `docs/proposals/upstream-bradygaster/{NN}-{slug}.md`. This is new feature work. Implement the mechanism described, write the tests specified, and verify the behavior matches the spec's acceptance criteria."

**Forbidden framing (never use):**
> ~~"Reproduce what was in the v2 fork."~~ / ~~"Match the existing implementation."~~ / ~~"Port the code from branch X."~~

### Step 3 — Implementation Sequence

1. **RED tests first.** Implementer writes the test stubs from the spec's test surface. All tests must fail initially (verifying the test is actually testing something).
2. **GREEN implementation.** Implementer writes the production code to make all tests pass.
3. **Build verification.** `npm run build` must exit 0.
4. **Test verification.** `npm test` must pass all new tests without breaking existing ones.

### Step 4 — Verification Gates

Run all gates before marking the PR ready:

#### Gate 1: Scrub Gate
```powershell
# Run the scrub gate script
.\docs\proposals\upstream-bradygaster\_scrub-gate.ps1
```

Or manually:
```bash
# 1. Strip-listed paths must not exist
git ls-files | rg '(_internal|windows-wireless|@wifi-aware|wifi.aware|-mc\.preview|orchestration-log|/identity/|/casting/|squad/specs/v0\.5\.x)' 
# → must return empty

# 2. Zero wifi-aware mentions
git grep -i 'wifi.aware'
# → must return empty

# 3. Review akubly mentions
git grep -i 'akubly\b'
# → acceptable in branch names/authorship; NOT in code or docs

# 4. Review Microsoft/internal mentions
git grep -i 'microsoft\|windows wireless'
# → ADO/Azure DevOps mentions OK as platform support; "Microsoft" in adapter docstrings OK

# 5. ADO fixture audit (piece 12 only)
git grep -i 'dev\.azure\.com\|visualstudio\.com' -- test/
# → URLs must use generic placeholders, not real tenants
# → specifically: no 'microsoft.visualstudio.com' or 'wfa' abbreviation

# 6. Changed file count
git diff --stat HEAD~1 | tail -1
# → must show ≤30 files changed
```

#### Gate 2: Commit Format
```bash
# Single commit with required trailer
git log --oneline -1
# → one commit

git log -1 --format="%b" | grep "Co-authored-by: Copilot"
# → must match
```

#### Gate 3: Changeset
```bash
# Required when packages/*/src/ is touched
git diff HEAD~1 --name-only | grep 'packages/.*/src/'
# If this returns results, a .changeset/*.md file must exist in the diff
```

#### Gate 4: Test Parity
```bash
npm test
# → all new tests pass
# → no existing tests broken
# → test count >= spec's minimum test count
```

### Step 5 — PR Submission

1. Squash all work into a single commit:
   ```bash
   git reset --soft akubly/upstream-{NN-1}-{predecessor-slug}
   git commit -m "feat(scope): {title}

   {Brief description from spec's problem statement}

   Closes #{issue-number}

   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
   ```

2. Push and open draft PR:
   ```bash
   git push -u origin akubly/upstream-{NN}-{slug}
   gh pr create --base dev --draft --title "{title}" --body "$(cat pr-body.md)"
   ```

3. PR body includes:
   - Problem statement (from spec)
   - What this PR does (mechanism summary)
   - Test coverage (test count and what's verified)
    - Stack position: "Part {NN}/20 of the registry-backed resolution and shared-squad command surface stack. Depends on #{predecessor-PR}."

4. Lead reviews against spec parity criteria. If approved → mark ready for review.

## Divergence Handling

When a replay produces something materially different from the spec's expected behavior:

1. **Do NOT paper over the divergence.** The replay's implementation may be correct and the spec may be wrong.
2. **Document the divergence** in the PR description: what the spec expected, what the replay produced, why.
3. **Lead decides:** re-spec the piece (update the spec doc to match the better design) or revise the implementation.
4. **Never reference prior implementation** in the divergence discussion. Frame it as: "The spec says X, the implementation does Y, here's why Y is better."

## Stack Rebase Protocol

Each piece's branch is based on its predecessor. When a predecessor is updated:

1. Rebase the current piece onto the updated predecessor:
   ```bash
   git fetch origin
   git rebase akubly/upstream-{NN-1}-{predecessor-slug}
   ```

2. Re-run all verification gates after rebase.

3. Force-push (only to your own branch — never to shared branches):
   ```bash
   git push --force-with-lease
   ```

4. If rebase conflicts are non-trivial, Lead reviews the resolution.

## State Location During Phase B

Each Phase B session accumulates `.squad/` state — agent histories, decision merges, session logs, orchestration entries — on the **feature branch for the piece being worked on**, layered as commits on top of the code commit. The specs/state branch (`akubly/upstream-specs`) holds only the spec corpus and this protocol document; it never carries per-piece session state.

### Why

Phase B sessions are clean-room replays. Their state — including learnings, review verdicts, and the routing record — is fork-internal and must never leak upstream. Keeping it on the feature branch makes the state colocated with the code it describes, and gives Phase C a clean separation point: Phase C strips the `.squad/` commits when forming the upstream PR, leaving only the code surface.

### Mechanics

- The implementer's code commit lands first on the feature branch (`akubly/upstream-{NN}-{slug}`), with the diff narrowed to the spec's parity surface.
- After implementation and review, Scribe writes session state directly on that feature branch as a separate commit (`chore(squad): ...`). The state commit modifies only `.squad/` paths and never the code.
- The specs branch is read-only during a Phase B session except when this protocol or a spec doc itself needs amendment.

### Phase B operational rules vs. project decisions

Some rules surface during Phase B that apply only to the replay workflow (such as this state-location rule). These belong in `REPLAY-PROTOCOL.md`, NOT in `.squad/decisions.md`. `.squad/decisions.md` is project memory that can travel with the squad framework; replay-protocol rules are fork-internal and never ship upstream.

### Phase C interaction

Phase C constructs the upstream PR by selecting only the code commit(s) from each feature branch. The `.squad/` state commits remain on the akubly-side branch as historical record but do not appear in the upstream PR diff. The scrub gate verifies the PR-shaped diff, not the full feature branch.

## Tone & Record Enforcement

Replay agents' outputs — code comments, test descriptions, commit messages, PR descriptions, and any decision/history writes — must follow the same forbidden-content rules as specs:

- No references to prior implementation, fork history, or porting language
- No "wifi-aware" in any form
- No internal team names, preview channels, or internal URLs
- No commit-history breadcrumbs (wave prefixes, agent names from this fork)

This ensures that the organic team memory generated during replay is clean and can stand on its own merits.

## Piece-Specific Notes

### Pieces 08a/b/c — Command Migration Sub-Split

These three sub-pieces share the same source files (`cli-entry.ts`, `resolution-v2.ts`, `legacy-resolver-migration.test.ts`). The split is at **code-function level** — each sub-piece modifies only the functions for its command group:
- 08a: `status`, `list-related`, `dev`
- 08b: `assign-to-copilot`, `consult`, `link`
- 08c: `start`, `rc`

**Replay verification:** after each sub-piece, check that the diff contains ≤30 files. If any sub-piece exceeds the limit, recombine into a single piece 08 and use the "justify in PR" escape hatch.

### Piece 12 — Platform Adapter (ADO Scrub)

ADO adapter ships as-is (first-class Azure DevOps support). Additional scrub gate:
- Test fixture URLs must use generic placeholders (`https://dev.azure.com/contoso/MyProject`)
- No `microsoft.visualstudio.com` or `wfa` abbreviation in any test data
- Package feed config for Azure Artifacts must not reference internal feeds

### Pieces 13, 16 — Breaking Changes

These pieces remove/refactor public API. PR description must explicitly call out the breaking change and the migration path (teaching error in piece 13, new flag surface in piece 16).
