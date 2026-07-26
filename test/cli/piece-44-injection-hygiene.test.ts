/**
 * Piece 44 sub-proposal B — canonical pipeline-file injection.
 *
 * The cross-repo publish embeds the host's fold-pipeline YAML into the inbox snapshot so CI
 * can evaluate triggers. On a host that carries a pipeline copy in more than one directory
 * (a stale alternate-platform copy from an earlier convention), the injection must embed only
 * a single canonical pipeline path — never a second, stale copy.
 *
 * Canonical precedence (first existing wins, then stop):
 *   1. .azuredevops/fold-squad-state.<callsign>.yml
 *   2. .github/workflows/fold-squad-state.<callsign>.yml
 *   3. .azuredevops/fold-squad-state.yml
 *   4. .github/workflows/fold-squad-state.yml
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishTeamRootToInbox } from '../../packages/squad-cli/src/cli/commands/sync.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-44-injection-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function initBareRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', dir], { stdio: 'pipe' });
}

function initWorkingRepo(dir: string, remoteUrl: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Minimal allowlisted .squad/ content so the publish snapshot has a body. */
function setupSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
}

function writePipeline(teamRoot: string, relDir: string, filename: string, body: string): void {
  const dir = path.join(teamRoot, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body, 'utf-8');
}

function inboxRef(bare: string, callsign: string): string {
  const refs = execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)'], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
  const inbox = refs.filter(r => r.includes(`/squad/inbox/${callsign}/`));
  expect(inbox).toHaveLength(1);
  return inbox[0];
}

function treePaths(bare: string, ref: string): string[] {
  return execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', ref], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
}

/** All embedded fold-pipeline YAML paths (either platform directory). */
function pipelineYamlPaths(paths: string[]): string[] {
  return paths.filter(p =>
    /^(\.azuredevops|\.github\/workflows)\/fold-squad-state(\.[a-z0-9-]+)?\.yml$/.test(p),
  );
}

/** Read an embedded blob's content out of the bare repo at <ref>:<path>. */
function showBlob(bare: string, ref: string, relPath: string): string {
  return execFileSync('git', ['--git-dir', bare, 'show', `${ref}:${relPath}`], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('piece 44 B: canonical pipeline-file injection', { timeout: 60_000 }, () => {
  it('B44.1: when both platform directories carry a copy, only the canonical (ADO) one is embedded', async () => {
    const base = makeTmpDir('b1-both');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');
    initBareRepo(bare);
    initWorkingRepo(repo, bare);
    setupSquadDir(repo);
    writePipeline(repo, '.azuredevops', 'fold-squad-state.yml', '# ado canonical\n');
    writePipeline(repo, path.join('.github', 'workflows'), 'fold-squad-state.yml', '# github stale\n');

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-b1', 'alpha');

    const ref = inboxRef(bare, 'alpha');
    const paths = treePaths(bare, ref);
    expect(paths).toContain('.azuredevops/fold-squad-state.yml');
    expect(paths).not.toContain('.github/workflows/fold-squad-state.yml');
    // Exactly one pipeline YAML embedded, and its body is the canonical ADO source.
    expect(pipelineYamlPaths(paths)).toHaveLength(1);
    expect(showBlob(bare, ref, '.azuredevops/fold-squad-state.yml')).toBe('# ado canonical\n');
  });

  it('B44.2: a single-platform host (GitHub only) embeds its one pipeline file unchanged', async () => {
    const base = makeTmpDir('b2-gh-only');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');
    initBareRepo(bare);
    initWorkingRepo(repo, bare);
    setupSquadDir(repo);
    writePipeline(repo, path.join('.github', 'workflows'), 'fold-squad-state.yml', '# github canonical\n');

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-b2', 'alpha');

    const ref = inboxRef(bare, 'alpha');
    const paths = treePaths(bare, ref);
    expect(paths).toContain('.github/workflows/fold-squad-state.yml');
    expect(paths).not.toContain('.azuredevops/fold-squad-state.yml');
    expect(pipelineYamlPaths(paths)).toHaveLength(1);
    expect(showBlob(bare, ref, '.github/workflows/fold-squad-state.yml')).toBe('# github canonical\n');
  });

  it('B44.3: a callsign-named pipeline file is preferred over a generic one', async () => {
    const base = makeTmpDir('b3-named');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');
    initBareRepo(bare);
    initWorkingRepo(repo, bare);
    setupSquadDir(repo);
    // Callsign-named file in GitHub dir, generic file in ADO dir.
    writePipeline(repo, path.join('.github', 'workflows'), 'fold-squad-state.alpha.yml', '# github scoped\n');
    writePipeline(repo, '.azuredevops', 'fold-squad-state.yml', '# ado generic\n');

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-b3', 'alpha');

    const ref = inboxRef(bare, 'alpha');
    const paths = treePaths(bare, ref);
    expect(paths).toContain('.github/workflows/fold-squad-state.alpha.yml');
    expect(paths).not.toContain('.azuredevops/fold-squad-state.yml');
    expect(pipelineYamlPaths(paths)).toHaveLength(1);
    expect(showBlob(bare, ref, '.github/workflows/fold-squad-state.alpha.yml')).toBe('# github scoped\n');
  });

  it('B44.5: when both platforms carry a callsign-named file, only the scoped ADO one is embedded', async () => {
    const base = makeTmpDir('b5-scoped-both');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');
    initBareRepo(bare);
    initWorkingRepo(repo, bare);
    setupSquadDir(repo);
    // Scoped file in BOTH platform dirs: ADO must win (candidate 1 over candidate 2).
    writePipeline(repo, '.azuredevops', 'fold-squad-state.alpha.yml', '# ado scoped\n');
    writePipeline(repo, path.join('.github', 'workflows'), 'fold-squad-state.alpha.yml', '# github scoped\n');

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-b5', 'alpha');

    const ref = inboxRef(bare, 'alpha');
    const paths = treePaths(bare, ref);
    expect(paths).toContain('.azuredevops/fold-squad-state.alpha.yml');
    expect(paths).not.toContain('.github/workflows/fold-squad-state.alpha.yml');
    expect(pipelineYamlPaths(paths)).toHaveLength(1);
    expect(showBlob(bare, ref, '.azuredevops/fold-squad-state.alpha.yml')).toBe('# ado scoped\n');
  });

  it('B44.4: a host with no pipeline file embeds none', async () => {
    const base = makeTmpDir('b4-none');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');
    initBareRepo(bare);
    initWorkingRepo(repo, bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-b4', 'alpha');

    const ref = inboxRef(bare, 'alpha');
    const paths = treePaths(bare, ref);
    expect(paths.some(p => p.endsWith('fold-squad-state.yml'))).toBe(false);
    // The snapshot still carries the publish metadata.
    expect(paths).toContain('.squad/publish-metadata.json');
  });
});
