---
name: piece-revision-lockout
description: Preserve single-piece commit history when independently revising a rejected piece under reviewer lockout.
domain: git-workflow
confidence: high
source: earned — Piece 08a revision required independent amendment plus state-log preservation
---

## Context

Use this when a rejected piece must be revised by a different owner and the branch already has a piece commit followed by a state or Scribe log commit.

## Pattern

1. Keep the original author locked out of the revision.
2. Make code and test changes independently in the working tree.
3. Reset back before the piece commit, then create one amended piece commit containing only product, test, and changeset files for the piece.
4. Reapply the state/log commit as a separate commit and add any new revision records there.
5. Verify the branch ends with exactly one piece commit plus one state/log commit.
6. Use `git push --force-with-lease` for the revised branch.

## Guardrails

- Do not stage unrelated worktree changes.
- Do not include state ledger files in the piece commit.
- Preserve required commit trailers.
- Re-run build, targeted tests, full-suite spot-check, and scrub gate before pushing.
