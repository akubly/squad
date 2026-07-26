/**
 * Piece 53 — Hands-off durable review: config-inbox and auto-PR (Pole A capstone).
 *
 * Sub-proposals under test:
 *   A — the lane-aware publish: `publishTeamRootToInbox(..., 'config')` snapshots the team root
 *       filtered to CONFIG_ALLOWLIST and pushes it to `squad/config-inbox/<callsign>/<dev>/<ts>`,
 *       carrying only durable content — never an ephemeral file. Lane isolation is proven both
 *       ways (state lane carries only ephemeral, config lane only durable).
 *   D — `hydrateTeamRootFromConfigRef` lands the durable constitution from `squad/config/<callsign>`
 *       into a clone, records the distinct `.last-config-hydrate-sha` sentinel, and re-pull is a
 *       no-op (idempotent). Durable/ephemeral trees are disjoint so lanes compose without clobber.
 *   E — `detectUnpromotedDurableChanges` returns the durable paths that differ from the hydrated
 *       tip and is silent (empty) when nothing drifted or there is no baseline sentinel.
 *   B/C — governance of the auto-PR config pipeline templates (GitHub + ADO): trigger on the
 *       config-inbox lane, open a PR (never force-push the durable branch), delete the inbox ref
 *       only after the PR opens, and ship the documented reviewer gate. Mirrored byte-identically.
 *
 * These git-integration cases can exceed 30s under load; use a generous per-test timeout.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initSquad } from '@wifi-aware/squad-sdk';
import {
  publishTeamRootToInbox,
  hydrateTeamRootFromConfigRef,
  hydrateTeamRootFromStateRef,
  seedConfigOrphan,
  detectUnpromotedDurableChanges,
  resolvePublishLane,
  isConfigAllowlisted,
  isAllowlisted,
} from '../../packages/squad-cli/src/cli/commands/sync.js';

// Heavy git-integration: each case runs a full SDK scaffold + orphan seed + hydrate, and under
// parallel worker load these can exceed two minutes. Use a generous per-test timeout.
vi.setConfig({ testTimeout: 300_000 });

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-53-tmp');
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
  execFileSync('git', ['config', '--local', 'user.email', 'dev@squad.test'], { cwd: dir, stdio: 'pipe' });
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

/** Produce the REAL scaffold under `teamRoot` via the SDK init. */
async function scaffold(teamRoot: string): Promise<void> {
  await initSquad({
    teamRoot,
    projectName: 'piece53-probe',
    agents: [
      { name: 'dev', role: 'Core Dev' },
      { name: 'lead', role: 'Lead' },
    ],
    configFormat: 'json',
  });
}

