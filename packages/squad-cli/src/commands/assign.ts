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
import { execFileSync as _assignExecFileSync } from 'node:child_process';
import { resolveSquad, upsertEntry, collectCwdRemoteUrls, normalizeRemoteUrl, clonesMatch, normalisedPathKey } from '@bradygaster/squad-sdk';
import type { ResolvedSquad } from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { Registry, RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { ConfigurationError } from '@bradygaster/squad-sdk/adapter/errors';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getTemplatesDir } from '../cli/core/templates.js';
import { getPackageVersion, stampVersion } from '../cli/core/version.js';
import { fatal } from '../cli/core/errors.js';
import { getGitRoot as _defaultGetGitRoot } from '../lib/git-root.js';

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

// ============================================================
// runAssign — squad assign command (piece 14)
// Binds a product clone to a registered squad by callsign, or
// clones a squad host first when given a URL and --clone-to.
// ============================================================

export type AssignKind = 'assigned' | 'alreadyAssigned' | 'reactivated' | 'noOp';

export interface SquadAssignResult {
  kind: AssignKind;
  callsign: string;
  hostPath: string;
  clonePath?: string;
  warnings: string[];
}

export interface SquadAssignOpts {
  /** First positional argument: callsign (warm path) or URL (cold-start with --clone-to). */
  callsignOrUrl?: string;
  /** --clone-to <path>: destination for cold-start clone. */
  cloneTo?: string;
  /** --callsign <name>: override the callsign derived from the URL in cold-start. */
  callsign?: string;
  /** --registry-path: alternate registry file. */
  registryPath?: string;
  /** --target-dir: product clone to bind (defaults to cwd). */
  targetDir?: string;
  /** Working directory for git and path operations (defaults to process.cwd()). */
  cwd?: string;
  /** Injectable seam: git clone. Production default uses git clone. */
  cloneCommand?: (url: string, dest: string) => Promise<void>;
  /** Injectable seam: git root resolver. Production default uses execFileSync git. */
  getGitRoot?: (dir: string) => string | null;
  /** Injectable seam: fetch remote URL collector. Production default uses git remote -v. */
  getRemoteUrls?: (dir: string) => string[];
}

function _isUrlArg(s: string): boolean {
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('git@') ||
    s.startsWith('ssh://') ||
    s.startsWith('//')
  );
}

function _deriveCallsignFromUrl(url: string): string {
  const clean = url.replace(/\/$/, '');
  const lastSlash = clean.lastIndexOf('/');
  const lastColon = clean.lastIndexOf(':');
  const seg = clean.slice(Math.max(lastSlash, lastColon) + 1);
  return seg.replace(/\.git$/i, '').toLowerCase();
}

function _findCloseMatch(query: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const lower = query.toLowerCase();
  const prefix = candidates.find(c => c.toLowerCase().startsWith(lower) || lower.startsWith(c.toLowerCase()));
  if (prefix) return prefix;
  function editDist(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = a[i - 1] === b[j - 1] ? row[j - 1]! : 1 + Math.min(prev, row[j]!, row[j - 1]!);
        row[j - 1] = prev;
        prev = cur;
      }
      row[b.length] = prev;
    }
    return row[b.length]!;
  }
  let best: { name: string; d: number } | null = null;
  for (const c of candidates) {
    const d = editDist(query, c);
    if (!best || d < best.d) best = { name: c, d };
  }
  const threshold = Math.max(3, Math.floor(query.length / 2));
  return best && best.d <= threshold ? best.name : null;
}

async function _defaultCloneCommand(url: string, dest: string): Promise<void> {
  _assignExecFileSync('git', ['clone', url, dest], { stdio: 'inherit' });
}

/**
 * Assign the target product clone to a registered squad.
 *
 * Warm path: resolves the callsign in the registry, validates the host,
 * applies guards in order, and appends the git root to clones[] and
 * normalized fetch remotes to origins[].
 *
 * Cold-start path: clones the squad host, verifies .squad/team.md,
 * creates or reactivates the registry entry, then binds the product clone.
 */
