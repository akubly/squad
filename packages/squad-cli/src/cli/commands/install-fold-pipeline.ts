/**
 * Squad install-fold-pipeline — installs a fold pipeline template into the docs-repo clone.
 *
 * Resolves the docs-repo clone path registry-first (path.dirname(entry.path) from the registry
 * entry matching cwd) then copies the appropriate fold template into the platform's workflow
 * directory. Template source: `.squad-templates/fold/<platform>/fold-squad-state.yml` relative
 * to the CLI package root (5 levels up from this file in both source and compiled output).
 *
 * Three-way idempotency/conflict gate:
 *   absent       → copy template; log installed path.
 *   present+match → exit 0; log "already installed and up to date."
 *   present+differ → exit 1 with actionable message naming the path.
 *
 * Fails fast (exit 1) if the target directory does not exist.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Templates root: package-local templates/fold/ directory.
// In compiled output, __dirname is dist/cli/commands/; ../../../templates/fold reaches
// packages/squad-cli/templates/fold/ (three levels up from dist/cli/commands/ → package root).
const TEMPLATES_ROOT = path.resolve(__dirname, '../../../templates/fold');

const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

export interface InstallFoldPipelineOptions {
  cwd?: string;
  force?: boolean;
}

function getRepoRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Install the fold pipeline template for the given platform into the docs-repo clone.
 *
 * Registry-first resolution: derive docs-repo path from path.dirname(entry.path) via
 * loadRegistryFromDisk + normalisedPathKey. config.json is fallback only for unregistered
 * contexts. Never primary when a registry entry matches.
 */
export async function installFoldPipeline(
  platform: 'github' | 'ado',
  options: InstallFoldPipelineOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // ── Registry-first docs-repo path resolution ──────────────────────────────
  // Exact pattern from runSyncStatus in sync.ts (lines 523–529).
  const repoRoot = getRepoRoot(cwd);
  const { registry } = loadRegistryFromDisk();
  const normalizedRoot = normalisedPathKey(repoRoot);
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
  );

  let docsRepoPath: string | undefined;
  if (entry) {
    docsRepoPath = path.dirname(entry.path); // entry.path ends in .squad
  }

  // Fallback for unregistered/single-repo contexts: read config.json stateLocation
  if (!docsRepoPath) {
    const configPath = path.join(repoRoot, '.squad', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        if (typeof config['stateLocation'] === 'string') {
          docsRepoPath = config['stateLocation'];
        }
      } catch { /* ignore */ }
    }
  }

  if (!docsRepoPath) {
    console.error(
      `✗ Could not resolve shared-squad host clone path. Run 'squad assign' to register a host clone.`,
    );
    process.exit(1);
    return; // unreachable — keeps TypeScript control-flow happy
  }

  // ── Platform → target directory mapping ───────────────────────────────────
  const platformDirMap: Record<'github' | 'ado', string> = {
    github: path.join(docsRepoPath, '.github', 'workflows'),
    ado: path.join(docsRepoPath, '.azuredevops'),
  };
  const targetDir = platformDirMap[platform];

  // Fail fast if the target directory does not exist.
  // Do NOT create missing parent directories — host clone must be bootstrapped first.
  if (!fs.existsSync(targetDir)) {
    console.error(
      `✗ Target directory does not exist: ${targetDir}\n` +
      `  Bootstrap the shared-squad host clone pipeline directory before running install-fold-pipeline.`,
    );
    process.exit(1);
    return;
  }

  // ── Source template path ───────────────────────────────────────────────────
  const templatePath = path.join(TEMPLATES_ROOT, platform, 'fold-squad-state.yml');
  if (!fs.existsSync(templatePath)) {
    console.error(
      `✗ Template not found: ${templatePath}\n` +
      `  The Squad CLI installation may be incomplete.`,
    );
    process.exit(1);
    return;
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  const destPath = path.join(targetDir, 'fold-squad-state.yml');

  // ── Three-way idempotency / conflict gate ─────────────────────────────────
  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath, 'utf-8');
    if (existing === templateContent) {
      console.log(`${GREEN}✓${RESET} fold-squad-state.yml already installed and up to date.`);
      return;
    }
    // Content differs — conflict guard.
    console.error(
      `✗ fold-squad-state.yml exists at ${destPath} with different content.\n` +
      `  Review and delete it manually before re-running install-fold-pipeline.`,
    );
    process.exit(1);
    return;
  }

  // Absent — copy template.
  fs.writeFileSync(destPath, templateContent, 'utf-8');
  console.log(`${GREEN}✓${RESET} Installed fold pipeline template: ${destPath}`);
  console.log(`  Known limitation: the inbox-branch prefix (squad/inbox/) is fixed. To use a different prefix,`);
  console.log(`  change both the CLI and the fold templates together. Future: bake the prefix into the fold template at install time.`);
  if (platform === 'ado') {
    console.log(`  ℹ️  Configure the ADO pipeline to point to .azuredevops/fold-squad-state.yml in the portal.`);
  }
}
