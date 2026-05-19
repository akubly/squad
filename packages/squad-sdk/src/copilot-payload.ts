/**
 * Copilot payload install, uninstall, and diagnostic helpers.
 *
 * Manages user-scoped Copilot home files for an assigned squad:
 * skills, per-squad agent files, instructions, MCP server config,
 * and the shared coordinator agent file.
 *
 * Uses node:fs, node:path, and node:os only — no runtime dependencies.
 *
 * @module copilot-payload
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ============================================================
// Error type
// ============================================================

/**
 * Error thrown by `installCopilotPayload`, `uninstallCopilotPayload`, and `diagnoseCopilotPayload`.
 *
 * Inspect `.code` to branch programmatically:
 *
 * - `ERR_PAYLOAD_INVALID_SKILLS_SOURCE` — the `--skills-from` value is URL-like or
 *   resolves to no local directory on disk.
 * - `ERR_PAYLOAD_IO` — a read or write failure occurred during payload install or uninstall.
 * - `ERR_PAYLOAD_INVALID_CALLSIGN` — the callsign does not match the required format
 *   (lowercase alphanumeric, optional internal hyphens, 1–64 characters).
 */
export class CopilotPayloadError extends Error {
  code: 'ERR_PAYLOAD_INVALID_SKILLS_SOURCE' | 'ERR_PAYLOAD_IO' | 'ERR_PAYLOAD_INVALID_CALLSIGN';

  constructor(
    code: 'ERR_PAYLOAD_INVALID_SKILLS_SOURCE' | 'ERR_PAYLOAD_IO' | 'ERR_PAYLOAD_INVALID_CALLSIGN',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'CopilotPayloadError';
  }
}

// ============================================================
// Install
// ============================================================

export interface InstallCopilotPayloadOpts {
  /** Squad host directory (the .squad parent dir, where .copilot/ and .github/ live). */
  hostDir: string;
  /** Callsign — used for namespacing destination paths. */
  callsign: string;
  /** Override the user-scoped Copilot home. Defaults to `path.join(os.homedir(), '.copilot')`. */
  copilotHome?: string;
  /** Skill source selector: undefined|'host', 'none', or local path. */
  skillsFrom?: string;
  /** Current working directory for resolving relative skill paths. */
  cwd?: string;
}

export interface InstallCopilotPayloadResult {
  /** True when the shared coordinator file was installed. */
  coordinatorInstalled: boolean;
  skillsInstalled: number;
  agentsInstalled: number;
  instructionsInstalled: number;
  mcpServersAdded: number;
}

/**
 * Install (or refresh) the squad's Copilot payload into the user-scoped Copilot home.
 *
 * Idempotent: replaces only files and MCP keys owned by the selected callsign namespace.
 * Preserves other callsigns' payload files and user-created configuration.
 */
