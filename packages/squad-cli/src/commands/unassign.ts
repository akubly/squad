/**
 * squad unassign command module.
 *
 * Removes the current repository binding from a shared squad registry entry.
 * Counterpart to squad assign: assign adds a clone path and origin, unassign
 * removes the matched clone path and refcounts origins against remaining clones.
 *
 * Demote-not-delete: when the last clone is removed the entry stays in the
 * registry with status 'inactive', keeping the callsign reserved for later
 * reactivation via squad assign.
 *
 * @module commands/unassign
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeRemoteUrl, normalisedPathKey, collectCwdRemoteUrls } from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { Registry, RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { ConfigurationError } from '@bradygaster/squad-sdk/adapter/errors';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getGitRoot as _libGetGitRoot } from '../lib/git-root.js';
import { findCloseMatch as _findCloseMatch } from '../lib/close-match.js';

// ============================================================
// Public API types
// ============================================================

export interface RunUnassignOpts {
  /** Explicit callsign — disambiguates when the target dir appears in multiple entries. */
  callsign?: string;
  /** Explicit registry file path; defaults via SQUAD_REGISTRY_PATH seam. */
  registryPath?: string;
  /** Working directory for path resolution (defaults to process.cwd()). */
  cwd?: string;
  /** Target directory to unassign (defaults to cwd). */
  targetDir?: string;
  /** Override copilot home for payload cleanup (unused in basic flow, reserved). */
  copilotHome?: string;
  /** Injectable environment — falls back to process.env for registry path resolution. */
  env?: Record<string, string | undefined>;
  /** Injectable seam: git root resolver. Production default returns targetDir. */
  getGitRoot?: (dir: string) => string | null;
  /** Injectable seam: remote URL collector for origin refcounting. */
  getRemoteUrls?: (dir: string) => string[];
  /** @internal Injectable seam: override registry write. For testing failure paths only. */
  _writeRegistryFn?: (filePath: string, registry: Registry) => void;
}

export interface RunUnassignResult {
  /** Target dir was not present in any registry entry's clones[]. */
  alreadyUnassigned?: boolean;
  /** Target dir is the squad host directory — no mutation performed. */
  hostPathGuard?: boolean;
  /** Last clone was removed and entry was demoted to inactive. */
  demoted?: boolean;
  /** Non-fatal warnings to surface to the user. */
  warnings?: string[];
}

// ============================================================
// Error types
// ============================================================

export type UnassignErrorCode =
  | 'ERR_UNASSIGN_NO_REGISTRY'
  | 'ERR_UNASSIGN_UNKNOWN_CALLSIGN'
  | 'ERR_UNASSIGN_AMBIGUOUS';

/** Structured error thrown by runUnassign — carries a typed code and exit code. */
export class UnassignError extends ConfigurationError {
  public readonly code: UnassignErrorCode;
  public readonly exitCode: number;

