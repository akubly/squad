/**
 * Registry register command module.
 *
 * Registers an existing .squad/ path in the user registry. When a callsign is
 * already registered at the same squad path, registration merges the current
 * Git clone root and repository remote URLs into the existing entry rather than
 * creating a duplicate. After a successful registry write, installs the
 * canonical coordinator agent file at <home>/.copilot/agents/squad.agent.md so
 * the squad is discoverable from any clone on the machine. The install step is
 * best-effort and does not affect the registry outcome.
 *
 * @module commands/register
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  upsertEntry,
  normalisedPathKey,
  collectCwdRemoteUrls,
  normalizeRemoteUrl,
} from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getTemplatesDir } from '../cli/core/templates.js';
import { getPackageVersion, stampVersion } from '../cli/core/version.js';
import { getGitRoot } from '../lib/git-root.js';

export interface RunRegisterOpts {
  callsign: string;
  path?: string;             // omit to merge into an existing entry or infer from Git root
  registryPath?: string;
  cwd?: string;
  installAgent?: boolean;    // defaults to true
  home?: string;             // override seam for tests; defaults to os.homedir()
  templatesDir?: string;     // override seam for tests; defaults to getTemplatesDir()
  origin?: string;           // explicit --origin append: add URL to existing entry
  clone?: string;            // explicit --clone append: add path to existing entry
}

export type RunRegisterOutcome = 'registered' | 'reactivated' | 'already-active' | 'merged';

export interface RunRegisterResult {
  registered: { callsign: string; path: string };
  outcome: RunRegisterOutcome;
  agentInstalledAt?: string;
}

/**
 * Installs the coordinator agent file into the user-global Copilot agents directory.
 * Sources from the canonical template (tries squad.agent.md, falls back to
 * squad.agent.md.template for forward compatibility).
 * Returns the installed target path on success, or undefined on failure.
 * Fails silently with a console.warn — the registry write is never rolled back.
 */
