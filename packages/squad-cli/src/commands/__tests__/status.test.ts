/**
 * Tests for the registry-resolution status field block.
 *
 * @module commands/__tests__/status.test
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { formatRegistryStatusBlock, resolveStatusRegistryPath } from '../status.js';
import type { ResolvedSquad } from '@bradygaster/squad-sdk';

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
