#!/usr/bin/env node

/**
 * Squad CLI — entry point for command-line invocation.
 * Separated from src/index.ts so library consumers can import
 * the SDK without triggering CLI argument parsing or process.exit().
 *
 * SDK library exports live in src/index.ts (dist/index.js).
 */

process.env.NODE_NO_WARNINGS = '1';

// Suppress ExperimentalWarning (e.g. node:sqlite) from leaking to terminal.
// process.env.NODE_NO_WARNINGS only works when set BEFORE process starts;
// this runtime hook catches warnings emitted during dynamic imports below.
const _origEmit = process.emit;
process.emit = function (evt: string, ...args: unknown[]) {
  if (evt === 'warning' && (args[0] as { name?: string })?.name === 'ExperimentalWarning') {
    return false;
  }
  return _origEmit.apply(this, [evt, ...args] as Parameters<typeof _origEmit>);
};

// Runtime ESM Import Patcher for @github/copilot-sdk (#265)
// ---------------------------------------------------------
// Patch broken ESM import in @github/copilot-sdk@0.1.32 at runtime before
// Node's module loader attempts resolution.
//
// Root cause: copilot-sdk's session.js imports 'vscode-jsonrpc/node' without
// .js extension, violating Node 24+ strict ESM resolution requirements.
//
// Why runtime patch?: NPX caches packages in ~/.npm/_cacache and skips
// postinstall scripts on cache hits (documented npm behavior). The install-time
// patch in scripts/patch-esm-imports.mjs never runs on npx cache hits, causing
// ERR_MODULE_NOT_FOUND crashes on Node 24+.
//
// This runtime patch intercepts Module._resolveFilename before any imports
// trigger copilot-sdk loading, rewriting the broken import to include .js.
// Works everywhere: npx (cache hit/miss), global install, CI/CD.
//
// Upstream issue: https://github.com/github/copilot-sdk/issues/707
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Module = require('node:module');

const _origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options?: unknown) {
  // Intercept the broken import: 'vscode-jsonrpc/node' → 'vscode-jsonrpc/node.js'
  if (request === 'vscode-jsonrpc/node') {
    request = 'vscode-jsonrpc/node.js';
  }
  return _origResolveFilename.call(this, request, parent, isMain, options);
};

