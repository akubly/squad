@Lead and Team, this is the Phase B replay session for piece 38 of the upstream stack.
Phase A staged the piece 38 spec on the `akubly/upstream-specs` branch.
Phase B implements the ratified sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 38 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay` (clone of akubly/squad).
- Branch to create: `squad/piece-38-multi-clone-publish-model` off `squad/piece-37-dogfood-fixes-and-publish-model`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/38-multi-clone-publish-model.md
```

If `38-multi-clone-publish-model.md` does not exist on `akubly/upstream-specs`, STOP immediately and post a blocking comment asking for the spec to be staged.

**The spec is the authoritative source for every sub-proposal's current-state (file:line), required behavior, hard constraints, and test surface. This kickoff carries the workflow, triage, acceptance, and the hard-won process guardrails — read the spec for the implementation detail of each item.**

Piece 38 completes the cross-repo arc: the previously-deferred piece-37 Tier-2 items plus the reframed (trigger-decoupled-from-source) publish model. **Unlike piece 37, all decisions here are ALREADY RATIFIED** — each sub-proposal is implementation-ready; no design discussion is needed. Sub-proposal **P (host self-publish)** and the **Option-3 host-sync** path are explicitly **deferred / out of scope** — do NOT implement them even if asked mid-session.

---

## Triage

Before any code changes, record `.squad/decisions/inbox/piece-38-triage.md`. All items are ACCEPTED (ratified); P and Option-3 host-sync are DEFERRED.

| Sub-proposal | Group | Decision |
|---|---|---|
| J — rename "developer alias" → canonical `inbox-handle` family | Tier 1 | **ACCEPT** — implement FIRST (blocks K) |
| L — keep inbox prefix hardcoded; document as known limitation | Tier 1 | **ACCEPT** |
| M — actionable sync-from-host guard (Option 2) | Tier 1 | **ACCEPT** |
| K — handle-only update from the host (narrow Guard-3 exception) | Tier 1 | **ACCEPT** — after J |
| O — backend-enum reconciliation + orphan enforcement | Tier 2 | **ACCEPT** — enum reconciliation is a HARD precondition before enforcement code |
| Two-hook decoupled model (host filter-out + product unfiltered + install in both clones) | Tier 2 | **ACCEPT** — supersedes piece-34 host-only constraint (`.squad/decisions.md:998`) |
| Product `.squad/`-forbid pre-commit guard | Tier 2 | **ACCEPT** |
| N — dual-role registration (both-by-default, no schema change) | Tier 2 | **ACCEPT** |
| P — host self-publish opt-in | — | **DEFERRED / OUT OF SCOPE — do not implement** |
| Option-3 host-sync-as-first-class | — | **DEFERRED — folded into P** |

The triage document must exist before the first product file is modified.

---

## Workflow for piece 38

**a.** Create the implementation branch off piece 37:

```
git fetch origin
git checkout squad/piece-37-dogfood-fixes-and-publish-model
git checkout -b squad/piece-38-multi-clone-publish-model
```

**Working-tree hygiene check FIRST (lesson from piece 37):** before branching, run `git status` and `git diff -- package.json packages/*/package.json`. If any `package.json` contains unresolved merge-conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) or `@wifi-aware/*` naming, restore the clean committed `@bradygaster` versions: `git checkout HEAD -- package.json packages/squad-cli/package.json packages/squad-sdk/package.json`. The working tree also carries pre-existing untracked cruft (`*.tgz`, `*.docx`, `*.diff`, `test/.tmp-*/`, `templates/fold/`, `templates/skills/*`) — none of it is yours; never stage it.

**b.** Run triage (above). Record `.squad/decisions/inbox/piece-38-triage.md`. Also record a decision note that installing hooks in BOTH clones SUPERSEDES the piece-34 host-only constraint (`.squad/decisions.md:998`).

