/**
 * Tests for Copilot payload install, uninstall, and diagnostic helpers,
 * and for the assign/unassign integration that invokes them.
 *
 * @module commands/__tests__/copilot-payload.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  installCopilotPayload,
  uninstallCopilotPayload,
  diagnoseCopilotPayload,
  _rewriteFrontmatterName,
  CopilotPayloadError,
} from '@wifi-aware/squad-sdk/copilot-payload';
import { runAssign } from '../assign.js';
import { runUnassign } from '../unassign.js';

const TEST_ROOT = path.join(process.cwd(), `.test-copilot-payload-${randomBytes(4).toString('hex')}`);

// ============================================================
// Helpers
// ============================================================

function makeDir(relPath: string): string {
  const dir = path.join(TEST_ROOT, relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/** Build a minimal squad host directory. */
function makeHost(relPath: string): string {
  const hostDir = makeDir(relPath);
  fs.mkdirSync(path.join(hostDir, '.squad'), { recursive: true });
  writeFile(path.join(hostDir, '.squad', 'team.md'), '# Team\n');
  return hostDir;
}

/** Write a skill directory with a SKILL.md. */
function addSkill(hostDir: string, skillName: string, extraContent = ''): string {
  const skillDir = path.join(hostDir, '.copilot', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: test\n---\n# ${skillName}${extraContent}`,
  );
  return skillDir;
}

/** Write a per-squad agent file. */
function addAgent(hostDir: string, agentName: string): string {
  const agentPath = path.join(hostDir, '.copilot', 'agents', `${agentName}.agent.md`);
  writeFile(agentPath, `---\nname: ${agentName}\ndescription: test\n---\n# ${agentName}`);
  return agentPath;
}

/** Write the shared coordinator file. */
function addCoordinator(hostDir: string): string {
  const coordinatorPath = path.join(hostDir, '.github', 'agents', 'squad.agent.md');
  writeFile(coordinatorPath, `---\nname: squad\n---\n# Coordinator`);
  return coordinatorPath;
}

/** Write instructions. */
function addInstructions(hostDir: string): void {
  writeFile(path.join(hostDir, '.copilot', 'instructions', 'coding.md'), '# Coding instructions\n');
}

/** Write a host MCP config. */
function addHostMcp(hostDir: string, servers: Record<string, unknown>): void {
  writeFile(
    path.join(hostDir, '.copilot', 'mcp-config.json'),
    JSON.stringify({ mcpServers: servers }, null, 2),
  );
}

/** Write the user-level MCP config. */
function writeUserMcp(copilotHome: string, data: unknown): void {
  writeFile(path.join(copilotHome, 'mcp-config.json'), JSON.stringify(data, null, 2));
}

function readUserMcp(copilotHome: string): Record<string, unknown> {
  return JSON.parse(readFile(path.join(copilotHome, 'mcp-config.json')));
}

function writeRegistry(registryPath: string, squads: unknown[]): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
}

// ============================================================
// Test 1: Skill install
// ============================================================

describe('skill install', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addSkill(hostDir, 'my-skill');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('copies .copilot/skills/<name>/ to skills/squad-<callsign>-<name>/', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-my-skill'))).toBe(true);
  });
});

// ============================================================
// Test 2: Skill frontmatter rewrite
// ============================================================

describe('skill frontmatter rewrite', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addSkill(hostDir, 'my-skill');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('rewrites only the name: field in SKILL.md frontmatter', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    const skillMd = readFile(path.join(copilotHome, 'skills', 'squad-alpha-my-skill', 'SKILL.md'));
    expect(skillMd).toContain('name: squad-alpha-my-skill');
    expect(skillMd).toContain('description: test');
  });

  it('rewriteFrontmatterName leaves body content unchanged', () => {
    const content = '---\nname: old-name\ndescription: kept\n---\n# Body text\n';
    const result = _rewriteFrontmatterName(content, 'new-name');
    expect(result).toContain('name: new-name');
    expect(result).toContain('description: kept');
    expect(result).toContain('# Body text');
  });

  it('rewriteFrontmatterName leaves content unchanged when no frontmatter', () => {
    const content = '# No frontmatter here\nname: not-fm\n';
    expect(_rewriteFrontmatterName(content, 'x')).toBe(content);
  });
});

// ============================================================
// Test 3: Recursive skill copy
// ============================================================

