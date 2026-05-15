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
// @ts-expect-error — narrowing emit signature for warning suppression
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

import { FSStorageProvider, resolveSquadState, resolveSquad as resolveSquadV2 } from '@bradygaster/squad-sdk';
import type { ResolvedSquad, SquadStateContext, StateBackendType } from '@bradygaster/squad-sdk';
import path from 'node:path';
import { fatal, SquadError } from './cli/core/errors.js';
import { BOLD, RESET, DIM, RED, GREEN, YELLOW } from './cli/core/output.js';
import { runInit } from './cli/core/init.js';
import { runCost } from './cli/commands/cost.js';
import { getPackageVersion } from './cli/core/version.js';

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

function resolveSquadDir(cwd: string): string | null {
  return resolveSquadV2({ cwd, env: process.env })?.path ?? null;
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
    console.log(`\n${b}squad${r} v${VERSION} — Add an AI agent team to any project\n`);
    console.log(`Usage: squad [command] [options]\n`);
    console.log(`Commands:`);
    console.log(`  ${b}(default)${r}  Launch interactive shell`);
    console.log(`  ${b}init${r}       Initialize squad in current directory`);
    console.log(`  ${b}register${r}   Register a squad path in the registry`);
    console.log(`  ${b}list${r}       List registered squads`);
    console.log(`  ${b}doctor${r}     Validate setup and registry health`);
    console.log(`  ${b}upgrade${r}    Update Squad-owned files to latest`);
    console.log(`  ${b}migrate${r}    Convert markdown <-> SDK squad formats`);
    console.log(`  ${b}status${r}     Show which squad is active and why`);
    console.log(`  ${b}roles${r}      List built-in Squad roles`);
    console.log(`  ${b}cost${r}       Report token usage`);
    console.log(`  ${b}triage${r}     Scan for work and categorize issues`);
    console.log(`  ${b}loop${r}       Prompt-driven continuous work loop`);
    console.log(`  ${b}hire${r}       Team creation wizard`);
    console.log(`  ${b}copilot${r}    Add/remove the Copilot coding agent`);
    console.log(`  ${b}plugin${r}     Manage plugin marketplaces`);
    console.log(`  ${b}export${r}     Export squad to a portable JSON snapshot`);
    console.log(`  ${b}import${r}     Import squad from an export file`);
    console.log(`  ${b}scrub-emails${r}  Remove emails from state files`);
    console.log(`  ${b}start${r}      Start Copilot with remote access`);
    console.log(`  ${b}nap${r}        Context hygiene for .squad/ state`);
    console.log(`  ${b}consult${r}    Enter consult mode with your personal squad`);
    console.log(`  ${b}extract${r}    Extract learnings from consult mode session`);
    console.log(`  ${b}subsquads${r}  Manage SubSquads`);
    console.log(`  ${b}link${r}       Link to a remote team root`);
    console.log(`  ${b}build${r}      Compile squad.config.ts to markdown`);
    console.log(`  ${b}aspire${r}     Launch .NET Aspire dashboard`);
    console.log(`  ${b}schedule${r}   Manage scheduled tasks`);
    console.log(`  ${b}personal${r}   Manage your personal squad`);
    console.log(`  ${b}preset${r}     Manage squad presets`);
    console.log(`  ${b}cast${r}       Show current session cast`);
    console.log(`  ${b}upstream${r}   Manage upstream Squad sources`);
    console.log(`  ${b}economy${r}    Toggle economy mode`);
    console.log(`  ${b}version${r}    Print installed version`);
    console.log(`  ${b}help${r}       Show this help message`);
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
      console.log(`  --mode remote <p> Link to remote team root\n`);
      return;
    }
    if (cmd === 'register') {
      console.log(`\n${b}squad register${r} — Register a squad\n`);
      console.log(`Usage: squad register --callsign <n> [--path <dir>]\n`);
      console.log(`Options:`);
      console.log(`  --callsign <name>  Name in registry (required)`);
      console.log(`  --path <dir>       Project directory (optional; inferred from Git root if omitted)`);
      console.log(`  --origin <url>     Append a remote URL to an existing entry (deduplicates by canonical form)`);
      console.log(`  --clone <path>     Append a clone root path to an existing entry (deduplicates by path)`);
      console.log(`  --registry-path    Alternate registry file`);
      console.log(`  --no-install-agent Skip installing ~/.copilot/agents/squad.agent.md`);
      console.log(`  --home <dir>       Override home dir for agent install\n`);
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
      console.log(`Usage: squad doctor [--registry-path <path>]\n`);
      console.log(`Runs system checks (Node, git, config) and`);
      console.log(`registry health (entries, paths, resolution).`);
      console.log(`Exit 0 unless registry has error-severity issues.\n`);
      return;
    }
    // For other commands, fall through to the main help
  }

  if (cmd === 'init') {
    // Reject URL-like positional arguments early with a clear usage message.
    const { isUrlLikeArg } = await import('./commands/init.js');
    const positional = args.slice(1).find(a => !a.startsWith('-'));
    if (positional && isUrlLikeArg(positional)) {
      fatal(
        `"squad init" does not accept URL arguments.\n` +
        `  To register an existing squad, use "squad register --callsign <name> --path <dir>".\n` +
        `  To link to a remote team root, use "squad init --mode remote <team-repo-path>".`,
      );
      return;
    }

    // Registry-aware path: activated when any registry flag is present.
    const hasTargetDir = args.includes('--target-dir');
    const hasCallsign = args.includes('--callsign');
    const hasNoRegister = args.includes('--no-register');
    const hasRegistryPath = args.includes('--registry-path');
    const isRegistryAware = hasTargetDir || hasCallsign || hasNoRegister || hasRegistryPath;

    if (isRegistryAware) {
      const { runInit: runRegistryInit } = await import('./commands/init.js');
      const targetDirIdx = args.indexOf('--target-dir');
      const targetDir = (targetDirIdx !== -1 && args[targetDirIdx + 1]) ? args[targetDirIdx + 1] : undefined;
      const callsignIdx = args.indexOf('--callsign');
      const callsign = (callsignIdx !== -1 && args[callsignIdx + 1]) ? args[callsignIdx + 1] : undefined;
      const registryPathIdx = args.indexOf('--registry-path');
      const registryPath = (registryPathIdx !== -1 && args[registryPathIdx + 1]) ? args[registryPathIdx + 1] : undefined;
      try {
        const result = await runRegistryInit({ targetDir, callsign, noRegister: hasNoRegister, registryPath, cwd: process.cwd() });
        const ok = noColor ? 'OK' : `${GREEN}✔${RESET}`;
        if (result.registered) {
          console.log(`${ok} Initialized and registered: ${result.registered.callsign} → ${result.registered.path}`);
        } else if (result.reactivated) {
          console.log(`${ok} Reactivated: ${result.reactivated.callsign} → ${result.reactivated.path}`);
        } else {
          console.log(`${ok} Initialized squad (no registry entry written).`);
        }
      } catch (err) {
        const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
        console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
      return;
    }

    const modeIdx = args.indexOf('--mode');
    const mode = (modeIdx !== -1 && args[modeIdx + 1]) ? args[modeIdx + 1] : undefined;

    if (mode === 'remote') {
      const teamPath = args[modeIdx + 2];
      if (!teamPath) {
        fatal('Usage: squad init --mode remote <team-repo-path>');
      }
      const { writeRemoteConfig } = await import('./cli/commands/init-remote.js');
      const dest = process.cwd();
      writeRemoteConfig(dest, teamPath);
      await runInit(dest);
      return;
    }

    const sdkMod = hasGlobal ? await lazySquadSdk() : null;
    const dest = hasGlobal ? sdkMod!.resolveGlobalSquadPath() : process.cwd();
    const noWorkflows = args.includes('--no-workflows');
    const sdk = args.includes('--sdk');
    const roles = args.includes('--roles');
    const presetIdx = args.indexOf('--preset');
    const presetName = (presetIdx !== -1 && args[presetIdx + 1]) ? args[presetIdx + 1] : undefined;
    // Parse --state-backend flag for init
    const sbIdx = args.indexOf('--state-backend');
    const initStateBackend = (sbIdx !== -1 && args[sbIdx + 1]) ? args[sbIdx + 1] : undefined;
    // Global init: suppress workflows (no GitHub CI in ~/.config/squad/) and bootstrap personal squad
    runInit(dest, { includeWorkflows: !noWorkflows && !hasGlobal, sdk, roles, isGlobal: hasGlobal, stateBackend: initStateBackend }).then(async () => {
      if (presetName) {
        const { seedBuiltinPresets, applyPreset } = await import('@bradygaster/squad-sdk/presets');
        const { resolvePresetsDir, ensureSquadHome } = await import('@bradygaster/squad-sdk/resolution');
        const nodePath = await import('node:path');

        // Auto-initialize squad home + presets if they don't exist yet
        if (!resolvePresetsDir()) {
          console.log(`\n⚙️  No presets found — setting up squad home...`);
          ensureSquadHome();
          seedBuiltinPresets();
          console.log(`✅ Squad home initialized at ${ensureSquadHome()}`);
          console.log(`   Built-in presets ready. Run 'squad preset init --remote' to back with a GitHub repo.\n`);
        } else {
          seedBuiltinPresets();
        }

        const targetAgentsDir = nodePath.join(dest, '.squad', 'agents');
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
    }).catch(err => {
      fatal(err.message);
    });
    return;
  }

  if (cmd === 'upgrade') {
    const { runUpgrade, selfUpgradeCli } = await import('./cli/core/upgrade.js');
    const { migrateDirectory } = await import('./cli/core/migrate-directory.js');
    
    const migrateDir = args.includes('--migrate-directory');
    const selfUpgrade = args.includes('--self');
    const forceUpgrade = args.includes('--force');
    const insider = args.includes('--insider');
    const dest = hasGlobal ? (await lazySquadSdk()).resolveGlobalSquadPath() : getSquadStartDir();

    // Parse --state-backend for backend migration
    const sbIdx = args.indexOf('--state-backend');
    const upgradeStateBackend = (sbIdx !== -1 && args[sbIdx + 1]) ? args[sbIdx + 1] : undefined;
    
    // Warn when --insider is used without --self (it has no effect on project upgrades)
    if (insider && !selfUpgrade) {
      console.warn('⚠️ --insider only applies with --self (squad upgrade --self --insider). Ignoring.');
    }

    // Handle --migrate-directory flag
    if (migrateDir) {
      await migrateDirectory(dest);
      // Continue with regular upgrade after migration
    }
    
    // Handle --self: upgrade the CLI package itself
    if (selfUpgrade) {
      await selfUpgradeCli({ insider, force: forceUpgrade });
      console.log('✅ Upgraded. Please restart your terminal for changes to take effect.');
      return;
    }

    // Run upgrade
    await runUpgrade(dest, { 
      migrateDirectory: migrateDir,
      self: selfUpgrade,
      force: forceUpgrade
    });

    // Handle --state-backend: migrate backend after upgrade
    if (upgradeStateBackend) {
      const { migrateStateBackend } = await import('./cli/commands/migrate-backend.js');
      await migrateStateBackend(dest, upgradeStateBackend);
    } else {
      // Ensure hooks are installed for existing orphan/two-layer backends
      const { ensureHooksForBackend } = await import('./cli/commands/install-hooks.js');
      ensureHooksForBackend(dest);
    }
    
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
    const validBackends = ['local', 'orphan', 'two-layer', 'external'] as const;
    if (rawStateBackend && !(validBackends as readonly string[]).includes(rawStateBackend)) {
      console.error(`\u26a0\ufe0f Invalid --state-backend "${rawStateBackend}". Valid: ${validBackends.join(', ')}.`);
      process.exit(1);
    }
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
      '--interval', '--copilot-flags', '--agent-cmd', '--max-concurrent', '--timeout', '--board-project', '--auth-user',
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
    // --help
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`\n${BOLD}squad loop${RESET} — Prompt-driven continuous work loop\n`);
      console.log(`Usage: squad loop [options]\n`);
      console.log(`Reads loop.md and runs it as a continuous work loop.\n`);
      console.log(`Options:`);
      console.log(`  ${BOLD}--init${RESET}                Generate a boilerplate loop.md`);
      console.log(`  ${BOLD}--file <path>${RESET}         Path to loop file (default: loop.md)`);
      console.log(`  ${BOLD}--interval <min>${RESET}      Override loop interval in minutes`);
      console.log(`  ${BOLD}--timeout <min>${RESET}       Override max minutes per cycle`);
      console.log(`  ${BOLD}--copilot-flags "..."${RESET} Extra flags for Copilot CLI`);
      console.log(`  ${BOLD}--agent-cmd <cmd>${RESET}     Override the agent command`);
      console.log(`\nCapabilities (composable with the loop):`);
      console.log(`  ${BOLD}--self-pull${RESET}           git fetch/pull at round start`);
      console.log(`  ${BOLD}--monitor-email${RESET}       Scan email for actionable items`);
      console.log(`  ${BOLD}--monitor-teams${RESET}       Scan Teams for actionable messages`);
      console.log(`  ${BOLD}--decision-hygiene${RESET}    Auto-merge decision inbox`);
      console.log(`  ${BOLD}--retro${RESET}               Enforce retrospective checks`);
      console.log(`\nFrontmatter (in loop.md):`);
      console.log(`  configured: true     ${DIM}(required — confirms intentional setup)${RESET}`);
      console.log(`  interval: 10         ${DIM}(minutes between cycles)${RESET}`);
      console.log(`  timeout: 30          ${DIM}(max minutes per cycle)${RESET}`);
      console.log(`  description: "..."   ${DIM}(shown in status output)${RESET}`);
      console.log(`\nExamples:`);
      console.log(`  squad loop                          ${DIM}# run loop.md${RESET}`);
      console.log(`  squad loop --init                   ${DIM}# generate boilerplate${RESET}`);
      console.log(`  squad loop --file ops/loop.md       ${DIM}# custom loop file${RESET}`);
      console.log(`  squad loop --monitor-email          ${DIM}# with email monitoring${RESET}`);
      return;
    }

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

  if (cmd === 'hire') {
    const nameIdx = args.indexOf('--name');
    const name = (nameIdx !== -1 && args[nameIdx + 1]) ? args[nameIdx + 1] : undefined;
    const roleIdx = args.indexOf('--role');
    const role = (roleIdx !== -1 && args[roleIdx + 1]) ? args[roleIdx + 1] : undefined;
    console.log('👋 Squad hire — team creation wizard starting... (full implementation pending)');
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
    await runExport(getSquadStartDir(), outPath);
    return;
  }

  if (cmd === 'import') {
    const { runImport } = await import('./cli/commands/import.js');
    const importFile = args[1];
    if (!importFile) {
      fatal('Usage: squad import <file> [--force]');
    }
    const hasForce = args.includes('--force');
    await runImport(getSquadStartDir(), importFile, hasForce);
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
    const resolvedSquad = resolveSquadV2({ cwd: startDir, env: process.env });
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
    const resolvedForStart = resolveSquadV2({ cwd: getSquadStartDir(), env: process.env });
    if (!resolvedForStart) {
      fatal(
        'No squad found.\n' +
          '   Run "squad init" to set up a squad, or "squad register" to register an existing one.',
      );
      return;
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
    const { runRegister } = await import('./commands/register.js');
    const callsignIdx = args.indexOf('--callsign');
    const callsign = (callsignIdx !== -1 && args[callsignIdx + 1]) ? args[callsignIdx + 1]! : '';
    const pathIdx = args.indexOf('--path');
    const squadPath = (pathIdx !== -1 && args[pathIdx + 1]) ? args[pathIdx + 1]! : '';
    const registryPathIdx = args.indexOf('--registry-path');
    const registryPath = (registryPathIdx !== -1 && args[registryPathIdx + 1]) ? args[registryPathIdx + 1] : undefined;
    const installAgent = !args.includes('--no-install-agent');
    const homeIdx = args.indexOf('--home');
    const home = (homeIdx !== -1 && args[homeIdx + 1]) ? args[homeIdx + 1] : undefined;

    if (!callsign) {
      fatal(
        '--callsign is required\n' +
        'Try: squad register --callsign <name> --path <path>',
      );
      return;
    }
    const originIdx = args.indexOf('--origin');
    const originUrl = (originIdx !== -1 && args[originIdx + 1]) ? args[originIdx + 1] : undefined;
    const cloneArgIdx = args.indexOf('--clone');
    const clonePath = (cloneArgIdx !== -1 && args[cloneArgIdx + 1]) ? args[cloneArgIdx + 1] : undefined;

    try {
      const result = await runRegister({
        callsign,
        path: squadPath || undefined,
        registryPath,
        installAgent,
        home,
        origin: originUrl,
        clone: clonePath,
      });
      const ok = noColor ? 'OK' : `${GREEN}✓${RESET}`;
      switch (result.outcome) {
        case 'registered':
          console.log(`${ok} Registered: ${result.registered.callsign} → ${result.registered.path}`);
          break;
        case 'merged':
          console.log(`${ok} Updated: ${result.registered.callsign} → ${result.registered.path}`);
          break;
        default: {
          const _exhaustive: never = result.outcome;
          throw new Error(`Unexpected register outcome: ${_exhaustive}`);
        }
      }
      if (result.agentInstalledAt) {
        console.log(`Installed coordinator agent: ${result.agentInstalledAt}`);
      }
    } catch (err) {
      const prefix = noColor ? 'Error:' : `${RED}✗${RESET} Error:`;
      console.error(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
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
    // === System doctor ===
    const { doctorCommand } = await import('./cli/commands/doctor.js');
    console.log(noColor ? '=== System doctor ===' : `${BOLD}=== System doctor ===${RESET}`);
    await doctorCommand();

    // === Registry doctor ===
    const { runDoctor: runRegistryDoctor } = await import('./commands/doctor.js');
    const registryPathIdx = args.indexOf('--registry-path');
    const registryPath = (registryPathIdx !== -1 && args[registryPathIdx + 1]) ? args[registryPathIdx + 1] : undefined;
    console.log(noColor ? '\n=== Registry doctor ===' : `\n${BOLD}=== Registry doctor ===${RESET}`);
    const result = await runRegistryDoctor({ cwd: getSquadStartDir(), registryPath });

    for (const finding of result.findings) {
      let prefix: string;
      const sev = result.severity;
      switch (sev) {
        case 'error':
          prefix = noColor ? '[error]' : `${RED}[error]${RESET}`;
          break;
        case 'warn':
          prefix = noColor ? '[warn]' : `${YELLOW}[warn]${RESET}`;
          break;
        case 'info':
          prefix = noColor ? '[info]' : `${DIM}[info]${RESET}`;
          break;
        default: {
          const _exhaustive: never = sev;
          throw new Error(`Unexpected doctor severity: ${_exhaustive}`);
        }
      }
      console.log(`${prefix} ${finding}`);
    }

    if (result.severity === 'error') {
      process.exit(1);
    }
    return;
  }

  if (cmd === 'consult') {
    const showStatus = args.includes('--status');
    if (!showStatus) {
      // Resolution is the precondition for setup and dry-run modes.
      if (!resolveSquadV2({ cwd: getSquadStartDir(), env: process.env })) {
        fatal(
          'No squad found.\n' +
            '   Run "squad init" to set up a squad, or "squad register" to register an existing one.',
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
    if (!resolveSquadV2({ cwd: getSquadStartDir(), env: process.env })) {
      fatal(
        'No squad found.\n' +
          '   Run "squad init" to set up a squad, or "squad register" to register an existing one.',
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
    const resolvedForRc = resolveSquadV2({ cwd: rcStartDir, env: process.env });
    if (!resolvedForRc) {
      fatal(
        'No squad found.\n' +
          '   Run "squad init" to set up a squad, or "squad register" to register an existing one.',
      );
      return;
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
    const { writeRemoteConfig } = await import('./cli/commands/init-remote.js');
    const teamPath = args[1];
    if (!teamPath) {
      fatal('Usage: squad init-remote <team-repo-path>');
    }
    const dest = process.cwd();
    writeRemoteConfig(dest, teamPath);
    await runInit(dest);
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

  if (cmd === 'cast') {
    const { runCast } = await import('./cli/commands/cast.js');
    await runCast(getSquadStartDir());
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

  if (cmd === 'economy') {
    const { runEconomy } = await import('./cli/commands/economy.js');
    await runEconomy(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'config') {
    const { runConfig } = await import('./cli/commands/config.js');
    await runConfig(getSquadStartDir(), args.slice(1));
    return;
  }

  if (cmd === 'assign-to-copilot' || cmd === 'assign') {
    // Dispatch-level guard: consistent pattern with consult and link.
    const guardResult = resolveSquadV2({ cwd: getSquadStartDir(), env: process.env });
    if (!guardResult) {
      fatal(
        'No squad found.\n' +
          '   Run "squad register --callsign <name>" to register a squad first,\n' +
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




