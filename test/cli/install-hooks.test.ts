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
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  installCrossRepoHook,
  installGitHooks,
  buildSquadSyncInvocation,
  resolveCliEntry,
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
    // piece 45: the publish invocation suffix is invariant across the resolved
    // and bare-fallback forms. (Real resolution here yields the B1 bare fallback
    // because the source tree has no runnable cli-entry.js; the resolved form is
    // covered by the resolveCliEntry / buildSquadSyncInvocation tests below.)
    expect(hookContent).toContain('sync --push --quiet');
  });

  it('A3: recursion-guard fixture — SQUAD_SYNC_ACTIVE guard prevents the resolved invocation (sentinel)', () => {
    const docsRepo = makeTmpDir('docs-repo-recursion');
    initGitRepo(docsRepo);

    // Convert a Windows absolute path to MSYS2 POSIX form for use inside sh scripts
    // (e.g. D:\foo\bar → /d/foo/bar). On non-Windows, returns the path unchanged.
    const toShPath = (p: string): string => {
      if (process.platform !== 'win32') return p;
      return p.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_m: string, d: string) => `/${d.toLowerCase()}/`);
    };

    // Inject a sentinel invocation in place of the resolved CLI entrypoint: it
    // writes a marker file when (and only when) the guarded if-block runs. This
    // exercises the SQUAD_SYNC_ACTIVE guard independently of entrypoint resolution.
    // Use 'printf "" >' instead of 'touch': git's sh.exe does not ship 'touch' on
    // PATH but built-in output redirection always works.
    const sentinelDir = makeTmpDir('sentinel-bin');
    const markerFile = path.join(sentinelDir, 'squad-invoked');
    const sentinelInvocation = `printf "" > "${toShPath(markerFile)}"`;

    installCrossRepoHook(docsRepo, { _squadInvocation: sentinelInvocation });

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

    // Runs the hook body in sh, setting or clearing SQUAD_SYNC_ACTIVE in the env.
    function runBody(body: string, guardActive: boolean): void {
      const env: Record<string, string | undefined> = { ...process.env };
      if (guardActive) {
        env['SQUAD_SYNC_ACTIVE'] = '1';
      } else {
        delete env['SQUAD_SYNC_ACTIVE'];
      }
      spawnSync(shExe, ['-c', body], { env, encoding: 'utf-8' });
    }

    // ── Case 1: guard active (SQUAD_SYNC_ACTIVE=1) → if-block skipped → invocation NOT run ─
    runBody(hookBody, /* guardActive */ true);
    expect(fs.existsSync(markerFile)).toBe(false); // guard suppressed invocation ✓

    // ── Case 2: guard inactive (SQUAD_SYNC_ACTIVE unset) → if-block runs → invocation IS run ─
    runBody(hookBody, /* guardActive */ false);
    expect(fs.existsSync(markerFile)).toBe(true);  // invocation confirmed ✓

    // ── Case 3 (load-bearing proof): strip the if/fi guard from a local copy of the body ──
    // Proves Case 1's ABSENT assertion would FAIL if the guard were removed from the template.
    const guardlessBody = hookBody
      .split('\n')
      .filter(l => !/if \[ -z "\$SQUAD_SYNC_ACTIVE" \]/.test(l) && !/^\s*fi\s*$/.test(l))
      .join('\n');
    fs.rmSync(markerFile); // reset marker to absent
    runBody(guardlessBody, /* guardActive */ true); // guard var set, but guard code absent
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

// ─── Piece 45: resolved CLI entrypoint in the post-commit hook ────────────────

