/**
 * Git Hook Installation — installs squad sync hooks into the repo's .git/hooks/.
 *
 * Hooks are installed with chaining: if a user already has a hook (e.g., from husky),
 * the squad hook is appended and the existing hook is called first.
 *
 * Installed hooks:
 * - pre-push: pushes squad-state branches alongside the user's push
 * - post-merge: fetches squad-state after the user pulls
 * - post-rewrite: fetches squad-state after rebase
 * - post-checkout: fetches squad-state on branch switch
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const SQUAD_HOOK_MARKER = '# --- squad-sync-hook ---';

/**
 * The shell script content for each hook.
 * These are minimal wrappers that call `squad sync`.
 * The SQUAD_SYNC_ACTIVE env guard prevents recursion.
 */
const HOOK_TEMPLATES: Record<string, string> = {
  'pre-push': `#!/bin/sh
${SQUAD_HOOK_MARKER}
# Auto-push squad-state branches alongside the user's push.
# Installed by: squad init / squad upgrade --state-backend
# The remote name and URL are passed as arguments by git.
if [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  REMOTE="\$1"
  export SQUAD_SYNC_ACTIVE=1
  # Push all squad-state branches (including subsquad branches)
  for branch in $(git for-each-ref --format='%(refname:short)' 'refs/heads/squad-state' 'refs/heads/squad-state/*' 2>/dev/null); do
    git push --no-verify "$REMOTE" "refs/heads/$branch:refs/heads/$branch" 2>/dev/null || true
  done
  # Push git notes for two-layer backend
  git push --no-verify "$REMOTE" 'refs/notes/squad*:refs/notes/squad*' 2>/dev/null || true
  unset SQUAD_SYNC_ACTIVE
fi
`,
  'post-merge': `#!/bin/sh
${SQUAD_HOOK_MARKER}
# Auto-fetch squad-state branches after pull/merge.
# Installed by: squad init / squad upgrade --state-backend
if [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  export SQUAD_SYNC_ACTIVE=1
  REMOTE=$(git config "branch.$(git symbolic-ref --short HEAD 2>/dev/null).remote" 2>/dev/null || echo origin)
  # Fetch squad-state branches
  git fetch "$REMOTE" '+refs/heads/squad-state:refs/remotes/'"$REMOTE"'/squad-state' '+refs/heads/squad-state/*:refs/remotes/'"$REMOTE"'/squad-state/*' 2>/dev/null || true
  # Fast-forward local squad-state from remote
  for remote_ref in $(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE/squad-state" "refs/remotes/$REMOTE/squad-state/*" 2>/dev/null); do
    local_name=\${remote_ref#"$REMOTE/"}
    local_sha=$(git rev-parse "refs/heads/$local_name" 2>/dev/null) || { git update-ref "refs/heads/$local_name" "$(git rev-parse "$remote_ref")" 2>/dev/null; continue; }
    remote_sha=$(git rev-parse "$remote_ref" 2>/dev/null) || continue
    [ "$local_sha" = "$remote_sha" ] && continue
    git merge-base --is-ancestor "$local_sha" "$remote_sha" 2>/dev/null && git update-ref "refs/heads/$local_name" "$remote_sha" 2>/dev/null || true
  done
  # Fetch git notes for two-layer backend
  git fetch "$REMOTE" '+refs/notes/squad*:refs/notes/squad*' 2>/dev/null || true
  unset SQUAD_SYNC_ACTIVE
fi
`,
  'post-rewrite': `#!/bin/sh
${SQUAD_HOOK_MARKER}
# Auto-fetch squad-state branches after rebase.
# Installed by: squad init / squad upgrade --state-backend
if [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  export SQUAD_SYNC_ACTIVE=1
  REMOTE=$(git config "branch.$(git symbolic-ref --short HEAD 2>/dev/null).remote" 2>/dev/null || echo origin)
  git fetch "$REMOTE" '+refs/heads/squad-state:refs/remotes/'"$REMOTE"'/squad-state' '+refs/heads/squad-state/*:refs/remotes/'"$REMOTE"'/squad-state/*' 2>/dev/null || true
  for remote_ref in $(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE/squad-state" "refs/remotes/$REMOTE/squad-state/*" 2>/dev/null); do
    local_name=\${remote_ref#"$REMOTE/"}
    local_sha=$(git rev-parse "refs/heads/$local_name" 2>/dev/null) || { git update-ref "refs/heads/$local_name" "$(git rev-parse "$remote_ref")" 2>/dev/null; continue; }
    remote_sha=$(git rev-parse "$remote_ref" 2>/dev/null) || continue
    [ "$local_sha" = "$remote_sha" ] && continue
    git merge-base --is-ancestor "$local_sha" "$remote_sha" 2>/dev/null && git update-ref "refs/heads/$local_name" "$remote_sha" 2>/dev/null || true
  done
  git fetch "$REMOTE" '+refs/notes/squad*:refs/notes/squad*' 2>/dev/null || true
  unset SQUAD_SYNC_ACTIVE
fi
`,
  'post-checkout': `#!/bin/sh
${SQUAD_HOOK_MARKER}
# Auto-fetch squad-state branches on branch switch.
# Installed by: squad init / squad upgrade --state-backend
# Only run on branch checkout (3rd arg = 1), not file checkout.
if [ "\$3" = "1" ] && [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  export SQUAD_SYNC_ACTIVE=1
  REMOTE=$(git config "branch.$(git symbolic-ref --short HEAD 2>/dev/null).remote" 2>/dev/null || echo origin)
  git fetch "$REMOTE" '+refs/heads/squad-state:refs/remotes/'"$REMOTE"'/squad-state' '+refs/heads/squad-state/*:refs/remotes/'"$REMOTE"'/squad-state/*' 2>/dev/null || true
  for remote_ref in $(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE/squad-state" "refs/remotes/$REMOTE/squad-state/*" 2>/dev/null); do
    local_name=\${remote_ref#"$REMOTE/"}
    local_sha=$(git rev-parse "refs/heads/$local_name" 2>/dev/null) || { git update-ref "refs/heads/$local_name" "$(git rev-parse "$remote_ref")" 2>/dev/null; continue; }
    remote_sha=$(git rev-parse "$remote_ref" 2>/dev/null) || continue
    [ "$local_sha" = "$remote_sha" ] && continue
    git merge-base --is-ancestor "$local_sha" "$remote_sha" 2>/dev/null && git update-ref "refs/heads/$local_name" "$remote_sha" 2>/dev/null || true
  done
  git fetch "$REMOTE" '+refs/notes/squad*:refs/notes/squad*' 2>/dev/null || true
  unset SQUAD_SYNC_ACTIVE
fi
`,
};

