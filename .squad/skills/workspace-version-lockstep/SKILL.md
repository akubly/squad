# SKILL: Workspace Version Lockstep

> Enforcing single-invocation version bumping and cross-pin consistency in an npm workspaces monorepo.

---

## The Problem

In a monorepo with internal workspace dependencies, version drift occurs when:
- A version bump is applied to **some** packages but not all (e.g., a manual hotfix commit that touches only one workspace's `package.json`).
- A build script that is supposed to fire once fires multiple times (one per workspace), producing a staircase of versions.
- A workspace package pins a sibling at version X, but the sibling is only built/published at version Y.

**Failure mode:** The CLI publishes a `dependencies["@wifi-aware/squad-sdk"]` pin pointing at a version that does not exist in any registry. This explodes on `npm install` for consumers and silently resolves stale builds at runtime if a previous version is cached in `node_modules`.

---

## The Pattern

### 1. Single prebuild hook at root only

```json
// Root package.json — the ONLY place prebuild should live
{
  "scripts": {
    "prebuild": "node scripts/bump-build.mjs",
    "build": "npm run build -w packages/pkg-a && npm run build -w packages/pkg-b"
  }
}
```

Workspace `package.json` files **must not** define a `prebuild` that calls the bump script. Their `build` script compiles only.

### 2. Bump script updates ALL workspace package.json files atomically

```javascript
const PACKAGE_PATHS = [
  join(root, 'package.json'),                           // canonical version source
  join(root, 'packages', 'pkg-a', 'package.json'),
  join(root, 'packages', 'pkg-b', 'package.json'),
];

// Read canonical version from root, increment, write to all paths.
const rootPkg = JSON.parse(readFileSync(PACKAGE_PATHS[0], 'utf8'));
const parsed = parseVersion(rootPkg.version);
parsed.build += 1;
const newVersion = formatVersion(parsed);

for (const pkgPath of PACKAGE_PATHS) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = newVersion;
  rewriteWorkspacePins(pkg, pkgPath, newVersion);   // ← also updates cross-pins
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}
```

### 3. Cross-pin rewriter

```javascript
function rewriteWorkspacePins(pkg, pkgPath, newVersion) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith('@your-scope/') && /^[~^]?\d/.test(spec)) {
        deps[name] = newVersion;
      }
    }
  }
}
```

The version spec check `/^[~^]?\d/` deliberately skips `workspace:`, `file:`, and `link:` specifiers so local monorepo references are untouched.

### 4. Idempotency guard via `npm_package_name`

npm sets `npm_package_name` to the current package's `name` field for every script invocation.

```javascript
const callerPkg = process.env.npm_package_name ?? '';
if (callerPkg.startsWith('@your-scope/pkg-')) {
  // Called from a workspace's prebuild — root already ran this. Skip.
  process.exit(0);
}
```

This is zero-cost (no file I/O) and self-documenting.

---

## Diagnostic: detecting drift from build output

npm prints a banner before running each script:

```
> @your-scope/pkg-a@1.2.3-preview.10 build
> @your-scope/pkg-b@1.2.3-preview.11 build
```

If the version numbers differ within a **single root build run**, a drift commit exists between HEAD and the last lockstep bump. Procedure:

1. `git log --oneline -- packages/*/package.json package.json` — find the commit(s) where versions diverged.
2. Check whether all three files were touched in the same commit.
3. If only one or two were updated: apply the "highest on disk wins" rule — bring all lower files to the highest version.
4. Verify: `SKIP_BUILD_BUMP=1 npm run build` — all banners must show the same version.

---

## Verification gates

| Gate | Command | Expected |
|------|---------|----------|
| Consistent build (no bump) | `SKIP_BUILD_BUMP=1 npm run build` | All workspace banners at same version; cli's sdk pin matches |
| Single-invocation bump | `npm run build` | All three `package.json` move by exactly +1; cli pin updates to match |
| Tests | `npm test` | No new failures vs baseline |

---

## Anti-patterns

| ❌ Don't | ✅ Do instead |
|---------|--------------|
| Edit one workspace's `package.json` version manually | Run `node scripts/bump-build.mjs` or edit all three atomically |
| Add `prebuild` to a workspace that calls the bump script | Keep `prebuild` at root only |
| Pin a sibling workspace at a version different from root | Let `rewriteWorkspacePins` maintain the pin |
| Use `workspace:*` AND a semver pin for the same dep | Pick one: `workspace:*` for local-only, semver pin for publishable releases |
