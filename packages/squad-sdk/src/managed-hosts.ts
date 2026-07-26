/**
 * CLI-managed host clone path resolution (piece 55, sub-proposal B).
 *
 * A managed host clone is a tool-owned clone of a shared-squad host that the user never chooses
 * or maintains. It lives under `~/.squad/hosts/<callsign>/`, with its team root at
 * `~/.squad/hosts/<callsign>/.squad`. The CLI creates it during a one-command cold-start
 * (`squad assign --callsign … --state-remote …`), records it in the registry with `managed: true`,
 * and refreshes it by clean overwrite because it is never hand-edited.
 *
 * Resolution honors the same home override seam the rest of the SDK/CLI threads for tests:
 *   1. an explicit `home` argument (test seam) → `<home>/.squad/hosts`;
 *   2. else the `SQUAD_HOME` env var (already the `.squad` root) → `<SQUAD_HOME>/hosts`, so the
 *      managed clones sit next to `registry.json`;
 *   3. else `os.homedir()` → `<homedir>/.squad/hosts`.
 *
 * @module managed-hosts
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the managed hosts root — the directory that holds every CLI-managed host clone.
 *
 * @param home Optional home override (test seam). When supplied, resolves to `<home>/.squad/hosts`.
 * @returns Absolute path to the managed hosts root.
 */
export function managedHostsRoot(home?: string): string {
  if (home !== undefined) {
    return path.join(home, '.squad', 'hosts');
  }
  const envHome = process.env['SQUAD_HOME'];
  if (envHome) {
    // SQUAD_HOME already names the `.squad` root — the hosts dir lives directly under it so the
    // managed clones are colocated with registry.json.
    return path.join(envHome, 'hosts');
  }
  return path.join(os.homedir(), '.squad', 'hosts');
}

/**
 * Resolve the managed host clone path for a callsign — `<managedHostsRoot>/<callsign>`.
 * Its team root is `<managedHostPath>/.squad`.
 *
 * @param callsign The squad callsign.
 * @param home Optional home override (test seam).
 * @returns Absolute path to the per-callsign managed host clone.
 */
export function managedHostPath(callsign: string, home?: string): string {
  return path.join(managedHostsRoot(home), callsign);
}
