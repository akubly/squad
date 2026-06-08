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
import { loadRegistryFromDisk } from '@wifi-aware/squad-sdk/registry';
import type { RegistryEntry } from '@wifi-aware/squad-sdk/registry';
import { normalisedPathKey } from '@wifi-aware/squad-sdk/path-utils';
import { CALLSIGN_RE } from '@wifi-aware/squad-sdk/validation';
import { migratePoleBToA } from './pole-a-migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Templates root: package-local templates/fold/ directory.
// In compiled output, __dirname is dist/cli/commands/; ../../../templates/fold reaches
// packages/squad-cli/templates/fold/ (three levels up from dist/cli/commands/ → package root).
const TEMPLATES_ROOT = path.resolve(__dirname, '../../../templates/fold');

const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';

export interface InstallFoldPipelineOptions {
  cwd?: string;
  force?: boolean;
  /** Optional callsign to scope the pipeline trigger and fold target to this squad. */
  callsign?: string;
  /**
   * When true, render the pipeline with the inbox-branch cleanup default
   * (DELETE_FOLDED_REFS) set to true. Default (unset) renders false so cleanup
   * stays off unless an operator opts in.
   */
  deleteFoldedRefs?: boolean;
  /**
   * Optional Azure DevOps service connection name (ADO platform only). When set,
   * the rendered ADO pipeline checks out and pushes the folded state branch under
   * the named service connection's identity (managed identity / service principal)
   * instead of the build-service account's System.AccessToken. When unset, the
   * rendered output is byte-identical to the default template.
   */
  foldServiceConnection?: string;
  /**
   * Optional self-hosted runner label set (GitHub platform only), e.g.
   * "self-hosted,Windows,X64". When set, the GitHub template is rendered with
   * `runs-on: [<labels>]` and, for a non-Linux label set, `defaults.run.shell: bash`
   * so the POSIX fold body runs under Git-Bash. When unset, the rendered output is
   * byte-identical to the default template (`runs-on: ubuntu-latest`, no shell). The
   * ADO template is agent-pool-driven and unaffected.
   */
  runner?: string;
}

/**
 * Apply render-time substitutions for the --delete-folded-refs install flag.
 *
 * Flips the rendered pipeline's DELETE_FOLDED_REFS default to `true`. Anchored,
 * minimal replacements so unrelated template text is never disturbed. A no-op when
 * the flag is unset (cleanup stays off by default).
 */
function applyDeleteFoldedRefs(content: string, platform: 'github' | 'ado'): string {
  if (platform === 'ado') {
    const nl = content.includes('\r\n') ? '\r\n' : '\n';
    return content.replace(
      `name: DELETE_FOLDED_REFS${nl}    value: 'false'`,
      `name: DELETE_FOLDED_REFS${nl}    value: 'true'`,
    );
  }
  return content.replace('${DELETE_FOLDED_REFS:-false}', '${DELETE_FOLDED_REFS:-true}');
}

/**
 * Apply render-time substitutions for the --fold-service-connection install flag (ADO only).
 *
 * Renders the state-branch checkout and push to run under the named Azure DevOps
 * service connection (managed-identity / service-principal backed) instead of the
 * build-service account's System.AccessToken — the compliant, least-privilege
 * alternative (see aka.ms/azdosc). A no-op for the GitHub platform and when unset,
 * keeping the default rendering byte-identical to the committed template.
 */
function applyFoldServiceConnection(content: string, serviceConnection: string): string {
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  // Stop persisting the build-service credentials on the checkout.
  let out = content.replace('persistCredentials: true', 'persistCredentials: false');

  // Acquire a bearer token from the service connection's identity and wire it into
  // git's auth header for every subsequent step in this job.
  const authStep =
    `                  displayName: Configure git identity${nl}` +
    nl +
    `                - task: AzureCLI@2${nl}` +
    `                  displayName: Authenticate git push via Azure service connection${nl}` +
    `                  inputs:${nl}` +
    `                    azureSubscription: ${serviceConnection}${nl}` +
    `                    scriptType: bash${nl}` +
    `                    scriptLocation: inlineScript${nl}` +
    `                    inlineScript: |${nl}` +
    `                      AZDO_TOKEN=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)${nl}` +
    `                      git config --global http.extraheader "AUTHORIZATION: bearer $AZDO_TOKEN"${nl}`;
  out = out.replace(`                  displayName: Configure git identity${nl}`, authStep);

  // The build-service token is no longer used — drop its env exposure.
  out = out.replace(
    `${nl}                  env:${nl}                    SYSTEM_ACCESSTOKEN: $(System.AccessToken)`,
    '',
  );

  return out;
}

/**
 * Apply render-time substitutions for the --runner install flag (GitHub only, F1).
 *
 * Renders the fold job's `runs-on: ubuntu-latest` as `runs-on: [<labels>]` for a
 * self-hosted runner label set. When the label set is non-Linux (no `ubuntu`/`linux`
 * label), also injects a job-level `defaults.run.shell: bash` so the POSIX fold body
 * runs under Git-Bash on Windows/macOS self-hosted runners. A no-op when the label set
 * is empty, keeping the default rendering byte-identical to the committed template.
 */
