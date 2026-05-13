import fs from 'node:fs';
import path from 'node:path';
import { ErrorCategory, ErrorSeverity, SquadError } from './adapter/errors.js';
import { resolveSquadHome } from './resolution.js';
import { normalisedPathKey } from './path-utils.js';

export interface RegistryEntry {
  callsign?: string;
  path: string;
  origins?: string[];
  clones?: string[];
}

export interface Registry {
  version: number;
  squads: RegistryEntry[];
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

function validateEntry(value: unknown, entryIndex: number): RegistryEntry {
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

  return { version: 1, squads };
}

export function upsertEntry(entry: RegistryEntry, opts: { onWarn?: (msg: string) => void } = {}): RegistryEntry {
  const validated = validateEntry(entry, 0);
  if (!fs.existsSync(validated.path)) {
    opts.onWarn?.(`Registry entry path does not exist: ${validated.path}`);
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

  try {
    fs.writeFileSync(filePath, json, 'utf8');
  } catch (error) {
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
