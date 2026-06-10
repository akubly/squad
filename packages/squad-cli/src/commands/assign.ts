/**
 * assign-to-copilot command module.
 *
 * Binds the current project to a registered squad and installs the
 * Copilot-facing payload files. Resolution is the precondition: no registry
 * mutation, no payload install, and no clone work happens until resolveSquad()
 * succeeds for the target callsign or inferred context.
 *
 * @module commands/assign
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync as _assignExecFileSync } from 'node:child_process';
import { resolveSquad, upsertEntry, collectCwdRemoteUrls, normalizeRemoteUrl, clonesMatch, normalisedPathKey } from '@bradygaster/squad-sdk';
import { installCopilotPayload, CopilotPayloadError } from '@bradygaster/squad-sdk/copilot-payload';
import { findCloseMatch as _findCloseMatch } from '../lib/close-match.js';
import type { ResolvedSquad } from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { Registry, RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { ConfigurationError } from '@bradygaster/squad-sdk/adapter/errors';
import { resolveRegistryFilePath } from './_registry-path.js';
import { getTemplatesDir } from '../cli/core/templates.js';
import { applyVersionStamp, getPackageVersion } from '../cli/core/version.js';
import { fatal } from '../cli/core/errors.js';
import { getGitRoot as _defaultGetGitRoot } from '../lib/git-root.js';
import { INBOX_HANDLE_RE } from '@bradygaster/squad-sdk/validation';
import { installCrossRepoHook, installProductSquadForbidHook } from '../cli/commands/install-hooks.js';

export interface RunAssignOpts {
  /** Project directory — the consumer repo being assigned. */
  cwd: string;
  /** Environment seam (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Explicit callsign to target; falls back to registry inference if omitted. */
  callsign?: string;
  /** Explicit registry file path; defaults via SQUAD_REGISTRY_PATH seam. */
  registryPath?: string;
  /** Dry-run: report what would be done without writing. */
  dryRun?: boolean;
  /** Override home dir for agent install (test seam). */
  home?: string;
  /** Skip coordinator agent install. */
  noInstallAgent?: boolean;
  /**
   * Pre-resolved squad result threaded from the dispatch-level guard.
   * When provided the internal resolver call is skipped, ensuring guard and
   * runner operate on the same resolution context.
   */
  resolved?: ResolvedSquad;
}

/**
 * Run the assign-to-copilot command.
 *
 * Resolves the target squad first, then registers the current directory as a
 * clone of that squad and installs the coordinator agent file. Idempotent:
 * if the current directory is already a registered clone the command succeeds
 * without writing duplicate entries.
 */
export async function runAssignToCopilot(opts: RunAssignOpts): Promise<void> {
  // Validate paths before any file-write use (RETRO: path traversal guard).
  if (!path.isAbsolute(opts.cwd)) {
    fatal(`cwd must be an absolute path, got: "${opts.cwd}"`);
    return;
  }
  if (opts.home !== undefined && (!path.isAbsolute(opts.home) || opts.home.replace(/\\/g, '/').split('/').includes('..'))) {
    fatal(`--home must be an absolute path without ".." traversal, got: "${opts.home}"`);
    return;
  }

  const env = opts.env ?? process.env;
  const registryPath = opts.registryPath ?? (env['SQUAD_REGISTRY_PATH'] as string | undefined);

  // Use the pre-resolved result from the dispatch guard when available.
  // Falling back to an internal resolve keeps the function usable directly
  // from tests that do not go through the CLI dispatch layer.
  const resolved = opts.resolved ?? resolveSquad({
    cwd: opts.cwd,
    env,
    callsign: opts.callsign,
    registryPath,
  });

  if (resolved === null) {
    fatal(
      'No squad found.\n' +
        '   Run "squad init --callsign <name>" to create a new squad host,\n' +
        '   or pass --callsign to specify the target squad.',
    );
    return;
  }

  // Explicit callsign takes precedence; fall back to what the resolver inferred.
  const targetCallsign = opts.callsign ?? resolved.callsign;
  if (!targetCallsign) {
    fatal(
      'Could not determine squad callsign from resolution result.\n' +
        '   Pass --callsign to specify the target squad.',
    );
    return;
  }

  if (opts.dryRun) {
    console.log('📋 Dry-run: squad assign-to-copilot would:');
    console.log(`   1. Register ${opts.cwd} as a clone of "${targetCallsign}" (${resolved.path})`);
    if (!opts.noInstallAgent) {
      const home = opts.home ?? os.homedir();
      console.log(`   2. Install coordinator agent → ${path.join(home, '.copilot', 'agents', 'squad.agent.md')}`);
    }
    return;
  }

  // --- Side effects begin only after successful resolution ---

  // Register the current directory as a clone in the resolved squad's registry entry.
  const registryFilePath = resolveRegistryFilePath({ explicit: registryPath, env: env as Record<string, string> });
  if (!registryFilePath) {
    fatal('Cannot locate registry file. Set SQUAD_REGISTRY_PATH or register a squad first.');
    return;
  }

  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  if (!registry) {
    fatal('Registry file is empty or unreadable. Check SQUAD_REGISTRY_PATH.');
    return;
  }

  const existing = registry.squads.find(s => s.callsign === targetCallsign);
  if (!existing) {
    fatal(`Squad "${targetCallsign}" not found in registry. It may have been removed or renamed.`);
    return;
  }

  const normalizedCwd = path.normalize(opts.cwd);
  const alreadyClone = (existing.clones ?? []).some(
    c => path.normalize(c) === normalizedCwd,
  );

  if (!alreadyClone) {
    const updated = upsertEntry({
      callsign: targetCallsign,
      path: existing.path,
      clones: [...(existing.clones ?? []), normalizedCwd],
      origins: existing.origins ?? [],
    });
    const filtered = registry.squads.filter(s => s.callsign !== targetCallsign);
    writeRegistry(registryFilePath, { version: registry.version, squads: [...filtered, updated] });
    console.log(`✅ Assigned: ${normalizedCwd} → "${targetCallsign}" (${resolved.path})`);
  } else {
    console.log(`ℹ️  Already assigned: ${normalizedCwd} → "${targetCallsign}" (${resolved.path})`);
  }

  // Install coordinator agent (best-effort, does not affect assignment outcome).
  if (!opts.noInstallAgent) {
    const home = opts.home ?? os.homedir();
    installCoordinatorAgent(home);
  }
}

