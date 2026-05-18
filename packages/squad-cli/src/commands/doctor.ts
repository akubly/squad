/**
 * Registry-aware doctor command module.
 *
 * Reports the resolution state and registry health for the current working
 * directory. Returns structured findings instead of printing directly so
 * the CLI entry point can own console rendering and exit-code mapping.
 *
 * @module commands/doctor
 */

import fs from 'node:fs';
import path from 'node:path';
import { clonesMatch, normalisedPathKey } from '@bradygaster/squad-sdk';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import type { RegistryEntry } from '@bradygaster/squad-sdk/registry';
import { resolveRegistryFilePath } from './_registry-path.js';

export interface RunDoctorOpts {
  cwd: string;
  registryPath?: string;
  env?: Record<string, string>;
}

export interface RunDoctorResult {
  severity: 'info' | 'warn' | 'error';
  findings: string[];
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
 *
 * Severity rules:
 * - 'info'  — no squad found at all (guidance only)
 * - 'warn'  — stale paths or ambiguous matches
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

  return { severity, findings };
}
