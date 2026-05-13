import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { ErrorCategory, ErrorSeverity, SquadError } from './adapter/errors.js';
import { parseRegistry } from './registry.js';
import { clonesMatch } from './path-utils.js';

export type ResolveErrorCode =
  | 'EMPTY_CALLSIGN'
  | 'INVALID_CALLSIGN'
  | 'REGISTRY_MISSING'
  | 'REGISTRY_INVALID'
  | 'UNKNOWN_CALLSIGN'
  | 'STALE_PATH'
  | 'ERR_CWD_UNREACHABLE'
  | 'AMBIGUOUS_CLONES'
  | 'AMBIGUOUS_ORIGINS'
  | 'INVALID_CLONE_ENTRY';

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
  source: 'local' | 'env' | 'clones' | 'origins' | 'platform' | 'worktree';
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

/** Resolve the platform-scoped user .squad/ directory for the platform fallback step. */
function platformFallbackSquadPath(
  platform: NodeJS.Platform,
  homeDir: string,
  env: Record<string, string | undefined>,
): string | null {
  let base: string | null;
  if (platform === 'win32') {
    const appdata = env['APPDATA'] ?? null;
    const localappdata = env['LOCALAPPDATA'] ?? null;
    base = appdata ?? localappdata;
  } else if (platform === 'darwin') {
    base = path.join(homeDir, 'Library', 'Application Support');
  } else {
    base = env['XDG_DATA_HOME'] ?? path.join(homeDir, '.local', 'share');
  }
  if (base === null) return null;
  return path.join(base, 'squad', '.squad');
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

/**
 * Canonicalize a Git remote URL to a `host/path` string for comparison only.
 *
 * The canonical form is used solely as a comparison key — it is never stored
 * back to the registry or Git config.
 */
export function normalizeRemoteUrl(url: string): string {
  // GitHub SSH: git@github.com:org/repo[.git]
  const ghSsh = /^git@github\.com:(.+?)(?:\.git)?$/i;
  const ghSshMatch = ghSsh.exec(url);
  if (ghSshMatch) {
    return `github.com/${ghSshMatch[1]}`;
  }

  // GitHub HTTPS: https://[userinfo@]github.com/org/repo[.git][/]
  const ghHttps = /^https?:\/\/(?:[^@/]+@)?github\.com\/(.+?)(?:\.git)?\/?$/i;
  const ghHttpsMatch = ghHttps.exec(url);
  if (ghHttpsMatch) {
    return `github.com/${ghHttpsMatch[1]}`;
  }

  // ADO modern SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}[/]
  const adoModernSsh = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+?)\/?$/i;
  const adoModernSshMatch = adoModernSsh.exec(url);
  if (adoModernSshMatch) {
    return `dev.azure.com/${adoModernSshMatch[1]}/${adoModernSshMatch[2]}/_git/${adoModernSshMatch[3]}`;
  }

  // ADO legacy SSH: {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}[/]
  const adoLegacySsh = /^[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+?)\/?$/i;
  const adoLegacySshMatch = adoLegacySsh.exec(url);
  if (adoLegacySshMatch) {
    return `dev.azure.com/${adoLegacySshMatch[1]}/${adoLegacySshMatch[2]}/_git/${adoLegacySshMatch[3]}`;
  }

  // ADO modern HTTPS: https://[userinfo@]dev.azure.com/{org}/{project}/_git/{repo}[.git][/]
  const adoModernHttps =
    /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i;
  const adoModernHttpsMatch = adoModernHttps.exec(url);
  if (adoModernHttpsMatch) {
    return `dev.azure.com/${adoModernHttpsMatch[1]}/${adoModernHttpsMatch[2]}/_git/${adoModernHttpsMatch[3]}`;
  }

  // ADO legacy HTTPS: https://[userinfo@]{org}.visualstudio.com/{project}/_git/{repo}[.git][/]
  const adoLegacyHttps =
    /^https?:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i;
  const adoLegacyHttpsMatch = adoLegacyHttps.exec(url);
  if (adoLegacyHttpsMatch) {
    return `dev.azure.com/${adoLegacyHttpsMatch[1]}/${adoLegacyHttpsMatch[2]}/_git/${adoLegacyHttpsMatch[3]}`;
  }

  // Unknown form: lowercase entire input for last-resort exact comparison.
  return url.toLowerCase();
}

