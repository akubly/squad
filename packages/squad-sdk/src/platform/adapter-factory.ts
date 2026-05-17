/**
 * Platform adapter factory — creates the right adapter from an origin URL.
 *
 * @module platform/adapter-factory
 */

import type { PlatformAdapter } from './types.js';
import { PlatformConfigError } from './types.js';
import { detectPlatformFromUrl, parseGitHubRemote, parseAzureDevOpsRemote } from './detect.js';
import { GitHubAdapter } from './github.js';
import { AzureDevOpsAdapter } from './azure-devops.js';

/**
 * Create a platform adapter from a git remote origin URL.
 *
 * Detects the platform from the URL and returns the matching adapter.
 * Throws a typed configuration error for unrecognized hosts — never
 * silently falls back to GitHub.
 *
 * @param url - Origin remote URL (HTTPS or SSH)
 * @throws {PlatformConfigError} when the host is not GitHub, Azure DevOps, or another
 *   known platform. Set `SQUAD_PLATFORM` to override.
 */
export function createAdapterForOrigin(url: string): PlatformAdapter {
  const platform = detectPlatformFromUrl(url);

  if (platform === 'github') {
    const info = parseGitHubRemote(url);
    if (!info) {
      throw new PlatformConfigError(
        `Could not parse GitHub remote URL: "${url}". ` +
        'Expected formats: https://github.com/owner/repo or git@github.com:owner/repo',
      );
    }
    return new GitHubAdapter(info.owner, info.repo);
  }

  if (platform === 'azure-devops') {
    const info = parseAzureDevOpsRemote(url);
    if (!info) {
      throw new PlatformConfigError(
        `Could not parse Azure DevOps remote URL: "${url}". ` +
        'Expected formats: https://dev.azure.com/org/project/_git/repo or git@ssh.dev.azure.com:v3/org/project/repo',
      );
    }
    return new AzureDevOpsAdapter(info.org, info.project, info.repo);
  }

  // 'unknown' — fail closed.
  throw new PlatformConfigError(
    `Unrecognized git host in remote URL "${url}". ` +
    'Set SQUAD_PLATFORM=github|azure-devops to specify the platform manually.',
  );
}
