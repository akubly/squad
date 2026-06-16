/**
 * Piece 39 — Dogfood fixes and fold-pipeline repair.
 *
 * Tests for accepted sub-proposals E–J:
 *   E: --dry-run branches on push/pull direction
 *   F: --dry-run applies isAllowlisted filter with before/after counts
 *   G: --inbox-handle spacing fix in assign --help output
 *   H: --inbox-handle is canonical flag; --developer is deprecated alias
 *   I: git-config fallback derives handle from user.email
 *   J: gitignore-on-init/assign for allowlisted paths when backend is orphan
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('@wifi-aware/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
  writeRegistry: vi.fn(),
}));
vi.mock('@wifi-aware/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));
vi.mock('@wifi-aware/squad-sdk/validation', () => ({
  INBOX_HANDLE_RE: /^[a-z][a-z0-9-]{1,38}$/,
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, resolve } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import {
  runSync,
  deriveHandleFromGitEmail,
  PUBLISH_ALLOWLIST_EXACT,
  PUBLISH_ALLOWLIST_PREFIX,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import { loadRegistryFromDisk } from '@wifi-aware/squad-sdk/registry';
import { normalisedPathKey } from '@wifi-aware/squad-sdk/path-utils';
import type { Registry } from '../../packages/squad-sdk/src/registry.js';
import { runInit } from '../../packages/squad-cli/src/commands/init.js';
import { parseAssignArgs } from '../../packages/squad-cli/src/commands/assign-args.js';

// ─── Source file paths for static analysis ───────────────────────────────────

const CLI_ENTRY_SRC = resolvePath(process.cwd(), 'packages/squad-cli/src/cli-entry.ts');
const SYNC_SRC = resolvePath(process.cwd(), 'packages/squad-cli/src/cli/commands/sync.ts');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-39-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

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

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ─── E: --dry-run direction branching ─────────────────────────────────────────

describe('E — --dry-run direction branching (P39)', { timeout: 15000 }, () => {
  const src = fs.readFileSync(SYNC_SRC, 'utf-8');

  it('P39.E1 dry-run block references isPush for push direction', () => {
    expect(src).toMatch(/if\s*\(\s*options\.dryRun\s*\)/);
    expect(src).toMatch(/isPush/);
  });

  it('P39.E2 dry-run block references isPull for pull direction', () => {
    expect(src).toMatch(/isPull/);
  });

  it('P39.E3 dry-run return comes after direction branching (not before)', () => {
    const dryRunIdx = src.indexOf('if (options.dryRun)');
    const isPushIdx = src.indexOf('if (isPush)', dryRunIdx);
    const returnIdx = src.indexOf('return;', isPushIdx);
    expect(dryRunIdx).toBeGreaterThan(-1);
    expect(isPushIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(isPushIdx);
  });

  it('P39.E4 dry-run push shows inbox branch (static)', () => {
    const afterDryRun = src.slice(src.indexOf('if (options.dryRun)'));
    const closingBrace = afterDryRun.indexOf('return;');
    const dryRunBlock = afterDryRun.slice(0, closingBrace);
    expect(dryRunBlock).toContain('Target inbox branch');
    expect(dryRunBlock).toContain('Would pull from remote');
  });

  it('P39.E5 dry-run pull-only shows remote/branch info', async () => {
    const repoDir = makeTmpDir('e5-repo');
    const repoRoot = initGitRepo(repoDir);
    process.env['SQUAD_INBOX_HANDLE'] = 'test-user';
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      await runSync({ direction: 'pull', cwd: repoRoot, quiet: true, dryRun: true });
    } finally {
      console.log = origLog;
    }
    const output = logs.join('\n');
    expect(output).toContain('Would pull from remote');
    expect(output).not.toContain('Target inbox branch');
  });

  it('P39.E6 dry-run push-only shows inbox branch but not pull info', async () => {
    const repoDir = makeTmpDir('e6-repo');
    const repoRoot = initGitRepo(repoDir);
    process.env['SQUAD_INBOX_HANDLE'] = 'test-user';
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true });
    } finally {
      console.log = origLog;
    }
    const output = logs.join('\n');
    expect(output).toContain('Target inbox branch');
    expect(output).not.toContain('Would pull from remote');
  });
});

// ─── F: --dry-run allowlist filter ────────────────────────────────────────────

describe('F — --dry-run allowlist filter (P39)', { timeout: 15000 }, () => {
  it('P39.F1 dry-run output shows both total and filtered counts', async () => {
    const repoDir = makeTmpDir('f1-repo');
    const repoRoot = initGitRepo(repoDir);
    // Create .squad/ with both allowlisted and non-allowlisted files
    const squadDir = path.join(repoRoot, '.squad');
    fs.mkdirSync(path.join(squadDir, 'decisions', 'inbox'), { recursive: true });
    fs.mkdirSync(path.join(squadDir, 'log'), { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'decisions.md'), '# D\n');
    fs.writeFileSync(path.join(squadDir, 'log', 'session.md'), 'log\n');
    fs.writeFileSync(path.join(squadDir, 'private.md'), 'not allowlisted\n');
    process.env['SQUAD_INBOX_HANDLE'] = 'test-user';
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true });
    } finally {
      console.log = origLog;
    }
    const output = logs.join('\n');
    // Should show filtered count and total count
    expect(output).toMatch(/\d+ of \d+ total/);
  });

  it('P39.F2 dry-run does not list non-allowlisted files', async () => {
    const repoDir = makeTmpDir('f2-repo');
    const repoRoot = initGitRepo(repoDir);
    const squadDir = path.join(repoRoot, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'secret.md'), 'not allowlisted\n');
    process.env['SQUAD_INBOX_HANDLE'] = 'test-user';
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true });
    } finally {
      console.log = origLog;
    }
    const output = logs.join('\n');
    expect(output).not.toContain('secret.md');
  });
});

// ─── G: --inbox-handle spacing fix ───────────────────────────────────────────

describe('G — --inbox-handle spacing alignment in assign --help (P39)', () => {
  it('P39.G1 --inbox-handle <handle> line has 5 trailing spaces before description', () => {
    const src = fs.readFileSync(CLI_ENTRY_SRC, 'utf-8');
    // 5 spaces between `<handle>` and `Per-developer` (not 7)
    expect(src).toContain(`--inbox-handle <handle>     Per-developer`);
    expect(src).not.toContain(`--inbox-handle <handle>       Per-developer`);
  });
});

// ─── H: --inbox-handle canonical flag rename ──────────────────────────────────

describe('H — --inbox-handle canonical flag rename (P39)', { timeout: 15000 }, () => {
  const syncSrc = fs.readFileSync(SYNC_SRC, 'utf-8');
  const cliSrc = fs.readFileSync(CLI_ENTRY_SRC, 'utf-8');

  it('P39.H1 SyncOptions has inboxHandle?: string field', () => {
    expect(syncSrc).toMatch(/inboxHandle\?:\s*string/);
  });

  it('P39.H2 SyncOptions retains developer?: string as deprecated', () => {
    expect(syncSrc).toMatch(/developer\?:\s*string/);
  });

  it('P39.H3 cli-entry.ts parses --inbox-handle flag', () => {
    expect(cliSrc).toContain(`'--inbox-handle'`);
  });

  it('P39.H4 cli-entry.ts passes inboxHandle to runSync', () => {
    expect(cliSrc).toContain('inboxHandle:');
  });

  it('P39.H5 sync --help shows --inbox-handle as primary flag', () => {
    expect(cliSrc).toContain('--inbox-handle <handle>');
  });

  it('P39.H6 resolution chain uses inboxHandle ?? developer', () => {
    expect(syncSrc).toMatch(/options\.inboxHandle.*options\.developer/s);
  });

  it('P39.H7 --inbox-handle and --developer both work via resolution chain', async () => {
    const repoDir = makeTmpDir('h7-repo');
    const repoRoot = initGitRepo(repoDir);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      // Test --inbox-handle via inboxHandle option
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true, inboxHandle: 'my-handle' });
    } finally {
      console.log = origLog;
    }
    expect(logs.join('\n')).toContain('my-handle');
  });

  it('P39.H8 --developer alias resolves to same handle', async () => {
    const repoDir = makeTmpDir('h8-repo');
    const repoRoot = initGitRepo(repoDir);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true, developer: 'dev-handle' });
    } finally {
      console.log = origLog;
    }
    expect(logs.join('\n')).toContain('dev-handle');
  });
});

// ─── I: git-config fallback ───────────────────────────────────────────────────

describe('I — git-config fallback for inbox handle (P39)', { timeout: 15000 }, () => {
  it('P39.I1 deriveHandleFromGitEmail returns sanitized handle from email', () => {
    const repoDir = makeTmpDir('i1-repo');
    initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', 'Test.User@example.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    expect(result).toBeDefined();
    // 'Test.User' → lowercase 'test.user' → dots to dashes 'test-user'
    expect(result).toBe('test-user');
  });

  it('P39.I2 deriveHandleFromGitEmail returns undefined when email local-part is empty', () => {
    const repoDir = makeTmpDir('i2-repo');
    initGitRepo(repoDir);
    // Set an email with no local part (just @domain) — sanitization produces empty result
    execFileSync('git', ['config', '--local', 'user.email', '@example.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    expect(result).toBeUndefined();
  });

  it('P39.I3 deriveHandleFromGitEmail prepends u- when local-part starts with digit', () => {
    const repoDir = makeTmpDir('i3-repo');
    initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', '123user@example.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    expect(result).toBeDefined();
    expect(result!.startsWith('u-')).toBe(true);
  });

  it('P39.I4 deriveHandleFromGitEmail truncates at 39 chars', () => {
    const repoDir = makeTmpDir('i4-repo');
    initGitRepo(repoDir);
    const longEmail = 'averylonglocalpartthatshouldbetruncatedatthirtyninecharacters@example.com';
    execFileSync('git', ['config', '--local', 'user.email', longEmail], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(39);
  });

  it('P39.I5 fallback fires and emits console.warn when handle not otherwise set', async () => {
    const repoDir = makeTmpDir('i5-repo');
    const repoRoot = initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', 'fallback-user@test.com'], { cwd: repoRoot, stdio: 'pipe' });
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warns.push(msg); };
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    try {
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true });
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
    expect(warns.some(w => w.includes('fallback-user'))).toBe(true);
  });

  it('P39.I6 fallback handle is used in dry-run output', async () => {
    const repoDir = makeTmpDir('i6-repo');
    const repoRoot = initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', 'jane-doe@corp.com'], { cwd: repoRoot, stdio: 'pipe' });
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      await runSync({ direction: 'push', cwd: repoRoot, quiet: true, dryRun: true });
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
    // jane-doe@corp.com → local 'jane-doe' → sanitized 'jane-doe'
    expect(logs.join('\n')).toContain('jane-doe');
  });

  // COR-2 adversarial cases — deriveHandleFromGitEmail must only return handles the publish validator accepts
  it('P39.I7 single-char local part returns undefined (too short for INBOX_HANDLE_RE)', () => {
    const repoDir = makeTmpDir('i7-repo');
    initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', 'a@corp.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    expect(result).toBeUndefined();
  });

  it('P39.I8 empty local part (just @domain) returns undefined', () => {
    const repoDir = makeTmpDir('i8-repo');
    initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', '@corp.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    expect(result).toBeUndefined();
  });

  it('P39.I9 digits-only local part gets u- prefix and returns valid handle', () => {
    const repoDir = makeTmpDir('i9-repo');
    initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', '123@corp.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    // 123 → digit-start → u-123 → passes /^[a-z][a-z0-9-]{1,38}$/
    expect(result).toBe('u-123');
  });

  it('P39.I10 unicode local part strips non-ascii and returns valid handle if long enough', () => {
    const repoDir = makeTmpDir('i10-repo');
    initGitRepo(repoDir);
    execFileSync('git', ['config', '--local', 'user.email', 'josé@corp.com'], { cwd: repoDir, stdio: 'pipe' });
    const result = deriveHandleFromGitEmail(repoDir);
    // 'josé' → lowercase → strip non-[a-z0-9-] → 'jos' → passes regex (3 chars, letter-start)
    expect(result).toBe('jos');
    expect(result).toBeDefined();
  });

  it('P39.I11 deriveHandleFromGitEmail never returns a handle that INBOX_HANDLE_RE rejects', () => {
    // Adversarial: after sanitization, result must always satisfy INBOX_HANDLE_RE or be undefined
    const INBOX_HANDLE_RE = /^[a-z][a-z0-9-]{1,38}$/;
    const repoDir = makeTmpDir('i11-repo');
    initGitRepo(repoDir);
    const adversarialEmails = [
      'a@x',          // too short
      '@x',           // empty local
      '-start@x',     // hyphen start (stripped → empty or invalid)
      '!!@x',         // all special chars (stripped → empty)
    ];
    for (const email of adversarialEmails) {
      execFileSync('git', ['config', '--local', 'user.email', email], { cwd: repoDir, stdio: 'pipe' });
      const result = deriveHandleFromGitEmail(repoDir);
      if (result !== undefined) {
        expect(INBOX_HANDLE_RE.test(result)).toBe(true);
      }
    }
  });
});

// ─── J: gitignore-on-init / allowlist constants exported ──────────────────────

describe('J — gitignore-on-init / allowlist constants exported (P39)', () => {
  it('P39.J1 PUBLISH_ALLOWLIST_EXACT is exported from sync.ts', () => {
    expect(PUBLISH_ALLOWLIST_EXACT).toBeDefined();
    expect(Array.isArray(PUBLISH_ALLOWLIST_EXACT)).toBe(true);
    expect(PUBLISH_ALLOWLIST_EXACT).toContain('.squad/decisions.md');
  });

  it('P39.J2 PUBLISH_ALLOWLIST_PREFIX is exported from sync.ts', () => {
    expect(PUBLISH_ALLOWLIST_PREFIX).toBeDefined();
    expect(Array.isArray(PUBLISH_ALLOWLIST_PREFIX)).toBe(true);
    expect(PUBLISH_ALLOWLIST_PREFIX.some(p => p.startsWith('.squad/'))).toBe(true);
  });

  it('P39.J3 allowlist entries do not include blanket .squad/', () => {
    const all = [...PUBLISH_ALLOWLIST_EXACT, ...PUBLISH_ALLOWLIST_PREFIX];
    expect(all).not.toContain('.squad/');
    // No entry should be exactly .squad/ or .squad
    expect(all.every(e => e !== '.squad' && e !== '.squad/')).toBe(true);
  });

  it('P39.J4 init.ts imports PUBLISH_ALLOWLIST_EXACT from sync.ts', () => {
    const initSrc = fs.readFileSync(resolvePath(process.cwd(), 'packages/squad-cli/src/commands/init.ts'), 'utf-8');
    expect(initSrc).toContain('PUBLISH_ALLOWLIST_EXACT');
    expect(initSrc).toContain('PUBLISH_ALLOWLIST_PREFIX');
    expect(initSrc).toContain('sync.js');
  });

  it('P39.J5 assign.ts imports PUBLISH_ALLOWLIST_EXACT from sync.ts', () => {
    const assignSrc = fs.readFileSync(resolvePath(process.cwd(), 'packages/squad-cli/src/commands/assign.ts'), 'utf-8');
    expect(assignSrc).toContain('PUBLISH_ALLOWLIST_EXACT');
    expect(assignSrc).toContain('PUBLISH_ALLOWLIST_PREFIX');
    expect(assignSrc).toContain('sync.js');
  });

  it('P39.J6 runInit yes=true on orphan backend untracks allowlisted files and writes .gitignore', async () => {
    const repoDir = makeTmpDir('j6-repo');
    const repoRoot = initGitRepo(repoDir);
    // Stage a .squad/decisions.md file (allowlisted sentinel)
    const squadDir = path.join(repoRoot, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'decisions.md'), '# Decisions\n');
    execFileSync('git', ['add', '.squad/decisions.md'], { cwd: repoRoot, stdio: 'pipe' });

    // Confirm tracked before
    const before = execFileSync('git', ['ls-files', '.squad/decisions.md'], {
      cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(before).toBe('.squad/decisions.md');

    // Call runInit with orphan backend and yes=true
    await runInit({ cwd: repoRoot, noRegister: true, stateBackend: 'orphan', yes: true });

    // Verify untracked
    const after = execFileSync('git', ['ls-files', '.squad/decisions.md'], {
      cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(after).toBe('');

    // Verify .gitignore has allowlisted entries
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.squad/decisions.md');
  });

  it('P39.J7 runInit yes=true is idempotent — second run does not duplicate .gitignore entries', async () => {
    const repoDir = makeTmpDir('j7-repo');
    const repoRoot = initGitRepo(repoDir);
    const squadDir = path.join(repoRoot, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'decisions.md'), '# D\n');
    execFileSync('git', ['add', '.squad/decisions.md'], { cwd: repoRoot, stdio: 'pipe' });

    await runInit({ cwd: repoRoot, noRegister: true, stateBackend: 'orphan', yes: true });
    const after1 = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8');

    // Second run — already untracked and already in .gitignore
    await runInit({ cwd: repoRoot, noRegister: true, stateBackend: 'orphan', yes: true });
    const after2 = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8');

    // .gitignore must not grow (idempotent)
    expect(after2).toBe(after1);
  });

  it('P39.J8 runInit with non-orphan backend skips gitignore remediation', async () => {
    const repoDir = makeTmpDir('j8-repo');
    const repoRoot = initGitRepo(repoDir);
    const squadDir = path.join(repoRoot, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'decisions.md'), '# D\n');
    execFileSync('git', ['add', '.squad/decisions.md'], { cwd: repoRoot, stdio: 'pipe' });

    await runInit({ cwd: repoRoot, noRegister: true, stateBackend: 'local', yes: true });

    // File should still be tracked
    const tracked = execFileSync('git', ['ls-files', '.squad/decisions.md'], {
      cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(tracked).toBe('.squad/decisions.md');

    // .gitignore should NOT have been created with squad entries
    const hasGitignore = fs.existsSync(path.join(repoRoot, '.gitignore'));
    if (hasGitignore) {
      const content = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8');
      expect(content).not.toContain('Squad allowlist');
    }
  });

  it('P39.J9 cli-entry.ts wires --yes flag for init subcommand', () => {
    const src = fs.readFileSync(CLI_ENTRY_SRC, 'utf-8');
    expect(src).toMatch(/yes:\s*args\.includes\(['"]--yes['"]\)/);
  });

  it('P39.J10 parseAssignArgs parses --yes flag as boolean true', () => {
    const result = parseAssignArgs(['--yes', '--callsign', 'my-squad']);
    expect(result.yes).toBe(true);
  });

  it('P39.J11 parseAssignArgs yes defaults to false when --yes not present', () => {
    const result = parseAssignArgs(['--callsign', 'my-squad']);
    expect(result.yes).toBe(false);
  });

  it('P39.J12 cli-entry.ts destructures yes from parseAssignArgs and passes to runAssign', () => {
    const src = fs.readFileSync(CLI_ENTRY_SRC, 'utf-8');
    // yes must be destructured from parseAssignArgs result
    expect(src).toMatch(/parseAssignArgs\(/);
    expect(src).toMatch(/\byes\b.*parseAssignArgs|parseAssignArgs.*\byes\b/s);
    // yes must appear in the runAssign call opts
    const assignBlock = src.slice(src.indexOf("if (cmd === 'assign')"));
    expect(assignBlock).toMatch(/runAssign\(/);
    expect(assignBlock).toContain('yes,');
  });
});
