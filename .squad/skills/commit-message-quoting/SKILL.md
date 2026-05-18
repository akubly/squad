---
confidence: low
name: commit-message-quoting
summary: PowerShell backtick hazard in commit messages and safe quoting patterns
---

# Skill: Commit Message Quoting — PowerShell Backtick Safety

## Problem

When writing commit messages in PowerShell that contain backticks (`) for code spans, double-quoted strings and heredocs silently parse backticks as escape sequences. This eats the backtick AND the following character before the message reaches git, irreversibly corrupting the commit history.

### Failure Example

```powershell
# ❌ WRONG: Double-quoted string
$msg = "feat: remove `register` command"
git commit -m $msg
# Result: commits "feat: remove egister command" (backtick + 'r' eaten)

# ❌ WRONG: Double-quoted heredoc
git commit -m "
feat: remove \`register\`

The \`squad assign\` command now handles binding.
"
# Result: commits with "egister" and "ssign" (all backticks + following chars lost)
# ALSO: newlines collapse to single line during PowerShell parsing
```

**Why it happens:** PowerShell treats `` ` `` as an escape character in double-quoted strings. It's processed BEFORE the string is passed to git, so git never sees the backticks.

## Safe Patterns

### Pattern 1: Use `create` Tool (PRIMARY — Recommended)

Write the message to a file using the Copilot CLI `create` tool, then read it as a file:

```bash
# In Copilot CLI (with create tool):
create(
  path: "C:\Users\{user}\AppData\Local\Temp\2\commit-msg.txt",
  file_text: "feat: remove `register` command\n\nThe `squad assign` subcommand now handles binding.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
)

# Then in PowerShell:
git commit -m (Get-Content -Raw C:\Users\{user}\AppData\Local\Temp\2\commit-msg.txt)
# OR amend a commit:
git commit --amend --only -F C:\Users\{user}\AppData\Local\Temp\2\commit-msg.txt
```

**Advantages:**
- No PowerShell quoting/escaping involved — message written directly to disk
- Works for any message content (backticks, newlines, special chars all preserved)
- Easiest to get right

### Pattern 2: Single-Quoted Here-String (SECONDARY)

Use PowerShell single-quoted Here-String syntax — single quotes disable escape processing:

```powershell
$msg = @'
feat: remove `register` command

The `squad assign` subcommand now handles binding.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
'@

git commit -m $msg
```

**Advantages:**
- Pure PowerShell, no external tools
- Single quotes prevent backtick escape processing
- Newlines preserved correctly

**Caution:** Must use `@'...'@` syntax (single quotes), NOT `@"..."@` (double quotes would re-enable escaping).

### Pattern 3: Use Editor (TERTIARY — Last Resort)

Let git open your editor to compose/amend the message (no shell quoting involved):

```bash
EDITOR=vim git commit --amend  # or --allow-empty-message -e
# OR use git's built-in editor UI
git commit --amend --allow-empty-message -e
```

**Advantages:**
- Editor receives message bytes directly (no PowerShell parsing)
- Guaranteed safe for any content

**Disadvantages:**
- Slower than file writing
- Requires editor setup

## Forbidden Pattern

❌ **NEVER use double-quoted strings or heredocs with backticks:**

```powershell
# ❌ WRONG
git commit -m "feat: remove `register`"

# ❌ WRONG
git commit -m "
feat: remove \`register\`
"

# ❌ WRONG
git commit --amend -m "The \`register\` subcommand is removed"
```

All of these allow PowerShell backtick-escape processing, corrupting the message.

## Verification Step (MANDATORY)

**After writing a commit message with backticks, ALWAYS verify before pushing:**

```powershell
# Read the message back from HEAD
git --no-pager log -1 --format="%B" HEAD | Out-File -NoNewline $env:TEMP\verify.txt -Encoding utf8
$content = Get-Content $env:TEMP\verify.txt -Raw
Write-Output $content

# Manually inspect:
# - Are all backticks present? (e.g., `register`, `squad assign`, `squad init --callsign`)
# - Are newlines intact? (should be multi-line, not collapsed)
# - Are special characters intact?

# If anything looks wrong, STOP — do not push
```

**Verification checklist:**
- [ ] All code spans have opening AND closing backticks (not eaten)
- [ ] No missing first letters after backticks (e.g., no "egister" or "ssign")
- [ ] Message is multi-line (not collapsed to single line)
- [ ] Trailers like `Co-authored-by:` are present

## Decision & References

- **Decision:** `.squad/decisions/inbox/surgeon-commit-msg-backtick-safety.md`
- **Incident History:** Piece 13 (2026-05-18) — commit message corruption requiring amend
- **Surgeon Learning:** `.squad/agents/surgeon/history.md` (PowerShell Backtick Hazard entry)

## Examples

### Good ✅

```powershell
# Pattern 1: create tool (best)
# (Write via create tool, then:)
git commit --amend --only -F C:\path\to\message.txt

# Pattern 2: single-quoted Here-String
$msg = @'
feat: hard-remove `register` command

BREAKING CHANGE: The `register` subcommand has been removed.
The shared-squad lifecycle surface is now `squad assign` (bind
a checkout to a registered squad) and `squad init` (create a new
squad host).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
'@
git commit -m $msg
```

### Bad ❌

```powershell
# Double-quoted string (backticks eaten)
git commit -m "feat: remove `register` command"  # → "remove egister command"

# Double-quoted heredoc (backticks + newlines destroyed)
git commit -m "
feat: remove \`register\`

Uses \`squad assign\` instead.
"  # → single line, "egister", "ssign"
```

