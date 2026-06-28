# CLI Reference

> ⚠️ **Experimental** — Squad is alpha software. APIs, commands, and behavior may change between releases.


Everything you need to run Squad from the command line — commands, shell interactions, configuration files, and environment variables.

---

## Installation

```bash
# Global install (recommended)
npm install -g @bradygaster/squad-cli

# One-off with npx
npx @bradygaster/squad-cli init

# Latest from GitHub (bleeding edge)
squad init
```

---

## CLI Commands (17 commands)

| Command | Description | Requires `.squad/` |
|---------|-------------|:------------------:|
| `squad` | **Deprecated** — Enter interactive shell (no args). Use `copilot --agent squad` instead. | No |
| `squad init` | Initialize Squad in the current repo (idempotent — safe to run multiple times) | No |
| `squad init --state-backend <type>` | Initialize with a specific state backend (`local`, `orphan`, `two-layer`) | No |
| `squad init --global` | Create a personal squad in your platform-specific directory | No |
| `squad init --mode remote <path>` | Initialize linked to a remote team root (dual-root mode) | No |
| `squad link <team-repo-path>` | Link project to a remote team root | Yes |
| `squad loop` | Run a prompt-driven work loop from `loop.md` | Yes |
| `squad loop --init` | Create a starter `loop.md` file | Yes |
| `squad loop --file <path>` | Run a loop from a custom file path | Yes |
| `squad start [--tunnel] [--port N] [--command cmd]` | Start Copilot with remote phone access via PTY and WebSocket | No |
| `squad status` | Show which squad is active and why | Yes |
| `squad doctor` | Validate squad setup integrity and diagnose issues (alias: `heartbeat`) | Yes |
| `squad install-fold-pipeline <github\|ado> [--callsign <name>] [--force] [--delete-folded-refs] [--fold-service-connection <name>]` | Install the fold pipeline definition at the host repository root | Yes |
| `squad upgrade` | Upgrade Squad-owned files to latest version | Yes |
| `squad upgrade --state-backend <type>` | Migrate state backend (`orphan`, `two-layer`); installs git hooks automatically | Yes |
| `squad upgrade --migrate-directory` | Rename legacy `.ai-team/` directory to `.squad/` | Yes |
| `squad triage` | Auto-triage issues and assign to team (primary name; `watch` is an alias) | Yes |
| `squad triage --interval <min>` | Continuous triage (default: every 10 min) | Yes |
| `squad watch --execute` | Enable work execution (spawn Copilot to work on issues) | Yes |
| `squad watch --monitor-teams` | Scan Teams for actionable messages each round | Yes |
| `squad watch --monitor-email` | Scan email for alerts and action items each round | Yes |
| `squad watch --board` | Enable project board lifecycle management | Yes |
| `squad watch --two-pass` | Use two-pass scanning (lightweight → hydrate) | Yes |
| `squad watch --wave-dispatch` | Parallel sub-task execution within issues | Yes |
| `squad watch --retro` | Enforce retrospective checks | Yes |
| `squad watch --decision-hygiene` | Auto-merge decision inbox | Yes |
| `squad watch --max-concurrent N` | Max parallel issues per round (default: 1) | Yes |
| `squad watch --timeout N` | Per-issue timeout in minutes (default: 30) | Yes |
| `squad watch --copilot-flags "..."` | Extra flags for Copilot CLI | Yes |
| `squad shell` | **Deprecated** — Launch interactive shell explicitly. Use `copilot --agent squad` instead. | No |
| `squad copilot` | Add the @copilot coding agent to the team | Yes |
| `squad copilot --off` | Remove @copilot from the team | Yes |
| `squad copilot --auto-assign` | Enable auto-assignment for @copilot | Yes |
| `squad plugin marketplace add\|remove\|list\|browse` | Manage plugin marketplaces | Yes |
| `squad export` | Export squad to a portable JSON snapshot | Yes |
| `squad export --out <path>` | Export to a custom path | Yes |
| `squad import <file>` | Import a squad from an export file | No |
| `squad import <file> --force` | Replace existing squad (archives the old one) | No |
| `squad aspire` | Launch Aspire dashboard for observability | No |
| `squad aspire --docker` | Force Docker mode for Aspire | No |
| `squad upstream add\|remove\|list\|sync` | Manage upstream Squad sources | Yes |
| `copilot --agent squad` | Launch interactive shell explicitly | No |
| `squad nap` | Context hygiene (compress, prune, archive .squad/ state) | Yes |
| `squad nap --deep` | Thorough cleanup with recursive descent | Yes |
| `squad nap --dry-run` | Preview cleanup actions without changes | Yes |
| `squad scrub-emails [directory]` | Remove email addresses from Squad state files (default: `.squad/`) | No |
| `squad --version` | Print installed version | No |