describe('recursive skill copy', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');

    const skillDir = path.join(hostDir, '.copilot', 'skills', 'deep-skill');
    fs.mkdirSync(path.join(skillDir, 'sub'), { recursive: true });
    writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: deep-skill\n---\n# Deep');
    writeFile(path.join(skillDir, 'helper.md'), '# helper');
    writeFile(path.join(skillDir, 'sub', 'nested.md'), '# nested');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('copies all files under the skill directory recursively', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    const dest = path.join(copilotHome, 'skills', 'squad-alpha-deep-skill');
    expect(fileExists(path.join(dest, 'SKILL.md'))).toBe(true);
    expect(fileExists(path.join(dest, 'helper.md'))).toBe(true);
    expect(fileExists(path.join(dest, 'sub', 'nested.md'))).toBe(true);
  });
});

// ============================================================
// Test 4: Skill source path
// ============================================================

describe('skill source path', () => {
  let hostDir: string;
  let copilotHome: string;
  let altSkillsDir: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');

    // Alt skills dir with a different skill
    altSkillsDir = makeDir('alt-skills');
    const altSkill = path.join(altSkillsDir, 'alt-skill');
    fs.mkdirSync(altSkill, { recursive: true });
    writeFile(path.join(altSkill, 'SKILL.md'), '---\nname: alt-skill\n---\n# Alt');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('installs skills from the local path when --skills-from <path> is used', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome, skillsFrom: altSkillsDir });
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-alt-skill'))).toBe(true);
  });

  it('accepts a .copilot directory as skills source and reads from its skills/ subdir', () => {
    const dotCopilotDir = makeDir('alt-copilot/.copilot');
    const dotCopilotSkillDir = path.join(dotCopilotDir, 'skills', 'dot-copilot-skill');
    fs.mkdirSync(dotCopilotSkillDir, { recursive: true });
    writeFile(path.join(dotCopilotSkillDir, 'SKILL.md'), '---\nname: dot-copilot-skill\n---\n# S');

    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome, skillsFrom: dotCopilotDir });
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-dot-copilot-skill'))).toBe(true);
  });
});

// ============================================================
// Test 5: Skill source none
// ============================================================

describe('skill source none', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addSkill(hostDir, 'some-skill');

    // Pre-install
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('removes this callsign existing skill payload and skips copy when skillsFrom is none', () => {
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-some-skill'))).toBe(true);

    const result = installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome, skillsFrom: 'none' });

    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-some-skill'))).toBe(false);
    expect(result.skillsInstalled).toBe(0);
  });
});

// ============================================================
// Test 6: Invalid skill source
// ============================================================

describe('invalid skill source', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('throws CopilotPayloadError for a URL-like source', () => {
    expect(() =>
      installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome, skillsFrom: 'https://example.com/skills' }),
    ).toThrow(CopilotPayloadError);
  });

  it('throws CopilotPayloadError for a missing local path', () => {
    expect(() =>
      installCopilotPayload({
        hostDir,
        callsign: 'alpha',
        copilotHome,
        skillsFrom: path.join(TEST_ROOT, 'does-not-exist'),
      }),
    ).toThrow(CopilotPayloadError);
  });

  it('has ERR_PAYLOAD_INVALID_SKILLS_SOURCE code', () => {
    try {
      installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome, skillsFrom: 'https://bad.url' });
    } catch (err) {
      expect(err).toBeInstanceOf(CopilotPayloadError);
      expect((err as CopilotPayloadError).code).toBe('ERR_PAYLOAD_INVALID_SKILLS_SOURCE');
    }
  });

  it('does not write payload files before throwing for invalid source', () => {
    try {
      installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome, skillsFrom: 'https://bad.url' });
    } catch { /* expected */ }
    // No skills/ directory should have been created
    expect(fs.existsSync(path.join(copilotHome, 'skills'))).toBe(false);
  });
});

// ============================================================
// Test 7: Agent install
// ============================================================

describe('agent install', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addAgent(hostDir, 'my-dev');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('copies agent files with callsign-prefixed names', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    expect(fileExists(path.join(copilotHome, 'agents', 'squad-alpha-my-dev.agent.md'))).toBe(true);
  });

  it('rewrites the frontmatter name field in agent files', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    const content = readFile(path.join(copilotHome, 'agents', 'squad-alpha-my-dev.agent.md'));
    expect(content).toContain('name: squad-alpha-my-dev');
  });
});

