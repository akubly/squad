/**
 * Registry-aware init command module.
 *
 * Scaffolds a .squad/ directory and optionally registers the squad in the
 * user registry. The command validates for conflicts before writing any file
 * or registry entry.
 *
 * @module commands/init
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  upsertEntry,
  normalisedPathKey,
  clonesMatch,
} from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { ConfigurationError } from '@bradygaster/squad-sdk/adapter/errors';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getGitRoot } from '../lib/git-root.js';
import { runInit as scaffoldInit, type RunInitOptions as ScaffoldInitOptions } from '../cli/core/init.js';
import { writeRemoteConfig } from '../cli/commands/init-remote.js';

export interface RunInitOpts {
  targetDir?: string;
  callsign?: string;
  noRegister?: boolean;
  registryPath?: string;
  cwd?: string;
  includeWorkflows?: boolean;
  sdk?: boolean;
  roles?: boolean;
  isGlobal?: boolean;
  stateBackend?: string;
  remoteTeamPath?: string;
}

export interface RunInitResult {
  registered?: { callsign: string; path: string };
  reactivated?: { callsign: string; path: string };
}

/**
 * Returns true when the argument looks like a URL rather than a filesystem path.
 * Rejects http://, https://, git@, ssh://, and protocol-relative (//) strings.
 * Used by the CLI dispatch to surface a clear error instead of silently ignoring
 * URL-like positional arguments passed to `squad init`.
 */
export function isUrlLikeArg(arg: string): boolean {
  return (
    arg.startsWith('http://') ||
    arg.startsWith('https://') ||
    arg.startsWith('git@') ||
    arg.startsWith('ssh://') ||
    arg.startsWith('//')
  );
}

/**
 * Scaffold a .squad/ directory and optionally register the squad.
 *
 * Performs a fail-fast validation pass before writing any file or registry
 * entry. Throws `ConfigurationError` (recoverable: false) on:
 *   - ERR_SQUAD_INIT_EXISTING_SCAFFOLD — sentinel file already present in .squad/
 *   - ERR_SQUAD_INIT_CALLSIGN_EXISTS   — callsign already active at a different path
 *   - ERR_SQUAD_INIT_CLONE_PATH_EXISTS — target dir already a registered clone
 *
 * Reactivates an inactive entry with the same callsign and path instead of
 * creating a duplicate.
 */
