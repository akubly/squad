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
import fs from 'node:fs';
import type { ResolvedSquad } from '@wifi-aware/squad-sdk/resolution-v2';
import { defaultRegistryFilePath } from '@wifi-aware/squad-sdk/path-utils';
import { resolveTeamRoot, normalisedPathKey } from '@wifi-aware/squad-sdk';
import { loadRegistryFromDisk } from '@wifi-aware/squad-sdk/registry';

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

/**
 * Machine-readable status payload emitted by `squad status --json` (piece 57 §C).
 *
 * The human `squad status` output is unchanged; `--json` was previously parsed
 * but silently ignored. These are exactly the fields a script or agent needs to
 * resolve the team root without probing the filesystem for `team.md`.
 */
export interface StatusJson {
  /** True when a team root resolved. */
  resolved: boolean;
  /** Registry callsign, or null when the squad is a plain local one. */
  callsign: string | null;
  /** Absolute path to the resolved team `.squad/` directory (where team.md lives). */
  teamRoot: string | null;
  /** Resolver precedence bucket that matched (local/env/clones/origins/...). */
  source: string | null;
  /** True when the resolved host is a CLI-managed clone. */
  managed: boolean;
  /** Active state backend name (local/orphan/two-layer/...). Defaults to 'local'. */
  stateBackend: string;
  /** Machine-parseable reason when {@link resolved} is false. */
  reason?: string;
}

/**
 * Build the `squad status --json` payload.
 *
 * Resolves the team root via the registry- and link-aware resolver, then
 * augments it with registry-derived (`managed`) and config-derived
 * (`stateBackend`) fields. Best-effort: registry/config read failures degrade
 * to `managed:false` / `stateBackend:'local'` rather than throwing.
 */
export function buildStatusJson(
  startDir: string,
  env: Record<string, string | undefined>,
): StatusJson {
  const info = resolveTeamRoot({ cwd: startDir, env });
  if (!info.resolved || !info.teamRoot) {
    return {
      resolved: false,
      callsign: null,
      teamRoot: null,
      source: info.source ?? null,
      managed: false,
      stateBackend: 'local',
      reason: info.reason ?? 'no-squad-resolved',
    };
  }

  let entry: { callsign?: string; path?: string; managed?: boolean; stateBackend?: string } | undefined;
  try {
    const registryPath = resolveStatusRegistryPath(env);
    const { registry } = loadRegistryFromDisk({ registryPath });
    const teamKey = normalisedPathKey(info.teamRoot);
    entry = (registry?.squads ?? []).find(s =>
      (info.callsign != null && s.callsign === info.callsign) ||
      (s.path != null && normalisedPathKey(s.path) === teamKey),
    );
  } catch {
    // best-effort — an unreadable registry just means we cannot tag managed.
  }

  const callsign = info.callsign ?? entry?.callsign ?? null;
  const managed = entry?.managed === true;

  let stateBackend = typeof entry?.stateBackend === 'string' && entry.stateBackend
    ? entry.stateBackend
    : 'local';
  try {
    const cfgPath = path.join(info.teamRoot, 'config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { stateBackend?: unknown };
      if (typeof cfg.stateBackend === 'string' && cfg.stateBackend) stateBackend = cfg.stateBackend;
    }
  } catch {
    // config read/parse failure — keep the registry/default value.
  }

  return { resolved: true, callsign, teamRoot: info.teamRoot, source: info.source, managed, stateBackend };
}
