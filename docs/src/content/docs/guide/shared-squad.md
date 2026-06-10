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

## Bind multiple product clones to one host

One shared-squad host can serve any number of product repos. Run `squad assign` from each product clone:

```bash
# From product-repo-A
squad assign <callsign>

# From product-repo-B
squad assign <callsign>
```

Each `squad assign` call appends the product clone's git root to the host's `clones[]` list in the registry. When you run `squad sync --push` from any registered product repo, Squad routes the publish to the same host and creates a per-session inbox branch namespaced by your inbox handle.

**Re-assign to grow `clones[]`** — running `squad assign` a second time from a new product directory is safe and idempotent for existing entries. It adds the new clone without removing any previous bindings.

---

## Sync state with your team

Once you have a shared squad, use `squad sync` to push or pull the `.squad/` state snapshot to and from a remote.

**Synopsis:**

```text
squad sync (push | pull | both) [options]
squad sync [--push | --pull | --both] [options]
squad sync status
```

> Positional direction forms (`push`, `pull`, `both`) and flag forms (`--push`, `--pull`, `--both`) are equivalent.

**Flags:**

| Flag | Description |
|------|-------------|
| `--push` | Push squad state to the remote |
| `--pull` | Pull squad state from the remote |
| `--both` | Push then pull (default when no direction flag is given) |
| `--remote <name>` | Remote name to sync with (default: resolved from current branch, then `origin`) |
| `--developer <handle>` | Inbox handle for the cross-repo inbox push; overrides `SQUAD_INBOX_HANDLE` and the registry entry |
| `--quiet` | Suppress output |
| `--dry-run` | Print pending `.squad/` files and target inbox branch without pushing. Works without a resolved inbox handle. |

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `SQUAD_TEAM_ROOT` | Override the resolved team root path |
| `SQUAD_INBOX_HANDLE` | Inbox handle fallback (used when `--developer` is absent and no registry handle is set) |
| `COPILOT_SESSION_ID` | Session ID used in the inbox branch name for cross-repo pushes |

**Examples:**

```bash
# Push state to the default remote
squad sync --push

# Pull state from the default remote
squad sync --pull --remote origin

# Push with an explicit inbox handle
squad sync --push --developer acarter

# Preview what would be published without pushing
squad sync --push --dry-run
```

**How TEAM_ROOT is resolved:** `squad sync` uses a registry-first strategy:

1. `SQUAD_TEAM_ROOT` environment variable (explicit override)
2. Registry entry whose `clones[]` list contains the current git root
3. Fallback to `WORK_ROOT/.squad/config.json` for single-repo or unregistered contexts

If none of these resolve a team root and you're pushing, `squad sync` exits 1 and directs you to run `squad assign`.

**How inbox handle is resolved** (push path only):

1. `--developer <handle>` CLI flag
2. `SQUAD_INBOX_HANDLE` environment variable
3. `inboxHandle` field on the matching registry entry

If none of these resolve and you're doing a cross-repo push, `squad sync` exits 1 and directs you to run `squad assign --inbox-handle <handle>` or set `SQUAD_INBOX_HANDLE`.

> ⚠️ The handle must match `^[a-z][a-z0-9-]{1,38}$` — lowercase, starts with a letter, hyphens allowed, max 39 characters.

> ⚠️ **Known inconsistency (piece-38):** `squad assign` sets the inbox handle with `--inbox-handle`; `squad sync` overrides it per-session with `--developer`. Both refer to the same concept. A future piece will align these flag names.

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
| Inbox handle | The handle used to namespace your inbox branch |
| Host clone path | The resolved shared-squad host clone path |

---

## Enable auto-publish on commit

To publish state automatically every time you commit in the shared-squad host clone, you need an inbox handle persisted in the registry. Run `squad assign` with `--inbox-handle`:

```bash
# Set inbox handle when assigning (installs post-commit hook automatically)
squad assign <callsign> --inbox-handle <handle>
```

When `--inbox-handle` is provided, `squad assign` persists the handle to the registry and installs a `post-commit` git hook in both the shared-squad host clone and each product clone. After each commit, the hook runs `squad sync --push --quiet` automatically.

A `.squad/.last-publish` marker file is written on every successful push (both cross-repo and single-repo paths). `squad sync status` reads this file to display the last-published timestamp and pending-change count.

---

## Product-repo `.squad/` guard

When `squad assign` binds a product clone to a host, it installs a `pre-commit` git hook in the product clone. This hook blocks any attempt to stage `.squad/` paths in a product-repo commit:

```
ERROR: Cannot commit .squad/ paths in the product clone.
  Product clones must not track .squad/.
  Write team state to the host clone's .squad/ via TEAM_ROOT.
```

Team state belongs in the shared-squad host clone. The hook forbids *tracking* `.squad/` in the product repo — untracked `.squad/` files (for example, a local cache) are fine.

---

## Install the fold pipeline

In a shared-squad setup, the shared-squad host clone can run a CI workflow that folds the published inbox state into the canonical state branch. Install the template for your platform:

```bash
# GitHub Actions
squad install-fold-pipeline github

# Azure DevOps Pipelines
squad install-fold-pipeline ado
```

This command:
1. Resolves the shared-squad host clone path from the registry (or `.squad/config.json` fallback)
2. Copies `fold-squad-state.yml` into `.github/workflows/` (GitHub) or `.azuredevops/` (ADO)

**Idempotency behavior:**

| Situation | Result |
|-----------|--------|
| File absent | Template installed |
| File present and matches template | No-op (exits 0, logs "already installed and up to date") |
| File present with different content | Exit 1 with a message naming the conflicting file — review and delete it, then re-run |

> The command fails fast if the target workflow directory doesn't exist. Create the `.github/workflows/` or `.azuredevops/` directory in the shared-squad host clone before running this command.

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
