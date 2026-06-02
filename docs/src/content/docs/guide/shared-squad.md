# Shared squads

> ⚠️ **Experimental** — Squad is alpha software. APIs, commands, and behavior may change between releases.

A shared squad lets multiple product repositories use the same agent team, decisions, and knowledge base. One repository acts as the host — it holds the `.squad/` state. Other repositories bind to it through `squad assign`.

---

## What a shared squad is

A shared squad has two roles:

- **Host repository** — holds `.squad/` state: agent charters, decisions, routing rules, and shared skills. One host can serve many product repos.
- **Consumer repository** — a product repo that binds to the host and works through its agents. Consumers read team context from the host without duplicating it.

When you run `squad assign`, Squad installs the host's `.copilot/` skills, agents, and MCP entries into your user-scoped Copilot home under callsign-prefixed names. Running `squad unassign` removes only that namespaced payload — the host and consumer repositories stay intact.

---

## Set up the host

In the repository that will hold your squad state, run:

```bash
squad init --callsign <name>
```

The `--callsign` flag registers the host in your local Squad registry under a short, memorable name. You use that name when binding consumer repositories.

**Verify the host is registered:**

```bash
squad list
```

Your callsign appears in the list.

---

## Warm setup — assign by callsign

If the host is already registered (visible in `squad list`), bind a product repo to it from inside the product repo:

```bash
squad assign <callsign>
```

Replace `<callsign>` with the name you used during `squad init`. Squad records the binding and installs the Copilot payload.

**Verify the assignment:**

```bash
squad status
```

---

## Cold setup — assign by URL

If the host is not registered locally — for example, when you set up a new machine for the first time — provide the URL and a local path:

```bash
squad assign <url> --clone-to <path>
```

Squad clones the host to `<path>`, registers it, and binds the current product repo to it in one step. The result is identical to a warm assign.

**Optional flags:**

| Flag | Description |
|------|-------------|
| `--callsign <name>` | Override the callsign for the cloned host |
| `--target-dir <path>` | Resolve the product repo from a different path |
| `--registry-path <file>` | Use an alternate registry file |

---

## Check health

After assigning, verify everything is working:

```bash
squad status    # show active squad and callsign
squad doctor    # validate setup and registry entries
```

---

## Unassign

To remove the binding from a product repo without deleting the host or product files:

```bash
squad unassign
```

Squad removes the consumer binding and uninstalls the callsign-namespaced Copilot payload for that callsign. The host repository and its `.squad/` state are not affected.

---

## Clean up registry entries

### Remove an inactive entry

If a host is no longer reachable (for example, a deleted clone), remove it from the registry:

```bash
squad doctor --purge <callsign>
```

Squad refuses to purge an entry that still has active consumers. Run `squad unassign` in each consumer repo first, then retry the purge.

### Fix callsign case collisions

If two registry entries share a callsign that differs only by case, detect and optionally merge them:

```bash
squad doctor --normalize-callsigns           # detect collisions
squad doctor --normalize-callsigns --apply   # merge them (prompts for confirmation)
```

---

## Copilot payload

When you run `squad assign`, Squad installs the host's `.copilot/` directory contents into your user-scoped Copilot home. Each item is prefixed with the callsign so multiple shared squads can coexist:

- **Skills** — host skills appear as `<callsign>-<skill-name>` in your Copilot skills directory.
- **Agents** — host agent definitions appear as `<callsign>-<agent-name>`.
- **MCP entries** — host MCP server entries appear under `<callsign>` in your MCP configuration.

When you run `squad unassign`, Squad removes only those callsign-prefixed items. All other Copilot configuration is left untouched.

---

## Enterprise Setup with Azure DevOps

For teams where product code lives in one repository and the squad docs/state live in a separate repository (a cross-repo setup), the `bootstrap-cross-repo.ps1` template handles first-time configuration on a developer workstation or pipeline agent.

### What `bootstrap-cross-repo.ps1` does

The script accepts two mandatory parameters: the docs-repo URL (`-DocsRepoUrl`) and the developer alias (`-DeveloperAlias`). It performs five idempotent steps:

1. **Sidecar clone** — clones the docs repo to a sibling directory as TEAM_ROOT (skipped if already present).
2. **`squad bind`** — links TEAM_ROOT and WORK_ROOT together (skipped if `.squad/config.json` already exists).
3. **Remote configuration** — adds the docs remote and configures state-branch and inbox-branch refspecs (each guarded against duplication).
4. **`.git/info/exclude`** — appends `.squad/` and `.github/agents/squad.agent.md` to the local exclude file without duplicating entries.
5. **Initial sync** — runs `squad sync --pull` to hydrate the local TEAM_ROOT snapshot.

### Running the bootstrap

```powershell
# From inside your product repo (WORK_ROOT)
.\.squad-templates\ado\bootstrap-cross-repo.ps1 `
  -DocsRepoUrl https://dev.azure.com/my-org/my-project/_git/docs `
  -DeveloperAlias alice
```

Re-running the script on an already-configured machine is safe — every mutation is guarded.

### Verify the setup

After bootstrap, confirm the configuration:

```bash
squad status          # should show TEAM_ROOT and WORK_ROOT
squad doctor          # validates the cross-repo binding
git remote -v         # squad-docs remote should appear
```

### Normal development loop

Once bootstrapped, the daily workflow is:

1. Work in WORK_ROOT as normal — branch, commit, push product code.
2. When ready to publish squad state: `squad sync --push` (the publish pipeline can also run this automatically on branch push).
3. The fold pipeline (`fold-squad-state.yml`) serializes published inbox branches into `squad-state` on a schedule or on push events.

### Pipeline deployment

Copy the three templates from `.squad-templates/ado/` (or their mirrors under `templates/ado/`) to your ADO repository:

| Template | Purpose |
|----------|---------|
| `bootstrap-cross-repo.ps1` | Developer and agent workstation setup |
| `publish-inbox.yml` | Push inbox snapshots to the docs repo |
| `fold-squad-state.yml` | Serialize inbox branches into `squad-state` |

Create pipelines in Azure DevOps pointing at `publish-inbox.yml` (product repo) and `fold-squad-state.yml` (docs repo). See [Team State Storage](../scenarios/team-state-storage.md) for the full enterprise scenario walkthrough.

---

## See also

- [CLI reference](../reference/cli.md) — full flag reference for `init`, `assign`, `unassign`, and `doctor`
- [Personal squad](./personal-squad.md) — use Squad across projects with a global squad directory
- [Team State Storage](../scenarios/team-state-storage.md) — enterprise mono-repo scenario and fold pipeline walkthrough
- [State Backends](../features/state-backends.md) — ADO-hosted `squad-state` backend details