// ============================================================
// Test 8: Coordinator install
// ============================================================

describe('coordinator install', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addCoordinator(hostDir);
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('copies .github/agents/squad.agent.md to <copilotHome>/agents/squad.agent.md', () => {
    const result = installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    expect(result.coordinatorInstalled).toBe(true);
    expect(fileExists(path.join(copilotHome, 'agents', 'squad.agent.md'))).toBe(true);
  });
});

// ============================================================
// Test 9: Coordinator absence
// ============================================================

describe('coordinator absence', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    // No coordinator written
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('returns coordinatorInstalled=false when coordinator is absent', () => {
    const result = installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    expect(result.coordinatorInstalled).toBe(false);
    expect(fileExists(path.join(copilotHome, 'agents', 'squad.agent.md'))).toBe(false);
  });
});

// ============================================================
// Test 10: Instructions install
// ============================================================

describe('instructions install', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addInstructions(hostDir);
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('copies instructions under isolated instructions/squad-<callsign>/', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    expect(fileExists(path.join(copilotHome, 'instructions', 'squad-alpha', 'coding.md'))).toBe(true);
  });
});

// ============================================================
// Test 11: MCP merge
// ============================================================

describe('MCP merge', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addHostMcp(hostDir, { myServer: { url: 'http://localhost:3000' } });
    writeUserMcp(copilotHome, { mcpServers: { unrelated: { url: 'http://other' } } });
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('adds callsign-prefixed server keys from host MCP config', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    const mcp = readUserMcp(copilotHome);
    const servers = mcp['mcpServers'] as Record<string, unknown>;
    expect(servers['squad-alpha-myServer']).toBeDefined();
  });

  it('preserves unrelated MCP server keys', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    const mcp = readUserMcp(copilotHome);
    const servers = mcp['mcpServers'] as Record<string, unknown>;
    expect(servers['unrelated']).toBeDefined();
  });
});

// ============================================================
// Test 12: MCP refresh
// ============================================================

describe('MCP refresh', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addHostMcp(hostDir, { serverA: { url: 'http://a' } });
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('replaces only this callsign prefixed keys on repeat assign', () => {
    // First install adds squad-alpha-serverA
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

    // Update host MCP to use serverB instead
    addHostMcp(hostDir, { serverB: { url: 'http://b' } });

    // Second install should replace squad-alpha-serverA with squad-alpha-serverB
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    const mcp = readUserMcp(copilotHome);
    const servers = mcp['mcpServers'] as Record<string, unknown>;
    expect(servers['squad-alpha-serverA']).toBeUndefined();
    expect(servers['squad-alpha-serverB']).toBeDefined();
  });
});

// ============================================================
// Test 13: Missing payload directories
// ============================================================

describe('missing payload directories', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    // No .copilot/ or .github/ in hostDir
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('does not throw when .copilot/ is absent', () => {
    expect(() => installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome })).not.toThrow();
  });

  it('returns zero counts when nothing to install', () => {
    const result = installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    expect(result.skillsInstalled).toBe(0);
    expect(result.agentsInstalled).toBe(0);
    expect(result.coordinatorInstalled).toBe(false);
  });
});

// ============================================================
// Test 14: Install idempotency
// ============================================================

describe('install idempotency', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addSkill(hostDir, 'skill-a');
    addCoordinator(hostDir);
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('running install twice produces same output files', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

    // Add a stale extra file in the skill dir to test cleanup
    const staleFile = path.join(copilotHome, 'skills', 'squad-alpha-skill-a', 'stale.md');
    writeFile(staleFile, '# stale');

    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

    // Stale file should be gone (dir replaced)
    expect(fileExists(staleFile)).toBe(false);

    // Current file should exist
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-skill-a', 'SKILL.md'))).toBe(true);
  });

  it('other callsign payload files remain untouched', () => {
    // Pre-install a different callsign's skill manually
    const otherSkillDir = path.join(copilotHome, 'skills', 'squad-beta-other-skill');
    fs.mkdirSync(otherSkillDir, { recursive: true });
    writeFile(path.join(otherSkillDir, 'SKILL.md'), '---\nname: other\n---\n# other');

    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

    expect(fileExists(path.join(otherSkillDir, 'SKILL.md'))).toBe(true);
  });
});