export async function runInit(opts?: RunInitOpts): Promise<RunInitResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const targetDir = opts?.targetDir ? path.resolve(cwd, opts.targetDir) : cwd;
  const squadDir = path.join(targetDir, '.squad');

  // Step 1: Scaffold conflict guard — runs before any filesystem or registry write.
  checkScaffoldConflict(squadDir, targetDir);

  const registryFilePath = opts?.noRegister
    ? null
    : resolveRegistryFilePath({ explicit: opts?.registryPath });
  const wantsRegistration = registryFilePath != null;

  // Step 2: Registry conflict guards (callsign + clone-path). Run before scaffold creation
  // so that no files are written when a conflict is detected.
  let pendingResult: RunInitResult | null = null;
  let pendingWrite: { callsign: string; registryFilePath: string; existing: RegistryEntry[] } | null = null;

  if (wantsRegistration) {
    const gitRoot = getGitRoot(cwd);
    const callsignBase =
      opts?.callsign == null && gitRoot && normalisedPathKey(targetDir) === normalisedPathKey(gitRoot)
        ? gitRoot
        : targetDir;
    const callsign = opts?.callsign ?? path.basename(callsignBase);
    if (registryFilePath) {
      const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
      const existing = registry?.squads ?? [];

      const sameCallsign = existing.find((e: RegistryEntry) => e.callsign === callsign);
      if (sameCallsign) {
        if (normalisedPathKey(sameCallsign.path) === normalisedPathKey(squadDir)) {
          // Same callsign, same path — reactivate (no write needed).
          pendingResult = { reactivated: { callsign, path: squadDir } };
        } else {
          throw new ConfigurationError(
            `ERR_SQUAD_INIT_CALLSIGN_EXISTS: callsign "${callsign}" is already registered at ${sameCallsign.path}. ` +
            `Choose a different --callsign or target directory.`,
            { timestamp: new Date() },
          );
        }
      } else {
        // Clone-path conflict guard. Uses sentinel-bounded semantics of clonesMatch:
        // exact clone root and child paths match; sibling prefixes do not.
        for (const entry of existing) {
          for (const clone of entry.clones ?? []) {
            let matched = false;
            try {
              matched = clonesMatch(targetDir, clone);
            } catch {
              // Invalid clone entry (e.g. relative path) — not a valid match target; skip.
            }
            if (matched) {
              throw new ConfigurationError(
                `ERR_SQUAD_INIT_CLONE_PATH_EXISTS: this directory is already registered as a clone for callsign "${entry.callsign ?? entry.path}". ` +
                `Run squad doctor to inspect the registry, or choose a different directory.`,
                { timestamp: new Date() },
              );
            }
          }
        }
        pendingWrite = { callsign, registryFilePath, existing };
      }
    }
  }

  // Step 3: All checks passed — create scaffold directory structure.
  const scaffoldOptions: ScaffoldInitOptions = {};
  if (opts?.includeWorkflows !== undefined) scaffoldOptions.includeWorkflows = opts.includeWorkflows;
  if (opts?.sdk !== undefined) scaffoldOptions.sdk = opts.sdk;
  if (opts?.roles !== undefined) scaffoldOptions.roles = opts.roles;
  if (opts?.isGlobal !== undefined) scaffoldOptions.isGlobal = opts.isGlobal;
  if (opts?.stateBackend !== undefined) scaffoldOptions.stateBackend = opts.stateBackend;
  await scaffoldInit(targetDir, scaffoldOptions);

  if (opts?.remoteTeamPath) {
    writeRemoteConfig(targetDir, opts.remoteTeamPath);
  }

  // Step 4: Write registry entry when registration is requested and no conflict found.
  if (pendingResult) {
    return pendingResult;
  }
  if (pendingWrite) {
    const { callsign, registryFilePath, existing } = pendingWrite;
    const validated = upsertEntry({ callsign, path: squadDir });
    const newRegistry = { version: 1 as const, squads: [...existing, validated] };
    fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
    writeRegistry(registryFilePath, newRegistry);
    return { registered: { callsign, path: squadDir } };
  }

  return {};
}

/**
 * Throws ERR_SQUAD_INIT_EXISTING_SCAFFOLD when the target directory already
 * contains a squad scaffold sentinel file. Runs before any filesystem or
 * registry write.
 */
function checkScaffoldConflict(squadDir: string, targetDir: string): void {
  let squadDirStats: fs.Stats;
  try {
    squadDirStats = fs.lstatSync(squadDir);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (squadDirStats.isSymbolicLink()) {
    throw new ConfigurationError(
      `ERR_SQUAD_INIT_EXISTING_SCAFFOLD: .squad/ already exists at ${targetDir}. ` +
      `squad init will not write through a symbolic link. Run squad doctor to inspect registration status, ` +
      `or choose a different --target-dir.`,
      { timestamp: new Date() },
    );
  }

  if (!squadDirStats.isDirectory()) {
    return;
  }
  const sentinels = ['team.md', 'routing.md', 'decisions.md', 'config.json'];
  const hasSentinel = sentinels.some(s => fs.existsSync(path.join(squadDir, s)));
  if (hasSentinel) {
    throw new ConfigurationError(
      `ERR_SQUAD_INIT_EXISTING_SCAFFOLD: .squad/ already exists at ${targetDir}. ` +
      `squad init will not overwrite it. Run squad doctor to inspect registration status, ` +
      `or choose a different --target-dir.`,
      { timestamp: new Date() },
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

