/**
 * assign-to-copilot command module.
 *
 * Binds the current project to a registered squad and installs the
 * Copilot-facing payload files. Resolution is the precondition: no registry
 * mutation, no payload install, and no clone work happens until resolveSquad()
 * succeeds for the target callsign or inferred context.
 *
 * @module commands/assign
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSquad, upsertEntry } from '@bradygaster/squad-sdk';
import type { ResolvedSquad } from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getTemplatesDir } from '../cli/core/templates.js';
import { getPackageVersion, stampVersion } from '../cli/core/version.js';
import { fatal } from '../cli/core/errors.js';

export interface RunAssignOpts {
  /** Project directory — the consumer repo being assigned. */
  cwd: string;
  /** Environment seam (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Explicit callsign to target; falls back to registry inference if omitted. */
  callsign?: string;
  /** Explicit registry file path; defaults via SQUAD_REGISTRY_PATH seam. */
  registryPath?: string;
  /** Dry-run: report what would be done without writing. */
  dryRun?: boolean;
  /** Override home dir for agent install (test seam). */
  home?: string;
  /** Skip coordinator agent install. */
  noInstallAgent?: boolean;
  /**
   * Pre-resolved squad result threaded from the dispatch-level guard.
   * When provided the internal resolver call is skipped, ensuring guard and
   * runner operate on the same resolution context.
   */
  resolved?: ResolvedSquad;
}

/**
 * Run the assign-to-copilot command.
 *
 * Resolves the target squad first, then registers the current directory as a
 * clone of that squad and installs the coordinator agent file. Idempotent:
 * if the current directory is already a registered clone the command succeeds
 * without writing duplicate entries.
 */
export async function runAssignToCopilot(opts: RunAssignOpts): Promise<void> {
  // Validate paths before any file-write use (RETRO: path traversal guard).
  if (!path.isAbsolute(opts.cwd)) {
    fatal(`cwd must be an absolute path, got: "${opts.cwd}"`);
    return;
  }
  if (opts.home !== undefined && (!path.isAbsolute(opts.home) || opts.home.replace(/\\/g, '/').split('/').includes('..'))) {
    fatal(`--home must be an absolute path without ".." traversal, got: "${opts.home}"`);
    return;
  }

  const env = opts.env ?? process.env;
  const registryPath = opts.registryPath ?? (env['SQUAD_REGISTRY_PATH'] as string | undefined);

  // Use the pre-resolved result from the dispatch guard when available.
  // Falling back to an internal resolve keeps the function usable directly
  // from tests that do not go through the CLI dispatch layer.
  const resolved = opts.resolved ?? resolveSquad({
    cwd: opts.cwd,
    env,
    callsign: opts.callsign,
    registryPath,
  });

  if (resolved === null) {
    fatal(
      'No squad found.\n' +
        '   Run "squad init --callsign <name>" to create a new squad host,\n' +
        '   or pass --callsign to specify the target squad.',
    );
    return;
  }

  // Explicit callsign takes precedence; fall back to what the resolver inferred.
  const targetCallsign = opts.callsign ?? resolved.callsign;
  if (!targetCallsign) {
    fatal(
      'Could not determine squad callsign from resolution result.\n' +
        '   Pass --callsign to specify the target squad.',
    );
    return;
  }

  if (opts.dryRun) {
    console.log('📋 Dry-run: squad assign-to-copilot would:');
    console.log(`   1. Register ${opts.cwd} as a clone of "${targetCallsign}" (${resolved.path})`);
    if (!opts.noInstallAgent) {
      const home = opts.home ?? os.homedir();
      console.log(`   2. Install coordinator agent → ${path.join(home, '.copilot', 'agents', 'squad.agent.md')}`);
    }
    return;
  }

  // --- Side effects begin only after successful resolution ---

  // Register the current directory as a clone in the resolved squad's registry entry.
  const registryFilePath = resolveRegistryFilePath({ explicit: registryPath, env: env as Record<string, string> });
  if (!registryFilePath) {
    fatal('Cannot locate registry file. Set SQUAD_REGISTRY_PATH or register a squad first.');
    return;
  }

  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  if (!registry) {
    fatal('Registry file is empty or unreadable. Check SQUAD_REGISTRY_PATH.');
    return;
  }

  const existing = registry.squads.find(s => s.callsign === targetCallsign);
  if (!existing) {
    fatal(`Squad "${targetCallsign}" not found in registry. It may have been removed or renamed.`);
    return;
  }

  const normalizedCwd = path.normalize(opts.cwd);
  const alreadyClone = (existing.clones ?? []).some(
    c => path.normalize(c) === normalizedCwd,
  );

  if (!alreadyClone) {
    const updated = upsertEntry({
      callsign: targetCallsign,
      path: existing.path,
      clones: [...(existing.clones ?? []), normalizedCwd],
      origins: existing.origins ?? [],
    });
    const filtered = registry.squads.filter(s => s.callsign !== targetCallsign);
    writeRegistry(registryFilePath, { version: registry.version, squads: [...filtered, updated] });
    console.log(`✅ Assigned: ${normalizedCwd} → "${targetCallsign}" (${resolved.path})`);
  } else {
    console.log(`ℹ️  Already assigned: ${normalizedCwd} → "${targetCallsign}" (${resolved.path})`);
  }

  // Install coordinator agent (best-effort, does not affect assignment outcome).
  if (!opts.noInstallAgent) {
    const home = opts.home ?? os.homedir();
    _installCoordinatorAgent(home);
  }
}

/**
 * Best-effort coordinator agent install. Silently warns on failure.
 */
function _installCoordinatorAgent(home: string): void {
  const targetDir = path.join(home, '.copilot', 'agents');
  const targetPath = path.join(targetDir, 'squad.agent.md');
  try {
    const resolvedTemplatesDir = getTemplatesDir();
    const primaryCandidate = path.join(resolvedTemplatesDir, 'squad.agent.md');
    const fallbackCandidate = path.join(resolvedTemplatesDir, 'squad.agent.md.template');
    const templatePath = fs.existsSync(primaryCandidate) ? primaryCandidate : fallbackCandidate;
    if (!fs.existsSync(templatePath)) return;
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) fs.unlinkSync(targetPath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    fs.copyFileSync(templatePath, targetPath);
    stampVersion(targetPath, getPackageVersion());
  } catch (e: unknown) {
    console.warn(`⚠️  Could not install coordinator agent at ${targetPath}: ${(e as Error).message}`);
  }
}