// ============================================================
// Test 15: Uninstall cleanup
// ============================================================

describe('uninstall cleanup', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addSkill(hostDir, 'my-skill');
    addAgent(hostDir, 'my-dev');
    addInstructions(hostDir);
    addHostMcp(hostDir, { srv: { url: 'http://x' } });
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('removes this callsign skills, agents, instructions, and MCP keys', () => {
    const result = uninstallCopilotPayload({ callsign: 'alpha', copilotHome });

    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-my-skill'))).toBe(false);
    expect(fileExists(path.join(copilotHome, 'agents', 'squad-alpha-my-dev.agent.md'))).toBe(false);
    expect(fileExists(path.join(copilotHome, 'instructions', 'squad-alpha'))).toBe(false);
    expect(result.skillsRemoved).toBe(1);
    expect(result.agentsRemoved).toBe(1);
    expect(result.instructionsRemoved).toBe(true);
    expect(result.mcpServersRemoved).toBe(1);
  });

  it('succeeds even when no payload exists for callsign', () => {
    expect(() => uninstallCopilotPayload({ callsign: 'nonexistent', copilotHome })).not.toThrow();
  });
});

// ============================================================
// Test 16: Coordinator cleanup
// ============================================================

describe('coordinator cleanup', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    copilotHome = makeDir('copilot-home');
    addAgent(hostDir, 'dev');
    addCoordinator(hostDir);
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('preserves shared coordinator while another squad payload remains', () => {
    // Install two squads
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });
    installCopilotPayload({ hostDir, callsign: 'beta', copilotHome });

    // Uninstall alpha — beta still present, coordinator should remain
    const result = uninstallCopilotPayload({ callsign: 'alpha', copilotHome });
    expect(result.coordinatorRemoved).toBe(false);
    expect(fileExists(path.join(copilotHome, 'agents', 'squad.agent.md'))).toBe(true);
  });

  it('removes shared coordinator after last squad payload is gone', () => {
    installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

    const result = uninstallCopilotPayload({ callsign: 'alpha', copilotHome });
    expect(result.coordinatorRemoved).toBe(true);
    expect(fileExists(path.join(copilotHome, 'agents', 'squad.agent.md'))).toBe(false);
  });
});

// ============================================================
// Test 17: Multi-squad coexistence
// ============================================================

describe('multi-squad coexistence', () => {
  let hostAlpha: string;
  let hostBeta: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostAlpha = makeHost('host-alpha');
    hostBeta = makeHost('host-beta');
    copilotHome = makeDir('copilot-home');

    addSkill(hostAlpha, 'alpha-skill');
    addSkill(hostBeta, 'beta-skill');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('two callsigns install independently', () => {
    installCopilotPayload({ hostDir: hostAlpha, callsign: 'alpha', copilotHome });
    installCopilotPayload({ hostDir: hostBeta, callsign: 'beta', copilotHome });

    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-alpha-skill'))).toBe(true);
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-beta-beta-skill'))).toBe(true);
  });

  it('uninstalling one callsign leaves the other intact', () => {
    installCopilotPayload({ hostDir: hostAlpha, callsign: 'alpha', copilotHome });
    installCopilotPayload({ hostDir: hostBeta, callsign: 'beta', copilotHome });

    uninstallCopilotPayload({ callsign: 'alpha', copilotHome });

    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-alpha-skill'))).toBe(false);
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-beta-beta-skill'))).toBe(true);
  });
});

// ============================================================
// Test 18: Doctor orphan warning
// ============================================================