describe('post-commit hook entrypoint resolution (piece 45)', () => {
  // A representative *resolved* invocation, as produced in a real (built) install.
  const RESOLVED = buildSquadSyncInvocation(
    process.execPath,
    path.join('D:', 'clone', 'dist', 'cli-entry.js'),
  );

  it('P45-1: host post-commit hook embeds the resolved invocation and preserves the .squad/ filter', () => {
    const docsRepo = makeTmpDir('docs-host-resolved');
    initGitRepo(docsRepo);
    // Mark as a host clone so the filtered host variant is selected.
    fs.mkdirSync(path.join(docsRepo, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(docsRepo, '.squad', 'team.md'), '# team\n');

    installCrossRepoHook(docsRepo, { _squadInvocation: RESOLVED });

    const body = fs.readFileSync(
      path.join(docsRepo, '.git', 'hooks', 'post-commit'), 'utf-8',
    );
    // Resolved entrypoint embedded verbatim; bare `squad` is gone.
    expect(body).toContain(RESOLVED);
    expect(body).toContain('cli-entry');
    expect(body).not.toContain('squad sync --push --quiet');
    // Host variant still filters .squad/-only commits, and the guard is intact.
    expect(body).toContain("grep -qv '^\\.squad/'");
    expect(body).toContain('[ -z "$SQUAD_SYNC_ACTIVE" ]');
  });

  it('P45-2: product post-commit hook embeds the resolved invocation, unfiltered', () => {
    const productRepo = makeTmpDir('product-resolved');
    initGitRepo(productRepo); // no .squad/team.md → product (unfiltered) variant

    installCrossRepoHook(productRepo, { _squadInvocation: RESOLVED });

    const body = fs.readFileSync(
      path.join(productRepo, '.git', 'hooks', 'post-commit'), 'utf-8',
    );
    expect(body).toContain(RESOLVED);
    expect(body).toContain('cli-entry');
    expect(body).not.toContain('squad sync --push --quiet');
    // Product variant has no .squad/ filter.
    expect(body).not.toContain("grep -qv '^\\.squad/'");
    expect(body).toContain('[ -z "$SQUAD_SYNC_ACTIVE" ]');
  });

  it('P45-3: buildSquadSyncInvocation converts a Windows node+entry path to MSYS form and single-quotes it', () => {
    const cmd = buildSquadSyncInvocation(
      'C:\\Program Files\\nodejs\\node.exe',
      'D:\\clone\\dist\\cli-entry.js',
    );
    expect(cmd).toBe(
      "'/c/Program Files/nodejs/node.exe' '/d/clone/dist/cli-entry.js' sync --push --quiet",
    );
  });

  it('P45-4: buildSquadSyncInvocation leaves a POSIX path unchanged but quotes it', () => {
    const cmd = buildSquadSyncInvocation('/usr/bin/node', '/home/u/cli/dist/cli-entry.js');
    expect(cmd).toBe("'/usr/bin/node' '/home/u/cli/dist/cli-entry.js' sync --push --quiet");
  });

  it('P45-5: buildSquadSyncInvocation single-quote-escapes an embedded single quote', () => {
    const cmd = buildSquadSyncInvocation('/usr/bin/node', "/home/o'brien/cli-entry.js");
    expect(cmd).toBe(
      "'/usr/bin/node' '/home/o'\\''brien/cli-entry.js' sync --push --quiet",
    );
  });

  it('P45-6: buildSquadSyncInvocation falls back to bare squad when the entry is unresolved (B1)', () => {
    expect(buildSquadSyncInvocation('/usr/bin/node', null)).toBe('squad sync --push --quiet');
  });

  it('P45-7: resolveCliEntry resolves the built cli-entry.js relative to the module (dist layout)', () => {
    const root = makeTmpDir('cli-dist');
    fs.mkdirSync(path.join(root, 'cli', 'commands'), { recursive: true });
    const entry = path.join(root, 'cli-entry.js');
    fs.writeFileSync(entry, '// built entry\n');
    const moduleUrl = pathToFileURL(path.join(root, 'cli', 'commands', 'install-hooks.js')).href;

    expect(resolveCliEntry(moduleUrl, undefined)).toBe(entry);
  });

  it('P45-8: resolveCliEntry rejects a .ts source entry (not runnable by a plain node hook)', () => {
    const root = makeTmpDir('cli-src');
    fs.mkdirSync(path.join(root, 'cli', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cli-entry.ts'), '// source entry\n'); // only .ts exists
    const moduleUrl = pathToFileURL(path.join(root, 'cli', 'commands', 'install-hooks.ts')).href;

    expect(resolveCliEntry(moduleUrl, undefined)).toBeNull();
  });

  it('P45-9: resolveCliEntry accepts process.argv[1] when it names a runnable cli-entry.js', () => {
    const root = makeTmpDir('cli-argv');
    fs.mkdirSync(path.join(root, 'cli', 'commands'), { recursive: true }); // no cli-entry.js relative
    const argvEntry = path.join(root, 'cli-entry.js');
    fs.writeFileSync(argvEntry, '// argv entry\n');
    const moduleUrl = pathToFileURL(path.join(root, 'cli', 'commands', 'install-hooks.js')).href;

    expect(resolveCliEntry(moduleUrl, argvEntry)).toBe(argvEntry);
  });

  it('P45-10: resolveCliEntry returns null when argv[1] is not a CLI entry (e.g. a test runner)', () => {
    const root = makeTmpDir('cli-none');
    fs.mkdirSync(path.join(root, 'cli', 'commands'), { recursive: true });
    const runner = path.join(root, 'vitest.mjs');
    fs.writeFileSync(runner, '// not a squad entry\n');
    const moduleUrl = pathToFileURL(path.join(root, 'cli', 'commands', 'install-hooks.js')).href;

    expect(resolveCliEntry(moduleUrl, runner)).toBeNull();
  });
});

// ─── Sub-proposal B: Copilot CLI post-tool hook (deferred) ───────────────────

describe('Sub-proposal B (deferred)', () => {
  // Sub-proposal B deferred: Copilot CLI external post-tool hook API not available at
  // implementation time. See .squad/decisions/inbox/piece-34-B-deferred.md.
  it.skip('B: Copilot CLI post-tool hook registration', () => { /* deferred */ });
});
