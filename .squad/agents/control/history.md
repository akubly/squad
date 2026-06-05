# CONTROL

> Control System Engineer

📌 **Team update (2026-06-05T12:54:00Z — Piece 32 Adversarial Review Complete):** CONTROL conducted adversarial type-system and build-pipeline review of piece 32 (registry state fields, commit `f35fa9b5`). Core hypothesis: regex statefulness verified SAFE — `/^[a-z][a-z0-9-]{1,38}$/` has no flags, repeated `.test()` calls return consistent results. Verification: SDK tsc exit 0 (clean under strict+noUncheckedIndexedAccess), CLI tsc exit 2 but all failures pre-existing (stale node_modules), piece 32 introduces zero new type errors. Build emit verified: both `dist/validation.js` and `dist/validation.d.ts` exist. All 79 SDK tests pass. Findings: 5 nits (forward-risk from trailing/consecutive hyphen acceptance for piece 33/34 branch naming, DRY violation in error message, JSDoc misplacement, package.json indentation cosmetic, test coverage gap for trailing-hyphen contract). No blockers. Verdict: **APPROVE-WITH-NITS**. Decision drop merged to `.squad/decisions.md`.

📌 **Team update (2026-05-19 — Piece 18 Revision Complete):** Piece 18 doctor enhancements (EECOM implementation) revised by CONTROL per adversarial review (F1–F7, N1–N5). All 33 unit tests and 7 CLI-layer subprocess tests pass. CRLF normalization applied to cli-entry.ts. Branch `akubly/upstream-18-doctor-enhancements` force-pushed to `c515745b`.

## Archive — Older Learnings (see `history-archive.md` for pre-2026-06-05 full details)

📌 **2026-06-05: Specs 32-35 staged on akubly/upstream-specs (commit 211102b4). New cross-repo arc kickoff is piece 32 (off piece 25.5). Replaces archived pieces 26-31. See upstream specs for design + prompts at _planning/prompts/.**

## Learnings

### Piece 32 — Registry state fields adversarial review (2026-06-05)

**Verdict: ⚠️ APPROVE-WITH-NITS** — commit `f35fa9b5`, author EECOM.

**Critical regex /g flag trap (confirmed safe):** `DEVELOPER_ALIAS_RE = /^[a-z][a-z0-9-]{1,38}$/` has no flags. A `/g` flag on a shared exported regex causes `lastIndex` statefulness: the first `.test()` on a matching string advances `lastIndex`, so the second call returns `false`. This is a real, non-obvious failure mode for exported regex constants. Always check the flags of any exported regex during review. Confirmed: `re.flags === ""`, repeated `.test()` calls are stateless. Simulated `/g` version confirmed 1st=true, 2nd=false on same input.

**Trailing/consecutive hyphens: forward-risk from spec-faithful regex.** The spec defined the regex exactly as `/^[a-z][a-z0-9-]{1,38}$/` without prohibiting trailing or consecutive hyphens. `"ab-"` and `"a--b"` are both accepted. This is correct for piece 32 but becomes a problem when piece 33/34 interpolates `developerAlias` into `squad/inbox/<alias>/...` branch names. The downstream piece author must not assume the stored alias is safe for raw branch-name interpolation. Tighten the regex to `/^[a-z][a-z0-9]([a-z0-9-]*[a-z0-9])?$/` before piece 33 ships, OR add a sanitiser at interpolation time.

**Conditional spread JSON-absence confirmed:** `...(x !== undefined ? { key: x } : {})` correctly omits the key entirely from `JSON.stringify` output when the flag is not supplied. Property is truly absent (not `undefined`-valued). `toMatchObject` and `.not.toHaveProperty()` in Vitest cover this correctly.

**Build emit verification process:** After adding a new subpath export, the required verification is: (1) `npm run build` exits 0, (2) `dist/<name>.js` exists, (3) `dist/<name>.d.ts` exists and exports the correct symbol, (4) JSON structure of package.json `exports` is valid via `node -e "require('./package.json')"`. All four passed for `./validation`.


