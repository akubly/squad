### RETRO — Multi-Squad Security & Sharing Proposal

**Date:** 2026-05-15T23:06:53-07:00  
**Requested by:** Brady  
**Author:** RETRO (Security)

## Executive Summary

Multi-squad should treat **source provenance**, **storage location**, and **write target** as separate security facts.

- **Default posture:** verified squads load silently; unverified or cross-boundary actions degrade to read-only or require approval.
- **Core rule:** an agent may only write inside its own squad namespace unless an explicit grant exists.
- **Security enforcement lives in hooks/ACL evaluation**, not in prompts.
- **Shared append-only files must be sanitized collaboration records, not identity dumps, chat transcripts, or config mirrors.**
- **Org auto-update is safe for tools and cached verified content, not for silently overwriting repo-owned squad state.**

This keeps the common case invisible: a developer in an org repo with org/team squads sees no extra prompts until they cross a trust boundary.

## Design Principles

1. **Secure but invisible by default.** No prompts for already-verified, same-boundary work.
2. **Default deny across namespaces.** Cross-squad writes are special.
3. **Trust is contextual.** Provenance trust is not the same as write authority.
4. **Shared state is publication.** If it can land in git, treat it as broadly visible.
5. **Hooks beat instructions.** Provenance checks, ACL checks, and PII/secret filters must execute in code.

## 1) Trust Boundaries

### Proposed trust model

Use two dimensions:

1. **Origin trust** — who supplied the charter/skills/decisions.
2. **Target authority** — what that squad may modify in the current session.

| Tier | Source example | Provenance expectation | Default runtime mode | Default write authority |
|---|---|---|---|---|
| **T0 Personal** | User-local squad, personal OneDrive, personal repo | Local path or user-owned repo; may be unsigned | Full read of user-approved workspace | **Own namespace only**; product-code edits allowed only as the signed-in user, but no shared-governance writes |
| **T1 Team** | Repo-local `.squad/`, team-owned state repo | Trusted repo remote + pinned commit | Full read/write inside team namespace | Team-owned namespace and repo content allowed by repo policy |
| **T2 Org-managed** | Org-distributed charters/skills, central policy bundle | Trusted org source + signed commit/tag or protected release | Full read; policy hooks always active | Org policy files or cached org bundle only; no silent writes into repo-local team files |
| **T3 Built-in platform** | SDK/CLI built-ins | Shipped with verified release | Always active | Enforcement, verification, and policy evaluation only |

### What this means in practice

- A **personal agent can help in a team-owned codebase**, because the effective actor is still the signed-in developer.
- But personal agents should **not** be allowed to mutate **shared squad governance state** by default (`decisions.md`, shared histories, routing, charter bundles, ACL files).
- A personal squad entering a team repo should default to one of two modes:
  - **Advisory mode** for shared state (read + suggest)
  - **Contributor mode** for product code (write if user already has repo rights)

### Permissioning model

Every write request should evaluate:

`effective_permission = min(origin_trust, workspace_policy, granted_scope, storage_class)`

Where granted scopes are small and explicit, for example:

- `repo.content.write`
- `squad.namespace.write:self`
- `squad.namespace.append:self`
- `squad.namespace.append:foreign` (rare)
- `policy.manage` (very rare)
- `storage.connect:github|ado|onedrive|fs`

**Key rule:** provenance can enable loading, but it does not automatically grant cross-namespace write power.

## 2) PII & Secret Containment

## Storage classes

Classify squad storage before writing:

| Storage class | Examples | Security assumption |
|---|---|---|
| **Shared / committable** | In-repo `.squad/`, team repo, org repo | Broadly visible, durable, mergeable |
| **Shared / non-git** | Team OneDrive, ADO artifact, org share | Still multi-user; not secret by default |
| **Personal / local** | User-local FS, personal state backend | Private-ish, but still should assume sync/export is possible |

### Rules for shared squad append-only files

Allowed in shared append-only files (`decisions.md`, `history.md`, append-only logs):

- Agent names / squad names
- GitHub or ADO **handles/aliases** when needed for accountability
- Issue/PR/work-item numbers
- Repo identifiers, branch names, file paths that are already repo-visible
- Timestamps, decision IDs, sanitized rationale, policy outcomes

Not allowed in shared append-only files:

- Email addresses
- Access tokens, secrets, connection strings, cookies, JWTs
- Raw chat transcripts containing credentials or sensitive prompts
- Local machine paths that reveal home directories or tenant structure when unnecessary
- Personal OneDrive URLs or share links
- Full legal names unless they are already intentionally published in repo docs
- Auth artifacts from `gh`, ADO, or OneDrive sign-in flows

### Rules for personal squad append-only files

Personal/local append-only files may additionally contain:

