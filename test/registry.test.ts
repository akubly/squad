import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadRegistryFromDisk,
  parseRegistry,
  writeRegistry,
} from '../packages/squad-sdk/src/registry.js';
import type { RegistryEntry } from '../packages/squad-sdk/src/registry.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.registry-p32-tmp');

function makeCaseDir(name: string): string {
  const dir = path.join(TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function squadPath(dir: string, name = 'alpha'): string {
  return path.join(dir, `${name}.squad`);
}

describe('RegistryEntry — piece-32 state fields', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeCaseDir('case');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('P32.R1 RegistryEntry interface accepts stateRemote, stateBranch, inboxHandle', () => {
    const entry: RegistryEntry = {
      path: squadPath(dir),
      stateRemote: 'upstream',
      stateBranch: 'squad-state',
      inboxHandle: 'alice-1',
    };
    expect(entry.stateRemote).toBe('upstream');
    expect(entry.stateBranch).toBe('squad-state');
    expect(entry.inboxHandle).toBe('alice-1');
  });

  it('P32.R2 entry with all three new fields serializes and round-trips through writeRegistry / loadRegistryFromDisk', () => {
    const registryPath = path.join(dir, 'registry.json');
    const sqPath = squadPath(dir);

    const registry = {
      version: 1,
      squads: [{
        callsign: 'alpha',
        path: sqPath,
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxHandle: 'dev1',
      }],
    };

    writeRegistry(registryPath, registry);
    const { registry: loaded } = loadRegistryFromDisk({ registryPath });

    expect(loaded).not.toBeNull();
    const entry = loaded!.squads[0];
    expect(entry!.stateRemote).toBe('origin');
    expect(entry!.stateBranch).toBe('squad-state');
    expect(entry!.inboxHandle).toBe('dev1');
  });

  it('P32.R3 legacy entry without state fields loads cleanly with undefined for all three', () => {
    const sqPath = squadPath(dir);
    const json = JSON.stringify({ version: 1, squads: [{ callsign: 'beta', path: sqPath }] });
    const parsed = parseRegistry(json);

    expect(parsed.squads[0]!.stateRemote).toBeUndefined();
    expect(parsed.squads[0]!.stateBranch).toBeUndefined();
    expect(parsed.squads[0]!.developerAlias).toBeUndefined();
  });
});

describe('Registry defaults — piece 58 §B / decision H1', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeCaseDir('p58-defaults');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('P58.B1 tolerates and round-trips a top-level defaults.stateRemote block', () => {
    const registryPath = path.join(dir, 'registry.json');
    const json = JSON.stringify({
      version: 1,
      squads: [{ callsign: 'alpha', path: squadPath(dir) }],
      defaults: { stateRemote: 'https://example.com/shared.git' },
    });
    const parsed = parseRegistry(json);
    expect(parsed.defaults?.stateRemote).toBe('https://example.com/shared.git');

    writeRegistry(registryPath, parsed);
    const { registry: loaded } = loadRegistryFromDisk({ registryPath });
    expect(loaded!.defaults?.stateRemote).toBe('https://example.com/shared.git');
  });

  it('P58.B2 a registry without defaults loads with defaults undefined', () => {
    const parsed = parseRegistry(JSON.stringify({ version: 1, squads: [{ callsign: 'beta', path: squadPath(dir) }] }));
    expect(parsed.defaults).toBeUndefined();
  });

  it('P58.B3 preserves forward-compatible sibling keys inside defaults', () => {
    const parsed = parseRegistry(JSON.stringify({
      version: 1,
      squads: [],
      defaults: { stateRemote: 'origin', futureKnob: 'keep-me' },
    }));
    expect(parsed.defaults?.stateRemote).toBe('origin');
    expect((parsed.defaults as Record<string, unknown>).futureKnob).toBe('keep-me');
  });

  it('P58.B4 rejects a non-object defaults / non-string stateRemote', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [], defaults: 'nope' })))
      .toThrow(/defaults must be an object/);
    expect(() => parseRegistry(JSON.stringify({ version: 1, squads: [], defaults: { stateRemote: 42 } })))
      .toThrow(/defaults\.stateRemote must be a string/);
  });
});
