import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ErrorCategory, ErrorSeverity, SquadError } from './adapter/errors.js';
import { parseRegistry } from './registry.js';

export type ResolveErrorCode =
  | 'EMPTY_CALLSIGN'
  | 'INVALID_CALLSIGN'
  | 'REGISTRY_MISSING'
  | 'REGISTRY_INVALID'
  | 'UNKNOWN_CALLSIGN'
  | 'STALE_PATH';

export interface ResolveOpts {
  cwd: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homeDir?: string;
  callsign?: string;
  registryPath?: string;
}

export interface ResolvedSquad {
  path: string;
  source: 'local' | 'env';
  callsign?: string;
  matchedOrigin?: string | null;
}

const CALLSIGN_RE = /^[A-Za-z0-9_-]+$/;

function resolverError(message: string, code: ResolveErrorCode): SquadError {
  return new SquadError(
    message,
    ErrorSeverity.ERROR,
    ErrorCategory.CONFIGURATION,
    { operation: 'resolveSquad', timestamp: new Date(), metadata: { code } },
    false,
  );
}

/** Used for cwd/input validation errors that don't carry an exported code. */
function inputError(message: string): SquadError {
  return new SquadError(
    message,
    ErrorSeverity.ERROR,
    ErrorCategory.CONFIGURATION,
    { operation: 'resolveSquad', timestamp: new Date() },
    false,
  );
}

function validateCallsign(callsign: string, source: string): void {
  if (callsign.length === 0) {
    throw resolverError(`${source} must not be empty.`, 'EMPTY_CALLSIGN');
  }
  if (!CALLSIGN_RE.test(callsign)) {
    throw resolverError(
      `${source} "${callsign}" contains invalid characters. Allowed: A-Z a-z 0-9 _ -`,
      'INVALID_CALLSIGN',
    );
  }
}

function findGitRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    const gitMarker = path.join(current, '.git');
    if (fs.existsSync(gitMarker)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function platformDefaultRegistryPath(
  platform: NodeJS.Platform,
  homeDir: string,
  env: Record<string, string | undefined>,
): string {
  let base: string;
  if (platform === 'win32') {
    base =
      env['APPDATA'] ??
      env['LOCALAPPDATA'] ??
      path.join(homeDir, 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(homeDir, 'Library', 'Application Support');
  } else {
    base = env['XDG_CONFIG_HOME'] ?? path.join(homeDir, '.config');
  }
  return path.join(base, 'squad', 'registry.json');
}

function resolveEffectiveRegistryPath(opts: ResolveOpts): string {
  if (opts.registryPath) return opts.registryPath;

  const env: Record<string, string | undefined> =
    opts.env ?? (process.env as Record<string, string | undefined>);
  const envPath = env['SQUAD_REGISTRY_PATH'];
  if (envPath) return envPath;

  const platform = opts.platform ?? process.platform;
  const homeDir = opts.homeDir ?? os.homedir();
  return platformDefaultRegistryPath(platform, homeDir, env);
}

function resolveByCallsign(callsign: string, opts: ResolveOpts): ResolvedSquad {
  const registryPath = resolveEffectiveRegistryPath(opts);

  if (!fs.existsSync(registryPath)) {
    throw resolverError(
      `Registry not found at "${registryPath}". Set SQUAD_REGISTRY_PATH or create a registry at the default path.`,
      'REGISTRY_MISSING',
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(registryPath, 'utf8');
  } catch (err) {
    const original = err instanceof Error ? err : undefined;
    throw resolverError(
      `Unable to read registry at "${registryPath}": ${original?.message ?? String(err)}`,
      'REGISTRY_INVALID',
    );
  }

  let registry: ReturnType<typeof parseRegistry>;
  try {
    registry = parseRegistry(content);
  } catch (err) {
    const original = err instanceof Error ? err : undefined;
    throw resolverError(
      `Registry at "${registryPath}" is malformed: ${original?.message ?? String(err)}`,
      'REGISTRY_INVALID',
    );
  }

  const entry = registry.squads.find((e) => e.callsign === callsign);
  if (!entry) {
    throw resolverError(`No squad found for callsign "${callsign}".`, 'UNKNOWN_CALLSIGN');
  }

  // Use lstatSync to avoid following symlinks to nonexistent targets
  const squadStat = fs.existsSync(entry.path)
    ? fs.lstatSync(entry.path)
    : null;
  if (!squadStat?.isDirectory()) {
    throw resolverError(
      `Registry entry path for callsign "${callsign}" does not exist or is not a directory: ${entry.path}`,
      'STALE_PATH',
    );
  }

  return { path: entry.path, source: 'env', callsign, matchedOrigin: null };
}

export function resolveSquad(opts: ResolveOpts): ResolvedSquad | null {
  if (!opts.cwd || opts.cwd.length === 0) {
    throw inputError('cwd must not be empty.');
  }

  // Use lstatSync to avoid following symlinks to nonexistent targets
  const cwdStat = fs.existsSync(opts.cwd) ? fs.lstatSync(opts.cwd) : null;
  if (!cwdStat?.isDirectory()) {
    throw inputError(`cwd must be an existing directory: ${opts.cwd}`);
  }

  // Priority 1: explicit callsign flag
  if (opts.callsign !== undefined) {
    validateCallsign(opts.callsign, 'callsign');
    return resolveByCallsign(opts.callsign, opts);
  }

  // Priority 2: worktree-local resolution — walk up to .git, check for .squad/
  const gitRoot = findGitRoot(opts.cwd);
  if (gitRoot !== null) {
    const squadPath = path.join(gitRoot, '.squad');
    const stat = fs.existsSync(squadPath) ? fs.lstatSync(squadPath) : null;
    if (stat?.isDirectory()) {
      return { path: squadPath, source: 'local', matchedOrigin: null };
    }
  }

  // Priority 3: SQUAD_CALLSIGN env var → registry lookup
  const env: Record<string, string | undefined> =
    opts.env ?? (process.env as Record<string, string | undefined>);
  const envCallsign = env['SQUAD_CALLSIGN'];
  if (envCallsign !== undefined) {
    validateCallsign(envCallsign, 'SQUAD_CALLSIGN');
    return resolveByCallsign(envCallsign, opts);
  }

  return null;
}
