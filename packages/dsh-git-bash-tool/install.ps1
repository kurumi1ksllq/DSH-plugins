#Requires -Version 7.0
<#
.SYNOPSIS
    Install (or remove) dsh-git-bash-tool in a DeepSeek Harness profile.

.DESCRIPTION
    Links this bundle into the profile's node_modules, registers it as a profile
    dependency and bundle, so the profile composition picks up its cordis.patch.yml
    (bash tool on, pwsh tool off, Git Bash as the shell binary).

    Backs up the profile package.json before editing it. Profile changes take
    effect on the next session: restart the Harness afterwards.

.PARAMETER Profile
    Profile name under $env:DSH_HOME\profiles. Default: desktop.

.PARAMETER Uninstall
    Reverse the install: drop the dependency, the bundle entry and the link.

.PARAMETER Yes
    Actually write. Without it the script prints the planned changes only.

.EXAMPLE
    pwsh -File install.ps1
    pwsh -File install.ps1 -Yes
    pwsh -File install.ps1 -Uninstall -Yes
#>
[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [switch]$Uninstall,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$bundleName = 'dsh-git-bash-tool'
$sourceDir = $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$packageJson = Join-Path $profileDir 'package.json'
$linkPath = Join-Path $profileDir "node_modules\$bundleName"
$linkSpec = 'link:' + ($sourceDir -replace '\\', '/')

if (-not (Test-Path -LiteralPath $packageJson)) {
    throw "profile package.json not found: $packageJson"
}

# --- planned changes -------------------------------------------------------
Write-Host "profile   : $profileDir"
Write-Host "bundle    : $sourceDir"
Write-Host "link      : $linkPath"
Write-Host "dependency: $linkSpec"
Write-Host "action    : $(if ($Uninstall) { 'uninstall' } else { 'install' })"
Write-Host ''

if (-not $Yes) {
    Write-Host 'dry run — nothing written. Re-run with -Yes to apply.'
    exit 0
}

# --- backup ----------------------------------------------------------------
$backupDir = Join-Path $dshHome 'backup'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupDir "profile-$Profile-package-$stamp.json"
Copy-Item -LiteralPath $packageJson -Destination $backupPath -Force
Write-Host "backup    : $backupPath"

$pkg = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json

# --- link ------------------------------------------------------------------
if ($Uninstall) {
    if (Test-Path -LiteralPath $linkPath) {
        $item = Get-Item -LiteralPath $linkPath -Force
        if ($item.LinkType) {
            Remove-Item -LiteralPath $linkPath -Force
            Write-Host "removed link: $linkPath"
        }
        else {
            Write-Warning "not a link, leaving alone: $linkPath"
        }
    }
}
else {
    if (Test-Path -LiteralPath $linkPath) {
        $existing = (Get-Item -LiteralPath $linkPath -Force).Target
        if ($existing -and ($existing -ne $sourceDir)) {
            Remove-Item -LiteralPath $linkPath -Force
            Write-Host "replaced link (was: $existing)"
        }
    }
    if (-not (Test-Path -LiteralPath $linkPath)) {
        New-Item -ItemType Junction -Path $linkPath -Target $sourceDir | Out-Null
        Write-Host "created link: $linkPath"
    }
    else {
        Write-Host "link already present: $linkPath"
    }
}

# --- dependency ------------------------------------------------------------
if (-not $pkg.PSObject.Properties['dependencies']) {
    $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
if ($Uninstall) {
    if ($pkg.dependencies.PSObject.Properties[$bundleName]) {
        $pkg.dependencies.PSObject.Properties.Remove($bundleName)
        Write-Host "dependency removed"
    }
}
else {
    $pkg.dependencies | Add-Member -NotePropertyName $bundleName -NotePropertyValue $linkSpec -Force
    Write-Host "dependency set"
}

# --- bundle registration ---------------------------------------------------
if (-not ($pkg.PSObject.Properties['dsh'] -and $pkg.dsh.PSObject.Properties['profile'])) {
    throw 'profile package.json has no dsh.profile section; refusing to guess'
}
$bundles = @($pkg.dsh.profile.bundles)
if ($Uninstall) {
    $bundles = @($bundles | Where-Object { $_ -ne $bundleName })
}
elseif ($bundles -notcontains $bundleName) {
    $bundles += $bundleName
}
$pkg.dsh.profile.bundles = $bundles
Write-Host "bundles   : $($bundles -join ', ')"

# --- write back ------------------------------------------------------------
$json = $pkg | ConvertTo-Json -Depth 20
Set-Content -LiteralPath $packageJson -Value $json -Encoding utf8
Write-Host "wrote     : $packageJson"
Write-Host ''
Write-Host 'Restart DeepSeek Harness, then in a NEW session check:'
Write-Host '  - the tool list shows bash, not pwsh'
Write-Host '  - bash -c ''uname -s'' prints MINGW64_NT-... (not the WSL "no distribution" message)'
Write-Host ''
Write-Host "Rollback: pwsh -File install.ps1 -Uninstall -Yes   (or restore $backupPath)"