describe('doctor orphan warning', () => {
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    copilotHome = makeDir('copilot-home');

    // Write an orphaned skill (callsign 'old' is not in registry)
    const orphanSkill = path.join(copilotHome, 'skills', 'squad-old-skill');
    fs.mkdirSync(orphanSkill, { recursive: true });
    writeFile(path.join(orphanSkill, 'SKILL.md'), '---\nname: squad-old-skill\n---\n# Orphan');

    // Write a known skill (callsign 'alpha')
    const knownSkill = path.join(copilotHome, 'skills', 'squad-alpha-good-skill');
    fs.mkdirSync(knownSkill, { recursive: true });
    writeFile(path.join(knownSkill, 'SKILL.md'), '---\nname: squad-alpha-good-skill\n---\n# Good');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('reports orphaned skill whose callsign is not in registry', () => {
    const result = diagnoseCopilotPayload({ knownCallsigns: ['alpha'], copilotHome });
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]!.kind).toBe('skill');
    expect(result.orphans[0]!.callsign).toBe('old');
  });

  it('does not report known callsign as orphan', () => {
    const result = diagnoseCopilotPayload({ knownCallsigns: ['alpha'], copilotHome });
    const alphaOrphans = result.orphans.filter(o => o.callsign === 'alpha');
    expect(alphaOrphans).toHaveLength(0);
  });

  it('reports orphaned agent file', () => {
    const agentsDir = path.join(copilotHome, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    writeFile(path.join(agentsDir, 'squad-old-dev.agent.md'), '---\nname: old-dev\n---\n# Dev');

    const result = diagnoseCopilotPayload({ knownCallsigns: ['alpha'], copilotHome });
    const agentOrphans = result.orphans.filter(o => o.kind === 'agent');
    expect(agentOrphans.length).toBeGreaterThan(0);
    expect(agentOrphans[0]!.callsign).toBe('old');
  });
});

// ============================================================
// Test 19: Assign integration
// ============================================================

