/**
 * Template sync tests — ensures all template directories stay in sync.
 *
 * Canonical source: .squad-templates/
 * Mirror targets:   templates/, packages/squad-cli/templates/, packages/squad-sdk/templates/
 * Special target:   .github/agents/ (squad.agent.md only)
 *
 * Coverage strategy:
 *   1. Pre-sync parity gate — sync must not rewrite tracked mirror files.
 *   2. Dynamic enumeration — every file in .squad-templates/ must be byte-for-byte
 *      identical across all mirror targets (and .github/agents/ for squad.agent.md).
 *   3. Script execution — `node scripts/sync-templates.mjs` must exit 0.
 *   4. Negative guard — .github/agents/ must not contain stray synced files.
 *   5. Semantic checks — universe counts, casting-policy internal consistency.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let mirrorFilesChangedBySync: string[] = [];

beforeAll(() => {
  const beforeSync = snapshotMirrorHashes(TRACKED_MIRROR_FILES);

  runSyncTemplates();

  const afterSync = snapshotMirrorHashes(TRACKED_MIRROR_FILES);
  mirrorFilesChangedBySync = TRACKED_MIRROR_FILES.filter(
    (relPath) => beforeSync.get(relPath) !== afterSync.get(relPath)
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relPath: string, baseDir = ROOT): string {
  return readFileSync(resolve(baseDir, relPath), 'utf-8');
}

function readFileBytes(relPath: string, baseDir = ROOT): Buffer {
  return readFileSync(resolve(baseDir, relPath));
}

function fileExists(relPath: string, baseDir = ROOT): boolean {
  return existsSync(resolve(baseDir, relPath));
}

function hashFile(relPath: string): string | null {
  if (!fileExists(relPath)) {
    return null;
  }

  return createHash('sha256').update(readFileBytes(relPath)).digest('hex');
}

/** Recursively collect all file paths relative to `dir`. */
function collectFiles(dir: string, base = ''): string[] {
  const entries = readdirSync(resolve(ROOT, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = base ? join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

/** Extract the universe count from a squad.agent.md file (anchored to list item). */
function extractUniverseCount(content: string): number | null {
  const m = content.match(/^-\s+(\d+)\s+universes?\s+available/im);
  return m ? Number(m[1]) : null;
}

/** Parse casting-policy.json and return universe names from the allowlist. */
function parsePolicyUniverses(relPath: string): string[] {
  const json = JSON.parse(readFile(relPath));
  return json.allowlist_universes as string[];
}

/** Parse casting-policy.json and return the capacity map. */
function parsePolicyCapacity(relPath: string): Record<string, number> {
  const json = JSON.parse(readFile(relPath));
  return json.universe_capacity as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_DIR = '.squad-templates';

const MIRROR_TARGETS = [
  'templates',
  'packages/squad-cli/templates',
  'packages/squad-sdk/templates',
] as const;

const AGENT_MD_FILE = 'squad.agent.md';
const AGENT_MD_EXTRA_TARGET = '.github/agents';

const SQUAD_AGENT_LOCATIONS = [
  `${SOURCE_DIR}/${AGENT_MD_FILE}`,
  'templates/squad.agent.md.template',
  '.github/agents/squad.agent.md',
  'packages/squad-cli/templates/squad.agent.md.template',
  'packages/squad-sdk/templates/squad.agent.md.template',
] as const;

function getMirrorTargets(relFile: string): string[] {
  const targets = MIRROR_TARGETS.map((target) => {
    const destName = relFile === AGENT_MD_FILE ? `${AGENT_MD_FILE}.template` : relFile;
    return `${target}/${destName}`;
  });

  if (relFile === AGENT_MD_FILE) {
    targets.push(`${AGENT_MD_EXTRA_TARGET}/${AGENT_MD_FILE}`);
  }

  return targets;
}

const TRACKED_MIRROR_FILES = collectFiles(SOURCE_DIR).flatMap((relFile) => getMirrorTargets(relFile));

function snapshotMirrorHashes(relPaths: readonly string[]): Map<string, string | null> {
  return new Map(relPaths.map((relPath) => [relPath, hashFile(relPath)]));
}

function runSyncTemplates(cwd = ROOT): string {
  return execSync('node scripts/sync-templates.mjs', {
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

const SYNC_SANDBOX_TARGET_DIRS = [
  'templates',
  '.github/agents',
  'packages/squad-cli/templates',
  'packages/squad-sdk/templates',
] as const;

function withSyncSandbox(name: string, callback: (sandboxRoot: string) => void): void {
  const sandboxRoot = join(
    ROOT,
    'test',
    `.${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  mkdirSync(sandboxRoot, { recursive: true });

  try {
    mkdirSync(resolve(sandboxRoot, 'scripts'), { recursive: true });
    cpSync(resolve(ROOT, 'scripts', 'sync-templates.mjs'), resolve(sandboxRoot, 'scripts', 'sync-templates.mjs'));
    cpSync(resolve(ROOT, SOURCE_DIR), resolve(sandboxRoot, SOURCE_DIR), { recursive: true });

    for (const relPath of SYNC_SANDBOX_TARGET_DIRS) {
      mkdirSync(resolve(sandboxRoot, relPath), { recursive: true });
    }

    callback(sandboxRoot);
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

const OPTIONAL_PACKAGE_LOCAL_AGENT_MIRRORS = [
  'packages/squad-cli/templates/squad.agent.md',
  'packages/squad-sdk/templates/squad.agent.md',
] as const;

const CASTING_POLICY_LOCATIONS = [
  `${SOURCE_DIR}/casting-policy.json`,
  'templates/casting-policy.json',
  'packages/squad-cli/templates/casting-policy.json',
  'packages/squad-sdk/templates/casting-policy.json',
] as const;

// ---------------------------------------------------------------------------
// 1. Pre-sync parity gate — tracked mirrors must already match canonical files
// ---------------------------------------------------------------------------

describe('pre-sync parity gate', () => {
  it('does not rewrite tracked mirror files when sync runs', () => {
    expect(
      mirrorFilesChangedBySync.length,
      `sync-templates updated tracked mirror files. Commit the synced mirrors before running this suite:\n- ${mirrorFilesChangedBySync.join('\n- ')}`
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Dynamic enumeration — byte-for-byte parity for ALL synced files
// ---------------------------------------------------------------------------

describe('dynamic template enumeration (all synced files)', () => {
  const sourceFiles = collectFiles(SOURCE_DIR);

  it('.squad-templates/ contains files to sync', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const relFile of sourceFiles) {
    const canonicalPath = `${SOURCE_DIR}/${relFile}`;

    for (const target of MIRROR_TARGETS) {
      // squad.agent.md is renamed to .template in mirror targets
      // to prevent Copilot CLI from discovering template copies
      const destName = relFile === AGENT_MD_FILE ? `${AGENT_MD_FILE}.template` : relFile;
      const targetPath = `${target}/${destName}`;

      it(`${targetPath} is byte-for-byte identical to ${canonicalPath}`, () => {
        expect(fileExists(targetPath), `${targetPath} should exist`).toBe(true);
        const src = readFileBytes(canonicalPath);
        const dst = readFileBytes(targetPath);
        expect(Buffer.compare(src, dst), `${targetPath} content mismatch`).toBe(0);
      });
    }

    // squad.agent.md also lives in .github/agents/
    if (relFile === AGENT_MD_FILE) {
      const agentPath = `${AGENT_MD_EXTRA_TARGET}/${AGENT_MD_FILE}`;

      it(`${agentPath} is byte-for-byte identical to ${canonicalPath}`, () => {
        expect(fileExists(agentPath), `${agentPath} should exist`).toBe(true);
        const src = readFileBytes(canonicalPath);
        const dst = readFileBytes(agentPath);
        expect(Buffer.compare(src, dst), `${agentPath} content mismatch`).toBe(0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Script execution — sync-templates.mjs must exit cleanly
// ---------------------------------------------------------------------------

describe('sync-templates.mjs script execution', () => {
  it('exits with code 0 (no syntax errors, no crashes)', () => {
    const output = runSyncTemplates();
    expect(output).toContain('Synced');
  });
});

describe('optional package-local squad.agent.md mirrors', () => {
  it('refreshes existing package-local mirrors from the canonical template', () => {
    withSyncSandbox('template-sync-existing-mirror', (sandboxRoot) => {
      const canonicalPath = `${SOURCE_DIR}/${AGENT_MD_FILE}`;
      const canonicalBytes = readFileBytes(canonicalPath, sandboxRoot);

      for (const relPath of OPTIONAL_PACKAGE_LOCAL_AGENT_MIRRORS) {
        writeFileSync(resolve(sandboxRoot, relPath), Buffer.from(`stale mirror for ${relPath}\n`, 'utf-8'));
      }

      const output = runSyncTemplates(sandboxRoot);
      expect(output).toContain('Synced');

      for (const relPath of OPTIONAL_PACKAGE_LOCAL_AGENT_MIRRORS) {
        expect(fileExists(relPath, sandboxRoot), `${relPath} should exist`).toBe(true);
        expect(
          Buffer.compare(readFileBytes(relPath, sandboxRoot), canonicalBytes),
          `${relPath} should match ${canonicalPath}`
        ).toBe(0);
      }
    });
  });

  it('leaves package-local mirrors absent until a runtime path creates them', () => {
    withSyncSandbox('template-sync-absent-mirror', (sandboxRoot) => {
      for (const relPath of OPTIONAL_PACKAGE_LOCAL_AGENT_MIRRORS) {
        rmSync(resolve(sandboxRoot, relPath), { force: true });
        expect(fileExists(relPath, sandboxRoot), `${relPath} should start absent`).toBe(false);
      }

      const output = runSyncTemplates(sandboxRoot);
      expect(output).toContain('Synced');

      for (const relPath of OPTIONAL_PACKAGE_LOCAL_AGENT_MIRRORS) {
        expect(
          fileExists(relPath, sandboxRoot),
          `${relPath} should remain absent until a runtime path creates it`
        ).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Negative guard — .github/agents/ should only have squad.agent.md
// ---------------------------------------------------------------------------

describe('.github/agents/ contains only squad.agent.md', () => {
  it('has no files beyond squad.agent.md from the sync', () => {
    const agentDir = resolve(ROOT, AGENT_MD_EXTRA_TARGET);
    expect(existsSync(agentDir), '.github/agents/ should exist').toBe(true);
    const files = readdirSync(agentDir);
    expect(files).toEqual([AGENT_MD_FILE]);
  });
});

// ---------------------------------------------------------------------------
// 5. squad.agent.md — universe count consistency
// ---------------------------------------------------------------------------

describe('squad.agent.md universe count', () => {
  const canonicalPath = SQUAD_AGENT_LOCATIONS[0];
  const canonicalContent = readFile(canonicalPath);
  const expectedCount = extractUniverseCount(canonicalContent);

  it('canonical file has a parseable universe count', () => {
    expect(expectedCount).not.toBeNull();
    expect(expectedCount).toBeGreaterThan(0);
  });

  for (const loc of SQUAD_AGENT_LOCATIONS) {
    it(`${loc} matches canonical universe count (${expectedCount})`, () => {
      const content = readFile(loc);
      const count = extractUniverseCount(content);
      expect(count).toBe(expectedCount);
    });
  }

  it('universe count matches casting-policy allowlist length', () => {
    const policyUniverses = parsePolicyUniverses(CASTING_POLICY_LOCATIONS[0]);
    expect(expectedCount).toBe(policyUniverses.length);
  });
});

// ---------------------------------------------------------------------------
// 6. squad.agent.md — fail-shut team root resolution
// ---------------------------------------------------------------------------

describe('squad.agent.md fail-shut resolution chain', () => {
  const canonicalContent = readFile(SQUAD_AGENT_LOCATIONS[0]);

  it('states each resolution step is a probe, not a gate', () => {
    expect(canonicalContent).toContain('Each step is a probe, not a gate.');
  });

  it('requires evidence from steps 1 through 5 before declaring no team found', () => {
    expect(canonicalContent).toMatch(
      /None matched\*\* — you may ONLY conclude this after explicitly attempting steps 1–5\./
    );
    expect(canonicalContent).toContain(
      'Before declaring "no team found", cite the negative results from steps 1–5.'
    );
  });
});

// ---------------------------------------------------------------------------
// 7. casting-policy.json — content parity & internal consistency
// ---------------------------------------------------------------------------

describe('casting-policy.json content parity', () => {
  const canonicalContent = readFile(CASTING_POLICY_LOCATIONS[0]);

  for (const loc of CASTING_POLICY_LOCATIONS) {
    it(`${loc} matches canonical casting-policy.json`, () => {
      const content = readFile(loc);
      expect(content).toBe(canonicalContent);
    });
  }

  it('allowlist and capacity map have the same universes', () => {
    const allowlist = parsePolicyUniverses(CASTING_POLICY_LOCATIONS[0]);
    const capacity = parsePolicyCapacity(CASTING_POLICY_LOCATIONS[0]);
    const capacityNames = Object.keys(capacity);

    expect(allowlist.sort()).toEqual(capacityNames.sort());
  });

  it('all capacities are positive integers', () => {
    const capacity = parsePolicyCapacity(CASTING_POLICY_LOCATIONS[0]);
    for (const [name, cap] of Object.entries(capacity)) {
      expect(cap, `${name} capacity`).toBeGreaterThan(0);
      expect(Number.isInteger(cap), `${name} capacity is integer`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Squad-spawning routing guard (regression for the "spawn a squad" hole)
// ---------------------------------------------------------------------------

describe('squad.agent.md squad-spawning guidance', () => {
  // A coordinator reading squad.agent.md saw the user say "spawn two squads
  // of designers and devs" and fanned out raw `task` agents inside its own
  // context instead of treating "squad" as the Squad-PRODUCT concept and
  // routing through the cross-squad / cross-squad-communication skills.
  // Two surgical edits to squad.agent.md (a routing-table row + a hard
  // keyword-to-skill trigger paragraph) close the hole; assert both are
  // present in every mirrored copy so a future refactor cannot silently
  // drop either.

  for (const loc of SQUAD_AGENT_LOCATIONS) {
    describe(loc, () => {
      const content = readFile(loc);

      it('has a routing-table row for "spawn a squad" / "another squad" / "two squads"', () => {
        // Match the row independent of exact wording so phrasing tweaks
        // are allowed; what matters is that ALL three trigger phrases
        // appear in a single routing-table row (lines starting with `|`).
        const rowRegex = /^\|.*spawn a squad.*another squad.*two squads.*\|.*$/im;
        expect(content, 'expected routing row containing all three trigger phrases').toMatch(rowRegex);
      });

      it('the squad-spawning row references the cross-squad skill(s) as a precondition', () => {
        // The action cell must instruct the coordinator to load
        // cross-squad (and ideally cross-squad-communication) BEFORE
        // any `task` spawn. Match on co-occurrence of "cross-squad"
        // and "skill" on the same row.
        const row = content
          .split(/\r?\n/)
          .find(l => /^\|.*spawn a squad.*another squad.*two squads/i.test(l));
        expect(row, 'spawn-a-squad row should exist').toBeDefined();
        expect(row, 'row should mention cross-squad skill').toMatch(/cross-squad/i);
        expect(row, 'row should invoke the skill tool').toMatch(/skill/i);
      });

      it('has a Hard trigger — keyword-to-skill match paragraph in Skill-aware routing', () => {
        // Both keywords must appear ("Hard trigger" + "keyword-to-skill")
        // — together they uniquely identify the guard paragraph and rule
        // out an accidental match against the routing-table row.
        expect(content).toMatch(/Hard trigger/i);
        expect(content).toMatch(/keyword.to.skill match/i);
      });

      it('the hard-trigger paragraph names the cross-squad mapping as a worked example', () => {
        // Defends against a future edit that keeps the paragraph header
        // but drops the concrete "squad → cross-squad" example, which
        // is what makes the rule unambiguous for a coordinator.
        const tail = content.slice(content.toLowerCase().indexOf('hard trigger'));
        expect(tail).toMatch(/["']?squad["']?\s*→\s*`?cross-squad/);
      });

      it('the routing row instructs the coordinator to ask_user when the request is ambiguous', () => {
        // Real-world failure mode (2026-06-13): even AFTER the row +
        // hard-trigger were in place, a coordinator silently picked
        // ad-hoc `task` fan-out instead of bootstrapping real squads
        // because "two squads of engineers for a 30-line app felt
        // disproportionate". The fix is an explicit "you MUST ask_user
        // when ambiguous" clause with no escape hatch — and a callout
        // that calling task agents "squad-alpha" doesn't make them
        // squads. Both must be present on the squad-spawning row.
        const row = content
          .split(/\r?\n/)
          .find(l => /^\|.*spawn a squad.*another squad.*two squads/i.test(l));
        expect(row, 'spawn-a-squad row should exist').toBeDefined();
        expect(row, 'row should reference ask_user for ambiguous requests').toMatch(/ask_user/i);
        expect(row, 'row should call out the "naming != being" anti-pattern').toMatch(/anti-pattern/i);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 6. cross-squad/SKILL.md must have the Disambiguation section
// ---------------------------------------------------------------------------

const CROSS_SQUAD_SKILL_LOCATIONS = [
  '.squad/skills/cross-squad/SKILL.md',
  'packages/squad-cli/templates/skills/cross-squad/SKILL.md',
  'packages/squad-sdk/templates/skills/cross-squad/SKILL.md',
] as const;

describe('cross-squad/SKILL.md disambiguation rule', () => {
  // Folded into PR #1307 after a real-world failure (2026-06-13): the routing
  // row alone wasn't enough — once the coordinator loaded the skill, its
  // generic eager-execution / parallel-fan-out doctrine pulled it back to
  // `task` fan-out anyway. The dedicated Disambiguation section makes the
  // squad-vs-ad-hoc rule unmistakable inside the skill itself, with explicit
  // default-behavior table, ask_user protocol, and anti-patterns.

  for (const loc of CROSS_SQUAD_SKILL_LOCATIONS) {
    describe(loc, () => {
      const content = readFile(loc);

      it('has a "Disambiguation" section', () => {
        expect(content).toMatch(/##\s+Disambiguation/i);
      });

      it('declares the default-behaviour rule (literal Squad install when user says "squad")', () => {
        // The default must be the literal interpretation. Any future
        // edit that flips the default to ad-hoc fan-out would be a
        // regression — that's exactly the failure mode this section
        // exists to prevent.
        const tail = content.slice(content.toLowerCase().indexOf('disambiguation'));
        expect(tail).toMatch(/default behaviour|default behavior/i);
        expect(tail).toMatch(/real.*Squad install|literal reference to a Squad install/i);
      });

      it('requires ask_user on ambiguous requests (no silent downgrade)', () => {
        const tail = content.slice(content.toLowerCase().indexOf('disambiguation'));
        expect(tail).toMatch(/ask_user/);
        // Must explicitly forbid silent downgrades — the failure mode
        // was "coordinator silently picked the cheaper option".
        expect(tail).toMatch(/never silently/i);
      });

      it('lists the "calling task agents squad-alpha doesn\'t make them squads" anti-pattern', () => {
        const tail = content.slice(content.toLowerCase().indexOf('disambiguation'));
        // The anti-pattern is the strongest defense against the
        // "name it a squad to look compliant" failure mode.
        expect(tail).toMatch(/anti-pattern/i);
        expect(tail).toMatch(/squad-alpha|squad-beta|naming.*does(n't| not)/i);
      });

      it('frontmatter declares squad-spawning trigger phrases', () => {
        // Copilot CLI itself ignores triggers: at the loader level
        // (verified via sdk/index.js decompile), but the squad
        // skill-aware-routing system uses natural-language matching
        // against frontmatter + content. Documenting the trigger
        // phrases here helps that matcher fire on the right prompts.
        expect(content).toMatch(/^triggers:/m);
        expect(content).toMatch(/spawn a squad|spawn N squads/);
        expect(content).toMatch(/another squad|two squads of/);
      });
    });
  }
});
