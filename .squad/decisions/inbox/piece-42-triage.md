# Piece 42 triage

Sub-proposal A — Deterministic `.squad/` subtree overlay (Tier 1): Accept.
Replace the `git read-tree --prefix=.squad/` bind with an archive overlay
(`git archive refs/fold-tmp/inbox .squad | tar -x --exclude='.squad/publish-history.json'`)
in both fold templates, so a fold succeeds when the state branch already carries `.squad/`,
the inbox copy wins for the files it carries, and the pipeline-owned `publish-history.json`
is preserved as the post-loop rewrite's sole writer.

Sub-proposal B — Run-level serialization of the Azure DevOps fold (Tier 2): Decision **B1**.
Adopt an exclusive lock: the ADO fold runs as a stage with `lockBehavior: sequential`
referencing a protected Environment (`squad-fold`), so queued runs serialize through the
protected resource. `trigger.batch: true` and `--force-with-lease` are retained as the
coalescing and integrity backstops. The GitHub variant is unchanged — its piece-41
`concurrency` group already serializes runs.

Rationale for B1 over B2: B1 gives true run-level mutual exclusion of the fetch→fold→push
critical section, eliminating the spurious red runs and up-to-one-schedule-interval fold
latency that B2 tolerates when a push run and a scheduled run race. The cost is a single
one-time onboarding step (create the named Environment / protected resource and grant the
pipeline access), documented alongside the piece-41 CI service-identity permissions with a
generic platform example. This is consistent with the existing onboarding surface and is
the spec's recommended option.

Triage outcome: implement sub-proposal A and sub-proposal B1 in this replay piece.
