/**
 * Squad install-fold-pipeline — installs a fold pipeline template into the host repository.
 *
 * Resolves the host repository root registry-first (git rev-parse --show-toplevel from
 * the registry entry matching cwd) then copies the appropriate fold template into the platform's workflow
 * directory. Template source: `.squad-templates/fold/<platform>/fold-squad-state.yml` relative
 * to the CLI package root (5 levels up from this file in both source and compiled output).
 *
 * Three-way idempotency/conflict gate:
 *   absent       → copy template; log installed path.
 *   present+match → exit 0; log "already installed and up to date."
 *   present+differ → exit 1 with actionable message naming the path.
 *
 * Fails fast (exit 1) if the host root cannot be resolved or the target directory does not exist.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import { CALLSIGN_RE } from '@bradygaster/squad-sdk/validation';

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
  /** Optional callsign to scope the pipeline trigger and fold target to this squad. */
  callsign?: string;
}

function tryGetRepoRoot(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

function resolveRepoRootOrExit(cwd: string, label: string): string | undefined {
  const repoRoot = tryGetRepoRoot(cwd);
  if (repoRoot) {
    return repoRoot;
  }

  console.error(
    `✗ Could not resolve git repository root for ${label}: ${cwd}\n` +
    `  install-fold-pipeline must target a host clone inside a git work tree.`,
  );
  process.exit(1);
  return undefined;
}

/**
 * Install the fold pipeline template for the given platform into the host repository.
 *
 * Registry-first resolution: derive host repository root from the registry entry path via
 * loadRegistryFromDisk + normalisedPathKey + git rev-parse. config.json is fallback only for unregistered
 * contexts. Never primary when a registry entry matches.
 */
export async function installFoldPipeline(
  platform: 'github' | 'ado',
  options: InstallFoldPipelineOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // ── Validate --callsign when provided ────────────────────────────────────
  const callsign = options.callsign;
  if (callsign !== undefined && !CALLSIGN_RE.test(callsign)) {
    console.error(
      `✗ Invalid --callsign "${callsign}": must match /^[a-z][a-z0-9-]{1,38}$/ ` +
      `(lowercase, starts with a letter, hyphens allowed, max 39 chars).`,
    );
    process.exit(1);
    return;
  }

  // ── Registry-first host root resolution ───────────────────────────────────
  // Exact pattern from runSyncStatus in sync.ts (lines 523–529).
  const repoRoot = resolveRepoRootOrExit(cwd, 'current directory');
  if (!repoRoot) return;
  const { registry } = loadRegistryFromDisk();
  const normalizedRoot = normalisedPathKey(repoRoot);
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalizedRoot),
  );

  let hostRepoRoot: string | undefined;
  if (entry) {
    const entryDir = path.dirname(entry.path); // entry.path ends in .squad
    hostRepoRoot = resolveRepoRootOrExit(entryDir, 'registered host');
    if (!hostRepoRoot) return;
  }

  // Fallback for unregistered/single-repo contexts: read config.json stateLocation
  if (!hostRepoRoot) {
    const configPath = path.join(repoRoot, '.squad', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        if (typeof config['stateLocation'] === 'string') {
          hostRepoRoot = resolveRepoRootOrExit(config['stateLocation'], 'configured stateLocation');
          if (!hostRepoRoot) return;
        }
      } catch { /* ignore */ }
    }
  }

  if (!hostRepoRoot) {
    console.error(
      `✗ Could not resolve shared-squad host clone path. Run 'squad assign' to register a host clone.`,
    );
    process.exit(1);
    return; // unreachable — keeps TypeScript control-flow happy
  }

  // ── Platform → target directory mapping ───────────────────────────────────
  const platformDirMap: Record<'github' | 'ado', string> = {
    github: path.join(hostRepoRoot, '.github', 'workflows'),
    ado: path.join(hostRepoRoot, '.azuredevops'),
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

  const rawTemplate = fs.readFileSync(templatePath, 'utf-8');

  // ── Callsign parameterization ─────────────────────────────────────────────
  // When --callsign is provided, scope the trigger glob and fold target to this squad.
  // When absent, emit the callsign-generic template verbatim.
  let templateContent: string;
  if (callsign) {
    if (platform === 'github') {
      templateContent = rawTemplate
        // Scope trigger glob (on.push.branches) to this callsign's inbox prefix.
        .replace(/- 'squad\/inbox\/\*\*'/g, `- 'squad/inbox/${callsign}/**'`)
        .replace(/callsigns="\$\(git ls-remote --heads origin 'refs\/heads\/squad\/inbox\/\*'[\s\S]*?\| sort -u\)"/,
          `callsigns="${callsign}"`)
        .replace(/STATE_BRANCH="squad\/state\/\$CALLSIGN"/g, `STATE_BRANCH="squad/state/${callsign}"`)
        // Scope any remaining inbox ref patterns to this callsign namespace.
        .replace(/'refs\/heads\/squad\/inbox\/\*'/g, `'refs/heads/squad/inbox/${callsign}/*'`)
        .replace(/squad-state/g, `squad/state/${callsign}`);
    } else {
      // ADO
      templateContent = rawTemplate
        // Scope trigger branch include to this callsign's inbox prefix.
        .replace(/- refs\/heads\/squad\/inbox\/\*/g, `- refs/heads/squad/inbox/${callsign}/*`)
        .replace(/callsigns="`git ls-remote --heads origin 'refs\/heads\/squad\/inbox\/\*'[\s\S]*?\| sort -u`"/,
          `callsigns="${callsign}"`)
        .replace(/STATE_BRANCH="squad\/state\/\$CALLSIGN"/g, `STATE_BRANCH="squad/state/${callsign}"`)
        // Scope any remaining inbox ref patterns to this callsign namespace.
        .replace(/'refs\/heads\/squad\/inbox\/\*'/g, `'refs/heads/squad/inbox/${callsign}/*'`)
        .replace(/squad-state/g, `squad/state/${callsign}`);
    }
  } else {
    templateContent = rawTemplate;
  }

  const filename = callsign ? `fold-squad-state.${callsign}.yml` : 'fold-squad-state.yml';
  const destPath = path.join(targetDir, filename);

  // ── Three-way idempotency / conflict gate ─────────────────────────────────
  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath, 'utf-8');
    if (existing === templateContent) {
      console.log(`${GREEN}✓${RESET} ${filename} already installed and up to date.`);
      return;
    }
    // Content differs — conflict guard.
    console.error(
      `✗ ${filename} exists at ${destPath} with different content.\n` +
      `  Review and delete it manually before re-running install-fold-pipeline.`,
    );
    process.exit(1);
    return;
  }

  // Absent — write template.
  fs.writeFileSync(destPath, templateContent, 'utf-8');
  console.log(`${GREEN}✓${RESET} Installed fold pipeline template: ${destPath}`);
  if (!callsign) {
    console.log(`  Known limitation: the inbox-branch prefix (squad/inbox/) is fixed. To use a different prefix,`);
    console.log(`  change both the CLI and the fold templates together. Future: bake the prefix into the fold template at install time.`);
  }
  if (platform === 'ado') {
    console.log(`  ℹ️  Configure the ADO pipeline to point to .azuredevops/${filename} in the portal.`);
  }
}
