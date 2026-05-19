/**
 * Registry-aware doctor command module.
 *
 * Reports the resolution state and registry health for the current working
 * directory. Returns structured findings instead of printing directly so
 * the CLI entry point can own console rendering and exit-code mapping.
 *
 * Also exposes helpers for registry maintenance:
 * - runDoctorNormalize: detect and optionally merge case-colliding callsigns
 * - runDoctorPurge: remove a registry entry by callsign
 *
 * @module commands/doctor
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { clonesMatch, normalisedPathKey, normalizeRemoteUrl } from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import type { Registry, RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { diagnoseCopilotPayload } from '@bradygaster/squad-sdk/copilot-payload';
import { resolveRegistryFilePath } from './_registry-path.js';
import { findCloseMatch } from '../lib/close-match.js';

export interface RunDoctorOpts {
  cwd: string;
  registryPath?: string;
  env?: Record<string, string>;
  /** Override user-scoped Copilot home for orphan detection (test seam). */
  copilotHome?: string;
}

export interface RunDoctorResult {
  severity: 'info' | 'warn' | 'error';
  findings: string[];
}

export interface NormalizeCallsignsOpts {
  registryPath?: string;
  env?: Record<string, string>;
  apply?: boolean;
  yes?: boolean;
  promptFn?: (question: string) => Promise<string>;
}

export interface NormalizeCallsignsResult {
  lines: string[];
  pairsFound: number;
  mergedCount: number;
}

export interface RunDoctorPurgeOpts {
  callsign: string;
  registryPath?: string;
  env?: Record<string, string>;
  yes?: boolean;
  promptFn?: (question: string) => Promise<string>;
}

export interface RunDoctorPurgeResult {
  noRegistry?: true;
  invalidCallsign?: true;
  notFound?: { suggestion: string | null };
  refused?: { consumers: string[] };
  cancelled?: boolean;
  removed?: boolean;
  hostPath?: string;
}

type Severity = RunDoctorResult['severity'];

/**
 * Report the resolution state and registry health for `opts.cwd`.
 *
 * Findings include:
 * - Local .squad/ directory presence
 * - Callsign resolution via SQUAD_CALLSIGN
 * - Origin resolution for the current directory
 * - Clone match for the current directory
 * - No-setup guidance when neither a local squad nor a registry is present
 * - Stale paths (registered path does not exist on disk)
 * - Ambiguous clone matches (more than one entry matches as a clone)
 * - Registry health: empty clones[], clone path ambiguity, origin overlap
 *
 * Severity rules:
 * - 'info'  — no squad found at all (guidance only)
 * - 'warn'  — stale paths, ambiguous matches, or registry health issues
 * - 'error' — requested callsign not in registry
 */
