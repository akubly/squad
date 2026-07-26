import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const content = readFileSync(resolve(ROOT, '.squad-templates/squad.agent.md'), 'utf-8');

function blockBetween(startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`Could not locate block: ${startMarker}`);
  }
  return content.slice(start, end);
}

describe('squad.agent TEAM_ROOT path discipline', () => {
  it('keeps lightweight decision writes anchored at TEAM_ROOT', () => {
    const block = blockBetween('**Lightweight Spawn Template**', '### Per-Agent Model Selection');
    expect(block).toContain('{TEAM_ROOT}/.squad/scripts/notes/write-note.ps1');
    expect(block).toContain('{TEAM_ROOT}/.squad/decisions/inbox/{name}-{brief-slug}.md');
    expect(block).not.toContain('write to .squad/decisions/inbox/{name}-{brief-slug}.md');
  });

  it('anchors agent read/write paths at TEAM_ROOT in the standard spawn template', () => {
    const block = blockBetween('**Template for any agent**', '### ❌ What NOT to Do (Anti-Patterns)');
    const required = [
      'Read {TEAM_ROOT}/.squad/agents/{name}/history.md',
      'Read {TEAM_ROOT}/.squad/decisions.md',
      'If {TEAM_ROOT}/.squad/identity/wisdom.md exists, read it before starting work.',
      'If {TEAM_ROOT}/.squad/identity/now.md exists, read it at spawn time.',
      'Check {TEAM_ROOT}/.copilot/skills/ for copilot-level skills',
      'Check {TEAM_ROOT}/.squad/skills/ for team-level skills',
      'APPEND to {TEAM_ROOT}/.squad/agents/{name}/history.md under "## Learnings":',
      '{TEAM_ROOT}/.squad/decisions/inbox/{name}-{brief-slug}.md',
      '{TEAM_ROOT}/.squad/skills/{skill-name}/SKILL.md',
      '{TEAM_ROOT}/.squad/scripts/notes/write-note.ps1',
    ];

    for (const snippet of required) {
      expect(block).toContain(snippet);
    }

    const forbidden = [
      'Read .squad/agents/{name}/history.md',
      'Read .squad/decisions.md',
      'If .squad/identity/wisdom.md exists, read it before starting work.',
      'If .squad/identity/now.md exists, read it at spawn time.',
      'Check .copilot/skills/ for copilot-level skills',
      'Check .squad/skills/ for team-level skills',
      'APPEND to .squad/agents/{name}/history.md under "## Learnings":',
      '\n     .squad/skills/{skill-name}/SKILL.md',
      'powershell .squad/scripts/notes/write-note.ps1',
    ];

    for (const snippet of forbidden) {
      expect(block).not.toContain(snippet);
    }
  });

  it('anchors Scribe state writes at SQUAD_DIR and removes stale decisions path entries', () => {
    const block = blockBetween('description: "📋 Scribe: Log session & merge decisions"', '5. **Immediately assess:**');
    expect(block).toContain('SQUAD_DIR: {TEAM_ROOT}/.squad');
    expect(block).toContain('Read {SQUAD_DIR}/agents/scribe/charter.md.');
    expect(block).toContain('Merge {SQUAD_DIR}/decisions/inbox/ → {SQUAD_DIR}/decisions.md');
    expect(block).toContain('Write {SQUAD_DIR}/orchestration-log/{timestamp}-{agent}.md');
    expect(block).toContain('Write {SQUAD_DIR}/log/{timestamp}-{topic}.md');
    expect(content).toContain('.squad/decisions.md merge=union');
    expect(content).not.toContain('.squad/decisions/decisions.md');
  });
});
