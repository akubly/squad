import { describe, it, expect } from 'vitest';
import { INBOX_HANDLE_RE } from '../../packages/squad-sdk/src/validation.js';

describe('INBOX_HANDLE_RE', () => {
  it('P32.V1 matches valid handle: dev1', () => {
    expect(INBOX_HANDLE_RE.test('dev1')).toBe(true);
  });

  it('P32.V2 matches valid handle: alice-2', () => {
    expect(INBOX_HANDLE_RE.test('alice-2')).toBe(true);
  });

  it('P32.V3 matches valid handle: a1', () => {
    expect(INBOX_HANDLE_RE.test('a1')).toBe(true);
  });

  it('P32.V4 matches valid handle: a + b.repeat(38)', () => {
    expect(INBOX_HANDLE_RE.test('a' + 'b'.repeat(38))).toBe(true);
  });

  it('P32.V5 rejects empty string', () => {
    expect(INBOX_HANDLE_RE.test('')).toBe(false);
  });

  it('P32.V6 rejects handle starting with digit: 1abc', () => {
    expect(INBOX_HANDLE_RE.test('1abc')).toBe(false);
  });

  it('P32.V7 rejects uppercase: ABC', () => {
    expect(INBOX_HANDLE_RE.test('ABC')).toBe(false);
  });

  it('P32.V8 rejects handle starting with hyphen: -abc', () => {
    expect(INBOX_HANDLE_RE.test('-abc')).toBe(false);
  });

  it('P32.V9 rejects handle of 40 chars (too long): a + b.repeat(39)', () => {
    expect(INBOX_HANDLE_RE.test('a' + 'b'.repeat(39))).toBe(false);
  });

  it('P32.V10 rejects underscore: abc_def', () => {
    expect(INBOX_HANDLE_RE.test('abc_def')).toBe(false);
  });

  // P32.V11 — spec-faithful behaviour for piece 32: the regex /^[a-z][a-z0-9-]{1,38}$/
  // accepts trailing hyphens and consecutive hyphens because the spec does not
  // prohibit them. Tightening is deferred to piece 33.
  it('P32.V11 accepts trailing hyphen and consecutive hyphens (spec-faithful, tightening deferred to piece 33)', () => {
    expect(INBOX_HANDLE_RE.test('ab-')).toBe(true);
    expect(INBOX_HANDLE_RE.test('a--b')).toBe(true);
  });
});