/**
 * Best-effort coordinator agent install. Silently warns on failure.
 * Returns true only when the target file was written.
 */
export function installCoordinatorAgent(home: string, opts: { requireExisting?: boolean } = {}): boolean {
  const targetDir = path.join(home, '.copilot', 'agents');
  const targetPath = path.join(targetDir, 'squad.agent.md');
  try {
    const resolvedTemplatesDir = getTemplatesDir();
    const primaryCandidate = path.join(resolvedTemplatesDir, 'squad.agent.md');
    const fallbackCandidate = path.join(resolvedTemplatesDir, 'squad.agent.md.template');
    const templatePath = fs.existsSync(primaryCandidate) ? primaryCandidate : fallbackCandidate;
    if (!fs.existsSync(templatePath)) return false;
    if (opts.requireExisting && !fs.existsSync(targetPath)) return false;

    const stampedContent = applyVersionStamp(fs.readFileSync(templatePath, 'utf8'), getPackageVersion());
    let shouldWrite = true;
    try {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(targetPath);
      } else {
        const existingContent = fs.readFileSync(targetPath, 'utf8');
        shouldWrite = existingContent !== stampedContent;
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    if (!shouldWrite) return false;
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, stampedContent, 'utf8');
    return true;
  } catch (e: unknown) {
    console.warn(`⚠️  Could not install coordinator agent at ${targetPath}: ${(e as Error).message}`);
    return false;
  }
}

// ============================================================
// runAssign — squad assign command (piece 14)
// Binds a product clone to a registered squad by callsign, or
// clones a squad host first when given a URL and --clone-to.
// ============================================================

export type AssignKind = 'assigned' | 'alreadyAssigned' | 'reactivated' | 'noOp';

/**
 * Typed union of every error code that runAssign can throw.
 * Use `err.code` on a caught `AssignError` to branch programmatically
 * without parsing the human-readable message string.
 */
export type AssignErrorCode =
  | 'ERR_ASSIGN_MISSING_ARG'
  | 'ERR_ASSIGN_URL_WITHOUT_CLONE_TO'
  | 'ERR_ASSIGN_NO_REGISTRY'
  | 'ERR_ASSIGN_UNKNOWN_CALLSIGN'
  | 'ERR_ASSIGN_HOST_PATH_MISSING'
  | 'ERR_ASSIGN_NOT_GIT_REPO'
  | 'ERR_ASSIGN_CONTAINMENT'
  | 'ERR_ASSIGN_CROSS_CALLSIGN'
  | 'ERR_ASSIGN_ORIGIN_AMBIGUITY'
  | 'ERR_ASSIGN_CLONE_DEST_NOT_EMPTY'
  | 'ERR_ASSIGN_CALLSIGN_COLLISION'
  | 'ERR_ASSIGN_CLONE_FAILED'
  | 'ERR_ASSIGN_NO_TEAM_MD'
  | 'ERR_ASSIGN_INVALID_SKILLS_SOURCE'
  | 'INVALID_ALIAS';