export function installCopilotPayload(opts: InstallCopilotPayloadOpts): InstallCopilotPayloadResult {
  const copilotHome = opts.copilotHome ?? path.join(os.homedir(), '.copilot');
  const { hostDir, callsign } = opts;
  assertValidCallsign(callsign);
  const cwd = opts.cwd ?? process.cwd();
  const skillsFrom = opts.skillsFrom;
  const namespace = `squad-${callsign}-`;

  // Validate skillsFrom before any file writes.
  if (skillsFrom !== undefined && skillsFrom !== 'none' && skillsFrom !== 'host') {
    if (_isUrlLike(skillsFrom)) {
      throw new CopilotPayloadError(
        'ERR_PAYLOAD_INVALID_SKILLS_SOURCE',
        `"${skillsFrom}" looks like a URL. Provide a local path, "host", or "none".`,
      );
    }
    const resolved = path.isAbsolute(skillsFrom) ? skillsFrom : path.resolve(cwd, skillsFrom);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new CopilotPayloadError(
        'ERR_PAYLOAD_INVALID_SKILLS_SOURCE',
        `"${skillsFrom}" does not resolve to an existing local directory.`,
      );
    }
  }

  let skillsInstalled = 0;
  let agentsInstalled = 0;
  let instructionsInstalled = 0;
  let mcpServersAdded = 0;
  let coordinatorInstalled = false;

  // ---- Skills -------------------------------------------------------

  const skillsDestBase = path.join(copilotHome, 'skills');

  // Remove stale skill dirs for this callsign (idempotency).
  if (fs.existsSync(skillsDestBase)) {
    for (const entry of fs.readdirSync(skillsDestBase, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(namespace)) {
        fs.rmSync(path.join(skillsDestBase, entry.name), { recursive: true, force: true });
      }
    }
  }

  if (skillsFrom !== 'none') {
    const skillsSourceDir = _resolveSkillsSourceDir(hostDir, skillsFrom, cwd);

    if (skillsSourceDir && fs.existsSync(skillsSourceDir)) {
      for (const entry of fs.readdirSync(skillsSourceDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const srcSkillDir = path.join(skillsSourceDir, entry.name);
        const destSkillName = `${namespace}${entry.name}`;
        const destSkillDir = path.join(skillsDestBase, destSkillName);

        _copyDirRecursive(srcSkillDir, destSkillDir);

        // Rewrite SKILL.md frontmatter name field.
        const skillMdPath = path.join(destSkillDir, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          const content = fs.readFileSync(skillMdPath, 'utf8');
          const rewritten = _rewriteFrontmatterName(content, destSkillName);
          if (rewritten !== content) {
            fs.writeFileSync(skillMdPath, rewritten, 'utf8');
          }
        }

        skillsInstalled++;
      }
    }
  }

  // ---- Per-squad agent files ----------------------------------------

  const agentsSourceDir = path.join(hostDir, '.copilot', 'agents');
  const agentsDestDir = path.join(copilotHome, 'agents');

  // Remove stale agent files for this callsign.
  if (fs.existsSync(agentsDestDir)) {
    for (const entry of fs.readdirSync(agentsDestDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.startsWith(namespace) &&
        entry.name.endsWith('.agent.md')
      ) {
        fs.unlinkSync(path.join(agentsDestDir, entry.name));
      }
    }
  }

  if (fs.existsSync(agentsSourceDir)) {
    fs.mkdirSync(agentsDestDir, { recursive: true });
    for (const entry of fs.readdirSync(agentsSourceDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.agent.md')) continue;
      const srcPath = path.join(agentsSourceDir, entry.name);
      const destName = `${namespace}${entry.name}`;
      const destPath = path.join(agentsDestDir, destName);

      const content = fs.readFileSync(srcPath, 'utf8');
      // Rewrite the name field to the installed namespaced name (drop .agent.md extension).
      const nameValue = destName.endsWith('.agent.md')
        ? destName.slice(0, -'.agent.md'.length)
        : destName;
      const rewritten = _rewriteFrontmatterName(content, nameValue);
      fs.writeFileSync(destPath, rewritten, 'utf8');
      agentsInstalled++;
    }
  }

  // ---- Shared coordinator -------------------------------------------

  const coordinatorSrc = path.join(hostDir, '.github', 'agents', 'squad.agent.md');
  if (fs.existsSync(coordinatorSrc)) {
    fs.mkdirSync(agentsDestDir, { recursive: true });
    fs.copyFileSync(coordinatorSrc, path.join(agentsDestDir, 'squad.agent.md'));
    coordinatorInstalled = true;
  }

  // ---- Instructions -------------------------------------------------

  const instructionsSrc = path.join(hostDir, '.copilot', 'instructions');
  const instructionsDest = path.join(copilotHome, 'instructions', `squad-${callsign}`);

  // Remove stale instruction dir for this callsign.
  if (fs.existsSync(instructionsDest)) {
    fs.rmSync(instructionsDest, { recursive: true, force: true });
  }

  if (fs.existsSync(instructionsSrc)) {
    instructionsInstalled = _copyDirRecursive(instructionsSrc, instructionsDest);
  }

  // ---- MCP config ---------------------------------------------------

  const userMcpPath = path.join(copilotHome, 'mcp-config.json');
  const hostMcpPath = path.join(hostDir, '.copilot', 'mcp-config.json');

  let userMcp: Record<string, unknown> = {};
  if (fs.existsSync(userMcpPath)) {
    try {
      userMcp = JSON.parse(fs.readFileSync(userMcpPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // Start fresh if the file is malformed.
    }
  }

  const userServers = (userMcp['mcpServers'] ?? {}) as Record<string, unknown>;

  // Strip this callsign's prefixed keys.
  let keysStripped = 0;
  for (const key of Object.keys(userServers)) {
    if (key.startsWith(`squad-${callsign}-`)) {
      delete userServers[key];
      keysStripped++;
    }
  }

  // Add host's keys with the callsign prefix.
  if (fs.existsSync(hostMcpPath)) {
    try {
      const hostMcp = JSON.parse(fs.readFileSync(hostMcpPath, 'utf8')) as Record<string, unknown>;
      const hostServers = (hostMcp['mcpServers'] ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(hostServers)) {
        userServers[`squad-${callsign}-${key}`] = value;
        mcpServersAdded++;
      }
    } catch {
      // Skip if host MCP config is unreadable.
    }
  }

  if (keysStripped > 0 || mcpServersAdded > 0) {
    userMcp['mcpServers'] = userServers;
    fs.mkdirSync(copilotHome, { recursive: true });
    fs.writeFileSync(userMcpPath, `${JSON.stringify(userMcp, null, 2)}\n`, 'utf8');
  }

  return {
    coordinatorInstalled,
    skillsInstalled,
    agentsInstalled,
    instructionsInstalled,
    mcpServersAdded,
  };
}

// ============================================================
// Uninstall
// ============================================================

export interface UninstallCopilotPayloadOpts {
  callsign: string;
  copilotHome?: string;
}

export interface UninstallCopilotPayloadResult {
  /** True when the shared coordinator was removed (last squad payload gone). */
  coordinatorRemoved: boolean;
  skillsRemoved: number;
  agentsRemoved: number;
  instructionsRemoved: boolean;
  mcpServersRemoved: number;
}

/**
 * Remove the user-scoped Copilot payload for one callsign.
 *
 * Only removes files and MCP keys owned by the selected callsign namespace.
 * Removes the shared coordinator only when no other squad-namespaced agent files remain.
 * Succeeds even when no payload exists.
 */
export function uninstallCopilotPayload(opts: UninstallCopilotPayloadOpts): UninstallCopilotPayloadResult {
  const copilotHome = opts.copilotHome ?? path.join(os.homedir(), '.copilot');
  const { callsign } = opts;
  assertValidCallsign(callsign);
  const namespace = `squad-${callsign}-`;

  let skillsRemoved = 0;
  let agentsRemoved = 0;
  let instructionsRemoved = false;
  let mcpServersRemoved = 0;
  let coordinatorRemoved = false;

  // Remove skill dirs.
  const skillsDir = path.join(copilotHome, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(namespace)) {
        fs.rmSync(path.join(skillsDir, entry.name), { recursive: true, force: true });
        skillsRemoved++;
      }
    }
  }

  // Remove agent files.
  const agentsDir = path.join(copilotHome, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.startsWith(namespace) &&
        entry.name.endsWith('.agent.md')
      ) {
        fs.unlinkSync(path.join(agentsDir, entry.name));
        agentsRemoved++;
      }
    }

    // Remove the shared coordinator when no other squad-namespaced agents remain.
    const remainingSquadAgents = fs.readdirSync(agentsDir, { withFileTypes: true }).filter(
      e => e.isFile() && /^squad-.+-.+\.agent\.md$/.test(e.name),
    );

    if (remainingSquadAgents.length === 0) {
      const coordinatorPath = path.join(agentsDir, 'squad.agent.md');
      if (fs.existsSync(coordinatorPath)) {
        fs.unlinkSync(coordinatorPath);
        coordinatorRemoved = true;
      }
    }
  }

  // Remove instructions dir.
  const instructionsDest = path.join(copilotHome, 'instructions', `squad-${callsign}`);
  if (fs.existsSync(instructionsDest)) {
    fs.rmSync(instructionsDest, { recursive: true, force: true });
    instructionsRemoved = true;
  }

  // Remove MCP keys for this callsign.
  const userMcpPath = path.join(copilotHome, 'mcp-config.json');
  if (fs.existsSync(userMcpPath)) {
    try {
      const userMcp = JSON.parse(fs.readFileSync(userMcpPath, 'utf8')) as Record<string, unknown>;
      const userServers = (userMcp['mcpServers'] ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(userServers)) {
        if (key.startsWith(`squad-${callsign}-`)) {
          delete userServers[key];
          mcpServersRemoved++;
        }
      }
      if (mcpServersRemoved > 0) {
        userMcp['mcpServers'] = userServers;
        fs.writeFileSync(userMcpPath, `${JSON.stringify(userMcp, null, 2)}\n`, 'utf8');
      }
    } catch {
      // Best-effort; ignore parse errors.
    }
  }

  return { coordinatorRemoved, skillsRemoved, agentsRemoved, instructionsRemoved, mcpServersRemoved };
}

