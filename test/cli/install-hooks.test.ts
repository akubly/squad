/**
 * install-hooks command tests — piece 27
 *
 * Tests the installGitHooks function and the hook template content
 * produced for state-remote pull integration.
 *
 * TDD: written RED before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { installGitHooks } from '../../packages/squad-cli/src/cli/commands/install-hooks.js';

const TEST_ROOT = join(tmpdir(), `.test-cli-install-hooks-${randomBytes(4).toString('hex')}`);
const WORK_ROOT = join(TEST_ROOT, 'work-repo');
const HOOKS_DIR = join(WORK_ROOT, '.git', 'hooks');

function seedFakeGitDir(repoRoot: string, backend = 'orphan'): void {
  const gitDir = join(repoRoot, '.git');
  mkdirSync(join(gitDir, 'hooks'), { recursive: true });
  mkdirSync(join(gitDir, 'info'), { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  const squadDir = join(repoRoot, '.squad');
  mkdirSync(squadDir, { recursive: true });
  writeFileSync(
    join(squadDir, 'config.json'),
    JSON.stringify({ version: 1, stateBackend: backend }, null, 2) + '\n',
  );
}

function installHooks(repoRoot: string, force = false): void {
  installGitHooks(repoRoot, { force, hooksDir: HOOKS_DIR });
}

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Hook template content — recursion guard
// ---------------------------------------------------------------------------

describe('hook template recursion guard', () => {
  const HOOK_NAMES = ['post-merge', 'post-checkout', 'post-rewrite'];

  for (const hookName of HOOK_NAMES) {
    it(`${hookName}: recursion guard (SQUAD_SYNC_ACTIVE) is present after state-remote update`, () => {
      seedFakeGitDir(WORK_ROOT);
      installHooks(WORK_ROOT);

      const hookPath = join(HOOKS_DIR, hookName);
      expect(existsSync(hookPath)).toBe(true);
      const content = readFileSync(hookPath, 'utf-8');
      expect(content).toContain('SQUAD_SYNC_ACTIVE');
    });
  }
});

// ---------------------------------------------------------------------------
// Hook template content — state remote pull
// ---------------------------------------------------------------------------

describe('hook template state-remote pull', () => {
  const STATE_PULL_HOOKS = ['post-merge', 'post-checkout', 'post-rewrite'];

  for (const hookName of STATE_PULL_HOOKS) {
    it(`${hookName}: template includes code to read stateRemote from config`, () => {
      seedFakeGitDir(WORK_ROOT);
      installHooks(WORK_ROOT);

      const content = readFileSync(join(HOOKS_DIR, hookName), 'utf-8');
      expect(content).toContain('stateRemote');
    });

    it(`${hookName}: template contains guard to skip state fetch when stateRemote is absent`, () => {
      seedFakeGitDir(WORK_ROOT);
      installHooks(WORK_ROOT);

      const content = readFileSync(join(HOOKS_DIR, hookName), 'utf-8');
      expect(content).toContain('STATE_REMOTE');
      const hasEmptyGuard =
        content.includes('[ -z "$STATE_REMOTE"') ||
        content.includes('[-z "$STATE_REMOTE"') ||
        content.includes('if [ -z');
      expect(hasEmptyGuard).toBe(true);
    });

    it(`${hookName}: squad-sync-hook marker is present`, () => {
      seedFakeGitDir(WORK_ROOT);
      installHooks(WORK_ROOT);

      const content = readFileSync(join(HOOKS_DIR, hookName), 'utf-8');
      expect(content).toContain('squad-sync-hook');
    });
  }
});

// ---------------------------------------------------------------------------
// Hook chaining — existing hook is preserved
// ---------------------------------------------------------------------------

describe('hook chaining', () => {
  it('chains squad hook after an existing hook script', () => {
    seedFakeGitDir(WORK_ROOT);

    const existingHook = '#!/bin/sh\necho "existing hook"\n';
    writeFileSync(join(HOOKS_DIR, 'post-merge'), existingHook, { mode: 0o755 });

    installHooks(WORK_ROOT);

    const content = readFileSync(join(HOOKS_DIR, 'post-merge'), 'utf-8');
    expect(content).toContain('echo "existing hook"');
    expect(content).toContain('squad-sync-hook');
    expect(content).toContain('SQUAD_SYNC_ACTIVE');
  });

  it('skips installation when squad hook already installed and no --force', () => {
    seedFakeGitDir(WORK_ROOT);

    installHooks(WORK_ROOT);
    const afterFirst = readFileSync(join(HOOKS_DIR, 'post-merge'), 'utf-8');

    installHooks(WORK_ROOT);
    const afterSecond = readFileSync(join(HOOKS_DIR, 'post-merge'), 'utf-8');

    expect(afterSecond).toBe(afterFirst);
  });

  // Nit 2 — force:true must be idempotent (no duplicate squad sections)
  it('force reinstall is idempotent — exactly one squad section after two force calls', () => {
    seedFakeGitDir(WORK_ROOT);

    installHooks(WORK_ROOT, true);
    installHooks(WORK_ROOT, true);

    const content = readFileSync(join(HOOKS_DIR, 'post-merge'), 'utf-8');
    const markerCount = (content.match(/squad-sync-hook/g) ?? []).length;
    expect(markerCount).toBe(1);
    expect(content).toContain('SQUAD_SYNC_ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// pre-push hook — recursion guard still intact
// ---------------------------------------------------------------------------

describe('pre-push hook', () => {
  it('pre-push hook still has recursion guard after update', () => {
    seedFakeGitDir(WORK_ROOT);
    installHooks(WORK_ROOT);

    const hookPath = join(HOOKS_DIR, 'pre-push');
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('SQUAD_SYNC_ACTIVE');
  });
});
