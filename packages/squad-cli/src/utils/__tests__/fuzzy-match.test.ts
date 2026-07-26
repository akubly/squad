/**
 * Unit tests for the fuzzy-match utility.
 *
 * @module utils/__tests__/fuzzy-match.test
 */

import { describe, it, expect } from 'vitest';
import { levenshteinDistance, suggestSimilar } from '../fuzzy-match.js';

// ── levenshteinDistance ────────────────────────────────────────────────────

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings (exact match)', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('counts a single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('counts a single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('counts a single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('returns the length of b when a is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('returns the length of a when b is empty', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('is symmetric — distance(a,b) === distance(b,a)', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(
      levenshteinDistance('sitting', 'kitten'),
    );
  });

  it('is case-sensitive — differently cased strings are not distance 0', () => {
    expect(levenshteinDistance('Hello', 'hello')).toBeGreaterThan(0);
  });

  it('handles accented characters without throwing', () => {
    expect(() => levenshteinDistance('café', 'cafe')).not.toThrow();
    expect(levenshteinDistance('café', 'café')).toBe(0);
  });

  it('handles emoji without throwing', () => {
    expect(() => levenshteinDistance('hi 🎉', 'hi')).not.toThrow();
  });
});

// ── suggestSimilar ─────────────────────────────────────────────────────────

describe('suggestSimilar', () => {
  it('returns the candidate when needle is an exact match', () => {
    expect(suggestSimilar('init', ['init', 'list', 'assign'])).toBe('init');
  });

  it('returns the closest candidate for a one-character typo', () => {
    expect(suggestSimilar('inti', ['init', 'list', 'assign'])).toBe('init');
  });

  it('returns the candidate at distance 2 (default threshold)', () => {
    // 'listxx' → 'list': 2 insertions, distance exactly 2
    expect(suggestSimilar('listxx', ['init', 'list', 'assign'])).toBe('list');
  });

  it('returns null when distance exceeds the default threshold of 2', () => {
    // 'xyz' → 'init' distance > 2
    expect(suggestSimilar('xyz', ['init', 'list', 'assign'])).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(suggestSimilar('init', [])).toBeNull();
  });

  it('returns null for empty needle when no candidate is within threshold', () => {
    // '' → 'assign' distance = 6, well above default 2
    expect(suggestSimilar('', ['assign', 'deploy'])).toBeNull();
  });

  it('returns the candidate when empty needle and candidate is within explicit threshold', () => {
    // '' → 'ab' distance = 2, within explicit threshold 2
    expect(suggestSimilar('', ['ab'], 2)).toBe('ab');
  });

  it('stable tie-breaking — first candidate in input order wins', () => {
    // Both 'bat' and 'hat' are distance 1 from 'cat'
    expect(suggestSimilar('cat', ['bat', 'hat'])).toBe('bat');
    // Reverse order — 'hat' should win
    expect(suggestSimilar('cat', ['hat', 'bat'])).toBe('hat');
  });

  it('is case-sensitive — differently cased match is not distance 0', () => {
    // 'Init' ≠ 'init', distance = 1 (still within threshold, but not 0)
    const result = suggestSimilar('Init', ['init', 'list']);
    // It will return 'init' (distance 1) but should NOT return it as if it were an exact match
    expect(result).toBe('init');
    expect(levenshteinDistance('Init', 'init')).toBeGreaterThan(0);
  });

  it('handles accented characters without throwing', () => {
    expect(() => suggestSimilar('café', ['cafe', 'coffee'])).not.toThrow();
  });

  it('handles emoji without throwing', () => {
    expect(() => suggestSimilar('hi 🎉', ['hi', 'hey'])).not.toThrow();
  });

  it('respects a custom threshold wider than the default', () => {
    // 'assign' → 'unassign' distance = 2 (prefix un + assign); let's use a clear > 2 case
    // 'deploy' → 'deployer' distance = 2; 'xyz' → 'xyzabc' distance = 3
    expect(suggestSimilar('xyz', ['xyzabc'], 3)).toBe('xyzabc');
    expect(suggestSimilar('xyz', ['xyzabc'], 2)).toBeNull();
  });

  it('returns null when all candidates are beyond the explicit custom threshold', () => {
    expect(suggestSimilar('abc', ['xyz'], 1)).toBeNull();
  });

  it('accepts a distance-exactly-2 needle at maxDistance 2, rejects it at maxDistance 1 (inclusive-boundary)', () => {
    // 'listxx' → 'list': distance exactly 2 — pins the <= acceptance boundary
    expect(levenshteinDistance('listxx', 'list')).toBe(2);
    expect(suggestSimilar('listxx', ['list'], 2)).toBe('list');
    expect(suggestSimilar('listxx', ['list'], 1)).toBeNull();
  });
});
