/**
 * Registry list command module.
 *
 * Returns the registry contents as a tab-separated table suitable for
 * scripting and display. When the registry is missing or empty, returns
 * actionable guidance text instead.
 *
 * @module commands/list
 */

import fs from 'node:fs';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import type { RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { resolveRegistryFilePath } from './_registry-path.js';

export interface RunListOpts {
  registryPath?: string;
}

/**
 * Return the registry contents as a tab-separated table string.
 *
 * Columns: CALLSIGN, PATH, ORIGINS, CLONES, STATUS
 * - STATUS is "active" when the path exists on disk, "missing path" otherwise.
 * - Returns guidance text when no registry is found or when the registry is empty.
 */
export async function runList(opts?: RunListOpts): Promise<string> {
  const registryFilePath = resolveRegistryFilePath({ explicit: opts?.registryPath });

  if (!registryFilePath || !fs.existsSync(registryFilePath)) {
    return (
      'No registry found. Run "squad init" or "squad register" to create one.\n' +
      'Default location: ~/.config/squad/registry.json (or %APPDATA%\\squad\\registry.json on Windows).'
    );
  }

  const { registry } = loadRegistryFromDisk({ registryPath: opts?.registryPath });

  if (!registry || registry.squads.length === 0) {
    return (
      'Registry is empty. Run "squad init" or "squad register --callsign <name> --path <dir>" to add a squad.'
    );
  }

  const header = ['CALLSIGN', 'PATH', 'ORIGINS', 'CLONES', 'STATUS'].join('\t');
  const rows = registry.squads.map((entry: RegistryEntry) => {
    const status = fs.existsSync(entry.path) ? 'active' : 'missing path';
    return [
      entry.callsign ?? '(none)',
      entry.path,
      String(entry.origins?.length ?? 0),
      String(entry.clones?.length ?? 0),
      status,
    ].join('\t');
  });

  return [header, ...rows].join('\n');
}
