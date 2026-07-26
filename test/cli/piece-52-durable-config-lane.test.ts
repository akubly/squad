/**
 * Piece 52 — Infra-only main and the durable config lane (Pole A).
 *
 * Sub-proposals:
 *   A  — the BLANKET `<callsign>/.squad/` managed ignore + the Pole-B→A migration
 *        (untrack the whole `.squad` subtree from `main`, no durable loss).
 *   B  — the `squad/config/<callsign>` durable orphan genesis (`seedConfigOrphan`),
 *        reusing the state-orphan commit-tree plumbing (no `main` parent, durable-only tree)
 *        + the registry `configBranch`/`configRemote` fields.
 *   C  — `CONFIG_ALLOWLIST` as the deterministic complement + a TOTAL/DISJOINT team-root
 *        classifier proven against the REAL scaffold output.
 *   D  — decision D1 (uniform) recorded in triage (fork-internal state).
 *
 * These git-integration cases (init, genesis, migration across clones) can exceed 30s under
 * load; use a generous per-test timeout to avoid false timeout failures on slow runs.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initSquad } from '@bradygaster/squad-sdk';
import { validateEntry } from '@bradygaster/squad-sdk/registry';
import {
  seedConfigOrphan,
  deriveConfigBranch,
  isConfigAllowlisted,
  isAllowlisted,
  CONFIG_ALLOWLIST_EXACT,
  CONFIG_ALLOWLIST_PREFIX,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  classifyTeamRootPath,
  laneMatchCount,
  isMachineLocal,
} from '../../packages/squad-cli/src/cli/commands/team-root-classifier.js';
import {
  applyBlanketGitignore,
  applyManagedGitignore,
  blanketGitignorePaths,
  PUBLISH_MACHINE_LOCAL,
} from '../../packages/squad-cli/src/cli/commands/allowlist-gitignore.js';
import { migratePoleBToA } from '../../packages/squad-cli/src/cli/commands/pole-a-migrate.js';

vi.setConfig({ testTimeout: 120_000 });

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-52-tmp');
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

function initWorkingRepo(dir: string, remoteName = 'origin', remoteUrl?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  if (remoteUrl) execFileSync('git', ['remote', 'add', remoteName, remoteUrl], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function listBareRefs(bareDir: string): string[] {
  return execFileSync('git', ['--git-dir', bareDir, 'for-each-ref', '--format=%(refname)'], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
}

/** Names in a local branch's tree. */
function listTreeFiles(repoDir: string, ref: string): string[] {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
    cwd: repoDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
}

/** Names in a bare repo's ref tree. */
function listBareTreeFiles(bareDir: string, ref: string): string[] {
  return execFileSync('git', ['--git-dir', bareDir, 'ls-tree', '-r', '--name-only', ref], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);
}

/** Recursively enumerate `.squad/**` files under a team root (forward-slashed, relative). */
function walkSquad(teamRoot: string): string[] {
  const squadDir = path.join(teamRoot, '.squad');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(teamRoot, full).replace(/\\/g, '/'));
    }
  };
  walk(squadDir);
  return out;
}

/** Produce the REAL scaffold under `teamRoot` via the SDK init (the classifier ground truth). */
async function scaffold(teamRoot: string): Promise<void> {
  await initSquad({
    teamRoot,
    projectName: 'piece52-probe',
    agents: [
      { name: 'dev', role: 'Core Dev' },
      { name: 'lead', role: 'Lead' },
    ],
    configFormat: 'json',
  });
}

