import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SquadError } from '../packages/squad-sdk/src/adapter/errors.js';
import {
  loadRegistryFromDisk,
  parseRegistry,
  registerEntry,
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

  it('S14b warns when path does not exist at register time', () => {
    const warnings: string[] = [];
    const entry = { path: path.join(dir, 'missing.squad') };

    expect(registerEntry(entry, { onWarn: (msg) => warnings.push(msg) })).toEqual(entry);
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