function applyRunner(content: string, runner: string): string {
  const labels = runner.split(',').map(s => s.trim()).filter(Boolean);
  if (labels.length === 0) {
    return content;
  }
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const linuxLike = labels.some(l => /^(ubuntu|linux)/i.test(l));
  let replacement = `    runs-on: [${labels.join(', ')}]`;
  if (!linuxLike) {
    replacement += `${nl}    defaults:${nl}      run:${nl}        shell: bash`;
  }
  return content.replace('    runs-on: ubuntu-latest', replacement);
}

/**
 * Recognize the callsign-named subfolder host layout `init` produces: a repo whose
 * root holds at least one `<callsign>/.squad/team.md`. Used by D1 self-install to
 * accept a subfolder host that has no root-level `.squad/`. Deliberately does NOT
 * match an arbitrary `<dir>/.squad` — only callsign-named subdirectories with a team.md.
 */
function hasSubfolderSquadHost(repoRoot: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(e =>
    e.isDirectory() &&
    CALLSIGN_RE.test(e.name) &&
    fs.existsSync(path.join(repoRoot, e.name, '.squad', 'team.md')),
  );
}

/**
 * List the callsign-named subfolder team roots under a host repo root
 * (`<callsign>/.squad/team.md`). Same recognition rule as hasSubfolderSquadHost.
 */
function listSubfolderCallsigns(repoRoot: string): string[] {
  try {
    return fs.readdirSync(repoRoot, { withFileTypes: true })
      .filter(e =>
        e.isDirectory() &&
        CALLSIGN_RE.test(e.name) &&
        fs.existsSync(path.join(repoRoot, e.name, '.squad', 'team.md')),
      )
      .map(e => e.name);
  } catch {
    return [];
  }
}

/** Read the `stateBackend` field from a team root's `.squad/config.json`, or null. */
function readStateBackend(teamRoot: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(teamRoot, '.squad', 'config.json'), 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    return typeof config['stateBackend'] === 'string' ? config['stateBackend'] : null;
  } catch {
    return null;
  }
}

/**
 * Piece 52 (A): install the BLANKET Pole-A `.gitignore` at the host git root so a host
 * onboarded via `install-fold-pipeline` (never `init`) keeps NO squad content or state on the
 * product branch. This supersedes piece 51's allowlist-scoped block: under Pole A the durable
 * constitution rides `squad/config/<callsign>` and ephemeral state rides `squad/state/<callsign>`,
 * so nothing under `<callsign>/.squad/**` (or `.squad/**` for a root host) is tracked on `main`.
 *
 * Before the blanket untrack, the durable config orphan is genesis-seeded from each team root's
 * durable files (sub-proposal B) so a Pole-B host migrates with no durable loss (best-effort,
 * local `update-ref`; idempotent — an existing config branch is left untouched).
 *
 * Applies only under the orphan backend. A fold host that never ran `init` has no `config.json`;
 * since `install-fold-pipeline` is itself a state-branch/orphan operation and registry entries
 * default to the orphan backend, an unspecified backend is treated as orphan. A backend explicitly
 * set to a non-orphan value (worktree/local/external) is skipped.
 *
 * Each team root is gated on ITS OWN backend: the resolved registry `entry` only speaks for the
 * single callsign it describes, so in a multi-callsign subfolder host we read every sibling's own
 * `config.json` rather than reusing one entry's backend for all of them (doing so would either
 * untrack a non-orphan sibling's tracked state or skip a genuinely-orphan sibling).
 */
