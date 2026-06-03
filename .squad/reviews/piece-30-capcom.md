# Piece 30 Adversarial Review — CAPCOM (Architecture/Contract)

**Date:** 2026-06-02
**Reviewer:** CAPCOM (SDK Expert) — substituting as architecture reviewer (Flight excluded)
**Branch:** `squad/piece-30-ado-cross-repo-templates`
**Commit:** 10168051

**Verdict:** REJECT
**Mandatory findings:** 2
**Non-blocking findings:** 3

---

## Summary

The three template files are structurally well-formed, and `sync-templates.mjs` correctly recurses into `ado/` without any script changes. The bootstrap script honors the piece 29 TEAM_ROOT/WORK_ROOT protocol and calls `squad bind` / `squad sync --pull` via supported CLI surfaces. However, two architectural contracts are broken at the integration boundary: the fold pipeline calls a CLI command (`squad fold`) that does not exist, and the publish pipeline's CI trigger cannot fire in the repo where the pipeline lives. Both issues render the primary automation deliverables non-functional as shipped.

---

## Mandatory (M1, M2)

### M1 — `squad fold` does not exist as a CLI command

**Where:** `fold-squad-state.yml` lines 60–63
```yaml
squad fold \
  --state-branch squad-state \
  --history-file .squad/publish-history.json \
  --order published-at,developer-alias
```

**Why it blocks:** The fold pipeline's core step — the one that enumerates inbox refs and folds them into squad-state — calls `squad fold`. Verified against `packages/squad-cli/src/cli-entry.ts`: the registered command set includes `sync`, `bind`, `status`, `cast`, `upstream`, and many others, but has no `fold` entry. The SDK's `resolution.ts` and `sync.ts` contain comments that reference "the Piece 30 fold pipeline" as a future consumer of exported functions, but no fold command was wired up. The pipeline will fail at pipeline step 4 with "Unknown command: fold" on every execution. `squad sync --push` exists and works; `squad fold` does not.

**Note on test coverage:** `test/cli/ado-templates.test.ts` validates YAML parse and structural assertions but does not verify that CLI commands referenced in the templates actually exist. That gap allowed this defect to pass CI.

**Suggested fix:** Either (a) ship a `squad fold` command (new piece or amendment to piece 28) that wraps the already-exported `publishTeamRootToInbox`/`hydrateTeamRootFromStateRef` internals and register it in `cli-entry.ts`; or (b) replace the `squad fold` call in the pipeline with a `squad sync --pull` + inline git operations that achieve the same fold behavior without a new command. Option (a) is architecturally cleaner and matches the spec contract.

---

### M2 — `publish-inbox.yml` CI trigger is unreachable in the product repo

**Where:** `publish-inbox.yml` lines 12–19
```yaml
trigger:
  branches:
    include:
      - squad/inbox/**
    exclude:
      - squad-state
      - main
      - dev
```

**Why it blocks:** The spec defines `publish-inbox.yml` as "ADO pipeline for the product repo (WORK_ROOT)." In the cross-repo architecture established by pieces 26–29, inbox branches (`squad/inbox/<alias>/<session>`) are created in TEAM_ROOT (the docs/specs repo) by `squad sync --push`. The product repo (WORK_ROOT) never receives pushes to `squad/inbox/**` branches — those refs go to the state remote. ADO evaluates CI triggers against pushes to the repo where the pipeline YAML lives. Because WORK_ROOT never has `squad/inbox/**` branches, the trigger condition is permanently unsatisfiable. The publish pipeline cannot auto-trigger.

**Secondary breach:** The spec's constraint is "Triggered by branch pushes only. No trigger on squad-state, main, or dev branches." The spec intent is: trigger on any feature-branch push to the product repo (all branches except those three). The implementation's `include: squad/inbox/**` contradicts that intent even if the branches existed.

**Collateral issue:** `test/cli/ado-templates.test.ts` line 51–57 asserts that the publish-inbox.yml trigger includes `squad/inbox` — which enforces the wrong behavior and would cause the corrected version to fail the test. The test must be updated alongside the fix.

**Suggested fix:** Remove the `include:` clause entirely; keep only the `exclude:` list. This matches the spec's "all branch pushes except squad-state/main/dev" intent and makes the trigger fire on legitimate product-repo feature-branch pushes. Update the test assertion to check that the trigger does NOT include a narrow include pattern, and that excluded branches are present.

---

## Non-blocking (N1, N2, N3)

### N1 — Undeclared required pipeline variables in publish-inbox.yml

