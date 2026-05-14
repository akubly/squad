# INCO

## Core Context

Terminal flicker fix cherry-picked from main to dev — PR #405 merged (March 2026).
> UX Engineer & Interaction Designer

## Learnings

### Piece 05 — UX patterns and testing (2026-05-13)

Piece 05 UX re-verified APPROVE at 366dd6c8. New patterns: side-effect-free `--help`, severity prefixes `[info]/[warn]/[error]`, NO_COLOR discipline, dual-doctor sections. Shared renderer helpers recommended for pieces 06+.

### Animation Performance Trade-offs (PR #310)
Scroll flicker fix required careful animation frame budget management. Slowdown accepted as trade-off for visual clarity and stable viewport rendering. Version footer suggestion considered for animation frame transparency.

---

📌 **Team update (2026-03-10T14-44-23Z):** PR #310 scroll flicker fix merged. 4 root causes identified by Flight: Ink clearTerminal issue, timer amplification, log-update trailing newline, unstable Static keys. Postinstall patch pattern adopted for Ink internals. Version pin recommended for stability gate.

