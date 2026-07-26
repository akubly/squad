---
name: watch-command-boundary-tests
description: Test long-running watch and triage commands at the command boundary without entering an endless poll loop
domain: cli-testing
confidence: medium
source: piece 09 revision
---

## Context

Watch-style commands have helper seams, but parity coverage must also prove the public command threads startup resolution into the running command. A command-boundary test should reach the first-round boundary, then shut down through the command's own shutdown hook.

## Pattern

1. Build a fixture with a host squad and a consumer checkout registered to that squad.
2. Stub platform I/O, auth checks, monitors, external capability loading, and PID cleanup.
3. Invoke `runWatch()` or `runTriage()` from the consumer checkout.
4. Wait for the first-round boundary, such as the next-poll log or adapter scan call.
5. Trigger the captured shutdown handler and await command completion.
6. Assert that platform startup used the host squad root and did not take the missing-squad fatal path.

## Anti-Patterns

- Do not replace command-boundary coverage with direct helper assertions.
- Do not emit real process signals from unit tests when the shutdown handler can be captured.
- Do not let interval timers or process listeners survive test completion.
