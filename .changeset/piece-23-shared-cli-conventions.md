---
"@bradygaster/squad-cli": patch
---

Extract shared CLI conventions to eliminate per-file copy-paste (piece 23).

- `hasCodingAgent()` and `CODING_AGENT_BADGE` exported from `squad-file-conventions.ts`; inline `content.includes('🤖 Coding Agent')` checks removed from `upgrade.ts`, `doctor.ts`, and `watch/index.ts`; `hasCopilot()` in `team-md.ts` delegates to `hasCodingAgent()` and is marked `@deprecated`
- `resolveSquadDir()` extracted to `cli/core/squad-resolver.ts`; per-file local wrappers removed from `cli-entry.ts`, `config.ts`, `cross-squad.ts`, and `economy.ts` (economy's manual 10-level walk replaced)
- Ambient type declaration added at `src/types/qrcode-terminal.d.ts`; `@ts-ignore`/`@ts-expect-error` suppressions removed from `rc.ts` and `start.ts`