afterAll(() => {
  for (const dir of FIXTURE_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ─── C: total / disjoint classifier, proven against the real scaffold ───────────

describe('piece 52 — C: team-root classifier is total and disjoint', () => {
  it('classifies every real-scaffold .squad path into exactly one lane (none unclassified)', async () => {
    const root = makeTmpDir('scaffold');
    await scaffold(root);
    const files = walkSquad(root);

    expect(files.length).toBeGreaterThan(50); // the scaffold is substantial

    const buckets = { scratch: 0, ephemeral: 0, durable: 0, unclassified: 0 };
    const multiLane: string[] = [];
    for (const rel of files) {
      const lane = classifyTeamRootPath(rel);
      buckets[lane] += 1;
      if (laneMatchCount(rel) !== 1) multiLane.push(rel);
    }

    // Totality: no scaffold path escapes the partition.
    expect(buckets.unclassified).toBe(0);
    // Disjointness: no path is claimed by two lanes.
    expect(multiLane).toEqual([]);
    // Every lane is exercised by the real scaffold.
    expect(buckets.durable).toBeGreaterThan(0);
    expect(buckets.ephemeral).toBeGreaterThan(0);
    expect(buckets.scratch).toBeGreaterThan(0);
  });

  it('surfaces an unowned path as unclassified (the drift guard)', () => {
    expect(classifyTeamRootPath('.squad/some-brand-new-artifact.md')).toBe('unclassified');
    expect(laneMatchCount('.squad/some-brand-new-artifact.md')).toBe(0);
  });

  it('keeps durable and ephemeral disjoint on the collision-prone sentinels', () => {
    // Durable constitution vs. ephemeral state that share a stem.
    expect(classifyTeamRootPath('.squad/agents/dev/charter.md')).toBe('durable');
    expect(classifyTeamRootPath('.squad/agents/dev/history.md')).toBe('ephemeral');
    // Top-level durable policy vs. the piece-51 ephemeral casting subtree.
    expect(classifyTeamRootPath('.squad/casting-policy.json')).toBe('durable');
    expect(classifyTeamRootPath('.squad/casting/policy.json')).toBe('ephemeral');
    // Durable authored subtree vs. ephemeral onboarding files.
    expect(classifyTeamRootPath('.squad/files/triage-flow/step-1.md')).toBe('durable');
    expect(classifyTeamRootPath('.squad/files/onboarding/welcome.md')).toBe('ephemeral');
    // Scratch takes precedence and is never durable/ephemeral.
    expect(classifyTeamRootPath('.squad/.first-run')).toBe('scratch');
    expect(isMachineLocal('.squad/.first-run')).toBe(true);
  });

  it('CONFIG_ALLOWLIST never overlaps the machine-local scratch set', () => {
    for (const scratch of PUBLISH_MACHINE_LOCAL) {
      expect(isConfigAllowlisted(scratch)).toBe(false);
    }
    // The exact + prefix durable entries never match the piece-51 ephemeral allowlist.
    for (const durable of CONFIG_ALLOWLIST_EXACT) {
      expect(isAllowlisted(durable)).toBe(false);
    }
    for (const prefix of CONFIG_ALLOWLIST_PREFIX) {
      expect(isAllowlisted(`${prefix}nested/file.md`)).toBe(false);
    }
  });
});

// ─── B: the durable config orphan genesis ───────────────────────────────────────

describe('piece 52 — B: seedConfigOrphan genesis', () => {
  it('seeds an orphan branch whose tree is the durable subset only, with no main parent', async () => {
    const root = initWorkingRepo(makeTmpDir('genesis'));
    await scaffold(root);

    const branch = 'squad/config/probe';
    const res = await seedConfigOrphan(root, branch);

    expect(res.seeded).toBe(true);
    expect(res.commit).toBeTruthy();
    expect(res.configBranch).toBe(branch);

    // The branch exists locally.
    const sha = execFileSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(sha).toBe(res.commit);

    // Orphan: exactly one commit, no parent — never descends from main.
    const count = execFileSync('git', ['rev-list', '--count', branch], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(count).toBe('1');
    const parents = execFileSync('git', ['log', '--format=%P', '-n', '1', branch], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(parents).toBe('');

    // Tree is durable-only: every entry is config-allowlisted, none is ephemeral state.
    const tree = listTreeFiles(root, branch);
    expect(tree.length).toBeGreaterThan(0);
    for (const rel of tree) {
      expect(isConfigAllowlisted(rel)).toBe(true);
      expect(isAllowlisted(rel)).toBe(false);
    }
    // Spot-check the constitution is present and ephemeral state is absent.
    expect(tree).toContain('.squad/team.md');
    expect(tree.some(p => p.startsWith('.squad/templates/'))).toBe(true);
    expect(tree).not.toContain('.squad/decisions.md');
    expect(tree.some(p => /^\.squad\/agents\/[^/]+\/history\.md$/.test(p))).toBe(false);
  });

  it('is idempotent — a second call does not re-seed or move the branch', async () => {
    const root = initWorkingRepo(makeTmpDir('genesis-idem'));
    await scaffold(root);
    const branch = 'squad/config/probe';

    const first = await seedConfigOrphan(root, branch);
    const firstSha = execFileSync('git', ['rev-parse', branch], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const second = await seedConfigOrphan(root, branch);
    expect(second.seeded).toBe(false);
    expect(second.commit).toBeUndefined();

    const secondSha = execFileSync('git', ['rev-parse', branch], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(secondSha).toBe(firstSha);
    expect(first.seeded).toBe(true);
  });

  it('pushes the durable orphan to a remote when one is given', async () => {
    const bare = makeTmpDir('genesis-bare');
    initBareRepo(bare);
    const root = initWorkingRepo(makeTmpDir('genesis-remote'), 'origin', bare);
    await scaffold(root);
    const branch = 'squad/config/alpha';

    const res = await seedConfigOrphan(root, branch, { remote: 'origin' });
    expect(res.seeded).toBe(true);

    // The orphan lands on the remote, durable-only.
    expect(listBareRefs(bare)).toContain(`refs/heads/${branch}`);
    const tree = listBareTreeFiles(bare, branch);
    expect(tree.length).toBeGreaterThan(0);
    for (const rel of tree) expect(isConfigAllowlisted(rel)).toBe(true);

    // Idempotent against the remote (ls-remote sees the branch).
    const again = await seedConfigOrphan(root, branch, { remote: 'origin' });
    expect(again.seeded).toBe(false);
  });
});

// ─── A: blanket Pole-A ignore + the Pole-B→A migration ──────────────────────────

describe('piece 52 — A: applyBlanketGitignore', () => {
  it('writes a blanket <prefix>.squad/ block so git add -A cannot sweep in the scaffold', async () => {
    const root = initWorkingRepo(makeTmpDir('blanket-fresh'));
    const res = applyBlanketGitignore(root);
    expect(res.untracked).toBe(0); // nothing was tracked yet

    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.squad/');
    expect(gitignore).toContain(blanketGitignorePaths()[0]);

    await scaffold(root);
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
    const staged = execFileSync('git', ['ls-files', '.squad'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(staged).toBe(''); // the blanket ignore keeps main infra-only
  });

  it('scopes the blanket ignore to a subfolder host prefix', () => {
    const root = initWorkingRepo(makeTmpDir('blanket-subfolder'));
    applyBlanketGitignore(root, 'alpha/');
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('alpha/.squad/');
    expect(blanketGitignorePaths('alpha/')).toEqual(['alpha/.squad/']);
  });

  it('migrates a Pole-B host: untracks the whole .squad subtree with no durable loss on disk', async () => {
    const root = initWorkingRepo(makeTmpDir('migration'));
    await scaffold(root);

    // Pole-B starting point: .squad is tracked on main.
    execFileSync('git', ['add', '.squad'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'pole-b: track squad'], { cwd: root, stdio: 'pipe' });
    const trackedBefore = execFileSync('git', ['ls-files', '.squad'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    expect(trackedBefore.length).toBeGreaterThan(0);

    // Migration: seed the durable orphan FIRST, then blanket-untrack (as init/install do).
    const branch = 'squad/config/probe';
    const seeded = await seedConfigOrphan(root, branch);
    expect(seeded.seeded).toBe(true);

    const res = applyBlanketGitignore(root);
    expect(res.untracked).toBe(trackedBefore.length);

    // main is now infra-only: nothing under .squad is tracked...
    const trackedAfter = execFileSync('git', ['ls-files', '.squad'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(trackedAfter).toBe('');
    // ...but the working-tree files are still on disk (no data loss)...
    expect(fs.existsSync(path.join(root, '.squad', 'team.md'))).toBe(true);
    // ...and the durable constitution is preserved on the config lane.
    const durable = listTreeFiles(root, branch);
    expect(durable).toContain('.squad/team.md');
  });

  it('idempotently replaces a prior allowlist block with the blanket block', () => {
    const root = initWorkingRepo(makeTmpDir('replace-block'));

    // Start on a piece-51 allowlist-scoped block.
    applyManagedGitignore(root);
    const allowlisted = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    expect(allowlisted).toContain('.squad/history.md'); // an allowlist-scoped path

    // Switch to Pole A: the SAME markers are reused, so the block is replaced in place.
    const first = applyBlanketGitignore(root);
    expect(first.changed).toBe(true);
    const blanket = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
    expect(blanket).toContain('.squad/');
    expect(blanket).not.toContain('.squad/history.md'); // old allowlist entries gone
    // Only one managed block survives.
    expect(blanket.split('# --- squad').length - 1).toBeLessThanOrEqual(1);

    // Re-running is a no-op.
    const second = applyBlanketGitignore(root);
    expect(second.changed).toBe(false);
  });
});

// ─── A (guard): migratePoleBToA never untracks content it would lose ────────────

describe('piece 52 — A: guarded Pole-B→A migration (migratePoleBToA)', () => {
  it('untracks the whole subtree AND seeds the durable orphan when everything is classified', async () => {
    const root = initWorkingRepo(makeTmpDir('guard-happy'));
    await scaffold(root);
    execFileSync('git', ['add', '.squad'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'pole-b'], { cwd: root, stdio: 'pipe' });

    const res = await migratePoleBToA({ repoRoot: root, teamRoot: root, pathPrefix: '', callsign: 'probe' });

    expect(res.aborted).toBeUndefined();
    expect(res.installed).toBe(true);
    expect(res.untracked).toBeGreaterThan(0);
    expect(res.seededBranch).toBe('squad/config/probe');
    // main is infra-only; durable content survives on the config lane.
    const trackedAfter = execFileSync('git', ['ls-files', '.squad'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(trackedAfter).toBe('');
    expect(listTreeFiles(root, 'squad/config/probe')).toContain('.squad/team.md');
  });

  it('ABORTS the untrack when a tracked .squad path belongs to no lane (unclassified → would be lost)', async () => {
    const root = initWorkingRepo(makeTmpDir('guard-unclassified'));
    await scaffold(root);
    // A custom durable file the scaffold never ships — matched by no lane predicate.
    const orphanFile = path.join(root, '.squad', 'notes-custom.md');
    fs.writeFileSync(orphanFile, '# custom durable note\n');
    expect(classifyTeamRootPath('.squad/notes-custom.md')).toBe('unclassified');
    execFileSync('git', ['add', '.squad'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'pole-b + custom'], { cwd: root, stdio: 'pipe' });

    const res = await migratePoleBToA({ repoRoot: root, teamRoot: root, pathPrefix: '', callsign: 'probe' });

    expect(res.aborted).toBe('unclassified');
    expect(res.installed).toBe(false);
    expect(res.untracked).toBe(0);
    expect(res.unclassified).toContain('.squad/notes-custom.md');
    // Nothing was removed — the constitution is still fully tracked on main (not lost).
    const trackedAfter = execFileSync('git', ['ls-files', '.squad'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    expect(trackedAfter).toContain('.squad/notes-custom.md');
    expect(trackedAfter).toContain('.squad/team.md');
  });

  it('ABORTS the untrack when durable content is tracked but no config branch can be derived', async () => {
    const root = initWorkingRepo(makeTmpDir('guard-unseedable'));
    await scaffold(root);
    execFileSync('git', ['add', '.squad'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'pole-b'], { cwd: root, stdio: 'pipe' });

    // 'Bad.Name' fails CALLSIGN_RE, so deriveConfigBranch returns undefined → nothing can capture durable.
    const res = await migratePoleBToA({ repoRoot: root, teamRoot: root, pathPrefix: '', callsign: 'Bad.Name' });

    expect(res.aborted).toBe('unseedable-durable');
    expect(res.installed).toBe(false);
    expect(res.untracked).toBe(0);
    const trackedAfter = execFileSync('git', ['ls-files', '.squad'], {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(trackedAfter).not.toBe('');
  });
});

// ─── B: registry configBranch / configRemote fields ─────────────────────────────

describe('piece 52 — B: registry durable-lane fields', () => {
  const base = { path: '/abs/host/.squad', callsign: 'alpha', stateBackend: 'orphan' as const };

  it('round-trips configBranch and configRemote through validateEntry', () => {
    const entry = validateEntry(
      { ...base, configBranch: 'squad/config/alpha', configRemote: 'origin' },
      0,
    );
    expect(entry.configBranch).toBe('squad/config/alpha');
    expect(entry.configRemote).toBe('origin');
  });

  it('rejects a non-string configBranch / configRemote', () => {
    expect(() => validateEntry({ ...base, configBranch: 42 }, 0)).toThrow(/configBranch must be a string/);
    expect(() => validateEntry({ ...base, configRemote: {} }, 0)).toThrow(/configRemote must be a string/);
  });

  it('deriveConfigBranch mirrors the state-lane derivation', () => {
    expect(deriveConfigBranch(undefined, 'alpha')).toBe('squad/config/alpha');
    expect(deriveConfigBranch('squad/config/explicit', 'alpha')).toBe('squad/config/explicit');
    expect(deriveConfigBranch(undefined, undefined)).toBeUndefined();
    expect(deriveConfigBranch(undefined, 'Bad Callsign')).toBeUndefined();
  });
});