  constructor(code: UnassignErrorCode, message: string, exitCode = 1) {
    super(`${code}: ${message}`, { timestamp: new Date() });
    this.name = 'UnassignError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Compute the updated origins[] for an entry after removing one clone.
 *
 * An origin is kept when at least one remaining clone still reports it.
 * An origin is removed when no remaining clone reports it.
 * Origins not contributed by any clone (e.g. manually added) are preserved.
 *
 * Algorithm:
 *  1. Collect normalized URLs from all remaining clones.
 *  2. Collect normalized URLs from the removed clone.
 *  3. For each existing origin: keep it if it's in remaining-clone URLs,
 *     or if it wasn't contributed by the removed clone at all.
 */
function _refcountOrigins(
  existingOrigins: string[],
  remainingClones: string[],
  removedCloneUrls: string[],
  getRemoteUrls: (dir: string) => string[],
): string[] {
  const removedNormalized = new Set(removedCloneUrls.map(normalizeRemoteUrl));
  const remainingNormalized = new Set(
    remainingClones.flatMap(c => getRemoteUrls(c).map(normalizeRemoteUrl)),
  );

  return existingOrigins.filter(origin => {
    const normalized = normalizeRemoteUrl(origin);
    if (remainingNormalized.has(normalized)) return true;
    if (!removedNormalized.has(normalized)) return true;
    return false;
  });
}

// ============================================================
// Main command
// ============================================================

/**
 * Remove the target directory's binding from the matching registry entry.
 *
 * Lookup order:
 *  - When --callsign is supplied, resolve that entry directly.
 *  - When omitted, scan all entries whose clones[] contains the target git root.
 *    - 0 matches → alreadyUnassigned
 *    - 1 match   → proceed
 *    - 2+ matches → throw ERR_UNASSIGN_AMBIGUOUS (exit code 3)
 *
 * After removing the clone path, refcount origins against remaining clones.
 * If removing the last clone, demote entry to status='inactive'.
 * If the target is the squad host directory, return hostPathGuard without mutating.
 */
export async function runUnassign(opts: RunUnassignOpts): Promise<RunUnassignResult> {
  const cwd = opts.cwd ?? process.cwd();
  const resolvedTargetDir = opts.targetDir ? path.resolve(cwd, opts.targetDir) : cwd;
  const writeRegistryFn = opts._writeRegistryFn ?? writeRegistry;
  const getGitRoot = opts.getGitRoot ?? _defaultGetGitRoot;
  const getRemoteUrls = opts.getRemoteUrls ?? _defaultGetRemoteUrls;

  const registryFilePath = resolveRegistryFilePath({
    explicit: opts.registryPath,
    env: opts.env as Record<string, string> | undefined,
  });

  if (!registryFilePath) {
    throw new UnassignError(
      'ERR_UNASSIGN_NO_REGISTRY',
      'Cannot locate registry. Set SQUAD_REGISTRY_PATH or run squad init first.',
    );
  }

  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  const existingSquads: RegistryEntry[] = registry?.squads ?? [];

  // Resolve the git root for the target directory.
  const gitRoot = getGitRoot(resolvedTargetDir);
  const targetKey = gitRoot ? normalisedPathKey(gitRoot) : normalisedPathKey(resolvedTargetDir);
  const effectiveTarget = gitRoot ?? resolvedTargetDir;

  // Host-path guard: if the target is the squad host directory itself, refuse.
  for (const entry of existingSquads) {
    // The host dir is path.dirname(entry.path) since entry.path points at .squad/
    const hostParentDir = path.dirname(entry.path);
    if (normalisedPathKey(effectiveTarget) === normalisedPathKey(hostParentDir)) {
      console.log(
        `ℹ Running from squad host directory. ` +
        `Use a separate purge command to de-register the squad host itself.`,
      );
      return { hostPathGuard: true };
    }
  }

  let matchedEntry: RegistryEntry | null = null;

  if (opts.callsign) {
    // Explicit callsign lookup.
    const entry = existingSquads.find(s => s.callsign === opts.callsign);
    if (!entry) {
      const allCallsigns = existingSquads
        .map(s => s.callsign)
        .filter((c): c is string => typeof c === 'string');
      const suggestion = _findCloseMatch(opts.callsign, allCallsigns);
      throw new UnassignError(
        'ERR_UNASSIGN_UNKNOWN_CALLSIGN',
        `No squad registered as "${opts.callsign}".` +
          (suggestion ? `\n  Did you mean "${suggestion}"?` : '') +
          '\n  Run "squad list" to see registered squads.',
      );
    }
    // Check if the target is in this entry's clones[].
    const clones = entry.clones ?? [];
    if (!clones.some(c => normalisedPathKey(c) === targetKey)) {
      return { alreadyUnassigned: true };
    }
    matchedEntry = entry;
  } else {
    // Scan all entries for the target clone.
    const matches = existingSquads.filter(e =>
      (e.clones ?? []).some(c => normalisedPathKey(c) === targetKey),
    );

    if (matches.length === 0) {
      return { alreadyUnassigned: true };
    }

    if (matches.length > 1) {
      const names = matches.map(e => `"${e.callsign ?? e.path}"`).join(', ');
      throw new UnassignError(
        'ERR_UNASSIGN_AMBIGUOUS',
        `The target directory appears in multiple squad entries: ${names}.\n` +
          '  Pass --callsign <name> to specify which entry to unassign from.',
        3,
      );
    }

    matchedEntry = matches[0]!;
  }

  // Remove the matched clone path.
  const existingClones = matchedEntry.clones ?? [];
  const remainingClones = existingClones.filter(c => normalisedPathKey(c) !== targetKey);
  const removedCloneUrls = getRemoteUrls(effectiveTarget);

  // Refcount origins against remaining clones.
  const updatedOrigins = _refcountOrigins(
    matchedEntry.origins ?? [],
    remainingClones,
    removedCloneUrls,
    getRemoteUrls,
  );

  const demoted = remainingClones.length === 0;

  // TODO(piece-15): wire payload cleanup helper when added.
  // Spec: "When a consumer binding is removed, remove the user-scoped payload for that
  // callsign through the existing payload cleanup helper." No such helper exists in
  // packages/ yet; add it here once available.

  const updatedEntry: RegistryEntry = {
    ...matchedEntry,
    clones: remainingClones,
    origins: updatedOrigins,
    ...(demoted ? { status: 'inactive' as const } : {}),
  };

  const newRegistry: Registry = {
    version: registry?.version ?? 1,
    squads: existingSquads.map(s => s.callsign === matchedEntry!.callsign ? updatedEntry : s),
  };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistryFn(registryFilePath, newRegistry);

  if (demoted) {
    console.log(
      `✓ Unassigned: "${matchedEntry.callsign}" is now inactive. ` +
        `Run "squad assign ${matchedEntry.callsign}" to reactivate.`,
    );
  } else {
    console.log(`✓ Unassigned: ${effectiveTarget} removed from "${matchedEntry.callsign}"`);
  }

  return { demoted };
}

// ============================================================
// Default injectable seams
// ============================================================

function _defaultGetGitRoot(dir: string): string | null {
  return _libGetGitRoot(dir);
}

function _defaultGetRemoteUrls(dir: string): string[] {
  return collectCwdRemoteUrls(dir);
}
