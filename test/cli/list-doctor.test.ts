/**
 * Registry list and doctor command tests.
 * Covers runList output formatting and runDoctor resolution findings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { runList } from '@bradygaster/squad-cli/commands/list';
import { runDoctor } from '@bradygaster/squad-cli/commands/doctor';
import type { RunDoctorResult } from '@bradygaster/squad-cli/commands/doctor';

const TEST_ROOT = join(process.cwd(), `.test-list-doctor-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

async function seedRegistry(squads: unknown[]): Promise<void> {
  await writeFile(tempRegistry(), JSON.stringify({ version: 1, squads }, null, 2));
}

// ── runList ──────────────────────────────────────────────────────────────────

describe('runList: missing registry', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns actionable guidance text when no registry file exists', async () => {
    const result = await runList({ registryPath: tempRegistry() });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('runList: empty registry', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns actionable guidance text when registry has no entries', async () => {
    await seedRegistry([]);
    const result = await runList({ registryPath: tempRegistry() });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('runList: populated registry', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, 'my-project', '.squad');
    await mkdir(squadDir, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('prints CALLSIGN, PATH, ORIGINS, CLONES, STATUS columns', async () => {
    await seedRegistry([{
      callsign: 'alpha',
      path: squadDir,
      origins: ['https://github.com/org/repo'],
      clones: [],
    }]);
    const result = await runList({ registryPath: tempRegistry() });
    expect(result).toContain('CALLSIGN');
    expect(result).toContain('PATH');
    expect(result).toContain('ORIGINS');
    expect(result).toContain('CLONES');
    expect(result).toContain('STATUS');
    expect(result).toContain('alpha');
    expect(result).toContain(squadDir);
  });

  it('shows origin and clone counts', async () => {
    await seedRegistry([{
      callsign: 'beta',
      path: squadDir,
      origins: ['https://github.com/org/repo', 'https://github.com/fork/repo'],
      clones: [join(TEST_ROOT, 'clone1')],
    }]);
    const result = await runList({ registryPath: tempRegistry() });
    expect(result).toContain('2'); // 2 origins
    expect(result).toContain('1'); // 1 clone
  });
});

describe('runList: stale path', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('marks missing paths in output', async () => {
    const missingDir = join(TEST_ROOT, 'does-not-exist', '.squad');
    await seedRegistry([{ callsign: 'ghost', path: missingDir }]);
    const result = await runList({ registryPath: tempRegistry() });
    expect(result.toLowerCase()).toContain('missing');
  });
});

// ── runDoctor ────────────────────────────────────────────────────────────────

describe('runDoctor: no setup', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns info severity and guidance when no .squad/ and no registry exist', async () => {
    const result: RunDoctorResult = await runDoctor({ cwd: TEST_ROOT, registryPath: tempRegistry() });
    expect(result.severity).toBe('info');
    expect(result.findings).toBeInstanceOf(Array);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some(f => /init|setup|squad/i.test(f))).toBe(true);
  });
});

describe('runDoctor: local resolution', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('reports that a local .squad/ directory was found', async () => {
    const result = await runDoctor({ cwd: TEST_ROOT, registryPath: tempRegistry() });
    expect(result.findings.some(f => f.includes('.squad/'))).toBe(true);
  });
});

describe('runDoctor: callsign resolution', () => {
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadDir = join(TEST_ROOT, '.squad');
    await mkdir(squadDir, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('reports selected callsign when env has SQUAD_CALLSIGN and registry has matching entry', async () => {
    await seedRegistry([{ callsign: 'test-squad', path: squadDir }]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath: tempRegistry(),
      env: { SQUAD_CALLSIGN: 'test-squad' },
    });
    expect(result.findings.some(f => f.includes('test-squad'))).toBe(true);
  });

  it('returns error severity when SQUAD_CALLSIGN is set but not found in registry', async () => {
    await seedRegistry([]);
    const result = await runDoctor({
      cwd: TEST_ROOT,
      registryPath: tempRegistry(),
      env: { SQUAD_CALLSIGN: 'missing-squad' },
    });
    expect(result.severity).toBe('error');
    expect(result.findings.some(f => /missing-squad/.test(f))).toBe(true);
  });
});

describe('runDoctor: stale and ambiguous entries', () => {
  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });
  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('surfaces stale paths with warn severity', async () => {
    const missingDir = join(TEST_ROOT, 'does-not-exist', '.squad');
    await seedRegistry([{ callsign: 'ghost', path: missingDir }]);
    const result = await runDoctor({ cwd: TEST_ROOT, registryPath: tempRegistry() });
    expect(result.severity).toBe('warn');
    expect(result.findings.some(f => /stale|does not exist/i.test(f))).toBe(true);
  });
});