// ============================================================
// Diagnose
// ============================================================

export interface DiagnoseCopilotPayloadOpts {
  /** Registered callsigns from the registry. */
  knownCallsigns: string[];
  copilotHome?: string;
}

export interface DiagnoseCopilotPayloadResult {
  orphans: Array<{ kind: 'skill' | 'agent'; callsign: string; pathOnDisk: string }>;
}

/**
 * Report payload files whose owning callsign is no longer in the registry.
 *
 * Scans skills and agents directories for squad-namespaced entries and
 * flags any whose callsign is absent from `knownCallsigns`. Does not delete.
 */
export function diagnoseCopilotPayload(opts: DiagnoseCopilotPayloadOpts): DiagnoseCopilotPayloadResult {
  const copilotHome = opts.copilotHome ?? path.join(os.homedir(), '.copilot');
  const { knownCallsigns } = opts;
  for (const cs of knownCallsigns) {
    assertValidCallsign(cs);
  }
  const orphans: Array<{ kind: 'skill' | 'agent'; callsign: string; pathOnDisk: string }> = [];

  // Check skills.
  const skillsDir = path.join(copilotHome, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('squad-')) continue;

      let owned = false;
      for (const cs of knownCallsigns) {
        if (entry.name.startsWith(`squad-${cs}-`)) {
          owned = true;
          break;
        }
      }

      if (!owned) {
        const candidate = _extractCandidateCallsign(entry.name);
        if (candidate !== null) {
          orphans.push({
            kind: 'skill',
            callsign: candidate,
            pathOnDisk: path.join(skillsDir, entry.name),
          });
        }
      }
    }
  }

  // Check agents.
  const agentsDir = path.join(copilotHome, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith('squad-') || !entry.name.endsWith('.agent.md')) continue;
      if (entry.name === 'squad.agent.md') continue; // shared coordinator — not namespaced

      // Strip .agent.md before parsing.
      const base = entry.name.slice(0, -'.agent.md'.length);

      let owned = false;
      for (const cs of knownCallsigns) {
        if (base.startsWith(`squad-${cs}-`)) {
          owned = true;
          break;
        }
      }

      if (!owned) {
        const candidate = _extractCandidateCallsign(base);
        if (candidate !== null) {
          orphans.push({
            kind: 'agent',
            callsign: candidate,
            pathOnDisk: path.join(agentsDir, entry.name),
          });
        }
      }
    }
  }

  return { orphans };
}

