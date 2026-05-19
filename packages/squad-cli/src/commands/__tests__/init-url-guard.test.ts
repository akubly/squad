/**
 * Tests for the URL guard helper exported from the init command module.
 *
 * @module commands/__tests__/init-url-guard.test
 */

import { describe, it, expect } from 'vitest';
import { isUrlLikeArg } from '../init.js';

describe('isUrlLikeArg: URL-like argument detection', () => {
  it('UG1 returns true for canonical repository URL forms', () => {
    expect(isUrlLikeArg('https://github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('http://github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('ssh://git@github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('git://github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('git+https://github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('git+ssh://git@github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('git@github.com:example/repo.git')).toBe(true);
    expect(isUrlLikeArg('//example.com/path')).toBe(true);
    expect(isUrlLikeArg('file://local/cache/repo')).toBe(true);
  });

  it('UG2 trims leading whitespace before testing URL-like forms', () => {
    expect(isUrlLikeArg('  https://github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('\tgit+https://github.com/example/repo.git')).toBe(true);
    expect(isUrlLikeArg('  git@github.com:example/repo.git')).toBe(true);
  });

  it('UG3 returns false for local paths, flags, and plain directory names', () => {
    expect(isUrlLikeArg('./local/path')).toBe(false);
    expect(isUrlLikeArg('/absolute/path')).toBe(false);
    expect(isUrlLikeArg('relative-dir')).toBe(false);
    expect(isUrlLikeArg('--target-dir')).toBe(false);
    expect(isUrlLikeArg('my-project')).toBe(false);
    expect(isUrlLikeArg('')).toBe(false);
  });

  it('UG4 returns false for Windows, UNC, and dot-prefixed local paths', () => {
    expect(isUrlLikeArg('C:\\workspace\\repo')).toBe(false);
    expect(isUrlLikeArg('\\\\server\\share\\repo')).toBe(false);
    expect(isUrlLikeArg('../repo')).toBe(false);
    expect(isUrlLikeArg('./repo')).toBe(false);
    expect(isUrlLikeArg('.env')).toBe(false);
  });
});
