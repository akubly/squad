/**
 * squad_state MCP entry writers + stale-entry GC.
 *
 * The `squad_state` bridge is delivered to one of two surfaces, chosen by the
 * team's state backend (see `cli/commands/link`):
 *
 *  - `local` teams — iter-8 repo-root `.mcp.json` writer
 *    ({@link ensureSquadStateMcpInRoot}) under the plain `squad_state` key.
 *    Copilot CLI ≥1.0.59 auto-loads `.mcp.json` walking up from cwd to the git
 *    root, so bare `copilot --yolo --autopilot --agent squad ...` picks it up
 *    with no wrapper script and no HOME modifications.
 *    {@link tombstoneStaleSquadStateInProjectMcp} removes any stale `squad_state`
 *    left in the project `.copilot/mcp-config.json` by older SDK init writers, so
 *    there is exactly one authoritative definition per project.
 *
 *  - orphan/two-layer (git-native) teams (piece 58 §A/§G1) — the product clone
 *    must NOT carry a repo-local `.mcp.json`, so the bridge is registered at the
 *    USER level ({@link ensureSquadStateMcpInUserConfig}) under a SINGLE stable
 *    `squad_state` key. The launch spec (`squad state-mcp`) is cwd-resolved and
 *    carries no team root, so one user-level entry serves every clone.
 *
 * History: iter-7 wrote `squad_state_<hash>` into HOME — one entry per project
 * path — which polluted HOME and required a stale-entry GC that was never built.
 * iter-8 moved `local` back inside the project to avoid touching HOME. Piece 58
 * §A had to return to HOME for orphan/two-layer (a repo-local `.mcp.json` is not
 * sanctioned for a shared-host orphan product clone), but keeps ONE stable key
 * and finally ships the HOME GC ({@link tombstoneStaleHashedSquadStateInUserMcp})
 * that reaps any leftover `squad_state_<hash>` entries.
 *
 * Safety: writers refuse to overwrite a malformed config rather than silently
 * clobber a user-edited file; all other `mcpServers.*` entries are preserved
 * byte-for-byte through the JSON round-trip.
 *
 * @module cli/core/mcp-root
 */

import path from 'node:path';
import { FSStorageProvider } from '@wifi-aware/squad-sdk';
import type { SquadStateMcpSpec } from './mcp-spec.js';

const storage = new FSStorageProvider();

/** Resolve the repo-root `.mcp.json` path for a Squad project dest. */
export function getProjectMcpJsonPath(dest: string): string {
  return path.join(dest, '.mcp.json');
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
}

interface McpConfigShape {
  mcpServers?: Record<string, McpServerEntry>;
  [k: string]: unknown;
}

export interface EnsureRootResult {
  written: boolean;
  key: string;
  path: string;
}

/**
 * Insert/update the `squad_state` entry in the project's repo-root
 * `.mcp.json`. Preserves all other entries unchanged.
 *
 * @param dest         Squad project root (absolute or relative).
 * @param _cliVersion  Reserved for forensic metadata (unused — Copilot
 *                     CLI does not currently surface extra fields).
 * @param spec         Pinned/insider command + args from
 *                     `resolveSquadStateMcpSpec`.
 */