export async function runAssign(opts: SquadAssignOpts): Promise<SquadAssignResult> {
  const cwd = opts.cwd ?? process.cwd();
  const resolvedTargetDir = opts.targetDir ? path.resolve(cwd, opts.targetDir) : cwd;
  const gitRootFn = opts.getGitRoot ?? _defaultGetGitRoot;
  const remotesFn = opts.getRemoteUrls ?? collectCwdRemoteUrls;
  const cloneFn = opts.cloneCommand ?? _defaultCloneCommand;

  // Guard 1a: Missing argument.
  const rawArg = opts.callsignOrUrl?.trim() ?? '';
  if (!rawArg) {
    throw new ConfigurationError(
      'ERR_ASSIGN_MISSING_ARG: Provide a callsign or URL.\n' +
      '  squad assign <callsign>\n' +
      '  squad assign <url> --clone-to <path>',
      { timestamp: new Date() },
    );
  }

  // Cold-start path: explicit --clone-to triggers clone regardless of arg shape.
  if (opts.cloneTo !== undefined) {
    return _coldStart({ rawArg, opts, cwd, resolvedTargetDir, gitRootFn, remotesFn, cloneFn });
  }

  // URL without --clone-to: surface a teaching error.
  if (_isUrlArg(rawArg)) {
    throw new ConfigurationError(
      `ERR_ASSIGN_URL_WITHOUT_CLONE_TO: To assign from a URL, also pass --clone-to <path>.\n` +
      `  Example: squad assign ${rawArg} --clone-to ./squad-host\n` +
      `Or clone manually and use the callsign:\n` +
      `  git clone ${rawArg} ./squad-host && squad assign <callsign>`,
      { timestamp: new Date() },
    );
  }

  // Warm path.
  return _warmPath({ callsign: rawArg, opts, resolvedTargetDir, gitRootFn, remotesFn });
}

interface _WarmCtx {
  callsign: string;
  opts: SquadAssignOpts;
  resolvedTargetDir: string;
  gitRootFn: (dir: string) => string | null;
  remotesFn: (dir: string) => string[];
}

