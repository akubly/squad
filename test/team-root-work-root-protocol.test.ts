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

// ---------------------------------------------------------------------------
// 5. M1 — Five-variable contract in ALL spawn variants
//    Every spawn pattern (full, lightweight, Scribe, explore) must carry
//    the five mandatory variables with consistent underscore-colon format.
// ---------------------------------------------------------------------------

const FIVE_VARIABLES = ['TEAM_ROOT', 'WORK_ROOT', 'STATE_REMOTE', 'STATE_BRANCH', 'DEVELOPER_ALIAS'] as const;

describe('M1: five-variable contract propagated to all spawn variants', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    describe(loc, () => {
      const content = readTemplate(loc);

      it('full spawn template carries all five variables', () => {
        // The full spawn template is the "Template for any agent" block
        const fullSpawnMatch = content.match(/Template for any agent[\s\S]*?```([\s\S]*?)```/);
        expect(fullSpawnMatch).not.toBeNull();
        const fullSpawn = fullSpawnMatch![1];
        for (const v of FIVE_VARIABLES) {
          expect(fullSpawn).toContain(v);
        }
      });

      it('lightweight spawn template carries all five variables', () => {
        // The lightweight spawn template is the "Lightweight Spawn Template" block
        const lightMatch = content.match(/Lightweight Spawn Template[\s\S]*?```([\s\S]*?)```/);
        expect(lightMatch).not.toBeNull();
        const lightSpawn = lightMatch![1];
        for (const v of FIVE_VARIABLES) {
          expect(lightSpawn).toContain(v);
        }
      });

      it('Scribe spawn template carries all five variables', () => {
        // The Scribe spawn template includes "You are the Scribe"
        const scribeMatch = content.match(/You are the Scribe[\s\S]*?```/);
        expect(scribeMatch).not.toBeNull();
        const scribeSpawn = scribeMatch![0];
        for (const v of FIVE_VARIABLES) {
          expect(scribeSpawn).toContain(v);
        }
      });

      it('explore agent spawn pattern carries all five variables', () => {
        // The explore agent pattern line contains the prompt in the second backtick section
        const exploreLine = content.split('\n').find(l => /[Ff]or read-only queries.*explore/.test(l));
        expect(exploreLine).toBeDefined();
        for (const v of FIVE_VARIABLES) {
          expect(exploreLine).toContain(v);
        }
      });

      it('explore agent uses underscored key format (no "TEAM ROOT" with space)', () => {
        const exploreLine = content.split('\n').find(l => /[Ff]or read-only queries.*explore/.test(l));
        expect(exploreLine).toBeDefined();
        expect(exploreLine).not.toMatch(/TEAM ROOT[^_]/);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 6. M2 — WORK_ROOT resolution procedure documented
//    The Working Directory Model section must contain resolution guidance
//    referencing loadDirConfig, teamRoot field, and single-repo fallback.
// ---------------------------------------------------------------------------

describe('M2: WORK_ROOT resolution procedure documented', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    describe(loc, () => {
      const content = readTemplate(loc);

      it('contains a WORK_ROOT resolution subsection or paragraph', () => {
        expect(content).toMatch(/WORK_ROOT resolution|Resolution procedure/i);
      });

      it('references loadDirConfig as the resolution mechanism', () => {
        expect(content).toContain('loadDirConfig');
      });

      it('references the teamRoot field in config.json', () => {
        // The config.json field is teamRoot (not workRoot)
        expect(content).toMatch(/teamRoot.*config\.json|config\.json.*teamRoot/s);
      });

      it('documents fallback to TEAM_ROOT == WORK_ROOT when config absent', () => {
        expect(content).toMatch(/fall\s*back.*TEAM_ROOT\s*==?\s*WORK_ROOT|TEAM_ROOT\s*==?\s*WORK_ROOT.*fall\s*back|absent.*TEAM_ROOT.*equals.*WORK_ROOT/is);
      });

      it('states teamRoot is resolved relative to WORK_ROOT', () => {
        expect(content).toMatch(/resolve[ds]?\s+(the\s+)?`?teamRoot`?\s+(field\s+)?relative to\s+`?WORK_ROOT`?/i);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 7. M3 — Single-repo degenerate case documented
//    A callout must explain the TEAM_ROOT == WORK_ROOT collapse case.
// ---------------------------------------------------------------------------

describe('M3: single-repo degenerate case documented', () => {
  for (const loc of SQUAD_AGENT_LOCATIONS) {
    describe(loc, () => {
      const content = readTemplate(loc);

      it('contains a single-repo case callout', () => {
        expect(content).toMatch(/[Ss]ingle.repo case/);
      });

      it('mentions TEAM_ROOT == WORK_ROOT path collapse', () => {
        expect(content).toMatch(/TEAM_ROOT\s*==\s*WORK_ROOT/);
      });

      it('states coordinator must still pass both variables even when equal', () => {
        expect(content).toMatch(/[Mm][Uu][Ss][Tt]\s+still\s+pass\s+both/i);
      });
    });
  }
});
