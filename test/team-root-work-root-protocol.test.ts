/**
 * Team-root / work-root protocol tests — piece 29.
 *
 * Asserts that the canonical coordinator template and all four mirror copies
 * contain the four-path table, write rules, and spawn-prompt contract
 * introduced by piece 29.
 *
 * All assertions are lightweight substring / structural presence checks —
 * we verify required phrases are present, not byte-for-byte paragraph shape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readTemplate(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// All five copies of the coordinator template that must carry the protocol.
// ---------------------------------------------------------------------------

const SQUAD_AGENT_LOCATIONS = [
  '.squad-templates/squad.agent.md',
  'templates/squad.agent.md.template',
  '.github/agents/squad.agent.md',
  'packages/squad-cli/templates/squad.agent.md.template',
  'packages/squad-sdk/templates/squad.agent.md.template',
] as const;

// ---------------------------------------------------------------------------
// 1. Four-path table — all four variables must be defined
// ---------------------------------------------------------------------------

describe('four-path table: all variables defined', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    describe(loc, () => {
      const content = readTemplate(loc);

      it('defines TEAM_ROOT', () => {
        expect(content).toContain('TEAM_ROOT');
      });

      it('defines TEAM_SQUAD_DIR', () => {
        expect(content).toContain('TEAM_SQUAD_DIR');
      });

      it('defines WORK_ROOT', () => {
        expect(content).toContain('WORK_ROOT');
      });

      it('defines WORK_SQUAD_DIR', () => {
        expect(content).toContain('WORK_SQUAD_DIR');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Write rules — five rules must all be present in every copy
// ---------------------------------------------------------------------------

describe('write rules: all five present', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    describe(loc, () => {
      const content = readTemplate(loc);

      it('rule 1 — Scribe writes only to TEAM_SQUAD_DIR', () => {
        expect(content).toMatch(/Scribe writes only to `?TEAM_SQUAD_DIR`?/);
      });

      it('rule 2 — directive capture writes only to TEAM_SQUAD_DIR', () => {
        // Matches "Directive capture writes only to" (case-insensitive first word)
        expect(content).toMatch(/[Dd]irective capture writes only to `?TEAM_SQUAD_DIR`?/);
      });

      it('rule 3 — non-Scribe agents must not write under WORK_SQUAD_DIR', () => {
        expect(content).toMatch(/[Nn]on-Scribe agents must not (create or modify|write).*WORK_SQUAD_DIR/);
      });

      it('rule 4 — product git operations run against WORK_ROOT', () => {
        expect(content).toMatch(/[Pp]roduct git operations.*WORK_ROOT/s);
      });

      it('rule 5 — state publication via squad sync against STATE_REMOTE', () => {
        expect(content).toMatch(/squad sync.*STATE_REMOTE|STATE_REMOTE.*squad sync/s);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Spawn-prompt contract — five named variables in the required order
// ---------------------------------------------------------------------------

describe('spawn-prompt contract: five variables in order', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    it(`${loc} contains all five spawn-contract variables`, () => {
      const content = readTemplate(loc);

      // All five must be present
      expect(content).toContain('TEAM_ROOT');
      expect(content).toContain('WORK_ROOT');
      expect(content).toContain('STATE_REMOTE');
      expect(content).toContain('STATE_BRANCH');
      expect(content).toContain('DEVELOPER_ALIAS');
    });

    it(`${loc} spawn contract lists TEAM_ROOT before WORK_ROOT`, () => {
      const content = readTemplate(loc);
      const teamRootIdx = content.indexOf('TEAM_ROOT:');
      const workRootIdx = content.indexOf('WORK_ROOT:');
      expect(teamRootIdx).toBeGreaterThan(-1);
      expect(workRootIdx).toBeGreaterThan(-1);
      expect(teamRootIdx).toBeLessThan(workRootIdx);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. WORK_SQUAD_DIR write-permission guard — no sentence grants write access
//    to WORK_SQUAD_DIR for non-Scribe agents
// ---------------------------------------------------------------------------

describe('WORK_SQUAD_DIR write-permission guard', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    it(`${loc} does not grant non-Scribe write access to WORK_SQUAD_DIR`, () => {
      const content = readTemplate(loc);
      // Should NOT contain any phrasing that grants write permission to WORK_SQUAD_DIR
      // for agents other than Scribe. The only acceptable pattern is the write rule
      // that prohibits it. Check that no "write to WORK_SQUAD_DIR" appears outside
      // a prohibition context.
      const grantPattern = /(?<!never|must not|not create or modify|prohibited|do not)\s+write to `?WORK_SQUAD_DIR`?/i;
      expect(content).not.toMatch(grantPattern);
    });
  }
});
