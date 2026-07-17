/**
 * Piece 55 — E: deterministic hands-off freshness sync lives in the coordinator session-start hook
 * of the canonical `squad.agent.md`, is mirrored byte-identically, and does NOT alter the durable
 * Scribe charter.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const CANONICAL = path.join(ROOT, '.squad-templates', 'squad.agent.md');
const MIRRORS = [
  path.join(ROOT, 'packages', 'squad-cli', 'templates', 'squad.agent.md.template'),
  path.join(ROOT, 'packages', 'squad-sdk', 'templates', 'squad.agent.md.template'),
  path.join(ROOT, 'templates', 'squad.agent.md.template'),
  path.join(ROOT, '.github', 'agents', 'squad.agent.md'),
];

function sha(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

describe('piece 55 — E: managed-host freshness sync in the session-start hook', () => {
  it('E1 the canonical template gates the managed pull on managed:true + the H2 sentinel-age window', () => {
    const text = fs.readFileSync(CANONICAL, 'utf-8');
    expect(text).toMatch(/managed: true/);
    expect(text).toMatch(/squad sync --pull/);
    expect(text).toMatch(/\.last-hydrate-sha/);
    expect(text).toMatch(/SQUAD_MANAGED_FRESH_WINDOW/);
  });

  it('E2 the inlined Scribe commit block gains an optional managed pull-before-push', () => {
    const text = fs.readFileSync(CANONICAL, 'utf-8');
    expect(text).toMatch(/Pull-before-push \(managed hosts\)/);
  });

  it('FIX6 the managed pull-before-push targets the namespaced state ref, not the legacy squad-state branch', () => {
    const text = fs.readFileSync(CANONICAL, 'utf-8');
    const line = text.split('\n').find(l => /Pull-before-push \(managed hosts\)/.test(l));
    expect(line).toBeDefined();
    // The managed freshness ref is squad/state/<callsign>; the legacy local-orphan `squad-state`
    // branch name must not be the fallback offered to managed hosts.
    expect(line!).toMatch(/squad\/state\/<callsign>/);
    expect(line!).not.toMatch(/`squad-state` ref/);
  });

  it('E3 all rendered coordinator copies stay byte-identical to the canonical template', () => {
    const expected = sha(CANONICAL);
    for (const mirror of MIRRORS) {
      expect(sha(mirror), `mirror out of sync: ${mirror}`).toBe(expected);
    }
  });

  it('E4 the durable Scribe charter is untouched (no freshness-sync language)', () => {
    const charter = fs.readFileSync(path.join(ROOT, '.squad', 'agents', 'scribe', 'charter.md'), 'utf-8');
    expect(charter).not.toMatch(/SQUAD_MANAGED_FRESH_WINDOW/);
    expect(charter).not.toMatch(/managed-host freshness/i);
  });
});