/**
 * Run `git remote -v` in `cwd`, collect fetch URLs, deduplicate by canonical form,
 * and return the original URL strings. Returns an empty array when the directory is
 * not a Git repository, Git is unavailable, or no remotes are configured.
 */
export function collectCwdRemoteUrls(cwd: string): string[] {
  let output: string;
  try {
    const buf = execFileSync('git', ['remote', '-v'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    output = buf.toString('utf8');
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed.endsWith(' (fetch)')) continue;
    const tabIdx = trimmed.indexOf('\t');
    if (tabIdx === -1) continue;
    const rawUrl = trimmed.slice(tabIdx + 1, trimmed.length - ' (fetch)'.length).trim();
    const canonical = normalizeRemoteUrl(rawUrl);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      result.push(rawUrl);
    }
  }

  return result;
}

/**
 * Parse `git worktree list --porcelain` output and return the path of the
 * first worktree whose root contains a `.squad/` directory, or null if none.
 */
function findWorktreeSquad(cwd: string): string | null {
  let output: string;
  try {
    const buf = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    output = buf.toString('utf8');
  } catch {
    return null;
  }

  // Porcelain format: blank-line-separated records, each starting with "worktree {path}"
  const records = output.split(/\n\n+/);
  for (const record of records) {
    const lines = record.trim().split('\n');
    if (lines.length === 0) continue;
    const firstLine = lines[0];
    if (!firstLine?.startsWith('worktree ')) continue;
    const worktreePath = firstLine.slice('worktree '.length).trim();
    if (!worktreePath) continue;
    const squadPath = path.join(worktreePath, '.squad');
    const stat = fs.existsSync(squadPath) ? fs.lstatSync(squadPath) : null;
    if (stat?.isDirectory()) {
      return squadPath;
    }
  }

  return null;
}

