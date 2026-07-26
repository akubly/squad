/**
 * Team-root path classifier (piece 52, sub-proposal C).
 *
 * Under Pole A every mutable `.squad/**` path has exactly one home:
 *   - `scratch`   — machine-local / pipeline-owned; never transported, never committed
 *                   (`PUBLISH_MACHINE_LOCAL`).
 *   - `ephemeral` — folded to `squad/state/<callsign>` (`PUBLISH_ALLOWLIST`, piece 51).
 *   - `durable`   — rides the reviewed `squad/config/<callsign>` orphan (`CONFIG_ALLOWLIST`).
 *
 * The three lanes are DISJOINT by construction, so the order below is a defensive
 * tie-break only: `classifyTeamRootPath` still returns a single lane if the sets ever drift.
 * `unclassified` is a guard — a new team-root path added without a lane surfaces here and
 * fails the piece-52 classifier test rather than silently drifting (piece 51's category-3 leak).
 *
 * @module cli/commands/team-root-classifier
 */

import { isAllowlisted, isConfigAllowlisted } from './sync.js';
import { PUBLISH_MACHINE_LOCAL } from './allowlist-gitignore.js';

export type TeamRootLane = 'scratch' | 'ephemeral' | 'durable' | 'unclassified';

/** True when `relPath` is machine-local / pipeline-owned scratch (never transported). */
export function isMachineLocal(relPath: string): boolean {
  return PUBLISH_MACHINE_LOCAL.includes(relPath.replace(/\\/g, '/'));
}

/**
 * Resolve the single lane that owns `relPath` (forward-slash, relative to the team root).
 * Returns `'unclassified'` when no lane claims the path — the drift guard.
 */
export function classifyTeamRootPath(relPath: string): TeamRootLane {
  const p = relPath.replace(/\\/g, '/');
  if (isMachineLocal(p)) return 'scratch';
  if (isAllowlisted(p)) return 'ephemeral';
  if (isConfigAllowlisted(p)) return 'durable';
  return 'unclassified';
}

/**
 * Count how many of the three lane predicates claim `relPath`. Used by the classifier
 * test to assert the partition is DISJOINT (every path claimed by exactly one lane).
 */
export function laneMatchCount(relPath: string): number {
  const p = relPath.replace(/\\/g, '/');
  return [isMachineLocal(p), isAllowlisted(p), isConfigAllowlisted(p)].filter(Boolean).length;
}