function readFileMaybe(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

afterAll(() => {
  for (const dir of FIXTURE_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ─── A: lane-aware publish (config-inbox lane) ──────────────────────────────────

describe('piece 53 — A: resolvePublishLane maps each lane to its filter/prefix', () => {
  it('config lane → durable filter + squad/config-inbox prefix + fold-squad-config pipeline', () => {
    const cfg = resolvePublishLane('config');
    expect(cfg.inboxPrefix).toBe('squad/config-inbox');
    expect(cfg.pipelineBasename).toBe('fold-squad-config');
    expect(cfg.filter('.squad/team.md')).toBe(true);      // durable
    expect(cfg.filter('.squad/decisions.md')).toBe(false); // ephemeral excluded
  });

  it('state lane → ephemeral filter + squad/inbox prefix + fold-squad-state pipeline', () => {
    const st = resolvePublishLane('state');
    expect(st.inboxPrefix).toBe('squad/inbox');
    expect(st.pipelineBasename).toBe('fold-squad-state');
    // The two lane filters are complementary on the collision-prone durable path.
    expect(st.filter('.squad/team.md')).toBe(false);
  });
});

describe('piece 53 — A: config publish carries only durable content', () => {
  it('publishes to squad/config-inbox/<callsign>/<handle>/… with CONFIG_ALLOWLIST only, no ephemeral', async () => {
    const bare = makeTmpDir('a-bare');
    initBareRepo(bare);
    const root = initWorkingRepo(makeTmpDir('a-root'), 'origin', bare);
    await scaffold(root);

    const files = walkSquad(root);
    const durable = files.filter(isConfigAllowlisted);
    const ephemeral = files.filter(isAllowlisted);
    expect(durable.length).toBeGreaterThan(0);
    expect(ephemeral.length).toBeGreaterThan(0);

    await publishTeamRootToInbox(root, 'origin', 'dev', 'sess-a', 'alpha', 'config');

    const refs = listBareRefs(bare);
    const configRef = refs.find(r => r.startsWith('refs/heads/squad/config-inbox/alpha/dev/'));
    expect(configRef).toBeTruthy();
    // No ephemeral inbox ref was created by a config-lane publish.
    expect(refs.some(r => r.startsWith('refs/heads/squad/inbox/'))).toBe(false);

    const tree = listBareTreeFiles(bare, configRef!);
    const payload = tree.filter(p => p !== '.squad/publish-metadata.json');
    expect(payload.length).toBeGreaterThan(0);
    for (const rel of payload) {
      expect(isConfigAllowlisted(rel)).toBe(true);
      expect(isAllowlisted(rel)).toBe(false); // never an ephemeral file
    }
    expect(payload).toContain('.squad/team.md');
    // A representative ephemeral file is absent from the durable snapshot.
    expect(tree).not.toContain('.squad/decisions.md');
  });

  it('lane isolation: the state lane carries only ephemeral content to squad/inbox', async () => {
    const bare = makeTmpDir('a2-bare');
    initBareRepo(bare);
    const root = initWorkingRepo(makeTmpDir('a2-root'), 'origin', bare);
    await scaffold(root);

    await publishTeamRootToInbox(root, 'origin', 'dev', 'sess-a2', 'alpha', 'state');

    const refs = listBareRefs(bare);
    const stateRef = refs.find(r => r.startsWith('refs/heads/squad/inbox/alpha/dev/'));
    expect(stateRef).toBeTruthy();
    expect(refs.some(r => r.startsWith('refs/heads/squad/config-inbox/'))).toBe(false);

    const tree = listBareTreeFiles(bare, stateRef!);
    for (const rel of tree.filter(p => p !== '.squad/publish-metadata.json')) {
      expect(isConfigAllowlisted(rel)).toBe(false); // never a durable-only file
    }
  });
});

// ─── D: durable hydrate on pull ─────────────────────────────────────────────────

describe('piece 53 — D: hydrateTeamRootFromConfigRef', () => {
  it('lands the durable constitution, records .last-config-hydrate-sha, and re-pull is a no-op', async () => {
    const bare = makeTmpDir('d-bare');
    initBareRepo(bare);

    // Publisher seeds the durable orphan onto the remote.
    const publisher = initWorkingRepo(makeTmpDir('d-pub'), 'origin', bare);
    await scaffold(publisher);
    const configBranch = 'squad/config/alpha';
    const seed = await seedConfigOrphan(publisher, configBranch, { remote: 'origin' });
    expect(seed.seeded).toBe(true);

    // A fresh clone hydrates durable content from the config ref.
    const consumer = initWorkingRepo(makeTmpDir('d-con'), 'origin', bare);
    await hydrateTeamRootFromConfigRef(consumer, 'origin', configBranch);

    // Durable files landed; the sentinel records the fetched tip.
    expect(readFileMaybe(path.join(consumer, '.squad', 'team.md'))).not.toBeNull();
    const sentinel = readFileMaybe(path.join(consumer, '.squad', '.last-config-hydrate-sha'))?.trim();
    const remoteTip = execFileSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${configBranch}`], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(sentinel).toBe(remoteTip);

    // Every landed .squad file is durable (disjoint from the ephemeral lane).
    for (const rel of walkSquad(consumer).filter(p => !p.startsWith('.squad/.last'))) {
      expect(isConfigAllowlisted(rel)).toBe(true);
    }

    // Re-pull is idempotent: sentinel unchanged, no throw.
    await hydrateTeamRootFromConfigRef(consumer, 'origin', configBranch);
    const sentinel2 = readFileMaybe(path.join(consumer, '.squad', '.last-config-hydrate-sha'))?.trim();
    expect(sentinel2).toBe(remoteTip);
  });

  it('uses a sentinel distinct from the state hydrate so the two lanes track independently', async () => {
    const bare = makeTmpDir('d2-bare');
    initBareRepo(bare);
    const publisher = initWorkingRepo(makeTmpDir('d2-pub'), 'origin', bare);
    await scaffold(publisher);
    await seedConfigOrphan(publisher, 'squad/config/beta', { remote: 'origin' });

    const consumer = initWorkingRepo(makeTmpDir('d2-con'), 'origin', bare);
    await hydrateTeamRootFromConfigRef(consumer, 'origin', 'squad/config/beta');

    // The durable hydrate writes ONLY the config sentinel, never the state sentinel.
    expect(readFileMaybe(path.join(consumer, '.squad', '.last-config-hydrate-sha'))).not.toBeNull();
    expect(readFileMaybe(path.join(consumer, '.squad', '.last-hydrate-sha'))).toBeNull();
    // Guard: the two hydrate entry points are distinct functions.
    expect(hydrateTeamRootFromConfigRef).not.toBe(hydrateTeamRootFromStateRef);
  });
});

// ─── E: surface unpromoted durable changes ──────────────────────────────────────

describe('piece 53 — E: detectUnpromotedDurableChanges', () => {
  it('is silent (empty) when there is no baseline sentinel', async () => {
    const root = initWorkingRepo(makeTmpDir('e-nobase'));
    await scaffold(root);
    expect(detectUnpromotedDurableChanges(root)).toEqual([]);
  });

  it('is silent right after a hydrate (working copy equals the tip) and flags an edited durable file', async () => {
    const bare = makeTmpDir('e-bare');
    initBareRepo(bare);
    const publisher = initWorkingRepo(makeTmpDir('e-pub'), 'origin', bare);
    await scaffold(publisher);
    await seedConfigOrphan(publisher, 'squad/config/alpha', { remote: 'origin' });

    const consumer = initWorkingRepo(makeTmpDir('e-con'), 'origin', bare);
    await hydrateTeamRootFromConfigRef(consumer, 'origin', 'squad/config/alpha');

    // Nothing drifted immediately after hydrate.
    expect(detectUnpromotedDurableChanges(consumer)).toEqual([]);

    // Edit a durable file → it surfaces as unpromoted; ephemeral edits never do.
    fs.writeFileSync(path.join(consumer, '.squad', 'team.md'), '# edited durable constitution\n');
    fs.writeFileSync(path.join(consumer, '.squad', 'decisions.md'), '# ephemeral churn\n');
    const changed = detectUnpromotedDurableChanges(consumer);
    expect(changed).toContain('.squad/team.md');
    expect(changed).not.toContain('.squad/decisions.md');
  });
});

// ─── B/C: auto-PR config pipeline template governance ───────────────────────────

const TEMPLATE_MIRRORS = [
  '.squad-templates',
  'templates',
  path.join('packages', 'squad-cli', 'templates'),
  path.join('packages', 'squad-sdk', 'templates'),
];

function readTemplate(mirror: string, platform: 'github' | 'ado'): string {
  return fs.readFileSync(
    path.join(process.cwd(), mirror, 'fold', platform, 'fold-squad-config.yml'),
    'utf-8',
  );
}

describe('piece 53 — B/C: config pipeline templates are present and mirrored byte-identically', () => {
  for (const platform of ['github', 'ado'] as const) {
    it(`${platform} config template exists in every mirror and is byte-identical to the canonical`, () => {
      const canonical = readTemplate('.squad-templates', platform);
      expect(canonical.length).toBeGreaterThan(0);
      for (const mirror of TEMPLATE_MIRRORS) {
        expect(readTemplate(mirror, platform)).toBe(canonical);
      }
    });
  }
});

describe('piece 53 — B: GitHub auto-PR config pipeline', () => {
  const yml = readTemplate('.squad-templates', 'github');

  it('triggers on the config-inbox lane (plus manual dispatch)', () => {
    expect(yml).toContain("'squad/config-inbox/**'");
    expect(yml).toContain('workflow_dispatch');
  });

  it('opens a PR via gh pr create and never force-pushes the durable branch', () => {
    expect(yml).toContain('gh pr create');
    expect(yml).toContain('--base "$CONFIG_BRANCH"');
    expect(yml).not.toMatch(/push[^\n]*--force/);
    expect(yml).not.toContain('+refs/heads/squad/config/'); // no forced ref update
  });

  it('deletes the inbox ref only after the PR opens (recoverable on failure)', () => {
    const prIdx = yml.indexOf('gh pr create');
    const delIdx = yml.indexOf('git push origin --delete "$SHORT_REF"', prIdx);
    expect(prIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeGreaterThan(prIdx);
  });

  it('documents the reviewer gate: CODEOWNERS snippet + GITHUB_TOKEN downstream-CI caveat + PR permission', () => {
    expect(yml).toContain('CODEOWNERS');
    expect(yml).toContain('/.squad/');
    expect(yml).toContain('GITHUB_TOKEN');
    expect(yml).toContain('pull-requests: write');
  });
});

describe('piece 53 — C: ADO auto-PR config pipeline', () => {
  const yml = readTemplate('.squad-templates', 'ado');

  it('triggers on the config-inbox lane', () => {
    expect(yml).toContain('refs/heads/squad/config-inbox/*');
  });

  it('opens a PR via az repos pr create under System.AccessToken and never force-pushes', () => {
    expect(yml).toContain('az repos pr create');
    expect(yml).toContain('--target-branch "$CONFIG_BRANCH"');
    expect(yml).toContain('System.AccessToken');
    expect(yml).not.toMatch(/push[^\n]*--force/);
  });

  it('deletes the inbox ref only after the PR opens', () => {
    const prIdx = yml.indexOf('az repos pr create');
    const delIdx = yml.indexOf('git push origin --delete "$SHORT_REF"', prIdx);
    expect(prIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeGreaterThan(prIdx);
  });

  it('documents the required permission and the branch-policy reviewer gate', () => {
    expect(yml).toContain('Contribute to pull requests');
    expect(yml).toContain('branch policy');
    expect(yml).toContain('Limit job authorization scope');
  });
});

// ─── Review hardening (F1–F6) — adversarial-review follow-ups ────────────────────

describe('piece 53 — review hardening (F1–F6) present in BOTH config templates', () => {
  for (const platform of ['github', 'ado'] as const) {
    describe(platform, () => {
      const yml = readTemplate('.squad-templates', platform);

      it('F1: clean-replaces the durable subtree so file deletions propagate (rm before extract, add -A)', () => {
        expect(yml).toContain('git rm -r --quiet --ignore-unmatch .squad');
        expect(yml).toContain('git add -A .squad/');
        // The old overlay-only `git add .squad/` (which silently drops deletions) is gone.
        expect(yml).not.toMatch(/git add \.squad\//);
      });

      it('F2: names the candidate branch from the inbox ref id, not a fresh 1s timestamp', () => {
        expect(yml).toContain('REF_ID="${SHORT_REF##*/}"');
        expect(yml).toContain('squad/config-candidate/${CALLSIGN}/${REF_ID}');
        // The collision-prone fresh-date naming is gone.
        expect(yml).not.toContain('squad/config-candidate/${CALLSIGN}/${TS}');
      });

      it('F3: skips (no duplicate PR) when the candidate branch already exists', () => {
        expect(yml).toContain('git ls-remote --exit-code --heads origin "refs/heads/${CANDIDATE_BRANCH}"');
        expect(yml).toContain('no duplicate PR');
      });

      it('F4: normalizes a non-ISO-8601 publishedAt to the epoch default', () => {
        expect(yml).toContain("grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}");
        expect(yml).toContain('is not ISO-8601');
      });

      it('F5: re-checks CONFIG_ALLOWLIST server-side and surfaces (never strips) non-durable paths', () => {
        expect(yml).toContain('UNEXPECTED_PATHS');
        expect(yml).toContain('OUTSIDE the durable CONFIG_ALLOWLIST');
        // Points reviewers/maintainers at the source-of-truth allowlist to keep the two in sync.
        expect(yml).toContain('packages/squad-cli/src/cli/commands/sync.ts');
      });

      it('F6: documents that branch creation must be permitted for the genesis seed', () => {
        expect(yml.toLowerCase()).toContain('branch creation');
      });

      it('still never force-pushes the durable branch (invariant preserved by the fixes)', () => {
        expect(yml).not.toMatch(/push[^\n]*--force/);
        expect(yml).not.toContain('+refs/heads/squad/config/');
      });
    });
  }
});

describe('piece 53 — F1: clean-replace assembly propagates a durable deletion', () => {
  it('git rm + add -A stages a payload deletion that the old overlay-add silently missed', () => {
    const repo = initWorkingRepo(makeTmpDir('f1-mech'));
    const squad = path.join(repo, '.squad');
    const g = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Durable tip: three constitution files.
    fs.mkdirSync(squad, { recursive: true });
    fs.writeFileSync(path.join(squad, 'team.md'), 'team\n');
    fs.writeFileSync(path.join(squad, 'roster.md'), 'roster\n');
    fs.writeFileSync(path.join(squad, 'config.json'), '{}\n');
    g('add', '-A');
    g('commit', '-m', 'durable tip');

    // OLD overlay behavior (tar -x only adds/overwrites): team.md survives, so `git add .squad/`
    // stages nothing → the deletion is silently dropped.
    fs.writeFileSync(path.join(squad, 'roster.md'), 'roster\n'); // rewrite in place, team.md kept
    g('add', '.squad/');
    expect(g('diff', '--cached', '--name-status').trim()).not.toContain('.squad/team.md');
    g('reset', '--hard');

    // NEW clean-replace: remove the tracked tree, materialize the payload WITHOUT team.md, add -A.
    g('rm', '-r', '--quiet', '--ignore-unmatch', '.squad');
    fs.rmSync(squad, { recursive: true, force: true });
    fs.mkdirSync(squad, { recursive: true });
    fs.writeFileSync(path.join(squad, 'roster.md'), 'roster\n');
    fs.writeFileSync(path.join(squad, 'config.json'), '{}\n');
    g('add', '-A', '.squad/');
    expect(g('diff', '--cached', '--name-status').trim()).toContain('D\t.squad/team.md');
  });
});