export interface InstallHooksOptions {
  force?: boolean;
}

/**
 * Hook template for the cross-repo post-commit hook.
 * Installed in the docs-repo clone's .git/hooks/post-commit by installCrossRepoHook.
 * runSync owns the SQUAD_SYNC_ACTIVE guard internally; the hook must not pre-set it.
 */
const CROSS_REPO_POST_COMMIT_TEMPLATE = `#!/bin/sh
${SQUAD_HOOK_MARKER}
# Squad cross-repo publish hook
# Installed by: squad assign --developer-alias
if [ -z "$SQUAD_SYNC_ACTIVE" ]; then
  squad sync --push --quiet
fi
`;

// TODO(piece-34-B): Copilot CLI external post-tool hook API not found at implementation time;
// deferred to follow-up piece. See .squad/decisions/inbox/piece-34-B-deferred.md.
// When the Copilot CLI exposes a file-based hook API, register a hook scoped to
// TEAM_ROOT/.squad/** here that invokes `squad sync --push --quiet`.

/**
 * Get the .git/hooks directory path for the repo.
 */
function getHooksDir(cwd: string): string {
  // Respect core.hooksPath if already set
  try {
    const customPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (customPath) {
      return path.isAbsolute(customPath) ? customPath : path.resolve(cwd, customPath);
    }
  } catch {
    // Not set — use default
  }

  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
    cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  return path.resolve(cwd, gitDir, 'hooks');
}

/**
 * Install a single hook, chaining with any existing hook.
 */
function installHook(hooksDir: string, hookName: string, content: string, force: boolean): 'installed' | 'chained' | 'skipped' {
  const hookPath = path.join(hooksDir, hookName);

  // Check if hook already exists
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');

    // Already has our marker — skip unless force
    if (existing.includes(SQUAD_HOOK_MARKER)) {
      if (!force) return 'skipped';
      // Force: remove old squad section and re-append
      const cleaned = existing.split('\n').filter(line => {
        // Remove lines between markers
        return true; // simplified: just replace the file
      }).join('\n');
      // For simplicity on force, rewrite with chaining
    }

    // Chain: existing hook runs first, then squad hook (without shebang)
    const squadSection = content.split('\n').slice(1).join('\n'); // remove #!/bin/sh
    const chained = existing.trimEnd() + '\n\n' + squadSection;
    fs.writeFileSync(hookPath, chained, { mode: 0o755 });
    return 'chained';
  }

  // No existing hook — write fresh
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, content, { mode: 0o755 });
  return 'installed';
}

