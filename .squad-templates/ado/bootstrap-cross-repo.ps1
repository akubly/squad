<#
.SYNOPSIS
    Bootstrap a cross-repo Squad configuration on a developer workstation or pipeline agent.

.DESCRIPTION
    Creates the TEAM_ROOT sidecar clone, runs squad bind, configures the squad-docs
    remote and refspecs, appends Squad-managed paths to .git/info/exclude, and runs
    an initial squad sync --pull.

    Every mutation is guarded with an existence check — safe to re-run on an already-
    configured machine without overwriting config or duplicating exclude entries.

.PARAMETER DocsRepoUrl
    Git URL of the docs/specs repository that acts as TEAM_ROOT.
    Use HTTPS (https://dev.azure.com/...) or SSH (git@dev.azure.com:...) only.
    # IMPORTANT: Never embed credentials (PATs, passwords) in DocsRepoUrl.
    # Use SSH keys or ADO service connections for authentication instead.
    Accepted schemes: https://, http://, ssh://, git+ssh://, git@
    Rejected schemes: file://, ftp://, and all others.

.PARAMETER DeveloperAlias
    Short lowercase identifier for this developer (letters, digits, hyphens; starts with
    a letter; max 39 characters). Used as the inbox-branch developer segment.

.PARAMETER DocsRemoteName
    Name for the squad-docs remote in WORK_ROOT. Defaults to "squad-docs".

.PARAMETER StateBranch
    Name of the Squad state branch in TEAM_ROOT. Defaults to "squad-state".

.EXAMPLE
    .\bootstrap-cross-repo.ps1 -DocsRepoUrl https://dev.azure.com/org/proj/_git/docs -DeveloperAlias alice

.EXAMPLE
    .\bootstrap-cross-repo.ps1 -DocsRepoUrl https://dev.azure.com/org/proj/_git/docs -DeveloperAlias alice -DocsRemoteName squad-docs -StateBranch squad-state

.NOTES
    Idempotency guarantees:
      - Sidecar clone: skipped if target directory already exists.
      - squad bind: skipped if .squad/config.json already reflects the correct roots.
      - squad-docs remote: skipped if a remote with the given name already exists.
      - Refspecs: each refspec is appended only if not already present.
      - Exclude entries: each path is appended only if not already present.
      - squad sync --pull: always runs; sync is itself idempotent.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$DocsRepoUrl,

    [Parameter(Mandatory = $true)]
    [string]$DeveloperAlias,

    [string]$DocsRemoteName = 'squad-docs',

    [string]$StateBranch = 'squad-state'
)

$ErrorActionPreference = 'Stop'

# --- Guard: validate required parameters before any write operation ---
if ([string]::IsNullOrWhiteSpace($DeveloperAlias)) {
    Write-Error 'DeveloperAlias is required and must not be empty.'
    exit 1
}

if ([string]::IsNullOrWhiteSpace($DocsRepoUrl)) {
    Write-Error 'DocsRepoUrl is required and must not be empty.'
    exit 1
}

# Validate URL scheme allowlist: only HTTPS or SSH are accepted.
# Rejects file://, ftp://, and other unsafe schemes.
if ($DocsRepoUrl -notmatch '^(https?://|git\+ssh://|ssh://|git@)') {
    $rejectedScheme = $DocsRepoUrl.Split('//')[0]
    Write-Error "DocsRepoUrl scheme not allowed. Use HTTPS or SSH. Got scheme: '${rejectedScheme}://...'"
    exit 1
}

# Validate alias format: lowercase letters, digits, hyphens; starts with letter; max 39 chars
if ($DeveloperAlias -notmatch '^[a-z][a-z0-9-]{0,38}$') {
    Write-Error "DeveloperAlias must match ^[a-z][a-z0-9-]{0,38}$. Got: '$DeveloperAlias'"
    exit 1
}

# Resolve WORK_ROOT from the current directory
$WorkRoot = (Get-Location).Path
$TeamRoot = Join-Path (Split-Path $WorkRoot -Parent) 'squad-docs-team'

Write-Host "WORK_ROOT : $WorkRoot"
Write-Host "TEAM_ROOT : $TeamRoot"
Write-Host "Alias     : $DeveloperAlias"
Write-Host "Remote    : $DocsRemoteName"
Write-Host "Branch    : $StateBranch"
Write-Host ''

# --- Step 1: Create or verify TEAM_ROOT sidecar clone ---
if (Test-Path $TeamRoot) {
    Write-Host "[1/5] TEAM_ROOT sidecar clone already exists at $TeamRoot — skipping clone."
} else {
    Write-Host "[1/5] Cloning docs repo to TEAM_ROOT sidecar at $TeamRoot ..."
    $cloneOutput = & git clone -- $DocsRepoUrl $TeamRoot 2>&1
    $cloneExitCode = $LASTEXITCODE
    if ($cloneExitCode -ne 0) {
        # Redact any embedded credentials in the captured output before emission.
        $redactedOutput = ($cloneOutput | Out-String) -replace '://[^@/\s]+@', '://***@'
        $redactedOutput = $redactedOutput -replace [regex]::Escape($DocsRepoUrl), ($DocsRepoUrl -replace '://[^@/]+@', '://***@')
        Write-Error "[1/5] git clone failed (exit $cloneExitCode). Sanitized output: $redactedOutput"
        exit 1
    }
    Write-Host "      Clone complete."
}

