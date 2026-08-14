/**
 * Link Command Tests — CLI command for linking project to remote team root
 *
 * Tests the runLink function's validation and file-system operations.
 * Uses real temp directories, no mocks needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const TEST_ROOT = join(tmpdir(), `.test-cli-link-${randomBytes(4).toString('hex')}`);
const PROJECT_DIR = join(TEST_ROOT, 'project');
const TEAM_DIR = join(TEST_ROOT, 'team-repo');

describe('CLI: link command', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    mkdirSync(join(TEAM_DIR, '.squad'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('module exports runLink function', async () => {
    const mod = await import('@wifi-aware/squad-cli/commands/link');
    expect(typeof mod.runLink).toBe('function');
  });

  it('creates .squad/config.json with relative teamRoot', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    runLink(PROJECT_DIR, TEAM_DIR);

    const configPath = join(PROJECT_DIR, '.squad', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe(1);
    expect(config.teamRoot).toBeTruthy();
    expect(config.projectKey).toBeNull();
  });

  it('creates .squad directory if it does not exist', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    expect(existsSync(join(PROJECT_DIR, '.squad'))).toBe(false);

    runLink(PROJECT_DIR, TEAM_DIR);

    expect(existsSync(join(PROJECT_DIR, '.squad'))).toBe(true);
  });

  it('adds .squad/config.json to .gitignore', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    runLink(PROJECT_DIR, TEAM_DIR);

    const gitignorePath = join(PROJECT_DIR, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.squad/config.json');
  });

  it('does not duplicate .gitignore entry on re-link', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    runLink(PROJECT_DIR, TEAM_DIR);
    runLink(PROJECT_DIR, TEAM_DIR);

    const content = readFileSync(join(PROJECT_DIR, '.gitignore'), 'utf-8');
    const matches = content.match(/\.squad\/config\.json/g);
    expect(matches?.length).toBe(1);
  });

  it('preserves existing .gitignore content', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    writeFileSync(join(PROJECT_DIR, '.gitignore'), 'node_modules/\n');

    runLink(PROJECT_DIR, TEAM_DIR);

    const content = readFileSync(join(PROJECT_DIR, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.squad/config.json');
  });

  it('throws on non-existent target path', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    const bogus = join(TEST_ROOT, 'does-not-exist');
    expect(() => runLink(PROJECT_DIR, bogus)).toThrow(/does not exist/i);
  });

  it('throws when target is a file, not a directory', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    const filePath = join(TEST_ROOT, 'a-file.txt');
    writeFileSync(filePath, 'not a dir');
    expect(() => runLink(PROJECT_DIR, filePath)).toThrow(/not a directory/i);
  });

  it('throws when target has no .squad/ or .ai-team/ directory', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    const emptyDir = join(TEST_ROOT, 'empty-team');
    mkdirSync(emptyDir, { recursive: true });
    expect(() => runLink(PROJECT_DIR, emptyDir)).toThrow(/does not contain/i);
  });

  it('accepts target with .ai-team/ directory', async () => {
    const { runLink } = await import('@wifi-aware/squad-cli/commands/link');
    const aiTeamDir = join(TEST_ROOT, 'ai-team-repo');
    mkdirSync(join(aiTeamDir, '.ai-team'), { recursive: true });

    runLink(PROJECT_DIR, aiTeamDir);

    const configPath = join(PROJECT_DIR, '.squad', 'config.json');
    expect(existsSync(configPath)).toBe(true);
  });
});

// ============================================================
// Piece 58 §A/§G1 — backend-aware squad_state bridge delivery
// ============================================================

describe('CLI: link command — piece 58 §A/§G1 backend-aware state bridge', () => {
  const HOME_DIR = join(TEST_ROOT, 'home');
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let runLink: (projectDir: string, teamDir: string, opts?: { quiet?: boolean }) => void;

  function writeTeamBackend(backend?: string): void {
    const cfg: Record<string, unknown> = { version: 1, teamRoot: '.' };
    if (backend) cfg['stateBackend'] = backend;
    writeFileSync(join(TEAM_DIR, '.squad', 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  }
  const userMcpPath = (): string => join(HOME_DIR, '.copilot', 'mcp-config.json');
  const repoMcpPath = (): string => join(PROJECT_DIR, '.mcp.json');
  const readUserServers = (): Record<string, { command?: string; args?: string[] }> =>
    JSON.parse(readFileSync(userMcpPath(), 'utf-8')).mcpServers;

  beforeEach(async () => {
    ({ runLink } = await import('@wifi-aware/squad-cli/commands/link'));
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    mkdirSync(join(TEAM_DIR, '.squad'), { recursive: true });
    mkdirSync(HOME_DIR, { recursive: true });
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = HOME_DIR;
    process.env.USERPROFILE = HOME_DIR;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUserProfile;
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  for (const backend of ['orphan', 'two-layer']) {
    it(`${backend} team → user-level squad_state (local-bin), NO repo-local .mcp.json`, async () => {
      writeTeamBackend(backend);
      runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
      expect(existsSync(repoMcpPath()), 'repo-local .mcp.json must be skipped').toBe(false);
      expect(existsSync(userMcpPath()), 'user-level mcp-config must exist').toBe(true);
      const servers = readUserServers();
      const keys = Object.keys(servers).filter((k) => k.startsWith('squad_state'));
      expect(keys).toHaveLength(1);
      expect(servers[keys[0]].command).toBe('squad');
      expect(servers[keys[0]].args).toEqual(['state-mcp']);
    });
  }

  it('local team → repo-local .mcp.json (piece 57 §D), NO user-level entry', async () => {
    writeTeamBackend('local');
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    expect(existsSync(repoMcpPath()), 'repo-local .mcp.json must be written').toBe(true);
    expect(existsSync(userMcpPath()), 'user-level mcp-config must NOT be written').toBe(false);
  });

  it('no declared backend → treated as local (repo-local .mcp.json)', async () => {
    writeTeamBackend(undefined);
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    expect(existsSync(repoMcpPath())).toBe(true);
    expect(existsSync(userMcpPath())).toBe(false);
  });

  it('orphan re-link is idempotent and preserves unrelated user servers', async () => {
    mkdirSync(join(HOME_DIR, '.copilot'), { recursive: true });
    writeFileSync(userMcpPath(), JSON.stringify({ mcpServers: { unrelated: { url: 'http://other' } } }, null, 2));
    writeTeamBackend('orphan');
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    const servers = readUserServers();
    expect(servers['unrelated']).toBeDefined();
    const keys = Object.keys(servers).filter((k) => k.startsWith('squad_state'));
    expect(keys).toHaveLength(1);
    expect(existsSync(repoMcpPath())).toBe(false);
  });

  // ---- piece 58 §A stable-key fix (review: HOME must not accumulate per-path entries) ----

  const HASH_KEY_RE = /^squad_state_[0-9a-f]{8}$/;

  it('writes a SINGLE stable `squad_state` key (never a per-path hash)', async () => {
    writeTeamBackend('orphan');
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    const servers = readUserServers();
    const stateKeys = Object.keys(servers).filter((k) => k.startsWith('squad_state'));
    expect(stateKeys).toEqual(['squad_state']);
    expect(stateKeys.some((k) => HASH_KEY_RE.test(k))).toBe(false);
  });

  it('a second clone path does not add a second user-level entry', async () => {
    writeTeamBackend('orphan');
    const PROJECT_DIR_2 = join(TEST_ROOT, 'project-2');
    mkdirSync(PROJECT_DIR_2, { recursive: true });
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    runLink(PROJECT_DIR_2, TEAM_DIR, { quiet: true });
    const servers = readUserServers();
    const stateKeys = Object.keys(servers).filter((k) => k.startsWith('squad_state'));
    expect(stateKeys).toEqual(['squad_state']);
  });

  it('leaves a pre-existing manual `squad_state` with the same spec as a no-op', async () => {
    mkdirSync(join(HOME_DIR, '.copilot'), { recursive: true });
    const manual = {
      mcpServers: {
        squad_state: { command: 'squad', args: ['state-mcp'], env: {}, tools: ['*'] },
      },
    };
    writeFileSync(userMcpPath(), JSON.stringify(manual, null, 2) + '\n');
    const before = readFileSync(userMcpPath(), 'utf-8');
    writeTeamBackend('orphan');
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    const after = readFileSync(userMcpPath(), 'utf-8');
    expect(after).toBe(before);
    const stateKeys = Object.keys(readUserServers()).filter((k) => k.startsWith('squad_state'));
    expect(stateKeys).toEqual(['squad_state']);
  });

  it('tombstones stale `squad_state_<hash>` entries and preserves unrelated servers', async () => {
    mkdirSync(join(HOME_DIR, '.copilot'), { recursive: true });
    const unrelated = { command: 'other', args: ['serve'], env: { A: '1' }, tools: ['x'] };
    writeFileSync(
      userMcpPath(),
      JSON.stringify(
        {
          mcpServers: {
            squad_state_deadbeef: { command: 'squad', args: ['state-mcp'] },
            squad_state_12345678: { command: 'squad', args: ['state-mcp'] },
            unrelated,
          },
        },
        null,
        2,
      ) + '\n',
    );
    writeTeamBackend('two-layer');
    runLink(PROJECT_DIR, TEAM_DIR, { quiet: true });
    const servers = readUserServers();
    const stateKeys = Object.keys(servers).filter((k) => k.startsWith('squad_state'));
    expect(stateKeys).toEqual(['squad_state']);
    expect(Object.keys(servers).some((k) => HASH_KEY_RE.test(k))).toBe(false);
    expect(servers['unrelated']).toEqual(unrelated);
  });
});
