# Decision: Resolver piece reviews require chain-precedence coverage

**Date:** 2026-05-13  
**Author:** Flight  
**Status:** Accepted  

## Context

Piece 03 introduces five new resolver chain steps (clones, origins, platform, worktree, init-guard). The spec mandates a "full chain precedence test" covering all 8 steps in sequence. The implementation proves precedence through pairwise tests (9.1–9.4 plus existing priority tests) rather than a single end-to-end test.

## Decision

Pairwise precedence tests are acceptable when the resolver is sequential (no branching between steps). A single 8-step test would be ideal documentation but is not a blocking requirement — the transitive property holds given sequential code structure. Future resolver pieces that introduce conditional branching between steps MUST include a single comprehensive chain test.

## Consequences

- Pieces 04+ may add steps without a full-chain rewrite, provided pairwise ordering is proven.
- If the resolver gains conditional logic (e.g., skip origins when clones matched), a full-chain integration test becomes mandatory.