/** Structured error thrown by runAssign — carries a typed error code. */
export class AssignError extends ConfigurationError {
  public readonly code: AssignErrorCode;
  constructor(code: AssignErrorCode, message: string) {
    super(`${code}: ${message}`, { timestamp: new Date() });
    this.name = 'AssignError';
    this.code = code;
  }
}

/**
 * Discriminated result union for runAssign.
 *
 * `warnings` is only present on the `assigned` and `reactivated` kinds, which
 * are the only variants that can carry meaningful diagnostic information. The
 * `alreadyAssigned` and `noOp` variants carry no warnings by design.
 */
export type SquadAssignResult =
  | { kind: 'assigned' | 'reactivated'; callsign: string; hostPath: string; clonePath?: string; warnings: string[]; coordinatorInstalled?: boolean }
  | { kind: 'alreadyAssigned' | 'noOp'; callsign: string; hostPath: string; clonePath?: string };

export interface SquadAssignOpts {
  /** First positional argument: callsign (warm path) or URL (cold-start with --clone-to). */
  callsignOrUrl?: string;
  /** --clone-to <path>: destination for cold-start clone. */
  cloneTo?: string;
  /** --callsign <name>: override the callsign derived from the URL in cold-start. */
  callsign?: string;
  /** --registry-path: alternate registry file. */
  registryPath?: string;
  /** --target-dir: product clone to bind (defaults to cwd). */
  targetDir?: string;
  /** --skills-from: skill source selector — 'host', 'none', or local path. */
  skillsFrom?: string;
  /** Override the user-scoped Copilot home for payload install (test seam). */
  copilotHome?: string;
  /** Working directory for git and path operations (defaults to process.cwd()). */
  cwd?: string;
  /** Injectable environment — falls back to process.env for SQUAD_REGISTRY_PATH resolution. */
  env?: Record<string, string | undefined>;
  /** Injectable seam: git clone. Production default uses git clone. */
  cloneCommand?: (url: string, dest: string) => Promise<void>;
  /** Injectable seam: git root resolver. Production default uses execFileSync git. */
  getGitRoot?: (dir: string) => string | null;
  /** Injectable seam: fetch remote URL collector. Production default uses git remote -v. */
  getRemoteUrls?: (dir: string) => string[];
  /** @internal Injectable seam: override registry write. For testing failure paths only. */
  _writeRegistryFn?: (filePath: string, registry: Registry) => void;
  /** --state-remote <name>: git remote name for state operations. */
  stateRemote?: string;
  /** --state-branch <name>: orphan branch holding folded canonical state. */
  stateBranch?: string;
  /** --inbox-handle <handle>: per-developer namespace identifier for inbox branches. */
  inboxHandle?: string;
  /** @internal Injectable seam: override cross-repo hook installer. For testing only. */
  _installCrossRepoHookFn?: (docsRepoPath: string) => void;
  /** @internal Injectable seam: override product .squad/-forbid hook installer. For testing only. */
  _installProductSquadForbidHookFn?: (productRepoPath: string) => void;
}

function _isUrlArg(s: string): boolean {
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('git@') ||
    s.startsWith('ssh://') ||
    s.startsWith('//')
  );
}

function _deriveCallsignFromUrl(url: string): string {
  const clean = url.replace(/\/$/, '');
  const lastSlash = clean.lastIndexOf('/');
  const lastColon = clean.lastIndexOf(':');
  const seg = clean.slice(Math.max(lastSlash, lastColon) + 1);
  return seg.replace(/\.git$/i, '').toLowerCase();
}

async function _defaultCloneCommand(url: string, dest: string): Promise<void> {
  // The `--` separator ensures git treats the next token as a positional
  // URL argument, not as a flag — guarding against values like --upload-pack=…
  _assignExecFileSync('git', ['clone', '--', url, dest], { stdio: 'inherit' });
}

/**
 * Assign the target product clone to a registered squad.
 *
 * Warm path: resolves the callsign in the registry, validates the host,
 * applies guards in order, and appends the git root to clones[] and
 * normalized fetch remotes to origins[].
 *
 * Cold-start path: clones the squad host, verifies .squad/team.md,
 * creates or reactivates the registry entry, then binds the product clone.
 */
