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
import { ensureSquadStateMcpInRoot } from '../core/mcp-root.js';
import { localSquadStateMcpSpec } from '../core/mcp-spec.js';
import { getPackageVersion } from '../core/version.js';

const storage = new FSStorageProvider();

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

  // Piece 57 §D — wire the squad_state MCP bridge into THIS consumer clone so Copilot's `.mcp.json`
  // auto-load (which walks up from cwd to the git root) finds a bridge whose command resolves
  // locally. This fires for EVERY `squad link` — direct or via the managed cold-start — by design:
  // any clone being linked to a remote team root is a consumer that benefits from a discoverable
  // state bridge, and `squad` is on PATH for anyone who just ran `squad link`/`squad assign`. The
  // `squad_state` key is Squad-owned, so refreshing it to the locally-resolvable spec is intended.
  // Best-effort: a link must never fail because the .mcp.json write hit a malformed pre-existing file.
  try {
    ensureSquadStateMcpInRoot(projectDir, getPackageVersion(), localSquadStateMcpSpec());
  } catch (err) {
    const msg = `Linked, but could not wire squad_state MCP into .mcp.json: ${err instanceof Error ? err.message : String(err)}`;
    if (opts.onWarn) opts.onWarn(msg);
    else console.warn(`⚠ ${msg}`);
  }

  if (!opts.quiet) {
    console.log(`✅ Linked to team root: ${relativePath}`);
  }
}