## Lifecycle command reference

Use these commands to initialize a squad host, bind and unbind product repositories, list registered hosts, and maintain registry health.

---

### squad init

Initialize a squad host in the current directory.

**Synopsis:**

```text
squad init [--callsign <name>] [--target-dir <path>] [--registry-path <file>] [--no-register]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--callsign <name>` | Register the host under this name |
| `--target-dir <path>` | Initialize in a specific directory |
| `--registry-path <file>` | Use an alternate registry file |
| `--no-register` | Scaffold the `.squad/` directory without registering |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Initialized or reactivated |
| Non-zero | Usage error, callsign conflict, or file system error |

**Examples:**

```bash
# Initialize and register under a callsign
squad init --callsign my-team

# Scaffold only — no registry entry
squad init --no-register

# Initialize in a specific directory
squad init --target-dir ../team-repo --callsign shared
```

---

### squad assign

Bind the current product repository to a registered squad host. Also installs the host's `.copilot/` payload into your user-scoped Copilot home under callsign-prefixed names.

**Synopsis:**

```text
squad assign <callsign> [--target-dir <path>] [--registry-path <file>]
squad assign <url> --clone-to <path> [--callsign <name>] [--target-dir <path>] [--registry-path <file>]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--clone-to <path>` | Clone the host from `<url>` to this path before assigning |
| `--callsign <name>` | Override the callsign when assigning by URL |
| `--skills-from <callsign>` | Install skills, agents, and MCP entries from the named host's `.copilot/` directory |
| `--target-dir <path>` | Resolve the product repo from a specific path |
| `--registry-path <file>` | Use an alternate registry file |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Assigned or reactivated |
| Non-zero | Usage error (URL without `--clone-to`), missing entry (unknown callsign), or file system error |

**Examples:**

```bash
# Assign by callsign (warm path — host already registered)
squad assign my-team

# Assign by URL and clone (cold path — first-time setup on a new machine)
squad assign https://github.com/org/team-repo --clone-to ../team-repo

# Assign by URL with a custom callsign
squad assign https://github.com/org/team-repo --clone-to ../team-repo --callsign ops
```

**Recovery paths:**

- **URL without `--clone-to`** — `squad assign` exits with a usage error when you pass a URL without `--clone-to`. Add `--clone-to <local-path>` to specify where to clone the host.
- **Unknown callsign** — run `squad list` to see available entries. Use `squad assign <url> --clone-to <path>` to set up from scratch.

---

### squad unassign

Remove the current product repository's binding from its squad host. Also removes the callsign-namespaced Copilot payload installed by `squad assign`.

**Synopsis:**

```text
squad unassign [--callsign <name>] [--target-dir <path>] [--registry-path <file>]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--callsign <name>` | Remove the binding for a specific registered callsign |
| `--target-dir <path>` | Resolve the product repo from a specific path |
| `--registry-path <file>` | Use an alternate registry file |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Unassigned, or already unassigned (no-op with informational message) |
| Non-zero | File system error |

**Examples:**

```bash
# Unassign the current directory
squad unassign

# Unassign a specific callsign binding
squad unassign --callsign my-team
```

`squad unassign` never deletes the host repository or the product repository.

---

### squad list

List registered squad hosts from the local registry.

**Synopsis:**

```text
squad list [--registry-path <file>]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--registry-path <file>` | Use an alternate registry file |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Listed registered hosts successfully |
| Non-zero | File system error |

**Examples:**

```bash
# List registered squad hosts
squad list

# Read from a custom registry file
squad list --registry-path ./tmp/squad-registry.json
```

---

### squad install-fold-pipeline

Install the CI definition that folds Squad inbox branches into state branches.

**Synopsis:**

```text
squad install-fold-pipeline <github|ado> [--callsign <name>] [--force] [--delete-folded-refs] [--fold-service-connection <name>]
```

**Behavior:**

