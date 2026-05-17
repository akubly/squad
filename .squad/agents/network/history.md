# Network — History

> Distribution specialist. Installation should be invisible.

## Learnings

### Template Placement Pattern (2026-03-15)

Template placement: canonical skill source is `.squad/skills/`, copies to `packages/*/templates/skills/` for npm distribution. Root `templates/` is NOT used by SDK/CLI init code. The build process now auto-syncs from canonical to packages via `scripts/sync-skill-templates.mjs`, preventing divergence. Old locations (`templates/skills/distributed-mesh/`, `templates/mesh/`) removed — they were never referenced and contributed to maintenance burden.

### Distributed Mesh Template Placement (2026-03-08)

Placed the distributed-mesh skill and scaffolding files in the template structure. Three parallel template locations (root, SDK, CLI) receive the SKILL.md. The mesh/ directory holds the sync scripts and config example. This follows the existing pattern where product-shipped skills go in all three template dirs so both init paths (`squad-sdk` and `squad-cli`) can scaffold them into new projects.

The sync scripts (~40 lines each, bash and PowerShell) materialize remote squad state locally using git/curl. No daemons, no running processes. This is Phase 1 distributed coordination — git pull/push with write partitioning.

### Mesh State Repo Init Mode (2026-03-08)

Added `--init` flag to sync scripts for scaffolding mesh state repositories. When users run `sync-mesh.sh --init` or `sync-mesh.ps1 -Init`, the scripts read mesh.json and generate the directory structure: squad folders with placeholder SUMMARY.md files, plus a root README listing participants. Idempotent — skips existing files. This removes the manual setup step when creating a new mesh state repo. The init path adds ~40 lines but keeps sync logic unchanged.

📌 Team update (2026-03-14T22-01-14Z): Distributed mesh integrated with deterministic skill pattern — decided by Procedures, PAO, Flight, Network

### Rally familiarization (2026-05-15T22:45:19-07:00)

- Rally v0.2.0 ships as a GitHub-ref install, not an npm-registry release: `npx github:jsturtevant/rally#v0.2.0` or `npm install -g github:jsturtevant/rally#v0.2.0`. That means the tag itself must contain runnable JS; there is no build or `prepare` hook in `package.json` to generate install artifacts during GitHub-direct install.
- Package shape is a single bin entry: `rally -> ./bin/rally.js`. The bin is a source ESM entrypoint with a shebang that dynamically imports `lib/**`; unlike Squad CLI's npm package, Rally does not publish built `dist/` output or multiple command aliases.
- Rally uses `.npmignore` as an allowlist instead of `package.json` `files`. Installed footprint is limited to `bin/**`, `lib/**`, `package.json`, `README.md`, `LICENSE`, and `CHANGELOG.md`; repo-only state like `.squad/`, `.squad-templates/`, `.github/agents/`, `docs/`, `test/`, and `scripts/` does not ship, so no Rally templates are bundled in the install.
- Node requirement has a distribution sharp edge: `README.md` says `>=20.0.0`, but `package.json` and `package-lock.json` require `>=22.5.0`. For GitHub-direct installs, the manifest wins, so docs and engines must stay aligned.
- Lockfile strategy: Rally commits a root npm lockfile (`lockfileVersion: 3`). That records the tested dependency graph for the tagged repo, but consumers still install from the manifest's semver ranges. Squad also commits a root workspace lockfile, but Squad's primary distribution path is npm-registry packages with explicit published contents (`files`) and prebuilt `dist/` artifacts.
- If Squad ever wants a Rally-style GitHub-direct install alongside npm releases, the Git tag must include runnable JS, stable bin paths, and a tight packlist so repo state does not leak into installs. We'd also need to decide whether to ship templates in that path, because Rally's current packlist excludes all squad state/templates while Squad's npm packages intentionally publish `templates/`.

📌 **Team update (2026-05-15T22:45:19Z — Rally Familiarization Complete & Decisions Merged):** Four-agent familiarization sprint on Rally completed. Flight analyzed Rally relationship to Squad (committable in-repo vs. non-committable external), EECOM documented technical integration (GitHub CLI host/agent split, `.worktrees/` patterns), Network analyzed distribution implications, PAO developed positioning strategy. Decisions drafted and merged to `.squad/decisions.md`: Rally Relationship, EECOM Technical Notes, Squad/Rally Positioning. Orchestration logs written (flight/eecom/network/pao). Session log created. All Rally learnings captured. Scribe archived inbox files and committed team state. Squadron ready for next cycle.

### Multi-squad distribution proposal breadcrumb (2026-05-15T23:06:53-07:00)

- Proposed a Rally-style central store rooted at `~/.squad/`, with the Squad CLI owning `source add`, `update`, `bind`, and status/doctor flows while the SDK owns transport adapters, immutable cache materialization, lock metadata, and layered binding resolution.
- Recommended org auto-deploy via **MDM-installed Squad CLI + machine bootstrap manifest**, not direct home-directory mutation from pipelines. First run should import org sources automatically and hydrate the local cache.
- Update defaults proposed: **personal = manual**, **team = notify/user-applied by default**, **org = stable-ring auto-update with temporary freeze window**. No new end-user tool for v1; Rally is optional visibility only.


📌 **Team archive (2026-05-17T19:44:23Z):** Multi-squad design phase complete. All Round 1–7 working artifacts archived at .squad/decisions/multisquad-design/ — v1.1 spec is authoritative. See orchestration log for full details.
