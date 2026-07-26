/**
 * Shared Git repository root detection for CLI commands.
 *
 * Provides a single authoritative helper for locating the Git root from a
 * given working directory. Commands that need the Git root should import from
 * here rather than re-implementing the detection inline.
 *
 * @module lib/git-root
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Returns the Git repository root for the directory at `cwd`, normalized to
 * OS-native path separators. Returns null when `cwd` is not inside a Git
 * repository or Git is unavailable.
 */
export function getGitRoot(cwd: string): string | null {
  try {
    const buf = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return path.normalize(buf.toString('utf8').trim());
  } catch {
    return null;
  }
}