export async function runDoctor(opts: RunDoctorOpts): Promise<RunDoctorResult> {
  const findings: string[] = [];
  let severity: Severity = 'info';

  const escalate = (next: 'warn' | 'error'): void => {
    if (severity === 'error') return;
    if (next === 'error' || severity === 'info') {
      severity = next;
    }
  };

  const env = opts.env ?? {};
  const cwd = opts.cwd;

  // Local .squad/ presence
  const localSquadDir = path.join(cwd, '.squad');
  const hasLocalSquad = fs.existsSync(localSquadDir);
  if (hasLocalSquad) {
    findings.push(`Local .squad/ directory found at ${localSquadDir}.`);
  }

  // Resolve and load registry
  const registryFilePath = resolveRegistryFilePath({
    explicit: opts.registryPath,
    env,
  });
  const { registry } = loadRegistryFromDisk({
    registryPath: registryFilePath ?? undefined,
  });

  if (!hasLocalSquad && !registry) {
    findings.push(
      'No local .squad/ directory found and no registry exists. ' +
      'Run "squad init" to set up a squad in the current directory.',
    );
    return { severity: 'info', findings };
  }

  if (!registry) {
    findings.push(
      'No registry found. Run "squad init --callsign <name>" to create one, or "squad assign <callsign>" to bind this checkout.',
    );
    return { severity: 'info', findings };
  }

  const entries: RegistryEntry[] = registry.squads;

  // Callsign resolution via env
  const callsign = env['SQUAD_CALLSIGN'] ?? process.env['SQUAD_CALLSIGN'];
  if (callsign) {
    const entry = entries.find((e) => e.callsign === callsign);
    if (!entry) {
      findings.push(`Callsign "${callsign}" is not found in the registry.`);
      return { severity: 'error', findings };
    }
    findings.push(`Callsign "${callsign}" resolved to ${entry.path}.`);
    if (!fs.existsSync(entry.path)) {
      findings.push(`Registered path "${entry.path}" does not exist on disk (stale entry).`);
      escalate('warn');
    }
  }

  // Origin resolution for cwd
  const cwdNormalised = normalisedPathKey(cwd);
  const originMatches = entries.filter((entry) => {
    for (const origin of entry.origins ?? []) {
      if (normalisedPathKey(origin) === cwdNormalised) return true;
    }
    return false;
  });

  if (originMatches.length === 1) {
    const matched = originMatches[0]!;
    findings.push(
      `Origin match: current directory matches origin of "${matched.callsign ?? matched.path}".`,
    );
  } else if (originMatches.length > 1) {
    findings.push(
      `Ambiguous: ${originMatches.length} registry entries match the current directory as an origin.`,
    );
    escalate('warn');
  }

  // Clone resolution for cwd
  const cwdCloneMatches = entries.filter((entry) => {
    for (const clone of entry.clones ?? []) {
      try {
        if (clonesMatch(cwd, clone)) return true;
      } catch {
        // Skip invalid clone entries
      }
    }
    return false;
  });

  if (cwdCloneMatches.length === 1) {
    const matched = cwdCloneMatches[0]!;
    findings.push(
      `Clone match: current directory is a registered clone of "${matched.callsign ?? matched.path}".`,
    );
  } else if (cwdCloneMatches.length > 1) {
    findings.push(
      `Ambiguous: ${cwdCloneMatches.length} registry entries match the current directory as a clone.`,
    );
    escalate('warn');
  }

  // Stale path check across all entries
  for (const entry of entries) {
    if (!fs.existsSync(entry.path)) {
      findings.push(
        `Stale entry: "${entry.callsign ?? entry.path}" — registered path does not exist on disk.`,
      );
      escalate('warn');
    }
  }

  // Registry health: inactive entries with empty clones (informational)
  for (const entry of entries) {
    const clones = entry.clones ?? [];
    if (clones.length === 0 && entry.status === 'inactive') {
      const label = entry.callsign ?? entry.path;
      findings.push(
        `"${label}" is inactive with no clone bindings. ` +
        `Run "squad assign ${label}" to bind a checkout and reactivate it.`,
      );
    }
  }

  // Registry health: active (or implicitly active) entries with empty clones
  for (const entry of entries) {
    const clones = entry.clones ?? [];
    const isActive = entry.status !== 'inactive';
    if (clones.length === 0 && isActive) {
      const label = entry.callsign ?? entry.path;
      findings.push(
        `Warning: "${label}" is active but has an empty clones[] list. ` +
        `This entry is inconsistent. Use "squad assign ${label}" to bind a clone, ` +
        `or "squad doctor --purge ${label}" to remove the entry.`,
      );
      escalate('warn');
    }
  }

  // Registry health: clone path ambiguity across entries
  const entryClonePairs: Array<{ label: string; clonePath: string }> = entries.flatMap(entry => {
    const label = entry.callsign ?? entry.path;
    return (entry.clones ?? []).map(c => ({ label, clonePath: c }));
  });

  const reportedPairs = new Set<string>();
  for (let i = 0; i < entryClonePairs.length; i++) {
    for (let j = i + 1; j < entryClonePairs.length; j++) {
      const a = entryClonePairs[i]!;
      const b = entryClonePairs[j]!;
      if (a.label === b.label) continue;
      const pairKey = [a.label, b.label].sort().join('\0');
      if (reportedPairs.has(pairKey)) continue;
      if (_clonePathsOverlap(a.clonePath, b.clonePath)) {
        reportedPairs.add(pairKey);
        findings.push(
          `Warning: clone path ambiguity between "${a.label}" and "${b.label}". ` +
          `The same or overlapping clone path appears in both entries. ` +
          `Use an explicit callsign to disambiguate.`,
        );
        escalate('warn');
      }
    }
  }

  // Registry health: origin overlap across active entries
  const activeEntries = entries.filter(e => e.status !== 'inactive');
  const reportedOriginPairs = new Set<string>();
  for (let i = 0; i < activeEntries.length; i++) {
    for (let j = i + 1; j < activeEntries.length; j++) {
      const a = activeEntries[i]!;
      const b = activeEntries[j]!;
      const labelA = a.callsign ?? a.path;
      const labelB = b.callsign ?? b.path;
      const pairKey = [labelA, labelB].sort().join('\0');
      if (reportedOriginPairs.has(pairKey)) continue;
      const originsA = new Set((a.origins ?? []).map(normalizeRemoteUrl));
      for (const origin of b.origins ?? []) {
        if (originsA.has(normalizeRemoteUrl(origin))) {
          reportedOriginPairs.add(pairKey);
          findings.push(
            `Warning: origin overlap between "${labelA}" and "${labelB}". ` +
            `Both active entries share a Git origin, which can make origin-based resolution ambiguous.`,
          );
          escalate('warn');
          break;
        }
      }
    }
  }

  // Orphaned user-scoped payload entries
  const copilotHome = opts.copilotHome ?? path.join(os.homedir(), '.copilot');
  const knownCallsigns = entries.map(e => e.callsign).filter((c): c is string => !!c);
  const { orphans } = diagnoseCopilotPayload({ knownCallsigns, copilotHome });
  for (const orph of orphans) {
    findings.push(
      `Orphan ${orph.kind} payload: "${orph.pathOnDisk}" belongs to callsign "${orph.callsign}" ` +
      `which is not in the registry. Run "squad assign ${orph.callsign}" to re-bind, or remove manually.`,
    );
    escalate('warn');
  }

  return { severity, findings };
}

