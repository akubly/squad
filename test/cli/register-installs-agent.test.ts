/**
 * Tests for the agent-install side effect of the register command.
 * Covers: default install, version stamp, overwrite, directory creation,
 * opt-out flag, non-fatal failure (EISDIR approach for cross-platform
 * reliability), symlink-safe replace, CLI dispatch (--no-install-agent flag),
 * and help text inclusion.
 *
 * Note: the squad.agent.md primary-candidate branch (unsuffixed) is exercised
 * by the templatesDir-injection tests. The current build ships the template as
 * squad.agent.md.template; the primary-candidate path is reached only when an
 * unsuffixed squad.agent.md exists in the templates directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from 'fs';
import { randomBytes } from 'crypto';
import { spawnSync } from 'child_process';
import { runRegister } from '@bradygaster/squad-cli/commands/register';
import { getPackageVersion } from '@bradygaster/squad-cli/core/version';

const TEST_ROOT = join(process.cwd(), `.test-register-agent-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

function fakeHome(): string {
  return join(TEST_ROOT, 'home');
}

function agentTarget(home: string): string {
  return join(home, '.copilot', 'agents', 'squad.agent.md');
}

// Path to the compiled CLI binary used for child-process dispatch tests.
const CLI_ENTRY = join(process.cwd(), 'packages', 'squad-cli', 'dist', 'cli-entry.js');

describe('register agent install: default behavior', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await mkdir(fakeHome(), { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates squad.agent.md at <home>/.copilot/agents/', async () => {
    const home = fakeHome();
    const result = await runRegister({
      callsign: 'test-squad',
      path: squadDir,
      registryPath: tempRegistry(),
      home,
    });
    const target = agentTarget(home);
    expect(existsSync(target)).toBe(true);
    expect(result.agentInstalledAt).toBe(target);
  });

  it('installed file contains the current package version stamp', async () => {
    const home = fakeHome();
    const result = await runRegister({
      callsign: 'test-squad',
      path: squadDir,
      registryPath: tempRegistry(),
      home,
    });
    const target = agentTarget(home);
    const version = getPackageVersion();
    const content = readFileSync(target, 'utf-8');
    expect(content).toMatch(new RegExp(`<!-- version: ${version.replace(/\./g, '\\.')} -->`));
    expect(result.agentInstalledAt).toBe(target);
  });

  it('overwrites an existing file at the target path', async () => {
    const home = fakeHome();
    const targetDir = join(home, '.copilot', 'agents');
    await mkdir(targetDir, { recursive: true });
    const target = agentTarget(home);
    await writeFile(target, 'old content that should be replaced');

    const result = await runRegister({
      callsign: 'test-squad',
      path: squadDir,
      registryPath: tempRegistry(),
      home,
    });

    const content = readFileSync(target, 'utf-8');
    expect(content).not.toBe('old content that should be replaced');
    expect(content.length).toBeGreaterThan(100);
    expect(result.agentInstalledAt).toBe(target);
  });

  it('creates missing .copilot/agents parent directories', async () => {
    const home = fakeHome();
    expect(existsSync(join(home, '.copilot'))).toBe(false);

    const result = await runRegister({
      callsign: 'test-squad',
      path: squadDir,
      registryPath: tempRegistry(),
      home,
    });

    expect(existsSync(join(home, '.copilot', 'agents'))).toBe(true);
    expect(existsSync(agentTarget(home))).toBe(true);
    expect(result.agentInstalledAt).toBe(agentTarget(home));
  });
});

describe('register agent install: opt-out', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
    await mkdir(fakeHome(), { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('installAgent: false skips all writes under the Copilot agents directory', async () => {
    const home = fakeHome();

    // Confirm default behavior installs
    const home2 = join(TEST_ROOT, 'home2');
    await mkdir(home2, { recursive: true });
    const result2 = await runRegister({
      callsign: 'default-squad',
      path: squadDir,
      registryPath: join(TEST_ROOT, 'reg2.json'),
      home: home2,
    });
    expect(existsSync(agentTarget(home2))).toBe(true);
    expect(result2.agentInstalledAt).toBe(agentTarget(home2));

    // installAgent: false skips the install
    const result = await runRegister({
      callsign: 'test-squad',
      path: squadDir,
      registryPath: tempRegistry(),
      home,
      installAgent: false,
    });

    expect(result.registered.callsign).toBe('test-squad');
    expect(existsSync(agentTarget(home))).toBe(false);
    expect(existsSync(join(home, '.copilot'))).toBe(false);
    expect(result.agentInstalledAt).toBeUndefined();
  });
});

describe('register agent install: non-fatal write failure', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('registry entry exists and command resolves even when agent copy fails', async () => {
    const home = fakeHome();
    await mkdir(home, { recursive: true });

    // Pre-create the target path as a DIRECTORY — copyFileSync to a directory
    // path fails with EISDIR on all platforms, including Windows.
    const targetDir = join(home, '.copilot', 'agents');
    const targetAsDir = join(targetDir, 'squad.agent.md');
    await mkdir(targetAsDir, { recursive: true });

    const warnMessages: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnMessages.push(args.join(' ')); };

    let result: Awaited<ReturnType<typeof runRegister>> | undefined;
    try {
      result = await runRegister({
        callsign: 'test-squad',
        path: squadDir,
        registryPath: tempRegistry(),
        home,
      });
    } finally {
      console.warn = origWarn;
    }

    // Registry write must have succeeded
    expect(result).toBeDefined();
    expect(result!.registered.callsign).toBe('test-squad');
    expect(existsSync(tempRegistry())).toBe(true);
    expect(result!.agentInstalledAt).toBeUndefined();

    // A warning must have been emitted that names both the target path and the fs error
    expect(warnMessages.length).toBeGreaterThan(0);
    const warnText = warnMessages.join('\n');
    expect(warnText).toMatch(/\.copilot[\\\/]agents[\\\/]squad\.agent\.md/);
    expect(warnText).toMatch(/EACCES|ENOTDIR|EISDIR|permission|not a directory|could not/i);
  });
});

describe('register agent install: symlink handling', () => {
  let squadDir: string;

  function canSymlink(): boolean {
    const linkPath = join(TEST_ROOT, `probe-link-${randomBytes(4).toString('hex')}`);
    const linkTarget = join(TEST_ROOT, `probe-target-${randomBytes(4).toString('hex')}`);
    try {
      writeFileSync(linkTarget, 'probe');
      symlinkSync(linkTarget, linkPath);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32' && !canSymlink())(
    'replaces a pre-existing symlink at the target location',
    async () => {
      if (!existsSync(TEST_ROOT)) await mkdir(TEST_ROOT, { recursive: true });

      const home = join(TEST_ROOT, 'home-symlink');
      const agentsDir = join(home, '.copilot', 'agents');
      await mkdir(agentsDir, { recursive: true });

      // Pre-create an unrelated file and a symlink pointing at it from the target path
      const otherFile = join(TEST_ROOT, 'other-file.txt');
      const originalContent = 'original content — must remain unchanged';
      writeFileSync(otherFile, originalContent);

      const targetPath = join(agentsDir, 'squad.agent.md');
      symlinkSync(otherFile, targetPath);

      // Confirm setup: target is a symlink
      expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);

      const result = await runRegister({
        callsign: 'sym-squad',
        path: squadDir,
        registryPath: join(TEST_ROOT, 'sym-registry.json'),
        home,
      });

      // Symlink must be gone — target is now a regular file
      expect(lstatSync(targetPath).isSymbolicLink()).toBe(false);
      expect(lstatSync(targetPath).isFile()).toBe(true);

      // Target holds stamped template content
      const installedContent = readFileSync(targetPath, 'utf-8');
      const version = getPackageVersion();
      expect(installedContent).toMatch(
        new RegExp(`<!-- version: ${version.replace(/\./g, '\\.')} -->`),
      );
      expect(result.agentInstalledAt).toBe(targetPath);

      // The original symlink target is unchanged
      expect(readFileSync(otherFile, 'utf-8')).toBe(originalContent);
    },
  );
});

describe('register agent install: primary template candidate', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('uses squad.agent.md (unsuffixed) when present in the templates dir', async () => {
    // Stage a minimal templates fixture that has only the unsuffixed file
    const fakeTemplatesDir = join(TEST_ROOT, 'fake-templates');
    await mkdir(fakeTemplatesDir, { recursive: true });
    const primaryContent =
      '<!-- version: 0.0.0 -->\n# Squad Coordinator\n- **Version:** 0.0.0\n';
    await writeFile(join(fakeTemplatesDir, 'squad.agent.md'), primaryContent);

    const home = join(TEST_ROOT, 'home-primary');
    await mkdir(home, { recursive: true });

    const result = await runRegister({
      callsign: 'primary-squad',
      path: squadDir,
      registryPath: join(TEST_ROOT, 'primary-registry.json'),
      home,
      templatesDir: fakeTemplatesDir,
    });

    const version = getPackageVersion();
    const content = readFileSync(agentTarget(home), 'utf-8');
    expect(content).toMatch(new RegExp(`<!-- version: ${version.replace(/\./g, '\\.')} -->`));
    expect(result.agentInstalledAt).toBe(agentTarget(home));
  });

  it('emits a warning and returns undefined when neither template file exists', async () => {
    const emptyTemplatesDir = join(TEST_ROOT, 'empty-templates');
    await mkdir(emptyTemplatesDir, { recursive: true });

    const home = join(TEST_ROOT, 'home-neither');
    await mkdir(home, { recursive: true });

    const warnMessages: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnMessages.push(args.join(' ')); };

    let result: Awaited<ReturnType<typeof runRegister>> | undefined;
    try {
      result = await runRegister({
        callsign: 'neither-squad',
        path: squadDir,
        registryPath: join(TEST_ROOT, 'neither-registry.json'),
        home,
        templatesDir: emptyTemplatesDir,
      });
    } finally {
      console.warn = origWarn;
    }

    expect(result).toBeDefined();
    expect(result!.registered.callsign).toBe('neither-squad');
    expect(result!.agentInstalledAt).toBeUndefined();
    expect(warnMessages.length).toBeGreaterThan(0);
    expect(warnMessages.join('\n')).toMatch(/could not install coordinator agent/i);
  });
});

describe('register CLI: dispatch', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('without --no-install-agent, creates the agent file under the --home dir', () => {
    const home = join(TEST_ROOT, 'cli-home-install');
    const reg = join(TEST_ROOT, 'cli-reg-install.json');

    const proc = spawnSync(
      process.execPath,
      [
        CLI_ENTRY,
        'register',
        '--callsign', 'cli-squad',
        '--path', squadDir,
        '--registry-path', reg,
        '--home', home,
      ],
      { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } },
    );

    expect(proc.status).toBe(0);
    expect(existsSync(agentTarget(home))).toBe(true);
  });

  it('with --no-install-agent, no file is created under the --home dir', () => {
    const home = join(TEST_ROOT, 'cli-home-noinstall');
    const reg = join(TEST_ROOT, 'cli-reg-noinstall.json');

    const proc = spawnSync(
      process.execPath,
      [
        CLI_ENTRY,
        'register',
        '--callsign', 'cli-squad-noinstall',
        '--path', squadDir,
        '--registry-path', reg,
        '--home', home,
        '--no-install-agent',
      ],
      { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } },
    );

    expect(proc.status).toBe(0);
    expect(existsSync(agentTarget(home))).toBe(false);
  });
});

describe('register CLI: help text', () => {
  it('includes --no-install-agent in register help output', () => {
    const proc = spawnSync(
      process.execPath,
      [CLI_ENTRY, 'register', '--help'],
      { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } },
    );
    expect(proc.stdout).toContain('--no-install-agent');
  });
});
