import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ErrorCategory, ErrorSeverity, SquadError } from './adapter/errors.js';
import { resolveSquadHome } from './resolution.js';
import { normalisedPathKey } from './path-utils.js';
import { normalizeRemoteUrl } from './platform/detect.js';

export interface RegistryEntry {
  callsign?: string;
  path: string;
  origins?: string[];
  clones?: string[];
  status?: 'active' | 'inactive';
  initUri?: string;
  stateBackend?: 'orphan' | 'local' | 'external' | 'two-layer';
  /** Git remote name used for state synchronisation. Default: `'origin'` when absent. */
  stateRemote?: string;
  /** Git branch name used for state synchronisation. Default: `'squad-state'` when absent. */
  stateBranch?: string;
  /**
   * Git remote hosting the durable config lane (piece 52). Default: `stateRemote` / `'origin'`
   * when absent. Piece 53's durable publish/hydrate resolves the config orphan through it.
   */
  configRemote?: string;
  /**
   * Git branch for the durable config orphan (piece 52), e.g. `squad/config/<callsign>`.
   * Absent on hosts predating Pole A — the durable hydrate is skipped in that case.
   */
  configBranch?: string;
  inboxHandle?: string;
  /**
   * True when the CLI owns this host clone (piece 55, sub-proposal B) — a managed consumer
   * clone under `~/.squad/hosts/<callsign>/`. Managed paths are tool-owned: `doctor` never flags
   * them as a missing/user working tree, and `upgrade`/`sync` treat them as clean-overwrite
   * hydrate targets rather than hand-edited working trees.
   */
  managed?: boolean;
  [key: string]: unknown;
}

export interface RegistryDefaults {
  /**
   * System-wide default state remote (piece 58 §B, decision H1). Consulted by
   * `squad assign --callsign <cs>` when neither `--state-remote` nor `SQUAD_STATE_REMOTE`
   * supplies a value, so a managed consumer can onboard from callsign alone.
   */
  stateRemote?: string;
  [key: string]: unknown;
}

export interface Registry {
  version: number;
  squads: RegistryEntry[];
  /** Optional system-wide defaults (piece 58 §B / decision H1). */
  defaults?: RegistryDefaults;
}

type RegistryOptions = {
  registryPath?: string;
  legacyPath?: string;
  onWarn?: (msg: string) => void;
};

function validationError(message: string, metadata?: Record<string, unknown>, originalError?: Error): SquadError {
  return new SquadError(
    message,
    ErrorSeverity.ERROR,
    ErrorCategory.VALIDATION,
    {
      operation: 'registry',
      timestamp: new Date(),
      metadata,
    },
    false,
    originalError,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).includes('..');
}

function validateStringArray(value: unknown, fieldName: string, entryIndex: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw validationError(`Registry entry ${entryIndex} ${fieldName} must be an array of strings.`);
  }

  return value.map((item, itemIndex) => {
    if (typeof item !== 'string') {
      throw validationError(`Registry entry ${entryIndex} ${fieldName}[${itemIndex}] must be a string.`);
    }
    return item;
  });
}

/**
 * Validate and normalize one registry entry.
 *
 * @internal Exposed for CLI diagnostics; prefer {@link parseRegistry} or {@link validateRegistry} for normal registry reads.
 */