- The developer's own alias/handle
- Local preferences and personal working notes
- Personal task routing context

But still **never**:

- Secrets or credentials
- Other users' PII
- Exported auth/session tokens
- Mirrored environment/config files

### Important nuance

The rule follows the **storage destination**, not the squad label. A “personal squad” stored in a shared repo must obey **shared** rules.

### Hook implications

Hooks should enforce file classes, not just regex scans:

1. **Classify destination**: shared vs personal, append-only vs mutable policy.
2. **Run secret scan** before write and before commit.
3. **Run PII scan** with stricter policy on shared destinations.
4. **Redact or block** rather than warn for append-only shared files.
5. **Never harvest identity from ambient config** (for example, no automatic `git config user.email` capture).
6. **Prefer handles over email/full name** when attribution is needed.

## 3) Charter & Skill Provenance

## Goal

A developer should be able to answer: **who supplied this agent behavior, from where, at what version, and was it verified?**

### Minimal verification flow

Avoid heavy PKI. Use existing trust anchors:

- Git commit signing / signed tags when available
- Trusted GitHub org / ADO project identity
- Existing org SSO/auth for access
- A local lockfile with hashes for loaded content

### Proposed flow

1. **Source declaration**
   - Each external squad source is declared with a trusted URI and owner, for example GitHub repo, ADO repo, or approved OneDrive location.
2. **Pinning**
   - The installed source is pinned to a commit SHA / release artifact / version identifier.
3. **Verification**
   - CLI verifies one of:
     - signed commit or signed tag,
     - trusted org/repo with protected branch or release,
     - admin-approved source recorded in org policy.
4. **Lock recording**
   - Record the resolved URI, version/commit, verification result, and file hashes in a local lockfile such as `.squad/sources.lock.json` or user-state equivalent.
5. **Load-time check**
   - On session start, compare loaded content to the lockfile hashes. Mismatch => mark source **modified/unverified**.
6. **Runtime behavior**
   - Verified sources load normally.
   - Unverified sources load **read-only** or stay disabled until user approval.
7. **User visibility**
   - Trust UI shows `source`, `owner`, `version`, `verified status`, and `effective permissions`.

### What the developer sees

Example trust line:

- `org/security-squad @ abc1234 — verified (signed tag) — policy active`
- `team/networking-squad @ def5678 — verified (trusted repo) — repo write allowed`
- `personal/brady-local — local/unverified — shared-state writes blocked`

That is enough for the common case without introducing a new crypto system.

## 4) Cross-Squad Write Rules

## Default

**No cross-squad writes by default.**

If a session is primarily bound to squad **Y**, an agent from squad **X** may:

- read Y's public squad state if policy allows,
- suggest edits to Y-owned files,
- write to X-owned namespace,
- write product code as the user if repo policy allows,
- **not append to Y's `decisions.md`, histories, ACLs, or charter files**.

### Safe override mechanism

If an override is needed, make it narrow and attributable:

1. **Owner-side grant** only — squad Y must grant it.
2. **Path-scoped** — e.g. append-only access to `Y/.squad/decisions/inbox/` only, not canonical files.
3. **Action-scoped** — append only, no edit/delete.
4. **Time-bounded** — session-only or short TTL.
5. **Recorded** — every foreign append stores source squad ID + grant ID.

### Recommended pattern

Allow foreign squads to write only to an **inbox/drop-box** path, never directly to canonical shared files. Scribe or the owner squad then merges/promotes after review.

This matches existing append-only/inbox patterns and avoids silent contamination of Y-owned history.

## 5) Org-Wide Deployment & Auto-Update

### Safe shapes

Safe to auto-deploy:

- CLI / SDK binaries from trusted release channels
- Built-in policy hooks and verifier code
- Org-managed, cached charter/skill bundles stored outside the repo
- Trust manifests / source catalogs that add new verified sources without altering repo state

Risky by default; require opt-in or review:

- Overwriting repo-local `.squad/charter.md`, `decisions.md`, histories, routing, or agent files
- Replacing team-owned skills in a repo checkout
- Changing effective permissions for existing squads without surfacing the change
- Auto-enabling new external storage backends for existing repos

### Safe line

The org may automatically update **tools and cached verified content**.

The org must **not silently overwrite user-owned or repo-owned squad state**.

If an org update changes behavior materially, the next session should surface a concise notice such as:

- source changed,
- version changed,
- permissions changed,
- new policy now active.

No approval prompt is needed for same-boundary patch updates that do not expand permissions.

## 6) Day-1 Walkthrough (Security-Relevant Onboarding)

### First-run flow

1. **Discover repo context**
   - “This repo uses shared Squad state.”
2. **Show loaded squads and trust**
   - Org / team / personal sources, with verified status and default permissions.
