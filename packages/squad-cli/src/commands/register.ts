/**
 * Registry register command module.
 *
 * Registers an existing .squad/ path in the user registry. After a successful
 * registry write, installs the canonical coordinator agent file at
 * <home>/.copilot/agents/squad.agent.md so the squad is discoverable from any
 * clone on the machine. The install step is best-effort and does not affect the
 * registry outcome.
 *
 * @module commands/register
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  upsertEntry,
  normalisedPathKey,
} from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getTemplatesDir } from '../cli/core/templates.js';
import { getPackageVersion, stampVersion } from '../cli/core/version.js';

export interface RunRegisterOpts {
  callsign: string;
  path: string;
  registryPath?: string;
  cwd?: string;
  installAgent?: boolean;   // defaults to true
  home?: string;             // override seam for tests; defaults to os.homedir()
  templatesDir?: string;    // override seam for tests; defaults to getTemplatesDir()
}

export type RunRegisterOutcome = 'registered' | 'reactivated' | 'already-active';

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
 * Register an existing .squad/ path in the user registry.
 *
 * - Throws when `callsign` or `path` is missing.
 * - Throws when the resolved `.squad/` directory does not exist on disk.
 * - Accepts the project root or the .squad/ directory itself as `path`.
 * - Preserves unknown fields in existing registry entries during write.
 * - Differentiates callsign collision, same-path re-registration, and
 *   inactive reactivation via the `outcome` field.
 * - When `installAgent` is not false, copies the coordinator agent template to
 *   `<home>/.copilot/agents/squad.agent.md` after a successful registry write.
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

  if (opts.installAgent !== false) {
    const home = opts.home ?? os.homedir();
    const agentInstalledAt = installCoordinatorAgent(home, opts.templatesDir);
    return { registered: { callsign: opts.callsign, path: squadDir }, outcome, agentInstalledAt };
  }

  return { registered: { callsign: opts.callsign, path: squadDir }, outcome };
}