function installCoordinatorAgent(home: string, templatesDir?: string): string | undefined {
  const targetDir = path.join(home, '.copilot', 'agents');
  const targetPath = path.join(targetDir, 'squad.agent.md');
  try {
    const resolvedTemplatesDir = templatesDir ?? getTemplatesDir();
    // Try the unsuffixed canonical path first (forward-compatible with future pieces).
    // Fall back to the .template suffix used by the current init/upgrade pipeline.
    const primaryCandidate = path.join(resolvedTemplatesDir, 'squad.agent.md');
    const fallbackCandidate = path.join(resolvedTemplatesDir, 'squad.agent.md.template');
    const templatePath = fs.existsSync(primaryCandidate) ? primaryCandidate : fallbackCandidate;

    fs.mkdirSync(targetDir, { recursive: true });

    // Remove any pre-existing symlink at the target so the copy lands at the
    // intended path rather than being forwarded through to the symlink's target.
    try {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(targetPath);
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    fs.copyFileSync(templatePath, targetPath);
    stampVersion(targetPath, getPackageVersion());
    return targetPath;
  } catch (err) {
    console.warn(
      `Warning: could not install coordinator agent at ${targetPath}: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * Merge newly discovered clone and origin data into an existing registry entry.
 * Preserves all existing data; only appends items not already present.
 */
function mergeGitContext(
  entry: RegistryEntry,
  currentClone: string | null,
  remoteUrls: string[],
): RegistryEntry {
  const updated: RegistryEntry = { ...entry };

  if (currentClone) {
    const existingClones = updated.clones ?? [];
    const cloneAlreadyPresent = existingClones.some(
      (c) => normalisedPathKey(c) === normalisedPathKey(currentClone),
    );
    if (!cloneAlreadyPresent) {
      updated.clones = [...existingClones, currentClone];
    }
  }

  if (remoteUrls.length > 0) {
    const existingOrigins = updated.origins ?? [];
    const existingCanonicals = new Set(existingOrigins.map(normalizeRemoteUrl));
    const newOrigins = remoteUrls.filter((url) => !existingCanonicals.has(normalizeRemoteUrl(url)));
    if (newOrigins.length > 0) {
      updated.origins = [...existingOrigins, ...newOrigins];
    }
  }

  return updated;
}

/**
 * Infer the squad path from the Git root when no --path is given and the
 * callsign is not already registered. Preference order:
 *   1. <gitRoot>/<callsign>/.squad when it exists (multi-squad host)
 *   2. <gitRoot>/.squad when it exists (single-squad checkout)
 *   3. Throw with both tried paths named.
 */
function inferSquadDir(callsign: string, gitRoot: string): string {
  const callsignSuffixedPath = path.join(gitRoot, callsign, '.squad');
  const rootSquadPath = path.join(gitRoot, '.squad');
  const callsignSuffixedExists = fs.existsSync(callsignSuffixedPath);
  const rootSquadExists = fs.existsSync(rootSquadPath);

  if (!callsignSuffixedExists && !rootSquadExists) {
    throw new Error(
      `Cannot infer squad path for callsign '${callsign}'.\n` +
      `Tried: "${callsignSuffixedPath}" and "${rootSquadPath}".\n` +
      'Pass --path to register a specific location.',
    );
  }

  // Callsign-suffixed wins when both exist (more specific).
  return callsignSuffixedExists ? callsignSuffixedPath : rootSquadPath;
}

/**
 * Register an existing .squad/ path in the user registry.
 *
 * Supported modes:
 *
 * - callsign + path (no existing entry): Create a new entry. Populate
 *   clones[] and origins[] from the current Git context when available.
 * - callsign + path (existing entry at same path): Merge current Git context
 *   into the existing entry. Does not create a duplicate.
 * - callsign + path (existing entry at different path): Throw a path-conflict
 *   error. Preserve the existing registry entry.
 * - callsign only (existing entry): Merge current Git context into the
 *   existing entry using the entry's stored path.
 * - callsign only (no existing entry): Infer the squad path from the current
 *   Git root when a .squad/ directory exists, then create a new entry.
 * - callsign + origin: Append a remote URL to an existing entry (unknown
 *   callsigns are an error).
 * - callsign + clone: Append a clone path to an existing entry (unknown
 *   callsigns are an error).
 */
export async function runRegister(opts: RunRegisterOpts): Promise<RunRegisterResult> {
  if (!opts.callsign) {
    throw new Error(
      '--callsign is required\n' +
      'Try: squad register --callsign <name> --path <path>',
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const registryFilePath = resolveRegistryFilePath({ explicit: opts.registryPath });
  if (!registryFilePath) {
    throw new Error(
      'Cannot resolve registry path. Set SQUAD_REGISTRY_PATH or initialize a squad home.',
    );
  }

  const { registry } = loadRegistryFromDisk({ registryPath: opts.registryPath });
  const existing: RegistryEntry[] = registry?.squads ?? [];

  // --- Explicit --origin append mode ---
  if (opts.origin !== undefined) {
    const entry = existing.find((e) => e.callsign === opts.callsign);
    if (!entry) {
      throw new Error(
        `Unknown callsign '${opts.callsign}'. Register the squad first before appending origins.\n` +
        'Try: squad register --callsign <name> --path <path>',
      );
    }
    const canonicalNew = normalizeRemoteUrl(opts.origin);
    const alreadyPresent = (entry.origins ?? []).some(
      (o) => normalizeRemoteUrl(o) === canonicalNew,
    );
    if (!alreadyPresent) {
      entry.origins = [...(entry.origins ?? []), opts.origin];
    }
    fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
    writeRegistry(registryFilePath, { version: 1 as const, squads: existing });
    return { registered: { callsign: opts.callsign, path: entry.path }, outcome: 'merged' };
  }

  // --- Explicit --clone append mode ---
  if (opts.clone !== undefined) {
    const entry = existing.find((e) => e.callsign === opts.callsign);
    if (!entry) {
      throw new Error(
        `Unknown callsign '${opts.callsign}'. Register the squad first before appending clones.\n` +
        'Try: squad register --callsign <name> --path <path>',
      );
    }
    const cloneAbs = path.isAbsolute(opts.clone) ? opts.clone : path.resolve(cwd, opts.clone);
    const normalizedNew = normalisedPathKey(cloneAbs);
    const alreadyPresent = (entry.clones ?? []).some(
      (c) => normalisedPathKey(c) === normalizedNew,
    );
    if (!alreadyPresent) {
      entry.clones = [...(entry.clones ?? []), cloneAbs];
    }
    fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
    writeRegistry(registryFilePath, { version: 1 as const, squads: existing });
    return { registered: { callsign: opts.callsign, path: entry.path }, outcome: 'merged' };
  }

  // --- Determine effective squad directory ---
  let squadDir: string;

  if (opts.path) {
    // Explicit path: resolve and normalize.
    const resolved = path.isAbsolute(opts.path) ? opts.path : path.resolve(cwd, opts.path);
    squadDir = resolved.endsWith('.squad') ? resolved : path.join(resolved, '.squad');
  } else {
    // No explicit path: use stored path from existing entry, or infer from Git root.
    const existingEntry = existing.find((e) => e.callsign === opts.callsign);
    if (existingEntry) {
      // Callsign already registered — merge into the existing entry using its stored path.
      squadDir = existingEntry.path;
    } else {
      // Unknown callsign — try to infer from Git root.
      const gitRoot = getGitRoot(cwd);
      if (!gitRoot) {
        throw new Error(
          `Unknown callsign '${opts.callsign}'. No existing registration found and no Git repository detected.\n` +
          'Pass --path to register a specific location.',
        );
      }
      squadDir = inferSquadDir(opts.callsign, gitRoot);
    }
  }

  // Verify .squad/ exists on disk for new registrations (merge skips this check).
  const existingEntryForCallsign = existing.find((e) => e.callsign === opts.callsign);
  const normalizedNew = normalisedPathKey(squadDir);
  const existingEntryForPath = existing.find((e) => normalisedPathKey(e.path) === normalizedNew);
  const isMerge =
    existingEntryForCallsign != null &&
    normalisedPathKey(existingEntryForCallsign.path) === normalizedNew;

  if (!isMerge && !fs.existsSync(squadDir)) {
    throw new Error(
      `No .squad/ directory found at "${squadDir}".\n` +
      'Run "squad init" first to create the project scaffold, then register it.',
    );
  }

  // --- Conflict detection ---

  // Same callsign at a different path: error.
  if (existingEntryForCallsign && !isMerge) {
    throw new Error(
      `Callsign '${opts.callsign}' is already registered at "${existingEntryForCallsign.path}".\n` +
      'Use a different callsign or use "squad register --callsign <other> --path <path>" for a new location.',
    );
  }

  // --- Collect current Git context ---
  const currentClone = getGitRoot(cwd);
  const remoteUrls = collectCwdRemoteUrls(cwd);

  // --- Merge path: same callsign + same path ---
  if (isMerge) {
    const merged = mergeGitContext(existingEntryForCallsign, currentClone, remoteUrls);
    const validated = upsertEntry(merged);
    const filtered = existing.filter((e) => e.callsign !== opts.callsign);
    const newRegistry = { version: 1 as const, squads: [...filtered, validated] };
    fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
    writeRegistry(registryFilePath, newRegistry);

    if (opts.installAgent !== false) {
      const home = opts.home ?? os.homedir();
      const agentInstalledAt = installCoordinatorAgent(home, opts.templatesDir);
      return {
        registered: { callsign: opts.callsign, path: squadDir },
        outcome: 'merged',
        agentInstalledAt,
      };
    }
    return { registered: { callsign: opts.callsign, path: squadDir }, outcome: 'merged' };
  }

  // --- New registration or reactivation ---
  const outcome: RunRegisterOutcome = existingEntryForPath ? 'reactivated' : 'registered';

  const validated = upsertEntry({
    callsign: opts.callsign,
    path: squadDir,
    clones: currentClone ? [currentClone] : undefined,
    origins: remoteUrls.length > 0 ? remoteUrls : undefined,
  });

  const filtered = existing.filter(
    (e) => e.callsign !== opts.callsign && normalisedPathKey(e.path) !== normalizedNew,
  );

  const newRegistry = { version: 1 as const, squads: [...filtered, validated] };
  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistry(registryFilePath, newRegistry);

  if (opts.installAgent !== false) {
    const home = opts.home ?? os.homedir();
    const agentInstalledAt = installCoordinatorAgent(home, opts.templatesDir);
    return { registered: { callsign: opts.callsign, path: squadDir }, outcome, agentInstalledAt };
  }
  return { registered: { callsign: opts.callsign, path: squadDir }, outcome };
}
