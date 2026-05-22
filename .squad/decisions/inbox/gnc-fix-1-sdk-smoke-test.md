# GNC FIX-1 SDK Smoke-Test Decision

Date: 2026-05-22

## Decision

`squad upgrade` uses a static import of SDK exports it needs to verify after a template refresh. The post-upgrade smoke-test calls `defaultRegistryFilePath()` after the global coordinator agent refresh and warns instead of throwing if the call path fails.

## Rationale

Static import keeps missing SDK exports visible at module load, matching the failure mode from the post-stack review. The runtime smoke-test gives users a recoverable warning when the symbol exists but cannot be called in the current install.
