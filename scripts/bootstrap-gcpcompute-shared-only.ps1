<#
.SYNOPSIS
  Shared-only bootstrap for AXIOM gcpCompute operator access.
.DESCRIPTION
  Verifies the workspace is wired to the published shared MCP runtime mirror,
  ensures an SSH key exists, checks SSH access, and probes the public shared
  MCP health surface without requiring local .env secrets.
#>
param(
    [string]$GcpHost = 'fancy@34.56.232.61',
    [string]$SharedRuntimeDir = '/opt/muel/shared-mcp-runtime',
    [string]$SharedHealthUrl = 'https://34.56.232.61.sslip.io/mcp/health',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\google_compute_engine'),
    [switch]$SkipSsh
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:AXIOM_GCPCOMPUTE_HOST -and -not $PSBoundParameters.ContainsKey('GcpHost')) {
    $GcpHost = $env:AXIOM_GCPCOMPUTE_HOST
}
if ($env:AXIOM_GCPCOMPUTE_SHARED_RUNTIME_DIR -and -not $PSBoundParameters.ContainsKey('SharedRuntimeDir')) {
    $SharedRuntimeDir = $env:AXIOM_GCPCOMPUTE_SHARED_RUNTIME_DIR
}
if ($env:AXIOM_GCPCOMPUTE_SHARED_HEALTH_URL -and -not $PSBoundParameters.ContainsKey('SharedHealthUrl')) {
    $SharedHealthUrl = $env:AXIOM_GCPCOMPUTE_SHARED_HEALTH_URL
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Skip($msg) { Write-Host "  SKIP  $msg" -ForegroundColor Yellow }
function Write-Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

try {
    Write-Host "`n=== AXIOM gcpCompute Shared Bootstrap ===" -ForegroundColor Magenta
    Write-Host "Repo: $repoRoot" -ForegroundColor Gray

    Write-Step 1 'Checking workspace MCP configuration...'
    $mcpJson = Join-Path $repoRoot '.vscode' 'mcp.json'
    if (-not (Test-Path $mcpJson)) {
        Write-Fail '.vscode/mcp.json not found'
        exit 1
    }
    Write-Ok '.vscode/mcp.json found'

    $mcpConfig = Get-Content $mcpJson -Raw | ConvertFrom-Json
    if (-not $mcpConfig.servers.gcpCompute) {
        Write-Fail 'gcpCompute server entry is missing from .vscode/mcp.json'
        exit 1
    }

    $remoteCommand = [string]$mcpConfig.servers.gcpCompute.args[-1]
    if ($remoteCommand -match [regex]::Escape($SharedRuntimeDir)) {
        Write-Ok "gcpCompute points at $SharedRuntimeDir"
    }
    else {
        Write-Warn "gcpCompute does not point at $SharedRuntimeDir"
    }

    if ($remoteCommand -match [regex]::Escape('/opt/muel/discord-news-bot')) {
        Write-Warn 'gcpCompute still references the legacy git checkout path'
    }

    if ($remoteCommand -match 'unified-mcp.gcp.env') {
        Write-Ok 'gcpCompute loads unified-mcp.gcp.env overrides'
    }
    else {
        Write-Warn 'gcpCompute is not loading unified-mcp.gcp.env overrides'
    }

    Write-Step 2 'Checking local prerequisites...'
    if (Get-Command ssh -ErrorAction SilentlyContinue) {
        Write-Ok 'ssh available'
    }
    else {
        Write-Fail 'ssh is not available on PATH'
        exit 1
    }

    if (Get-Command ssh-keygen -ErrorAction SilentlyContinue) {
        Write-Ok 'ssh-keygen available'
    }
    else {
        Write-Fail 'ssh-keygen is not available on PATH'
        exit 1
    }

    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Ok "Node $(node --version)"
    }
    else {
        Write-Warn 'Node.js not found on PATH (shared-only bootstrap can continue)'
    }

    Write-Step 3 'Ensuring SSH key exists...'
    $sshDir = Split-Path -Parent $KeyPath
    $pubPath = "$KeyPath.pub"
    if ($SkipSsh) {
        Write-Skip 'Skipped (-SkipSsh)'
    }
    elseif ((Test-Path $KeyPath) -and (Test-Path $pubPath)) {
        Write-Ok "SSH key already exists at $KeyPath"
    }
    else {
        if (-not (Test-Path $sshDir)) {
            New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
        }
        $comment = "$env:USERNAME@$env:COMPUTERNAME"
        & ssh-keygen -t ed25519 -f $KeyPath -N '' -C $comment 2>&1 | Out-Null
        if (-not (Test-Path $pubPath)) {
            Write-Fail 'SSH key generation failed'
            exit 1
        }
        Write-Ok "SSH key generated at $KeyPath"
    }

    $pubKey = if (Test-Path $pubPath) { (Get-Content $pubPath -Raw).Trim() } else { '' }
    if ($pubKey) {
        Write-Host ''
        Write-Host '  Public key (share with gcpCompute admin if SSH access is not granted yet):' -ForegroundColor White
        Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
        Write-Host "  $pubKey" -ForegroundColor Yellow
        Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
        try {
            $pubKey | Set-Clipboard
            Write-Ok 'Public key copied to clipboard'
        }
        catch {
            Write-Warn 'Could not copy public key to clipboard'
        }
    }

    Write-Step 4 'Checking SSH access and shared runtime mirror...'
    if ($SkipSsh) {
        Write-Skip 'Skipped (-SkipSsh)'
    }
    else {
        $sshResult = & ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o BatchMode=yes -i $KeyPath $GcpHost "bash -lc 'if [ -d $SharedRuntimeDir ]; then echo SHARED_RUNTIME_OK; else echo SHARED_RUNTIME_MISSING; fi'" 2>&1
        if ($sshResult -match 'SHARED_RUNTIME_OK') {
            Write-Ok 'SSH access granted and shared runtime mirror exists'
        }
        elseif ($sshResult -match 'Permission denied') {
            Write-Warn 'SSH key exists but is not registered on gcpCompute yet'
        }
        else {
            Write-Warn 'Could not confirm shared runtime mirror over SSH'
        }
    }

    Write-Step 5 'Checking shared MCP health...'
    $sharedUpstreamLanes = @()
    try {
        $health = Invoke-RestMethod -Method Get -Uri $SharedHealthUrl -TimeoutSec 8
        if ($health.status -eq 'ok') {
            Write-Ok "Shared MCP health ok (tools=$($health.tools))"
            $sharedUpstreamLanes = @(
                @($health.upstreams) |
                Where-Object { $_ -and $_.namespace } |
                ForEach-Object {
                    $namespace = [string]$_.namespace
                    $plane = [string]$_.plane
                    $audience = [string]$_.audience
                    if ($plane -and $audience) { "$namespace($plane/$audience)" }
                    elseif ($plane) { "$namespace($plane)" }
                    elseif ($audience) { "$namespace($audience)" }
                    else { $namespace }
                }
            )
            if ($sharedUpstreamLanes.Count -gt 0) {
                Write-Ok ("Shared upstream lanes: " + [string]::Join(', ', $sharedUpstreamLanes))
            }
        }
        else {
            Write-Warn 'Shared MCP health returned a non-ok status'
        }
    }
    catch {
        Write-Warn "Shared MCP health probe failed: $($_.Exception.Message)"
    }

    Write-Host "`n=== Shared-only bootstrap complete ===" -ForegroundColor Magenta
    Write-Host 'Next steps:' -ForegroundColor White
    Write-Host '  1. If SSH access is missing, register the printed public key on gcpCompute.' -ForegroundColor Gray
    Write-Host '  2. Restart VS Code after access is granted and start gcpCompute from MCP: List Servers.' -ForegroundColor Gray
    Write-Host '  3. Use the shared MCP health output and diag.upstreams to confirm the lanes you expect.' -ForegroundColor Gray
    Write-Host '  4. Use local AXIOM /mcp/health when validating your own bridge or proxy against this repo.' -ForegroundColor Gray
}
finally {
    Pop-Location
}