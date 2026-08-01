/**
 * Tests for resolveTeamRoot — the machine-readable team-root resolver (piece 57 §C/§F).
 *
 * Callers and agents need a resolver they can invoke instead of filesystem-probing
 * for `.squad/team.md`. This exercises three shapes:
 *   - a plain local `.squad/` (source=local, teamRoot points at that .squad)
 *   - a linked product clone whose `.squad/config.json` points at a host repo
 *     (managed model — resolves via `local`, teamRoot follows the pointer to the host .squad)
 *   - an unresolved directory (resolved=false with a machine-parseable reason)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolveTeamRoot, clearResolveSquadCache } from '../packages/squad-sdk/src/resolution.js';

const TEST_ROOT = join(tmpdir(), `.test-team-root-${randomBytes(4).toString('hex')}`);

function mkGitRepo(dir: string): void {
  mkdirSync(join(dir, '.git'), { recursive: true });
}

describe('resolveTeamRoot', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    clearResolveSquadCache();
  });

  afterEach(() => {
    clearResolveSquadCache();
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('resolves a plain local .squad/ as source=local', () => {
    const repo = join(TEST_ROOT, 'plain');
    mkGitRepo(repo);
    mkdirSync(join(repo, '.squad'), { recursive: true });
    writeFileSync(join(repo, '.squad', 'team.md'), '# Team\n');

    const info = resolveTeamRoot({ cwd: repo });
    expect(info.resolved).toBe(true);
    expect(info.source).toBe('local');
    expect(info.teamRoot).toBe(join(repo, '.squad'));
    expect(info.mode).toBe('local');
  });

  it('follows a linked product clone config.json pointer to the host .squad', () => {
    // Host clone (the managed host): ~/.squad/hosts/<cs> — a repo whose .squad holds team.md.
    const host = join(TEST_ROOT, 'host');
    mkGitRepo(host);
    mkdirSync(join(host, '.squad'), { recursive: true });
    writeFileSync(join(host, '.squad', 'team.md'), '# Team\n');

    // Product clone: has a .squad/config.json pointing at the host repo (what `squad link` writes).
    const product = join(TEST_ROOT, 'product');
    mkGitRepo(product);
    mkdirSync(join(product, '.squad'), { recursive: true });
    writeFileSync(
      join(product, '.squad', 'config.json'),
      JSON.stringify({ version: 1, teamRoot: '../host', projectKey: null }, null, 2),
    );

    const info = resolveTeamRoot({ cwd: product });
    expect(info.resolved).toBe(true);
    expect(info.source).toBe('local');
    expect(info.mode).toBe('remote');
    // team-root must resolve to the HOST .squad, not the product's own .squad.
    expect(info.teamRoot).toBe(join(host, '.squad'));
  });

  it('returns resolved=false with a machine-parseable reason when unresolved', () => {
    const bare = join(TEST_ROOT, 'bare');
    mkGitRepo(bare);

    const info = resolveTeamRoot({ cwd: bare });
    expect(info.resolved).toBe(false);
    expect(info.teamRoot).toBeNull();
    expect(typeof info.reason).toBe('string');
    expect(info.reason).toBeTruthy();
  });
});
