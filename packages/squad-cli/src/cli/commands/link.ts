/**
 * squad link <team-repo-path> — link a project to a remote team root.
 *
 * Writes `.squad/config.json` with a relative `teamRoot` path so the
 * dual-root resolver (resolveSquadPaths) can find the team identity dir.
 *
 * Remote squad mode concept by @spboyer (Shayne Boyer), PR bradygaster/squad#131.
 *
 * @module cli/commands/link
 */

import path from 'node:path';
import { FSStorageProvider, clearResolveSquadCache } from '@wifi-aware/squad-sdk';
import { fatal } from '../core/errors.js';
import { ensureSquadStateMcpInRoot, ensureSquadStateMcpInUserConfig, tombstoneStaleHashedSquadStateInUserMcp } from '../core/mcp-root.js';
import { localSquadStateMcpSpec } from '../core/mcp-spec.js';
import { getPackageVersion } from '../core/version.js';

const storage = new FSStorageProvider();

/**
 * Read the declared `stateBackend` from a team `.squad`/`.ai-team` config.json.
 * Independent of {@link loadDirConfig}'s `teamRoot` requirement — we only need
 * the backend string, which a host config may carry without a `teamRoot` field.
 * Returns undefined for missing/unreadable/malformed config.
 */
function readTeamStateBackend(teamSquadDir: string): string | undefined {
  const cfgPath = path.join(teamSquadDir, 'config.json');
  if (!storage.existsSync(cfgPath)) return undefined;
  try {
    const parsed = JSON.parse(storage.readSync(cfgPath) ?? '{}') as { stateBackend?: unknown };
    return typeof parsed?.stateBackend === 'string' ? parsed.stateBackend : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when the team's state backend is git-native (orphan / two-layer, or the
 * deprecated git-notes alias that migrates to two-layer). Piece 58 §A/§G1: these
 * backends get a USER-LEVEL `squad_state` registration and skip the repo-local
 * `.mcp.json`; a `local` team keeps piece 57 §D's repo-local writer.
 */
function isUserLevelBackend(backend: string | undefined): boolean {
  return backend === 'orphan' || backend === 'two-layer' || backend === 'git-notes';
}

/**
 * Options for {@link runLink}. Omitted for interactive `squad link` (messages go to the console);
 * supplied by programmatic callers (e.g. the managed cold-start in `assign`) that collect their own
 * structured output.
 */
export interface RunLinkOptions {
  /**
   * Sink for the non-fatal `.mcp.json` wiring warning. When set, the warning is handed here instead
   * of printed, so the caller can fold it into its own `warnings[]` rather than interleaving raw
   * `console.warn` output with a structured summary.
   */
  onWarn?: (msg: string) => void;
  /** Suppress the interactive success log line (callers that print their own onboarding summary). */
  quiet?: boolean;
}

/**
 * Link the current project to a remote team root.
 *
 * @param projectDir - Project root (cwd or explicit).
 * @param teamRepoPath - Path (relative or absolute) to the team repo.
 * @param opts - Optional programmatic-caller hooks (warning sink / quiet). See {@link RunLinkOptions}.
 */
export function runLink(projectDir: string, teamRepoPath: string, opts: RunLinkOptions = {}): void {
  // Resolve the team repo path to an absolute path
  const absoluteTeam = path.resolve(projectDir, teamRepoPath);

  // Validate the target exists
  if (!storage.existsSync(absoluteTeam)) {
    fatal(`Target path does not exist: ${absoluteTeam}`);
  }

  if (!storage.isDirectorySync(absoluteTeam)) {
    fatal(`Target path is not a directory: ${absoluteTeam}`);
  }

  // Validate the target contains a .squad/ or .ai-team/ directory
  const hasSquad = storage.existsSync(path.join(absoluteTeam, '.squad'));
  const hasAiTeam = storage.existsSync(path.join(absoluteTeam, '.ai-team'));
  if (!hasSquad && !hasAiTeam) {
    fatal(`Target does not contain a .squad/ directory: ${absoluteTeam}`);
  }

  // Ensure .squad/ exists locally
  const squadDir = path.join(projectDir, '.squad');
  storage.mkdirSync(squadDir, { recursive: true });

  // Compute relative path from project root to team repo
  const relativePath = path.relative(projectDir, absoluteTeam);

  const config = {
    version: 1,
    teamRoot: relativePath,
    projectKey: null,
  };

  storage.writeSync(
    path.join(squadDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );

  // Ensure .squad/config.json is in .gitignore (machine-local path, never commit)
  const gitignorePath = path.join(projectDir, '.gitignore');
  const ignoreEntry = '.squad/config.json';
  let existingIgnore = '';
  if (storage.existsSync(gitignorePath)) {
    existingIgnore = storage.readSync(gitignorePath) ?? '';
  }
  if (!existingIgnore.includes(ignoreEntry)) {
    const block = (existingIgnore && !existingIgnore.endsWith('\n') ? '\n' : '')
      + '# Squad: local config (machine-specific paths, never commit)\n'
      + ignoreEntry + '\n';
    storage.appendSync(gitignorePath, block);
  }

  // Link just (re)created `.squad/` and wrote config.json. Any subsequent
  // code in this process that calls resolveSquad()/resolveSquadPaths()
  // would otherwise be served the cached "not found" result from before
  // link ran. Drop the cache so the new directory is observed immediately
  // instead of after the 5-second TTL.
  clearResolveSquadCache();

  // Piece 58 §A/§G1 — deliver the squad_state bridge to the surface that matches the team's
  // state backend. For orphan/two-layer (git-native) teams the bridge is registered at the
  // USER level (`~/.copilot/mcp-config.json`) — the repo-local `.mcp.json` piece 57 §D wrote is
  // NOT sanctioned for a shared-host orphan config, so it is skipped here. For a `local` team we
  // keep piece 57 §D's repo-local `.mcp.json`. In BOTH cases the bridge is the locally-resolvable
  // `squad state-mcp` spec (`squad` is on PATH for anyone who just ran `squad link`/`squad assign`),
  // and `squad state-mcp` resolves the squad from the session cwd — so one user-level entry serves
  // every clone. Best-effort: a link must never fail because an MCP write hit a malformed file.
  const teamSquadDir = hasSquad ? path.join(absoluteTeam, '.squad') : path.join(absoluteTeam, '.ai-team');
  const teamBackend = readTeamStateBackend(teamSquadDir);

  if (isUserLevelBackend(teamBackend)) {
    try {
      ensureSquadStateMcpInUserConfig(localSquadStateMcpSpec());
      // Reap any stale per-path `squad_state_<hash>` entries an earlier build wrote
      // into HOME, so one stable `squad_state` entry remains (piece 58 §A fix).
      tombstoneStaleHashedSquadStateInUserMcp();
    } catch (err) {
      const msg = `Linked, but could not wire squad_state MCP into the user config: ${err instanceof Error ? err.message : String(err)}`;
      if (opts.onWarn) opts.onWarn(msg);
      else console.warn(`⚠ ${msg}`);
    }
  } else {
    // `local` (or undeclared) backend — keep the repo-root `.mcp.json` writer (piece 57 §D).
    // Capture whether a `.mcp.json` already existed BEFORE we (possibly) create it: if Squad
    // freshly creates the file it is machine-local (the bridge command resolves against THIS
    // machine's install) and must be gitignored like config.json; if the repo already owned a
    // `.mcp.json` we merged into, it is the project's file and we must not gitignore it.
    const mcpRootPath = path.join(projectDir, '.mcp.json');
    const mcpPreexisted = storage.existsSync(mcpRootPath);
    try {
      ensureSquadStateMcpInRoot(projectDir, getPackageVersion(), localSquadStateMcpSpec());
      // Only ignore a `.mcp.json` that Squad itself created (machine-local); never a pre-existing one.
      if (!mcpPreexisted) {
        const mcpIgnoreEntry = '.mcp.json';
        const currentIgnore = storage.existsSync(gitignorePath) ? (storage.readSync(gitignorePath) ?? '') : '';
        if (!currentIgnore.split(/\r?\n/).some((l) => l.trim() === mcpIgnoreEntry)) {
          const block = (currentIgnore && !currentIgnore.endsWith('\n') ? '\n' : '')
            + '# Squad: local MCP bridge config (machine-specific command, never commit)\n'
            + mcpIgnoreEntry + '\n';
          storage.appendSync(gitignorePath, block);
        }
      }
    } catch (err) {
      const msg = `Linked, but could not wire squad_state MCP into .mcp.json: ${err instanceof Error ? err.message : String(err)}`;
      if (opts.onWarn) opts.onWarn(msg);
      else console.warn(`⚠ ${msg}`);
    }
  }

  if (!opts.quiet) {
    console.log(`✅ Linked to team root: ${relativePath}`);
  }
}
