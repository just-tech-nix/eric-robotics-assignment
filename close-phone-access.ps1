param(
    [string]$RuleName = "ERIC Dashboard TEMP 8080"
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    $args = @(
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $PSCommandPath + '"'),
        '-RuleName', ('"' + $RuleName + '"')
    ) -join ' '
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args | Out-Null
    exit 0
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -DisplayName $RuleName | Out-Null
    Write-Host "Temporary LAN access rule removed." -ForegroundColor Green
} else {
    Write-Host "No temporary LAN access rule found." -ForegroundColor Yellow
}
