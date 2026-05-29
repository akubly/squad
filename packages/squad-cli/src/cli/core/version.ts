/**
 * Version stamping and reading utilities — zero dependencies
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FSStorageProvider } from '@wifi-aware/squad-sdk';

const storage = new FSStorageProvider();

/**
 * Get package version from package.json
 * Walks up from the current file to find package.json — works from both
 * compiled dist/cli/core/version.js and bundled cli.js at the root.
 */
export function getPackageVersion(): string {
  const currentFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(currentFile);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'package.json');
    if (storage.existsSync(candidate)) {
      const pkg = JSON.parse(storage.readSync(candidate) ?? '{}');
      return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

export function applyVersionStamp(content: string, version: string): string {
  let stamped = content;
  // Replace version in HTML comment (must come immediately after frontmatter closing ---)
  stamped = stamped.replace(/<!-- version: [^>]+ -->/m, `<!-- version: ${version} -->`);
  // Replace version in the Identity section's Version line (matches any semver including multi-segment prerelease)
  stamped = stamped.replace(/- \*\*Version:\*\* \S+/m, `- **Version:** ${version}`);
  // Replace {version} placeholder in the greeting instruction so it's unambiguous
  stamped = stamped.replace(/`Squad v\{version\}`/g, `\`Squad v${version}\``);
  return stamped;
}

/**
 * Stamp version into squad.agent.md after copying
 */
export function stampVersion(filePath: string, version: string): void {
  const content = storage.readSync(filePath) ?? '';
  storage.writeSync(filePath, applyVersionStamp(content, version));
}

/**
 * Read version from squad.agent.md HTML comment
 */
export function readInstalledVersion(filePath: string): string | null {
  try {
    if (!storage.existsSync(filePath)) return null;
    const content = storage.readSync(filePath) ?? '';
    // Try to read from HTML comment first (new format)
    const commentMatch = content.match(/<!-- version: ([^\s>]+) -->/);
    if (commentMatch) return commentMatch[1]!;
    // Fallback: try old frontmatter format for backward compatibility during upgrade
    const frontmatterMatch = content.match(/^version:\s*"([^"]+)"/m);
    return frontmatterMatch ? frontmatterMatch[1]! : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