// ============================================================
// Internal helpers
// ============================================================

// Callsign must be lowercase alphanumeric, optionally with internal hyphens, max 64 chars.
const CALLSIGN_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function assertValidCallsign(callsign: string): void {
  if (!CALLSIGN_RE.test(callsign) || callsign.length > 64) {
    throw new CopilotPayloadError(
      'ERR_PAYLOAD_INVALID_CALLSIGN',
      `Callsign must match ${CALLSIGN_RE}, got: ${JSON.stringify(callsign)}`,
    );
  }
}

function _isUrlLike(s: string): boolean {
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('git@') ||
    s.startsWith('ssh://') ||
    s.startsWith('//')
  );
}

/**
 * Resolve the skills source directory from the `skillsFrom` option.
 *
 * - undefined / 'host' → `<hostDir>/.copilot/skills`
 * - local path → if basename is `.copilot`, use `<path>/skills`; otherwise use `<path>` directly
 */
function _resolveSkillsSourceDir(
  hostDir: string,
  skillsFrom: string | undefined,
  cwd: string,
): string {
  if (!skillsFrom || skillsFrom === 'host') {
    return path.join(hostDir, '.copilot', 'skills');
  }

  const resolved = path.isAbsolute(skillsFrom) ? skillsFrom : path.resolve(cwd, skillsFrom);
  return path.basename(resolved) === '.copilot'
    ? path.join(resolved, 'skills')
    : resolved;
}

