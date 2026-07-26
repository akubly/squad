---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Piece 52 — Infra-only main and the durable config lane (Pole A). `main` becomes a pure-infrastructure anchor: a blanket `<callsign>/.squad/` managed ignore replaces the piece-51 allowlist block (deliberately reversing init Sub-proposal J), and no squad content or state is tracked on `main`. The durable constitution (charters, roster, routing, config.json, templates, process docs) moves to its own reviewed orphan lineage `squad/config/<callsign>` seeded by `seedConfigOrphan` (reusing the state-orphan commit-tree plumbing; no `main` parent), with new registry `configBranch`/`configRemote` fields. `CONFIG_ALLOWLIST` is the deterministic complement of the ephemeral publish allowlist, and a total/disjoint team-root classifier partitions every `.squad/**` path into exactly one of scratch / ephemeral / durable. Establishes topology + durable storage only; the durable publish → auto-PR → hydrate transport is a later piece.
