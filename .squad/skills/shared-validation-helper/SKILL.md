# Shared Validation Helper

## Purpose

Use this pattern when the same input rule is enforced in more than one package, command, or SDK surface.

## Rule

Create one canonical helper in the owning package and route every caller through it. Export the shared constants, predicate, and assertion/message helpers from the owning barrel when downstream packages need them.

## Why

Duplicated validation drifts fast: one site gets stricter, another keeps legacy behavior, and tests stop protecting the real contract. Centralization makes cross-package behavior auditable, easier to grep, and easier to update without missing a call path.

## Checklist

1. Put the regex/limits/message in one helper file.
2. Keep one predicate for boolean checks and one assertion for throwing paths.
3. Update every caller to import the helper instead of copying the rule.
4. Add at least one parity test covering all call sites.
5. Grep for stragglers after the refactor.

## Smell

If writer, reader, and maintenance/doctor commands all validate the same field differently, that is a design smell. Extract the helper before adding another call site.
