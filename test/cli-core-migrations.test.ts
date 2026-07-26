import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

vi.mock('@bradygaster/squad-sdk', async () => import('../packages/squad-sdk/src/index.js'));
vi.mock('@bradygaster/squad-sdk/registry', async () => import('../packages/squad-sdk/src/registry.js'));

const { runMigrations } = await import('../packages/squad-cli/src/cli/core/migrations.js');

const TMP_ROOT = path.join(process.cwd(), '.test-cli-core-migrations');

function makeCaseDir(name: string): string {
  const dir = path.join(TMP_ROOT, `${name}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

describe('CLI core migrations', () => {
  const originalSquadHome = process.env['SQUAD_HOME'];
  let squadHome: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    squadHome = makeCaseDir('home');
    process.env['SQUAD_HOME'] = squadHome;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalSquadHome === undefined) {
      delete process.env['SQUAD_HOME'];
    } else {
      process.env['SQUAD_HOME'] = originalSquadHome;
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('creates a fresh registry when legacy squad-repos.json exists without registry.json', async () => {
    const legacyPath = path.join(squadHome, 'squad-repos.json');
    const registryPath = path.join(squadHome, 'registry.json');
    fs.writeFileSync(legacyPath, JSON.stringify([{ callsign: 'legacy' }]), 'utf8');

    const applied = await runMigrations(path.join(makeCaseDir('project'), '.squad'), '0.9.0', '0.9.6');

    expect(applied).toContain('0.9.6: Create registry.json for legacy squad-repos.json users');
    expect(readJson(registryPath)).toEqual({ version: 1, squads: [] });
    expect(fs.existsSync(legacyPath)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Re-run "squad assign <callsign>"'));
  });

  it('skips migration when registry.json already exists', async () => {
    const legacyPath = path.join(squadHome, 'squad-repos.json');
    const registryPath = path.join(squadHome, 'registry.json');
    const existingRegistry = '{\n  "version": 1,\n  "squads": []\n}\n';
    fs.writeFileSync(legacyPath, JSON.stringify([{ callsign: 'legacy' }]), 'utf8');
    fs.writeFileSync(registryPath, existingRegistry, 'utf8');

    await runMigrations(path.join(makeCaseDir('project'), '.squad'), '0.9.0', '0.9.6');

    expect(fs.readFileSync(registryPath, 'utf8')).toBe(existingRegistry);
  });

  it('warns and leaves registry.json untouched when an unsupported registry version exists', async () => {
    const registryPath = path.join(squadHome, 'registry.json');
    const unsupportedRegistry = '{\n  "version": 2,\n  "squads": [{ "path": "future" }]\n}\n';
    fs.writeFileSync(registryPath, unsupportedRegistry, 'utf8');

    await runMigrations(path.join(makeCaseDir('project'), '.squad'), '0.9.0', '0.9.6');

    expect(fs.readFileSync(registryPath, 'utf8')).toBe(unsupportedRegistry);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported version 2'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('file a bug'));
  });

  it('does nothing when neither legacy nor current registry exists', async () => {
    const registryPath = path.join(squadHome, 'registry.json');
    const legacyPath = path.join(squadHome, 'squad-repos.json');

    await runMigrations(path.join(makeCaseDir('project'), '.squad'), '0.9.0', '0.9.6');

    expect(fs.existsSync(registryPath)).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
