/**
 * Tests for the registry-resolution status field block.
 *
 * @module commands/__tests__/status.test
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { formatRegistryStatusBlock, resolveStatusRegistryPath, buildStatusJson } from '../status.js';
import { clearResolveSquadCache } from '@wifi-aware/squad-sdk';
import type { ResolvedSquad } from '@wifi-aware/squad-sdk/resolution-v2';
import { defaultRegistryFilePath } from '@wifi-aware/squad-sdk/path-utils';

// ============================================================
// resolveStatusRegistryPath
// ============================================================

describe('resolveStatusRegistryPath()', () => {
  it('SR.1 returns SQUAD_REGISTRY_PATH from env when present', () => {
    const custom = '/custom/path/registry.json';
    expect(resolveStatusRegistryPath({ SQUAD_REGISTRY_PATH: custom })).toBe(custom);
  });

  it('SR.2 returns a path ending in registry.json when env is empty', () => {
    const result = resolveStatusRegistryPath({});
    expect(result).toMatch(/registry\.json$/);
  });

  it('SR.3 platform default path contains "squad"', () => {
    const result = resolveStatusRegistryPath({});
    expect(result).toContain('squad');
  });

  it('SR.4 resolveStatusRegistryPath agrees with defaultRegistryFilePath (no SQUAD_HOME)', () => {
    // Display path and SDK reader must agree — both delegate to defaultRegistryFilePath.
    const result = resolveStatusRegistryPath({});
    expect(result).toBe(defaultRegistryFilePath());
  });

  it('SR.5 resolveStatusRegistryPath uses SQUAD_HOME when set', () => {
    const env = { SQUAD_HOME: path.join(os.homedir(), '.custom-squad') };
    const result = resolveStatusRegistryPath(env);
    expect(result).toBe(defaultRegistryFilePath(undefined, env));
    expect(result).toContain('.custom-squad');
    expect(result).toContain('registry.json');
  });
});

// ============================================================
// formatRegistryStatusBlock — non-registry sources
// ============================================================

describe('formatRegistryStatusBlock() — non-registry sources omit the block', () => {
  it('ST.1 returns empty string when source is local', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/some', 'project', '.squad'),
      source: 'local',
      matchedOrigin: null,
    };
    expect(formatRegistryStatusBlock(resolved, {})).toBe('');
  });

  it('ST.2 returns empty string when source is platform', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/home', 'user', '.squad'),
      source: 'platform',
      matchedOrigin: null,
    };
    expect(formatRegistryStatusBlock(resolved, {})).toBe('');
  });

  it('ST.3 returns empty string when source is worktree', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'repo', '.squad'),
      source: 'worktree',
      matchedOrigin: null,
    };
    expect(formatRegistryStatusBlock(resolved, {})).toBe('');
  });
});

// ============================================================
// formatRegistryStatusBlock — env source
// ============================================================

describe('formatRegistryStatusBlock() — env source', () => {
  const registryPath = path.join('/test', 'registry.json');
  const env = { SQUAD_REGISTRY_PATH: registryPath };

  it('ST.4 Match via is "env var (SQUAD_CALLSIGN)" for env source', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'my-squad', '.squad'),
      source: 'env',
      callsign: 'my-squad',
      matchedOrigin: null,
    };
    const block = formatRegistryStatusBlock(resolved, env);
    expect(block).toContain('Match via:     env var (SQUAD_CALLSIGN)');
  });

  it('ST.5 includes Resolution, Callsign, Registry path, and Host repo', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'my-squad', '.squad'),
      source: 'env',
      callsign: 'my-squad',
      matchedOrigin: null,
    };
    const block = formatRegistryStatusBlock(resolved, env);
    expect(block).toContain('Resolution:    registry');
    expect(block).toContain('Callsign:      my-squad');
    expect(block).toContain(`Registry path: ${registryPath}`);
    expect(block).toContain('Host repo:');
  });
});

// ============================================================
// formatRegistryStatusBlock — clones source
// ============================================================

describe('formatRegistryStatusBlock() — clones source', () => {
  it('ST.6 Match via is "clone path" for clones source', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'team', '.squad'),
      source: 'clones',
      callsign: 'team',
      matchedOrigin: null,
    };
    const block = formatRegistryStatusBlock(resolved, { SQUAD_REGISTRY_PATH: path.join('/r', 'reg.json') });
    expect(block).toContain('Match via:     clone path');
  });

  it('ST.7 Host repo is the parent directory of the resolved .squad/ path', () => {
    const hostDir = path.join('/projects', 'my-repo');
    const resolved: ResolvedSquad = {
      path: path.join(hostDir, '.squad'),
      source: 'clones',
      matchedOrigin: null,
    };
    const block = formatRegistryStatusBlock(resolved, { SQUAD_REGISTRY_PATH: path.join('/r', 'reg.json') });
    expect(block).toContain(hostDir);
  });

  it('ST.8 omits Callsign line when callsign is absent', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'team', '.squad'),
      source: 'clones',
      matchedOrigin: null,
    };
    const block = formatRegistryStatusBlock(resolved, { SQUAD_REGISTRY_PATH: path.join('/r', 'reg.json') });
    expect(block).not.toContain('Callsign:');
  });
});

// ============================================================
// formatRegistryStatusBlock — origins source
// ============================================================

describe('formatRegistryStatusBlock() — origins source', () => {
  it('ST.9 Match via is "origin URL" for origins source', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'team', '.squad'),
      source: 'origins',
      callsign: 'team',
      matchedOrigin: 'https://dev.azure.com/contoso/MyProject/_git/MyRepo',
    };
    const block = formatRegistryStatusBlock(resolved, { SQUAD_REGISTRY_PATH: path.join('/r', 'reg.json') });
    expect(block).toContain('Match via:     origin URL');
  });

  it('ST.10 includes Matched origin when matchedOrigin is non-null for origins source', () => {
    const origin = 'https://dev.azure.com/contoso/MyProject/_git/MyRepo';
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'team', '.squad'),
      source: 'origins',
      callsign: 'team',
      matchedOrigin: origin,
    };
    const block = formatRegistryStatusBlock(resolved, { SQUAD_REGISTRY_PATH: path.join('/r', 'reg.json') });
    expect(block).toContain(`Matched origin: ${origin}`);
  });

  it('ST.11 omits Matched origin when matchedOrigin is null', () => {
    const resolved: ResolvedSquad = {
      path: path.join('/projects', 'team', '.squad'),
      source: 'origins',
      callsign: 'team',
      matchedOrigin: null,
    };
    const block = formatRegistryStatusBlock(resolved, { SQUAD_REGISTRY_PATH: path.join('/r', 'reg.json') });
    expect(block).toContain('Match via:     origin URL');
    expect(block).not.toContain('Matched origin:');
  });
});

// ============================================================
// buildStatusJson — machine-readable `squad status --json` (piece 57 §C)
// ============================================================

describe('buildStatusJson()', () => {
  const TEST_ROOT = path.join(os.tmpdir(), `.test-status-json-${randomBytes(4).toString('hex')}`);

  function mkGitRepo(dir: string): void {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  }

  function cleanup(): void {
    clearResolveSquadCache();
    if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }

  it('SJ.1 returns resolved=false with a reason for an unresolved directory', () => {
    cleanup();
    const bare = path.join(TEST_ROOT, 'bare');
    mkGitRepo(bare);
    try {
      const json = buildStatusJson(bare, { SQUAD_REGISTRY_PATH: path.join(TEST_ROOT, 'registry.json') });
      expect(json.resolved).toBe(false);
      expect(json.teamRoot).toBeNull();
      expect(json.managed).toBe(false);
      expect(json.stateBackend).toBe('local');
      expect(typeof json.reason).toBe('string');
    } finally {
      cleanup();
    }
  });

  it('SJ.2 resolves a managed linked clone: managed=true, source=local, host teamRoot + stateBackend from host config', () => {
    cleanup();
    const host = path.join(TEST_ROOT, 'host');
    mkGitRepo(host);
    fs.mkdirSync(path.join(host, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(host, '.squad', 'team.md'), '# Team\n');
    fs.writeFileSync(
      path.join(host, '.squad', 'config.json'),
      JSON.stringify({ version: 1, stateBackend: 'orphan' }, null, 2),
    );

    const product = path.join(TEST_ROOT, 'product');
    mkGitRepo(product);
    fs.mkdirSync(path.join(product, '.squad'), { recursive: true });
    fs.writeFileSync(
      path.join(product, '.squad', 'config.json'),
      JSON.stringify({ version: 1, teamRoot: '../host', projectKey: null }, null, 2),
    );

    const registryPath = path.join(TEST_ROOT, 'registry.json');
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        { version: 1, squads: [{ callsign: 'demo', path: path.join(host, '.squad'), managed: true, clones: [product] }] },
        null,
        2,
      ),
    );

    try {
      const json = buildStatusJson(product, { SQUAD_REGISTRY_PATH: registryPath });
      expect(json.resolved).toBe(true);
      expect(json.source).toBe('local');
      expect(json.teamRoot).toBe(path.join(host, '.squad'));
      expect(json.managed).toBe(true);
      expect(json.callsign).toBe('demo');
      expect(json.stateBackend).toBe('orphan');
    } finally {
      cleanup();
    }
  });

  it('SJ.3 a plain local squad reports managed=false and default stateBackend', () => {
    cleanup();
    const repo = path.join(TEST_ROOT, 'plain');
    mkGitRepo(repo);
    fs.mkdirSync(path.join(repo, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.squad', 'team.md'), '# Team\n');
    try {
      const json = buildStatusJson(repo, { SQUAD_REGISTRY_PATH: path.join(TEST_ROOT, 'registry.json') });
      expect(json.resolved).toBe(true);
      expect(json.source).toBe('local');
      expect(json.managed).toBe(false);
      expect(json.teamRoot).toBe(path.join(repo, '.squad'));
      expect(json.stateBackend).toBe('local');
    } finally {
      cleanup();
    }
  });
});
