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

## Sync state with your team

Once you have a shared squad, use `squad sync` to push or pull the `.squad/` state snapshot to and from a remote.

**Synopsis:**

```text
squad sync [--push | --pull | --both] [options]
squad sync status
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--push` | Push squad state to the remote |
| `--pull` | Pull squad state from the remote |
| `--both` | Push then pull (default when no direction flag is given) |
| `--remote <name>` | Remote name to sync with (default: resolved from current branch, then `origin`) |
| `--developer <alias>` | Developer alias for the cross-repo inbox push (overrides env var and registry) |
| `--quiet` | Suppress output |
| `--dry-run` | Print pending `.squad/` files and target inbox branch without pushing. Works without a resolved developer alias. |

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `SQUAD_TEAM_ROOT` | Override the resolved team root path |
| `SQUAD_DEVELOPER_ALIAS` | Developer alias fallback (used when `--developer` is absent and no registry alias is set) |
| `COPILOT_SESSION_ID` | Session ID used in the inbox branch name for cross-repo pushes |

**Examples:**

```bash
# Push state to the default remote
squad sync --push

# Pull state from a specific remote
squad sync --pull --remote squad-docs

# Push with an explicit developer alias
squad sync --push --developer acarter

# Preview what would be published without pushing
squad sync --push --dry-run
```

**How TEAM_ROOT is resolved:** `squad sync` uses a registry-first strategy:

1. `SQUAD_TEAM_ROOT` environment variable (explicit override)
2. Registry entry whose `clones[]` list contains the current git root
3. Fallback to `WORK_ROOT/.squad/config.json` for single-repo or unregistered contexts

If none of these resolve a team root and you're pushing, `squad sync` exits 1 and directs you to run `squad assign`.

**How developer alias is resolved** (push path only):

1. `--developer <alias>` CLI flag
2. `SQUAD_DEVELOPER_ALIAS` environment variable
3. `developerAlias` field on the matching registry entry

If none of these resolve and you're doing a cross-repo push, `squad sync` exits 1 and directs you to run `squad assign --developer-alias` or set `SQUAD_DEVELOPER_ALIAS`.

> ⚠️ The alias must match `^[a-z][a-z0-9-]{1,38}$` — lowercase, starts with a letter, hyphens allowed, max 39 characters.

---

## Check sync status

To inspect the current sync configuration, run:

```bash
squad sync status
```

This prints six fields:

| Field | Description |
|-------|-------------|
| Last published | ISO-8601 timestamp from `.squad/.last-publish`, or `never` |
| Pending changes | Count of `.squad/` files modified since last publish |
| State remote | The configured git remote for state sync |
| State branch | The orphan branch used as the state target |
| Developer alias | The alias used to namespace your inbox branch |
| Docs repo path | The resolved team-root path (docs-repo clone or current repo) |

---

## Enable auto-publish on commit

To publish state automatically every time you commit in the docs-repo clone, you need a developer alias persisted in the registry. Run `squad assign` with `--developer-alias`:

```bash
# Set developer alias when assigning (installs post-commit hook automatically)
squad assign <callsign> --developer-alias <alias>
```

When `--developer-alias` is provided, `squad assign` persists the alias to the registry and installs a `post-commit` git hook in the docs-repo clone. After each commit, the hook runs `squad sync --push --quiet` automatically.

A `.squad/.last-publish` marker file is written on every successful push (both cross-repo and single-repo paths). `squad sync status` reads this file to display the last-published timestamp and pending-change count.

---

## Install the fold pipeline

In a shared-squad setup, the docs-repo clone can run a CI workflow that folds the published inbox state into the canonical state branch. Install the template for your platform:

```bash
# GitHub Actions
squad install-fold-pipeline github

# Azure DevOps Pipelines
squad install-fold-pipeline ado
```

This command:
1. Resolves the docs-repo path from the registry (or `.squad/config.json` fallback)
2. Copies `fold-squad-state.yml` into `.github/workflows/` (GitHub) or `.azure-pipelines/` (ADO)

**Idempotency behavior:**

| Situation | Result |
|-----------|--------|
| File absent | Template installed |
| File present and matches template | No-op (exits 0, logs "already installed and up to date") |
| File present with different content | Exit 1 with a message naming the conflicting file — review and delete it, then re-run |

> The command fails fast if the target workflow directory doesn't exist. Create the `.github/workflows/` or `.azure-pipelines/` directory in the docs repo before running this command.

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

## See also

- [CLI reference](../reference/cli.md) — full flag reference for `init`, `assign`, `unassign`, `sync`, `install-fold-pipeline`, and `doctor`
- [Personal squad](./personal-squad.md) — use Squad across projects with a global squad directory
- [External state storage](../features/external-state.md) — keep `.squad/` outside your working tree