async function installHostGitignore(hostRepoRoot: string, entry: RegistryEntry | undefined, callsign?: string): Promise<void> {
  // The registry entry (if any) describes exactly one callsign — the basename of its team root.
  const entryCallsign = entry ? path.basename(path.dirname(entry.path)) : undefined;
  // Prefer the entry's persisted backend only for the callsign it actually describes;
  // fall back to each team root's own config for every other (sibling) callsign.
  const isOrphan = (teamRoot: string, cs?: string): boolean => {
    const backend = (entry && cs !== undefined && cs === entryCallsign)
      ? entry.stateBackend ?? readStateBackend(teamRoot)
      : readStateBackend(teamRoot);
    return backend == null || backend === 'orphan';
  };

  const warnAborted = (res: { aborted?: string; unclassified?: string[] }, teamRoot: string): void => {
    if (res.aborted === 'unclassified') {
      console.warn(
        `${YELLOW}⚠ ${teamRoot}: skipped Pole A untrack — ${res.unclassified?.length} tracked ` +
        `.squad/ file(s) belong to no lane and would be lost. Classify them first.${RESET}`,
      );
    } else if (res.aborted === 'unseedable-durable') {
      console.warn(
        `${YELLOW}⚠ ${teamRoot}: skipped Pole A untrack — could not seed the durable config orphan ` +
        `(nothing lost). Ensure a valid callsign is registered.${RESET}`,
      );
    }
  };

  // Root host: `.squad/` directly at the git root. Here the entry (if any) is the root squad.
  if (fs.existsSync(path.join(hostRepoRoot, '.squad'))) {
    const rootBackend = entry?.stateBackend ?? readStateBackend(hostRepoRoot);
    if (rootBackend == null || rootBackend === 'orphan') {
      const res = await migratePoleBToA({
        repoRoot: hostRepoRoot,
        teamRoot: hostRepoRoot,
        pathPrefix: '',
        callsign: callsign ?? entry?.callsign,
      });
      warnAborted(res, hostRepoRoot);
    }
    return;
  }

  // Subfolder host(s): each `<callsign>/.squad/` team root, scoped by its callsign prefix.
  const callsigns = callsign ? [callsign] : listSubfolderCallsigns(hostRepoRoot);
  for (const cs of callsigns) {
    const teamRoot = path.join(hostRepoRoot, cs);
    if (fs.existsSync(path.join(teamRoot, '.squad', 'team.md')) && isOrphan(teamRoot, cs)) {
      const res = await migratePoleBToA({
        repoRoot: hostRepoRoot,
        teamRoot,
        pathPrefix: `${cs}/`,
        callsign: cs,
      });
      warnAborted(res, teamRoot);
    }
  }
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

  // D1: .squad/-gated self-install — if the current repo IS the state host, target itself.
  // Piece 50 §D extends this to the callsign-named subfolder host layout (piece 49): a repo
  // whose root has no `.squad/` but holds at least one `<callsign>/.squad/team.md`. The fold
  // pipeline is repo-level and callsign-generic, so the install target is the git root either way.
  let selfInstall = false;
  if (!hostRepoRoot &&
      (fs.existsSync(path.join(repoRoot, '.squad')) || hasSubfolderSquadHost(repoRoot))) {
    hostRepoRoot = repoRoot;
    selfInstall = true;
  }

  if (!hostRepoRoot) {
    console.error(
      `✗ Could not resolve shared-squad host clone path. Run 'squad assign' to register a host clone.`,
    );
    process.exit(1);
    return; // unreachable — keeps TypeScript control-flow happy
  }

  // ── Piece 52 (A): install the BLANKET Pole-A .gitignore + seed the durable config orphan ──
  // Runs before the pipeline write (and any idempotency early-return) so a host onboarded via
  // install-fold-pipeline keeps no squad content or state on the product branch, and its durable
  // constitution is genesis-seeded onto squad/config/<callsign> before the blanket untrack.
  await installHostGitignore(hostRepoRoot, entry, callsign);
  // ── Platform → target directory mapping ───────────────────────────────────
  const platformDirMap: Record<'github' | 'ado', string> = {
    github: path.join(hostRepoRoot, '.github', 'workflows'),
    ado: path.join(hostRepoRoot, '.azuredevops'),
  };
  const targetDir = platformDirMap[platform];

  // Fail fast if the target directory does not exist — UNLESS the host was resolved
  // from a matching registry entry (E1: registry-gated auto-create) or from D1
  // .squad/-gated self-install. Both represent a confirmed target — creating the
  // platform directory there is safe. For config-fallback / unconfirmed hosts, preserve
  // today's fail-fast: never create directories in a repo the registry has not confirmed.
  if (!fs.existsSync(targetDir)) {
    if (entry || selfInstall) {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`${GREEN}✓${RESET} Created pipeline directory in ${entry ? 'registered' : 'self-hosted'} host: ${targetDir}`);
    } else {
      console.error(
        `✗ Target directory does not exist: ${targetDir}\n` +
        `  Bootstrap the shared-squad host clone pipeline directory before running install-fold-pipeline.`,
      );
      process.exit(1);
      return;
    }
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

  // ── Install-flag render substitutions ─────────────────────────────────────
  // Applied after callsign parameterization so they compose with it. Both are
  // no-ops by default, keeping the default rendering byte-identical to the template.
  if (options.deleteFoldedRefs) {
    templateContent = applyDeleteFoldedRefs(templateContent, platform);
  }
  if (options.foldServiceConnection && platform === 'ado') {
    templateContent = applyFoldServiceConnection(templateContent, options.foldServiceConnection);
  }
  if (options.runner && platform === 'github') {
    templateContent = applyRunner(templateContent, options.runner);
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
    // Content differs — conflict guard, unless --force overwrites with a backup.
    if (options.force) {
      const backupPath = `${destPath}.bak`;
      fs.writeFileSync(backupPath, existing, 'utf-8');
      fs.writeFileSync(destPath, templateContent, 'utf-8');
      console.log(`${GREEN}✓${RESET} Overwrote ${filename} (previous content backed up to ${backupPath}).`);
      return;
    }
    console.error(
      `✗ ${filename} exists at ${destPath} with different content.\n` +
      `  Review and delete it manually before re-running install-fold-pipeline, or pass --force to overwrite (a .bak backup is written).`,
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