# --- Step 2: Run squad bind (guarded by config existence) ---
$SquadConfig = Join-Path $WorkRoot '.squad' 'config.json'
if (Test-Path $SquadConfig) {
    Write-Host '[2/5] .squad/config.json already exists — skipping squad bind.'
} else {
    Write-Host '[2/5] Running squad bind ...'
    squad bind --team-root "$TeamRoot" --work-root "$WorkRoot" --developer-alias "$DeveloperAlias" --state-branch "$StateBranch"
    Write-Host '      squad bind complete.'
}

# --- Step 3: Configure squad-docs remote in WORK_ROOT ---
$existingRemotes = git -C "$WorkRoot" remote
if ($existingRemotes -contains $DocsRemoteName) {
    Write-Host "[3/5] Remote '$DocsRemoteName' already configured — skipping remote add."
} else {
    $redactedDocsUrl = $DocsRepoUrl -replace '://[^@/]+@', '://***@'
    Write-Host "[3/5] Adding remote '$DocsRemoteName' → $redactedDocsUrl ..."
    $remoteAddOutput = & git -C $WorkRoot remote add $DocsRemoteName $DocsRepoUrl 2>&1
    $remoteAddExitCode = $LASTEXITCODE
    if ($remoteAddExitCode -ne 0) {
        # Redact any embedded credentials in the captured output before emission.
        $redactedRemoteOutput = ($remoteAddOutput | Out-String) -replace '://[^@/\s]+@', '://***@'
        $redactedRemoteOutput = $redactedRemoteOutput -replace [regex]::Escape($DocsRepoUrl), ($DocsRepoUrl -replace '://[^@/]+@', '://***@')
        Write-Error "[3/5] git remote add failed (exit $remoteAddExitCode). Sanitized output: $redactedRemoteOutput"
        exit 1
    }
    Write-Host '      Remote added.'
}

# Configure fetch refspec for the state branch (idempotent)
$StateRefspec = "+refs/heads/${StateBranch}:refs/remotes/${DocsRemoteName}/${StateBranch}"
$GitConfigKey = "remote.${DocsRemoteName}.fetch"
$existingRefspecs = git -C "$WorkRoot" config --get-all $GitConfigKey 2>$null
if ($existingRefspecs -contains $StateRefspec) {
    Write-Host "      Refspec '$StateRefspec' already present — skipping."
} else {
    git -C "$WorkRoot" config --add $GitConfigKey $StateRefspec
    Write-Host "      Refspec '$StateRefspec' added."
}

# Configure fetch refspec for inbox branches (idempotent)
$InboxRefspec = "+refs/heads/squad/inbox/${DeveloperAlias}/*:refs/remotes/${DocsRemoteName}/squad/inbox/${DeveloperAlias}/*"
$existingRefspecs2 = git -C "$WorkRoot" config --get-all $GitConfigKey 2>$null
if ($existingRefspecs2 -contains $InboxRefspec) {
    Write-Host "      Inbox refspec already present — skipping."
} else {
    git -C "$WorkRoot" config --add $GitConfigKey $InboxRefspec
    Write-Host "      Inbox refspec added."
}

# --- Step 4: Append Squad paths to .git/info/exclude (idempotent) ---
Write-Host '[4/5] Configuring .git/info/exclude ...'
$ExcludeFile = Join-Path $WorkRoot '.git' 'info' 'exclude'

# Ensure the exclude file exists
if (-not (Test-Path $ExcludeFile)) {
    New-Item -ItemType File -Path $ExcludeFile -Force | Out-Null
}

$excludeContent = Get-Content $ExcludeFile -Raw -ErrorAction SilentlyContinue
if ($null -eq $excludeContent) { $excludeContent = '' }

$entriesToAdd = @('.squad/', '.github/agents/squad.agent.md')
foreach ($entry in $entriesToAdd) {
    # Match exact line to avoid partial duplicates.
    # Pre-compute the escaped pattern to avoid $() subexpression syntax.
    $escapedEntry = [regex]::Escape($entry)
    if ($excludeContent -match "(^|\n)${escapedEntry}(\r?\n|$)") {
        Write-Host "      '$entry' already in exclude — skipping."
    } else {
        Add-Content -Path $ExcludeFile -Value $entry
        Write-Host "      Added '$entry' to exclude."
    }
}

# --- Step 5: Run initial squad sync --pull ---
Write-Host '[5/5] Running initial squad sync --pull ...'
squad sync --pull
Write-Host '      sync complete.'

Write-Host ''
Write-Host 'Bootstrap complete. WORK_ROOT is configured for cross-repo Squad operation.'
Write-Host "  TEAM_ROOT : $TeamRoot"
Write-Host "  WORK_ROOT : $WorkRoot"
