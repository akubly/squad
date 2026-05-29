<#
.SYNOPSIS
    Scrub gate — pre-push validation for upstream stack branches.

.DESCRIPTION
    Runs the 6-point scrub checklist on the current branch to verify it is
    safe to push to bradygaster/squad. Exits 0 on pass, 1 on any failure.

    Intended to run on each akubly/upstream-{NN}-* branch before pushing.
    Can also be used in CI as a required check.

.PARAMETER Strict
    When set, treats warnings (review-required items) as failures.

.EXAMPLE
    .\docs\proposals\upstream-bradygaster\_scrub-gate.ps1
    .\docs\proposals\upstream-bradygaster\_scrub-gate.ps1 -Strict

.NOTES
    Exit codes:
      0 — all gates pass
      1 — one or more gates failed
      2 — not in a git repository
#>

param(
    [switch]$Strict
)

$ErrorActionPreference = "Stop"
$failures = @()
$warnings = @()

# Verify we're in a git repo
try {
    $null = git rev-parse --git-dir 2>&1
} catch {
    Write-Error "Not in a git repository."
    exit 2
}

Write-Host "`n=== Scrub Gate — Upstream Stack Validation ===" -ForegroundColor Cyan
Write-Host ""

# --- Gate 1: Strip-listed paths must not exist ---
Write-Host "[1/6] Strip-listed paths..." -NoNewline
$stripHits = git ls-files | Where-Object { $_ -notmatch '^\.squad(-templates)?/' } | Select-String -Pattern '(_internal|windows-wireless|@wifi-aware|wifi.aware|-mc\.preview|orchestration-log|/identity/|/casting/|squad/specs/v0\.5\.x)'
if ($stripHits) {
    $failures += "Gate 1 FAIL: Strip-listed paths found:`n$($stripHits -join "`n")"
    Write-Host " FAIL" -ForegroundColor Red
} else {
    Write-Host " PASS" -ForegroundColor Green
}

# --- Gate 2: Zero wifi-aware mentions ---
Write-Host "[2/6] wifi-aware mentions..." -NoNewline
$wifiHits = git grep -i 'wifi.aware' -- ':!docs/proposals/upstream-bradygaster/_scrub-gate.ps1' ':!.squad/' ':!.squad-templates/' 2>$null
if ($wifiHits) {
    $failures += "Gate 2 FAIL: wifi-aware references found:`n$($wifiHits -join "`n")"
    Write-Host " FAIL" -ForegroundColor Red
} else {
    Write-Host " PASS" -ForegroundColor Green
}

# --- Gate 3: Review akubly mentions ---
Write-Host "[3/6] akubly mentions..." -NoNewline
$akublyHits = git grep -i '\bakubly\b' -- ':!.git' 2>$null
if ($akublyHits) {
    # Filter: acceptable in branch names, git config, authorship
    $codeHits = $akublyHits | Where-Object { 
        $_ -notmatch '(branch|author|Co-authored|\.git|upstream-bradygaster)' 
    }
    if ($codeHits) {
        if ($Strict) {
            $failures += "Gate 3 FAIL (strict): akubly in code/docs:`n$($codeHits -join "`n")"
            Write-Host " FAIL" -ForegroundColor Red
        } else {
            $warnings += "Gate 3 WARN: akubly references in code/docs (review required):`n$($codeHits -join "`n")"
            Write-Host " WARN" -ForegroundColor Yellow
        }
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }
} else {
    Write-Host " PASS" -ForegroundColor Green
}

# --- Gate 4: Review Microsoft/internal mentions ---
Write-Host "[4/6] Microsoft/internal mentions..." -NoNewline
$msHits = git grep -i 'microsoft\|windows wireless' -- ':!docs/proposals/upstream-bradygaster/' ':!.git' ':!node_modules' ':!package-lock.json' 2>$null
if ($msHits) {
    # Filter: ADO/Azure DevOps platform references are OK
    $internalHits = $msHits | Where-Object {
        $_ -notmatch '(azure devops|Azure DevOps|dev\.azure\.com|LICENSE|NOTICE|Copyright)' -and
        $_ -notmatch '(microsoft/squad|bradygaster)' -and
        $_ -match '(microsoft\.visualstudio\.com|windows wireless|internal)'
    }
    if ($internalHits) {
        if ($Strict) {
            $failures += "Gate 4 FAIL (strict): Internal references found:`n$($internalHits -join "`n")"
            Write-Host " FAIL" -ForegroundColor Red
        } else {
            $warnings += "Gate 4 WARN: Possible internal references (review required):`n$($internalHits -join "`n")"
            Write-Host " WARN" -ForegroundColor Yellow
        }
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }
} else {
    Write-Host " PASS" -ForegroundColor Green
}

