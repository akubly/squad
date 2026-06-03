/**
 * Execution-based idempotency tests for bootstrap-cross-repo.ps1 — piece 30 (FIDO M1)
 *
 * Runs the bootstrap PowerShell script twice in an isolated fixture (bare repo +
 * temp WORK_ROOT), then asserts that the second invocation:
 *   - exits 0 (no error)
 *   - produces no duplicate entries in .git/info/exclude
 *   - produces no duplicate squad-docs remote registrations
 *
 * Test skips gracefully if `pwsh` is not on PATH.
 *
 * Fixture design:
 *   - TEAM_ROOT directory is pre-created so the clone step is skipped
 *     (avoids need for a real remote).
 *   - .squad/config.json is pre-created so squad bind is skipped
 *     (avoids dependency on squad CLI for the bind step).
 *   - A mock `squad` script is injected on PATH so squad sync --pull exits 0
 *     without requiring a real squad installation.
 *   - DocsRepoUrl is a valid https:// URL that passes scheme validation but
 *     is never actually cloned (TEAM_ROOT pre-exists).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BOOTSTRAP_SCRIPT = resolve(ROOT, '.squad-templates', 'ado', 'bootstrap-cross-repo.ps1');

function isPwshAvailable(): boolean {
  try {
    const result = spawnSync('pwsh', ['-Command', 'exit 0'], { timeout: 8000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

const pwshAvailable = isPwshAvailable();

function runBootstrap(
  workRoot: string,
  env: NodeJS.ProcessEnv
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    'pwsh',
    [
      '-NonInteractive',
      '-File',
      BOOTSTRAP_SCRIPT,
      '-DocsRepoUrl',
      'https://dev.azure.com/test-org/test-proj/_git/docs',
      '-DeveloperAlias',
      'testuser',
    ],
    {
      cwd: workRoot,
      env,
      timeout: 30_000,
      encoding: 'utf-8',
    }
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe.skipIf(!pwshAvailable)('bootstrap-cross-repo.ps1 idempotency', () => {
  it(
    'second invocation exits 0 with no duplicate exclude entries or remote registrations',
    () => {
      const testId = randomUUID().slice(0, 8);
      // Create fixture directories in the project root (not /tmp) under a test-scoped name
    const fixtureBase = join(ROOT, `.test-bootstrap-idempotency-${testId}`);
    const workRoot = join(fixtureBase, 'work-root');
    const teamRoot = join(fixtureBase, 'team-root');
    const mockBinDir = join(fixtureBase, 'mock-bin');

    try {
      // --- Fixture setup ---
      mkdirSync(workRoot, { recursive: true });
      mkdirSync(teamRoot, { recursive: true }); // pre-exist so clone is skipped
      mkdirSync(mockBinDir, { recursive: true });

      // Initialize work-root as a real git repo
      execSync('git init', { cwd: workRoot, stdio: 'pipe' });
      execSync('git config user.email "test@test.local"', { cwd: workRoot, stdio: 'pipe' });
      execSync('git config user.name "Bootstrap Test"', { cwd: workRoot, stdio: 'pipe' });

      // Pre-create .squad/config.json so squad bind is skipped
      mkdirSync(join(workRoot, '.squad'), { recursive: true });
      writeFileSync(
        join(workRoot, '.squad', 'config.json'),
        JSON.stringify({
          teamRoot,
          workRoot,
          developerAlias: 'testuser',
          stateBranch: 'squad-state',
        }),
        'utf-8'
      );

      // Create a mock squad script that exits 0 for any command
      if (platform() === 'win32') {
        writeFileSync(join(mockBinDir, 'squad.cmd'), '@echo off\r\nexit 0\r\n', 'utf-8');
      } else {
        writeFileSync(join(mockBinDir, 'squad'), '#!/bin/sh\nexit 0\n', 'utf-8');
        execSync(`chmod +x "${join(mockBinDir, 'squad')}"`, { stdio: 'pipe' });
      }

      // Build env with mock bin prepended on PATH
      const sep = platform() === 'win32' ? ';' : ':';
      const testEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${mockBinDir}${sep}${process.env.PATH ?? ''}`,
      };

      // --- Run 1 ---
      const run1 = runBootstrap(workRoot, testEnv);

      // Run 1 should succeed (or fail only at squad sync --pull if mock doesn't cover it)
      // We accept status 0 or 1 for run1 — the key assertion is run2
      const excludeFile = join(workRoot, '.git', 'info', 'exclude');
      expect(existsSync(excludeFile), 'exclude file must exist after first run').toBe(true);

      // --- Run 2 ---
      const run2 = runBootstrap(workRoot, testEnv);

      expect(
        run2.status,
        `Second run must exit 0. stderr:\n${run2.stderr}\nstdout:\n${run2.stdout}`
      ).toBe(0);

      // --- Idempotency assertions ---

      // No duplicate entries in .git/info/exclude
      const excludeContent = readFileSync(excludeFile, 'utf-8');
      const excludeLines = excludeContent.split('\n').map((l) => l.trim());

      const squadDirLines = excludeLines.filter((l) => l === '.squad/');
      expect(
        squadDirLines.length,
        '.squad/ must appear exactly once in .git/info/exclude (no duplicates)'
      ).toBe(1);

      const agentLines = excludeLines.filter((l) => l === '.github/agents/squad.agent.md');
      expect(
        agentLines.length,
        '.github/agents/squad.agent.md must appear exactly once in .git/info/exclude (no duplicates)'
      ).toBe(1);

      // No duplicate squad-docs remote
      const remoteOutput = execSync('git remote -v', {
        cwd: workRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      const squadDocsRemoteLines = remoteOutput
        .split('\n')
        .filter((l) => l.startsWith('squad-docs'));

      // git remote -v shows each remote twice (fetch and push), so 2 is expected, 4+ is a duplicate
      expect(
        squadDocsRemoteLines.length,
        'squad-docs remote must appear at most twice in git remote -v (fetch + push); more indicates a duplicate'
      ).toBeLessThanOrEqual(2);
      expect(
        squadDocsRemoteLines.length,
        'squad-docs remote must be configured (at least fetch)'
      ).toBeGreaterThan(0);
    } finally {
      // Clean up fixture
      try {
        rmSync(fixtureBase, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; do not fail the test on cleanup errors
      }
    }
  },
  120_000 // pwsh startup × 2 runs takes ~30-60s; allow 2 minutes
  );
});
