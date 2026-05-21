import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SquadError } from '../packages/squad-sdk/src/adapter/errors.js';
import {
  loadRegistryFromDisk,
  parseRegistry,
  registerEntry,
  upsertEntry,
  writeRegistry,
} from '../packages/squad-sdk/src/registry.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.registry-schema-tmp');

function makeCaseDir(name: string): string {
  const dir = path.join(TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function squadPath(dir: string, name = 'alpha'): string {
  return path.join(dir, `${name}.squad`);
}

describe('registry schema', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeCaseDir('case');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('S1 accepts a minimal entry with path only', () => {
    const parsed = parseRegistry(JSON.stringify({ version: 1, squads: [{ path: squadPath(dir) }] }));

    expect(parsed).toEqual({ version: 1, squads: [{ path: squadPath(dir) }] });
    expect(parsed.squads[0]?.callsign).toBeUndefined();
    expect(parsed.squads[0]?.origins).toBeUndefined();
    expect(parsed.squads[0]?.clones).toBeUndefined();
  });

  it('S2 accepts a full entry with callsign, path, origins[], clones[]', () => {
    const entry = {
      callsign: 'org/api',
      path: squadPath(dir),
      origins: ['https://github.com/example/api', 'git@github.com:example/api.git'],
      clones: [path.join(dir, 'clone-a'), path.join(dir, 'clone-b')],
    };

    expect(parseRegistry(JSON.stringify({ version: 1, squads: [entry] })).squads[0]).toEqual(entry);
  });

  it('S3 rejects entry missing required path field', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{}] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{}] }))).toThrow(/path.*required/i);
  });

  it('S4 rejects path that does not end with .squad', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ path: path.join(dir, 'alpha') }] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ path: path.join(dir, 'alpha') }] }))).toThrow(/\.squad/i);
  });

  it('S5 rejects relative path', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ path: path.join('relative', 'alpha.squad') }] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ path: path.join('relative', 'alpha.squad') }] }))).toThrow(/absolute/i);
  });

  it('S6 accepts missing origins field', () => {
    const parsed = parseRegistry(JSON.stringify({ version: 1, squads: [{ path: squadPath(dir) }] }));

    expect(parsed.squads[0]).not.toHaveProperty('origins');
    expect(parsed.squads[0]?.origins).toBeUndefined();
  });

  it('S6 accepts empty origins array', () => {
    const parsed = parseRegistry(JSON.stringify({ version: 1, squads: [{ path: squadPath(dir), origins: [] }] }));

    expect(parsed.squads[0]).toHaveProperty('origins');
    expect(parsed.squads[0]?.origins).toEqual([]);
  });

  it('S7 rejects clones[] entry with relative path', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ path: squadPath(dir), clones: ['relative-clone'] }] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ path: squadPath(dir), clones: ['relative-clone'] }] }))).toThrow(/clone.*absolute/i);
  });

  it('S8 rejects registry with duplicate callsigns', () => {
    expect(() => parseRegistry(JSON.stringify({
      version: 1,
      squads: [
        { callsign: 'api', path: squadPath(dir, 'one') },
        { callsign: 'api', path: squadPath(dir, 'two') },
      ],
    }))).toThrow(/duplicate.*callsign/i);
  });

  it('S9 rejects registry with two entries pointing to the same path', () => {
    expect(() => parseRegistry(JSON.stringify({
      version: 1,
      squads: [
        { callsign: 'one', path: squadPath(dir) },
        { callsign: 'two', path: squadPath(dir) },
      ],
    }))).toThrow(/duplicate.*path/i);
  });

  it('S9b rejects registry with case-variant duplicate paths on win32/darwin', () => {
    const pathA = path.join(dir.toLowerCase(), 'alpha.squad');
    const pathB = path.join(dir.toUpperCase(), 'alpha.squad');
    const registry = JSON.stringify({
      version: 1,
      squads: [
        { callsign: 'one', path: pathA },
        { callsign: 'two', path: pathB },
      ],
    });
    if (process.platform === 'win32' || process.platform === 'darwin') {
      expect(() => parseRegistry(registry)).toThrow(/duplicate.*path/i);
    } else {
      // linux: case-sensitive — the two paths are distinct, no duplicate
      expect(() => parseRegistry(registry)).not.toThrow();
    }
  });

  it('S10 rejects registry with missing version field', () => {
    expect(() => parseRegistry(JSON.stringify({ squads: [] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ squads: [] }))).toThrow(/version.*required/i);
  });

  it('S11 rejects version 0 with migration hint', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 0, squads: [] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 0, squads: [] }))).toThrow(/current registry/i);
  });

  it('S12 rejects unknown future version', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 99, squads: [] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 99, squads: [] }))).toThrow(/unsupported.*version/i);
  });

  it('S13 rejects registry where squads field is not an array', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: {} }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: {} }))).toThrow(/squads.*array/i);
  });

  it('S14a tolerates stale path at read time', () => {
    const stalePath = path.join(dir, 'missing.squad');

    expect(parseRegistry(JSON.stringify({ version: 1, squads: [{ path: stalePath }] })).squads[0]?.path).toBe(stalePath);
  });

  it('S14b warns when path does not exist at write-preparation time', () => {
    const warnings: string[] = [];
    const entry = { path: path.join(dir, 'missing.squad') };

    expect(upsertEntry(entry, { onWarn: (msg) => warnings.push(msg) })).toEqual(entry);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does not exist/i);
  });

  it('S15 accepts callsign with slash for scoped names', () => {
    expect(parseRegistry(JSON.stringify({ version: 1, squads: [{ callsign: 'org/api', path: squadPath(dir) }] })).squads[0]?.callsign).toBe('org/api');
  });

  it('S16 rejects callsign containing path-traversal segment', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ callsign: 'org/../api', path: squadPath(dir) }] }))).toThrow(SquadError);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [{ callsign: 'org/../api', path: squadPath(dir) }] }))).toThrow(/path-traversal/i);
  });

  it('S17 accepts origins[] containing multiple repository URL forms', () => {
    const origins = ['https://github.com/example/api', 'git@github.com:example/api.git', 'ssh://git@example.com/org/api.git'];

    expect(parseRegistry(JSON.stringify({ version: 1, squads: [{ path: squadPath(dir), origins }] })).squads[0]?.origins).toEqual(origins);
  });

  it('S18 throws parse error with remediation on empty file', () => {
    expect(() => parseRegistry('')).toThrow(SquadError);
    expect(() => parseRegistry('')).toThrow(/empty.*registry/i);
  });

  it('S19 throws parse error with remediation on malformed JSON', () => {
    expect(() => parseRegistry('{not-json')).toThrow(SquadError);
    expect(() => parseRegistry('{not-json')).toThrow(/valid JSON/i);
  });

  it('S20 throws helpful error on write when registry.json is read-only', () => {
    const registryPath = path.join(dir, 'registry.json');
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads: [] }), 'utf8');
    fs.chmodSync(registryPath, 0o444);

    try {
      expect(() => writeRegistry(registryPath, { version: 1, squads: [] })).toThrow(SquadError);
      expect(() => writeRegistry(registryPath, { version: 1, squads: [] })).toThrow(/registry\.json.*permissions/i);
    } finally {
      fs.chmodSync(registryPath, 0o666);
    }
  });

  it('SC1 uses registry.json when both registry.json and squad-repos.json are present', () => {
    const registryPath = path.join(dir, 'registry.json');
    const legacyPath = path.join(dir, 'squad-repos.json');
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads: [{ path: squadPath(dir) }] }), 'utf8');
    fs.writeFileSync(legacyPath, JSON.stringify([{ path: path.join(dir, 'legacy.squad') }]), 'utf8');

    const result = loadRegistryFromDisk({ registryPath, legacyPath });

    expect(result.registry).toEqual({ version: 1, squads: [{ path: squadPath(dir) }] });
    expect(result.warnings).toEqual([]);
  });

  it('SC2 ignores squad-repos.json and emits warning when only squad-repos.json is present', () => {
    const registryPath = path.join(dir, 'registry.json');
    const legacyPath = path.join(dir, 'squad-repos.json');
    const warnings: string[] = [];
    fs.writeFileSync(legacyPath, JSON.stringify([{ path: path.join(dir, 'legacy.squad') }]), 'utf8');

    const result = loadRegistryFromDisk({ registryPath, legacyPath, onWarn: (msg) => warnings.push(msg) });

    expect(result.registry).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/squad-repos\.json/i);
    expect(warnings).toEqual(result.warnings);
  });
});
describe('upsertEntry()', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeCaseDir('upsert');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('UE.1 returns a validated entry for an existing path', () => {
    const existingPath = path.join(dir, 'alpha.squad');
    fs.mkdirSync(existingPath, { recursive: true });
    const entry = { path: existingPath };
    const result = upsertEntry(entry);
    expect(result).toEqual(entry);
  });

  it('UE.2 warns but does not throw when path does not exist at write-preparation time', () => {
    const warnings: string[] = [];
    const entry = { path: path.join(dir, 'missing.squad') };
    expect(upsertEntry(entry, { onWarn: (msg) => warnings.push(msg) })).toEqual(entry);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does not exist/i);
  });

  it('UE.3 throws SquadError when entry path does not end with .squad', () => {
    const entry = { path: path.join(dir, 'alpha') };
    expect(() => upsertEntry(entry)).toThrow(SquadError);
    expect(() => upsertEntry(entry)).toThrow(/\.squad/i);
  });

  it('UE.4 preserves optional callsign, origins, and clones fields', () => {
    const entry = {
      path: path.join(dir, 'alpha.squad'),
      callsign: 'my/squad',
      origins: ['https://github.com/example/repo'],
      clones: [path.join(dir, 'clone-a')],
    };
    expect(upsertEntry(entry)).toEqual(entry);
  });

  it('UE.5 normalizes and deduplicates origins and clones while preserving first occurrence order', () => {
    const entry = {
      path: path.join(dir, 'alpha.squad'),
      origins: [
        'https://github.com/example/repo.git',
        'git@github.com:example/repo.git',
        'https://github.com/example/other.git',
      ],
      clones: [
        path.join(dir, 'clone-a'),
        path.join(dir, '.', 'clone-a'),
        path.join(dir, 'clone-b'),
      ],
    };

    expect(upsertEntry(entry)).toEqual({
      ...entry,
      origins: [
        'https://github.com/example/repo.git',
        'https://github.com/example/other.git',
      ],
      clones: [
        path.join(dir, 'clone-a'),
        path.join(dir, 'clone-b'),
      ],
    });
  });
});

describe('registerEntry() backward-compatibility alias', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeCaseDir('compat');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('BC.1 registerEntry delegates to upsertEntry and produces identical output', () => {
    const warnings1: string[] = [];
    const warnings2: string[] = [];
    const entry = { path: path.join(dir, 'missing.squad') };
    const r1 = registerEntry(entry, { onWarn: (msg) => warnings1.push(msg) });
    const r2 = upsertEntry(entry, { onWarn: (msg) => warnings2.push(msg) });
    expect(r1).toEqual(r2);
    expect(warnings1).toEqual(warnings2);
  });
});