3. **Choose personal participation mode**
   - Personal squad enabled for read-only/advisory or contributor mode.
4. **Explain write boundary**
   - “Your personal squad can help edit code, but cannot modify shared squad governance without approval.”
5. **Offer external storage connectors only if needed**
   - GitHub / ADO / OneDrive / FS backends appear when the workflow crosses into them.
6. **Reuse existing auth**
   - `gh auth`, ADO auth, OneDrive/SSO consent — only when first needed.
7. **Record consent**
   - Persist approved sources and scopes locally so the common case stays silent later.

### Prompts that should exist

- **Source trust prompt**: only when loading an unverified external squad.
- **Cross-namespace write prompt**: only when attempting a foreign shared-state write.
- **New connector prompt**: only when first using GitHub/ADO/OneDrive storage.
- **Permission expansion notice**: when an update widens scopes.

### Prompts that should not exist

- Repeated prompts for already-verified org/team squads
- Routine prompts for same-repo product-code edits within the user's normal rights
- Prompts merely because multiple squads are present

## 7) Build Allocation

| Capability | Best home | Why |
|---|---|---|
| **(a) SDK** | Canonical trust model, ACL evaluator, source manifest schema, hook APIs | Security policy should be enforced once in the runtime core |
| **(b) CLI** | Trust UI, onboarding prompts, lockfile management, local verification command | CLI owns the user-facing workflow and local state |
| **(c) Rally** | Cross-repo/worktree boundary handling, repo trust detection, dispatch-time permission downgrades | Rally sits at the boundary where shared repos and external orchestration meet |
| **(d) Rally mod** | Thin repo/workflow adapter only: present trust state, pass repo identity/scopes to SDK/CLI, no independent ACL engine | Avoid duplicated security logic in another layer |
| **(e) New tool** | Only if needed for admin policy distribution or audit reporting; prefer `squad trust` / `squad verify` commands over a separate service | This problem does not justify a heavyweight new security service yet |

### Concrete split

- Put **verification and ACL decisions** in the SDK.
- Put **consent UX and visibility** in the CLI.
- Put **cross-repo dispatch downgrades** in Rally.
- Keep Rally mod thin.
- Add at most a lightweight inspection surface (`squad trust`, `squad sources`, `squad verify`).

## 8) Top 3 Threats and Mitigations

### Threat 1 — Provenance spoofing / behavior injection

An attacker or misconfigured source ships a charter/skill bundle that changes agent behavior in every developer session.

**Mitigations:**
- trusted source URIs
- pin to commit/tag/version
- signed commit/tag or trusted protected release where possible
- local hash lockfile
- unverified sources load read-only or disabled
- visible trust panel showing who is shaping behavior

### Threat 2 — Cross-namespace state pollution

A foreign or personal squad silently appends misleading guidance, approvals, or fake precedent into another squad's `decisions.md` or history.

**Mitigations:**
- default deny cross-squad writes
- owner-side grants only
- inbox-only foreign append path
- append metadata recording source squad + grant ID
- review/promotion step before canonical merge

### Threat 3 — PII / secret bleed into shared append-only state

Shared squad files accumulate email addresses, personal links, tokens, OneDrive URLs, or copied config from multi-user sessions.

**Mitigations:**
- file-class-aware hooks
- secret + PII scanning before write and before commit
- block ambient identity capture (for example `git config user.email`)
- require handles/aliases instead of email/full name
- sanitize connector output before it reaches append-only files

## Recommended Default Policy Set

1. Verified org/team squads load silently.
2. Personal squads load silently but shared-state writes are blocked by default.
3. Unverified external squads are read-only until approved.
4. Cross-squad writes go to owner inboxes only, never canonical files.
5. Shared append-only files prohibit email, secrets, auth artifacts, and personal share links.
6. Org auto-update may update tools and cached bundles, not repo-owned squad state.
7. All enforcement lives in SDK hooks and ACL evaluation, surfaced through CLI trust UI.

## Near-Term Implementation Slice

1. Add source manifest + lockfile support.
2. Add trust labels and effective-permission calculation to session load.
3. Add destination-class-aware write hook (`shared-append-only`, `shared-policy`, `personal-local`).
4. Add cross-namespace ACL evaluator with default deny.
5. Add CLI trust/status command and onboarding summaries.
6. Add Rally downgrade behavior for foreign/shared repos.

## Final Recommendation

Adopt a **namespace-first, provenance-aware** model:

- **who supplied the behavior** determines whether it can be trusted,
- **where the content is stored** determines privacy rules,
- **whose namespace is being modified** determines whether the write is allowed.

That gives Squad a practical multi-squad security model without adding heavyweight infrastructure, while keeping the normal org/team workflow nearly invisible.