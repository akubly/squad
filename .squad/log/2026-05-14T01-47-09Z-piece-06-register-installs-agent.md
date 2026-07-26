# Piece 06: Register Installs Coordinator Agent

**Date:** 2026-05-14T01:47:09Z

EECOM implemented piece 06, wiring the coordinator template install into the `runRegister` function. The spec names the template `packages/squad-cli/templates/squad.agent.md`; the repo ships it as `squad.agent.md.template`. Rather than duplicating 94 KB, the install helper tries the unsuffixed path first, then falls back. This preserves spec intent and is forward-compatible with piece 11a's expected formalization of the unsuffixed path.

All 7 targeted tests pass. Regression suite green. Branch akubly/upstream-06-register-installs-agent, commit a0843395, pushed to origin. Decision merged to decisions.md.
