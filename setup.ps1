# ============================================================
# ERIC Robotics — Insight.IO Dashboard
# One-Click Setup & Run Script (Windows PowerShell)
# ============================================================
#   .\setup.ps1                   # Auto: Docker full stack, else frontend demo
#   .\setup.ps1 -Mode frontend    # Frontend only (demo mode)
#   .\setup.ps1 -Mode ros         # ROS backend only (Docker)
#   .\setup.ps1 -Mode full        # Full Docker stack
#   .\setup.ps1 -Mode stop        # Stop all services
# ============================================================

param(
    [ValidateSet("auto", "frontend", "ros", "full", "stop")]
    [string]$Mode = "auto"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Write-Step   { param([string]$msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg) Write-Host "[!!] $msg" -ForegroundColor Yellow }
function Write-Err    { param([string]$msg) Write-Host "[XX] $msg" -ForegroundColor Red }
function Write-Header { param([string]$msg) Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & docker compose @Args 2>$null
    if ($LASTEXITCODE -ne 0) {
        & docker-compose @Args
    }
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  ERIC Robotics — Insight.IO Dashboard            ║" -ForegroundColor Cyan
Write-Host "  ║  One-Click Setup & Launch (PowerShell)           ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($Mode -eq "stop") {
    Write-Header "Stopping services"
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Invoke-Compose down
    }
    Write-Step "All services stopped."
    exit 0
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$hasNode = $null -ne $nodeCmd
if ($hasNode) {
    $nodeVersion = (node -v).TrimStart('v').Split('.')[0]
}

$hasDocker = $false
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCmd) {
    try {
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $hasDocker = $true
        }
    } catch {}
}

function Assert-Node {
    if (-not $hasNode) {
        Write-Err "Node.js not found. Install from https://nodejs.org (v18+)"
        exit 1
    }
    if ([int]$nodeVersion -lt 18) {
        Write-Err "Node.js 18+ required. Found: $(node -v)"
        exit 1
    }
    Write-Step "Node.js $(node -v) detected"
    Write-Step "npm $(npm -v) detected"
}

function Install-Frontend {
    Write-Header "Setting up React frontend"
    Push-Location "$ScriptDir\insight-io-dashboard"
    if (-not (Test-Path "node_modules")) {
        Write-Step "Installing npm dependencies..."
        npm install --loglevel=warn
        if ($LASTEXITCODE -ne 0) {
            Write-Err "npm install failed"
            Pop-Location
            exit 1
        }
    } else {
        Write-Step "Dependencies already installed"
    }
    Pop-Location
}

function Start-FrontendDev {
    Write-Header "Starting React frontend (demo/dev)"
    Push-Location "$ScriptDir\insight-io-dashboard"
    Write-Host ""
    Write-Host "  ======================================================" -ForegroundColor Green
    Write-Host "  Dashboard starting at:  http://localhost:5173" -ForegroundColor Green
    Write-Host "  Press Ctrl+C to stop" -ForegroundColor Green
    Write-Host "  ======================================================" -ForegroundColor Green
    Write-Host ""
    npm run dev
    Pop-Location
}

function Start-RosBackend {
    if (-not $hasDocker) {
        Write-Err "Docker is required for ROS backend. Install Docker Desktop."
        exit 1
    }
    Write-Header "Starting ROS 2 backend container"
    Push-Location $ScriptDir
    Invoke-Compose up -d --build ros2-backend
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker build/start failed"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Step "ROS 2 backend started (ws://localhost:9090)"
    Start-Sleep -Seconds 10
}

function Start-FullStack {
    if (-not $hasDocker) {
        Write-Err "Docker is required for full stack mode. Install Docker Desktop."
        exit 1
    }
    Write-Header "Starting full Docker stack"
    Push-Location $ScriptDir
    Invoke-Compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker build/start failed"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Step "Dashboard: http://localhost:8080"
    Write-Step "Phone/LAN:  http://<this-pc-lan-ip>:8080"
    Write-Step "ROS Bridge (debug): ws://localhost:9090"
    Start-Sleep -Seconds 10
}

switch ($Mode) {
    "frontend" {
        Assert-Node
        Write-Warn "Running in FRONTEND-ONLY mode (demo/static data)"
        Install-Frontend
        Start-FrontendDev
    }
    "ros" {
        Start-RosBackend
        Write-Step "ROS 2 backend running. ws://localhost:9090"
    }
    "full" {
        Start-FullStack
    }
    default {
        if ($hasDocker) {
            Start-FullStack
        } else {
            Assert-Node
            Write-Warn "Docker not available. Running in DEMO mode (frontend only)."
            Install-Frontend
            Start-FrontendDev
        }
    }
}
