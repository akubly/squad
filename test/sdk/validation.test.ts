import { describe, it, expect } from 'vitest';
import { DEVELOPER_ALIAS_RE } from '../../packages/squad-sdk/src/validation.js';

describe('DEVELOPER_ALIAS_RE', () => {
  it('P32.V1 matches valid alias: dev1', () => {
    expect(DEVELOPER_ALIAS_RE.test('dev1')).toBe(true);
  });

  it('P32.V2 matches valid alias: alice-2', () => {
    expect(DEVELOPER_ALIAS_RE.test('alice-2')).toBe(true);
  });

  it('P32.V3 matches valid alias: a1', () => {
    expect(DEVELOPER_ALIAS_RE.test('a1')).toBe(true);
  });

  it('P32.V4 matches valid alias: a + b.repeat(38)', () => {
    expect(DEVELOPER_ALIAS_RE.test('a' + 'b'.repeat(38))).toBe(true);
  });

  it('P32.V5 rejects empty string', () => {
    expect(DEVELOPER_ALIAS_RE.test('')).toBe(false);
  });

  it('P32.V6 rejects alias starting with digit: 1abc', () => {
    expect(DEVELOPER_ALIAS_RE.test('1abc')).toBe(false);
  });

  it('P32.V7 rejects uppercase: ABC', () => {
    expect(DEVELOPER_ALIAS_RE.test('ABC')).toBe(false);
  });

  it('P32.V8 rejects alias starting with hyphen: -abc', () => {
    expect(DEVELOPER_ALIAS_RE.test('-abc')).toBe(false);
  });

  it('P32.V9 rejects alias of 40 chars (too long): a + b.repeat(39)', () => {
    expect(DEVELOPER_ALIAS_RE.test('a' + 'b'.repeat(39))).toBe(false);
  });

  it('P32.V10 rejects underscore: abc_def', () => {
    expect(DEVELOPER_ALIAS_RE.test('abc_def')).toBe(false);
  });

  // P32.V11 — spec-faithful behaviour for piece 32: the regex /^[a-z][a-z0-9-]{1,38}$/
  // accepts trailing hyphens and consecutive hyphens because the spec does not
  // prohibit them. Tightening is deferred to piece 33.
  it('P32.V11 accepts trailing hyphen and consecutive hyphens (spec-faithful, tightening deferred to piece 33)', () => {
    expect(DEVELOPER_ALIAS_RE.test('ab-')).toBe(true);
    expect(DEVELOPER_ALIAS_RE.test('a--b')).toBe(true);
  });
});
