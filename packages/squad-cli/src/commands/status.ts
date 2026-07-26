/**
 * Registry-resolution status field block.
 *
 * Produces the supplemental field block printed by `squad status` when the
 * active squad was resolved through the registry. Returns an empty string for
 * local, platform, or worktree resolution so the existing output is unchanged
 * in those cases.
 *
 * @module commands/status
 */

import path from 'node:path';
import type { ResolvedSquad } from '@bradygaster/squad-sdk/resolution-v2';
import { defaultRegistryFilePath } from '@bradygaster/squad-sdk/path-utils';

/** Source values that indicate the squad was resolved via the registry. */
const REGISTRY_SOURCES = new Set<string>(['env', 'clones', 'origins']);

/** Map a resolver source value to its human-readable match-via label. */
function matchViaLabel(source: string): string {
  switch (source) {
    case 'env':    return 'env var (SQUAD_CALLSIGN)';
    case 'clones': return 'clone path';
    case 'origins': return 'origin URL';
    default:       return source;
  }
}

/**
 * Derive the effective registry file path from an environment record.
 *
 * Mirrors the precedence used by the resolver: explicit SQUAD_REGISTRY_PATH
 * wins, then platform-scoped default.
 */
export function resolveStatusRegistryPath(env: Record<string, string | undefined>): string {
  const envPath = env['SQUAD_REGISTRY_PATH'];
  if (envPath) return envPath;
  return defaultRegistryFilePath(undefined, env);
}

/**
 * Produce the registry-resolution field block for `squad status`.
 *
 * Returns a newline-terminated multi-line string when `resolved.source`
 * indicates registry resolution (`env`, `clones`, or `origins`). Returns an
 * empty string for local, platform, and worktree resolution — the existing
 * status output is unchanged for those sources.
 */
export function formatRegistryStatusBlock(
  resolved: ResolvedSquad,
  env: Record<string, string | undefined>,
): string {
  if (!REGISTRY_SOURCES.has(resolved.source)) {
    return '';
  }

  const registryPath = resolveStatusRegistryPath(env);
  const hostRepo = path.resolve(resolved.path, '..');

  const lines: string[] = [`  Resolution:    registry`];

  if (resolved.callsign) {
    lines.push(`  Callsign:      ${resolved.callsign}`);
  }

  lines.push(`  Registry path: ${registryPath}`);
  lines.push(`  Match via:     ${matchViaLabel(resolved.source)}`);

  if (resolved.source === 'origins' && resolved.matchedOrigin) {
    lines.push(`  Matched origin: ${resolved.matchedOrigin}`);
  }

  lines.push(`  Host repo:     ${hostRepo}`);

  return lines.join('\n') + '\n';
}
