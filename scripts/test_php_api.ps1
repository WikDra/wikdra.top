# Test funkcjonalny bichu.php / stats.php na przenośnym PHP (tylko lokalnie).
# Uruchamiany ręcznie: powershell -File scripts/test_php_api.ps1
# PHP nie jest zależnością projektu — skrypt kończy się ostrzeżeniem, jeśli go nie ma.
$ErrorActionPreference = 'Stop'
$php = Join-Path $env:TEMP 'php-lint\php.exe'
if (-not (Test-Path $php)) { Write-Output 'POMINIETO: brak przenosnego PHP w %TEMP%\php-lint'; exit 0 }

$repo = Split-Path -Parent $PSScriptRoot
$work = Join-Path $env:TEMP ('bichu-test-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $work | Out-Null
Copy-Item (Join-Path $repo 'site\bichu.php') $work
Copy-Item (Join-Path $repo 'site\stats.php') $work

$pass = 0; $fail = 0
function Check([bool]$cond, [string]$label, $detail) {
    if ($cond) { $script:pass++; Write-Output "  OK   $label" }
    else { $script:fail++; Write-Output "  BLAD $label  ($detail)" }
}
function Req([string]$method, [string]$url, $body) {
    try {
        $p = @{ Method = $method; Uri = $url; TimeoutSec = 20; SkipHttpErrorCheck = $true }
        if ($null -ne $body) { $p.Body = $body; $p.ContentType = 'application/json' }
        return Invoke-WebRequest @p
    } catch { return $null }
}

$port = 8799
$server = Start-Process -FilePath $php -ArgumentList @('-S', "127.0.0.1:$port", '-t', $work) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$base = "http://127.0.0.1:$port"

try {
    Write-Output "`n[A] FAIL-CLOSED: brak bichu_config.php"
    $r = Req POST "$base/bichu.php?api=1" '{"password":"","content":"hack"}'
    Check ($r.StatusCode -eq 503) 'POST bez konfiguracji zwraca 503' $r.StatusCode
    Check (-not (Test-Path (Join-Path $work 'bichu_content.txt'))) 'nic nie zostalo zapisane' 'plik istnieje'
    $r = Req POST "$base/bichu.php?api=1" '{"content":"hack"}'
    Check ($r.StatusCode -eq 400 -or $r.StatusCode -eq 503) 'POST bez pola password odrzucony' $r.StatusCode

    Write-Output "`n[B] Konfiguracja z hashem"
    $hash = (& $php -r "echo password_hash('tajne123', PASSWORD_DEFAULT);")
    Set-Content -Path (Join-Path $work 'bichu_config.php') -Value ("<?php`n`$admin_password_hash = '" + $hash + "';") -Encoding UTF8

    $r = Req POST "$base/bichu.php?api=1" '{"password":"zle","content":"hack"}'
    Check ($r.StatusCode -eq 403) 'zle haslo = 403' $r.StatusCode
    Check (-not (Test-Path (Join-Path $work 'bichu_content.txt'))) 'zly zapis nie utworzyl pliku' 'plik istnieje'

    $r = Req POST "$base/bichu.php?api=1" '{"password":"tajne123","content":"Tresc z polskimi znakami: zolc gesla jazn"}'
    Check ($r.StatusCode -eq 200) 'poprawne haslo = 200' $r.StatusCode
    Check ((Get-Content (Join-Path $work 'bichu_content.txt') -Raw) -like '*polskimi*') 'tresc zapisana' 'brak tresci'

    $r = Req GET "$base/bichu.php?api=1" $null
    Check ($r.Content -like '*polskimi*') 'GET zwraca zapisana tresc' $r.Content

    $r = Req PUT "$base/bichu.php?api=1" '{}'
    Check ($r.StatusCode -eq 405) 'PUT = 405' $r.StatusCode

    $r = Req POST "$base/bichu.php?api=1" 'to nie json'
    Check ($r.StatusCode -eq 400) 'niepoprawny JSON = 400' $r.StatusCode

    $big = '{"password":"tajne123","content":"' + ('x' * 70000) + '"}'
    $r = Req POST "$base/bichu.php?api=1" $big
    Check ($r.StatusCode -eq 413) 'tresc ponad 64 kB = 413' $r.StatusCode
    Check ((Get-Content (Join-Path $work 'bichu_content.txt') -Raw) -like '*polskimi*') 'stara tresc nietknieta po odrzuceniu' 'nadpisano'

    Write-Output "`n[C] Limit prob (5 nieudanych w oknie => blokada)"
    for ($i = 1; $i -le 5; $i++) { Req POST "$base/bichu.php?api=1" '{"password":"zle","content":"x"}' | Out-Null }
    $r = Req POST "$base/bichu.php?api=1" '{"password":"zle","content":"x"}'
    Check ($r.StatusCode -eq 429) 'po 5 probach kolejna = 429' $r.StatusCode
    $r = Req POST "$base/bichu.php?api=1" '{"password":"tajne123","content":"nowa tresc"}'
    Check ($r.StatusCode -eq 429) 'blokada obowiazuje takze dla poprawnego hasla' $r.StatusCode
    $attempts = Get-Content (Join-Path $work 'bichu_attempts.json') -Raw
    Check ($attempts -match '"locked_until":\d{9,}') 'plik prob zawiera znacznik blokady' $attempts

    Write-Output "`n[E] Zgodnosc wstecz: config z haslem jawnym"
    Remove-Item (Join-Path $work 'bichu_attempts.json') -Force -ErrorAction SilentlyContinue
    Set-Content -Path (Join-Path $work 'bichu_config.php') -Value "<?php`n`$admin_password = 'stare_haslo';" -Encoding UTF8
    $r = Req POST "$base/bichu.php?api=1" '{"password":"nie_to","content":"x"}'
    Check ($r.StatusCode -eq 403) 'stary format: zle haslo = 403' $r.StatusCode
    Remove-Item (Join-Path $work 'bichu_attempts.json') -Force -ErrorAction SilentlyContinue
    $r = Req POST "$base/bichu.php?api=1" '{"password":"stare_haslo","content":"tresc ze starego formatu"}'
    Check ($r.StatusCode -eq 200) 'stary format: poprawne haslo dziala (zgodnosc wstecz)' $r.StatusCode
    Check ((Get-Content (Join-Path $work 'bichu_content.txt') -Raw) -like '*starego formatu*') 'tresc zapisana przez stary format' 'brak'

    Write-Output "`n[F] Pusty config = fail-closed"
    Remove-Item (Join-Path $work 'bichu_attempts.json') -Force -ErrorAction SilentlyContinue
    Set-Content -Path (Join-Path $work 'bichu_config.php') -Value "<?php`n`$admin_password = '';" -Encoding UTF8
    $r = Req POST "$base/bichu.php?api=1" '{"password":"","content":"defacement"}'
    Check ($r.StatusCode -eq 503) 'puste haslo w configu = 503' $r.StatusCode
    Check ((Get-Content (Join-Path $work 'bichu_content.txt') -Raw) -notlike '*defacement*') 'tresc nietknieta' 'nadpisano'

    Write-Output "`n[D] stats.php"
    $r = Req GET "$base/stats.php" $null
    $json = $r.Content | ConvertFrom-Json
    Check ($r.StatusCode -eq 200) 'stats.php odpowiada 200' $r.StatusCode
    Check ($json.PSObject.Properties.Name -contains 'ram') 'odpowiedz ma pole ram' $r.Content
    Check ($null -eq $json.ram) 'brak /proc/meminfo => ram = null (bez sinusoidy)' $r.Content
    $r2 = Req GET "$base/stats.php" $null
    $json2 = $r2.Content | ConvertFrom-Json
    Check ($json2.age -ge 0) 'odpowiedz zawiera wiek cache (age)' $r2.Content
    $r3 = Req 'POST' "$base/stats.php" $null
    Check ($r3.StatusCode -eq 405) 'POST na stats.php = 405' $r3.StatusCode
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Output ''
if ($fail -eq 0) { Write-Output "PHP API OK - $pass asercji przeszlo" } else { Write-Output "PHP API BLEDY - $fail z $($pass + $fail)"; exit 1 }