// ============================================================
// Internal helpers
// ============================================================

function _clonePathsOverlap(a: string, b: string): boolean {
  try {
    const keyA = normalisedPathKey(a);
    const keyB = normalisedPathKey(b);
    if (keyA === keyB) return true;
    const sepA = keyA.endsWith(path.sep) ? keyA : keyA + path.sep;
    const sepB = keyB.endsWith(path.sep) ? keyB : keyB + path.sep;
    return keyA.startsWith(sepB) || keyB.startsWith(sepA);
  } catch {
    return false;
  }
}

// ============================================================
// Normalize callsigns
// ============================================================

/**
 * Detect and optionally merge callsign pairs whose lowercased values are equal
 * while their original values differ.
 *
 * Default is dry-run: reports collisions without writing the registry.
 * With `apply: true`, merges each collision group into a deterministic survivor.
 * With `yes: true`, skips per-merge confirmation prompts.
 */
export async function runDoctorNormalize(opts: NormalizeCallsignsOpts): Promise<NormalizeCallsignsResult> {
  const lines: string[] = [];
  const registryFilePath = resolveRegistryFilePath({
    explicit: opts.registryPath,
    env: opts.env,
  });

  if (!registryFilePath) {
    lines.push('No registry found. Nothing to normalize.');
    return { lines, pairsFound: 0, mergedCount: 0 };
  }

  const { registry } = loadRegistryFromDisk({ registryPath: registryFilePath });
  if (!registry) {
    lines.push('No registry found. Nothing to normalize.');
    return { lines, pairsFound: 0, mergedCount: 0 };
  }

  const entries: RegistryEntry[] = registry.squads;

  // Group entries with callsigns by lowercased callsign
  const groups = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    if (!entry.callsign) continue;
    const key = entry.callsign.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  // Collect collision groups (2+ entries with same lowercase callsign)
  const collisionGroups: RegistryEntry[][] = [];
  for (const group of groups.values()) {
    if (group.length >= 2) collisionGroups.push(group);
  }

  const pairsFound = collisionGroups.length;

  if (pairsFound === 0) {
    lines.push('No case-colliding callsign pairs found.');
    return { lines, pairsFound: 0, mergedCount: 0 };
  }

  // Report collisions
  for (const group of collisionGroups) {
    const names = group.map(e => `"${e.callsign}"`).join(', ');
    const survivor = _pickSurvivor(group, entries);
    lines.push(`Collision: ${names} — proposed survivor: "${survivor.callsign}"`);
  }

  if (!opts.apply) {
    lines.push(`Run with --apply to merge ${pairsFound} collision${pairsFound === 1 ? '' : 's'}.`);
    return { lines, pairsFound, mergedCount: 0 };
  }

  // Apply mode: process each collision group
  let mergedCount = 0;
  let currentEntries: RegistryEntry[] = [...entries];

  for (const group of collisionGroups) {
    const lowerKey = group[0]!.callsign!.toLowerCase();
    const liveGroup = currentEntries.filter(e => e.callsign?.toLowerCase() === lowerKey);
    if (liveGroup.length < 2) continue;

    // Prompt unless --yes
    if (!opts.yes) {
      const names = liveGroup.map(e => `"${e.callsign}"`).join(', ');
      const survivor = _pickSurvivor(liveGroup, currentEntries);
      const answer = await (opts.promptFn ?? _defaultPromptFn)(
        `Merge ${names} into "${survivor.callsign}"? [y/N] `,
      );
      if (!answer.trim().toLowerCase().startsWith('y')) {
        lines.push(`Skipped: ${names}`);
        continue;
      }
    }

    const survivor = _pickSurvivor(liveGroup, currentEntries);
    const losers = liveGroup.filter(e => e !== survivor);
    const merged = _mergeIntoSurvivor(survivor, losers);

    // Remove all group members from currentEntries
    currentEntries = currentEntries.filter(e => e.callsign?.toLowerCase() !== lowerKey);

    // Re-insert the merged survivor just before the first remaining entry that
    // follows the group's original position (recomputed against mutated array).
    const firstGroupOrigIdx = entries.findIndex(e => e.callsign?.toLowerCase() === lowerKey);
    let insertAt = currentEntries.length;
    for (let i = 0; i < currentEntries.length; i++) {
      const origIdx = entries.indexOf(currentEntries[i]!);
      if (origIdx !== -1 && origIdx > firstGroupOrigIdx) {
        insertAt = i;
        break;
      }
    }
    currentEntries.splice(insertAt, 0, merged);

    lines.push(`Merged: "${merged.callsign}" (combined ${liveGroup.length} entries)`);
    mergedCount++;
  }

  if (mergedCount > 0) {
    const updatedRegistry: Registry = { version: registry.version, squads: currentEntries };
    fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
    writeRegistry(registryFilePath, updatedRegistry);
  }

  return { lines, pairsFound, mergedCount };
}

