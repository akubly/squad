# Piece 30 Adversarial Review Session

**Date:** 2026-06-02  
**Session Type:** Adversarial Review (5 parallel reviewers + consolidator)  
**Requested by:** Brady Gaster (akubly)  
**Commit:** 10168051  
**Branch:** `squad/piece-30-ado-cross-repo-templates`  

## Reviewers & Verdicts

1. **CAPCOM (Architecture)** — REJECT (2 mandatory + 3 non-blocking)
   - M1: `squad fold` CLI command does not exist — pipeline non-functional
   - M2: `publish-inbox.yml` trigger unreachable in product repo

2. **Booster (CI/CD)** — REJECT (2 mandatory + 5 non-blocking)
   - M1: No `batch: true` on fold trigger — concurrent race condition
   - M2: Missing `persistCredentials: true` in publish checkout — OAuth loss

3. **FIDO (Quality)** — APPROVE-WITH-NITS (1 mandatory + 4 non-blocking)
   - M1: No execution-based idempotency test for bootstrap script
   - Gap: Regex-only source scans insufficient for PS1 logic

4. **RETRO (Security)** — APPROVE-WITH-NITS (3 mandatory: 1 High + 2 Medium, + 4 Low)
   - M1 (High): `$DocsRepoUrl` echoed verbatim — PAT-embedded URL leak to logs
   - M2 (Medium): Missing `--` separator before git clone — argument injection vector
   - M3 (Medium): No URL scheme allowlist — file:// and blind-clone accepted

5. **PAO (DevRel)** — APPROVE-WITH-NITS (1 mandatory + 8 non-blocking)
   - M1: test/docs-build.test.ts missing `'state-backends'` in EXPECTED_FEATURES
   - Gaps: Terminology drift, typos, clarity on `$DocsRepoUrl` format

## Consolidated Verdict

**REJECT** — 9 convergent mandatory findings block merge:
1. CAPCOM M1: `squad fold` CLI command missing (runtime defect verified)
2. CAPCOM M2: Publish trigger unreachable
3. Booster M1: No concurrency serialization
4. Booster M2: OAuth token persistence missing
5. RETRO M1 (High): PAT leak in URL echo
6. RETRO M2 (Medium): Git-argument injection
7. RETRO M3 (Medium): No URL scheme allowlist
8. FIDO M1: No idempotency test
9. PAO M1: Docs-test sync broken

## Verified Runtime Defect

**`squad fold` command does not exist.** Referenced in `fold-squad-state.yml` but no handler in `packages/squad-cli/src/cli-entry.ts`. The fold pipeline will fail at runtime.

## Scope Question for Brady

Does fixing the missing `squad fold` CLI command belong in piece 30 (expanding scope, requiring CONTROL authorship) or in a separate prerequisite piece with piece 30 revised to use existing CLI surfaces? Answer determines revision author assignment and scheduling.

## Procedures

- Original author (Flight) is locked out per strict reviewer rejection lockout
- Candidate revision authors: CAPCOM findings (command scope), Booster (YAML/concurrency), RETRO (bootstrap hardening), FIDO (idempotency test), PAO (docs-test sync), CONTROL (if `squad fold` in scope), EECOM (PowerShell/mirror)
- No revision dispatched (waiting for Brady scope decision)
- No production code changes this session (review only)

## Archival

- decisions.md: 92393 → [merged] bytes (9 reviewer summaries merged)
- Inbox files processed: 6 (all deleted after merge)
- Pre-existing entries: No archival needed (all entries >= 2026-05-28, Tier 2 cutoff is 7 days earlier)
