/**
 * Registry register command module.
 *
 * Registers an existing .squad/ path in the user registry. Does not copy
 * agent templates or merge clone/origin aliases; those are handled by
 * later pieces.
 *
 * @module commands/register
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  upsertEntry,
  normalisedPathKey,
} from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { resolveRegistryFilePath } from './_registry-path.js';

export interface RunRegisterOpts {
  callsign: string;
  path: string;
  registryPath?: string;
  cwd?: string;
}

export type RunRegisterOutcome = 'registered' | 'reactivated' | 'already-active';

export interface RunRegisterResult {
  registered: { callsign: string; path: string };
  outcome: RunRegisterOutcome;
}

/**
 * Register an existing .squad/ path in the user registry.
 *
 * - Throws when `callsign` or `path` is missing.
 * - Throws when the resolved `.squad/` directory does not exist on disk.
 * - Accepts the project root or the .squad/ directory itself as `path`.
 * - Preserves unknown fields in existing registry entries during write.
 * - Differentiates callsign collision, same-path re-registration, and
 *   inactive reactivation via the `outcome` field.
 */
export async function runRegister(opts: RunRegisterOpts): Promise<RunRegisterResult> {
  if (!opts.callsign) {
    throw new Error(
      '--callsign is required\n' +
      'Try: squad register --callsign <name> --path <path>',
    );
  }
  if (!opts.path) {
    throw new Error(
      '--path is required\n' +
      'Try: squad register --callsign <name> --path <path>',
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const resolved = path.isAbsolute(opts.path) ? opts.path : path.resolve(cwd, opts.path);
  const squadDir = resolved.endsWith('.squad') ? resolved : path.join(resolved, '.squad');

  // Verify .squad/ exists on disk before registering
  if (!fs.existsSync(squadDir)) {
    throw new Error(
      `No .squad/ directory found at "${squadDir}".\n` +
      'Run "squad init" first to create the project scaffold, then register it.',
    );
  }

  const registryFilePath = resolveRegistryFilePath({ explicit: opts.registryPath });
  if (!registryFilePath) {
    throw new Error(
      'Cannot resolve registry path. Set SQUAD_REGISTRY_PATH or initialize a squad home.',
    );
  }

  const { registry } = loadRegistryFromDisk({ registryPath: opts.registryPath });
  const existing: RegistryEntry[] = registry?.squads ?? [];

  // Check for existing entries with the same callsign or path
  const normalizedNew = normalisedPathKey(squadDir);
  const sameCallsign = existing.find((e) => e.callsign === opts.callsign);
  const samePath = existing.find((e) => normalisedPathKey(e.path) === normalizedNew);

  // Callsign collision: active entry at different path
  if (sameCallsign && normalisedPathKey(sameCallsign.path) !== normalizedNew) {
    throw new Error(
      `Callsign '${opts.callsign}' is already active at ${sameCallsign.path}`,
    );
  }

  // Determine outcome
  let outcome: RunRegisterOutcome = 'registered';
  if (sameCallsign && samePath) {
    outcome = 'already-active';
  } else if (samePath) {
    outcome = 'reactivated';
  }

  const validated = upsertEntry({ callsign: opts.callsign, path: squadDir });
  const filtered = existing.filter(
    (e) => e.callsign !== opts.callsign && normalisedPathKey(e.path) !== normalizedNew,
  );

  const newRegistry = { version: 1 as const, squads: [...filtered, validated] };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistry(registryFilePath, newRegistry);

  return { registered: { callsign: opts.callsign, path: squadDir }, outcome };
}
