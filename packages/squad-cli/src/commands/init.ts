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
} from '@wifi-aware/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@wifi-aware/squad-sdk/registry';
import type { RegistryEntry } from '@wifi-aware/squad-sdk/registry';
import { ConfigurationError } from '@wifi-aware/squad-sdk/adapter/errors';
import { resolveRegistryFilePath } from './_registry-path.js';
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
 * Rejects URL schemes used for repository and remote references, plus SCP-style
 * git addresses like git@host:path.
 * Used by the CLI dispatch to surface a clear error instead of silently ignoring
 * URL-like positional arguments passed to `squad init`.
 */
export function isUrlLikeArg(arg: string): boolean {
  const trimmed = arg.trim();
  if (trimmed.length === 0) return false;

  const lower = trimmed.toLowerCase();
  const urlPrefixes = [
    'http://',
    'https://',
    'ssh://',
    'git://',
    'git+http://',
    'git+https://',
    'git+ssh://',
    'file://',
    '//',
  ];

  return urlPrefixes.some(prefix => lower.startsWith(prefix)) || /^[^@\s/:]+@[^:\s/]+:.+/.test(trimmed);
}

/**
 * Scaffold a .squad/ directory and optionally register the squad.
 *
 * Operation order:
 *   1. Check whether .squad/ already exists (symlinks are rejected; existing
 *      directories are accepted and skip scaffold creation).
 *   2. Run registry conflict guards before any filesystem write.
 *   3. Create the scaffold when .squad/ is absent.
 *   4. Write the registry entry (new registration or reactivation).
 *
 * Throws `ConfigurationError` (recoverable: false) on:
 *   - ERR_SQUAD_INIT_EXISTING_SCAFFOLD — .squad/ is a symbolic link
 *   - ERR_SQUAD_INIT_CALLSIGN_EXISTS   — callsign already active at a different path
 *   - ERR_SQUAD_INIT_CLONE_PATH_EXISTS — target dir already a registered clone
 *
 * Reactivates an inactive entry with the same callsign and path and returns a
 * result distinguishable from a new registration.
 */
export async function runInit(opts?: RunInitOpts): Promise<RunInitResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const targetDir = opts?.targetDir ? path.resolve(cwd, opts.targetDir) : cwd;
  const squadDir = path.join(targetDir, '.squad');

  // Step 1: Determine whether the scaffold already exists.
  // Symlinks are rejected (init will not write through one).
  // Existing directories are accepted; scaffold creation is skipped for them.
  const scaffoldState = resolveScaffoldState(squadDir, targetDir);

  const registryFilePath = opts?.noRegister
    ? null
    : resolveRegistryFilePath({ explicit: opts?.registryPath });
  const wantsRegistration = registryFilePath != null;

  // Step 2: Registry conflict guards (callsign + clone-path). These run before
  // any filesystem write so that no files are created when a conflict is detected.
  let pendingResult: RunInitResult | null = null;
  let pendingReactivate: { entry: RegistryEntry; callsign: string; registryFilePath: string; existing: RegistryEntry[] } | null = null;
  let pendingWrite: { callsign: string; registryFilePath: string; existing: RegistryEntry[] } | null = null;

  if (wantsRegistration) {
    const callsign = opts?.callsign ?? path.basename(targetDir);
    const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
    const existing = registry?.squads ?? [];

    const sameCallsign = existing.find((e: RegistryEntry) => e.callsign === callsign);
    if (sameCallsign) {
      if (normalisedPathKey(sameCallsign.path) === normalisedPathKey(squadDir)) {
        if (sameCallsign.status === 'inactive') {
          // Reactivate: flip status to active and preserve all other fields.
          pendingReactivate = { entry: sameCallsign, callsign, registryFilePath, existing };
        }
        // Whether active or inactive at the same path, the result is reactivated
        // (idempotent for active entries; status-flipping for inactive ones).
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

  // Step 3: Create scaffold when absent. Skip when the directory already exists
  // with sentinel files — the existing files are left untouched.
  if (scaffoldState === 'absent') {
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
  }

  // Step 4: Write registry entry.
  if (pendingReactivate) {
    const { entry, callsign, registryFilePath: regPath, existing } = pendingReactivate;
    const reactivatedEntry: RegistryEntry = { ...entry, status: 'active' };
    const updatedSquads = existing.map(e =>
      e.callsign === callsign && normalisedPathKey(e.path) === normalisedPathKey(squadDir)
        ? reactivatedEntry
        : e,
    );
    fs.mkdirSync(path.dirname(regPath), { recursive: true });
    writeRegistry(regPath, { version: 1 as const, squads: updatedSquads });
    return { reactivated: { callsign, path: squadDir } };
  }

  if (pendingResult) {
    // Active entry at same path — idempotent, no write needed.
    return pendingResult;
  }

  if (pendingWrite) {
    const { callsign, registryFilePath: regPath, existing } = pendingWrite;
    const validated = upsertEntry({ callsign, path: squadDir });
    const newRegistry = { version: 1 as const, squads: [...existing, validated] };
    fs.mkdirSync(path.dirname(regPath), { recursive: true });
    writeRegistry(regPath, newRegistry);
    return { registered: { callsign, path: squadDir } };
  }

  return {};
}

/**
 * Determines whether the .squad/ scaffold directory is absent or already present.
 *
 * Returns:
 *   - `'absent'`  — .squad/ does not exist or exists as an empty directory;
 *                   scaffold creation should proceed.
 *   - `'present'` — .squad/ exists and contains at least one sentinel file;
 *                   scaffold creation should be skipped (files are not clobbered).
 *
 * Throws ERR_SQUAD_INIT_EXISTING_SCAFFOLD when .squad/ is a symbolic link —
 * init will not write through a symlink.
 */
function resolveScaffoldState(squadDir: string, targetDir: string): 'absent' | 'present' {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(squadDir);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return 'absent';
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new ConfigurationError(
      `ERR_SQUAD_INIT_EXISTING_SCAFFOLD: .squad/ already exists at ${targetDir}. ` +
      `squad init will not write through a symbolic link. Run squad doctor to inspect registration status, ` +
      `or choose a different --target-dir.`,
      { timestamp: new Date() },
    );
  }

  if (!stats.isDirectory()) {
    return 'absent';
  }

  const sentinels = ['team.md', 'routing.md', 'decisions.md', 'config.json'];
  const hasSentinel = sentinels.some(s => fs.existsSync(path.join(squadDir, s)));
  return hasSentinel ? 'present' : 'absent';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

