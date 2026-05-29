/**
 * Tests for resolveSquadPaths() — dual-root path resolution (Issue #311)
 * Design ported from @spboyer (Shayne Boyer)'s PR bradygaster/squad#131.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveSquadPaths, _deprecationFired } from '@bradygaster/squad-sdk/resolution';

const TMP = join(process.cwd(), `.test-dual-root-${randomBytes(4).toString('hex')}`);

function scaffold(...dirs: string[]): void {
  for (const d of dirs) {
    mkdirSync(join(TMP, d), { recursive: true });
  }
}

function writeJson(relPath: string, data: unknown): void {
  writeFileSync(join(TMP, relPath), JSON.stringify(data), 'utf-8');
}

describe('resolveSquadPaths()', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    // Reset deprecation flags before each test so console.warn spies work reliably
    _deprecationFired.projectDir = false;
    _deprecationFired.teamDir = false;
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    _deprecationFired.projectDir = false;
    _deprecationFired.teamDir = false;
  });

  // ---- Local mode ----

  it('returns local mode when no config.json exists', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('local');
    expect(result!.projectDir).toBe(join(TMP, '.squad'));
    expect(result!.teamDir).toBe(TMP);
    expect(result!.config).toBeNull();
    expect(result!.name).toBe('.squad');
    expect(result!.isLegacy).toBe(false);
  });

  it('returns null when no squad directory is found', () => {
    scaffold('.git');
    expect(resolveSquadPaths(TMP)).toBeNull();
  });

  // ---- Remote mode ----

  it('returns remote mode when config.json has valid teamRoot', () => {
    scaffold('.git', '.squad', 'shared-team');
    writeJson('.squad/config.json', {
      version: 1,
      teamRoot: 'shared-team',
      projectKey: 'my-project',
    });

    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('remote');
    expect(result!.projectDir).toBe(join(TMP, '.squad'));
    expect(result!.teamDir).toBe(join(TMP, 'shared-team'));
    expect(result!.config).toEqual({
      version: 1,
      teamRoot: 'shared-team',
      projectKey: 'my-project',
    });
  });

  it('resolves relative teamRoot with ../ correctly', () => {
    // Project at TMP/project, team at TMP/team-identity
    scaffold('project/.git', 'project/.squad', 'team-identity');
    writeJson('project/.squad/config.json', {
      version: 1,
      teamRoot: '../team-identity',
      projectKey: null,
    });

    const result = resolveSquadPaths(join(TMP, 'project'));
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('remote');
    expect(result!.projectDir).toBe(join(TMP, 'project', '.squad'));
    // teamRoot is resolved relative to project root (parent of .squad/)
    expect(result!.teamDir).toBe(join(TMP, 'team-identity'));
  });

  // ---- Broken config fallback ----

  it('falls back to local mode on malformed JSON', () => {
    scaffold('.git', '.squad');
    writeFileSync(join(TMP, '.squad', 'config.json'), '{ not valid json }}}', 'utf-8');

    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('local');
    expect(result!.projectDir).toBe(join(TMP, '.squad'));
    expect(result!.teamDir).toBe(TMP);
    expect(result!.config).toBeNull();
  });

  it('falls back to local mode when teamRoot field is missing', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', { version: 1, projectKey: 'x' });

    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('local');
    expect(result!.config).toBeNull();
  });

  it('falls back to local mode when teamRoot is not a string', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', { version: 1, teamRoot: 42 });

    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('local');
    expect(result!.config).toBeNull();
  });

  // ---- Legacy .ai-team fallback ----

  it('detects .ai-team/ as legacy fallback', () => {
    scaffold('.git', '.ai-team');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('local');
    expect(result!.name).toBe('.ai-team');
    expect(result!.isLegacy).toBe(true);
    expect(result!.projectDir).toBe(join(TMP, '.ai-team'));
  });

  it('prefers .squad/ over .ai-team/ when both exist', () => {
    scaffold('.git', '.squad', '.ai-team');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('.squad');
    expect(result!.isLegacy).toBe(false);
  });

  it('supports remote mode from legacy .ai-team/ with config.json', () => {
    scaffold('.git', '.ai-team', 'team-shared');
    writeJson('.ai-team/config.json', {
      version: 1,
      teamRoot: 'team-shared',
      projectKey: null,
    });

    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('remote');
    expect(result!.isLegacy).toBe(true);
    expect(result!.teamDir).toBe(join(TMP, 'team-shared'));
  });

  // ---- Walk-up behavior ----

  it('walks up from nested dir to find .squad/', () => {
    scaffold('.git', '.squad', 'packages/app/src');
    const result = resolveSquadPaths(join(TMP, 'packages', 'app', 'src'));
    expect(result).not.toBeNull();
    expect(result!.projectDir).toBe(join(TMP, '.squad'));
  });

  // ---- projectKey handling ----

  it('sets projectKey to null when field is missing from config', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', { version: 1, teamRoot: '.' });

    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.config!.projectKey).toBeNull();
  });

  // ---- New resolved-shape fields (piece 26) ----

  it('exposes workRoot as the repo root in local mode', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.workRoot).toBe(TMP);
  });

  it('exposes workSquadDir as the .squad/ path in local mode', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.workSquadDir).toBe(join(TMP, '.squad'));
  });

  it('exposes teamRoot === workRoot in local mode', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.teamRoot).toBe(result!.workRoot);
  });

  it('exposes teamSquadDir === workSquadDir in local mode', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.teamSquadDir).toBe(result!.workSquadDir);
  });

  it('exposes workRoot as the work repo root in remote mode', () => {
    scaffold('.git', '.squad', 'team-docs');
    writeJson('.squad/config.json', { version: 1, teamRoot: 'team-docs', projectKey: null });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.workRoot).toBe(TMP);
  });

  it('exposes workSquadDir as the product .squad/ in remote mode', () => {
    scaffold('.git', '.squad', 'team-docs');
    writeJson('.squad/config.json', { version: 1, teamRoot: 'team-docs', projectKey: null });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.workSquadDir).toBe(join(TMP, '.squad'));
  });

  it('exposes teamRoot as the resolved team directory in remote mode', () => {
    scaffold('.git', '.squad', 'team-docs');
    writeJson('.squad/config.json', { version: 1, teamRoot: 'team-docs', projectKey: null });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.teamRoot).toBe(join(TMP, 'team-docs'));
  });

  it('exposes teamSquadDir as the team .squad/ in remote mode', () => {
    scaffold('.git', '.squad', 'team-docs', 'team-docs/.squad');
    writeJson('.squad/config.json', { version: 1, teamRoot: 'team-docs', projectKey: null });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.teamSquadDir).toBe(join(TMP, 'team-docs', '.squad'));
  });

  // ---- New SquadDirConfig fields round-trip ----

  it('loadDirConfig parses stateRemote, stateBranch, and inboxBranchPrefix', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', {
      version: 1,
      teamRoot: '.',
      stateRemote: 'squad-docs',
      stateBranch: 'squad-state',
      inboxBranchPrefix: 'squad/inbox',
    });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.config!.stateRemote).toBe('squad-docs');
    expect(result!.config!.stateBranch).toBe('squad-state');
    expect(result!.config!.inboxBranchPrefix).toBe('squad/inbox');
  });

  it('loadDirConfig parses developerAlias', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', { version: 1, teamRoot: '.', developerAlias: 'alice' });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.config!.developerAlias).toBe('alice');
  });

  it('loadDirConfig parses teamCachePath', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', { version: 1, teamRoot: '.', teamCachePath: '/some/cache' });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.config!.teamCachePath).toBe('/some/cache');
  });

  it('loadDirConfig parses hydrateWorkRoot flag', () => {
    scaffold('.git', '.squad');
    writeJson('.squad/config.json', { version: 1, teamRoot: '.', hydrateWorkRoot: true });
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.config!.hydrateWorkRoot).toBe(true);
  });

  // ---- Deprecated alias compat (piece 26) ----

  it('projectDir alias returns workSquadDir value', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.projectDir).toBe(result!.workSquadDir);
  });

  it('teamDir alias returns teamRoot value', () => {
    scaffold('.git', '.squad');
    const result = resolveSquadPaths(TMP);
    expect(result).not.toBeNull();
    expect(result!.teamDir).toBe(result!.teamRoot);
  });

  it('accessing projectDir fires console.warn once', () => {
    scaffold('.git', '.squad');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = resolveSquadPaths(TMP);
      const _ = result!.projectDir;
      const __ = result!.projectDir; // second access should NOT fire again
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/projectDir.*deprecated/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('accessing teamDir fires console.warn once', () => {
    scaffold('.git', '.squad');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = resolveSquadPaths(TMP);
      const _ = result!.teamDir;
      const __ = result!.teamDir; // second access should NOT fire again
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/teamDir.*deprecated/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('projectDir and teamDir warn independently', () => {
    scaffold('.git', '.squad');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = resolveSquadPaths(TMP);
      const _a = result!.projectDir;
      const _b = result!.teamDir;
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('accessing only new-shape fields fires no deprecation warning', () => {
    scaffold('.git', '.squad');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = resolveSquadPaths(TMP);
      const _a = result!.workRoot;
      const _b = result!.workSquadDir;
      const _c = result!.teamRoot;
      const _d = result!.teamSquadDir;
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
