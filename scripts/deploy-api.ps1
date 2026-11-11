# deploy-api.ps1 — usługa Go `wikdra` (server/): instalacja na serwerze, wdrożenie binarki
# i przełączenie nginx. Dane dostępowe z config.bat (jak deploy.bat), sudo przez remote.ps1.
#
#   pwsh scripts/deploy-api.ps1                  binarka z zielonego CI dla bieżącego commita (HEAD);
#                                               gdy CI/GitHub niedostępne → build lokalny (fallback)
#   pwsh scripts/deploy-api.ps1 -RunId 123456   artefakt z podanego przebiegu CI
#   pwsh scripts/deploy-api.ps1 -Local          build lokalny (go vet + go test przed buildem)
#   pwsh scripts/deploy-api.ps1 -Status         bieżące wydanie i stan usługi
#   pwsh scripts/deploy-api.ps1 -Install -Plan  lista zmian na serwerze (nic nie zmienia)
#   pwsh scripts/deploy-api.ps1 -Install        instalacja usługi (server/deploy/install.sh)
#   pwsh scripts/deploy-api.ps1 -Nginx          nginx/default.conf: kopia, nginx -t, reload, kontrola, powrót
# Szczegóły: docs/deployment.md, „Usługa Go”.
param(
    [long]$RunId,
    [switch]$Local,
    [switch]$Status,
    [switch]$Install,
    [switch]$Plan,
    [switch]$Nginx
)

. "$PSScriptRoot\remote.ps1"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$cfg = Get-MikrusConfig
$stage = "/home/$($cfg.MIKRUS_USER)/wikdra-upload"
$tmp = Join-Path $env:TEMP ('wikdra-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Send-Stage([string]$Local, [string]$Name) {
    Invoke-Remote "rm -rf $stage && mkdir -p $stage && chmod 700 $stage" | Out-Null
    Send-File $Local "$stage/$Name"
}

# Binarka z CI dla HEAD. Zwraca ścieżkę albo $null z powodem w $script:fallbackReason (wtedy build lokalny).
# Czerwone albo trwające CI to błąd, nie fallback — lokalny build nie może obchodzić testów.
function Get-CIBinary([string]$Dir) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { $script:fallbackReason = 'brak gh (GitHub CLI)'; return $null }
    $sha = (git rev-parse HEAD).Trim()
    $sha7 = $sha.Substring(0, 7)
    if (-not $RunId) {
        $json = gh run list -w ci.yml -c $sha -L 10 --json databaseId,status,conclusion 2>$null
        if ($LASTEXITCODE -ne 0) { $script:fallbackReason = 'GitHub nie odpowiada (gh run list)'; return $null }
        $runs = @($json | ConvertFrom-Json)
        if ($runs.Count -eq 0) { $script:fallbackReason = "brak przebiegu CI dla $sha7 (commit nie wypchnięty?)"; return $null }
        $green = $runs | Where-Object conclusion -eq 'success' | Select-Object -First 1
        if ($green) { $script:RunId = $green.databaseId }
        elseif ($runs[0].status -ne 'completed') { throw "CI dla $sha7 jeszcze trwa — poczekaj (gh run watch) albo świadomie -Local." }
        else { throw "CI dla $sha7 nie przeszło ($($runs[0].conclusion)) — popraw albo świadomie -Local." }
    }
    gh run download $script:RunId -n wikdra-linux-amd64 -D $Dir 2>$null
    if ($LASTEXITCODE -ne 0) { $script:fallbackReason = "nie udało się pobrać artefaktu z przebiegu $($script:RunId)"; return $null }
    $bin = Join-Path $Dir 'wikdra'
    $want = ((Get-Content (Join-Path $Dir 'wikdra.sha256')) -split '\s+')[0]
    if ((Get-FileHash $bin -Algorithm SHA256).Hash.ToLower() -ne $want) { throw 'Suma SHA-256 artefaktu się nie zgadza.' }
    Write-Host "  artefakt CI z przebiegu $($script:RunId) (commit $sha7)"
    if (git status --porcelain -- server) { Write-Warning 'Niezacommitowane zmiany w server/ nie trafią do wdrożenia (artefakt z HEAD).' }
    return $bin
}

function Build-Local([string]$Dir) {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw 'Brak Go w PATH (potrzebny do lokalnego buildu).' }
    $sha7 = (git rev-parse --short=7 HEAD).Trim()
    $branch = ((git rev-parse --abbrev-ref HEAD).Trim()) -replace '[^A-Za-z0-9._-]', '-'
    $dirty = if (git status --porcelain -- server) { '-dirty' } else { '' }
    # znacznik czasu: dwa lokalne buildy tego samego commita to różne wydania
    $ver = "$branch-$sha7$dirty-local-$(Get-Date -Format 'MMddHHmm')"
    if ($ver.Length -gt 64) { $ver = $ver.Substring($ver.Length - 64) }
    $bin = Join-Path $Dir 'wikdra'
    Push-Location (Join-Path $root 'server')
    try {
        go vet ./...
        if ($LASTEXITCODE -ne 0) { throw 'go vet nie przeszło.' }
        go test -count=1 ./...
        if ($LASTEXITCODE -ne 0) { throw 'go test nie przeszło.' }
        $env:CGO_ENABLED = '0'; $env:GOOS = 'linux'; $env:GOARCH = 'amd64'
        try { go build -trimpath -ldflags "-s -w -X main.version=$ver" -o $bin . } finally { Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED }
        if ($LASTEXITCODE -ne 0) { throw 'go build nie powiódł się.' }
    } finally { Pop-Location }
    Write-Host "  build lokalny: $ver"
    return $bin
}

