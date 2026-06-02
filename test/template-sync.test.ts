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
// 8. ADO templates — existence at canonical location and all mirror targets
// ---------------------------------------------------------------------------

const ADO_TEMPLATES = [
  'ado/bootstrap-cross-repo.ps1',
  'ado/publish-inbox.yml',
  'ado/fold-squad-state.yml',
] as const;

const ADO_MIRROR_TARGETS = [
  'templates',
  'packages/squad-cli/templates',
  'packages/squad-sdk/templates',
] as const;

describe('ADO templates — canonical location', () => {
  for (const relFile of ADO_TEMPLATES) {
    const canonicalPath = `${SOURCE_DIR}/${relFile}`;
    it(`${canonicalPath} exists at canonical source`, () => {
      expect(fileExists(canonicalPath), `${canonicalPath} must exist in .squad-templates/ado/`).toBe(true);
    });
  }
});

describe('ADO templates — mirror parity (all three mirror targets)', () => {
  for (const relFile of ADO_TEMPLATES) {
    const canonicalPath = `${SOURCE_DIR}/${relFile}`;

    for (const target of ADO_MIRROR_TARGETS) {
      const mirrorPath = `${target}/${relFile}`;

      it(`${mirrorPath} exists and is byte-for-byte identical to ${canonicalPath}`, () => {
        expect(fileExists(mirrorPath), `${mirrorPath} must exist — run sync-templates to update mirrors`).toBe(true);
        const src = readFileBytes(canonicalPath);
        const dst = readFileBytes(mirrorPath);
        expect(Buffer.compare(src, dst), `${mirrorPath} content mismatch with ${canonicalPath}`).toBe(0);
      });
    }
  }
});