**Where:** `publish-inbox.yml` lines 47–49
**What:** Three pipeline variables — `$(bootstrapScriptPath)`, `$(docsRepoUrl)`, `$(developerAlias)` — are referenced in the bootstrap conditional but are not declared in the `variables:` block (only `nodeVersion` is declared). No comment explains that teams must configure these in an ADO variable group or at pipeline queue time. In ADO, undefined variables are substituted with an empty string at runtime; the bootstrap step would invoke `pwsh -File "" -DocsRepoUrl "" -DeveloperAlias ""`. The PS1 guard catches empty-alias and empty-URL, so this fails explicitly rather than silently — but the failure mode is confusing without documentation.
**Why non-blocking:** Functional failure is loud (PS1 exits 1), not silent. Teams can discover the missing variables quickly.
**Suggested fix:** Add a commented-out variable block listing the required variables with placeholder values, or add a comment block above the `Bootstrap if needed` step enumerating them.

---

### N2 — Fold pipeline hardcodes state branch name with no override variable

**Where:** `fold-squad-state.yml` lines 60–63 and 69
**What:** `--state-branch squad-state` and `git push origin HEAD:squad-state` hardcode the branch name. The bootstrap script correctly parameterizes this via `$StateBranch` (defaulting to `squad-state`). A team using a custom state branch name can pass it to the bootstrap script but cannot configure the fold pipeline equivalently. The two entry points are inconsistently parameterized.
**Why non-blocking:** Piece 30's docs and state-backends.md explicitly target ADO-hosted `squad-state` as the backend; `squad-state` is the canonical branch name for that backend. The inconsistency is annoying, not breaking, for the documented use case.
**Suggested fix:** Add a pipeline variable `stateBranch: squad-state` and reference `$(stateBranch)` in both the `squad fold` call and the `git push` step.

---

### N3 — TEAM_ROOT sidecar path is hardcoded in bootstrap; SQUAD_TEAM_ROOT env var not consulted

**Where:** `bootstrap-cross-repo.ps1` line 75
```powershell
$TeamRoot = Join-Path (Split-Path $WorkRoot -Parent) 'squad-docs-team'
```
**What:** The sidecar clone is always created at `<parent-of-WORK_ROOT>/squad-docs-team`. The CLI honors `SQUAD_TEAM_ROOT` env var (verified in `cli-entry.ts`). The bootstrap script does not check `$env:SQUAD_TEAM_ROOT` before computing the path, so a developer who already has SQUAD_TEAM_ROOT set to a different location will create a second sidecar at the hardcoded path and have two competing TEAM_ROOT directories. After `squad bind`, the CLI's SQUAD_TEAM_ROOT is authoritative — but the bootstrap's choice of location is invisible to operators running non-default setups.
**Why non-blocking:** The default location is sensible; most new setups won't have SQUAD_TEAM_ROOT pre-set. `squad bind` writes the resolved path to config, so subsequent CLI invocations are consistent.
**Suggested fix:** At line 75, check `$env:SQUAD_TEAM_ROOT` first; fall through to the sibling-directory default only if unset.

---

## Cross-piece integration notes

**Pieces 26–27 (config model, sync command):** Bootstrap correctly calls `squad bind` and `squad sync --pull` through the CLI surface. No internal imports, no `packages/*/src/` references. Clean SDK boundary.

**Piece 28 (publish/fold contract):** The publish pipeline honors the contract by using `squad sync --push` (the existing CLI surface) and never writing to squad-state directly. However, piece 28 did not ship `squad fold` as a CLI command, and piece 30 assumes it exists. The gap lands as a blocking defect in piece 30 because piece 30 is the first piece to depend on it in executable form.

**Piece 29 (TEAM_ROOT/WORK_ROOT protocol):** `squad bind --team-root / --work-root / --developer-alias` call is correctly shaped. The bootstrap produces a `.squad/config.json` that downstream `squad sync` operations can use. The protocol is respected end-to-end for the consumer path; the SQUAD_TEAM_ROOT env var oversight (N3) is a minor wrinkle, not a protocol violation.

**Mirror story:** `sync-templates.mjs` already recurses via `collectFiles()` (lines 59–71). No script changes were needed, and none were made. The three mirror targets (`templates/ado/`, `packages/squad-cli/templates/ado/`, `packages/squad-sdk/templates/ado/`) are correctly populated and byte-for-byte identical to the canonicals. The commit message's "all 3 mirror targets" is accurate — the canonical location is the source, not a mirror. The test suite's dynamic enumeration in `template-sync.test.ts` (section 8) catches mirror drift automatically.

**No `packages/*/src/` changes:** Confirmed. No changeset required. SDK boundaries fully respected.