export function ensureSquadStateMcpInRoot(
  dest: string,
  _cliVersion: string,
  spec: SquadStateMcpSpec,
): EnsureRootResult {
  const key = 'squad_state';
  const cfgPath = getProjectMcpJsonPath(dest);

  let parsed: McpConfigShape;
  if (storage.existsSync(cfgPath)) {
    const raw = storage.readSync(cfgPath) ?? '{}';
    try {
      const obj = JSON.parse(raw) as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error(`${cfgPath}: root must be a JSON object`);
      }
      parsed = obj as McpConfigShape;
    } catch (err) {
      throw new Error(
        `Refusing to overwrite malformed ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    parsed = {};
  }

  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    parsed.mcpServers = {};
  }

  const existing = parsed.mcpServers[key];
  const desired: McpServerEntry = {
    command: spec.command,
    args: [...spec.args],
    env: {},
    tools: ['*'],
  };

  if (
    existing &&
    existing.command === desired.command &&
    Array.isArray(existing.args) &&
    existing.args.length === desired.args!.length &&
    existing.args.every((a, i) => a === desired.args![i]) &&
    existing.env &&
    typeof existing.env === 'object' &&
    Object.keys(existing.env).length === 0 &&
    Array.isArray(existing.tools) &&
    existing.tools.length === 1 &&
    existing.tools[0] === '*'
  ) {
    return { written: false, key, path: cfgPath };
  }

  parsed.mcpServers[key] = desired;

  storage.writeSync(cfgPath, JSON.stringify(parsed, null, 2) + '\n');
  return { written: true, key, path: cfgPath };
}

export interface TombstoneResult {
  removed: boolean;
  path: string;
}

/**
 * Remove a stale top-level `squad_state` entry from the project
 * `.copilot/mcp-config.json` left there by older Squad versions or the
 * SDK init writer. Preserves all sibling entries.
 *
 * Best-effort: silently no-ops on a missing or unparseable file rather
 * than risking a partial overwrite of user-managed MCP config.
 */
export function tombstoneStaleSquadStateInProjectMcp(dest: string): TombstoneResult {
  const cfgPath = path.join(dest, '.copilot', 'mcp-config.json');
  if (!storage.existsSync(cfgPath)) return { removed: false, path: cfgPath };

  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.readSync(cfgPath) ?? '{}');
  } catch {
    return { removed: false, path: cfgPath };
  }
  if (!parsed || typeof parsed !== 'object') return { removed: false, path: cfgPath };

  const config = parsed as McpConfigShape;
  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    return { removed: false, path: cfgPath };
  }
  if (!('squad_state' in config.mcpServers)) {
    return { removed: false, path: cfgPath };
  }

  delete config.mcpServers.squad_state;
  storage.writeSync(cfgPath, JSON.stringify(config, null, 2) + '\n');
  return { removed: true, path: cfgPath };
}

/**
 * Register the `squad_state` bridge at the USER level
 * (`~/.copilot/mcp-config.json`) for orphan/two-layer (git-native) teams,
 * whose product clone must NOT carry a repo-local `.mcp.json` (piece 58 §A/§G1).
 *
 * Uses a SINGLE stable `squad_state` key — NOT a per-path hash. The launch
 * spec (`squad state-mcp`) carries no `--team-root`: it resolves the squad from
 * the session cwd (see `cli/commands/state-mcp`), so one user-level entry serves
 * every clone. A per-path key (iter-7) would pollute HOME with one redundant,
 * identically-cwd-resolving entry per clone and require a GC — exactly the
 * regression this design avoids (see the module header and
 * {@link tombstoneStaleHashedSquadStateInUserMcp}).
 *
 * Idempotent: a pre-existing `squad_state` entry with the same command+args —
 * including one a user added by hand — is left untouched. All other
 * `mcpServers.*` entries are preserved byte-for-byte.
 *
 * Best-effort: silently no-ops on parse failure to avoid corrupting the
 * user's hand-edited config.
 */
export function ensureSquadStateMcpInUserConfig(
  spec: SquadStateMcpSpec,
): EnsureRootResult {
  const homedir = process.env.HOME || process.env.USERPROFILE || '';
  if (!homedir) return { written: false, key: '', path: '' };

  const cfgPath = path.join(homedir, '.copilot', 'mcp-config.json');
  const key = 'squad_state';

  let parsed: McpConfigShape;
  if (storage.existsSync(cfgPath)) {
    const raw = storage.readSync(cfgPath) ?? '{}';
    try {
      const obj = JSON.parse(raw) as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { written: false, key, path: cfgPath };
      }
      parsed = obj as McpConfigShape;
    } catch {
      return { written: false, key, path: cfgPath };
    }
  } else {
    parsed = {};
  }

  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    parsed.mcpServers = {};
  }

  const existing = parsed.mcpServers[key];
  const desired: McpServerEntry = {
    command: spec.command,
    args: [...spec.args],
    env: {},
    tools: ['*'],
  };

  if (
    existing &&
    existing.command === desired.command &&
    Array.isArray(existing.args) &&
    existing.args.length === desired.args!.length &&
    existing.args.every((a, i) => a === desired.args![i])
  ) {
    return { written: false, key, path: cfgPath };
  }

  parsed.mcpServers[key] = desired;

  // Ensure parent directory exists
  const cfgDir = path.dirname(cfgPath);
  if (!storage.existsSync(cfgDir)) {
    storage.mkdirSync(cfgDir, { recursive: true });
  }

  storage.writeSync(cfgPath, JSON.stringify(parsed, null, 2) + '\n');
  return { written: true, key, path: cfgPath };
}

/**
 * Remove stale per-path `squad_state_<hash>` entries (iter-7 format) from the
 * user's `~/.copilot/mcp-config.json`.
 *
 * Piece 58 §A registers the user-level state bridge under a single stable
 * `squad_state` key ({@link ensureSquadStateMcpInUserConfig}). An earlier
 * iteration — and the initial piece-58 build — instead wrote one
 * `squad_state_<shortHash>` entry per project path, which accumulated in HOME
 * with no cleanup; because `squad state-mcp` is cwd-resolved, every such entry
 * redundantly resolves the SAME session cwd, spawning duplicate bridges. This
 * is the "stale-entry GC we never built": it reaps those hashed entries so HOME
 * carries exactly one authoritative `squad_state` definition.
 *
 * Matches ONLY the 8-hex-char hashed format this project ever emitted
 * (`/^squad_state_[0-9a-f]{8}$/`), so a user's own `squad_state` and any
 * unrelated `mcpServers.*` key are preserved. Best-effort: silently no-ops on a
 * missing or unparseable file rather than risking a partial overwrite.
 */
export function tombstoneStaleHashedSquadStateInUserMcp(): TombstoneResult {
  const homedir = process.env.HOME || process.env.USERPROFILE || '';
  const cfgPath = homedir ? path.join(homedir, '.copilot', 'mcp-config.json') : '';
  if (!homedir || !storage.existsSync(cfgPath)) return { removed: false, path: cfgPath };

  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.readSync(cfgPath) ?? '{}');
  } catch {
    return { removed: false, path: cfgPath };
  }
  if (!parsed || typeof parsed !== 'object') return { removed: false, path: cfgPath };

  const config = parsed as McpConfigShape;
  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    return { removed: false, path: cfgPath };
  }

  const hashedKeyRe = /^squad_state_[0-9a-f]{8}$/;
  const staleKeys = Object.keys(config.mcpServers).filter((k) => hashedKeyRe.test(k));
  if (staleKeys.length === 0) return { removed: false, path: cfgPath };

  for (const k of staleKeys) delete config.mcpServers[k];
  storage.writeSync(cfgPath, JSON.stringify(config, null, 2) + '\n');
  return { removed: true, path: cfgPath };
}
