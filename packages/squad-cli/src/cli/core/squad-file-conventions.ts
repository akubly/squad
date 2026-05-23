/**
 * Shared file convention lists managed by squad upgrade and verified by squad doctor.
 * Keep these constants dependency-free so CLI core utilities can import them safely.
 */

export const GITATTRIBUTES_RULES = [
  '.squad/decisions.md merge=union',
  '.squad/agents/*/history.md merge=union',
  '.squad/log/** merge=union',
  '.squad/orchestration-log/** merge=union',
];

export const GITIGNORE_ENTRIES = [
  '.squad/orchestration-log/',
  '.squad/log/',
  '.squad/decisions/inbox/',
  '.squad/sessions/',
  '.squad-workstream',
];

/** Canonical badge text for the Copilot Coding Agent roster entry. */
export const CODING_AGENT_BADGE = '🤖 Coding Agent';

/**
 * Returns true if the given content (typically team.md) includes a Copilot
 * Coding Agent entry, detected by either the badge or the @copilot handle.
 *
 * Use this instead of inline `content.includes('🤖 Coding Agent')` checks.
 */
export function hasCodingAgent(content: string): boolean {
  return content.includes(CODING_AGENT_BADGE) || content.includes('@copilot');
}
