/**
 * Piece 58 §C — the unconditional `agent_type` invariant + plugin-agent
 * prohibition must live in the ALWAYS-LOADED coordinator body (not only in the
 * on-demand spawn-reference.md), and be byte-identical across all 5 synced
 * copies of the coordinator template.
 *
 * Regression framing: a managed consumer with an installed plugin agent
 * (e.g. `mobcon-dev-tools:*`) could be routed as a cast member's `agent_type`,
 * bypassing the inline charter and the state/governance envelope. The guardrail
 * must hold even when the on-demand reference has not been hydrated.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

const CANONICAL = '.squad-templates/squad.agent.md';
const SQUAD_AGENT_LOCATIONS = [
  CANONICAL,
  'templates/squad.agent.md.template',
  '.github/agents/squad.agent.md',
  'packages/squad-cli/templates/squad.agent.md.template',
  'packages/squad-sdk/templates/squad.agent.md.template',
] as const;

/** Stable anchor the fix introduces; a future refactor must preserve it. */
const ANCHOR = /`agent_type` invariant/i;

function assertInvariantBody(content: string, label: string): void {
  const idx = content.search(ANCHOR);
  expect(idx, `${label}: missing "agent_type invariant" anchor`).toBeGreaterThanOrEqual(0);
  const tail = content.slice(idx, idx + 700);
  // Closed set: exactly general-purpose, or explore for read-only.
  expect(tail, `${label}: must pin general-purpose as the required type`).toMatch(
    /MUST be exactly `general-purpose`/,
  );
  expect(tail, `${label}: must allow explore for read-only`).toMatch(/`explore`/);
  // Explicit plugin/custom prohibition with a concrete example.
  expect(tail, `${label}: must prohibit plugin/custom agent types`).toMatch(/NEVER/);
  expect(tail, `${label}: must name the plugin/custom class`).toMatch(/plugin\/custom/i);
  expect(tail, `${label}: must give the mobcon-dev-tools example`).toMatch(/mobcon-dev-tools:\*/);
  // Charter is delivered inline (not via the plugin agent).
  expect(tail, `${label}: must state the charter is delivered inline`).toMatch(/inline/i);
}

describe('piece 58 §C — coordinator agent_type invariant', () => {
  it('canonical always-loaded body carries the invariant', () => {
    assertInvariantBody(read(CANONICAL), CANONICAL);
  });

  describe('agent_type invariant parity across all 5 synced copies', () => {
    for (const loc of SQUAD_AGENT_LOCATIONS) {
      it(`${loc} contains the agent_type invariant`, () => {
        assertInvariantBody(read(loc), loc);
      });
    }
  });
});