export function validateEntry(value: unknown, entryIndex: number): RegistryEntry {
  if (!isRecord(value)) {
    throw validationError(`Registry entry ${entryIndex} must be an object.`);
  }

  if (typeof value['path'] !== 'string' || value['path'].length === 0) {
    throw validationError(`Registry entry ${entryIndex} path is required.`);
  }

  const entryPath = value['path'];
  if (hasTraversalSegment(entryPath)) {
    throw validationError(`Registry entry ${entryIndex} path contains a path-traversal segment.`);
  }
  if (!path.isAbsolute(entryPath)) {
    throw validationError(`Registry entry ${entryIndex} path must be absolute.`);
  }
  if (!entryPath.endsWith('.squad')) {
    throw validationError(`Registry entry ${entryIndex} path must end with .squad.`);
  }

  const entry: RegistryEntry = { path: entryPath };

  if (value['callsign'] !== undefined) {
    if (typeof value['callsign'] !== 'string' || value['callsign'].length === 0) {
      throw validationError(`Registry entry ${entryIndex} callsign must be a non-empty string.`);
    }
    if (hasTraversalSegment(value['callsign'])) {
      throw validationError(`Registry entry ${entryIndex} callsign contains a path-traversal segment.`);
    }
    entry.callsign = value['callsign'];
  }

  const origins = validateStringArray(value['origins'], 'origins', entryIndex);
  if (origins !== undefined) {
    entry.origins = origins;
  }

  const clones = validateStringArray(value['clones'], 'clones', entryIndex);
  if (clones !== undefined) {
    entry.clones = clones.map((clonePath, cloneIndex) => {
      if (hasTraversalSegment(clonePath)) {
        throw validationError(`Registry entry ${entryIndex} clone ${cloneIndex} contains a path-traversal segment.`);
      }
      if (!path.isAbsolute(clonePath)) {
        throw validationError(`Registry entry ${entryIndex} clone ${cloneIndex} must be absolute.`);
      }
      return clonePath;
    });
  }

  if (value['status'] !== undefined) {
    if (value['status'] !== 'active' && value['status'] !== 'inactive') {
      throw validationError(`Registry entry ${entryIndex} status must be 'active' or 'inactive'.`);
    }
    entry.status = value['status'] as 'active' | 'inactive';
  }

  if (value['initUri'] !== undefined) {
    if (typeof value['initUri'] !== 'string') {
      throw validationError(`Registry entry ${entryIndex} initUri must be a string.`);
    }
    entry.initUri = value['initUri'];
  }

  if (value['stateBackend'] !== undefined) {
    const validBackends = ['orphan', 'local', 'external', 'two-layer'];
    if (!validBackends.includes(value['stateBackend'] as string)) {
      throw validationError(`Registry entry ${entryIndex} stateBackend must be one of ${validBackends.join(', ')}.`);
    }
    entry.stateBackend = value['stateBackend'] as 'orphan' | 'local' | 'external' | 'two-layer';
  }

  if (value['stateRemote'] !== undefined) {
    if (typeof value['stateRemote'] !== 'string') {
      throw validationError(`Registry entry ${entryIndex} stateRemote must be a string.`);
    }
    entry.stateRemote = value['stateRemote'];
  }

  if (value['stateBranch'] !== undefined) {
    if (typeof value['stateBranch'] !== 'string') {
      throw validationError(`Registry entry ${entryIndex} stateBranch must be a string.`);
    }
    entry.stateBranch = value['stateBranch'];
  }

  if (value['configRemote'] !== undefined) {
    if (typeof value['configRemote'] !== 'string') {
      throw validationError(`Registry entry ${entryIndex} configRemote must be a string.`);
    }
    entry.configRemote = value['configRemote'];
  }

  if (value['configBranch'] !== undefined) {
    if (typeof value['configBranch'] !== 'string') {
      throw validationError(`Registry entry ${entryIndex} configBranch must be a string.`);
    }
    entry.configBranch = value['configBranch'];
  }

  const rawHandle = value['inboxHandle'];
  if (rawHandle !== undefined) {
    if (typeof rawHandle !== 'string') {
      throw validationError(`Registry entry ${entryIndex} inboxHandle must be a string.`);
    }
    entry.inboxHandle = rawHandle;
  }

  if (value['managed'] !== undefined) {
    if (typeof value['managed'] !== 'boolean') {
      throw validationError(`Registry entry ${entryIndex} managed must be a boolean.`);
    }
    entry.managed = value['managed'];
  }

  // Preserve unknown forward-compatible fields for round-trip fidelity.
  const knownFields = new Set(['callsign', 'path', 'origins', 'clones', 'status', 'initUri', 'stateBackend', 'stateRemote', 'stateBranch', 'configRemote', 'configBranch', 'inboxHandle', 'managed']);
  for (const [key, val] of Object.entries(value)) {
    if (!knownFields.has(key)) {
      entry[key] = val;
    }
  }

  return entry;
}

