# EECOM FIX-2 Decision — upgrade payload refresh is warn-only

**Date:** 2026-05-22
**Author:** EECOM

## Decision

`squad upgrade` refreshes the per-repo Copilot payload after each `installCoordinatorAgent` call when the registry contains a matching `.squad` path with a callsign. The test seam is `UpgradeOptions.copilotPayloadInstaller?: typeof installCopilotPayload`, matching the existing direct option-injection pattern used for upgrade-time SDK seams.

Payload refresh failures are non-fatal: upgrade emits `warn(...)` and continues.

## Rationale

Upgrade owns repairing upgrade-managed artifacts, but a payload copy failure should not block template, workflow, migration, or coordinator-agent refresh. Matching registry entries with `normalisedPathKey` keeps the behavior aligned with registry path semantics instead of depending on platform-specific raw strings.
