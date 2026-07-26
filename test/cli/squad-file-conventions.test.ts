/**
 * Tests for squad-file-conventions exports: CODING_AGENT_BADGE and hasCodingAgent.
 */

import { describe, it, expect } from 'vitest';
import {
  CODING_AGENT_BADGE,
  hasCodingAgent,
} from '../../packages/squad-cli/src/cli/core/squad-file-conventions.ts';
import { resolveSquadDir } from '../../packages/squad-cli/src/cli/core/squad-resolver.ts';
import { resolveSquad as resolveSquadV2 } from '@bradygaster/squad-sdk';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── hasCodingAgent ────────────────────────────────────────────────

describe('CODING_AGENT_BADGE', () => {
  it('is the canonical badge string', () => {
    expect(CODING_AGENT_BADGE).toBe('🤖 Coding Agent');
  });
});

describe('hasCodingAgent', () => {
  it('returns true when content includes the badge', () => {
    expect(hasCodingAgent('| @copilot | Coding Agent | — | 🤖 Coding Agent |')).toBe(true);
  });

  it('returns true when content includes only @copilot handle', () => {
    expect(hasCodingAgent('content with @copilot mentioned')).toBe(true);
  });

  it('returns false when content has no agent markers', () => {
    expect(hasCodingAgent('no agent here')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasCodingAgent('')).toBe(false);
  });

  it('returns true when content includes only the badge', () => {
    expect(hasCodingAgent('🤖 Coding Agent roster entry')).toBe(true);
  });

  it('returns true when content includes both badge and handle', () => {
    expect(hasCodingAgent('🤖 Coding Agent @copilot')).toBe(true);
  });
});

// ── resolveSquadDir smoke test ────────────────────────────────────

describe('resolveSquadDir (shared utility)', () => {
  const testRoot = join(tmpdir(), `.test-squad-resolver-${randomBytes(4).toString('hex')}`);

  it('returns the same path as resolveSquadV2()?.path for a git-rooted directory containing .squad/', () => {
    // Squad projects always have .git/ — create both to mirror real usage
    mkdirSync(join(testRoot, '.git'), { recursive: true });
    mkdirSync(join(testRoot, '.squad'), { recursive: true });
    try {
      const shared = resolveSquadDir(testRoot);
      const sdkResult = resolveSquadV2({ cwd: testRoot, env: {} })?.path ?? null;
      expect(shared).toBe(sdkResult);
      expect(shared).not.toBeNull();
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('returns null when no .squad/ directory exists in the tree', () => {
    // Use an isolated tmpdir leaf with .git but no .squad/
    const isolated = join(tmpdir(), `.test-resolver-empty-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(isolated, '.git'), { recursive: true });
    try {
      const result = resolveSquadV2({ cwd: isolated, env: {} })?.path ?? null;
      expect(resolveSquadDir(isolated)).toBe(result);
      expect(result).toBeNull();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('returns null when .squad/ exists but .git/ does not (no git root — documented SDK boundary)', () => {
    // F1: pins the .git-absent failure path as tested behavior, not a runtime assumption.
    // The SDK resolver requires a git root; .squad/ alone is insufficient.
    const isolated = join(tmpdir(), `.test-resolver-no-git-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(isolated, '.squad'), { recursive: true });
    try {
      expect(resolveSquadDir(isolated)).toBeNull();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('accepts an injectable env parameter (env seam — future-proofing; SDK does not currently vary behavior on env)', () => {
    // N2: verifies the env seam passes through without breaking resolution.
    const isolated = join(tmpdir(), `.test-resolver-env-seam-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(isolated, '.git'), { recursive: true });
    mkdirSync(join(isolated, '.squad'), { recursive: true });
    try {
      const withDefault = resolveSquadDir(isolated);
      const withEmpty = resolveSquadDir(isolated, {});
      expect(withDefault).not.toBeNull();
      expect(withEmpty).not.toBeNull();
      expect(withDefault).toBe(withEmpty);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
