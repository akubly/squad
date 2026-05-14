### 2026-05-13: Template path for register install step

**By:** EECOM

**What:** The spec for piece 06 lists `packages/squad-cli/templates/squad.agent.md` as the canonical coordinator template that `register` should copy to the user-global Copilot agents directory. The existing repo ships the coordinator template at `packages/squad-cli/templates/squad.agent.md.template` (used by `init`/`upgrade`). To avoid duplicating the 94 KB file, the install helper in `register.ts` tries `squad.agent.md` first and falls back to `squad.agent.md.template`. The fallback-first logic is forward-compatible with piece 11a, which is expected to formalize the unsuffixed path.

**Why:** Duplicating the template file would create a maintenance burden and diverge from the existing `init`/`upgrade` pipeline. The two-candidate lookup preserves the spec's functional intent — stamped coordinator file installed at `<home>/.copilot/agents/squad.agent.md` — while staying consistent with the current template structure. If piece 11a creates the unsuffixed `squad.agent.md`, the helper will automatically prefer it with no code change required.
