# Piece 43 triage — Cross-repo state remote and branch resolution

Spec: `docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md`
Base: `squad/piece-42-fold-subtree-overlay-and-serialization`

| Sub-proposal | Tier | Decision | Notes |
|---|---|---|---|
| A — Resolve the cross-repo `sync --pull` state remote from the registry/team-root host (`entry.stateRemote`, else `resolveRemote(teamRoot)`), never the code clone's origin | Tier 1 | **Accept** | Replace the literal `DEFAULT_STATE_REMOTE = 'origin'` default with the host-resolved remote. An explicit `entry.stateRemote` is used verbatim. |
| B — Derive `squad/state/<callsign>` when `stateBranch` is unset but a valid callsign is present, reusing `CALLSIGN_RE` | Tier 1 | **Accept** | Centralized in a `deriveStateBranch(stateBranch, callsign)` helper in `sync.ts` reusing the SDK `CALLSIGN_RE`. Produces the byte-identical `squad/state/<callsign>` string that `assign.ts` / `init.ts` persist. Explicit `stateBranch` wins. |
| C — Cross-repo `sync --pull` does not run the in-clone fetch (`syncPull`) against the code clone; hydration from the state ref is the sole source | Tier 1 | **Accept** | Guard the `syncPull` call on `!crossRepo`. Single-repo pull keeps `syncPull` unchanged. Removes the misleading "No remote squad-state refs found" notice on cross-repo pulls. |
| D — Fallback when an entry has neither `stateBranch` nor a callsign | Tier 2 | **D1 (retain flat `squad-state` legacy default)** | Rationale: preserves today's behavior for pre-callsign / legacy entries; derivation (B) only fires when a valid callsign is present, so no existing setup breaks. Least-invasive choice; a louder fail-fast (D2) risks breaking legacy cross-repo entries that still rely on the flat `squad-state` branch. |

## Implementation surface
- `packages/squad-cli/src/cli/commands/sync.ts` — `runSync` pull/dry-run/display paths;
  new `deriveStateBranch` helper; `effectiveStateRemote` resolution; `syncPull` guarded on
  `!crossRepo`.
- Tests: `test/cli/cross-repo-pull-resolution.test.ts` (A/B/C/D).

## Changeset
`patch` for `@bradygaster/squad-cli` (only `packages/squad-cli/src` is touched; the SDK
`CALLSIGN_RE` is reused via import, not modified).