describe('assign integration', () => {
  let hostDir: string;
  let cloneDir: string;
  let copilotHome: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('host');
    cloneDir = makeDir('clone');
    copilotHome = makeDir('copilot-home');

    addSkill(hostDir, 'dev-skill');
    addCoordinator(hostDir);

    registryPath = path.join(TEST_ROOT, 'registry.json');
    const squadPath = path.join(hostDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('warm-path assign installs payload with resolved host path and copilot home', async () => {
    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      copilotHome,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.kind).toBe('assigned');
    expect((result as { coordinatorInstalled?: boolean }).coordinatorInstalled).toBe(true);
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-alpha-dev-skill'))).toBe(true);
    expect(fileExists(path.join(copilotHome, 'agents', 'squad.agent.md'))).toBe(true);
  });

  it('warm-path assign fails early with ERR_ASSIGN_INVALID_SKILLS_SOURCE for URL-like skills-from', async () => {
    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: cloneDir,
        copilotHome,
        skillsFrom: 'https://example.com',
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toMatchObject({ code: 'ERR_ASSIGN_INVALID_SKILLS_SOURCE' });
  });

  it('cold-start assign installs payload after clone', async () => {
    // cloneTo must point to a non-existing path; cloneCommand stub creates the structure.
    const cloneDestRel = 'cold-clone-dest';
    const cloneDestAbs = path.join(TEST_ROOT, cloneDestRel);

    const result = await runAssign({
      callsignOrUrl: 'https://example.com/squad.git',
      cloneTo: cloneDestRel,
      callsign: 'gamma',
      registryPath,
      cwd: TEST_ROOT,
      copilotHome,
      cloneCommand: async (_url, dest) => {
        fs.mkdirSync(path.join(dest, '.squad'), { recursive: true });
        writeFile(path.join(dest, '.squad', 'team.md'), '# Team');
        addSkill(dest, 'cold-skill');
        addCoordinator(dest);
      },
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.kind).toBe('assigned');
    expect(fileExists(path.join(copilotHome, 'skills', 'squad-gamma-cold-skill'))).toBe(true);

    // Cleanup cold clone
    fs.rmSync(cloneDestAbs, { recursive: true, force: true });
  });
});

// ============================================================
// Safety guards (Finding 1 — symlink traversal; Finding 2 — callsign validation)
// ============================================================

describe('safety guards', () => {
  let hostDir: string;
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('sg-host');
    copilotHome = makeDir('sg-copilot-home');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  // ---- Finding 1: symlink traversal ----------------------------

  it(
    'does not follow directory symlinks during skill copy — symlink target contents are not written to copilotHome (skipped if EPERM; Windows requires developer mode or admin for symlink creation)',
    () => {
      // Simulates a malicious skill dir containing a symlink to an outside directory.
      const secretDir = makeDir('sg-secret');
      writeFile(path.join(secretDir, 'secret.txt'), 'classified');

      const skillDir = path.join(hostDir, '.copilot', 'skills', 'evil-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: evil-skill\ndescription: test\n---\n# Evil');
      writeFile(path.join(skillDir, 'safe.txt'), 'safe content');

      try {
        fs.symlinkSync(secretDir, path.join(skillDir, 'evil-link'), 'dir');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') {
          // Symlink creation is not permitted — test is vacuously satisfied.
          return;
        }
        throw err;
      }

      installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

      const destSkillDir = path.join(copilotHome, 'skills', 'squad-alpha-evil-skill');
      // The symlink itself must not be copied.
      expect(fileExists(path.join(destSkillDir, 'evil-link'))).toBe(false);
      // The target contents must not be reachable under copilotHome.
      expect(fileExists(path.join(destSkillDir, 'evil-link', 'secret.txt'))).toBe(false);
      // Non-symlink files in the same skill are copied normally.
      expect(fileExists(path.join(destSkillDir, 'safe.txt'))).toBe(true);
    },
  );

  it(
    'does not follow file symlinks during skill copy — symlink is not written to copilotHome (skipped if EPERM; Windows requires developer mode or admin for symlink creation)',
    () => {
      const secretDir = makeDir('sg-secret2');
      writeFile(path.join(secretDir, 'secret.txt'), 'classified');

      const skillDir = path.join(hostDir, '.copilot', 'skills', 'evil-file-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      writeFile(path.join(skillDir, 'safe.txt'), 'safe content');

      try {
        fs.symlinkSync(
          path.join(secretDir, 'secret.txt'),
          path.join(skillDir, 'evil-file.txt'),
          'file',
        );
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') {
          return;
        }
        throw err;
      }

      installCopilotPayload({ hostDir, callsign: 'alpha', copilotHome });

      const destSkillDir = path.join(copilotHome, 'skills', 'squad-alpha-evil-file-skill');
      // The symlink must not appear in the destination.
      expect(fileExists(path.join(destSkillDir, 'evil-file.txt'))).toBe(false);
      // Non-symlink files are copied normally.
      expect(fileExists(path.join(destSkillDir, 'safe.txt'))).toBe(true);
    },
  );

  // ---- Finding 2: callsign format validation -------------------

  const invalidCallsigns: Array<[string, string]> = [
    ['alpha/../beta', 'path traversal with forward slash'],
    ['alpha\\..\\beta', 'path traversal with backslash'],
    ['ALPHA', 'uppercase letters'],
    ['-alpha', 'leading dash'],
    ['alpha-', 'trailing dash'],
    ['_underscore', 'underscore'],
    ['with.dot', 'period'],
    ['with space', 'space'],
    ['..', 'path traversal marker'],
    ['', 'empty string'],
    ['a'.repeat(65), '65-character callsign exceeds maximum length'],
  ];

  for (const [callsign, description] of invalidCallsigns) {
    it(`installCopilotPayload rejects invalid callsign (${description})`, () => {
      expect(() =>
        installCopilotPayload({ hostDir, callsign, copilotHome }),
      ).toThrow(expect.objectContaining({ code: 'ERR_PAYLOAD_INVALID_CALLSIGN' }));
      // Validation fires before any file writes — copilotHome remains empty.
      expect(fs.readdirSync(copilotHome)).toHaveLength(0);
    });

    it(`uninstallCopilotPayload rejects invalid callsign (${description})`, () => {
      expect(() =>
        uninstallCopilotPayload({ callsign, copilotHome }),
      ).toThrow(expect.objectContaining({ code: 'ERR_PAYLOAD_INVALID_CALLSIGN' }));
    });

    it(`diagnoseCopilotPayload rejects invalid callsign in knownCallsigns (${description})`, () => {
      expect(() =>
        diagnoseCopilotPayload({ knownCallsigns: [callsign], copilotHome }),
      ).toThrow(expect.objectContaining({ code: 'ERR_PAYLOAD_INVALID_CALLSIGN' }));
    });
  }

  it('valid callsign with internal hyphen passes validation (my-squad is a real expected pattern)', () => {
    expect(() =>
      installCopilotPayload({ hostDir, callsign: 'my-squad', copilotHome }),
    ).not.toThrow();
  });

  it('valid double-hyphen callsign passes validation', () => {
    expect(() =>
      installCopilotPayload({ hostDir, callsign: 'a--b', copilotHome }),
    ).not.toThrow();
  });

  it('valid 64-character callsign passes validation', () => {
    expect(() =>
      installCopilotPayload({ hostDir, callsign: 'x'.repeat(64), copilotHome }),
    ).not.toThrow();
  });

  it('valid single-character callsign passes validation', () => {
    expect(() =>
      installCopilotPayload({ hostDir, callsign: 'a', copilotHome }),
    ).not.toThrow();
  });

  it('valid maximum-length callsign (64 chars) passes validation', () => {
    const callsign = `a${'b'.repeat(62)}c`; // 64 chars, starts/ends with alnum
    expect(() =>
      installCopilotPayload({ hostDir, callsign, copilotHome }),
    ).not.toThrow();
  });
});

