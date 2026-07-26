# Piece 44 triage — pipeline-file injection hygiene on shared hosts

Spec: `docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md`
Branch: `squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts` (off piece 43).

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Scoped `--callsign` install writes a distinct callsign-named `fold-squad-state.<callsign>.yml`; default install unchanged; reuse `CALLSIGN_RE`; per-file conflict gate | Tier 1 | **Accept** |
| B — `sync`-time injection resolves a single canonical pipeline path (callsign-named preferred, ADO-before-GitHub tiebreak) and embeds only that one; no stale alternate-directory copy in the snapshot | Tier 1 | **Accept** |
| C — Stale alternate-directory cleanup on scoped install | Tier 2 | **C1 — leave the stale copy in place (recommended)** |

## C decision rationale (C1 chosen)

The scoped install writes only its own callsign-named file and does not delete any file in a
directory it was not asked to target. Sub-proposal B's canonical single-embed already
prevents a stale alternate-directory copy from being carried into the published snapshot, so
a stray file on the host is inert with respect to the fold loop. An install command that
deletes a file in another directory (the other platform's directory, or a generic
`fold-squad-state.yml` an operator may have placed deliberately during a platform-migration
window) is surprising and harder to make safe than the single-embed. A stale on-disk file is
left as an operational follow-up for the operator to remove; the CLI does not self-heal it.

## Implementation notes

- A: derive the destination filename — `fold-squad-state.<callsign>.yml` when
  `options.callsign` is set, else `fold-squad-state.yml`. `CALLSIGN_RE` is already validated
  at the top of `installFoldPipeline`, so the derived name is git/FS-safe. Thread the
  resolved filename through the conflict gate and every user-facing message.
- B: replace the two independent `existsSync` probes in `publishTeamRootToInbox` with an
  ordered candidate list (callsign-named ADO, callsign-named GitHub, generic ADO, generic
  GitHub); embed the first existing file at its real host-relative path and stop.
- Source template path unchanged (`templates/fold/<platform>/fold-squad-state.yml`); template
  content is unchanged, so no `.squad-templates/fold/` mirror change is required.
- Changeset: `patch` for `@bradygaster/squad-cli`.

## Known limitation (ADO-before-GitHub precedence is deterministic, not freshness-aware)

The canonical precedence is a fixed order, not a freshness/mtime detection. In an ADO→GitHub
migration where a stale generic `.azuredevops/fold-squad-state.yml` was left behind, the
single-embed will select that stale ADO file over a live `.github/workflows/` generic copy.
This is acceptable and matches the spec's defined tiebreak, but operators should either remove
the stale generic file or install a callsign-scoped file (which outranks both generics) to
deterministically override the selection.
