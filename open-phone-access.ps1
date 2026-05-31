param(
    [int]$Port = 8080,
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
        '-Port', $Port,
        '-RuleName', ('"' + $RuleName + '"')
    ) -join ' '
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args | Out-Null
    exit 0
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -like '192.168.*' -or
        $_.IPAddress -like '10.*' -or
        ($_.IPAddress -like '172.*' -and [int]($_.IPAddress.Split('.')[1]) -ge 16 -and [int]($_.IPAddress.Split('.')[1]) -le 31)
    } |
    Sort-Object InterfaceMetric, SkipAsSource |
    Select-Object -First 1 -ExpandProperty IPAddress)

if (-not $ip) {
    throw 'Could not detect a private LAN IPv4 address.'
}

$octets = $ip.Split('.')
$subnet = "$($octets[0]).$($octets[1]).$($octets[2]).0/24"

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -DisplayName $RuleName | Out-Null
}

$params = @{
    DisplayName   = $RuleName
    Direction     = 'Inbound'
    Action        = 'Allow'
    Enabled       = 'True'
    Profile       = 'Private,Public'
    Protocol      = 'TCP'
    LocalPort     = $Port
    RemoteAddress = $subnet
}
New-NetFirewallRule @params | Out-Null

Write-Host "Temporary LAN access opened." -ForegroundColor Green
Write-Host "URL:    http://$ip`:$Port" -ForegroundColor Green
Write-Host "Scope:  inbound TCP $Port from $subnet only" -ForegroundColor Green
Write-Host "Close later with: .\close-phone-access.ps1" -ForegroundColor Yellow