- Writes the definition at the host repository root: `.github/workflows/fold-squad-state.yml` for GitHub or `.azuredevops/fold-squad-state.yml` for ADO.
- Without `--callsign`, installs one callsign-generic pipeline that discovers inbox callsigns at run time and folds each into `squad/state/<callsign>`.
- With `--callsign <name>`, installs a scoped pipeline for that callsign only.
- `--force` overwrites an existing pipeline file whose contents differ, saving the prior version to a `.bak` sibling first.
- `--delete-folded-refs` renders the pipeline with inbox-branch cleanup enabled, so a successfully-folded `squad/inbox/<callsign>/<handle>` ref is deleted after its commits are folded. The default leaves cleanup **off** (`DELETE_FOLDED_REFS=false`); only refs that actually folded are ever deleted.
- `--fold-service-connection <name>` (ADO only) renders the state-branch write-back to push under the named Azure DevOps service connection instead of the implicit build-service identity (see compliance note below). Omitting the flag renders a pipeline byte-identical to the default.

**Prerequisite (default `System.AccessToken` path):** with no `--fold-service-connection`, the ADO fold job pushes `squad/state/<callsign>` under the project's build-service identity (`System.AccessToken`). The **minimum** permission that path requires on the host repository (for example, `dev.azure.com/contoso/MyProject`) is **Contribute**, **Create branch**, and **Force push** on the `squad/state/*` branches, because the job creates and force-updates those branches. Granting the shared Project Build Service account **Contribute** at the repository level is flagged as over-privileged by the **Securing Azure DevOps Build Service Accounts** control and should be remediated.

**Compliant least-privilege alternative (recommended):** pass `--fold-service-connection <name>` to push under a per-resource Azure DevOps service connection backed by a managed identity or service principal (`aka.ms/azdosc`), scoped to only the state branches. This avoids granting the shared build service account repository-wide Contribute. Create the service connection in your project (for example, `dev.azure.com/contoso/MyProject`), grant it the minimum branch permission above on `squad/state/*`, then run `squad install-fold-pipeline ado --fold-service-connection <name>`. The rendered pipeline authenticates the checkout and push with that identity instead of `System.AccessToken`. The GitHub workflow is unaffected by this mechanism and continues to use its workflow `GITHUB_TOKEN`.

**Azure DevOps run serialization:** the ADO fold pipeline runs as a stage with `lockBehavior: sequential` that references a protected Environment named `squad-fold`, so queued runs serialize through an exclusive lock and the fetch→fold→push critical section for a `squad/state/<callsign>` branch never overlaps across runs (`trigger.batch: true` still coalesces bursts and `--force-with-lease` remains the integrity backstop). As a one-time onboarding step, create the `squad-fold` Environment in your project (for example, under `dev.azure.com/contoso/MyProject`), add an **Exclusive lock** check to it, and grant the pipeline permission to use it. The GitHub workflow serializes runs through its `concurrency` group and needs no additional setup.

---

### squad doctor (lifecycle flags)

In addition to general health checks, `squad doctor` provides cleanup operations for the registry.

**Synopsis:**

```text
squad doctor [--registry-path <file>]
squad doctor --purge <callsign> [--yes] [--registry-path <file>]
squad doctor --normalize-callsigns [--apply] [--yes] [--registry-path <file>]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--purge <callsign>` | Remove a registry entry entirely |
| `--normalize-callsigns` | Detect callsign pairs that differ only by case |
| `--apply` | Merge case collisions (requires `--normalize-callsigns`) |
| `--yes` | Skip confirmation prompts |
| `--registry-path <file>` | Use an alternate registry file |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Check passed or operation succeeded |
| 1 | Diagnostics found error-severity issues |
| Non-zero | Usage error (conflicting flags), refused purge (active consumers), or file system error |

**Examples:**

```bash
# Run health diagnostics
squad doctor

# Remove an inactive registry entry
squad doctor --purge my-old-team

# Remove without confirmation
squad doctor --purge my-old-team --yes

# Detect callsign case collisions
squad doctor --normalize-callsigns

# Detect and merge callsign case collisions
squad doctor --normalize-callsigns --apply
```

**Recovery paths:**

- **Refused purge** — `squad doctor --purge` refuses to remove an entry that still has active consumers. Run `squad unassign` in each consumer repo first, then retry the purge.
- **Conflicting flags** — `--normalize-callsigns` and `--purge` are mutually exclusive. Run them as separate commands.

---

### Remote Init Mode

Use `--mode remote` to link your project to a shared team root:

```bash
squad init --mode remote ../team-repo
```

In dual-root mode, project-specific state lives in your local `.squad/` while team identity (casting, charters, shared decisions) lives in the remote location. This is useful for monorepos or organizations with a shared team definition.

---

### squad start

