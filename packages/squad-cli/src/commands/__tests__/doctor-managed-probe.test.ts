/**
 * Real-git coverage for the managed-host fold-pipeline remote probe (piece 56 D).
 *
 * A managed host is a `--filter=blob:none --no-checkout` clone: it has no working tree,
 * so `doctor` cannot inspect the local filesystem for the fold pipeline. Instead it reads
 * the remote default-branch tree (`git ls-tree origin/HEAD`). These tests drive the real
 * probe against a real blobless no-checkout clone to prove it detects a present pipeline,
 * reports a genuinely absent one, and fails open on an unresolvable remote.
 *
 * @module commands/__tests__/doctor-managed-probe.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { _probeManagedHostFoldPipeline } from '../doctor.js';

let root: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@e',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@e',
    },
  });
}

/**
 * Build a bare remote whose default branch optionally carries a fold pipeline yaml,
 * then return a `--filter=blob:none --no-checkout` clone of it (a managed host).
 */
function makeManagedClone(tag: string, foldYaml: 'github' | 'ado' | 'empty' | 'none'): string {
  const remote = path.join(root, `${tag}-remote.git`);
  fs.mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  execFileSync('git', ['--git-dir', remote, 'config', 'uploadpack.allowFilter', 'true'], { stdio: 'ignore' });
  execFileSync('git', ['--git-dir', remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true'], { stdio: 'ignore' });

  const seed = path.join(root, `${tag}-seed`);
  fs.mkdirSync(seed, { recursive: true });
  git(seed, 'init', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# seed\n');
  if (foldYaml === 'github' || foldYaml === 'empty') {
    const dir = path.join(seed, '.github', 'workflows');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'fold-squad-state.yml'),
      foldYaml === 'empty' ? '' : 'name: fold\non: push\n',
    );
  } else if (foldYaml === 'ado') {
    const dir = path.join(seed, '.azuredevops');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fold-squad-state.yml'), 'trigger: none\n');
  }
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', 'origin', 'main');

  const host = path.join(root, `${tag}-host`);
  // Clone over the `file://` transport (not a local path) so `--filter=blob:none` is
  // actually honored — a plain-path clone is "local" and silently ignores the filter,
  // leaving all blobs present and never exercising the blobless probe path.
  execFileSync(
    'git',
    ['clone', '--filter=blob:none', '--no-checkout', pathToFileURL(remote).href, host],
    { stdio: 'ignore' },
  );
  return host;
}

describe('_probeManagedHostFoldPipeline (piece 56 D — real git)', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'p56-probe-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns true when a GitHub fold pipeline is on the remote default branch', () => {
    const host = makeManagedClone('gh', 'github');
    // The no-checkout clone genuinely has no working tree for the pipeline.
    expect(fs.existsSync(path.join(host, '.github', 'workflows', 'fold-squad-state.yml'))).toBe(false);
    // And it is a genuine partial (blobless) clone — the `file://` transport honored
    // `--filter=blob:none`, so the probe must succeed WITHOUT fetching workflow blobs.
    const promisor = execFileSync('git', ['--git-dir', path.join(host, '.git'), 'config', 'remote.origin.promisor'], {
      encoding: 'utf-8',
    }).trim();
    expect(promisor).toBe('true');
    expect(_probeManagedHostFoldPipeline(host)).toBe(true);
  });

  it('returns true when a non-empty ADO fold pipeline is on the remote default branch', () => {
    const host = makeManagedClone('ado', 'ado');
    expect(_probeManagedHostFoldPipeline(host)).toBe(true);
  });

  it('returns false when the remote default branch has no fold pipeline', () => {
    const host = makeManagedClone('none', 'none');
    expect(_probeManagedHostFoldPipeline(host)).toBe(false);
  });

  it('returns true for a present-but-empty pipeline file (presence-only; emptiness is not probed to avoid a blob fetch)', () => {
    // The probe deliberately does not read blob sizes on a blobless clone (that would
    // force a promisor fetch and fail offline). A workflow file's presence in the tree
    // is a sufficient signal, so an empty placeholder still counts as configured.
    const host = makeManagedClone('empty', 'empty');
    expect(_probeManagedHostFoldPipeline(host)).toBe(true);
  });

  it('fails open (returns true) when the git dir cannot resolve origin/HEAD', () => {
    // A directory with no usable git remote is inconclusive — the probe must not
    // manufacture a false "pipeline missing" warning.
    const bogus = path.join(root, 'not-a-clone');
    fs.mkdirSync(bogus, { recursive: true });
    expect(_probeManagedHostFoldPipeline(bogus)).toBe(true);
  });
});
