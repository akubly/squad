/**
 * Registry-aware init command module.
 *
 * Scaffolds a .squad/ directory and optionally registers the squad in the
 * user registry. The scaffold operation is non-destructive: existing files
 * are preserved.
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
import { resolveRegistryFilePath } from './_registry-path.js';
import { getGitRoot } from '../lib/git-root.js';

export interface RunInitOpts {
  targetDir?: string;
  callsign?: string;
  noRegister?: boolean;
  registryPath?: string;
  cwd?: string;
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
 * - Creates the .squad/ directory structure without overwriting existing files.
 * - When `registryPath` or `callsign` is present and `noRegister` is not set,
 *   writes a registry entry using the user registry helpers.
 * - Derives the callsign from the target directory name when `callsign` is not
 *   explicitly provided.
 * - Reactivates an inactive entry with the same callsign instead of creating
 *   a duplicate.
 * - Throws on callsign collision when an active entry points to a different path.
 */
export async function runInit(opts?: RunInitOpts): Promise<RunInitResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const targetDir = opts?.targetDir ? path.resolve(cwd, opts.targetDir) : cwd;
  const squadDir = path.join(targetDir, '.squad');

  // Scaffold .squad/ non-destructively
  const dirs = [squadDir, path.join(squadDir, 'agents')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Skip registration when noRegister is set or no registry-aware flags provided
  const wantsRegistration = !opts?.noRegister && (opts?.registryPath != null || opts?.callsign != null);
  if (!wantsRegistration) {
    return {};
  }

  // Prefer the Git repository name as the default callsign when no explicit
  // callsign is given and the target directory IS the Git root. This ensures
  // the callsign reflects the repository name rather than an arbitrary path
  // segment. Uses the shared Git-root helper from lib/git-root.
  const gitRoot = getGitRoot(cwd);
  const callsignBase =
    opts?.callsign == null && gitRoot && normalisedPathKey(targetDir) === normalisedPathKey(gitRoot)
      ? gitRoot
      : targetDir;
  const callsign = opts?.callsign ?? path.basename(callsignBase);
  const registryFilePath = resolveRegistryFilePath({ explicit: opts?.registryPath });
  if (!registryFilePath) {
    return {};
  }

  const { registry } = loadRegistryFromDisk({ registryPath: opts?.registryPath });
  const existing = registry?.squads ?? [];

  // Check for callsign collision
  const sameCallsign = existing.find((e: RegistryEntry) => e.callsign === callsign);
  if (sameCallsign) {
    if (normalisedPathKey(sameCallsign.path) === normalisedPathKey(squadDir)) {
      // Same callsign, same path → reactivate
      return { reactivated: { callsign, path: squadDir } };
    }
    throw new Error(
      `Callsign "${callsign}" is already registered at "${sameCallsign.path}". ` +
      `Use a different callsign with --callsign or update the existing entry.`,
    );
  }

  // Check for path collision via clones
  for (const entry of existing) {
    for (const clone of entry.clones ?? []) {
      try {
        if (clonesMatch(targetDir, clone)) {
          throw new Error(
            `Path "${targetDir}" matches an existing clone entry for squad "${entry.callsign ?? entry.path}". ` +
            `Use "squad register" to update that entry.`,
          );
        }
      } catch (err) {
        // Re-throw collision errors; swallow invalid-clone-entry errors from clonesMatch
        if (err instanceof Error && err.message.startsWith('Path "')) {
          throw err;
        }
      }
    }
  }

  const validated = upsertEntry({ callsign, path: squadDir });
  const newRegistry = { version: 1 as const, squads: [...existing, validated] };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistry(registryFilePath, newRegistry);

  return { registered: { callsign, path: squadDir } };
}