**c.** For each accepted sub-proposal, implement TDD (write failing tests first, then implementation, red→green) in this order: **J → L → M → K → O (enum) → two-hook model → product `.squad/`-forbid guard → N.** Rationale: the rename lands before its consumer K; the backend enum is reconciled before any orphan-enforcement code reads it; the dual-clone hooks install before the dual-role registration (N) that depends on both roles being live. Verify each file:line against the actual working tree before editing — the spec's line numbers are from the piece-37 base and drift as items land; treat the symbol/context as authoritative, the line number as a hint.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate.ps1
pwsh scrub-gate.ps1
Remove-Item scrub-gate.ps1
```

All gates must pass. Address any NEW failures your changes introduce. Pre-existing WARN/baseline items (Gate 1 strip-listed paths; Gate 3/4 WARNs) are not blocking. Never let cast names or execution jargon (or `@wifi-aware`) leak into product strings.

**e.** Add a changeset — this piece touches BOTH packages (the rename and the registry enum cross `squad-cli` and `squad-sdk`):

```
npx changeset add
```

Select `patch` for **both** `@bradygaster/squad-cli` AND `@bradygaster/squad-sdk`. Summary: "Multi-clone publish model & Tier-2 completion: decoupled publish trigger/source with hooks in both clones, product .squad/-forbid guard, orphan-backend enum reconciliation, inbox-handle rename, sync-from-host guard, handle-from-host, dual-role registration." (If the interactive prompt can't run non-interactively, write `.changeset/{name}.md` directly with both packages at `patch`.)

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Stage ONLY the specific source/test/changeset/triage files you created or modified — `git add -- <path>` per file. NEVER `git add .`/`-A`/a directory. Before committing: `git diff --cached --stat` (file count matches intent) and `git diff --cached --diff-filter=D --name-only` (no unintended deletions). If >20 files staged or unexpected paths appear, STOP and report. Commit body must list: sub-proposals accepted, the deferred items, the piece-34 supersession, scrub-gate result, and the dual-package changeset.

**g.** Push the branch:

```
git push -u origin squad/piece-38-multi-clone-publish-model
```

**h.** STOP. Do not open a PR. Phase C handles PR opening as a separate, deliberate workflow.

---

## Mandatory review protocol (lessons from pieces 36–37 — NOT optional)

After implementation and before declaring done, the work MUST pass BOTH gates:

1. **Primary acceptance-gate verification** (Quality Owner): build delta, scrub delta vs the piece-37 base, per-item coverage, changeset, no-PR, commit hygiene.
2. **Independent ADVERSARIAL review** (a DIFFERENT agent, ideally a different model): assume every fix is wrong and every test tautological; prove each new test fails against the old behavior; hunt silently-broken pre-existing tests. On pieces 36 and 37 the adversarial pass caught critical defects the primary verification approved.

**Collection-failure assertion audit (critical for the J rename):** several pre-existing suites fail at *collection* locally with `Cannot find package '@bradygaster/squad-sdk[/subpath]'` (pre-existing SDK-subpath env debt). A suite that fails at collection is NOT "safely red" — its assertions can be silently invalidated by your product changes and will fire in CI. For EVERY renamed symbol/string and changed path, audit ALL pre-existing assertions (including in collection-failing suites) for contradictions, and update them as justified behavior-driven changes (documented in the commit). The J rename will require many such justified updates.

**Reviewer-rejection lockout:** if a reviewer rejects (NO-GO), the original author is locked out of the revision — a DIFFERENT agent owns the fix. Re-review after remediation.

---

## Acceptance gate

Piece 38 is complete when all 11 acceptance criteria in the spec (`38-multi-clone-publish-model.md` → `## Acceptance`) hold. In summary:

1. `npm run build` exits 0. (Pre-existing TS errors from the stale nested `node_modules/@bradygaster/squad-sdk` shadow are NOT yours — confirm ZERO new errors in files you touched; vitest runs from source.)
2. Pre-existing tests (pieces 26–37) pass without modification, except justified behavior-driven assertion updates (esp. from the J rename), each documented.
3. Per-item coverage: J, L, M, K, O, two-hook model, product `.squad/`-forbid guard, N each have ≥1 targeted test.
4. Publish-model E2E: a product-clone commit triggers a publish that snapshots the HOST `.squad/` to an inbox branch, no working-tree commit in either clone, `SQUAD_SYNC_ACTIVE` set.
5. Product `.squad/`-forbid guard rejects a staged `.squad/` path (non-zero exit), allows commits with none staged.
6. J rename complete: zero `developerAlias` / `--developer-alias` / `SQUAD_DEVELOPER_ALIAS` / `DEVELOPER_ALIAS_RE` residue in `packages/*/src` or docs (the `ERR_ASSIGN_INVALID_ALIAS` drift folded in).
7. O: the SDK registry validator accepts `stateBackend: 'orphan'` and round-trips it; the canonical backend value set is identical across the registry union, `validBackends`, and runtime handlers; no `flat` reference remains.
8. Hooks installed in BOTH clones (host filter-out via `diff-tree --root`; product unfiltered), each in an independent try/catch.
9. Dual-package `patch` changeset for both `@bradygaster/squad-cli` and `@bradygaster/squad-sdk`.
10. Scrub gate exits 0 (PASS or pre-existing WARN baseline unchanged).
11. The piece-34 host-only supersession is recorded in a decision note.

Test import specifiers: match the import specifier/package scope already used in existing `test/` files; do not introduce a new package scope.