/**
 * Select the survivor from a collision group.
 *
 * Preference order:
 * 1. Active entries (status !== 'inactive')
 * 2. More clone bindings
 * 3. Registry order (first in original squads[])
 */
function _pickSurvivor(group: RegistryEntry[], allEntries: RegistryEntry[]): RegistryEntry {
  const scored = group.map(entry => {
    const activityScore = entry.status !== 'inactive' ? 1 : 0;
    const cloneScore = (entry.clones ?? []).length;
    const orderScore = allEntries.indexOf(entry);
    return { entry, activityScore, cloneScore, orderScore };
  });

  scored.sort((a, b) => {
    if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
    if (b.cloneScore !== a.cloneScore) return b.cloneScore - a.cloneScore;
    return a.orderScore - b.orderScore;
  });

  return scored[0]!.entry;
}

/**
 * Merge losers into the survivor entry.
 *
 * - Merge clones with platform-aware path deduplication
 * - Merge origins with normalized URL deduplication
 * - Status is active when either side is active (non-inactive)
 * - Preserve forward-compatible fields from survivor
 */
function _mergeIntoSurvivor(survivor: RegistryEntry, losers: RegistryEntry[]): RegistryEntry {
  const allEntries = [survivor, ...losers];

  // Merge clones (deduplicate by normalisedPathKey)
  const seenCloneKeys = new Set<string>();
  const mergedClones: string[] = [];
  for (const entry of allEntries) {
    for (const clone of entry.clones ?? []) {
      const key = normalisedPathKey(clone);
      if (!seenCloneKeys.has(key)) {
        seenCloneKeys.add(key);
        mergedClones.push(clone);
      }
    }
  }

  // Merge origins (deduplicate by normalized URL)
  const seenOriginKeys = new Set<string>();
  const mergedOrigins: string[] = [];
  for (const entry of allEntries) {
    for (const origin of entry.origins ?? []) {
      const key = normalizeRemoteUrl(origin);
      if (!seenOriginKeys.has(key)) {
        seenOriginKeys.add(key);
        mergedOrigins.push(origin);
      }
    }
  }

  // Merged status: active when any side is non-inactive
  const mergedStatus: 'active' | 'inactive' = allEntries.some(e => e.status !== 'inactive') ? 'active' : 'inactive';

  return {
    ...survivor,
    clones: mergedClones,
    origins: mergedOrigins,
    status: mergedStatus,
  };
}