// ============================================================
// Fix 2: YAML block-scalar rewrite
// ============================================================

describe('_rewriteFrontmatterName block-scalar handling', () => {
  it('rewrites a block-scalar name value and removes orphaned continuation lines', () => {
    const content = '---\nname: |\n  multi-line\n  value\ndescription: kept\n---\n# Body\n';
    const result = _rewriteFrontmatterName(content, 'new-name');
    expect(result).toContain('name: new-name');
    expect(result).not.toContain('multi-line');
    expect(result).not.toContain('  value');
    expect(result).toContain('description: kept');
    // Verify the result is valid YAML by confirming only one name: line exists.
    const lines = result.split('\n');
    expect(lines.filter(l => /^name:/.test(l))).toHaveLength(1);
  });

  it('rewrites a block-scalar with folded style (>) and continuation lines', () => {
    const content = '---\nname: >\n  folded content\ndescription: kept\n---\n# Body\n';
    const result = _rewriteFrontmatterName(content, 'replaced');
    expect(result).toContain('name: replaced');
    expect(result).not.toContain('folded content');
    expect(result).toContain('description: kept');
  });
});

// ============================================================
// Fix 5 (FIDO gap G1): Cold-start payload ordering
// ============================================================

describe('cold-start payload ordering', () => {
  let hostDir: string;
  let copilotHome: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeHost('co-host');
    copilotHome = makeDir('co-copilot-home');
    registryPath = path.join(TEST_ROOT, 'co-registry.json');
    writeRegistry(registryPath, []);
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('registry write failure surfaces as a thrown error and no payload files are written', async () => {
    const cloneDestRel = 'co-cold-clone';
    const cloneDestAbs = path.join(TEST_ROOT, cloneDestRel);

    await expect(
      runAssign({
        callsignOrUrl: 'https://example.com/squad.git',
        cloneTo: cloneDestRel,
        callsign: 'delta',
        registryPath,
        cwd: TEST_ROOT,
        copilotHome,
        cloneCommand: async (_url, dest) => {
          fs.mkdirSync(path.join(dest, '.squad'), { recursive: true });
          writeFile(path.join(dest, '.squad', 'team.md'), '# Team');
          addSkill(dest, 'order-skill');
          addCoordinator(dest);
        },
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
        _writeRegistryFn: () => { throw new Error('registry write failed'); },
      }),
    ).rejects.toThrow('registry write failed');

    // No payload files must exist — installCopilotPayload runs AFTER writeRegistry.
    const skillsDir = path.join(copilotHome, 'skills');
    const skillWritten = fs.existsSync(skillsDir) &&
      fs.readdirSync(skillsDir).some(n => n.startsWith('squad-delta-'));
    expect(skillWritten).toBe(false);

    // Cleanup any clone artifact left by the failing path.
    fs.rmSync(cloneDestAbs, { recursive: true, force: true });
  });
});

// ============================================================
// Fix 6 (FIDO gap G2): Hyphenated callsign orphan extraction
// ============================================================

describe('hyphenated callsign orphan extraction', () => {
  let copilotHome: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    copilotHome = makeDir('hyph-copilot-home');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('known hyphenated callsign is not reported as an orphan', () => {
    const hostDir = makeHost('hyph-host');
    addSkill(hostDir, 'testskill');
    installCopilotPayload({ hostDir, callsign: 'my-squad', copilotHome });

    const result = diagnoseCopilotPayload({ knownCallsigns: ['my-squad'], copilotHome });
    expect(result.orphans.filter(o => o.callsign === 'my-squad')).toHaveLength(0);
  });

  it('orphan report preserves the full hyphenated callsign — not just the prefix before the first hyphen', () => {
    const hostDir = makeHost('hyph-host2');
    // Skill name has no hyphens so _extractCandidateCallsign (lastIndexOf) returns the
    // full callsign 'my-squad', not the naive prefix 'my' that indexOf would produce.
    addSkill(hostDir, 'testskill');
    installCopilotPayload({ hostDir, callsign: 'my-squad', copilotHome });

    // 'my-squad' is NOT in knownCallsigns — all its files are orphaned.
    const result = diagnoseCopilotPayload({ knownCallsigns: ['unrelated'], copilotHome });
    const orphanCallsigns = result.orphans.map(o => o.callsign);
    // Full callsign must appear, not the truncated prefix 'my'.
    expect(orphanCallsigns.some(c => c === 'my-squad')).toBe(true);
    expect(orphanCallsigns.some(c => c === 'my')).toBe(false);
  });
});