export async function runAssign(opts: SquadAssignOpts): Promise<SquadAssignResult> {
  const cwd = opts.cwd ?? process.cwd();
  const resolvedTargetDir = opts.targetDir ? path.resolve(cwd, opts.targetDir) : cwd;
  const gitRootFn = opts.getGitRoot ?? _defaultGetGitRoot;
  const remotesFn = opts.getRemoteUrls ?? collectCwdRemoteUrls;
  const cloneFn = opts.cloneCommand ?? _defaultCloneCommand;
  const writeRegistryFn = opts._writeRegistryFn ?? writeRegistry;

  // Guard 0: Validate inboxHandle format before any registry read.
  if (opts.inboxHandle !== undefined && !INBOX_HANDLE_RE.test(opts.inboxHandle)) {
    throw new AssignError(
      'INVALID_ALIAS',
      `Invalid --inbox-handle "${opts.inboxHandle}": must match /${INBOX_HANDLE_RE.source}/ (lowercase, starts with a letter, hyphens allowed, max 39 chars).`,
    );
  }

  // Early validation: --skills-from must be a recognized keyword or an existing local directory.
  // This runs before any registry write so a bad source leaves no side effects.
  if (opts.skillsFrom !== undefined && opts.skillsFrom !== 'none' && opts.skillsFrom !== 'host') {
    if (_isUrlArg(opts.skillsFrom)) {
      throw new AssignError(
        'ERR_ASSIGN_INVALID_SKILLS_SOURCE',
        `"${opts.skillsFrom}" looks like a URL. Use a local path, "host", or "none" for --skills-from.`,
      );
    }
    const resolvedSource = path.isAbsolute(opts.skillsFrom)
      ? opts.skillsFrom
      : path.resolve(cwd, opts.skillsFrom);
    if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
      throw new AssignError(
        'ERR_ASSIGN_INVALID_SKILLS_SOURCE',
        `"${opts.skillsFrom}" does not resolve to an existing local directory.`,
      );
    }
  }

  // Guard 1a: Missing argument.
  const rawArg = opts.callsignOrUrl?.trim() ?? '';
  if (!rawArg) {
    throw new AssignError(
      'ERR_ASSIGN_MISSING_ARG',
      'Provide a callsign or URL.\n' +
      '  squad assign <callsign>\n' +
      '  squad assign <url> --clone-to <path>',
    );
  }

  // Cold-start path: explicit --clone-to triggers clone regardless of arg shape.
  if (opts.cloneTo !== undefined) {
    // Resolve cloneTo at the call site so _coldStart operates on a concrete string.
    const cloneTo = opts.cloneTo;
    const installCrossRepoHookFn = opts._installCrossRepoHookFn ?? installCrossRepoHook;
    const installProductSquadForbidHookFn = opts._installProductSquadForbidHookFn ?? installProductSquadForbidHook;
    return _coldStart({ rawArg, opts, cwd, resolvedTargetDir, gitRootFn, remotesFn, cloneFn, cloneTo, writeRegistryFn, installCrossRepoHookFn, installProductSquadForbidHookFn });
  }

  // URL without --clone-to: surface a teaching error.
  if (_isUrlArg(rawArg)) {
    throw new AssignError(
      'ERR_ASSIGN_URL_WITHOUT_CLONE_TO',
      `To assign from a URL, also pass --clone-to <path>.\n` +
      `  Example: squad assign ${rawArg} --clone-to ./squad-host\n` +
      `Or clone manually and use the callsign:\n` +
      `  git clone ${rawArg} ./squad-host && squad assign <callsign>`,
    );
  }

  // Warm path.
  const installCrossRepoHookFn = opts._installCrossRepoHookFn ?? installCrossRepoHook;
  return _warmPath({ callsign: rawArg, opts, resolvedTargetDir, gitRootFn, remotesFn, writeRegistryFn, installCrossRepoHookFn });
}

interface _WarmCtx {
  callsign: string;
  opts: SquadAssignOpts;
  resolvedTargetDir: string;
  gitRootFn: (dir: string) => string | null;
  remotesFn: (dir: string) => string[];
  writeRegistryFn: (filePath: string, registry: Registry) => void;
  installCrossRepoHookFn: (docsRepoPath: string) => void;
}