Start Copilot with optional remote access via phone. Spawns Copilot in a PTY and mirrors to your phone via WebSocket + devtunnel.

**Flags:**

- `--tunnel` — Create a devtunnel for remote access (shows QR code for phone scanning). Requires `devtunnel` CLI installed and authenticated (`devtunnel user login`).
- `--port <N>` — Specific WebSocket port (default: random). Example: `--port 3456`
- `--command <cmd>` — Run a custom command instead of copilot. Example: `--command powershell`
- All copilot flags pass through. Example: `squad start --tunnel --yolo` or `squad start --tunnel --model gpt-4`

**Examples:**

```bash
# Basic local PTY (no phone access)
squad start

# With phone access + devtunnel
squad start --tunnel
# Output: QR Code, URL, Session ID

# Custom port, local only
squad start --port 3456

# Custom command with tunnel
squad start --tunnel --command powershell

# Copilot flags pass through
squad start --tunnel --yolo
squad start --tunnel --model gpt-4 --no-config
```

For details on architecture, security, mobile keyboard, and troubleshooting, see [Remote Control Guide](../features/remote-control.md).

---

### squad loop

Run a prompt-driven work loop from a `loop.md` file. Each cycle, Loop sends your prompt to Copilot and loops again at your chosen interval.

**Basic usage:**

```bash
squad loop                               # Run the loop from loop.md
squad loop --init                        # Create a starter loop.md
squad loop --file scripts/monitor.md     # Run a custom loop file
```

**Flags:**

- `--init` — Create a starter `loop.md` file in your project
- `--file <path>` — Path to loop file (default: `loop.md` in project root)
- `--interval <N>` — Override loop interval in minutes (default: from frontmatter)
- `--timeout <N>` — Override cycle timeout in minutes (default: from frontmatter)
- `--copilot-flags "..."` — Pass extra flags to Copilot CLI
- `--agent-cmd <cmd>` — Custom agent command (advanced)
- `--monitor-email` — Scan email for alerts each cycle (requires WorkIQ MCP)
- `--monitor-teams` — Scan Teams for action items each cycle (requires WorkIQ MCP)
- `--self-pull` — Run `git fetch && git pull` before each cycle

**Frontmatter reference:**

Loop.md requires YAML frontmatter with:

| Field | Type | Description |
|-------|------|-------------|
| `configured` | boolean | Safety check — must be `true` to run (prevents accidental execution) |
| `interval` | number | Minutes between cycles (default: 10) |
| `timeout` | number | Max runtime in minutes per cycle (default: 30) |
| `description` | string | Human-readable description of the loop |

**Examples:**

```bash
# Create a starter loop
squad loop --init

# Edit loop.md, then run it
squad loop

# Run with faster interval (overrides frontmatter)
squad loop --interval 3

# Run with monitoring
squad loop --monitor-email --monitor-teams

# Run a named loop file
squad loop --file scripts/ci-monitor.md

# Run with custom Copilot model
squad loop --copilot-flags "--model gpt-4"
```

**Example loop.md:**

```markdown
---
configured: true
interval: 10
timeout: 20
description: "Monitor failing CI and fix issues"
---

# CI Monitor Loop

Each cycle, you will:

1. Check GitHub Actions for failures in main branch
2. If failures exist, investigate the top 1-2
3. If fixable, create a PR with the fix
4. Report findings (failures found, fixes created)

Keep cycles to 20 minutes max.
```

For complete documentation and examples, see [Loop — Prompt-driven work loop](../features/loop.md).

---

Enter the shell with `squad` (no arguments). You'll see:

```
squad >
```

### Shell Commands

All shell commands start with `/`.

| Command | What it does |
|---------|-------------|
| `/status` | Show active agents, sessions, recent decisions |
| `/history` | View session log — tasks, decisions, agent work |
| `/agents` | List team members with roles and expertise |
| `/sessions` | List saved sessions |
| `/resume <id>` | Restore a past session |
| `/version` | Show version |
| `/clear` | Clear terminal output |
| `/help` | Show all commands |
| `/quit` | Exit the shell (also: `Ctrl+C`) |

### Addressing Agents

```
squad > @Keaton, analyze the architecture
squad > Keaton, set up the database schema
squad > Build a blog post about our casting system
```

Agent name matching is **case-insensitive** — `@keaton`, `@Keaton`, and `@KEATON` all route to the same agent. Name an agent to route directly. Omit the name and the coordinator routes to the best fit.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Scroll command history |
| `Ctrl+A` | Jump to start of line |
| `Ctrl+E` | Jump to end of line |
| `Ctrl+U` | Clear to start of line |
| `Ctrl+K` | Clear to end of line |
| `Ctrl+W` | Delete previous word |
| `Ctrl+C` | Exit shell |