export function resolveSquad(opts: ResolveOpts): ResolvedSquad | null {
  // Init-mode guard — validate cwd before any registry, Git, or filesystem probing.
  if (!opts.cwd || opts.cwd.trim().length === 0) {
    throw inputError('cwd must not be empty.');
  }

  const cwdStat = fs.existsSync(opts.cwd) ? fs.lstatSync(opts.cwd) : null;
  if (cwdStat === null) {
    throw resolverError(
      `cwd does not exist (ERR_CWD_UNREACHABLE): ${opts.cwd}`,
      'ERR_CWD_UNREACHABLE',
    );
  }
  if (!cwdStat.isDirectory()) {
    throw resolverError(
      `cwd must be a directory, not a file (ERR_CWD_UNREACHABLE): ${opts.cwd}`,
      'ERR_CWD_UNREACHABLE',
    );
  }

  // Resolve effective environment once — opts.env takes precedence over process.env.
  const env: Record<string, string | undefined> =
    opts.env ?? (process.env as Record<string, string | undefined>);

  // Step 1: explicit callsign flag
  if (opts.callsign !== undefined) {
    validateCallsign(opts.callsign, 'callsign');
    return resolveByCallsign(opts.callsign, opts);
  }

  // Step 2: worktree-local resolution — walk up to .git, check for .squad/
  const gitRoot = findGitRoot(opts.cwd);
  if (gitRoot !== null) {
    const squadPath = path.join(gitRoot, '.squad');
    const stat = fs.existsSync(squadPath) ? fs.lstatSync(squadPath) : null;
    if (stat?.isDirectory()) {
      return { path: squadPath, source: 'local', matchedOrigin: null };
    }
  }

  // Step 3: SQUAD_CALLSIGN env var → registry lookup
  const envCallsign = env['SQUAD_CALLSIGN'];
  if (envCallsign !== undefined) {
    validateCallsign(envCallsign, 'SQUAD_CALLSIGN');
    return resolveByCallsign(envCallsign, opts);
  }

  // Steps 4–5: registry-based matching (clones and origins).
  // Missing or unreadable registry silently falls through — only the callsign steps throw.
  const registryPath = resolveEffectiveRegistryPath(opts);
  if (fs.existsSync(registryPath)) {
    let registry: ReturnType<typeof parseRegistry> | null = null;
    try {
      const content = fs.readFileSync(registryPath, 'utf8');
      registry = parseRegistry(content);
    } catch {
      // Malformed registry — fall through silently for these steps.
    }

    if (registry !== null) {
      // Step 4: clones[] matching
      type RegistryEntry = (typeof registry.squads)[number];
      const cloneMatches: RegistryEntry[] = [];

      for (const entry of registry.squads) {
        if (!entry.clones || entry.clones.length === 0) continue;
        for (const clonePath of entry.clones) {
          let matched = false;
          try {
            matched = clonesMatch(opts.cwd, clonePath);
          } catch {
            // Invalid clone entry in registry — skip silently.
          }
          if (matched) {
            cloneMatches.push(entry);
            break; // at most one clone path per entry contributes a match
          }
        }
      }

      if (cloneMatches.length === 1) {
        const entry = cloneMatches[0]!;
        const result: ResolvedSquad = { path: entry.path, source: 'clones', matchedOrigin: null };
        if (entry.callsign !== undefined) result.callsign = entry.callsign;
        return result;
      }

      if (cloneMatches.length > 1) {
        throw resolverError(
          `Ambiguous clone match: ${cloneMatches.length} registered squads match the current directory. ` +
            `Disambiguate by setting SQUAD_CALLSIGN or specifying a registered clone path.`,
          'AMBIGUOUS_CLONES',
        );
      }

      // Step 5: origins[] matching
      const remoteUrls = collectCwdRemoteUrls(opts.cwd);
      if (remoteUrls.length > 0) {
        const canonicalRemotes = remoteUrls.map(normalizeRemoteUrl);
        const originMatches: Array<{ entry: RegistryEntry; matchedOrigin: string }> = [];

        for (const entry of registry.squads) {
          if (!entry.origins || entry.origins.length === 0) continue;
          for (const origin of entry.origins) {
            if (canonicalRemotes.includes(normalizeRemoteUrl(origin))) {
              originMatches.push({ entry, matchedOrigin: origin });
              break; // at most one origin per entry contributes a match
            }
          }
        }

        if (originMatches.length === 1) {
          const { entry, matchedOrigin } = originMatches[0]!;
          const result: ResolvedSquad = { path: entry.path, source: 'origins', matchedOrigin };
          if (entry.callsign !== undefined) result.callsign = entry.callsign;
          return result;
        }

        if (originMatches.length > 1) {
          throw resolverError(
            `Ambiguous origin match: ${originMatches.length} registered squads match the current repository's remotes. ` +
              `Disambiguate by setting SQUAD_CALLSIGN or specifying a registered clone path.`,
            'AMBIGUOUS_ORIGINS',
          );
        }
      }
    }
  }

  // Step 6: platform fallback — probe user-scoped .squad/ directory.
  const platform = opts.platform ?? process.platform;
  const homeDir = opts.homeDir ?? os.homedir();
  const platformSquadPath = platformFallbackSquadPath(platform, homeDir, env);
  if (platformSquadPath !== null) {
    const stat = fs.existsSync(platformSquadPath) ? fs.lstatSync(platformSquadPath) : null;
    if (stat?.isDirectory()) {
      return { path: platformSquadPath, source: 'platform', matchedOrigin: null };
    }
  }

  // Step 7: linked-worktree fallback — when the current git root is a linked worktree marker.
  if (gitRoot !== null) {
    const gitMarker = path.join(gitRoot, '.git');
    const gitMarkerStat = fs.existsSync(gitMarker) ? fs.lstatSync(gitMarker) : null;
    if (gitMarkerStat?.isFile()) {
      let markerContent = '';
      try {
        markerContent = fs.readFileSync(gitMarker, 'utf8');
      } catch {
        // Unreadable marker — fall through.
      }
      if (markerContent.startsWith('gitdir: ')) {
        const worktreeSquad = findWorktreeSquad(opts.cwd);
        if (worktreeSquad !== null) {
          return { path: worktreeSquad, source: 'worktree', matchedOrigin: null };
        }
      }
    }
  }

  // Step 8: chain exhausted — init-mode signal.
  return null;
}

// Re-export path-utils helpers so callers can import them from the same subpath.
export { clonesMatch, normalisedPathKey, pathsRefSameLocation } from './path-utils.js';

