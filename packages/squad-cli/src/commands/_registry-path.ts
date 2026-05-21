/**
 * Shared registry path resolution for command modules.
 *
 * Centralises the precedence logic: explicit option > env override >
 * process.env.SQUAD_REGISTRY_PATH > user-registry default.
 *
 * @module commands/_registry-path
 */

import path from 'node:path';
import { resolveSquadHome } from '@wifi-aware/squad-sdk';

export interface ResolveRegistryPathOpts {
  explicit?: string;
  env?: Record<string, string>;
}

/**
 * Resolve the registry file path with consistent precedence.
 *
 * 1. `explicit` — caller-supplied path (CLI flag or test override).
 * 2. `env.SQUAD_REGISTRY_PATH` — per-invocation environment override.
 * 3. `process.env.SQUAD_REGISTRY_PATH` — ambient environment variable.
 * 4. User-registry default — `~/.config/squad/registry.json` (or platform equivalent).
 *
 * When a value is a directory path (does not end in `.json`), appends `registry.json`.
 * Returns `null` when no source resolves.
 */
export function resolveRegistryFilePath(opts?: ResolveRegistryPathOpts): string | null {
  const explicit = opts?.explicit;
  if (explicit) {
    return explicit.endsWith('.json') ? explicit : path.join(explicit, 'registry.json');
  }

  const envOverride = opts?.env?.['SQUAD_REGISTRY_PATH'];
  if (envOverride) {
    return envOverride.endsWith('.json') ? envOverride : path.join(envOverride, 'registry.json');
  }

  const processEnv = process.env['SQUAD_REGISTRY_PATH'];
  if (processEnv) {
    return processEnv.endsWith('.json') ? processEnv : path.join(processEnv, 'registry.json');
  }

  const home = resolveSquadHome(false);
  return home ? path.join(home, 'registry.json') : null;
}
