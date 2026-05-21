# 2026-05-21 — Canonical callsign validation helper

## Decision

Callsign validation is centralized in `packages/squad-sdk/src/callsign.ts`.

The canonical rule is:
- lowercase alphanumeric plus internal hyphens only
- 1-64 characters
- no leading or trailing hyphen
- no uppercase letters, underscores, or periods

Future code MUST import the shared helper and MUST NEVER duplicate the callsign regex inline.

## Rationale

The SDK reader (`resolution-v2.ts`), Copilot payload namespace code (`copilot-payload.ts`), and CLI doctor purge guard had diverged into incompatible callsign checks. Centralizing the regex, max length, validator, and shared error text keeps writer/reader/CLI behavior aligned and gives one place to tighten or document the rule.

The earlier path-traversal hardening decisions in `.squad/decisions.md` (entries around 2168 and 2423) remain valid. The new callsign rule is strictly stricter than those guards and preserves the same security goal while eliminating uppercase/underscore drift.