try {
    if ($Status) {
        Invoke-Remote -Sudo '/usr/local/sbin/wikdra-deploy status' | ForEach-Object { "  $_" }
        return
    }

    if ($Install) {
        # server/deploy/ bez testów, końce linii LF
        $src = Join-Path $root 'server\deploy'
        $pkg = Join-Path $tmp 'deploy'
        foreach ($f in Get-ChildItem $src -File) {
            New-Item -ItemType Directory -Force -Path $pkg | Out-Null
            $text = [IO.File]::ReadAllText($f.FullName) -replace "`r`n", "`n"
            [IO.File]::WriteAllText((Join-Path $pkg $f.Name), $text, [Text.UTF8Encoding]::new($false))
        }
        $tgz = Join-Path $tmp 'deploy.tgz'
        tar -czf $tgz -C $tmp deploy
        if ($LASTEXITCODE -ne 0) { throw 'tar nie powiódł się.' }
        Send-Stage $tgz 'deploy.tgz'
        $arg = if ($Plan) { '--plan' } else { '' }
        Invoke-Remote -Sudo "cd $stage && tar -xzf deploy.tgz && sh deploy/install.sh $arg; rc=`$?; rm -rf $stage; exit `$rc" | ForEach-Object { "  $_" }
        return
    }

    if ($Nginx) {
        $conf = Join-Path $tmp 'default.conf'
        $text = [IO.File]::ReadAllText((Join-Path $root 'nginx\default.conf')) -replace "`r`n", "`n"
        [IO.File]::WriteAllText($conf, $text, [Text.UTF8Encoding]::new($false))
        Send-Stage $conf 'default.conf'
        Invoke-Remote -Sudo @"
NEW=$stage/default.conf
DST=/etc/nginx/http.d/default.conf
code() { curl -s -o /dev/null -w '%{http_code}' -H "Host: `$1" "http://127.0.0.1`$2"; }
verify() {
	[ "`$(code wikdra.top /)" = 200 ] && curl -s -H 'Host: wikdra.top' http://127.0.0.1/ | grep -q '<title>Wikdra' &&
	[ "`$(code panele.wikdra.top /)" = 200 ] && [ "`$(code wikdra.top /stats.php)" = 200 ] &&
	[ "`$(code wikdra.top /bichu)" = 200 ] && [ "`$(code wikdra.top /bichu_config.php)" = 404 ] &&
	[ "`$(code proj.wikdra.top /)" = 200 ]
}
if cmp -s "`$NEW" "`$DST"; then echo "default.conf bez zmian"; rm -rf $stage; exit 0; fi
bak=/root/default.conf.`$(date +%Y%m%d-%H%M%S)
cp -p "`$DST" "`$bak"
cp -p "`$DST" "`$DST.bak"
cat "`$NEW" > "`$DST"
rm -rf $stage
if ! nginx -t 2>&1; then
	cp -p "`$DST.bak" "`$DST"
	nginx -t 2>&1 | tail -n 1
	echo "BŁĄD: nginx -t nie przeszło — przywrócono poprzednią konfigurację (`$bak)"
	exit 1
fi
rc-service nginx reload >/dev/null
sleep 1
if ! verify; then
	cp -p "`$DST.bak" "`$DST"
	nginx -t >/dev/null 2>&1 && rc-service nginx reload >/dev/null
	echo "BŁĄD: kontrola po przeładowaniu nie przeszła — przywrócono poprzednią konfigurację (`$bak)"
	exit 1
fi
echo "OK: nowa konfiguracja nginx działa (kopia poprzedniej: `$bak)"
"@ | ForEach-Object { "  $_" }
        return
    }

    Write-Host '[1/3] Binarka'
    $bin = $null
    if (-not $Local) {
        $script:fallbackReason = $null
        $bin = Get-CIBinary $tmp
        if (-not $bin) { Write-Warning "$($script:fallbackReason) — buduję lokalnie (fallback)." }
    }
    if (-not $bin) { $bin = Build-Local $tmp }

    Write-Host '[2/3] Paczka (gzip) i wysyłka'
    $gz = Join-Path $tmp 'wikdra.gz'
    $in = [IO.File]::OpenRead($bin); $out = [IO.File]::Create($gz)
    try {
        $z = [IO.Compression.GZipStream]::new($out, [IO.Compression.CompressionLevel]::SmallestSize)
        $in.CopyTo($z); $z.Dispose()
    } finally { $in.Dispose(); $out.Dispose() }
    $sha = (Get-FileHash $gz -Algorithm SHA256).Hash.ToLower()
    Write-Host ('  {0:N1} MB, sha256 {1}' -f ((Get-Item $gz).Length / 1MB), $sha)
    Send-Stage $gz 'wikdra.gz'

    Write-Host '[3/3] wikdra-deploy'
    Invoke-Remote -Sudo "/usr/local/sbin/wikdra-deploy $sha < $stage/wikdra.gz; rc=`$?; rm -rf $stage; exit `$rc" | ForEach-Object { "  $_" }
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
