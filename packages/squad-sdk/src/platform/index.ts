/**
 * Platform module — public API barrel.
 *
 * Public surface (per spec piece-12):
 *   PlatformType, WorkItem, PullRequest, PlatformAdapter
 *   PlatformConfigError
 *   createAdapterForOrigin, normalizeRemoteUrl
 *   parseGitHubRemote, parseAzureDevOpsRemote
 *   createPlatformAdapter (repoRoot convenience wrapper)
 *
 * @module platform
 */

export type { PlatformType, WorkItem, PullRequest, PlatformAdapter } from './types.js';
export { PlatformConfigError } from './types.js';
export { parseGitHubRemote, parseAzureDevOpsRemote, normalizeRemoteUrl } from './detect.js';
export { createAdapterForOrigin } from './adapter-factory.js';

import { join } from 'node:path';
import { FSStorageProvider } from '../storage/fs-storage-provider.js';
import type { PlatformAdapter } from './types.js';
import { PlatformConfigError } from './types.js';
import { detectPlatform, getRemoteUrl, parseGitHubRemote, parseAzureDevOpsRemote } from './detect.js';
import { GitHubAdapter } from './github.js';
import { AzureDevOpsAdapter } from './azure-devops.js';
import type { AdoWorkItemConfig } from './azure-devops.js';

const storage = new FSStorageProvider();

/**
 * Read explicit GitHub repo override from .squad/config.json if present.
 * Expected shape: { "github": { "owner": "...", "repo": "..." } }
 */
function readGitHubConfig(repoRoot: string): { owner: string; repo: string } | undefined {
  const configPath = join(repoRoot, '.squad', 'config.json');
  if (!storage.existsSync(configPath)) return undefined;
  try {
    const raw = storage.readSync(configPath) ?? '';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.github && typeof parsed.github === 'object') {
      const gh = parsed.github as Record<string, unknown>;
      if (typeof gh.owner === 'string' && typeof gh.repo === 'string') {
        return { owner: gh.owner, repo: gh.repo };
      }
    }
  } catch { /* ignore parse errors */ }
  return undefined;
}

/**
 * Read ADO work item config from .squad/config.json if present.
 */
function readAdoConfig(repoRoot: string): AdoWorkItemConfig | undefined {
  const configPath = join(repoRoot, '.squad', 'config.json');
  if (!storage.existsSync(configPath)) return undefined;
  try {
    const raw = storage.readSync(configPath) ?? '';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.ado && typeof parsed.ado === 'object') {
      return parsed.ado as AdoWorkItemConfig;
    }
  } catch { /* ignore parse errors */ }
  return undefined;
}

/**
 * Create a platform adapter by auto-detecting the platform from the repo's git remote.
 * Throws if required remote info cannot be parsed.
 */
export function createPlatformAdapter(repoRoot: string): PlatformAdapter {
  // Prefer explicit GitHub config from .squad/config.json
  const ghConfig = readGitHubConfig(repoRoot);
  if (ghConfig) {
    return new GitHubAdapter(ghConfig.owner, ghConfig.repo);
  }

  const platform = detectPlatform(repoRoot);
  const remoteUrl = getRemoteUrl(repoRoot);

  if (!remoteUrl) {
    throw new PlatformConfigError(
      'No git remote "origin" found. Set SQUAD_PLATFORM=github|azure-devops to specify the platform without a remote.',
    );
  }

  if (platform === 'azure-devops') {
    const info = parseAzureDevOpsRemote(remoteUrl);
    if (!info) {
      throw new PlatformConfigError(
        `Could not parse Azure DevOps remote URL: "${remoteUrl}". ` +
        'Expected formats: https://dev.azure.com/org/project/_git/repo or git@ssh.dev.azure.com:v3/org/project/repo',
      );
    }
    const adoConfig = readAdoConfig(repoRoot);
    return new AzureDevOpsAdapter(info.org, info.project, info.repo, adoConfig);
  }

  const info = parseGitHubRemote(remoteUrl);
  if (!info) {
    throw new PlatformConfigError(
      `Could not parse GitHub remote URL: "${remoteUrl}". ` +
      'Expected formats: https://github.com/owner/repo or git@github.com:owner/repo',
    );
  }
  return new GitHubAdapter(info.owner, info.repo);
}
