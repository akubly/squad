/**
 * Init-Remote Command Tests — CLI command for writing remote mode config
 *
 * Tests the writeRemoteConfig function's file-system operations.
 * Uses real temp directories.
 *
 * Also tests resolveSquadPaths() integration: after writeRemoteConfig() runs,
 * the resolved shape (workRoot, teamRoot, workSquadDir, teamSquadDir) and
 * deprecated aliases (projectDir, teamDir) must reflect the configured remote.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { writeRemoteConfig } from '../../packages/squad-cli/src/cli/commands/init-remote.js';
import { resolveSquadPaths, _deprecationFired } from '../../packages/squad-sdk/src/resolution.js';

const TEST_ROOT = join(tmpdir(), `.test-cli-init-remote-${randomBytes(4).toString('hex')}`);
const PROJECT_DIR = join(TEST_ROOT, 'project');
const TEAM_DIR = join(TEST_ROOT, 'team-repo');

describe('CLI: init-remote command', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    mkdirSync(TEAM_DIR, { recursive: true });
    _deprecationFired.projectDir = false;
    _deprecationFired.teamDir = false;
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    _deprecationFired.projectDir = false;
    _deprecationFired.teamDir = false;
  });

  it('module exports writeRemoteConfig function', () => {
    expect(typeof writeRemoteConfig).toBe('function');
  });

  it('creates .squad/config.json with correct structure', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    const configPath = join(PROJECT_DIR, '.squad', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe(1);
    expect(config.teamRoot).toBeTruthy();
    expect(config.projectKey).toBeNull();
  });

  it('creates .squad directory if missing', () => {
    expect(existsSync(join(PROJECT_DIR, '.squad'))).toBe(false);

    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    expect(existsSync(join(PROJECT_DIR, '.squad'))).toBe(true);
  });

  it('stores a relative path from project to team repo', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    const config = JSON.parse(
      readFileSync(join(PROJECT_DIR, '.squad', 'config.json'), 'utf-8'),
    );
    // Relative path should not be absolute
    expect(config.teamRoot).not.toMatch(/^[A-Z]:\\/i);
    expect(config.teamRoot).not.toMatch(/^\//);
  });

  it('adds .squad/config.json to .gitignore', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    const gitignorePath = join(PROJECT_DIR, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.squad/config.json');
  });

  it('does not duplicate gitignore entry', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    const content = readFileSync(join(PROJECT_DIR, '.gitignore'), 'utf-8');
    const matches = content.match(/\.squad\/config\.json/g);
    expect(matches?.length).toBe(1);
  });

  it('overwrites existing config.json on re-run', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    const secondTeam = join(TEST_ROOT, 'second-team');
    mkdirSync(secondTeam, { recursive: true });
    writeRemoteConfig(PROJECT_DIR, secondTeam);

    const config = JSON.parse(
      readFileSync(join(PROJECT_DIR, '.squad', 'config.json'), 'utf-8'),
    );
    expect(config.teamRoot).toContain('second-team');
  });

  it('preserves existing .gitignore content', () => {
    writeFileSync(join(PROJECT_DIR, '.gitignore'), 'dist/\n');
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);

    const content = readFileSync(join(PROJECT_DIR, '.gitignore'), 'utf-8');
    expect(content).toContain('dist/');
    expect(content).toContain('.squad/config.json');
  });
});

describe('CLI: init-remote → resolveSquadPaths() integration', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    mkdirSync(TEAM_DIR, { recursive: true });
    // Seed a .git marker so the walk-up resolver recognises PROJECT_DIR as a repo root
    mkdirSync(join(PROJECT_DIR, '.git'), { recursive: true });
    _deprecationFired.projectDir = false;
    _deprecationFired.teamDir = false;
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    _deprecationFired.projectDir = false;
    _deprecationFired.teamDir = false;
  });

  it('resolved workRoot matches project dir after writeRemoteConfig', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    const result = resolveSquadPaths(PROJECT_DIR);
    expect(result).not.toBeNull();
    expect(result!.workRoot).toBe(PROJECT_DIR);
  });

  it('resolved workSquadDir is the .squad/ path after writeRemoteConfig', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    const result = resolveSquadPaths(PROJECT_DIR);
    expect(result).not.toBeNull();
    expect(result!.workSquadDir).toBe(join(PROJECT_DIR, '.squad'));
  });

  it('resolved teamRoot points to the linked team repo', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    const result = resolveSquadPaths(PROJECT_DIR);
    expect(result).not.toBeNull();
    expect(result!.teamRoot).toBe(TEAM_DIR);
  });

  it('resolved mode is remote when config.json has a teamRoot', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    const result = resolveSquadPaths(PROJECT_DIR);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('remote');
  });

  it('deprecated projectDir alias returns workSquadDir and warns', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = resolveSquadPaths(PROJECT_DIR);
      expect(result!.projectDir).toBe(result!.workSquadDir);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/projectDir.*deprecated/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('deprecated teamDir alias returns teamRoot and warns', () => {
    writeRemoteConfig(PROJECT_DIR, TEAM_DIR);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = resolveSquadPaths(PROJECT_DIR);
      expect(result!.teamDir).toBe(result!.teamRoot);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/teamDir.*deprecated/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