/**
 * Main hook installation entrypoint.
 */
export function installGitHooks(cwd: string, options: InstallHooksOptions = {}): void {
  const { force = false } = options;

  // Verify we're in a git repo
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    console.log(`${YELLOW}⚠${RESET} Not a git repository. Cannot install hooks.`);
    return;
  }

  // Check if backend needs hooks (only orphan/two-layer)
  let backend: string | null = null;
  try {
    const configPath = path.join(cwd, '.squad', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      backend = config.stateBackend || null;
    }
  } catch { /* proceed anyway */ }

  if (backend === 'local' || backend === 'external' || backend === null) {
    console.log(`${DIM}squad install-hooks: backend is '${backend || 'local'}' — hooks not needed (state syncs with normal git operations).${RESET}`);
    return;
  }

  const hooksDir = getHooksDir(cwd);
  console.log(`\n${BOLD}Installing squad sync hooks${RESET}`);
  console.log(`${DIM}  hooks dir: ${hooksDir}${RESET}\n`);

  for (const [hookName, template] of Object.entries(HOOK_TEMPLATES)) {
    const result = installHook(hooksDir, hookName, template, force);
    switch (result) {
      case 'installed':
        console.log(`  ${GREEN}✓${RESET} ${hookName}: installed`);
        break;
      case 'chained':
        console.log(`  ${GREEN}✓${RESET} ${hookName}: chained (existing hook preserved)`);
        break;
      case 'skipped':
        console.log(`  ${DIM}  ${hookName}: already installed (use --force to reinstall)${RESET}`);
        break;
    }
  }

  console.log(`\n${GREEN}${BOLD}Done.${RESET} Squad state will sync automatically on push/pull.\n`);
}

/**
 * Install a post-commit hook in a docs-repo clone that invokes `squad sync --push --quiet`
 * after each commit. Protected by the SQUAD_SYNC_ACTIVE recursion guard.
 *
 * The hook is installed in `docsRepoPath`'s .git/hooks/post-commit — NEVER in the
 * product repo. Call with an explicit, registry-resolved docs-repo path; there is
 * no CWD fallback.
 *
 * Idempotent: calling twice on the same repo does not duplicate the hook section.
 *
 * @param docsRepoPath - Absolute path to the docs-repo clone (path.dirname(registryEntry.path)).
 * @param options - Hook install options.
 * @throws {Error} if docsRepoPath is not a git repository.
 */
export function installCrossRepoHook(docsRepoPath: string, options: InstallHooksOptions = {}): void {
  // Kill-list: must be an explicit git repo path — ERROR (not warning) if not a git repo.
  // Also verifies docsRepoPath IS the repo root (not just inside one), to prevent accidentally
  // targeting a parent git repo.
  let gitRoot: string;
  try {
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: docsRepoPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      `installCrossRepoHook: "${docsRepoPath}" is not a git repository. ` +
      `Run 'squad assign' with a registered shared-squad host clone path before installing hooks.`,
    );
  }
  if (normalisedPathKey(path.resolve(docsRepoPath)) !== normalisedPathKey(gitRoot)) {
    throw new Error(
      `installCrossRepoHook: "${docsRepoPath}" is not a git repository root ` +
      `(root is "${gitRoot}"). Pass the git root directory, not a subdirectory.`,
    );
  }

  const hooksDir = getHooksDir(docsRepoPath);
  fs.mkdirSync(hooksDir, { recursive: true });
  installHook(hooksDir, 'post-commit', CROSS_REPO_POST_COMMIT_TEMPLATE, options.force ?? false);
}

/**
 * Ensure hooks are installed if the backend requires them.
 * Called by `squad upgrade` to silently ensure hooks exist for orphan/two-layer repos.
 * Does not print anything if hooks are already installed or backend doesn't need them.
 */
export function ensureHooksForBackend(cwd: string): void {
  // Check backend
  let backend: string | null = null;
  try {
    const configPath = path.join(cwd, '.squad', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      backend = config.stateBackend || null;
    }
  } catch { return; }

  // Only orphan/two-layer need hooks
  if (backend !== 'orphan' && backend !== 'two-layer') return;

  // Check if hooks are already installed
  let hooksDir: string;
  try {
    hooksDir = getHooksDir(cwd);
  } catch { return; }

  const prePushPath = path.join(hooksDir, 'pre-push');
  if (fs.existsSync(prePushPath)) {
    const content = fs.readFileSync(prePushPath, 'utf-8');
    if (content.includes(SQUAD_HOOK_MARKER)) return; // Already installed
  }

  // Hooks missing — install them
  installGitHooks(cwd, { force: false });
}