---

## Configuration Files

### `.squad/` Directory Structure

```
.squad/
├── team.md              # Roster — agent names, roles, human members
├── routing.md           # Work routing rules
├── decisions.md         # Architectural decisions log
├── directives.md        # Permanent team rules and conventions
├── casting-state.json   # Agent names, universe theme
├── model-config.json    # Per-agent model overrides
├── ceremonies.md        # Team ceremonies and rituals
├── skills/              # Reusable knowledge (markdown files)
│   ├── auth-rate-limiting.md
│   └── ...
├── agents/
│   ├── neo/
│   │   ├── charter.md   # Role definition, expertise, tools
│   │   └── history.md   # Accumulated knowledge
│   └── ...
└── history-archive/     # Archived old session logs
```

### `team.md`

Defines the roster. Squad generates this during init, but you can edit it:

```markdown
## Team

🏗️  Neo      — Lead          Scope, decisions, code review
⚛️  Trinity  — Frontend Dev  React, TypeScript, UI
🔧  Morpheus — Backend Dev   Node.js, Express, Prisma
🧪  Tank     — Tester        Jest, integration tests
📋  Scribe   — (silent)      Memory, decisions, session logs

## Human Team Members

- **Sarah** — Senior Backend Engineer
- **Jamal** — Frontend Lead
```

### `routing.md`

Controls which agent gets which work:

```markdown
# Routing Rules

**Frontend changes** → Trinity
**Backend API work** → Morpheus
**Database migrations** → Morpheus
**Test writing** → Tank
**Architecture decisions** → Neo
**Backend architecture decisions** → Sarah (human)
```

### `decisions.md`

Append-only log of architectural decisions. Agents read this before every task:

```markdown
### 2025-07-15: Use Zod for API validation
**By:** Morpheus
**What:** All API input validation uses Zod schemas
**Why:** Type-safe, composable, generates TypeScript types
```

### `directives.md`

Permanent rules agents always follow:

```markdown
- Always use TypeScript strict mode
- No any/unknown casts
- All database queries through Prisma, no raw SQL
```

---

## Resolution Order

When Squad starts, it looks for `.squad/` in this order:

1. Current directory (`./.squad/`)
2. Parent directories (walk up to project root)
3. Personal squad directory (platform-specific: `~/.config/squad/` on Linux, `~/Library/Application Support/squad/` on macOS, `%APPDATA%\squad\` on Windows)
4. Global CLI default (fallback only)

First match wins.

---

## Environment Variables

| Variable | Purpose | Values |
|----------|---------|--------|
| `SQUAD_CLIENT` | Detected client platform | `cli`, `vscode` |
| `COPILOT_TOKEN` | Copilot auth token (SDK usage) | Token string |

---

---

## Troubleshooting with `squad doctor`

When something isn't working, run:

```bash
squad doctor
```

This performs a comprehensive diagnostic check of your Squad setup, validating:

- `.squad/` directory structure
- Required configuration files (team.md, routing.md, etc.)
- Agent definitions and capabilities
- File permissions and integrity
- Integration with GitHub and Copilot

### Usage Examples

```bash
# Run diagnostics on the current project
squad doctor

# Quick check after upgrading Squad
squad upgrade && squad doctor

# Verify setup after cloning a repo with a squad
git clone my-project && cd my-project && squad doctor
```

### Example Output

```
✓ .squad/ directory exists
✓ team.md is readable and valid
✓ 4 agents registered
⚠ skills/ directory is empty — consider adding documentation
✓ .gitattributes rules applied
```

The doctor exits with code 1 when it finds error-severity issues; otherwise it exits 0. Use it to troubleshoot setup issues, validate team state, or run before opening an issue on GitHub.

---

## Version Management

```bash
squad --version                              # Check version
npm install -g @bradygaster/squad-cli@latest # Update
npm install -g @bradygaster/squad-cli@1.2.3  # Pin version
npm install -g @bradygaster/squad-cli@insider # Dev-channel prerelease builds
```

---

## See Also

- [SDK Reference](./sdk.md) — Programmatic API
- [Recipes & Advanced Scenarios](../cookbook/recipes.md) — Prompt-driven cookbook
- [Adding Squad to an Existing Repo](../scenarios/existing-repo.md) — Getting started walkthrough
