import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ErrorCategory, ErrorSeverity, SquadError } from './adapter/errors.js';

function cloneEntryError(message: string): SquadError {
  return new SquadError(
    message,
    ErrorSeverity.ERROR,
    ErrorCategory.CONFIGURATION,
    { operation: 'clonesMatch', timestamp: new Date(), metadata: { code: 'INVALID_CLONE_ENTRY' } },
    false,
  );
}

/** Normalize path case per platform: case-insensitive on win32 and darwin, case-sensitive on linux. */
function normCase(p: string): string {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return p.toLowerCase();
  }
  return p;
}

/**
 * Produces the duplicate-detection key used for registry path uniqueness.
 * Resolves the path and applies OS-aware casing rules: case-insensitive on
 * win32 and darwin, case-sensitive on linux.
 */
export function normalisedPathKey(value: string): string {
  return normCase(path.normalize(path.resolve(value)));
}

/**
 * Bidirectional symlink-aware path equality. Resolves one realpath per side;
 * falls back to the literal path when realpathSync fails (e.g. path does not exist).
 */
export function pathsRefSameLocation(a: string, b: string): boolean {
  let realA: string;
  let realB: string;
  try {
    realA = fs.realpathSync(a);
  } catch {
    realA = a;
  }
  try {
    realB = fs.realpathSync(b);
  } catch {
    realB = b;
  }
  return normCase(realA) === normCase(realB);
}

/**
 * Returns true when `cwd` is the clone root or a sentinel-bounded subdirectory of it.
 *
 * Sentinel-bounded means the comparison uses a trailing separator so that
 * `D:\git\repo-tools` does not match a clone registered as `D:\git\repo`.
 *
 * @throws {SquadError} with code `INVALID_CLONE_ENTRY` when `clone` is a relative path.
 */
export function clonesMatch(cwd: string, clone: string): boolean {
  if (!path.isAbsolute(clone)) {
    throw cloneEntryError(
      `Clone path "${clone}" must be absolute. Relative clone entries are not valid for resolution.`,
    );
  }

  const resolvedCwd = path.resolve(cwd);
  const resolvedClone = path.resolve(clone);

  // Exact equality (symlink-aware via realpaths).
  if (pathsRefSameLocation(resolvedCwd, resolvedClone)) {
    return true;
  }

  // Literal sentinel-bounded containment: cwd must start with clone + sep.
  const cloneWithSep = resolvedClone.endsWith(path.sep) ? resolvedClone : resolvedClone + path.sep;
  if (normCase(resolvedCwd).startsWith(normCase(cloneWithSep))) {
    return true;
  }

  // Realpath containment fallback: resolve both sides and repeat the containment check.
  try {
    const realCwd = fs.realpathSync(resolvedCwd);
    const realClone = fs.realpathSync(resolvedClone);
    const realCloneWithSep = realClone.endsWith(path.sep) ? realClone : realClone + path.sep;
    if (normCase(realCwd).startsWith(normCase(realCloneWithSep))) {
      return true;
    }
  } catch {
    // Realpath unavailable — literal comparison was already attempted above.
  }

  return false;
}

/**
 * Returns the default registry file path — the single authoritative computation
 * shared by all readers and writers.
 *
 * Precedence:
 * 1. `SQUAD_HOME` env var → `path.resolve(SQUAD_HOME)/registry.json`
 * 2. Otherwise → `~/.squad/registry.json`
 *
 * Pure computation — no filesystem I/O, no directory existence checks.
 */
export function defaultRegistryFilePath(
  env: Record<string, string | undefined>,
  homeDir: string = os.homedir(),
): string {
  const squadHome = env['SQUAD_HOME'];
  const base = squadHome ? path.resolve(squadHome) : path.join(homeDir, '.squad');
  return path.join(base, 'registry.json');
}
