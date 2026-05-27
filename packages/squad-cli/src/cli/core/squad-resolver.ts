/**
 * Shared Squad directory resolver — wraps the SDK's resolveSquad for CLI use.
 */

import { resolveSquad as resolveSquadV2 } from '@bradygaster/squad-sdk';

/**
 * Locate the .squad/ directory by walking up from cwd.
 * Returns the absolute path to .squad/ or null if not found.
 *
 * This is the canonical CLI resolver — do not write per-file resolveSquadDir wrappers.
 */
export function resolveSquadDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveSquadV2({ cwd, env })?.path ?? null;
}
