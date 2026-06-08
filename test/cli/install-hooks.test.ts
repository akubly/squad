/**
 * Tests for installCrossRepoHook (sub-proposal A).
 *
 * Covers: hook installed in explicit docsRepoPath (not CWD); SQUAD_SYNC_ACTIVE guard
 * present in template; recursion-guard fixture; error on non-git path; idempotency.
 *
 * Sub-proposal B deferred: Copilot CLI external post-tool hook API not available at
 * implementation time. See .squad/decisions/inbox/piece-34-B-deferred.md.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  installCrossRepoHook,
  installGitHooks,
} from '../../packages/squad-cli/src/cli/commands/install-hooks.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.install-hooks-p34-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

/** Initialize a working git repo at dir. Returns the repo's git root. */
function initGitRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ─── Sub-proposal A: installCrossRepoHook ────────────────────────────────────

describe('installCrossRepoHook', () => {
  it('A1: installs post-commit hook in docsRepoPath, NOT in CWD', () => {
    const docsRepo = makeTmpDir('docs-repo');
    const productRepo = makeTmpDir('product-repo');
    initGitRepo(docsRepo);
    initGitRepo(productRepo);

    // Call from within productRepo (CWD), targeting docsRepo
    const originalCwd = process.cwd();
    try {
      process.chdir(productRepo);
      installCrossRepoHook(docsRepo);
    } finally {
      process.chdir(originalCwd);
    }

    // Hook must be in docsRepo, NOT productRepo
    const docsHookPath = path.join(docsRepo, '.git', 'hooks', 'post-commit');
    const productHookPath = path.join(productRepo, '.git', 'hooks', 'post-commit');

    expect(fs.existsSync(docsHookPath)).toBe(true);
    expect(fs.existsSync(productHookPath)).toBe(false);
  });

  it('A2: hook template contains SQUAD_SYNC_ACTIVE guard but does NOT export it (runSync owns the guard)', () => {
    const docsRepo = makeTmpDir('docs-repo-guard');
    initGitRepo(docsRepo);

    installCrossRepoHook(docsRepo);

    const hookContent = fs.readFileSync(
      path.join(docsRepo, '.git', 'hooks', 'post-commit'),
      'utf-8',
    );

    // Guard check must be present so hook skips when runSync is already active
    expect(hookContent).toContain('SQUAD_SYNC_ACTIVE');
    expect(hookContent).toContain('[ -z "$SQUAD_SYNC_ACTIVE" ]');
    // runSync owns the guard — the hook must NOT pre-set SQUAD_SYNC_ACTIVE
    // (pre-setting it caused every hook-invoked sync to no-op immediately)
    expect(hookContent).not.toContain('export SQUAD_SYNC_ACTIVE=1');
    expect(hookContent).toContain('squad sync --push --quiet');
  });

  it('A3: recursion-guard fixture — SQUAD_SYNC_ACTIVE guard prevents squad sync invocation (sentinel)', () => {
    const docsRepo = makeTmpDir('docs-repo-recursion');
    initGitRepo(docsRepo);
    installCrossRepoHook(docsRepo);

    const hookContent = fs.readFileSync(
      path.join(docsRepo, '.git', 'hooks', 'post-commit'),
      'utf-8',
    );
    // Hook body is everything after the shebang line.
    const hookBody = hookContent.split('\n').slice(1).join('\n');

    // Resolve sh executable — same mechanism used by this test file throughout.
    let shExe: string;
    if (process.platform === 'win32') {
      const gitPath = execFileSync('where', ['git'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n')[0]!.trim();
      const gitBin = path.dirname(gitPath);
      const candidate1 = path.join(path.dirname(gitBin), 'usr', 'bin', 'sh.exe');
      const candidate2 = path.join(gitBin, 'sh.exe');
      shExe = fs.existsSync(candidate1) ? candidate1 : candidate2;
    } else {
      shExe = '/bin/sh';
    }

    // Convert a Windows absolute path to MSYS2 POSIX form for use inside sh scripts
    // (e.g. D:\foo\bar → /d/foo/bar). On non-Windows, returns the path unchanged.
    const toShPath = (p: string): string => {
      if (process.platform !== 'win32') return p;
      return p.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_m: string, d: string) => `/${d.toLowerCase()}/`);
    };

    // Sentinel: use a sh function definition prepended to the hook body.
    // A sh function named 'squad' shadows any PATH entry, so the hook body's
    // 'squad sync --push --quiet' call invokes our function instead of any binary.
    // This approach requires no PATH manipulation and no file-permission concerns —
    // it works identically on Windows (MSYS2) and Unix.
    const sentinelDir = makeTmpDir('sentinel-bin');
    const markerFile = path.join(sentinelDir, 'squad-invoked');
    // Use 'printf "" >' instead of 'touch': git's sh.exe does not ship 'touch' on PATH
    // but built-in output redirection always works.
    const squadFnPreamble = `squad() { printf "" > "${toShPath(markerFile)}"; }\n`;

    // Runs the hook body (with the sentinel function prepended) in sh.
    // Explicitly sets or clears SQUAD_SYNC_ACTIVE in the subprocess environment.
    function runBody(body: string, guardActive: boolean): void {
      const env: Record<string, string | undefined> = { ...process.env };
      if (guardActive) {
        env['SQUAD_SYNC_ACTIVE'] = '1';
      } else {
        delete env['SQUAD_SYNC_ACTIVE'];
      }
      spawnSync(shExe, ['-c', squadFnPreamble + body], { env, encoding: 'utf-8' });
    }

    // ── Case 1: guard active (SQUAD_SYNC_ACTIVE=1) → if-block skipped → squad NOT invoked ─
    runBody(hookBody, /* guardActive */ true);
    expect(fs.existsSync(markerFile)).toBe(false); // guard suppressed invocation ✓

    // ── Case 2: guard inactive (SQUAD_SYNC_ACTIVE unset) → if-block runs → squad IS invoked ─
    runBody(hookBody, /* guardActive */ false);
    expect(fs.existsSync(markerFile)).toBe(true);  // invocation confirmed ✓

    // ── Case 3 (load-bearing proof): strip the if/fi guard from a local copy of the body ──
    // Proves that Case 1's ABSENT assertion would FAIL if the guard were removed from the
    // template — i.e., the guard is what makes the test GREEN in Case 1.
    const guardlessBody = hookBody
      .split('\n')
      .filter(l => !/if \[ -z "\$SQUAD_SYNC_ACTIVE" \]/.test(l) && !/^\s*fi\s*$/.test(l))
      .join('\n');
    fs.rmSync(markerFile); // reset marker to absent
    runBody(guardlessBody, /* guardActive */ true); // guard var set, but guard code absent
    // Without the if/fi guard, 'squad sync' is called unconditionally → marker appears even
    // though SQUAD_SYNC_ACTIVE=1 is in the environment.
    expect(fs.existsSync(markerFile)).toBe(true);  // guard removal causes invocation ✓
  });

  it('A4: throws error when docsRepoPath is not a git repository', () => {
    const notARepo = makeTmpDir('not-a-repo');
    // Do NOT init git

    expect(() => installCrossRepoHook(notARepo)).toThrow(
      /not a git repository/i,
    );
  });

  it('A5: idempotent — calling twice does not duplicate hook content', () => {
    const docsRepo = makeTmpDir('docs-repo-idempotent');
    initGitRepo(docsRepo);

    installCrossRepoHook(docsRepo);
    installCrossRepoHook(docsRepo);

    const hookContent = fs.readFileSync(
      path.join(docsRepo, '.git', 'hooks', 'post-commit'),
      'utf-8',
    );

    // The squad hook marker must appear exactly once
    const markerCount = (hookContent.match(/# --- squad-sync-hook ---/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('A6: does NOT install hook via ensureHooksForBackend or any product-repo path', async () => {
    // installCrossRepoHook is the only entry point for cross-repo hooks.
    // ensureHooksForBackend targets the product repo's backend hooks — it must not
    // be wired to installCrossRepoHook.
    const hooksMod = await import(
      '../../packages/squad-cli/src/cli/commands/install-hooks.js'
    );
    const docsRepo = makeTmpDir('docs-repo-ensure');
    initGitRepo(docsRepo);

    // ensureHooksForBackend skips install for 'local' backend (the default here)
    hooksMod.ensureHooksForBackend(docsRepo);

    const postCommitPath = path.join(docsRepo, '.git', 'hooks', 'post-commit');
    expect(fs.existsSync(postCommitPath)).toBe(false);
  });
});

// ─── Sub-proposal B: Copilot CLI post-tool hook (deferred) ───────────────────

describe('Sub-proposal B (deferred)', () => {
  // Sub-proposal B deferred: Copilot CLI external post-tool hook API not available at
  // implementation time. See .squad/decisions/inbox/piece-34-B-deferred.md.
  it.skip('B: Copilot CLI post-tool hook registration', () => { /* deferred */ });
});
