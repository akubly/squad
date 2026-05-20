/**
 * Tests for the squad assign CLI argument parser.
 *
 * Verifies that both `--flag value` and `--flag=value` forms are handled
 * for all named assign options.
 *
 * @module commands/__tests__/assign-args.test
 */

import { describe, it, expect } from 'vitest';
import { argValue, parseAssignArgs, parseUnassignArgs } from '../assign-args.js';

describe('argValue', () => {
  it('returns the next token for --flag value form', () => {
    expect(argValue(['--clone-to', './path'], '--clone-to')).toBe('./path');
  });

  it('returns the suffix for --flag=value form', () => {
    expect(argValue(['--clone-to=./path'], '--clone-to')).toBe('./path');
  });

  it('prefers --flag=value over --flag value when both present', () => {
    // The = form is checked first via find, so it wins.
    expect(argValue(['--clone-to=eq-val', '--clone-to', 'space-val'], '--clone-to')).toBe('eq-val');
  });

  it('returns undefined when flag is absent', () => {
    expect(argValue(['--other', 'val'], '--clone-to')).toBeUndefined();
  });

  it('handles empty value in --flag= form', () => {
    expect(argValue(['--clone-to='], '--clone-to')).toBe('');
  });

  it('handles values containing = in --flag=value form', () => {
    // e.g. --registry-path=./dir/reg.json
    expect(argValue(['--registry-path=./dir/reg.json'], '--registry-path')).toBe('./dir/reg.json');
  });
});

describe('parseAssignArgs', () => {
  it('parses positional callsign-or-URL as the first non-flag token', () => {
    const result = parseAssignArgs(['alpha']);
    expect(result.callsignOrUrl).toBe('alpha');
  });

  it('skips flag value tokens when finding the positional argument', () => {
    // --clone-to ./dest comes first; ./dest is a flag value, not the positional.
    const result = parseAssignArgs(['--clone-to', './dest', 'https://github.com/example/squad.git']);
    expect(result.callsignOrUrl).toBe('https://github.com/example/squad.git');
    expect(result.cloneTo).toBe('./dest');
  });

  it('parses --clone-to in space-separated form', () => {
    const result = parseAssignArgs(['alpha', '--clone-to', './my-squad']);
    expect(result.cloneTo).toBe('./my-squad');
  });

  it('parses --clone-to in equals-delimited form', () => {
    const result = parseAssignArgs(['alpha', '--clone-to=./my-squad']);
    expect(result.cloneTo).toBe('./my-squad');
  });

  it('parses --callsign in space-separated form', () => {
    const result = parseAssignArgs(['https://github.com/example/squad.git', '--callsign', 'custom']);
    expect(result.callsign).toBe('custom');
  });

  it('parses --callsign in equals-delimited form', () => {
    const result = parseAssignArgs(['https://github.com/example/squad.git', '--callsign=custom']);
    expect(result.callsign).toBe('custom');
  });

  it('parses --registry-path in space-separated form', () => {
    const result = parseAssignArgs(['alpha', '--registry-path', '/abs/path/registry.json']);
    expect(result.registryPath).toBe('/abs/path/registry.json');
  });

  it('parses --registry-path in equals-delimited form', () => {
    const result = parseAssignArgs(['alpha', '--registry-path=/abs/path/registry.json']);
    expect(result.registryPath).toBe('/abs/path/registry.json');
  });

  it('parses --target-dir in space-separated form', () => {
    const result = parseAssignArgs(['alpha', '--target-dir', './product']);
    expect(result.targetDir).toBe('./product');
  });

  it('parses --target-dir in equals-delimited form', () => {
    const result = parseAssignArgs(['alpha', '--target-dir=./product']);
    expect(result.targetDir).toBe('./product');
  });

  it('returns all undefined for empty args', () => {
    const result = parseAssignArgs([]);
    expect(result.callsignOrUrl).toBeUndefined();
    expect(result.cloneTo).toBeUndefined();
    expect(result.callsign).toBeUndefined();
    expect(result.registryPath).toBeUndefined();
    expect(result.targetDir).toBeUndefined();
  });

  it('handles mixed = and space forms for different flags', () => {
    const result = parseAssignArgs([
      'https://github.com/example/squad.git',
      '--clone-to=./dest',
      '--callsign',
      'my-squad',
    ]);
    expect(result.callsignOrUrl).toBe('https://github.com/example/squad.git');
    expect(result.cloneTo).toBe('./dest');
    expect(result.callsign).toBe('my-squad');
  });

  it('does not treat the command token as the positional argument (regression)', () => {
    // cli-entry.ts must call parseAssignArgs(args.slice(1)) so the 'assign'
    // command token is stripped before the parser sees it. This test verifies
    // the parser correctly identifies the positional arg from pre-sliced input.
    const sliced = ['my-callsign', '--clone-to', './dest']; // args.slice(1)
    const result = parseAssignArgs(sliced);
    expect(result.callsignOrUrl).toBe('my-callsign');
    expect(result.cloneTo).toBe('./dest');

    // Demonstrates the bug if args are NOT sliced: the command token becomes callsignOrUrl
    const unsliced = ['assign', 'my-callsign', '--clone-to', './dest'];
    const buggy = parseAssignArgs(unsliced);
    expect(buggy.callsignOrUrl).toBe('assign'); // proves why slice is required
  });
});

describe('parseUnassignArgs', () => {
  it('UA1 parses --callsign=alpha form (equals-delimited)', () => {
    const result = parseUnassignArgs(['--callsign=alpha']);
    expect(result.callsign).toBe('alpha');
  });

  it('UA2 parses --callsign alpha form (space-separated)', () => {
    const result = parseUnassignArgs(['--callsign', 'alpha']);
    expect(result.callsign).toBe('alpha');
  });

  it('UA3 parses --registry-path=/some/path form (equals-delimited)', () => {
    const result = parseUnassignArgs(['--registry-path=/some/path/registry.json']);
    expect(result.registryPath).toBe('/some/path/registry.json');
  });

  it('UA4 parses --registry-path /some/path form (space-separated)', () => {
    const result = parseUnassignArgs(['--registry-path', '/some/path/registry.json']);
    expect(result.registryPath).toBe('/some/path/registry.json');
  });

  it('UA5 parses --target-dir in equals-delimited form', () => {
    const result = parseUnassignArgs(['--target-dir=./product']);
    expect(result.targetDir).toBe('./product');
  });

  it('UA6 handles multiple flags together', () => {
    const result = parseUnassignArgs(['--callsign=alpha', '--registry-path=/some/path']);
    expect(result.callsign).toBe('alpha');
    expect(result.registryPath).toBe('/some/path');
  });

  it('UA7 returns all undefined for empty args', () => {
    const result = parseUnassignArgs([]);
    expect(result.callsign).toBeUndefined();
    expect(result.registryPath).toBeUndefined();
    expect(result.targetDir).toBeUndefined();
  });

  it('ignores command token when args are pre-sliced (regression)', () => {
    // cli-entry.ts must pass args.slice(1) so 'unassign' is stripped.
    const withCommand = ['unassign', '--callsign', 'alpha'];
    const sliced = withCommand.slice(1);
    const result = parseUnassignArgs(sliced);
    expect(result.callsign).toBe('alpha');
  });
});
