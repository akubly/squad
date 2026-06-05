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

  it('P32.R1 RegistryEntry interface accepts stateRemote, stateBranch, developerAlias', () => {
    const entry: RegistryEntry = {
      path: squadPath(dir),
      stateRemote: 'upstream',
      stateBranch: 'squad-state',
      developerAlias: 'alice-1',
    };
    expect(entry.stateRemote).toBe('upstream');
    expect(entry.stateBranch).toBe('squad-state');
    expect(entry.developerAlias).toBe('alice-1');
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
        developerAlias: 'dev1',
      }],
    };

    writeRegistry(registryPath, registry);
    const { registry: loaded } = loadRegistryFromDisk({ registryPath });

    expect(loaded).not.toBeNull();
    const entry = loaded!.squads[0];
    expect(entry!.stateRemote).toBe('origin');
    expect(entry!.stateBranch).toBe('squad-state');
    expect(entry!.developerAlias).toBe('dev1');
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