async function _warmPath(ctx: _WarmCtx): Promise<SquadAssignResult> {
  const { callsign, opts, resolvedTargetDir, gitRootFn, remotesFn } = ctx;
  const warnings: string[] = [];

  const registryFilePath = resolveRegistryFilePath({ explicit: opts.registryPath });
  if (!registryFilePath) {
    throw new ConfigurationError(
      'ERR_ASSIGN_NO_REGISTRY: Cannot locate registry. Set SQUAD_REGISTRY_PATH or run squad init first.',
      { timestamp: new Date() },
    );
  }

  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  const existingSquads: RegistryEntry[] = registry?.squads ?? [];

  // Guard 1b: Unknown callsign (case-sensitive).
  const entry = existingSquads.find(s => s.callsign === callsign);
  if (!entry) {
    const allCallsigns = existingSquads.map(s => s.callsign).filter((c): c is string => typeof c === 'string');
    const suggestion = _findCloseMatch(callsign, allCallsigns);
    throw new ConfigurationError(
      `ERR_ASSIGN_UNKNOWN_CALLSIGN: No squad registered as "${callsign}".` +
      (suggestion ? `\n  Did you mean "${suggestion}"?` : '') +
      '\n  Run "squad list" to see registered squads.',
      { timestamp: new Date() },
    );
  }

  // Guard 2: Host path exists and contains a squad host.
  const hostSquadDir = entry.path;
  if (!fs.existsSync(hostSquadDir)) {
    throw new ConfigurationError(
      `ERR_ASSIGN_HOST_PATH_MISSING: The squad host path "${hostSquadDir}" does not exist.\n` +
      '  Update the registry entry or re-run squad init to recreate the host.',
      { timestamp: new Date() },
    );
  }
  const teamMdPath = path.join(hostSquadDir, 'team.md');
  if (!fs.existsSync(teamMdPath)) {
    throw new ConfigurationError(
      `ERR_ASSIGN_HOST_PATH_MISSING: "${hostSquadDir}" does not contain team.md.\n` +
      '  The path may not be a valid squad host.',
      { timestamp: new Date() },
    );
  }

  // Guard 3: Host-path guard — assigning from the squad host itself is a no-op.
  const hostParentDir = path.dirname(hostSquadDir);
  if (normalisedPathKey(resolvedTargetDir) === normalisedPathKey(hostParentDir)) {
    return { kind: 'noOp', callsign, hostPath: hostSquadDir, warnings: [] };
  }

  // Guard 4: Containment guard — assigning from inside an already-assigned clone.
  for (const e of existingSquads) {
    for (const clone of e.clones ?? []) {
      let isChild = false;
      try {
        isChild =
          clonesMatch(resolvedTargetDir, clone) &&
          normalisedPathKey(resolvedTargetDir) !== normalisedPathKey(clone);
      } catch {
        continue;
      }
      if (isChild) {
        throw new ConfigurationError(
          `ERR_ASSIGN_CONTAINMENT: The target directory is inside a registered clone root "${clone}".\n` +
          '  Run squad assign from the clone root directory.',
          { timestamp: new Date() },
        );
      }
    }
  }

  // Guard 5: Git-root resolution for the target clone.
  const gitRoot = gitRootFn(resolvedTargetDir);
  if (!gitRoot) {
    throw new ConfigurationError(
      `ERR_ASSIGN_NOT_GIT_REPO: "${resolvedTargetDir}" is not inside a Git repository.\n` +
      '  Run squad assign from the root of your product clone.',
      { timestamp: new Date() },
    );
  }
  const clonePath = gitRoot;

  // Guard 6: Idempotency — same callsign and same git root already assigned.
  const existingClones = entry.clones ?? [];
  if (existingClones.some(c => normalisedPathKey(c) === normalisedPathKey(clonePath))) {
    return { kind: 'alreadyAssigned', callsign, hostPath: hostSquadDir, clonePath, warnings: [] };
  }

  // Guard 7: Cross-entry clone collision — git root already in another entry's clones[].
  for (const e of existingSquads) {
    if (e.callsign === callsign) continue;
    const otherClones = e.clones ?? [];
    if (otherClones.some(c => normalisedPathKey(c) === normalisedPathKey(clonePath))) {
      throw new ConfigurationError(
        `ERR_ASSIGN_CROSS_CALLSIGN: "${clonePath}" is already assigned to squad "${e.callsign ?? e.path}".\n` +
        '  Run "squad unassign" to remove the existing assignment before re-assigning.',
        { timestamp: new Date() },
      );
    }
  }

  // Guard 8: Origin collision check.
  const rawRemotes = remotesFn(resolvedTargetDir);
  const normalizedNewOrigins = rawRemotes.map(normalizeRemoteUrl);

  const originMatchingEntries = existingSquads.filter(e => {
    if (e.callsign === callsign) return false;
    const entryOrigins = (e.origins ?? []).map(normalizeRemoteUrl);
    return normalizedNewOrigins.some(no => entryOrigins.includes(no));
  });

  if (originMatchingEntries.length >= 2) {
    const names = originMatchingEntries.map(e => `"${e.callsign ?? e.path}"`).join(', ');
    throw new ConfigurationError(
      `ERR_ASSIGN_ORIGIN_AMBIGUITY: The current fetch remotes match origins in multiple squads: ${names}.\n` +
      '  Use an explicit --callsign to disambiguate.',
      { timestamp: new Date() },
    );
  }
  if (originMatchingEntries.length === 1) {
    warnings.push(
      `Warning: current fetch remotes also match origins registered for squad ` +
      `"${originMatchingEntries[0]!.callsign ?? originMatchingEntries[0]!.path}". Proceeding.`,
    );
  }

  // Guard 9: Registry write.
  const existingOrigins = entry.origins ?? [];
  const originsToAdd = normalizedNewOrigins.filter(
    no => !existingOrigins.some(eo => normalizeRemoteUrl(eo) === no),
  );

  const wasInactive = entry['status'] === 'inactive';
  const updatedEntry: RegistryEntry = {
    ...entry,
    clones: [...existingClones, clonePath],
    origins: [...existingOrigins, ...originsToAdd],
    ...(wasInactive ? { status: 'active' as const } : {}),
  };

  const otherSquads = existingSquads.filter(s => s.callsign !== callsign);
  const newRegistry: Registry = {
    version: registry?.version ?? 1,
    squads: [...otherSquads, updatedEntry],
  };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistry(registryFilePath, newRegistry);

  return {
    kind: wasInactive ? 'reactivated' : 'assigned',
    callsign,
    hostPath: hostSquadDir,
    clonePath,
    warnings,
  };
}

interface _ColdStartCtx {
  rawArg: string;
  opts: SquadAssignOpts;
  cwd: string;
  resolvedTargetDir: string;
  gitRootFn: (dir: string) => string | null;
  remotesFn: (dir: string) => string[];
  cloneFn: (url: string, dest: string) => Promise<void>;
}

