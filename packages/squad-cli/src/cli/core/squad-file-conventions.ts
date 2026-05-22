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
