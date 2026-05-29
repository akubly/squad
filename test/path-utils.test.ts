/**
 * Tests for path-utils helpers: clonesMatch() and pathsRefSameLocation().
 *
 * Covers: exact match, subdirectory containment, sibling-prefix rejection,
 * platform case sensitivity, symlink/junction equality, realpath containment,
 * relative-path error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import { clonesMatch, normalisedPathKey, pathsRefSameLocation } from '@wifi-aware/squad-sdk/path-utils';
import { SquadError } from '@wifi-aware/squad-sdk/adapter/errors';

const TMP = join(process.cwd(), `.test-path-utils-${randomBytes(4).toString('hex')}`);

function dir(...segments: string[]): string {
  return join(TMP, ...segments);
}

function scaffold(...paths: string[]): void {
  for (const p of paths) {
    mkdirSync(dir(p), { recursive: true });
  }
}

function catchSquadError(fn: () => unknown): SquadError {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SquadError);
  return err as SquadError;
}

function errorCode(err: SquadError): unknown {
  return err.context.metadata?.['code'];
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// pathsRefSameLocation
// ---------------------------------------------------------------------------

describe('pathsRefSameLocation()', () => {
  it('PU.1 returns true for identical paths', () => {
    scaffold('a-dir');
    expect(pathsRefSameLocation(dir('a-dir'), dir('a-dir'))).toBe(true);
  });

  it('PU.2 returns false for different paths', () => {
    scaffold('a-dir', 'b-dir');
    expect(pathsRefSameLocation(dir('a-dir'), dir('b-dir'))).toBe(false);
  });

  it('PU.3 falls back to literal comparison when realpath fails', () => {
    // Non-existent paths — realpathSync throws, falls back to literal equality
    const ghost = dir('does-not-exist');
    expect(pathsRefSameLocation(ghost, ghost)).toBe(true);
  });

  it('PU.4 returns false when non-existent paths differ', () => {
    expect(pathsRefSameLocation(dir('ghost-a'), dir('ghost-b'))).toBe(false);
  });

  it('PU.5 detects symlink pointing to same directory', () => {
    scaffold('real-dir');
    const symlinkPath = dir('linked-dir');
    try {
      symlinkSync(dir('real-dir'), symlinkPath, 'junction');
    } catch {
      // Symlink creation requires elevated privileges on some platforms; skip.
      return;
    }
    expect(pathsRefSameLocation(dir('real-dir'), symlinkPath)).toBe(true);
  });

  it('PU.6 falls back to literal comparison when realpath target was deleted', () => {
    scaffold('real-target');
    const link = dir('broken-link');
    try {
      symlinkSync(dir('real-target'), link, 'dir');
    } catch {
      return; // platform without symlink privilege — skip
    }
    rmSync(dir('real-target'), { recursive: true, force: true });
    // realpath() on `link` now throws because the target is gone.
    // pathsRefSameLocation must NOT throw; it falls back to literal compare.
    expect(() => pathsRefSameLocation(link, link)).not.toThrow();
    expect(pathsRefSameLocation(link, link)).toBe(true);
    expect(pathsRefSameLocation(link, dir('something-else'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clonesMatch — exact equality
// ---------------------------------------------------------------------------

describe('clonesMatch() — exact equality', () => {
  it('CM.1 returns true when cwd equals clone exactly', () => {
    scaffold('repo');
    expect(clonesMatch(dir('repo'), dir('repo'))).toBe(true);
  });

  it('CM.2 returns false when cwd is a sibling of clone', () => {
    scaffold('repo', 'repo-tools');
    expect(clonesMatch(dir('repo-tools'), dir('repo'))).toBe(false);
  });

  it('CM.3 returns false for sibling with shared prefix', () => {
    scaffold('squad', 'squad-extras');
    expect(clonesMatch(dir('squad-extras'), dir('squad'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clonesMatch — containment
// ---------------------------------------------------------------------------

describe('clonesMatch() — subdirectory containment', () => {
  it('CM.4 returns true when cwd is a direct subdirectory of clone', () => {
    scaffold('repo', 'repo/src');
    expect(clonesMatch(dir('repo', 'src'), dir('repo'))).toBe(true);
  });

  it('CM.5 returns true when cwd is deeply nested under clone', () => {
    scaffold('repo/packages/lib/src');
    expect(clonesMatch(dir('repo', 'packages', 'lib', 'src'), dir('repo'))).toBe(true);
  });

  it('CM.6 returns false when clone is a subdirectory of cwd (reversed)', () => {
    scaffold('repo/src');
    // clone = repo/src, cwd = repo → NOT a match (cwd is not inside clone)
    expect(clonesMatch(dir('repo'), dir('repo', 'src'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clonesMatch — case sensitivity
// ---------------------------------------------------------------------------

describe('clonesMatch() — case sensitivity', () => {
  it('CM.7 treats paths as case-insensitive on win32 and darwin', () => {
    scaffold('CasedRepo');
    // On win32/darwin: upper-cased cwd should match lower-cased clone because normCase
    // folds both to lowercase before comparison. On linux: case-sensitive, they differ.
    const result = clonesMatch(dir('CasedRepo').toUpperCase(), dir('casedrepo'));
    if (process.platform === 'win32' || process.platform === 'darwin') {
      expect(result).toBe(true);   // case-insensitive: differently-cased paths resolve to same location
    } else {
      expect(result).toBe(false);  // case-sensitive on linux: uppercase/lowercase paths are distinct
    }
  });

  it('CM.8 exact match is case-sensitive on linux', () => {
    if (process.platform !== 'linux') return;
    scaffold('MyRepo', 'myrepo');
    // On Linux: 'MyRepo' !== 'myrepo'
    expect(clonesMatch(dir('myrepo'), dir('MyRepo'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clonesMatch — symlink realpath
// ---------------------------------------------------------------------------

describe('clonesMatch() — symlink realpath containment', () => {
  it('CM.9 returns true when cwd is symlink to a directory inside clone', () => {
    scaffold('repo/src');
    const linkPath = dir('repo-src-link');
    try {
      symlinkSync(dir('repo', 'src'), linkPath, 'junction');
    } catch {
      // Skip on platforms where symlinks are restricted.
      return;
    }
    expect(clonesMatch(linkPath, dir('repo'))).toBe(true);
  });

  it('CM.10 returns true when clone itself is a symlink', () => {
    scaffold('actual-repo/src');
    const linkedClone = dir('linked-clone');
    try {
      symlinkSync(dir('actual-repo'), linkedClone, 'junction');
    } catch {
      return;
    }
    // cwd is inside actual-repo; clone is a symlink to actual-repo
    expect(clonesMatch(dir('actual-repo', 'src'), linkedClone)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clonesMatch — relative path rejection
// ---------------------------------------------------------------------------

describe('clonesMatch() — relative path rejection', () => {
  it('CM.11 throws SquadError with INVALID_CLONE_ENTRY for relative clone path', () => {
    scaffold('repo');
    const err = catchSquadError(() => clonesMatch(dir('repo'), './relative/path'));
    expect(errorCode(err)).toBe('INVALID_CLONE_ENTRY');
  });

  it('CM.12 throws for bare directory name without path separator', () => {
    scaffold('repo');
    const err = catchSquadError(() => clonesMatch(dir('repo'), 'just-a-name'));
    expect(errorCode(err)).toBe('INVALID_CLONE_ENTRY');
  });
});

// ---------------------------------------------------------------------------
// clonesMatch — separator normalization
// ---------------------------------------------------------------------------

describe('clonesMatch() — separator normalization', () => {
  it('CM.13 normalizes trailing separator on cwd before comparing', () => {
    scaffold('repo');
    // path.resolve strips trailing separators on both sides before comparison
    expect(clonesMatch(dir('repo') + sep, dir('repo'))).toBe(true);
    expect(clonesMatch(dir('repo'), dir('repo') + sep)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalisedPathKey
// ---------------------------------------------------------------------------

describe('normalisedPathKey()', () => {
  it('PK.1 returns the same key for the same path', () => {
    scaffold('some-dir');
    expect(normalisedPathKey(dir('some-dir'))).toBe(normalisedPathKey(dir('some-dir')));
  });

  it('PK.2 returns different keys for different paths', () => {
    scaffold('dir-a', 'dir-b');
    expect(normalisedPathKey(dir('dir-a'))).not.toBe(normalisedPathKey(dir('dir-b')));
  });

  it('PK.3 resolves relative segments so equivalent paths produce the same key', () => {
    scaffold('base/sub');
    const canonical = dir('base', 'sub');
    const withDotDot = join(dir('base', 'sub'), '..', 'sub');
    expect(normalisedPathKey(canonical)).toBe(normalisedPathKey(withDotDot));
  });

  it('PK.4 produces a lowercase key on win32 and darwin (case-insensitive platforms)', () => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    scaffold('SomePath');
    const key = normalisedPathKey(dir('SomePath'));
    expect(key).toBe(key.toLowerCase());
  });

  it('PK.5 produces keys with different casing on linux (case-sensitive)', () => {
    if (process.platform !== 'linux') return;
    scaffold('LowerPath', 'lowerpath');
    expect(normalisedPathKey(dir('LowerPath'))).not.toBe(normalisedPathKey(dir('lowerpath')));
  });

  it('PK.6 same mixed-case path always produces the same key regardless of input case on win32/darwin', () => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    scaffold('CasedDir');
    const upper = normalisedPathKey(dir('CasedDir').toUpperCase());
    const lower = normalisedPathKey(dir('CasedDir').toLowerCase());
    expect(upper).toBe(lower);
  });
});