async function _coldStart(ctx: _ColdStartCtx): Promise<SquadAssignResult> {
  const { rawArg: url, opts, cwd, resolvedTargetDir, gitRootFn, remotesFn, cloneFn } = ctx;

  // Derive or accept callsign.
  const callsign = opts.callsign ?? _deriveCallsignFromUrl(url);

  // Resolve and validate the clone destination.
  const cloneDest = path.resolve(cwd, opts.cloneTo!);
  if (fs.existsSync(cloneDest)) {
    let isEmpty = true;
    try { isEmpty = fs.readdirSync(cloneDest).length === 0; } catch { isEmpty = false; }
    if (!isEmpty) {
      throw new ConfigurationError(
        `ERR_ASSIGN_CLONE_DEST_NOT_EMPTY: "${cloneDest}" already exists and is not empty.\n` +
        '  Choose a different --clone-to path.',
        { timestamp: new Date() },
      );
    }
  }

  // Load existing registry entries for pre-clone checks.
  const registryFilePath = resolveRegistryFilePath({ explicit: opts.registryPath });
  if (!registryFilePath) {
    throw new ConfigurationError(
      'ERR_ASSIGN_NO_REGISTRY: Cannot locate registry. Set SQUAD_REGISTRY_PATH or run squad init first.',
      { timestamp: new Date() },
    );
  }
  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  const existingSquads: RegistryEntry[] = registry?.squads ?? [];

  // Pre-clone callsign collision check.
  const existingEntry = existingSquads.find(s => s.callsign === callsign);
  if (existingEntry) {
    const expectedPath = path.join(cloneDest, '.squad');
    if (normalisedPathKey(existingEntry.path) !== normalisedPathKey(expectedPath)) {
      throw new ConfigurationError(
        `ERR_ASSIGN_CALLSIGN_COLLISION: Callsign "${callsign}" is already registered at a different host path.\n` +
        '  Choose a different --callsign.',
        { timestamp: new Date() },
      );
    }
  }

  // Clone the host repository. Roll back the directory on failure.
  try {
    await cloneFn(url, cloneDest);
  } catch (err) {
    try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new ConfigurationError(
      `ERR_ASSIGN_CLONE_FAILED: Failed to clone "${url}" to "${cloneDest}".\n` +
      `  ${err instanceof Error ? err.message : String(err)}`,
      { timestamp: new Date() },
    );
  }

  // Verify .squad/team.md in the cloned repository. Roll back on failure.
  const squadDir = path.join(cloneDest, '.squad');
  const teamMdPath = path.join(squadDir, 'team.md');
  if (!fs.existsSync(teamMdPath)) {
    try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new ConfigurationError(
      `ERR_ASSIGN_NO_TEAM_MD: "${cloneDest}" does not contain .squad/team.md. ` +
      'This repository is not a squad host. Clone directory has been removed.',
      { timestamp: new Date() },
    );
  }

  // Bind the product clone (git-root of resolvedTargetDir).
  const gitRoot = gitRootFn(resolvedTargetDir);
  if (!gitRoot) {
    throw new ConfigurationError(
      `ERR_ASSIGN_NOT_GIT_REPO: "${resolvedTargetDir}" is not inside a Git repository.\n` +
      '  Run squad assign from the root of your product clone.',
      { timestamp: new Date() },
    );
  }
  const clonePath = gitRoot;

  const rawRemotes = remotesFn(resolvedTargetDir);
  const normalizedNewOrigins = rawRemotes.map(normalizeRemoteUrl);

  const reactivating = existingEntry !== undefined;
  const baseEntry: RegistryEntry = existingEntry
    ? { ...existingEntry }
    : { callsign, path: squadDir };

  const existingClones = baseEntry.clones ?? [];
  const existingOrigins = baseEntry.origins ?? [];
  const originsToAdd = normalizedNewOrigins.filter(
    no => !existingOrigins.some(eo => normalizeRemoteUrl(eo) === no),
  );

  const updatedEntry: RegistryEntry = {
    ...baseEntry,
    path: squadDir,
    callsign,
    initUri: url,
    clones: existingClones.some(c => normalisedPathKey(c) === normalisedPathKey(clonePath))
      ? existingClones
      : [...existingClones, clonePath],
    origins: [...existingOrigins, ...originsToAdd],
    ...(reactivating ? { status: 'active' as const } : {}),
  };

  const otherSquads = existingSquads.filter(s => s.callsign !== callsign);
  const newRegistry: Registry = {
    version: registry?.version ?? 1,
    squads: [...otherSquads, updatedEntry],
  };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistry(registryFilePath, newRegistry);

  return {
    kind: reactivating ? 'reactivated' : 'assigned',
    callsign,
    hostPath: squadDir,
    clonePath,
    warnings: [],
  };
}