/**
 * Recursively copy `src` directory into `dest`. Returns file count.
 *
 * Symlinks are skipped unconditionally — following them across trust boundaries
 * (e.g., the cold-start path where the host repo is untrusted) could copy
 * arbitrary host-filesystem content into the user-scoped Copilot home.
 */
function _copyDirRecursive(src: string, dest: string): number {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip symlinks — Dirent.isDirectory() reports the target type, not the link type,
    // so check isSymbolicLink() first.
    if (entry.isSymbolicLink()) {
      console.warn(`[copilot-payload] Skipping symlink: ${srcPath}`);
      continue;
    }

    if (entry.isDirectory()) {
      count += _copyDirRecursive(srcPath, destPath);
    } else {
      // Belt-and-suspenders: confirm at the OS level that this is a regular file.
      if (fs.lstatSync(srcPath).isSymbolicLink()) {
        console.warn(`[copilot-payload] Skipping symlink (lstat): ${srcPath}`);
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/**
 * Extract a candidate callsign from a namespaced file/dir name.
 *
 * Format: `squad-<callsign>-<rest>` — candidate is everything between
 * `squad-` and the final `-<rest>` segment.
 *
 * Returns null when the name doesn't contain enough segments to parse.
 */
function _extractCandidateCallsign(name: string): string | null {
  if (!name.startsWith('squad-')) return null;
  const withoutPrefix = name.slice('squad-'.length);
  const lastDash = withoutPrefix.lastIndexOf('-');
  if (lastDash <= 0) return null;
  return withoutPrefix.slice(0, lastDash);
}

/**
 * Rewrite the first `name:` field inside a YAML frontmatter block.
 *
 * Only modifies files that have a `---` frontmatter block containing
 * a `name:` key. All other content is preserved verbatim.
 *
 * Block-scalar values (`name: |`, `name: >`, etc.) are handled by option (a):
 * the `name:` line AND any immediately-following indented continuation lines are
 * stripped and replaced with the plain `name: <newName>` scalar. This prevents
 * orphaned continuation lines from corrupting the frontmatter YAML.
 *
 * @internal Exposed for unit testing via the `copilot-payload` subpath only.
 * Not part of the stable public API surface.
 */
export function _rewriteFrontmatterName(content: string, newName: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return content;

  const block = match[1]!;
  if (!/^name:/m.test(block)) return content;

  // Replace the name: line and any block-scalar continuation lines (indented lines).
  const newBlock = block.replace(/^name:[ \t].*(?:\r?\n[ \t]+.*)*/m, `name: ${newName}`);
  return content.replace(match[0]!, `---\n${newBlock}\n---\n`);
}