export function parseRegistry(jsonText: string): Registry {
  if (jsonText.trim().length === 0) {
    throw validationError('Registry file is empty. Create a registry with version 1 and a squads array.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const originalError = error instanceof Error ? error : undefined;
    throw validationError('Registry file must contain valid JSON. Fix the JSON syntax and try again.', undefined, originalError);
  }

  return validateRegistry(parsed);
}

export function validateRegistry(obj: unknown): Registry {
  if (!isRecord(obj)) {
    throw validationError('Registry must be an object.');
  }

  if (!Object.hasOwn(obj, 'version')) {
    throw validationError('Registry version is required.');
  }
  if (typeof obj['version'] !== 'number' || !Number.isInteger(obj['version'])) {
    throw validationError('Registry version must be the number 1.');
  }
  if (obj['version'] === 0) {
    throw validationError('Registry version 0 is not supported. Create a current registry with version 1.');
  }
  if (obj['version'] !== 1) {
    throw validationError(`Unsupported registry version ${obj['version']}.`);
  }

  if (!Array.isArray(obj['squads'])) {
    throw validationError('Registry squads field is required and must be an array.');
  }

  const callsigns = new Set<string>();
  const paths = new Set<string>();
  const squads = obj['squads'].map((entryValue, index) => {
    const entry = validateEntry(entryValue, index);

    if (entry.callsign) {
      if (callsigns.has(entry.callsign)) {
        throw validationError(`Registry contains duplicate callsign "${entry.callsign}".`);
      }
      callsigns.add(entry.callsign);
    }

    const normalizedPath = normalisedPathKey(entry.path);
    if (paths.has(normalizedPath)) {
      throw validationError(`Registry contains duplicate path "${entry.path}".`);
    }
    paths.add(normalizedPath);

    return entry;
  });

  // Piece 58 §B / decision H1 — tolerate and round-trip a top-level `defaults` block carrying the
  // system-wide state remote (and any forward-compatible sibling keys).
  let defaults: RegistryDefaults | undefined;
  if (obj['defaults'] !== undefined) {
    if (!isRecord(obj['defaults'])) {
      throw validationError('Registry defaults must be an object.');
    }
    const rawDefaults = obj['defaults'];
    const out: RegistryDefaults = {};
    if (rawDefaults['stateRemote'] !== undefined) {
      if (typeof rawDefaults['stateRemote'] !== 'string') {
        throw validationError('Registry defaults.stateRemote must be a string.');
      }
      out.stateRemote = rawDefaults['stateRemote'];
    }
    // Preserve unknown forward-compatible default fields for round-trip fidelity.
    for (const [key, val] of Object.entries(rawDefaults)) {
      if (!(key in out)) out[key] = val;
    }
    defaults = out;
  }

  return { version: 1, squads, ...(defaults ? { defaults } : {}) };
}

export function upsertEntry(entry: RegistryEntry, opts: { onWarn?: (msg: string) => void } = {}): RegistryEntry {
  const validated = validateEntry(entry, 0);
  if (!fs.existsSync(validated.path)) {
    opts.onWarn?.(`Registry entry path does not exist: ${validated.path}`);
  }
  if (validated.origins) {
    const seenOrigins = new Set<string>();
    validated.origins = validated.origins.filter((origin) => {
      const key = normalizeRemoteUrl(origin);
      if (seenOrigins.has(key)) return false;
      seenOrigins.add(key);
      return true;
    });
  }
  if (validated.clones) {
    const seenClones = new Set<string>();
    validated.clones = validated.clones.filter((clonePath) => {
      const key = normalisedPathKey(clonePath);
      if (seenClones.has(key)) return false;
      seenClones.add(key);
      return true;
    });
  }
  return validated;
}

/** @deprecated Use {@link upsertEntry} instead. */
export function registerEntry(entry: RegistryEntry, opts: { onWarn?: (msg: string) => void } = {}): RegistryEntry {
  return upsertEntry(entry, opts);
}

export function writeRegistry(filePath: string, registry: Registry): void {
  const validated = validateRegistry(registry);
  const json = `${JSON.stringify(validated, null, 2)}\n`;

  // Atomic write: write to a temp sibling file then rename into place.
  // rename(2) is atomic on POSIX and effectively atomic on NTFS, so an
  // interrupted write cannot leave the registry in a partially-written state.
  // mode 0o600 restricts read access to the owning user on POSIX.
  const tmpPath = `${filePath}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore — best-effort cleanup */ }
    const originalError = error instanceof Error ? error : undefined;
    throw validationError(
      `Unable to write registry file ${filePath}. Check file permissions and try again.`,
      { filePath },
      originalError,
    );
  }
}

export function loadRegistryFromDisk(opts: RegistryOptions = {}): { registry: Registry | null; warnings: string[] } {
  const registryPath = resolveRegistryPath(opts.registryPath);
  const legacyPath = resolveLegacyPath(opts.legacyPath, registryPath);
  const warnings: string[] = [];

  if (registryPath && fs.existsSync(registryPath)) {
    return {
      registry: parseRegistry(fs.readFileSync(registryPath, 'utf8')),
      warnings,
    };
  }

  if (legacyPath && fs.existsSync(legacyPath)) {
    const warning = `Found legacy squad-repos.json at ${legacyPath}. Create registry.json to use the current registry format.`;
    warnings.push(warning);
    opts.onWarn?.(warning);
    return { registry: null, warnings };
  }

  return { registry: null, warnings };
}

function resolveRegistryPath(registryPath?: string): string | null {
  if (registryPath) {
    return registryPath.endsWith('.json') ? registryPath : path.join(registryPath, 'registry.json');
  }

  const home = resolveSquadHome(false);
  return home ? path.join(home, 'registry.json') : null;
}

function resolveLegacyPath(legacyPath: string | undefined, registryPath: string | null): string | null {
  if (legacyPath) {
    return legacyPath.endsWith('.json') ? legacyPath : path.join(legacyPath, 'squad-repos.json');
  }
  if (!registryPath) return null;
  return path.join(path.dirname(registryPath), 'squad-repos.json');
}