async function _warmPath(ctx: _WarmCtx): Promise<SquadAssignResult> {
  const { callsign, opts, resolvedTargetDir, gitRootFn, remotesFn, writeRegistryFn, installCrossRepoHookFn } = ctx;
  const warnings: string[] = [];

  const registryFilePath = resolveRegistryFilePath({ explicit: opts.registryPath, env: opts.env as Record<string, string> | undefined });
  if (!registryFilePath) {
    throw new AssignError(
      'ERR_ASSIGN_NO_REGISTRY',
      'Cannot locate registry. Set SQUAD_REGISTRY_PATH or run squad init first.',
    );
  }

  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  const existingSquads: RegistryEntry[] = registry?.squads ?? [];

  // Guard 1b: Unknown callsign (case-sensitive).
  const entry = existingSquads.find(s => s.callsign === callsign);
  if (!entry) {
    const allCallsigns = existingSquads.map(s => s.callsign).filter((c): c is string => typeof c === 'string');
    const suggestion = _findCloseMatch(callsign, allCallsigns);
    throw new AssignError(
      'ERR_ASSIGN_UNKNOWN_CALLSIGN',
      `No squad found with callsign "${callsign}".` +
      (suggestion ? `\n  Did you mean "${suggestion}"?` : '') +
      '\n  Run "squad list" to see registered squads.',
    );
  }

  // Guard 2: Host path exists and contains a squad host.
  const hostSquadDir = entry.path;
  if (!fs.existsSync(hostSquadDir)) {
    throw new AssignError(
      'ERR_ASSIGN_HOST_PATH_MISSING',
      `The squad host path "${hostSquadDir}" does not exist.\n` +
      '  Update the registry entry or re-run squad init to recreate the host.',
    );
  }
  const teamMdPath = path.join(hostSquadDir, 'team.md');
  if (!fs.existsSync(teamMdPath)) {
    throw new AssignError(
      'ERR_ASSIGN_HOST_PATH_MISSING',
      `"${hostSquadDir}" does not contain team.md.\n` +
      '  The path may not be a valid squad host.',
    );
  }

  // Guard 3: Host-path guard — assigning from the squad host itself.
  // Exception (K): handle-only update — when --inbox-handle is supplied AND no clone/target-dir/cold-start
  // work is requested, update the entry's inboxHandle and write the registry instead of returning noOp.
  const hostParentDir = path.dirname(hostSquadDir);
  if (normalisedPathKey(resolvedTargetDir) === normalisedPathKey(hostParentDir)) {
    const isHandleOnly = opts.inboxHandle !== undefined && !opts.cloneTo && !opts.targetDir;
    if (isHandleOnly) {
      // Handle-only update from host: update inboxHandle on this entry and persist.
      const updatedEntry: RegistryEntry = { ...entry, inboxHandle: opts.inboxHandle };
      const otherSquads = existingSquads.filter(s => s.callsign !== callsign);
      const newRegistry: Registry = {
        version: registry?.version ?? 1,
        squads: [...otherSquads, updatedEntry],
      };
      fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
      writeRegistryFn(registryFilePath, newRegistry);
      return { kind: 'assigned', callsign, hostPath: hostSquadDir, clonePath: hostParentDir, warnings: [], coordinatorInstalled: false };
    }
    return { kind: 'noOp', callsign, hostPath: hostSquadDir };
  }

  // Guard 4: Containment guard — assigning from inside an already-assigned clone.
  for (const e of existingSquads) {
    for (const clone of e.clones ?? []) {
      let isChild = false;
      try {
        isChild =
          clonesMatch(resolvedTargetDir, clone) &&
          normalisedPathKey(resolvedTargetDir) !== normalisedPathKey(clone);
      } catch {
        continue;
      }
      if (isChild) {
        throw new AssignError(
          'ERR_ASSIGN_CONTAINMENT',
          `The target directory is inside a registered clone root "${clone}".\n` +
          '  Run squad assign from the clone root directory.',
        );
      }
    }
  }

  // Guard 5: Git-root resolution for the target clone.
  const gitRoot = gitRootFn(resolvedTargetDir);
  if (!gitRoot) {
    throw new AssignError(
      'ERR_ASSIGN_NOT_GIT_REPO',
      `"${resolvedTargetDir}" is not inside a Git repository.\n` +
      '  Run squad assign from the root of your product clone.',
    );
  }
  const clonePath = gitRoot;

  // Guard 6: Idempotency — same callsign and same git root already assigned.
  const existingClones = entry.clones ?? [];
  if (existingClones.some(c => normalisedPathKey(c) === normalisedPathKey(clonePath))) {
    return { kind: 'alreadyAssigned', callsign, hostPath: hostSquadDir, clonePath };
  }

  // Guard 7: Cross-entry clone collision — git root already in another entry's clones[].
  for (const e of existingSquads) {
    if (e.callsign === callsign) continue;
    const otherClones = e.clones ?? [];
    if (otherClones.some(c => normalisedPathKey(c) === normalisedPathKey(clonePath))) {
      throw new AssignError(
        'ERR_ASSIGN_CROSS_CALLSIGN',
        `"${clonePath}" is already assigned to squad "${e.callsign ?? e.path}".\n` +
        '  Run "squad unassign" to remove the existing assignment before re-assigning.',
      );
    }
  }

  // Guard 8: Origin collision check.
  const rawRemotes = remotesFn(resolvedTargetDir);
  // Deduplicate within the incoming set before comparing against existing origins.
  const normalizedNewOrigins = Array.from(new Set(rawRemotes.map(normalizeRemoteUrl)));

  const originMatchingEntries = existingSquads.filter(e => {
    if (e.callsign === callsign) return false;
    if (opts.callsign && e.callsign !== opts.callsign) return false;
    const entryOrigins = (e.origins ?? []).map(normalizeRemoteUrl);
    return normalizedNewOrigins.some(no => entryOrigins.includes(no));
  });

  if (originMatchingEntries.length >= 2) {
    const names = originMatchingEntries.map(e => `"${e.callsign ?? e.path}"`).join(', ');
    throw new AssignError(
      'ERR_ASSIGN_ORIGIN_AMBIGUITY',
      `The current fetch remotes match origins in multiple squads: ${names}.\n` +
      '  Use an explicit --callsign to disambiguate.',
    );
  }
  if (originMatchingEntries.length === 1) {
    warnings.push(
      `Warning: current fetch remotes also match origins registered for squad ` +
      `"${originMatchingEntries[0]!.callsign ?? originMatchingEntries[0]!.path}". Proceeding.`,
    );
  }

  // Guard 9: Registry write.
  const existingOrigins = entry.origins ?? [];
  const originsToAdd = normalizedNewOrigins.filter(
    no => !existingOrigins.some(eo => normalizeRemoteUrl(eo) === no),
  );

  const wasInactive = entry['status'] === 'inactive';
  const updatedEntry: RegistryEntry = {
    ...entry,
    clones: [...existingClones, clonePath],
    // Defensive dedup at write boundary: deduplicate origins regardless of source.
    origins: Array.from(new Set([...existingOrigins, ...originsToAdd])),
    ...(wasInactive ? { status: 'active' as const } : {}),
    // Additive merge: opts values win when supplied; existing entry values preserved when omitted.
    ...(opts.stateRemote !== undefined ? { stateRemote: opts.stateRemote } : {}),
    ...(opts.stateBranch !== undefined ? { stateBranch: opts.stateBranch } : {}),
    ...(opts.inboxHandle !== undefined ? { inboxHandle: opts.inboxHandle } : {}),
  };

  const otherSquads = existingSquads.filter(s => s.callsign !== callsign);
  const newRegistry: Registry = {
    version: registry?.version ?? 1,
    squads: [...otherSquads, updatedEntry],
  };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistryFn(registryFilePath, newRegistry);

  // Install Copilot payload after successful registry write.
  let coordinatorInstalled = false;
  const hostDir = path.dirname(hostSquadDir);
  try {
    const installRes = installCopilotPayload({
      hostDir,
      callsign,
      copilotHome: opts.copilotHome,
      skillsFrom: opts.skillsFrom,
      cwd: opts.cwd,
    });
    coordinatorInstalled = installRes.coordinatorInstalled;
  } catch (err) {
    if (err instanceof CopilotPayloadError && err.code === 'ERR_PAYLOAD_INVALID_SKILLS_SOURCE') {
      throw new AssignError('ERR_ASSIGN_INVALID_SKILLS_SOURCE', err.message);
    }
    warnings.push(
      `Could not install Copilot payload: ${err instanceof Error ? err.message : String(err)}. ` +
      `Re-run "squad assign ${callsign}" after fixing the source or permissions.`,
    );
  }

  // Install cross-repo post-commit hook in BOTH clones: host (filtered) and product (unfiltered).
  // Each install is independent — one failure must not abort the other.
  // Supersedes piece-34 host-only constraint (.squad/decisions.md:998).
  const docsRepoPath = path.dirname(entry.path);
  try {
    installCrossRepoHookFn(docsRepoPath);
  } catch (err) {
    warnings.push(
      `Could not install cross-repo hook at host "${docsRepoPath}": ${err instanceof Error ? err.message : String(err)}. ` +
      `Run 'squad assign ${callsign}' again after the shared-squad host clone is available.`,
    );
  }
  try {
    installCrossRepoHookFn(clonePath);
  } catch (err) {
    warnings.push(
      `Could not install cross-repo hook at product "${clonePath}": ${err instanceof Error ? err.message : String(err)}. ` +
      `Run 'squad assign ${callsign}' again after the product clone is available.`,
    );
  }

  // Install product .squad/-forbid pre-commit guard (product clone only, NOT host).
  // Independent try/catch — failure does not abort assign or the post-commit installs.
  try {
    installProductSquadForbidHook(clonePath);
  } catch (err) {
    warnings.push(
      `Could not install .squad/-forbid pre-commit guard at "${clonePath}": ${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  return {
    kind: wasInactive ? 'reactivated' : 'assigned',
    callsign,
    hostPath: hostSquadDir,
    clonePath,
    warnings,
    coordinatorInstalled,
  };
}

interface _ColdStartCtx {
  rawArg: string;
  opts: SquadAssignOpts;
  cwd: string;
  resolvedTargetDir: string;
  gitRootFn: (dir: string) => string | null;
  remotesFn: (dir: string) => string[];
  cloneFn: (url: string, dest: string) => Promise<void>;
  /** Resolved clone destination — non-optional so _coldStart operates on a concrete string. */
  cloneTo: string;
  /** Registry write function — injectable for testing failure paths. */
  writeRegistryFn: (filePath: string, registry: Registry) => void;
  /** Injectable: cross-repo post-commit hook installer. */
  installCrossRepoHookFn: (repoPath: string) => void;
  /** Injectable: product .squad/-forbid pre-commit hook installer. */
  installProductSquadForbidHookFn: (productRepoPath: string) => void;
}

async function _coldStart(ctx: _ColdStartCtx): Promise<SquadAssignResult> {
  const { rawArg: url, opts, cwd, resolvedTargetDir, gitRootFn, remotesFn, cloneFn, cloneTo, writeRegistryFn, installCrossRepoHookFn, installProductSquadForbidHookFn } = ctx;

  // Derive or accept callsign.
  const callsign = opts.callsign ?? _deriveCallsignFromUrl(url);

  // Resolve and validate the clone destination.
  // cloneTo is already a concrete string (resolved at the runAssign call site).
  const cloneDest = path.resolve(cwd, cloneTo);
  if (fs.existsSync(cloneDest)) {
    let isEmpty = true;
    try { isEmpty = fs.readdirSync(cloneDest).length === 0; } catch { isEmpty = false; }
    if (!isEmpty) {
      throw new AssignError(
        'ERR_ASSIGN_CLONE_DEST_NOT_EMPTY',
        `"${cloneDest}" already exists and is not empty.\n` +
        '  Choose a different --clone-to path.',
      );
    }
  }

  // Load existing registry entries for pre-clone checks.
  const registryFilePath = resolveRegistryFilePath({ explicit: opts.registryPath, env: opts.env as Record<string, string> | undefined });
  if (!registryFilePath) {
    throw new AssignError(
      'ERR_ASSIGN_NO_REGISTRY',
      'Cannot locate registry. Set SQUAD_REGISTRY_PATH or run squad init first.',
    );
  }
  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  const existingSquads: RegistryEntry[] = registry?.squads ?? [];

  // Pre-clone callsign collision check.
  const existingEntry = existingSquads.find(s => s.callsign === callsign);
  if (existingEntry) {
    const expectedPath = path.join(cloneDest, '.squad');
    if (normalisedPathKey(existingEntry.path) !== normalisedPathKey(expectedPath)) {
      throw new AssignError(
        'ERR_ASSIGN_CALLSIGN_COLLISION',
        `Callsign "${callsign}" is already registered at a different host path.\n` +
        '  Choose a different --callsign.',
      );
    }
  }

  // Clone the host repository. Roll back the directory on failure.
  try {
    await cloneFn(url, cloneDest);
  } catch (err) {
    // fs.rmSync({ recursive: true }) removes symlinks as symlink entries — it does
    // not follow symlinks out of the clone directory, so outbound symlinks in the
    // partially-cloned tree cannot cause files outside cloneDest to be deleted.
    try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new AssignError(
      'ERR_ASSIGN_CLONE_FAILED',
      `Failed to clone "${url}" to "${cloneDest}".\n` +
      `  ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Verify .squad/team.md in the cloned repository. Roll back on failure.
  const squadDir = path.join(cloneDest, '.squad');
  const teamMdPath = path.join(squadDir, 'team.md');
  if (!fs.existsSync(teamMdPath)) {
    try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new AssignError(
      'ERR_ASSIGN_NO_TEAM_MD',
      `"${cloneDest}" does not contain .squad/team.md. ` +
      'This repository is not a squad host. Clone directory has been removed.',
    );
  }

  // Bind the product clone (git-root of resolvedTargetDir).
  const gitRoot = gitRootFn(resolvedTargetDir);
  if (!gitRoot) {
    throw new AssignError(
      'ERR_ASSIGN_NOT_GIT_REPO',
      `"${resolvedTargetDir}" is not inside a Git repository.\n` +
      '  Run squad assign from the root of your product clone.',
    );
  }
  const clonePath = gitRoot;

  const rawRemotes = remotesFn(resolvedTargetDir);
  // Deduplicate within the incoming set before comparing against existing origins.
  const normalizedNewOrigins = Array.from(new Set(rawRemotes.map(normalizeRemoteUrl)));

  const reactivating = existingEntry !== undefined;
  const baseEntry: RegistryEntry = existingEntry
    ? { ...existingEntry }
    : { callsign, path: squadDir };

  const existingClones = baseEntry.clones ?? [];
  const existingOrigins = baseEntry.origins ?? [];
  const originsToAdd = normalizedNewOrigins.filter(
    no => !existingOrigins.some(eo => normalizeRemoteUrl(eo) === no),
  );

  const updatedEntry: RegistryEntry = {
    ...baseEntry,
    path: squadDir,
    callsign,
    initUri: url,
    clones: existingClones.some(c => normalisedPathKey(c) === normalisedPathKey(clonePath))
      ? existingClones
      : [...existingClones, clonePath],
    // Defensive dedup at write boundary: deduplicate origins regardless of source.
    origins: Array.from(new Set([...existingOrigins, ...originsToAdd])),
    ...(reactivating ? { status: 'active' as const } : {}),
    // Additive merge: opts values win when supplied; existing entry values preserved when omitted.
    ...(opts.stateRemote !== undefined ? { stateRemote: opts.stateRemote } : {}),
    ...(opts.stateBranch !== undefined ? { stateBranch: opts.stateBranch } : {}),
    ...(opts.inboxHandle !== undefined ? { inboxHandle: opts.inboxHandle } : {}),
  };

  const otherSquads = existingSquads.filter(s => s.callsign !== callsign);
  const newRegistry: Registry = {
    version: registry?.version ?? 1,
    squads: [...otherSquads, updatedEntry],
  };

  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });

  // Wrap the registry write: if it fails after a successful clone, remove the
  // orphan clone directory before re-throwing so it doesn't persist without a
  // registry reference.
  try {
    writeRegistryFn(registryFilePath, newRegistry);
  } catch (writeErr) {
    try { fs.rmSync(cloneDest, { recursive: true, force: true }); } catch { /* ignore */ }
    throw writeErr;
  }

  // Install Copilot payload after successful registry write.
  let coordinatorInstalled = false;
  const coldWarnings: string[] = [];
  try {
    const installRes = installCopilotPayload({
      hostDir: cloneDest,
      callsign,
      copilotHome: opts.copilotHome,
      skillsFrom: opts.skillsFrom,
      cwd: opts.cwd ?? cwd,
    });
    coordinatorInstalled = installRes.coordinatorInstalled;
  } catch (err) {
    if (err instanceof CopilotPayloadError && err.code === 'ERR_PAYLOAD_INVALID_SKILLS_SOURCE') {
      throw new AssignError('ERR_ASSIGN_INVALID_SKILLS_SOURCE', err.message);
    }
    coldWarnings.push(
      `Could not install Copilot payload: ${err instanceof Error ? err.message : String(err)}. ` +
      `Re-run "squad assign ${callsign}" after fixing the source or permissions.`,
    );
  }

  // Install cross-repo post-commit hook in BOTH clones: host (filtered) and product (unfiltered).
  // Each install is independent — one failure must not abort the other.
  // Supersedes piece-34 host-only constraint (.squad/decisions.md:998).
  try {
    installCrossRepoHookFn(cloneDest);
  } catch (err) {
    coldWarnings.push(
      `Could not install cross-repo hook at host "${cloneDest}": ${err instanceof Error ? err.message : String(err)}. ` +
      `Run 'squad assign ${callsign}' again after the shared-squad host clone is available.`,
    );
  }
  try {
    installCrossRepoHookFn(clonePath);
  } catch (err) {
    coldWarnings.push(
      `Could not install cross-repo hook at product "${clonePath}": ${err instanceof Error ? err.message : String(err)}. ` +
      `Run 'squad assign ${callsign}' again after the product clone is available.`,
    );
  }

  // Install product .squad/-forbid pre-commit guard (product clone only, NOT host).
  // Independent try/catch — failure does not abort assign or the post-commit installs.
  try {
    installProductSquadForbidHookFn(clonePath);
  } catch (err) {
    coldWarnings.push(
      `Could not install .squad/-forbid pre-commit guard at "${clonePath}": ${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  return {
    kind: reactivating ? 'reactivated' : 'assigned',
    callsign,
    hostPath: squadDir,
    clonePath,
    warnings: coldWarnings,
    coordinatorInstalled,
  };
}
