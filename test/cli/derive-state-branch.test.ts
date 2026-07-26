/**
 * Piece 46 — D: deriveStateBranch invalid-callsign coverage.
 *
 * deriveStateBranch(stateBranch, callsign):
 *   - an explicit stateBranch wins verbatim;
 *   - else a valid callsign (CALLSIGN_RE) derives squad/state/<callsign>;
 *   - else the flat legacy `squad-state` branch.
 *
 * This pins the flat fallback for every invalid callsign shape. deriveStateBranch is
 * unchanged by this piece — this is coverage only.
 */

import { describe, it, expect } from 'vitest';
import { deriveStateBranch } from '../../packages/squad-cli/src/cli/commands/sync.js';

describe('piece 46 — deriveStateBranch invalid-callsign fallback', () => {
  const invalidCallsigns: Array<[string, string]> = [
    ['uppercase', 'Foo'],
    ['underscore', 'foo_bar'],
    ['dot', 'foo.bar'],
    ['leading-digit', '1foo'],
    ['over-length', 'a'.repeat(40)],
  ];

  for (const [label, callsign] of invalidCallsigns) {
    it(`returns the flat squad-state fallback for an invalid callsign (${label})`, () => {
      expect(deriveStateBranch(undefined, callsign)).toBe('squad-state');
    });
  }

  it('positive control: a valid callsign derives squad/state/<callsign>', () => {
    expect(deriveStateBranch(undefined, 'acme')).toBe('squad/state/acme');
  });

  it('positive control: a valid 39-char callsign (boundary) derives the namespaced branch', () => {
    const callsign = 'a' + 'b'.repeat(38); // 39 chars, max valid
    expect(deriveStateBranch(undefined, callsign)).toBe(`squad/state/${callsign}`);
  });

  it('positive control: an explicit stateBranch wins verbatim over a valid callsign', () => {
    expect(deriveStateBranch('custom/state-branch', 'acme')).toBe('custom/state-branch');
  });

  it('positive control: an explicit stateBranch wins even when the callsign is invalid', () => {
    expect(deriveStateBranch('custom/state-branch', 'Foo')).toBe('custom/state-branch');
  });

  it('no stateBranch and no callsign falls back to flat squad-state', () => {
    expect(deriveStateBranch(undefined, undefined)).toBe('squad-state');
  });
});
