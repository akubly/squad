import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { managedHostsRoot, managedHostPath } from '../../packages/squad-sdk/src/managed-hosts.js';

describe('managed-hosts (piece 55 §B)', () => {
  it('M1 managedHostsRoot honors an explicit home override', () => {
    const home = path.join(os.tmpdir(), 'p55-home-a');
    expect(managedHostsRoot(home)).toBe(path.join(home, '.squad', 'hosts'));
  });

  it('M2 managedHostPath nests the callsign under the hosts root', () => {
    const home = path.join(os.tmpdir(), 'p55-home-b');
    expect(managedHostPath('probe', home)).toBe(path.join(home, '.squad', 'hosts', 'probe'));
  });

  it('M3 SQUAD_HOME env is honored when no explicit home is given', () => {
    const squadHome = path.join(os.tmpdir(), 'p55-squadhome');
    const prev = process.env.SQUAD_HOME;
    process.env.SQUAD_HOME = squadHome;
    try {
      expect(managedHostsRoot()).toBe(path.join(squadHome, 'hosts'));
      expect(managedHostPath('beta')).toBe(path.join(squadHome, 'hosts', 'beta'));
    } finally {
      if (prev === undefined) delete process.env.SQUAD_HOME;
      else process.env.SQUAD_HOME = prev;
    }
  });

  it('M4 explicit home wins over SQUAD_HOME', () => {
    const squadHome = path.join(os.tmpdir(), 'p55-squadhome-2');
    const explicit = path.join(os.tmpdir(), 'p55-explicit');
    const prev = process.env.SQUAD_HOME;
    process.env.SQUAD_HOME = squadHome;
    try {
      expect(managedHostPath('gamma', explicit)).toBe(path.join(explicit, '.squad', 'hosts', 'gamma'));
    } finally {
      if (prev === undefined) delete process.env.SQUAD_HOME;
      else process.env.SQUAD_HOME = prev;
    }
  });
});
