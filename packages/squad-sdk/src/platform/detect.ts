/**
 * Auto-detect platform from git remote URL.
 *
 * @module platform/detect
 */

import { execSync } from 'node:child_process';
import type { PlatformType, WorkItemSource } from './types.js';
import { PlatformConfigError } from './types.js';

/** Parsed GitHub remote info */
export interface GitHubRemoteInfo {
  owner: string;
  repo: string;
}

/** Parsed Azure DevOps remote info */
export interface AzureDevOpsRemoteInfo {
  org: string;
  project: string;
  repo: string;
}

/**
 * Parse a GitHub remote URL into owner/repo.
 * Supports HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
export function parseGitHubRemote(url: string): GitHubRemoteInfo | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }

  return null;
}

/**
 * Parse an Azure DevOps remote URL into org/project/repo.
 * Supports multiple formats:
 *   https://dev.azure.com/org/project/_git/repo
 *   https://org@dev.azure.com/org/project/_git/repo
 *   git@ssh.dev.azure.com:v3/org/project/repo
 *   https://org.visualstudio.com/project/_git/repo
 */
export function parseAzureDevOpsRemote(url: string): AzureDevOpsRemoteInfo | null {
  // HTTPS dev.azure.com: https://dev.azure.com/org/project/_git/repo
  // Also handles: https://org@dev.azure.com/org/project/_git/repo
  const devAzureHttps = url.match(
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+?)(?:\.git)?$/i,
  );
  if (devAzureHttps) {
    return { org: devAzureHttps[1]!, project: devAzureHttps[2]!, repo: devAzureHttps[3]! };
  }

  // SSH dev.azure.com: git@ssh.dev.azure.com:v3/org/project/repo
  const devAzureSsh = url.match(
    /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/i,
  );
  if (devAzureSsh) {
    return { org: devAzureSsh[1]!, project: devAzureSsh[2]!, repo: devAzureSsh[3]! };
  }

  // Legacy SSH visualstudio.com: org@vs-ssh.visualstudio.com:v3/org/project/repo
  const vsSsh = url.match(
    /^[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/)?$/i,
  );
  if (vsSsh) {
    return { org: vsSsh[1]!, project: vsSsh[2]!, repo: vsSsh[3]! };
  }

  // Legacy visualstudio.com: https://org.visualstudio.com/project/_git/repo
  const vsMatch = url.match(
    /([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/.]+?)(?:\.git)?$/i,
  );
  if (vsMatch) {
    return { org: vsMatch[1]!, project: vsMatch[2]!, repo: vsMatch[3]! };
  }

  return null;
}

/**
 * Return a canonical form of a git remote URL for platform matching.
 *
 * Normalisation rules:
 * - Lowercase the host only; preserve owner, org, project, and repo casing.
 * - Strip HTTPS user info (e.g. `org@`), `.git` suffix, and trailing slash.
 * - Collapse all Azure DevOps URL forms (dev.azure.com HTTPS, ssh.dev.azure.com SSH,
 *   and legacy *.visualstudio.com) to `dev.azure.com/{org}/{project}/_git/{repo}`.
 * - Leave non-ADO hosts on a generic canonical `host/path` form.
 */
export function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim();

  // Azure DevOps: normalise all forms to the canonical dev.azure.com path.
  const ado = parseAzureDevOpsRemote(trimmed);
  if (ado) {
    return `dev.azure.com/${ado.org}/${ado.project}/_git/${ado.repo}`;
  }

  // SSH form: git@host:path/to/repo.git
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1]!.toLowerCase();
    const path = sshMatch[2]!.replace(/\.git$/, '').replace(/\/$/, '');
    return `${host}/${path}`;
  }

  // HTTPS form: https?://[user@]host/path[.git][/]
  const httpsMatch = trimmed.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/);
  if (httpsMatch) {
    const host = httpsMatch[1]!.toLowerCase();
    const path = httpsMatch[2]!.replace(/\.git$/, '').replace(/\/$/, '');
    return `${host}/${path}`;
  }

  return trimmed.toLowerCase();
}

/**
 * Detect platform type from git remote URL string.
 * Returns 'github' for github.com remotes, 'azure-devops' for ADO remotes,
 * or 'unknown' for unrecognized hosts.
 */
export function detectPlatformFromUrl(url: string): PlatformType {
  if (/github\.com/i.test(url)) return 'github';
  if (/dev\.azure\.com/i.test(url) || /\.visualstudio\.com/i.test(url) || /ssh\.dev\.azure\.com/i.test(url)) {
    return 'azure-devops';
  }
  return 'unknown';
}

/**
 * Detect platform from a repository root by reading the git remote.
 *
 * Priority chain:
 *   1. `SQUAD_PLATFORM` env var (offline-safe override)
 *   2. `git remote get-url origin` → URL-based detection
 *   3. Typed configuration error with remediation hint
 *
 * Throws PlatformConfigError when origin is missing, the host is unrecognized,
 * or SQUAD_PLATFORM is set to an invalid value.
 * Set `SQUAD_PLATFORM=github|azure-devops` to override.
 */
export function detectPlatform(repoRoot: string): PlatformType {
  // 1. Honor explicit SQUAD_PLATFORM env var before shelling out.
  const envPlatform = process.env['SQUAD_PLATFORM'];
  if (envPlatform) {
    const normalized = envPlatform.toLowerCase().trim();
    if (normalized === 'github' || normalized === 'azure-devops') {
      return normalized as PlatformType;
    }
    // 'planner' is a WorkItemSource, not a git platform.
    if (normalized === 'planner') {
      throw new PlatformConfigError(
        'SQUAD_PLATFORM=planner is not valid. Planner is a work-item source, not a git platform. ' +
        'Set SQUAD_WORK_ITEMS=planner in your squad config instead, and use ' +
        'SQUAD_PLATFORM=github or SQUAD_PLATFORM=azure-devops for the git remote.',
      );
    }
    throw new PlatformConfigError(
      `Invalid SQUAD_PLATFORM value "${envPlatform}". Valid values: github, azure-devops`,
    );
  }

  // 2. Read origin remote URL.
  let remoteUrl: string;
  try {
    remoteUrl = execSync('git remote get-url origin', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new PlatformConfigError(
      'No git remote "origin" found. ' +
      'Set SQUAD_PLATFORM=github|azure-devops to specify the platform without a remote.',
    );
  }

  const platform = detectPlatformFromUrl(remoteUrl);
  if (platform === 'unknown') {
    throw new PlatformConfigError(
      `Unrecognized git host in remote URL "${remoteUrl}". ` +
      'Set SQUAD_PLATFORM=github|azure-devops to override.',
    );
  }

  return platform;
}

/**
 * Detect work-item source for hybrid setups.
 * When a squad config specifies `workItems: 'planner'`, work items come from
 * Planner even though the repo is on GitHub or Azure DevOps.
 * Returns 'unknown' when platform detection fails so callers get an explicit
 * signal rather than a silent GitHub default that may be wrong for ADO repos.
 */
export function detectWorkItemSource(
  repoRoot: string,
  configWorkItems?: string,
): WorkItemSource {
  if (configWorkItems === 'planner') return 'planner';
  try {
    const platform = detectPlatform(repoRoot);
    return platform === 'unknown' ? 'unknown' : platform;
  } catch {
    return 'unknown';
  }
}

/**
 * Get the origin remote URL for a repo, or null if unavailable.
 */
export function getRemoteUrl(repoRoot: string): string | null {
  try {
    return execSync('git remote get-url origin', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
