/**
 * Shared helper for resolving the `squad_state` MCP launch spec.
 *
 * Used by BOTH `squad init` and `squad upgrade` so the runtime-MCP fallback
 * behavior stays symmetric.
 *
 * Resolution order (iter-7, simplified to 2 tiers):
 *   1. If `cliVersion` IS published on npm → `npx -y <pkg>@<version> state-mcp`
 *      (clean cross-machine UX, the steady-state happy path).
 *   2. Else → `npx -y <pkg>@insider state-mcp`. We do NOT probe the registry;
 *      the `@insider` dist-tag is kept fresh by the publish flow and tier-2
 *      is the de-facto fallback whenever a pinned preview version isn't yet
 *      published. If it really isn't reachable at runtime, `npx` will fail
 *      loudly — same observable behavior as pre-iter-5.
 *
 * Iter-6 had two additional tiers (a local-install path resolver and a hard
 * error) that the smoke data showed never fired in practice: `@insider` is
 * always current, so tier-2 always wins before tier-3 is reached. Deleted
 * in iter-7 per the "verify you didn't add code that's no longer needed"
 * mandate.
 */

export interface SquadStateMcpSpec {
  /** Executable to spawn (always `npx` after iter-7). */
  command: string;
  /** Argv for the executable. */
  args: string[];
  /** How the spec was resolved — useful for logging + tests. */
  source: 'pinned' | 'insider' | 'local-bin';
}

const PACKAGE_NAME = '@wifi-aware/squad-cli';

/**
 * Piece 57 §D (decision H1) — locally-resolvable launch spec for the
 * `squad_state` MCP bridge in a MANAGED consumer clone.
 *
 * `resolveSquadStateMcpSpec` emits an `npx -y @wifi-aware/squad-cli@<tag>`
 * command. That is correct for a published package, but the managed fork's
 * scope is unpublished, so `npx` resolves to an E401 and Copilot can never
 * spawn the bridge in the product clone. The managed cold-start / `squad link`
 * path instead writes THIS spec: the `squad` binary is already on PATH (the
 * user just ran `squad assign`/`squad link`), so `squad state-mcp` resolves on
 * this machine with no network. H2 (a pinned `npx` follow-up) is deferred until
 * the scope is published — see `.squad/decisions/inbox/piece-57-triage.md`.
 */
export function localSquadStateMcpSpec(): SquadStateMcpSpec {
  return { command: 'squad', args: ['state-mcp'], source: 'local-bin' };
}

export interface ResolveSquadStateMcpSpecOptions {
  /**
   * Override the published-version check. Tests inject this to avoid real
   * network traffic.
   */
  publishedCheck?: (version: string) => Promise<boolean>;
}

/** Reset internal caches (test-only helper; retained for compat). */
export function _resetMcpSpecCache(): void {
  // no caches in the 2-tier resolver — kept as a no-op for backward compat
  // with any test that still calls it.
}

/**
 * Resolve the squad_state MCP launch spec given the running CLI version.
 *
 * Always returns a spec. If the pinned version is unpublished we fall back
 * to `@insider`; if even that turns out to be unreachable at runtime, `npx`
 * will fail visibly when Copilot launches the MCP server — same behavior
 * as pre-iter-5.
 */
export async function resolveSquadStateMcpSpec(
  cliVersion: string,
  options: ResolveSquadStateMcpSpecOptions = {},
): Promise<SquadStateMcpSpec> {
  // 1. Try the pinned version on the public registry. Skip for placeholder
  //    versions ('', '0.0.0') and local/dev builds with build metadata ('+')
  //    — the registry will obviously not have them (#1204).
  if (cliVersion && cliVersion !== '0.0.0' && !cliVersion.includes('+')) {
    const probe = options.publishedCheck ?? defaultPublishedCheck;
    const published = await probe(cliVersion);
    if (published) {
      return {
        command: 'npx',
        args: ['-y', `${PACKAGE_NAME}@${cliVersion}`, 'state-mcp'],
        source: 'pinned',
      };
    }
  }

  // 2. Fall back to the @insider dist-tag — always returned, never probed.
  return {
    command: 'npx',
    args: ['-y', `${PACKAGE_NAME}@insider`, 'state-mcp'],
    source: 'insider',
  };
}

async function defaultPublishedCheck(version: string): Promise<boolean> {
  const { isSquadCliVersionPublished } = await import('./npm-registry.js');
  return await isSquadCliVersionPublished(version);
}