// Pre-flight: require Node.js ≥22.5.0 for node:sqlite (#214, #502).
// node:sqlite is used by the Copilot SDK for session storage.
// Fail fast with a clear message rather than letting users hit a cryptic
// ERR_UNKNOWN_BUILTIN_MODULE crash when the SDK loads.
{
  const parts = process.versions.node.split('.').map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(
      `✗ Squad requires Node.js ≥22.5.0 (you have v${process.versions.node}).\n` +
      `  node:sqlite (required by the Copilot SDK for session storage) was added in Node 22.5.0.\n` +
      `  Upgrade at: https://nodejs.org/en/download\n`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Top-level signal handlers — safety net for clean exit on Ctrl+C / SIGTERM.
// Individual commands (shell, watch, aspire, rc) register their own handlers
// that run first; these ensure the process never hangs if a command doesn't.
// ---------------------------------------------------------------------------
let _exitingOnSignal = false;
function _handleTopLevelSignal(signal: 'SIGINT' | 'SIGTERM'): void {
  const code = signal === 'SIGINT' ? 130 : 143;
  if (_exitingOnSignal) {
    // Second signal — force exit immediately
    process.exit(code);
  }
  _exitingOnSignal = true;
  // Allow in-flight cleanup handlers a brief window, then force exit
  setTimeout(() => process.exit(code), 3_000).unref();
}
process.on('SIGINT', () => _handleTopLevelSignal('SIGINT'));
process.on('SIGTERM', () => _handleTopLevelSignal('SIGTERM'));

import { FSStorageProvider, resolveSquadState, resolveSquadDir as sdkResolveSquadDir } from '@bradygaster/squad-sdk';
import type { ResolvedSquad, SquadStateContext, StateBackendType } from '@bradygaster/squad-sdk';
import { ConfigurationError } from '@bradygaster/squad-sdk/adapter/errors';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fatal, SquadError } from './cli/core/errors.js';
import { BOLD, RESET, DIM, RED, GREEN, YELLOW } from './cli/core/output.js';
import { runCost } from './cli/commands/cost.js';
import { getPackageVersion } from './cli/core/version.js';
import { printCommandHelp, printGenericCommandHelp } from './cli/core/command-help.js';
import { resolveSquadDir } from './cli/core/squad-resolver.js';
import type { DoctorFinding } from './cli/commands/doctor-types.js';

// Lazy-load squad-sdk to avoid triggering @github/copilot-sdk import on Node 24+
// (Issue: copilot-sdk has broken ESM imports - vscode-jsonrpc/node without .js extension)
const lazySquadSdk = () => import('@bradygaster/squad-sdk');
const lazyRunShell = () => import('./cli/shell/index.js');

// Use local version resolver instead of importing VERSION from squad-sdk
const VERSION = getPackageVersion();

/**
 * Return the starting directory for squad resolution.
 * Respects --team-root / SQUAD_TEAM_ROOT env var so that subprocesses
 * (e.g. Copilot CLI bang commands) can locate .squad/ even when their
 * working directory differs from the interactive shell. (#734)
 */
function getSquadStartDir(): string {
  return process.env['SQUAD_TEAM_ROOT'] || process.cwd();
}

const INIT_OPTIONS_WITH_VALUES = new Set([
  '--target-dir',
  '--registry-path',
  '--callsign',
  '--mode',
  '--preset',
  '--state-backend',
]);

function findInitUrlLikeArg(args: string[], isUrlLikeArg: (arg: string) => boolean): string | undefined {
  let skipNext = false;

  for (const token of args.slice(1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      const flag = eqIdx === -1 ? token : token.slice(0, eqIdx);
      if (eqIdx === -1 && INIT_OPTIONS_WITH_VALUES.has(flag)) {
        skipNext = true;
      }
      continue;
    }

    if (isUrlLikeArg(token)) {
      return token;
    }
  }

  return undefined;
}

function formatResolverReason(source: ResolvedSquad['source']): string {
  switch (source) {
    case 'local':
      return 'Found .squad/ in repository tree';
    case 'env':
      return 'Resolved from selected registry callsign';
    case 'clones':
      return 'Resolved from registered clone path';
    case 'origins':
      return 'Resolved from registered Git origin';
    case 'platform':
      return 'Resolved from platform squad path';
    case 'worktree':
      return 'Resolved from linked worktree';
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/** Render a single unified doctor finding with a severity-keyed color prefix. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noColor = !process.stdout.isTTY || !!process.env['NO_COLOR'];

  // --team-root flag: override team root for resolution
  const teamRootIdx = args.indexOf('--team-root');
  if (teamRootIdx !== -1 && args[teamRootIdx + 1]) {
    process.env['SQUAD_TEAM_ROOT'] = args[teamRootIdx + 1]!;
    // Remove --team-root and its value from args
    args.splice(teamRootIdx, 2);
  }

  const hasGlobal = args.includes('--global');
  // --economy activates economy mode for this session (sets env var for spawner)
  const hasEconomy = args.includes('--economy');
  if (hasEconomy) {
    process.env['SQUAD_ECONOMY_MODE'] = '1';
  }
  const rawCmd = args[0];
  const cmd = rawCmd?.trim() || '';

  // --version / -v / version
  // Investigated: routing is correct — cmd matches 'version' directly.
  // "Unknown command: version" reports may be shell-specific (e.g. alias/wrapper
  // prepending flags so args[0] is no longer 'version'). No intercepting router found.
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(VERSION);
    return;
  }

  // --help / -h / help
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    const b = noColor ? '' : BOLD;
    const r = noColor ? '' : RESET;
    // Command name column width: wide enough for 'install-fold-pipeline' (21 chars) + 2-char gap.
    const COMMAND_COL_WIDTH = 24;
    console.log(`\n${b}squad${r} v${VERSION} — Add an AI agent team to any project\n`);
    console.log(`Usage: squad [command] [options]\n`);
    console.log(`Commands:`);
    console.log(`  ${b}${'(default)'.padEnd(COMMAND_COL_WIDTH)}${r}Launch interactive shell`);
    console.log(`  ${b}${'init'.padEnd(COMMAND_COL_WIDTH)}${r}Initialize squad in current directory`);
    console.log(`  ${b}${'assign'.padEnd(COMMAND_COL_WIDTH)}${r}Bind this checkout to a registered squad`);
    console.log(`  ${b}${'unassign'.padEnd(COMMAND_COL_WIDTH)}${r}Remove this checkout's binding from a registered squad`);
    console.log(`  ${b}${'list'.padEnd(COMMAND_COL_WIDTH)}${r}List registered squads`);
    console.log(`  ${b}${'doctor'.padEnd(COMMAND_COL_WIDTH)}${r}Validate setup and registry health`);
    console.log(`  ${b}${'upgrade'.padEnd(COMMAND_COL_WIDTH)}${r}Update Squad-owned files to latest`);
    console.log(`  ${b}${'migrate'.padEnd(COMMAND_COL_WIDTH)}${r}Convert markdown <-> SDK squad formats`);
    console.log(`  ${b}${'status'.padEnd(COMMAND_COL_WIDTH)}${r}Show which squad is active and why`);
    console.log(`  ${b}${'roles'.padEnd(COMMAND_COL_WIDTH)}${r}List built-in Squad roles`);
    console.log(`  ${b}${'cost'.padEnd(COMMAND_COL_WIDTH)}${r}Report token usage`);
    console.log(`  ${b}${'triage'.padEnd(COMMAND_COL_WIDTH)}${r}Scan for work and categorize issues`);
    console.log(`  ${b}${'loop'.padEnd(COMMAND_COL_WIDTH)}${r}Prompt-driven continuous work loop`);
    console.log(`  ${b}${'hire'.padEnd(COMMAND_COL_WIDTH)}${r}Team creation wizard`);
    console.log(`  ${b}${'copilot'.padEnd(COMMAND_COL_WIDTH)}${r}Add/remove the Copilot coding agent`);
    console.log(`  ${b}${'plugin'.padEnd(COMMAND_COL_WIDTH)}${r}Manage plugin marketplaces`);
    console.log(`  ${b}${'export'.padEnd(COMMAND_COL_WIDTH)}${r}Export squad to a portable JSON snapshot`);
    console.log(`  ${b}${'import'.padEnd(COMMAND_COL_WIDTH)}${r}Import squad from an export file`);
    console.log(`  ${b}${'scrub-emails'.padEnd(COMMAND_COL_WIDTH)}${r}Remove emails from state files`);
    console.log(`  ${b}${'start'.padEnd(COMMAND_COL_WIDTH)}${r}Start Copilot with remote access`);
    console.log(`  ${b}${'nap'.padEnd(COMMAND_COL_WIDTH)}${r}Context hygiene for .squad/ state`);
    console.log(`  ${b}${'consult'.padEnd(COMMAND_COL_WIDTH)}${r}Enter consult mode with your personal squad`);
    console.log(`  ${b}${'extract'.padEnd(COMMAND_COL_WIDTH)}${r}Extract learnings from consult mode session`);
    console.log(`  ${b}${'subsquads'.padEnd(COMMAND_COL_WIDTH)}${r}Manage SubSquads`);
    console.log(`  ${b}${'link'.padEnd(COMMAND_COL_WIDTH)}${r}Link to a remote team root`);
    console.log(`  ${b}${'build'.padEnd(COMMAND_COL_WIDTH)}${r}Compile squad.config.ts to markdown`);
    console.log(`  ${b}${'aspire'.padEnd(COMMAND_COL_WIDTH)}${r}Launch .NET Aspire dashboard`);
    console.log(`  ${b}${'schedule'.padEnd(COMMAND_COL_WIDTH)}${r}Manage scheduled tasks`);
    console.log(`  ${b}${'personal'.padEnd(COMMAND_COL_WIDTH)}${r}Manage your personal squad`);
    console.log(`  ${b}${'preset'.padEnd(COMMAND_COL_WIDTH)}${r}Manage squad presets`);
    console.log(`  ${b}${'cast'.padEnd(COMMAND_COL_WIDTH)}${r}Show current session cast`);
    console.log(`  ${b}${'sync'.padEnd(COMMAND_COL_WIDTH)}${r}Synchronize squad state with remote`);
    console.log(`  ${b}${'install-fold-pipeline'.padEnd(COMMAND_COL_WIDTH)}${r}Install the fold pipeline YAML into the shared-squad host repository`);
    console.log(`  ${b}${'upstream'.padEnd(COMMAND_COL_WIDTH)}${r}Manage upstream Squad sources`);
    console.log(`  ${b}${'economy'.padEnd(COMMAND_COL_WIDTH)}${r}Toggle economy mode`);
    console.log(`  ${b}${'version'.padEnd(COMMAND_COL_WIDTH)}${r}Print installed version`);
    console.log(`  ${b}${'help'.padEnd(COMMAND_COL_WIDTH)}${r}Show this help message`);
    console.log(`\nRun ${b}squad <command> --help${r} for command details.\n`);
    console.log(`Flags:`);
    console.log(`  ${b}--version, -v${r}  Print version`);
    console.log(`  ${b}--help, -h${r}     Show help`);
    console.log(`  ${b}--global${r}       Use personal squad path`);
    console.log(`  ${b}--economy${r}      Economy mode (cheaper models)`);
    console.log(`  ${b}--team-root${r}    Override team root path`);
    console.log(`  ${b}--dry-run${r}      Dry-run mode (no writes)`);
    console.log(`\nInstall: npm i -D @bradygaster/squad-cli`);
    console.log(`Insider: npm i -D @bradygaster/squad-cli@insider\n`);
    return;
  }

  // --help / -h on a subcommand → print command-specific help and exit.
  // Without this intercept the flag was silently dropped and the command
  // would execute for real (sometimes with destructive side effects, e.g.
  // `squad init --help` scaffolding files, or `squad triage --help` starting
  // the polling loop). See #1201.
  if (
    cmd &&
    cmd !== 'help' &&
    cmd !== '--help' &&
    cmd !== '-h' &&
    cmd !== 'version' &&
    cmd !== '--version' &&
    cmd !== '-v' &&
    (args.includes('--help') || args.includes('-h'))
  ) {
    if (!printCommandHelp(cmd, VERSION)) {
      printGenericCommandHelp(cmd);
    }
    return;
  }

  // No args → launch interactive shell; whitespace-only arg → show help
  if (rawCmd === undefined) {
    // Fire-and-forget update check — non-blocking, never delays shell startup
    import('./cli/self-update.js').then(m => m.notifyIfUpdateAvailable(VERSION)).catch(() => {});
    const { runShell } = await lazyRunShell();
    await runShell();
    return;
  }
  if (!cmd) {
    // Whitespace-only arg — show help and exit cleanly
    console.log(`\n${BOLD}squad${RESET} v${VERSION} — Add an AI agent team to any project\n`);
    console.log(`Usage: squad [command] [options]`);
    console.log(`Run 'squad help' for the full command list.\n`);
    return;
  }

  // Route subcommands

  // Per-command --help: side-effect-free, exits 0
  if (args.includes('--help') || args.includes('-h')) {
    const b = noColor ? '' : BOLD;
    const r = noColor ? '' : RESET;
    if (cmd === 'init') {
      console.log(`\n${b}squad init${r} — Initialize a squad\n`);
      console.log(`Usage: squad init [options]\n`);
      console.log(`Options:`);
      console.log(`  --sdk             SDK builder syntax`);
      console.log(`  --roles           Use base roles`);
      console.log(`  --global          Personal squad dir`);
      console.log(`  --no-workflows    Skip CI setup`);
      console.log(`  --preset <name>   Apply a preset`);
      console.log(`  --state-backend   local|orphan|two-layer`);
      console.log(`  --target-dir <p>  Init in a specific dir`);
      console.log(`  --callsign <name> Register under this name`);
      console.log(`  --no-register     Scaffold only`);
      console.log(`  --registry-path   Alternate registry file`);
      console.log(`  --yes             Auto-apply git-rm-cached + .gitignore for orphan backend`);
      console.log(`  --mode remote <p> Link to remote team root\n`);
      return;
    }
    if (cmd === 'list') {
      console.log(`\n${b}squad list${r} — List registered squads\n`);
      console.log(`Usage: squad list [--registry-path <path>]\n`);
      console.log(`Prints a tab-separated table of registered squads.`);
      console.log(`Columns: CALLSIGN, PATH, ORIGINS, CLONES, STATUS\n`);
      return;
    }
    if (cmd === 'doctor') {
      console.log(`\n${b}squad doctor${r} — Validate setup and health\n`);
      console.log(`Usage: squad doctor [options]\n`);
      console.log(`  squad doctor [--registry-path <path>]`);
      console.log(`  squad doctor --normalize-callsigns [--apply] [--yes] [--registry-path <path>]`);
      console.log(`  squad doctor --purge <callsign> [--yes] [--registry-path <path>]\n`);
      console.log(`Runs system checks (Node, git, config) and`);
      console.log(`registry health (entries, paths, resolution).`);
      console.log(`Exit 0 unless registry has error-severity issues.\n`);
      console.log(`Flags:`);
      console.log(`  ${b}--normalize-callsigns${r}  Detect case-colliding callsign pairs`);
      console.log(`  ${b}--apply${r}               Merge collisions (requires --normalize-callsigns)`);
      console.log(`  ${b}--purge <callsign>${r}    Remove a registry entry entirely`);
      console.log(`  ${b}--yes${r}                 Skip confirmation prompts`);
      console.log(`  ${b}--registry-path${r}       Alternate registry file\n`);
      return;
    }
    if (cmd === 'sync') {
      console.log(`\n${b}squad sync${r} — Synchronize squad state with remote\n`);
      console.log(`Usage: squad sync [--push | --pull | --both | --push-config] [options]\n`);
      console.log(`Options:`);
      console.log(`  --push              Push ephemeral squad state to remote`);
      console.log(`  --pull              Pull squad state (and durable config) from remote`);
      console.log(`  --both              Push and pull (default)`);
      console.log(`  --push-config       Publish durable config changes to the config-inbox (opens a review PR)`);
      console.log(`  --remote <name>     Remote name (default: origin)`);
      console.log(`  --inbox-handle <handle>  Inbox handle for cross-repo inbox publish`);
      console.log(`  --registry-path <path>   Alternate registry file (matches init); default registry when absent`);
      console.log(`  --dry-run           Print pending files and target inbox branch without publishing`);
      console.log(`  --quiet             Suppress output\n`);
      console.log(`Environment:`);
      console.log(`  SQUAD_TEAM_ROOT          Override team root path`);
      console.log(`  SQUAD_INBOX_HANDLE       Inbox handle fallback`);
      console.log(`  COPILOT_SESSION_ID       Session ID for inbox branch naming\n`);
      return;
    }
    if (cmd === 'install-fold-pipeline') {
      console.log(`\n${b}squad install-fold-pipeline${r} — Install a fold pipeline into the host repository\n`);
      console.log(`Usage: squad install-fold-pipeline <github|ado> [--callsign <name>] [--force]`);
      console.log(`                                   [--delete-folded-refs] [--fold-service-connection <name>] [--runner "<labels>"]`);
      console.log(`                                   [--state-only | --config-only]\n`);
      console.log(`Installs repository-root pipeline definitions for the shared-squad host: the state`);
      console.log(`fold pipeline (folds Squad inbox refs into squad/state/<callsign>) AND the durable`);
      console.log(`config pipeline (opens a review PR from squad/config-inbox/** into squad/config/<callsign>).`);
      console.log(`Both are installed by default. Without --callsign, each pipeline discovers callsigns`);
      console.log(`at run time and handles each independently.\n`);
      console.log(`Options:`);
      console.log(`  --callsign <name>                 Generate pipelines scoped to one callsign`);
      console.log(`  --force                           Overwrite an existing, differing pipeline file`);
      console.log(`                                    (the prior content is saved to <file>.bak)`);
      console.log(`  --state-only                      Install only the state fold pipeline`);
      console.log(`  --config-only                     Install only the durable config pipeline`);
      console.log(`  --delete-folded-refs              Render the state pipeline with inbox-branch cleanup`);
      console.log(`                                    enabled (deletes only successfully-folded refs)`);
      console.log(`  --fold-service-connection <name>  (ado) Push the folded state branch under the`);
      console.log(`                                    named Azure DevOps service connection identity`);
      console.log(`                                    instead of the build-service account\n`);
      console.log(`  --runner "<labels>"               (github) Render runs-on: [<labels>] for a`);
      console.log(`                                    self-hosted runner (e.g. "self-hosted,Windows,X64")`);
      console.log(`                                    on BOTH the state and config pipelines; a non-Linux`);
      console.log(`                                    label set also sets defaults.run.shell: bash.`);
      console.log(`                                    ADO is agent-pool-driven — select the pool in the portal\n`);
      console.log(`Prerequisite: the CI service identity must have Contribute, Create branch,`);
      console.log(`and Force push permission on the host repository (for example,`);
      console.log(`dev.azure.com/contoso/MyProject) because the job creates and force-updates`);
      console.log(`squad/state/<callsign> branches. See the fold-pipeline setup docs for the`);
      console.log(`least-privilege --fold-service-connection alternative (aka.ms/azdosc).\n`);
      return;
    }
    if (cmd === 'assign') {
      console.log(`\n${b}squad assign${r} — Bind this checkout to a registered squad\n`);
      console.log(`Usage: squad assign [<callsign>] [options]\n`);
      console.log(`Positional:`);
      console.log(`  <callsign>                   Target squad callsign (warm path)`);
      console.log(`Options:`);
      console.log(`  --inbox-handle <handle>     Per-developer namespace for inbox branches`);
      console.log(`  --state-remote <name>        Git remote name for state operations`);
      console.log(`  --state-branch <name>        Orphan branch holding folded canonical state`);
      console.log(`  --skills-from <sel>          Skill source: host, none, or local path`);
      console.log(`  --callsign <name>            Cold-start: callsign to register the cloned squad under`);
      console.log(`  --allow-origin-collision     Record the assignment despite remotes matching other squads' origins`);
      console.log(`  --no-bind                    Managed cold-start: stand up the host only; do not bind the current clone`);
      console.log(`  --yes                        Auto-apply git-rm-cached + .gitignore entries\n`);
      return;
    }
    // For other commands, fall through to the main help
  }

  if (cmd === 'init') {
    // Reject URL-like positional arguments early with a clear usage message.
    const { isUrlLikeArg } = await import('./commands/init.js');
    const urlLikeArg = findInitUrlLikeArg(args, isUrlLikeArg);
    if (urlLikeArg) {
      fatal(
        `"squad init" does not accept repository URLs.\n` +
        `  Clone the repository with git first, then run:\n` +
        `    squad init --target-dir <local-dir>\n` +
        `  To skip registry registration: squad init --target-dir <local-dir> --no-register`,
      );
      return;
    }

    const { runInit: runRegistryInit } = await import('./commands/init.js');
    const targetDirIdx = args.indexOf('--target-dir');
    const targetDirArg = (targetDirIdx !== -1 && args[targetDirIdx + 1]) ? args[targetDirIdx + 1] : undefined;
    const callsignIdx = args.indexOf('--callsign');
    const callsign = (callsignIdx !== -1 && args[callsignIdx + 1]) ? args[callsignIdx + 1] : undefined;
    const registryPathIdx = args.indexOf('--registry-path');
    const registryPath = (registryPathIdx !== -1 && args[registryPathIdx + 1]) ? args[registryPathIdx + 1] : undefined;
    const hasNoRegister = args.includes('--no-register');
    const modeIdx = args.indexOf('--mode');
    const mode = (modeIdx !== -1 && args[modeIdx + 1]) ? args[modeIdx + 1] : undefined;
    const remoteTeamPath = mode === 'remote' ? args[modeIdx + 2] : undefined;

    if (mode === 'remote' && !remoteTeamPath) {
      fatal('Usage: squad init --mode remote <team-repo-path>');
    }

    const sdkMod = hasGlobal && !targetDirArg ? await lazySquadSdk() : null;
    const targetDir = targetDirArg ?? (hasGlobal ? sdkMod!.resolveGlobalSquadPath() : undefined);
    const resolvedTargetDir = targetDir ? path.resolve(process.cwd(), targetDir) : process.cwd();
    const noWorkflows = args.includes('--no-workflows');
    const mcpFrontmatter = args.includes('--mcp-frontmatter');
    const sdk = args.includes('--sdk');
    const roles = args.includes('--roles');
    const presetIdx = args.indexOf('--preset');
    const presetName = (presetIdx !== -1 && args[presetIdx + 1]) ? args[presetIdx + 1] : undefined;
    const sbIdx = args.indexOf('--state-backend');
    const initStateBackend = (sbIdx !== -1 && args[sbIdx + 1]) ? args[sbIdx + 1] : undefined;

    try {
      const result = await runRegistryInit({
        targetDir,
        callsign,
        noRegister: hasNoRegister,
        registryPath,
        cwd: process.cwd(),
        includeWorkflows: !noWorkflows && !hasGlobal,
        sdk,
        roles,
        isGlobal: hasGlobal,
        stateBackend: initStateBackend,
        remoteTeamPath,
        yes: args.includes('--yes'),
      });

      if (mode === 'remote' && remoteTeamPath) {
        const { writeRemoteConfig } = await import('./cli/commands/init-remote.js');
        await writeRemoteConfig(resolvedTargetDir, remoteTeamPath);
      }

      const ok = noColor ? 'OK' : `${GREEN}✔${RESET}`;
      if (result.registered) {
        console.log(`${ok} Initialized and registered: ${result.registered.callsign} → ${result.registered.path}`);
      } else if (result.reactivated) {
        console.log(`${ok} Reactivated: ${result.reactivated.callsign} → ${result.reactivated.path}`);
      } else {
        console.log(`${ok} Initialized squad (no registry entry written).`);
      }

      if (presetName) {
        const { seedBuiltinPresets, applyPreset } = await import('@bradygaster/squad-sdk/presets');
        const { resolvePresetsDir, ensureSquadHome } = await import('@bradygaster/squad-sdk/resolution');
        const nodePath = await import('node:path');

        if (!resolvePresetsDir()) {
          console.log(`\n⚙️  No presets found — setting up squad home...`);
          ensureSquadHome();
          seedBuiltinPresets();
          console.log(`✅ Squad home initialized at ${ensureSquadHome()}`);
          console.log(`   Built-in presets ready. Run 'squad preset init --remote' to back with a GitHub repo.\n`);
        } else {
          seedBuiltinPresets();
        }

        const targetAgentsDir = nodePath.join(resolvedTargetDir, '.squad', 'agents');
        const results = applyPreset(presetName, targetAgentsDir);
        const installed = results.filter(r => r.status === 'installed');
        const skipped = results.filter(r => r.status === 'skipped');
        const errors = results.filter(r => r.status === 'error');
        if (installed.length > 0) {
          console.log(`✅ Applied preset '${presetName}': ${installed.length} agents installed`);
        }
        if (skipped.length > 0) {
          console.log(`   ${skipped.length} agents skipped (already exist)`);
        }
        if (errors.length > 0 && installed.length === 0) {
          console.error(`❌ Preset '${presetName}' not found. Run 'squad preset list' to see available presets.`);
        }
      }
    } catch (err) {
      const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
      console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
      const isConflict = err instanceof ConfigurationError;
      process.exit(isConflict ? 2 : 1);
    }
    return;
  }

  if (cmd === 'upgrade') {
    const { runUpgrade, selfUpgradeCli } = await import('./cli/core/upgrade.js');
    const { migrateDirectory } = await import('./cli/core/migrate-directory.js');
    const migrateDir = args.includes('--migrate-directory');
    const selfUpgrade = args.includes('--self');
    const forceUpgrade = args.includes('--force');
    const insider = args.includes('--insider');
    const dryRun = args.includes('--dry-run');
    const dest = hasGlobal ? (await lazySquadSdk()).resolveGlobalSquadPath() : getSquadStartDir();

    // Parse --state-backend for backend migration
    const sbIdx = args.indexOf('--state-backend');
    const upgradeStateBackend = (sbIdx !== -1 && args[sbIdx + 1]) ? args[sbIdx + 1] : undefined;

    // Warn when --insider is used without --self(it has no effect on project upgrades)
    if (insider && !selfUpgrade) {
      console.warn('⚠️ --insider only applies with --self (squad upgrade --self --insider). Ignoring.');
    }

    // Handle --migrate-directory flag
    if (migrateDir) {
      await migrateDirectory(dest);
      // Continue with regular upgrade after migration
    }
    
    // Handle --self: upgrade the CLI package itself.
    //
    // UPGRADE-EPERM-FALSE-SUCCESS fix (iter-2): surface a failed self-upgrade
    // instead of printing "✅ Upgraded" after a warning.
    //
    // Iter-4 hardening: when BOTH --self and --state-backend are passed and
    // the self-upgrade fails (e.g. EPERM on a globally-installed CLI that
    // can't be replaced by the current user), still run the state-backend
    // migration. The two operations are independent — failing the npm
    // install must not block the user from upgrading their existing project's
    // on-disk state layout. Failures are tracked and we exit non-zero at the
    // end if either step failed.
    let selfUpgradeFailed: string | null = null;
    if (selfUpgrade) {
      try {
        await selfUpgradeCli({ insider, force: forceUpgrade });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        selfUpgradeFailed = msg;
        if (upgradeStateBackend) {
          // Defer the failure: still attempt the state-backend migration so
          // the user gets at least one of the two operations they asked for.
          console.error(`⚠️ Self-upgrade failed: ${msg}`);
          console.error('   Continuing with --state-backend migration. Self-upgrade can be retried separately.');
        } else {
          console.error(`❌ Self-upgrade failed: ${msg}`);
          process.exit(1);
        }
      }
      if (!selfUpgradeFailed && !upgradeStateBackend) {
        console.log('✅ Upgraded. Please restart your terminal for changes to take effect.');
        return;
      }
      if (!selfUpgradeFailed) {
        console.log('✅ Self-upgrade complete. Running --state-backend migration next…');
      }
    }

    // Run upgrade (skip when --self was successful AND no state-backend asked —
    // that case returned above). Otherwise we always run a project upgrade so
    // hooks/templates are refreshed alongside the backend migration.
    if (!selfUpgrade || upgradeStateBackend) {
      await runUpgrade(dest, {
        migrateDirectory: migrateDir,
        self: selfUpgrade,
        force: forceUpgrade,
        dryRun,
      });
    }

    // Handle --state-backend: migrate backend after upgrade
    if (upgradeStateBackend) {
      const { migrateStateBackend } = await import('./cli/commands/migrate-backend.js');
      try {
        await migrateStateBackend(dest, upgradeStateBackend);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ State-backend migration failed: ${msg}`);
        process.exit(1);
      }
    } else {
      // Ensure hooks are installed for existing orphan/two-layer backends
      const { ensureHooksForBackend } = await import('./cli/commands/install-hooks.js');
      ensureHooksForBackend(dest);
    }

    if (selfUpgradeFailed) {
      // Partial success — state-backend migration completed but self-upgrade
      // did not. Exit non-zero so callers (CI, wrapper scripts) can detect it.
      console.error(`❌ Self-upgrade failed earlier: ${selfUpgradeFailed}`);
      console.error('   The project upgrade and state-backend migration succeeded; retry the self-upgrade manually.');
      process.exit(1);
    }

    return;
  }

  if (cmd === 'update-check') {
    const { runUpdateCheckCommand } = await import('./cli/commands/update-check.js');
    const exitCode = await runUpdateCheckCommand(args.slice(1));
    process.exit(exitCode);
  }

  if (cmd === 'memory') {
    const { runMemoryCommand } = await import('./cli/commands/memory.js');
    await runMemoryCommand(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'state-mcp') {
    const { runStateMcp } = await import('./cli/commands/state-mcp.js');
    await runStateMcp(getSquadStartDir());
    return;
  }

  if (cmd === 'migrate') {
    const { runMigrate } = await import('./cli/commands/migrate.js');
    const toIdx = args.indexOf('--to');
    const to = (toIdx !== -1 && args[toIdx + 1]) ? args[toIdx + 1] as 'sdk' | 'markdown' : undefined;
    const fromIdx = args.indexOf('--from');
    const from = (fromIdx !== -1 && args[fromIdx + 1]) ? args[fromIdx + 1] : undefined;
    const dryRun = args.includes('--dry-run');
    await runMigrate(getSquadStartDir(), { to, from: from as 'ai-team' | undefined, dryRun });
    return;
  }

  // --health flag: show watch instance status and exit
  if (cmd === 'watch' && args.includes('--health')) {
    const { getWatchHealth } = await import('./cli/commands/watch/health.js');
    console.log(getWatchHealth(getSquadStartDir()));
    return;
  }

  if (cmd === 'triage' || cmd === 'watch') {
    const { runWatch, loadWatchConfig, createDefaultRegistry } = await import('./cli/commands/watch/index.js');

    // Parse core flags
    const intervalIdx = args.indexOf('--interval');
    const interval = (intervalIdx !== -1 && args[intervalIdx + 1])
      ? parseInt(args[intervalIdx + 1]!, 10)
      : undefined;

    const execute = args.includes('--execute') ? true : undefined;

    const verbose = args.includes('--verbose') || args.includes('-v');

    const copilotFlagsIdx = args.indexOf('--copilot-flags');
    const copilotFlags = (copilotFlagsIdx !== -1 && args[copilotFlagsIdx + 1])
      ? args[copilotFlagsIdx + 1]
      : undefined;

    const agentCmdIdx = args.indexOf('--agent-cmd');
    const agentCmd = (agentCmdIdx !== -1 && args[agentCmdIdx + 1])
      ? args[agentCmdIdx + 1]
      : undefined;

    const maxConcurrentIdx = args.indexOf('--max-concurrent');
    const maxConcurrent = (maxConcurrentIdx !== -1 && args[maxConcurrentIdx + 1])
      ? parseInt(args[maxConcurrentIdx + 1]!, 10)
      : undefined;

    const timeoutIdx = args.indexOf('--timeout');
    const timeout = (timeoutIdx !== -1 && args[timeoutIdx + 1])
      ? parseInt(args[timeoutIdx + 1]!, 10)
      : undefined;

    // --dispatch-mode runtime validation: rejects invalid values with a clear error message
    const dispatchModeIdx = args.indexOf('--dispatch-mode');
    const rawDispatchMode = (dispatchModeIdx !== -1 && args[dispatchModeIdx + 1])
      ? args[dispatchModeIdx + 1]
      : undefined;
    const validModes = ['task', 'fleet', 'hybrid'] as const;
    const dispatchMode = rawDispatchMode && validModes.includes(rawDispatchMode as any)
      ? rawDispatchMode as 'fleet' | 'task' | 'hybrid'
      : rawDispatchMode
        ? (console.error(`⚠️ Invalid --dispatch-mode "${rawDispatchMode}". Valid: task, fleet, hybrid. Defaulting to task.`), undefined)
        : undefined;

    const logFileIdx = args.indexOf('--log-file');
    const logFile = (logFileIdx !== -1 && args[logFileIdx + 1])
      ? args[logFileIdx + 1]
      : undefined;

    const authUserIdx = args.indexOf('--auth-user');
    const authUser = (authUserIdx !== -1 && args[authUserIdx + 1])
      ? args[authUserIdx + 1]
      : undefined;

    // --notify-level runtime validation
    const notifyLevelIdx = args.indexOf('--notify-level');
    const rawNotifyLevel = (notifyLevelIdx !== -1 && args[notifyLevelIdx + 1])
      ? args[notifyLevelIdx + 1]
      : undefined;
    const validNotifyLevels = ['all', 'important', 'none'] as const;
    const notifyLevel = rawNotifyLevel && (validNotifyLevels as readonly string[]).includes(rawNotifyLevel)
      ? rawNotifyLevel as typeof validNotifyLevels[number]
      : rawNotifyLevel
        ? (console.error(`\u26a0\ufe0f Invalid --notify-level "${rawNotifyLevel}". Valid: all, important, none.`), undefined)
        : undefined;

    const overnightStartIdx = args.indexOf('--overnight-start');
    const overnightStart = (overnightStartIdx !== -1 && args[overnightStartIdx + 1])
      ? args[overnightStartIdx + 1]
      : undefined;

    const overnightEndIdx = args.indexOf('--overnight-end');
    const overnightEnd = (overnightEndIdx !== -1 && args[overnightEndIdx + 1])
      ? args[overnightEndIdx + 1]
      : undefined;

    const sentinelFileIdx = args.indexOf('--sentinel-file');
    const sentinelFile = (sentinelFileIdx !== -1 && args[sentinelFileIdx + 1])
      ? args[sentinelFileIdx + 1]
      : undefined;

    // --state-backend runtime validation: reject invalid values upfront
    const stateBackendIdx = args.indexOf('--state-backend');
    const rawStateBackend = (stateBackendIdx !== -1 && args[stateBackendIdx + 1])
      ? args[stateBackendIdx + 1]
      : undefined;
    const validBackends = ['local', 'orphan', 'two-layer', 'external', 'external-stub'] as const;
    if (rawStateBackend && !(validBackends as readonly string[]).includes(rawStateBackend)) {
      console.error(`\u26a0\ufe0f Invalid --state-backend "${rawStateBackend}". Valid: ${validBackends.join(', ')}.`);
      process.exit(1);
    }
    // Legacy 'external' is normalized (with a deprecation warning) inside resolveStateBackend.
    const mappedBackend = rawStateBackend as StateBackendType | undefined;

    // Resolve the full state context (paths + backend) once at entry.
    // Commands can thread this through instead of re-resolving independently.
    const stateContext: SquadStateContext | null = resolveSquadState(getSquadStartDir(), mappedBackend);

    // Build capability overrides from CLI flags and --no-{cap} flags
    const capabilities: Record<string, boolean | Record<string, unknown>> = {};
    const registry = createDefaultRegistry();
    for (const cap of registry.all()) {
      if (args.includes(`--${cap.name}`)) capabilities[cap.name] = true;
      if (args.includes(`--no-${cap.name}`)) capabilities[cap.name] = false;
    }

    // Legacy flag compat: --board-project sets board sub-option
    const boardProjectIdx = args.indexOf('--board-project');
    if (boardProjectIdx !== -1 && args[boardProjectIdx + 1]) {
      const existing = capabilities['board'];
      capabilities['board'] = typeof existing === 'object' && existing !== null
        ? { ...existing, projectNumber: parseInt(args[boardProjectIdx + 1]!, 10) }
        : { projectNumber: parseInt(args[boardProjectIdx + 1]!, 10) };
    }

    // --board-owner sets the project owner (org or user login)
    const boardOwnerIdx = args.indexOf('--board-owner');
    if (boardOwnerIdx !== -1 && args[boardOwnerIdx + 1]) {
      const existing = capabilities['board'];
      capabilities['board'] = typeof existing === 'object' && existing !== null
        ? { ...existing, owner: args[boardOwnerIdx + 1]! }
        : { owner: args[boardOwnerIdx + 1]! };
    }

    // Load config: .squad/config.json merged with CLI overrides
    const config = loadWatchConfig(getSquadStartDir(), {
      interval,
      execute,
      maxConcurrent,
      timeout,
      copilotFlags,
      agentCmd,
      verbose,
      dispatchMode,
      logFile,
      authUser,
      notifyLevel,
      overnightStart,
      overnightEnd,
      sentinelFile,
      stateBackend: mappedBackend,
      stateContext,
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
    });

    // After parsing all flags, check for positional args that look like prompts.
    // Skip values that follow known value-flags (e.g. "--interval 5" → "5" is not positional).
    const knownValueFlags = new Set([
      '--interval', '--copilot-flags', '--agent-cmd', '--max-concurrent', '--timeout', '--board-project', '--board-owner', '--auth-user',
      '--dispatch-mode', '--log-file', '--notify-level', '--overnight-start', '--overnight-end', '--sentinel-file', '--state-backend',
    ]);
    const watchArgStart = args.indexOf(cmd) + 1;
    const watchArgs = args.slice(watchArgStart);
    const positionalArgs: string[] = [];
    for (let i = 0; i < watchArgs.length; i++) {
      const arg = watchArgs[i]!;
      if (knownValueFlags.has(arg)) { i++; continue; }
      if (arg.startsWith('-')) continue;
      positionalArgs.push(arg);
    }
    if (positionalArgs.length > 0 && config.verbose) {
      console.log(`[verbose] ⚠️ Positional args ignored by watch: "${positionalArgs.join(' ')}". Use --execute to process issues.`);
    }

    await runWatch(getSquadStartDir(), config);
    return;
  }

  if (cmd === 'loop') {
    const { runLoop, generateLoopFile } = await import('./cli/commands/loop.js');

    // --init: scaffold a boilerplate loop.md
    if (args.includes('--init')) {
      const fileIdx = args.indexOf('--file');
      const filePath = (fileIdx !== -1 && args[fileIdx + 1]) ? args[fileIdx + 1]! : 'loop.md';
      const { FSStorageProvider } = await import('@bradygaster/squad-sdk');
      const storage = new FSStorageProvider();
      const pathMod = await import('node:path');
      const absPath = pathMod.default.resolve(getSquadStartDir(), filePath);
      if (storage.existsSync(absPath)) {
        console.log(`⚠️  ${filePath} already exists. Remove it first to regenerate.`);
      } else {
        storage.writeSync(absPath, generateLoopFile());
        console.log(`✅ Created ${filePath} — open it and set \`configured: true\` to activate.`);
      }
      return;
    }

    // Parse flags
    const fileIdx = args.indexOf('--file');
    const filePath = (fileIdx !== -1 && args[fileIdx + 1]) ? args[fileIdx + 1] : undefined;

    const intervalIdx = args.indexOf('--interval');
    const interval = (intervalIdx !== -1 && args[intervalIdx + 1])
      ? parseInt(args[intervalIdx + 1]!, 10)
      : undefined;

    const timeoutIdx = args.indexOf('--timeout');
    const timeout = (timeoutIdx !== -1 && args[timeoutIdx + 1])
      ? parseInt(args[timeoutIdx + 1]!, 10)
      : undefined;

    const copilotFlagsIdx = args.indexOf('--copilot-flags');
    const copilotFlags = (copilotFlagsIdx !== -1 && args[copilotFlagsIdx + 1])
      ? args[copilotFlagsIdx + 1]
      : undefined;

    const agentCmdIdx = args.indexOf('--agent-cmd');
    const agentCmd = (agentCmdIdx !== -1 && args[agentCmdIdx + 1])
      ? args[agentCmdIdx + 1]
      : undefined;

    // Capability flags
    const { createDefaultRegistry: createReg } = await import('./cli/commands/watch/index.js');
    const reg = createReg();
    const capabilities: Record<string, boolean | Record<string, unknown>> = {};
    for (const cap of reg.all()) {
      if (args.includes(`--${cap.name}`)) capabilities[cap.name] = true;
      if (args.includes(`--no-${cap.name}`)) capabilities[cap.name] = false;
    }

    await runLoop(getSquadStartDir(), {
      filePath,
      interval,
      timeout,
      copilotFlags,
      agentCmd,
      capabilities,
    });
    return;
  }

  if (cmd === 'cast' || cmd === 'hire') {
    const nameIdx = args.indexOf('--name');
    const name = (nameIdx !== -1 && args[nameIdx + 1]) ? args[nameIdx + 1] : undefined;
    const roleIdx = args.indexOf('--role');
    const role = (roleIdx !== -1 && args[roleIdx + 1]) ? args[roleIdx + 1] : undefined;

    // `squad cast` with no wizard flags shows the roster; `squad hire` always runs the wizard
    if (cmd === 'cast' && !name && !role) {
      const { runCast } = await import('./cli/commands/cast.js');
      await runCast(getSquadStartDir());
      return;
    }

    console.log('🎬 Squad cast — team creation wizard starting... (full implementation pending)');
    if (name) {
      console.log(`   Name: ${name}`);
    }
    if (role) {
      console.log(`   Role: ${role}`);
    }
    return;
  }

  if (cmd === 'export') {
    const { runExport } = await import('./cli/commands/export.js');
    const outIdx = args.indexOf('--out');
    const outPath = (outIdx !== -1 && args[outIdx + 1]) ? args[outIdx + 1] : undefined;
    const repoIdx = args.indexOf('--repo');
    const repoArg = (repoIdx !== -1 && args[repoIdx + 1]) ? args[repoIdx + 1] : undefined;
    const branchIdx = args.indexOf('--branch');
    const branchArg = (branchIdx !== -1 && args[branchIdx + 1]) ? args[branchIdx + 1] : undefined;
    const repoOptions = repoArg ? { repo: repoArg, branch: branchArg } : undefined;
    await runExport(getSquadStartDir(), outPath, repoOptions);
    return;
  }

  if (cmd === 'import') {
    const { runImport } = await import('./cli/commands/import.js');
    const repoIdx = args.indexOf('--repo');
    const repoArg = (repoIdx !== -1 && args[repoIdx + 1]) ? args[repoIdx + 1] : undefined;
    const branchIdx = args.indexOf('--branch');
    const branchArg = (branchIdx !== -1 && args[branchIdx + 1]) ? args[branchIdx + 1] : undefined;
    const hasForce = args.includes('--force');
    if (repoArg) {
      const repoOptions = { repo: repoArg, branch: branchArg };
      await runImport(getSquadStartDir(), '', hasForce, repoOptions);
    } else {
      const importFile = args[1];
      if (!importFile) {
        fatal('Usage: squad import <file> [--force] or squad import --repo owner/repo [--branch branch] [--force]');
      }
      await runImport(getSquadStartDir(), importFile, hasForce);
    }
    return;
  }

  if (cmd === 'plugin') {
    const { runPlugin } = await import('./cli/commands/plugin.js');
    await runPlugin(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'copilot') {
    const { runCopilot } = await import('./cli/commands/copilot.js');
    const isOff = args.includes('--off');
    const autoAssign = args.includes('--auto-assign');
    await runCopilot(getSquadStartDir(), { off: isOff, autoAssign });
    return;
  }

  if (cmd === 'scrub-emails') {
    const { scrubEmails } = await import('./cli/core/email-scrub.js');
    const targetDir = args[1] || '.ai-team';
    const count = await scrubEmails(targetDir);
    if (count > 0) {
      console.log(`Scrubbed ${count} email address(es).`);
    } else {
      console.log('No email addresses found.');
    }
    return;
  }

  if (cmd === 'status') {
    const sdk = await lazySquadSdk();
    const startDir = getSquadStartDir();
    const resolvedSquad = sdkResolveSquadDir({ cwd: startDir, env: process.env });
    const repoSquad = resolvedSquad?.path ?? null;
    const globalPath = sdk.resolveGlobalSquadPath();
    const globalSquadDir = path.join(globalPath, '.squad');
    const storage = new FSStorageProvider();
    const globalExists = await storage.exists(globalSquadDir);

    console.log(`\n${BOLD}Squad Status${RESET}\n`);

    if (resolvedSquad) {
      console.log(`  Active squad: ${BOLD}repo${RESET}`);
      console.log(`  Path:         ${resolvedSquad.path}`);
      console.log(`  Reason:       ${formatResolverReason(resolvedSquad.source)}`);
      if (resolvedSquad.callsign) {
        console.log(`  Callsign:     ${resolvedSquad.callsign}`);
      }
      const { formatRegistryStatusBlock } = await import('./commands/status.js');
      const registryBlock = formatRegistryStatusBlock(
        resolvedSquad,
        process.env as Record<string, string | undefined>,
      );
      if (registryBlock) {
        console.log();
        process.stdout.write(registryBlock);
      }
    } else if (globalExists) {
      console.log(`  Active squad: ${BOLD}personal (global)${RESET}`);
      console.log(`  Path:         ${globalSquadDir}`);
      console.log(`  Reason:       No repo .squad/ found; personal squad exists at global path`);
    } else {
      console.log(`  Active squad: ${DIM}none${RESET}`);
      console.log(`  Reason:       No .squad/ found in repo tree or at global path`);
    }

    console.log();
    console.log(`  ${DIM}Repo resolution:   ${repoSquad ?? 'not found'}${RESET}`);
    console.log(`  ${DIM}Global path:       ${globalPath}${RESET}`);
    console.log(`  ${DIM}Global squad:      ${globalExists ? globalSquadDir : 'not initialized'}${RESET}`);
    console.log();

    return;
  }

  if (cmd === 'roles') {
    const { runRoles } = await import('./cli/commands/roles.js');
    await runRoles(args.slice(1));
    return;
  }

  if (cmd === 'cost') {
    const sdk = await lazySquadSdk();
    const localSquad = sdk.resolveSquad(getSquadStartDir());
    const globalPath = sdk.resolveGlobalSquadPath();
    const globalSquadDir = path.join(globalPath, '.squad');
    const storage = new FSStorageProvider();
    const teamRoot = localSquad
      ? path.resolve(localSquad, '..')
      : (await storage.exists(globalSquadDir) ? globalPath : null);

    if (!teamRoot) {
      fatal('No squad found. Run "squad init" first.');
    }

    await runCost(args.slice(1), teamRoot);
    return;
  }

  if (cmd === 'build') {
    const { runBuild } = await import('./cli/commands/build.js');
    const hasCheck = args.includes('--check');
    const hasDryRun = args.includes('--dry-run');
    const hasWatch = args.includes('--watch');
    await runBuild(getSquadStartDir(), { check: hasCheck, dryRun: hasDryRun, watch: hasWatch });
    return;
  }

  if (cmd === 'subsquads' || cmd === 'workstreams' || cmd === 'streams') {
    const { runSubSquads } = await import('./cli/commands/streams.js');
    await runSubSquads(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'start') {
    console.log(`\n${YELLOW}⚠ DEPRECATED:${RESET} "squad start" is deprecated and will be removed in a future release.`);
    console.log(`  Use the GitHub Copilot CLI directly: ${BOLD}gh copilot${RESET}\n`);
    let resolvedForStart: ResolvedSquad | null = null;
    try {
      resolvedForStart = sdkResolveSquadDir({ cwd: getSquadStartDir(), env: process.env });
    } catch (err) {
      fatal(err instanceof Error ? err.message : String(err));
    }
    if (!resolvedForStart) {
      fatal(
        'No squad found.\n' +
          '   Run "squad init" to create a new squad host, or "squad assign <callsign>" to bind this checkout to a registered squad.',
      );
      return;
    }
    if (!existsSync(resolvedForStart.path) || !statSync(resolvedForStart.path).isDirectory()) {
      fatal(`Resolved squad path does not exist or is not a directory: ${resolvedForStart.path}`);
    }
    const { runStart } = await import('./cli/commands/start.js');
    const hasTunnel = args.includes('--tunnel');
    const portIdx = args.indexOf('--port');
    const port = (portIdx !== -1 && args[portIdx + 1]) ? parseInt(args[portIdx + 1]!, 10) : 0;
    // Collect all remaining args to pass through to copilot
    const cmdIdx = args.indexOf('--command');
    const customCmd = (cmdIdx !== -1 && args[cmdIdx + 1]) ? args[cmdIdx + 1] : undefined;
    const squadFlags = ['start', '--tunnel', '--port', port.toString(), '--command', customCmd || ''].filter(Boolean);
    const copilotArgs = args.slice(1).filter(a => !squadFlags.includes(a));
    await runStart(getSquadStartDir(), { tunnel: hasTunnel, port, copilotArgs, command: customCmd, squadDir: resolvedForStart.path });
    return;
  }

  if (cmd === 'nap') {
    const { runNap, formatNapReport } = await import('./cli/core/nap.js');
    const sdk = await lazySquadSdk();
    const startDir = getSquadStartDir();
    // resolveSquad() returns the .squad/ directory itself — use it directly (#207)
    const squadDir = sdk.resolveSquad(startDir);
    if (!squadDir) {
      fatal(`No squad found (searched from ${startDir}). Run "squad init" first, or use --team-root to specify the project directory.`);
    }
    const deep = args.includes('--deep');
    const dryRun = args.includes('--dry-run');
    const result = await runNap({ squadDir, deep, dryRun });
    console.log(formatNapReport(result, !!process.env['NO_COLOR']));
    return;
  }

  if (cmd === 'register') {
    // BREAKING: the `register` subcommand was removed. Emit the teaching error
    // before any unknown-command handling, ignore additional flags, and exit
    // with a command-usage failure code so scripted callers can detect the
    // removal condition specifically.
    console.error(
      'ERR_SQUAD_REGISTER_REMOVED: squad register has been removed.\n' +
      'Use squad assign <callsign> to bind this checkout to a registered squad.\n' +
      'For a new squad host, run squad init --callsign <name>.\n' +
      'Run squad list to see registered squads.',
    );
    process.exit(2);
  }

  if (cmd === 'list') {
    const { runList } = await import('./commands/list.js');
    const registryPathIdx = args.indexOf('--registry-path');
    const registryPath = (registryPathIdx !== -1 && args[registryPathIdx + 1]) ? args[registryPathIdx + 1] : undefined;
    const output = await runList({ registryPath });
    console.log(output);
    return;
  }

  if (cmd === 'doctor') {
    const registryPathIdx = args.indexOf('--registry-path');
    const registryPath = (registryPathIdx !== -1 && args[registryPathIdx + 1]) ? args[registryPathIdx + 1] : undefined;
    const hasYes = args.includes('--yes');
    const hasNormalize = args.includes('--normalize-callsigns');
    const hasApply = args.includes('--apply');
    const purgeIdx = args.indexOf('--purge');
    const hasPurge = purgeIdx !== -1;

    // N5: --apply requires --normalize-callsigns
    if (hasApply && !hasNormalize) {
      fatal('--apply requires --normalize-callsigns');
      return;
    }

    // F2: --normalize-callsigns and --purge are mutually exclusive
    if (hasNormalize && hasPurge) {
      fatal('--normalize-callsigns and --purge are mutually exclusive');
      return;
    }

    // --normalize-callsigns mode
    if (hasNormalize) {
      const { runDoctorNormalize } = await import('./commands/doctor.js');
      const result = await runDoctorNormalize({ registryPath, apply: hasApply, yes: hasYes });
      for (const line of result.lines) {
        console.log(line);
      }
      return;
    }

    // --purge <callsign> mode
    if (hasPurge) {
      const purgeCallsign = args[purgeIdx + 1];
      if (!purgeCallsign || purgeCallsign.startsWith('--')) {
        fatal('Usage: squad doctor --purge <callsign>');
        return;
      }
      const { formatCallsignValidationMessage } = await import('@bradygaster/squad-sdk');
      const { runDoctorPurge } = await import('./commands/doctor.js');
      const result = await runDoctorPurge({ callsign: purgeCallsign, registryPath, yes: hasYes });
      if (result.invalidCallsign) {
        fatal(formatCallsignValidationMessage(purgeCallsign));
        return;
      }
      if (result.noRegistry) {
        console.error('No registry found.');
        process.exit(1);
        return;
      }
      if (result.notFound) {
        const hint = result.notFound.suggestion ? ` Did you mean "${result.notFound.suggestion}"?` : '';
        fatal(`Callsign "${purgeCallsign}" not found in the registry.${hint}`);
        return;
      }
      if (result.refused) {
        const list = result.refused.consumers.map(c => `  - ${c}`).join('\n');
        console.error(
          `Cannot purge "${purgeCallsign}": entry is active with ${result.refused.consumers.length} clone binding(s):\n${list}\n` +
          `Run "squad unassign --callsign ${purgeCallsign}" from each clone directory first.`,
        );
        process.exit(2);
        return;
      }
      if (result.cancelled) {
        console.log('Purge cancelled.');
        return;
      }
      if (result.removed) {
        console.log(`Removed registry entry "${purgeCallsign}".`);
        if (result.hostPath) {
          console.log(`Host directory was not deleted: ${result.hostPath}`);
        }
        return;
      }
      return;
    }

    // Unified doctor: system + registry findings in a single pass
    const { runUnifiedDoctor, renderFinding, deriveExitCode } = await import('./cli/commands/doctor.js');
    const { findings, passCount } = await runUnifiedDoctor({
      cwd: getSquadStartDir(),
      registryPath,
    });

    const systemFindings = findings.filter(f => f.source === 'system');
    const registryFindings = findings.filter(f => f.source === 'registry');

    console.log('Squad Doctor');
    if (systemFindings.length > 0) {
      console.log(noColor ? 'System doctor' : `${BOLD}System doctor${RESET}`);
      for (const f of systemFindings) renderFinding(f, noColor);
    }
    if (registryFindings.length > 0) {
      console.log(noColor ? '\nRegistry doctor' : `\n${BOLD}Registry doctor${RESET}`);
      for (const f of registryFindings) renderFinding(f, noColor);
    }

    const registryExitCode = deriveExitCode(registryFindings);
    const warnCount = findings.filter(f => f.severity === 'warn').length;
    const errorCount = findings.filter(f => f.severity === 'error').length;
    console.log(`\nSummary: ${passCount} passed, ${errorCount} errors, ${warnCount} warnings`);

    // Exit code driven by registry findings only — system findings are diagnostic.
    if (registryExitCode === 2) process.exit(2);
    return;
  }

  if (cmd === 'consult') {
    const showStatus = args.includes('--status');
    if (!showStatus) {
      // Check git repository presence before squad resolution.
      const startDir = getSquadStartDir();
      let isGitRepo = false;
      try {
        const { execSync: _execSync } = await import('node:child_process');
        _execSync('git rev-parse --git-dir', { cwd: startDir, stdio: ['pipe', 'pipe', 'pipe'] });
        isGitRepo = true;
      } catch {
        isGitRepo = false;
      }
      if (!isGitRepo) {
        console.error('Not a git repository');
        process.exit(1);
        return;
      }
      // Resolution is the precondition for setup and dry-run modes.
      if (!sdkResolveSquadDir({ cwd: startDir, env: process.env })) {
        fatal(
          'No squad found.\n' +
            '   Run "squad init" to create a new squad host, or "squad assign <callsign>" to bind this checkout to a registered squad.',
        );
        return;
      }
    }
    const { runConsult } = await import('./cli/commands/consult.js');
    await runConsult(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'extract') {
    const { runExtract } = await import('./cli/commands/extract.js');
    await runExtract(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'aspire') {
    const { runAspire } = await import('./cli/commands/aspire.js');
    const useDocker = args.includes('--docker');
    const portIdx = args.indexOf('--port');
    const port = (portIdx !== -1 && args[portIdx + 1]) ? parseInt(args[portIdx + 1]!, 10) : undefined;
    await runAspire({ docker: useDocker, port });
    return;
  }

  if (cmd === 'link') {
    if (!sdkResolveSquadDir({ cwd: getSquadStartDir(), env: process.env })) {
      fatal(
        'No squad found.\n' +
          '   Run "squad init" to create a new squad host, or "squad assign <callsign>" to bind this checkout to a registered squad.',
      );
      return;
    }
    const { runLink } = await import('./cli/commands/link.js');
    const teamPath = args[1];
    if (!teamPath) {
      fatal('Usage: squad link <team-repo-path>');
    }
    runLink(getSquadStartDir(), teamPath);
    return;
  }

  if (cmd === 'externalize') {
    const { runExternalize } = await import('./cli/commands/externalize.js');
    const rawKey = args.includes('--key') ? args[args.indexOf('--key') + 1] : undefined;
    const projectKey = rawKey ? rawKey.replace(/[\/\\\.]/g, '_') : undefined;
    runExternalize(process.cwd(), projectKey);
    return;
  }

  if (cmd === 'internalize') {
    const { runInternalize } = await import('./cli/commands/externalize.js');
    runInternalize(process.cwd());
    return;
  }

  if (cmd === 'rc' || cmd === 'remote-control') {
    console.log(`\n${YELLOW}⚠ DEPRECATED:${RESET} "squad rc" is deprecated and will be removed in a future release.`);
    console.log(`  Use the GitHub Copilot CLI directly: ${BOLD}gh copilot${RESET}\n`);
    const hasTunnel = args.includes('--tunnel');
    const portIdx = args.indexOf('--port');
    const port = (portIdx !== -1 && args[portIdx + 1]) ? parseInt(args[portIdx + 1]!, 10) : 0;
    const pathIdx = args.indexOf('--path');
    const rcPath = (pathIdx !== -1 && args[pathIdx + 1]) ? args[pathIdx + 1] : undefined;
    const rcStartDir = rcPath || getSquadStartDir();
    let resolvedForRc: ResolvedSquad | null = null;
    try {
      resolvedForRc = sdkResolveSquadDir({ cwd: rcStartDir, env: process.env });
    } catch (err) {
      fatal(err instanceof Error ? err.message : String(err));
    }
    if (!resolvedForRc) {
      fatal(
        'No squad found.\n' +
          '   Run "squad init" to create a new squad host, or "squad assign <callsign>" to bind this checkout to a registered squad.',
      );
      return;
    }
    if (!existsSync(resolvedForRc.path) || !statSync(resolvedForRc.path).isDirectory()) {
      fatal(`Resolved squad path does not exist or is not a directory: ${resolvedForRc.path}`);
    }
    const { runRC } = await import('./cli/commands/rc.js');
    await runRC(rcStartDir, { tunnel: hasTunnel, port, squadDir: resolvedForRc.path });
    return;
  }

  if (cmd === 'copilot-bridge') {
    const { CopilotBridge } = await import('./cli/commands/copilot-bridge.js');
    const result = await CopilotBridge.checkCompatibility();
    if (result.compatible) {
      console.log(`${GREEN}✓${RESET} ${result.message}`);
    } else {
      console.log(`${YELLOW}⚠${RESET} ${result.message}`);
    }
    return;
  }

  if (cmd === 'init-remote') {
    const teamPath = args[1];
    if (!teamPath) {
      fatal('Usage: squad init-remote <team-repo-path>');
    }
    const { runInit: runRegistryInit } = await import('./commands/init.js');
    try {
      await runRegistryInit({ cwd: process.cwd(), remoteTeamPath: teamPath });
    } catch (err) {
      const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
      console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
      const isConflict = err instanceof ConfigurationError;
      process.exit(isConflict ? 2 : 1);
    }
    return;
  }

  if (cmd === 'rc-tunnel') {
    const { isDevtunnelAvailable } = await import('./cli/commands/rc-tunnel.js');
    if (isDevtunnelAvailable()) {
      console.log(`${GREEN}✓${RESET} devtunnel CLI is available`);
    } else {
      console.log(`${YELLOW}⚠${RESET} devtunnel CLI not found. Install with: winget install Microsoft.devtunnel`);
    }
    return;
  }

  if (cmd === 'schedule') {
    const { runSchedule } = await import('./cli/commands/schedule.js');
    const subcommand = args[1] || 'list';
    await runSchedule(getSquadStartDir(), subcommand, args.slice(2));
    return;
  }

  if (cmd === 'personal') {
    const { runPersonal } = await import('./cli/commands/personal.js');
    const subcommand = args[1] || 'list';
    await runPersonal(getSquadStartDir(), subcommand, args.slice(2));
    return;
  }

  if (cmd === 'preset') {
    const { runPreset } = await import('./cli/commands/preset.js');
    const subcommand = args[1] || 'list';
    await runPreset(getSquadStartDir(), subcommand, args.slice(2));
    return;
  }

  if (cmd === 'skill') {
    const { runSkill } = await import('./cli/commands/skill.js');
    await runSkill(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'upstream') {
    const { upstreamCommand } = await import('./cli/commands/upstream.js');
    await upstreamCommand(args.slice(1));
    return;
  }

  if (cmd === 'discover') {
    const { discoverCommand } = await import('./cli/commands/cross-squad.js');
    await discoverCommand(getSquadStartDir());
    return;
  }

  if (cmd === 'delegate') {
    const { delegateCommand } = await import('./cli/commands/cross-squad.js');
    await delegateCommand(args.slice(1), getSquadStartDir());
    return;
  }

  if (cmd === 'registry') {
    const { registryCommand } = await import('./cli/commands/cross-squad.js');
    await registryCommand(args.slice(1));
    return;
  }

  if (cmd === 'economy') {
    const { runEconomy } = await import('./cli/commands/economy.js');
    await runEconomy(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'notes') {
    const { runNotes } = await import('./cli/commands/notes.js');
    await runNotes(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'config') {
    const { runConfig } = await import('./cli/commands/config.js');
    await runConfig(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'assign') {
    const { parseAssignArgs } = await import('./commands/assign-args.js');
    const { callsignOrUrl, cloneTo, callsign, registryPath, targetDir, skillsFrom, inboxHandle, stateRemote, stateBranch, configRemote, configBranch, yes, allowOriginCollision, noBind } = parseAssignArgs(args.slice(1));
    const { runAssign } = await import('./commands/assign.js');
    try {
      const result = await runAssign({
        callsignOrUrl,
        cloneTo,
        callsign,
        registryPath,
        targetDir,
        skillsFrom,
        inboxHandle,
        stateRemote,
        stateBranch,
        configRemote,
        configBranch,
        yes,
        allowOriginCollision,
        noBind,
        cwd: getSquadStartDir(),
      });
      // Emit warnings only on result kinds that carry them.
      if (result.kind === 'assigned' || result.kind === 'reactivated') {
        for (const w of result.warnings) {
          console.warn(w);
        }
      }
      switch (result.kind) {
        case 'assigned':
          console.log(`✓ Assigned "${result.callsign}" → ${result.clonePath ?? result.hostPath}`);
          break;
        case 'reactivated':
          console.log(`✓ Reactivated "${result.callsign}" → ${result.clonePath ?? result.hostPath}`);
          break;
        case 'alreadyAssigned':
          console.log(`ℹ "${result.callsign}" already assigned to ${result.clonePath ?? result.hostPath}`);
          break;
        case 'noOp':
          console.log(`ℹ Running from squad host — no assignment needed for "${result.callsign}"`);
          break;
        default: {
          // Compile-time exhaustiveness guard — TypeScript will error here if a
          // new AssignKind variant is added without a corresponding case above.
          const _exhaustive: never = result;
          void _exhaustive;
          break;
        }
      }
    } catch (err) {
      const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
      console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === 'assign-to-copilot') {
    // Dispatch-level guard: consistent pattern with consult and link.
    const guardResult = sdkResolveSquadDir({ cwd: getSquadStartDir(), env: process.env });
    if (!guardResult) {
      fatal(
        'No squad found.\n' +
          '   Run "squad assign <callsign>" to bind this checkout first,\n' +
          '   or pass --callsign to specify the target squad.',
      );
      return;
    }
    const callsignIdx = args.indexOf('--callsign');
    const callsign = callsignIdx !== -1 ? args[callsignIdx + 1] : undefined;
    const registryPathIdx = args.indexOf('--registry-path');
    const registryPath = registryPathIdx !== -1 ? args[registryPathIdx + 1] : undefined;
    const dryRun = args.includes('--dry-run');
    const noInstallAgent = args.includes('--no-install-agent');
    const homeIdx = args.indexOf('--home');
    const home = homeIdx !== -1 ? args[homeIdx + 1] : undefined;
    if (home !== undefined && (!path.isAbsolute(home) || home.replace(/\\/g, '/').split('/').includes('..'))) {
      fatal(`--home must be an absolute path without ".." traversal, got: "${home}"`);
      return;
    }
    const { runAssignToCopilot } = await import('./commands/assign.js');
    try {
      await runAssignToCopilot({
        cwd: getSquadStartDir(),
        env: process.env,
        callsign,
        registryPath,
        dryRun,
        noInstallAgent,
        home,
        resolved: guardResult,
      });
    } catch (err) {
      const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
      console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === 'unassign') {
    const { parseUnassignArgs } = await import('./commands/assign-args.js');
    const { callsign, registryPath, targetDir } = parseUnassignArgs(args.slice(1));
    const { runUnassign } = await import('./commands/unassign.js');
    try {
      const result = await runUnassign({
        callsign,
        registryPath,
        targetDir,
        cwd: getSquadStartDir(),
      });
      if (result.hostPathGuard) {
        // Message already emitted inside runUnassign.
      } else if (result.alreadyUnassigned) {
        console.log(`ℹ Already unassigned — no matching registry entry for this directory.`);
      }
      // demoted and normal removal messages are emitted inside runUnassign.
    } catch (err) {
      const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
      console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
      const exitCode = (err as { exitCode?: number }).exitCode ?? 1;
      process.exit(exitCode);
    }
    return;
  }

  if (cmd === 'sync') {
    const subCmd = args[1];
    const syncRegistryPathIdx = args.indexOf('--registry-path');
    const syncRegistryPath = (syncRegistryPathIdx !== -1 && args[syncRegistryPathIdx + 1])
      ? args[syncRegistryPathIdx + 1]
      : undefined;
    if (subCmd === 'status') {
      const { runSyncStatus } = await import('./cli/commands/sync.js');
      await runSyncStatus({ cwd: getSquadStartDir(), registryPath: syncRegistryPath });
      return;
    }

    const hasPush = args.includes('--push');
    const hasPull = args.includes('--pull');
    const hasBoth = args.includes('--both');
    const hasPushConfig = args.includes('--push-config');
    let direction: 'push' | 'pull' | 'both' = 'both';
    if (hasPush && !hasPull) direction = 'push';
    else if (hasPull && !hasPush) direction = 'pull';
    else if (hasBoth) direction = 'both';
    else if (subCmd === 'push') direction = 'push';
    else if (subCmd === 'pull') direction = 'pull';
    else if (hasPushConfig) direction = 'push'; // config-only push: no implicit pull

    // Piece 53 §A: `--push-config` publishes the durable lane. When it is the SOLE direction
    // flag, suppress the ephemeral state push/pull so a bare `squad sync --push-config` does
    // not also fold ephemeral state.
    const pushConfigOnly = hasPushConfig && !hasPush && !hasPull && !hasBoth
      && subCmd !== 'push' && subCmd !== 'pull';

    const remoteIdx = args.indexOf('--remote');
    const syncRemote = remoteIdx !== -1 ? args[remoteIdx + 1] : undefined;
    const inboxHandleIdx = args.indexOf('--inbox-handle');
    const inboxHandle = inboxHandleIdx !== -1 ? args[inboxHandleIdx + 1] : undefined;
    const developerIdx = args.indexOf('--developer');
    const developer = developerIdx !== -1 ? args[developerIdx + 1] : undefined;
    const syncQuiet = args.includes('--quiet');
    const syncDryRun = args.includes('--dry-run');

    const { runSync } = await import('./cli/commands/sync.js');
    await runSync({ direction, remote: syncRemote, inboxHandle: inboxHandle ?? developer, quiet: syncQuiet, dryRun: syncDryRun, registryPath: syncRegistryPath, pushConfig: hasPushConfig, pushConfigOnly });
    return;
  }

  if (cmd === 'install-fold-pipeline') {
    const platform = args[1] as string | undefined;
    if (platform !== 'github' && platform !== 'ado') {
      fatal(`install-fold-pipeline requires a platform argument: github or ado\nUsage: squad install-fold-pipeline <github|ado> [--callsign <name>] [--force] [--delete-folded-refs] [--fold-service-connection <name>] [--runner "<labels>"] [--state-only | --config-only]`);
      return;
    }
    const callsignIdx = args.indexOf('--callsign');
    const callsign = (callsignIdx !== -1 && args[callsignIdx + 1]) ? args[callsignIdx + 1] : undefined;
    const force = args.includes('--force');
    const deleteFoldedRefs = args.includes('--delete-folded-refs');
    const fscIdx = args.indexOf('--fold-service-connection');
    const foldServiceConnection = (fscIdx !== -1 && args[fscIdx + 1]) ? args[fscIdx + 1] : undefined;
    const runnerIdx = args.indexOf('--runner');
    const runner = (runnerIdx !== -1 && args[runnerIdx + 1]) ? args[runnerIdx + 1] : undefined;
    const stateOnly = args.includes('--state-only');
    const configOnly = args.includes('--config-only');
    const { installFoldPipeline } = await import('./cli/commands/install-fold-pipeline.js');
    await installFoldPipeline(platform, { cwd: getSquadStartDir(), callsign, force, deleteFoldedRefs, foldServiceConnection, runner, stateOnly, configOnly });
    return;
  }

  // Unknown command
  fatal(`Unknown command: ${cmd}\n       Run 'squad doctor' to check your setup, or 'squad help' for usage information.`);
}

main().catch(err => {
  if (err instanceof SquadError) {
    console.error(`${RED}✗${RESET} ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});



