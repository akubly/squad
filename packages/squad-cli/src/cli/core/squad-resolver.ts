/**
 * Shared Squad directory resolver — wraps the SDK's resolveSquadDir for CLI use.
 */

import { resolveSquadDir as sdkResolveSquadDir } from '@wifi-aware/squad-sdk';

/**
 * Locate the .squad/ directory by walking up from cwd.
 * Returns the absolute path to .squad/ or null if not found.
 *
 * This is the canonical CLI resolver — do not write per-file resolveSquadDir wrappers.
 */
export function resolveSquadDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return sdkResolveSquadDir({ cwd, env })?.path ?? null;
}
