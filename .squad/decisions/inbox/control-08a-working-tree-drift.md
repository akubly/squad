# Piece 08a working-tree drift handling

**Date:** 2026-05-14T13:16:21.972-07:00

## Decision

Pre-existing working-tree changes outside the piece 08a scope were preserved in a local stash before creating the piece branch.

## Rationale

The modified files were version stamps, generated template copies, and generated skill template directories. They were not part of the preceding committed piece state and were unrelated to read-only command resolution. Stashing preserved the data without carrying unrelated changes into the piece branch.

## Consequence

Piece 08a starts from the predecessor branch tip with a clean working tree. The stash remains local and is not part of this branch.
