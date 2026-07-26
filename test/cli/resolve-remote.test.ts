/**
 * Piece 46 — A/E: state-remote resolver hardening.
 *
 * resolveRemote(cwd) precedence:
 *   1. the branch's tracking remote (branch.<name>.remote) when configured;
 *   2. else, when exactly one remote is configured, that sole remote;
 *   3. else `origin` only when a remote named `origin` actually exists;
 *   4. else (E1) fail with an actionable SquadError naming `stateRemote`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveRemote } from '../../packages/squad-cli/src/cli/commands/sync.js';
import { SquadError } from '../../packages/squad-cli/src/cli/core/errors.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.resolve-remote-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

/** Initialize a working repo with one commit and no configured tracking remote. */
function initWorkingRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
}

function addRemote(dir: string, name: string, url = `https://example.invalid/${name}.git`): void {
  execFileSync('git', ['remote', 'add', name, url], { cwd: dir, stdio: 'pipe' });
}

function setBranchRemote(dir: string, name: string): void {
  const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  execFileSync('git', ['config', `branch.${branch}.remote`, name], { cwd: dir, stdio: 'pipe' });
}

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('piece 46 — resolveRemote precedence', () => {
  it('A.1: returns the branch tracking remote when configured', () => {
    const repo = makeTmpDir('p1');
    initWorkingRepo(repo);
    addRemote(repo, 'origin');
    addRemote(repo, 'upstream');
    setBranchRemote(repo, 'upstream');

    expect(resolveRemote(repo)).toBe('upstream');
  });

  it('A.2: with no tracking and exactly one remote, returns that sole remote even when not named origin', () => {
    const repo = makeTmpDir('p2');
    initWorkingRepo(repo);
    addRemote(repo, 'upstream');

    expect(resolveRemote(repo)).toBe('upstream');
  });

  it('A.3: with no tracking and multiple remotes including origin, returns origin', () => {
    const repo = makeTmpDir('p3');
    initWorkingRepo(repo);
    addRemote(repo, 'upstream');
    addRemote(repo, 'origin');

    expect(resolveRemote(repo)).toBe('origin');
  });

  it('E1: with no tracking, no origin, and multiple remotes, throws an actionable SquadError naming stateRemote', () => {
    const repo = makeTmpDir('p4');
    initWorkingRepo(repo);
    addRemote(repo, 'upstream');
    addRemote(repo, 'fork');

    let thrown: unknown;
    try { resolveRemote(repo); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(SquadError);
    expect((thrown as Error).message).toContain('stateRemote');
  });

  it('A.4: ignores a stale tracking remote that names no configured remote and falls through to origin', () => {
    const repo = makeTmpDir('p6');
    initWorkingRepo(repo);
    addRemote(repo, 'upstream');
    addRemote(repo, 'origin');
    // Branch config points at a remote that no longer exists (stale/manual config).
    setBranchRemote(repo, 'deleted-remote');

    expect(resolveRemote(repo)).toBe('origin');
  });

  it('A.5: ignores a "." local-tracking remote and falls through to the sole configured remote', () => {
    const repo = makeTmpDir('p7');
    initWorkingRepo(repo);
    addRemote(repo, 'upstream');
    // Git records "." as the remote for branches that track a local branch.
    setBranchRemote(repo, '.');

    expect(resolveRemote(repo)).toBe('upstream');
  });

  it('E1: with no remotes at all, throws an actionable SquadError naming stateRemote', () => {
    const repo = makeTmpDir('p5');
    initWorkingRepo(repo);

    let thrown: unknown;
    try { resolveRemote(repo); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(SquadError);
    expect((thrown as Error).message).toContain('stateRemote');
  });
});
