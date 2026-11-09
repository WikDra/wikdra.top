# remote.ps1 — wspólne funkcje: dane z config.bat i uruchamianie skryptów na serwerze.
# Skrypt sh jest przesyłany jako base64 (bez problemów z cudzysłowami i $ w PowerShellu),
# a hasło sudo trafia na stdin sudo po stronie serwera (nie do argumentów sudo).
#   . "$PSScriptRoot\remote.ps1"
#   Invoke-Remote -Sudo 'nginx -t'
# Wymaga plink i pscp (PuTTY) w PATH. Kopia z repo proj.wikdra.top (scripts/remote.ps1).

$ErrorActionPreference = 'Stop'

function Get-MikrusConfig {
    $root = Split-Path -Parent $PSScriptRoot
    $file = Join-Path $root 'config.bat'
    if (-not (Test-Path $file)) { throw "Brak $file (MIKRUS_HOST, MIKRUS_PORT, MIKRUS_USER, MIKRUS_PW)." }
    $cfg = @{}
    Get-Content $file | ForEach-Object { if ($_ -match '^@?set\s+(\w+)=(.*)$') { $cfg[$matches[1]] = $matches[2].Trim() } }
    foreach ($k in 'MIKRUS_HOST', 'MIKRUS_PORT', 'MIKRUS_USER', 'MIKRUS_PW') {
        if (-not $cfg[$k] -or $cfg[$k] -like 'YOUR_*') { throw "config.bat nie ustawia $k." }
    }
    if ($cfg.MIKRUS_PW -match "['`"\\`$]") { throw 'Hasło SSH zawiera znaki, których ten skrypt nie obsługuje bezpiecznie.' }
    return $cfg
}

function Invoke-Remote {
    param(
        [Parameter(Mandatory)][string]$Script,
        [switch]$Sudo,
        [switch]$AllowFail
    )
    $c = Get-MikrusConfig
    $body = ($Script -replace "`r`n", "`n")
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("set -e`n" + $body))
    $tmp = '/tmp/.wikdra-remote-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.sh'
    $run = if ($Sudo) { "echo '$($c.MIKRUS_PW)' | sudo -S -p '' sh $tmp" } else { "sh $tmp" }
    $cmd = "umask 077; echo $b64 | base64 -d > $tmp; $run; rc=`$?; rm -f $tmp; exit `$rc"
    $out = & plink -batch -P $c.MIKRUS_PORT -pw $c.MIKRUS_PW "$($c.MIKRUS_USER)@$($c.MIKRUS_HOST)" $cmd 2>&1
    $code = $LASTEXITCODE
    $out | ForEach-Object { "$_" }
    if ($code -ne 0 -and -not $AllowFail) { throw "Polecenie na serwerze zakończyło się kodem $code." }
}

function Send-File {
    param([Parameter(Mandatory)][string]$Local, [Parameter(Mandatory)][string]$Remote)
    $c = Get-MikrusConfig
    & pscp -batch -q -P $c.MIKRUS_PORT -pw $c.MIKRUS_PW $Local "$($c.MIKRUS_USER)@$($c.MIKRUS_HOST):$Remote"
    if ($LASTEXITCODE -ne 0) { throw "Wysyłka $Local nie powiodła się." }
}