// ============================================================
// Piece 48 D: accurate orphan-payload callsign attribution
// ============================================================

describe('piece 48 D: accurate orphan callsign attribution', () => {
  let copilotHome: string;

  /** Write a namespaced skill directory directly under the user-scoped skills dir. */
  function writeUserSkill(dirName: string): void {
    const dir = path.join(copilotHome, 'skills', dirName);
    fs.mkdirSync(dir, { recursive: true });
    writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${dirName}\n---\n# ${dirName}`);
  }

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    copilotHome = makeDir('d-copilot-home');
  });

  afterEach(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

  it('D1 attributes a multi-word skill payload to the real callsign (probe, not probe-agent)', () => {
    writeUserSkill('squad-probe-agent-collaboration');
    const result = diagnoseCopilotPayload({
      knownCallsigns: ['alpha'],
      knownSkillBases: ['agent-collaboration', 'squad-conventions'],
      copilotHome,
    });
    const orphan = result.orphans.find(o => o.pathOnDisk.endsWith('squad-probe-agent-collaboration'));
    expect(orphan).toBeDefined();
    expect(orphan!.callsign).toBe('probe');
  });

  it('D2 reports a genuine double-prefix artifact with NO registered leading callsign as an orphan', () => {
    // Piece 55 §F2: a registered-callsign prefix match wins over the double-prefix heuristic, so the
    // stale-artifact case is one whose LEADING token is not a registered callsign. Here `ghost` is
    // unregistered, so the payload is correctly flagged (attributed via the trailing skill base).
    writeUserSkill('squad-ghost-squad-beta-collaboration');
    const result = diagnoseCopilotPayload({
      knownCallsigns: ['beta'],
      knownSkillBases: ['agent-collaboration', 'squad-conventions'],
      copilotHome,
    });
    const orphan = result.orphans.find(o => o.pathOnDisk.endsWith('squad-ghost-squad-beta-collaboration'));
    expect(orphan).toBeDefined();
  });

  it('F2 does NOT flag a custom squad-prefixed skill owned by a registered callsign as an orphan', () => {
    // Piece 55 §F2: a host authored `squad-state-harvest-union` (base itself begins with `squad-`),
    // so the namespaced payload is `squad-<cs>-squad-state-harvest-union`. With `<cs>` registered it
    // is owned — the double-prefix guard must not fire for a registered leading callsign.
    writeUserSkill('squad-teamx-squad-state-harvest-union');
    const result = diagnoseCopilotPayload({
      knownCallsigns: ['teamx'],
      knownSkillBases: ['agent-collaboration', 'squad-conventions'],
      copilotHome,
    });
    expect(result.orphans).toHaveLength(0);
  });

  it('D2b does NOT flag a legitimately-owned squad-conventions skill as an orphan', () => {
    // squad-conventions is a real built-in skill base, so squad-<cs>-squad-conventions is owned.
    writeUserSkill('squad-teamx-squad-conventions');
    const result = diagnoseCopilotPayload({
      knownCallsigns: ['teamx'],
      knownSkillBases: ['agent-collaboration', 'squad-conventions'],
      copilotHome,
    });
    expect(result.orphans).toHaveLength(0);
  });

  it('D3 does not report a correctly-namespaced registered payload as an orphan', () => {
    writeUserSkill('squad-teamx-agent-collaboration');
    const result = diagnoseCopilotPayload({
      knownCallsigns: ['teamx'],
      knownSkillBases: ['agent-collaboration', 'squad-conventions'],
      copilotHome,
    });
    expect(result.orphans).toHaveLength(0);
  });
});