async function _defaultPromptFn(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise(resolve => {
    let line = '';
    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      const newlineIdx = str.indexOf('\n');
      if (newlineIdx !== -1) {
        line += str.slice(0, newlineIdx);
        process.stdin.off('data', onData);
        process.stdin.pause();
        resolve(line);
      } else {
        line += str;
      }
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

// ============================================================
// Purge
// ============================================================

const _CALLSIGN_RE = /^[A-Za-z0-9_-]+$/;
const _MAX_CALLSIGN_LEN = 64;

/**
 * Remove a registry entry by callsign.
 *
 * - Invalid callsign format: returns { invalidCallsign: true }
 * - Registry absent/corrupt: returns { noRegistry: true }
 * - Not found: returns { notFound: { suggestion } }
 * - Active with clone consumers: returns { refused: { consumers } }
 * - Inactive or active with empty clones: removes after confirmation
 * - --yes skips confirmation
 * - Does not delete host directory from disk
 */
export async function runDoctorPurge(opts: RunDoctorPurgeOpts): Promise<RunDoctorPurgeResult> {
  // N4: Validate callsign format before any registry I/O
  if (!_CALLSIGN_RE.test(opts.callsign) || opts.callsign.length > _MAX_CALLSIGN_LEN) {
    return { invalidCallsign: true };
  }

  const registryFilePath = resolveRegistryFilePath({
    explicit: opts.registryPath,
    env: opts.env,
  });

  if (!registryFilePath) {
    return { noRegistry: true };
  }

  const { registry } = (() => {
    try {
      return loadRegistryFromDisk({ registryPath: registryFilePath });
    } catch {
      return { registry: null };
    }
  })();

  // F4: Distinguish missing/corrupt registry from entry not found
  if (!registry) {
    return { noRegistry: true };
  }

  const entries: RegistryEntry[] = registry.squads;

  const entry = entries.find(e => e.callsign === opts.callsign);

  if (!entry) {
    const callsigns = entries.map(e => e.callsign).filter((c): c is string => typeof c === 'string');
    const suggestion = findCloseMatch(opts.callsign, callsigns);
    return { notFound: { suggestion } };
  }

  // Refuse if active with clone consumers
  const consumers = entry.clones ?? [];
  if (entry.status !== 'inactive' && consumers.length > 0) {
    return { refused: { consumers: [...consumers] } };
  }

  // N1: Use async promptFn (consistent with runDoctorNormalize)
  if (!opts.yes) {
    const answer = await (opts.promptFn ?? _defaultPromptFn)(
      `Remove registry entry "${opts.callsign}" from the registry? This cannot be undone. [y/N] `,
    );
    if (!answer.trim().toLowerCase().startsWith('y')) {
      return { cancelled: true };
    }
  }

  // Remove entry using raw read-modify-write (no upsert)
  const updatedSquads = entries.filter(e => e !== entry);
  const updatedRegistry: Registry = {
    version: registry.version ?? 1,
    squads: updatedSquads,
  };
  fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
  writeRegistry(registryFilePath, updatedRegistry);

  return { removed: true, hostPath: entry.path };
}
