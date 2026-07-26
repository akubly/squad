/**
 * Regression guard for the economy command after resolver migration (piece 23).
 * Verifies that runEconomy works with the shared resolveSquadDir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const TEST_ROOT = join(tmpdir(), `.test-economy-cmd-${randomBytes(4).toString('hex')}`);
const SQUAD_DIR = join(TEST_ROOT, '.squad');

describe('runEconomy — resolver regression (piece 23)', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    // Squad projects always have .git/; resolveSquadDir (via SDK) requires it
    mkdirSync(join(TEST_ROOT, '.git'), { recursive: true });
    mkdirSync(SQUAD_DIR, { recursive: true });
    writeFileSync(join(SQUAD_DIR, 'config.json'), JSON.stringify({ version: 1 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('prints economy mode status without error', async () => {
    const { runEconomy } = await import('../../packages/squad-cli/src/cli/commands/economy.ts');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runEconomy(TEST_ROOT, [])).resolves.toBeUndefined();
    // Economy mode is off (default) — status output should mention "Economy Mode"
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Economy Mode');
  });

  it('enables economy mode and prints confirmation', async () => {
    const { runEconomy } = await import('../../packages/squad-cli/src/cli/commands/economy.ts');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runEconomy(TEST_ROOT, ['on'])).resolves.toBeUndefined();
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('enabled');
  });
});
