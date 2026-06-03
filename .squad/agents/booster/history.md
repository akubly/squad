# BOOSTER

> Booster Systems Engineer

## Team Updates

📌 **Team update (2026-06-03 — Piece 30 Follow-On Revision):** Piece-30 follow-on revision authored by EECOM (Booster remained locked out); commit 3c6c9edf. CAPCOM M_NEW_1 + RETRO M_NEW_1 addressed. Mirrors: byte-identical across 4 locations. Gate 8 net +2 (bash `$()` in YAML). 196→200 tests.

📌 **Team update (2026-06-02 — Piece 30 Revision Follow-On Verdict):** Piece 30 revision follow-on adversarial review complete (3 reviewers: CAPCOM, RETRO, FIDO). Overall verdict: MIXED — CAPCOM REJECT (1 new mandatory: fold timestamp-skip bug), RETRO APPROVE-WITH-NITS (1 new mandatory: clone stderr leak), FIDO APPROVE (0 new mandatory). Booster now locked out alongside Flight per strict reviewer rejection lockout protocol. Next revision author TBD.

📌 **Team update (2026-06-03 — Piece 30 Revision, commit a9da5453):** Booster (as implementer) completed full revision addressing all 9 mandatory findings from 5-reviewer adversarial panel. Key deliverables: (1) fold-squad-state.yml completely rewritten — `squad fold` replaced with 150-line inline bash+jq plumbing (subcommand doesn't exist); (2) publish-inbox.yml trigger fixed — removed erroneous `include: squad/inbox/**` clause; (3) persistCredentials/batch added; (4) bootstrap-cross-repo.ps1 hardened with URL scheme allowlist, `--` clone separator, PAT redaction; (5) new ado-bootstrap-idempotency.test.ts (execution-based, pwsh-guarded); (6) ado-templates.test.ts expanded 9→14 assertions; (7) docs typos and terminology fixed. 196 tests pass; scrub Gate 1 pre-existing baseline (no new violations).

📌 **Team update (2026-06-02T22:35:00Z — Piece 30 Adversarial Review):** Booster conducted CI/CD-focused adversarial review of piece 30 ADO templates (commit 10168051); verdict: REJECT. Identified 2 mandatory findings: (1) no `batch: true` on fold trigger — concurrent inbox pushes cause race condition with non-fast-forward rejection, (2) missing `persistCredentials: true` in publish checkout — OAuth token lost before `squad sync --push`. Additional 5 non-blocking observations on documentation, test isolation, error handling. Consolidated to REJECT verdict by Flight.

## Current Learnings

### ADO Pipeline Patterns (2026-06-02)

1. **ADO `batch: true` is inside `trigger:`** — not a top-level pipeline key. Coalesces concurrent trigger events.
2. **ADO `persistCredentials` defaults false** — must be explicit for push pipelines. Differs from GitHub Actions.
3. **Mirror pattern amplifies file counts 4×** — factor into Gate 6 planning.
4. **Inline fold pattern** — when a CLI subcommand doesn't exist and can't be added, inline the logic in YAML using bash+jq.
5. **Vitest timeout for pwsh tests** — default 5000ms insufficient. Use `120_000` for execution-based tests.
6. **PAT redaction is write-path concern** — check URLs for credentials before Write-Host emission.
7. **URL scheme allowlist is positive-assertion gate** — define accepted schemes, reject all others.

---

## Historical Learnings Archive

**Summary:** Booster oversees CI/CD system health, workflow consolidation, preflight gates, smoke test patterns, lockfile validation, and ESM migration issues. Key projects: v0.9.0 hotfix incident response, workflow audit (15 files: 7 load-bearing, 7 admin, 1 ghost), preflight job implementation, template parity gates, test job consolidation (9→6 jobs, 852→585 lines), and post-audit pipeline hardening (batch serialization, persistCredentials rules, git --separator convention).

**Archived sections:** CI Workflow Audit & Preflight Patterns, CI Pipeline Status, Known CI Patterns, Workflow Inventory, Container Smoke Test Patterns, Smoke Test Gating, CI Pipeline Hardening (March 20), CI Failure Pattern Analysis (March 15), CI Workflow Audit (March 23), CI Cleanup & Hardening (Post-Audit), Release Process Skill Update (v0.9.4), CI Cleanup Issue #1000, Template parity gates, Piece 21 Ship Gate, Piece 30 ADO Pipeline Adversarial Review (detailed analysis).

**Key systems:** squad-ci.yml (6 jobs, 585 lines), squad-npm-publish.yml (preflight job added), smoke-test pattern (npm pack + vitest), lockfile validation (nested dependency detection), template-sync.test.ts (SHA-256 parity gates).