# --- Gate 5: ADO fixture audit ---
Write-Host "[5/6] ADO fixture audit..." -NoNewline
$adoHits = git grep -i 'microsoft\.visualstudio\.com\|/wfa[/"'']' -- 'test/' 2>$null
if ($adoHits) {
    $failures += "Gate 5 FAIL: Real tenant URLs or prohibited abbreviation in test fixtures:`n$($adoHits -join "`n")"
    Write-Host " FAIL" -ForegroundColor Red
} else {
    Write-Host " PASS" -ForegroundColor Green
}

# --- Gate 6: Changed file count ---
Write-Host "[6/6] Changed file count..." -NoNewline
$changedFiles = git diff --name-only HEAD~1 2>$null
if ($null -eq $changedFiles) {
    $warnings += "Gate 6 WARN: Could not determine changed file count (no parent commit?)"
    Write-Host " SKIP" -ForegroundColor Yellow
} else {
    $count = ($changedFiles | Measure-Object).Count
    if ($count -gt 30) {
        $warnings += "Gate 6 WARN: $count files changed (limit is 30). Justification required in PR."
        Write-Host " WARN ($count files)" -ForegroundColor Yellow
    } else {
        Write-Host " PASS ($count files)" -ForegroundColor Green
    }
}

# [upstream-bound]
# --- Gate 7: No user-path segments in config/metadata strings ---
Write-Host "[7] User-path segments in config/metadata..." -NoNewline
$configFiles = git ls-files -- '.squad/config.json' '.squad/publish-metadata.json' 2>$null
if (-not $configFiles) {
    Write-Host " SKIP (no tracked config files)" -ForegroundColor Yellow
} else {
    $userPathHits = @()
    foreach ($cf in $configFiles) {
        $hits = git grep -E '(Users|home)[/\\]' -- $cf 2>$null
        if ($hits) {
            $userPathHits += $hits | ForEach-Object { "${cf}: $_" }
        }
    }
    if ($userPathHits) {
        foreach ($h in $userPathHits) {
            $hitFile = ($h -split ':')[0]
            $failures += "Gate 7 FAIL: raw user-path segment detected in ${hitFile}; use {repo, pathHash} structure (see piece 28 spec §9 NFR annotation)"
        }
        Write-Host " FAIL" -ForegroundColor Red
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }
}

# [upstream-bound]
# --- Gate 8: ADO variable syntax allowed in .squad-templates/ado/** ---
Write-Host "[8] ADO variable syntax in .squad-templates/ado/..." -NoNewline
$adoTemplateFiles = git ls-files -- '.squad-templates/ado/' 2>$null
if (-not $adoTemplateFiles) {
    Write-Host " SKIP (no ADO template files tracked)" -ForegroundColor Yellow
} else {
    $gate8Failures = @()
    foreach ($tf in $adoTemplateFiles) {
        $content = git show "HEAD:$tf" 2>$null
        if ($null -eq $content) { continue }
        $dollarExpressions = [regex]::Matches(($content -join "`n"), '\$\(([^)]+)\)')
        foreach ($m in $dollarExpressions) {
            $inner = $m.Groups[1].Value
            if ($inner -notmatch '^[A-Za-z][A-Za-z0-9._]*$') {
                $gate8Failures += "Gate 8 FAIL: non-ADO `$() expression in ${tf}: $($m.Value) — use `$(VariableName) ADO runtime syntax only"
            }
        }
    }
    if ($gate8Failures) {
        $failures += $gate8Failures
        Write-Host " FAIL" -ForegroundColor Red
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }
}

# [upstream-bound]
# --- Gate 9: developerAlias format validation ---
Write-Host "[9] developerAlias format validation..." -NoNewline
$metaFiles = git ls-files -- '.squad/config.json' '.squad/publish-metadata.json' 2>$null
if (-not $metaFiles) {
    Write-Host " SKIP (no tracked config files)" -ForegroundColor Yellow
} else {
    $gate9Failures = @()
    $aliasPattern = '^[a-z][a-z0-9-]{0,38}$'
    foreach ($mf in $metaFiles) {
        $filePath = Join-Path (git rev-parse --show-toplevel) $mf
        if (-not (Test-Path $filePath)) { continue }
        $fileContent = Get-Content -Raw $filePath
        $aliasMatches = [regex]::Matches($fileContent, '"developerAlias"\s*:\s*"([^"]*)"')
        foreach ($am in $aliasMatches) {
            $aliasValue = $am.Groups[1].Value
            if ($aliasValue -notmatch $aliasPattern) {
                $gate9Failures += "Gate 9 FAIL: developerAlias must match [a-z][a-z0-9-]{0,38} (lowercase letters, digits, hyphens; starts with letter; max 39 chars) in ${mf}: '${aliasValue}'"
            }
        }
    }
    if ($gate9Failures) {
        $failures += $gate9Failures
        Write-Host " FAIL" -ForegroundColor Red
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }
}

# --- Summary ---
Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan

if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "Warnings ($($warnings.Count)):" -ForegroundColor Yellow
    foreach ($w in $warnings) {
        Write-Host "  $w" -ForegroundColor Yellow
    }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures ($($failures.Count)):" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "  $f" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "SCRUB GATE: FAIL" -ForegroundColor Red
    exit 1
}

if ($Strict -and $warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "SCRUB GATE: FAIL (strict mode — warnings treated as failures)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "SCRUB GATE: PASS" -ForegroundColor Green
exit 0
