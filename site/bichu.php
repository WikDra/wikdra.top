<?php
declare(strict_types=1);

/**
 * bichu.php — mini-edytor treści z jednym hasłem administratora.
 *
 * Zasady bezpieczeństwa:
 *  1. FAIL-CLOSED: brak konfiguracji hasła = 503 i ŻADNEGO zapisu.
 *     (wcześniej brak configu dawał puste hasło, które przechodziło walidację)
 *  2. Preferowany `$admin_password_hash` (password_hash) — `$admin_password`
 *     w postaci jawnej jest wspierany dla zgodności wstecz, ale odradzany.
 *  3. Limit prób per klient + globalny, liczony pod flock() — bez wyścigu
 *     read-modify-write i bez blokującego sleep().
 *  4. Zapis walidowany (typ, UTF-8, rozmiar) i atomowy (tmp + rename).
 */

const BICHU_CONTENT_FILE  = __DIR__ . '/bichu_content.txt';
const BICHU_ATTEMPTS_FILE = __DIR__ . '/bichu_attempts.json';
const BICHU_MAX_BYTES     = 65536;   // 64 kB treści
const BICHU_MAX_BODY      = 262144;  // 256 kB surowego żądania
const BICHU_MAX_FAILS     = 5;       // nieudane próby per klient…
const BICHU_WINDOW_SEC    = 900;     // …w oknie 15 minut
const BICHU_LOCKOUT_SEC   = 300;     // blokada 5 minut
const BICHU_GLOBAL_FAILS  = 40;      // zapora na rozproszony brute force
const BICHU_MAX_CLIENTS   = 500;     // limit wpisów w pliku prób

$admin_password = null;
$admin_password_hash = null;
if (is_file(__DIR__ . '/bichu_config.php')) {
    require_once __DIR__ . '/bichu_config.php';
}
$bichu_hash = (isset($admin_password_hash) && is_string($admin_password_hash) && strlen($admin_password_hash) >= 20)
    ? $admin_password_hash
    : null;
$bichu_plain = (isset($admin_password) && is_string($admin_password) && $admin_password !== '')
    ? $admin_password
    : null;
$bichu_auth_configured = ($bichu_hash !== null || $bichu_plain !== null);

/** Identyfikator klienta do limitu prób. REMOTE_ADDR — nagłówków nie da się podrobić przez proxy. */
function bichu_client_key(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return substr(hash('sha256', 'bichu|' . $ip), 0, 32);
}

/**
 * Read-modify-write pliku prób pod wyłączną blokadą.
 * @param callable $mutator fn(array $state): array — zwraca nowy stan
 * @return array stan po zmianie
 */
function bichu_with_attempts(callable $mutator): array
{
    $handle = @fopen(BICHU_ATTEMPTS_FILE, 'c+');
    if ($handle === false) {
        // Nie da się egzekwować limitu → działamy zachowawczo na stanie pustym.
        return $mutator(['clients' => [], 'global' => ['fails' => 0, 'first' => 0]]);
    }
    try {
        if (!flock($handle, LOCK_EX)) {
            return $mutator(['clients' => [], 'global' => ['fails' => 0, 'first' => 0]]);
        }
        $size = (int) (fstat($handle)['size'] ?? 0);
        $raw = $size > 0 ? (string) fread($handle, $size) : '';
        $state = json_decode($raw, true);
        if (!is_array($state)) {
            $state = [];
        }
        if (!isset($state['clients']) || !is_array($state['clients'])) {
            $state['clients'] = [];
        }
        if (!isset($state['global']) || !is_array($state['global'])) {
            $state['global'] = ['fails' => 0, 'first' => 0];
        }

        $now = time();
        // Sprzątanie: wpisy poza oknem i poza blokadą są nieistotne.
        foreach ($state['clients'] as $key => $entry) {
            $first = (int) ($entry['first'] ?? 0);
            $locked = (int) ($entry['locked_until'] ?? 0);
            if ($locked <= $now && $first + BICHU_WINDOW_SEC <= $now) {
                unset($state['clients'][$key]);
            }
        }
        if ((int) ($state['global']['first'] ?? 0) + BICHU_WINDOW_SEC <= $now) {
            $state['global'] = ['fails' => 0, 'first' => $now];
        }
        if (count($state['clients']) > BICHU_MAX_CLIENTS) {
            $state['clients'] = array_slice($state['clients'], -BICHU_MAX_CLIENTS, null, true);
        }

        $state = $mutator($state);

        $encoded = json_encode($state, JSON_UNESCAPED_UNICODE);
        if ($encoded !== false) {
            rewind($handle);
            ftruncate($handle, 0);
            fwrite($handle, $encoded);
            fflush($handle);
        }
        return $state;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function bichu_json(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Atomowy zapis: tmp w tym samym katalogu + rename (nigdy pół pliku). */
function bichu_write_atomic(string $path, string $data): bool
{
    $tmp = @tempnam(dirname($path), '.bichu');
    if ($tmp === false) {
        return false;
    }
    if (@file_put_contents($tmp, $data) !== strlen($data)) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/**
 * Walidacja UTF-8 bez zakładania, że mbstring jest zbudowany w PHP-FPM.
 * `preg_match('//u', …)` zwraca false dla niepoprawnego UTF-8 (PCRE jest zawsze).
 */
function bichu_is_utf8(string $value): bool
{
    if (function_exists('mb_check_encoding')) {
        return mb_check_encoding($value, 'UTF-8');
    }
    return preg_match('//u', $value) === 1;
}

if (isset($_GET['api'])) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET' || $method === 'HEAD') {
        $content = is_file(BICHU_CONTENT_FILE) ? (string) file_get_contents(BICHU_CONTENT_FILE) : '';
        bichu_json(200, ['content' => $content]);
    }

    if ($method !== 'POST') {
        header('Allow: GET, HEAD, POST');
        bichu_json(405, ['success' => false, 'error' => 'Metoda nieobsługiwana.']);
    }

    // ——— 1. wejście ———
    $raw = (string) file_get_contents('php://input', false, null, 0, BICHU_MAX_BODY + 1);
    if (strlen($raw) > BICHU_MAX_BODY) {
        bichu_json(413, ['success' => false, 'error' => 'Żądanie za duże.']);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        bichu_json(400, ['success' => false, 'error' => 'Oczekiwano obiektu JSON.']);
    }
    $password = $data['password'] ?? null;
    $content = $data['content'] ?? null;
    if (!is_string($password) || !is_string($content)) {
        bichu_json(400, ['success' => false, 'error' => 'Pola "password" i "content" muszą być tekstem.']);
    }

    // ——— 2. limit prób (przed weryfikacją hasła) ———
    $clientKey = bichu_client_key();
    $now = time();
    $limitState = ['locked' => false, 'global_locked' => false];
    bichu_with_attempts(function (array $state) use ($clientKey, $now, &$limitState): array {
        $entry = $state['clients'][$clientKey] ?? ['fails' => 0, 'first' => $now, 'locked_until' => 0];
        if ((int) $entry['locked_until'] > $now) {
            $limitState['locked'] = true;
            $limitState['retry_after'] = (int) $entry['locked_until'] - $now;
        }
        if ((int) ($state['global']['fails'] ?? 0) >= BICHU_GLOBAL_FAILS) {
            $limitState['global_locked'] = true;
        }
        $state['clients'][$clientKey] = $entry;
        return $state;
    });
    if ($limitState['locked']) {
        header('Retry-After: ' . (int) ($limitState['retry_after'] ?? BICHU_LOCKOUT_SEC));
        bichu_json(429, ['success' => false, 'error' => 'Zbyt wiele nieudanych prób. Odczekaj kilka minut.']);
    }
    if ($limitState['global_locked']) {
        header('Retry-After: ' . BICHU_LOCKOUT_SEC);
        bichu_json(429, ['success' => false, 'error' => 'Zapis chwilowo zablokowany. Spróbuj później.']);
    }

    // ——— 3. FAIL-CLOSED: bez skonfigurowanego hasła nie zapisujemy nigdy ———
    if (!$bichu_auth_configured) {
        error_log('bichu.php: brak bichu_config.php lub puste hasło — zapis odrzucony (fail-closed)');
        bichu_json(503, ['success' => false, 'error' => 'Edycja jest wyłączona: brak konfiguracji hasła na serwerze.']);
    }

    // ——— 4. weryfikacja ———
    $ok = ($bichu_hash !== null)
        ? password_verify($password, $bichu_hash)
        : hash_equals((string) $bichu_plain, $password);

    if (!$ok) {
        bichu_with_attempts(function (array $state) use ($clientKey, $now): array {
            $entry = $state['clients'][$clientKey] ?? ['fails' => 0, 'first' => $now, 'locked_until' => 0];
            if ((int) $entry['first'] + BICHU_WINDOW_SEC <= $now) {
                $entry = ['fails' => 0, 'first' => $now, 'locked_until' => 0];
            }
            $entry['fails'] = (int) $entry['fails'] + 1;
            if ($entry['fails'] >= BICHU_MAX_FAILS) {
                // licznik NIE jest zerowany — inaczej blokada byłaby jednorazowa
                $entry['locked_until'] = $now + BICHU_LOCKOUT_SEC;
            }
            $state['clients'][$clientKey] = $entry;
            if ((int) ($state['global']['first'] ?? 0) === 0) {
                $state['global']['first'] = $now;
            }
            $state['global']['fails'] = (int) ($state['global']['fails'] ?? 0) + 1;
            return $state;
        });
        bichu_json(403, ['success' => false, 'error' => 'Błędne hasło.']);
    }

    // ——— 5. walidacja treści ———
    if (!bichu_is_utf8($content)) {
        bichu_json(400, ['success' => false, 'error' => 'Treść musi być poprawnym UTF-8.']);
    }
    if (strlen($content) > BICHU_MAX_BYTES) {
        bichu_json(413, ['success' => false, 'error' => 'Treść przekracza ' . (BICHU_MAX_BYTES / 1024) . ' kB.']);
    }

    // ——— 6. zapis ———
    if (!bichu_write_atomic(BICHU_CONTENT_FILE, $content)) {
        error_log('bichu.php: zapis ' . BICHU_CONTENT_FILE . ' nie powiódł się');
        bichu_json(500, ['success' => false, 'error' => 'Zapis na serwerze nie powiódł się.']);
    }

    // udana autoryzacja czyści licznik TEGO klienta
    bichu_with_attempts(function (array $state) use ($clientKey): array {
        unset($state['clients'][$clientKey]);
        return $state;
    });

    bichu_json(200, ['success' => true]);
}

$bichu_initial_content = is_file(BICHU_CONTENT_FILE) ? (string) file_get_contents(BICHU_CONTENT_FILE) : '';
header('X-Robots-Tag: noindex, nofollow');
?>
<!DOCTYPE html>
<html lang="pl" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bichu | Wikdra.top</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" href="/assets/icons/favicon.png" type="image/png">

    <!-- Motyw: musi wykonać się przed pierwszym malowaniem (anti-FOUC) -->
    <script src="/assets/js/theme.js"></script>

    <link rel="stylesheet" href="/assets/css/app-v6.css">
    <style>[x-cloak] { display: none !important; }</style>

    <!-- Kolejność: skrypt aplikacji przed alpine.min.js (rejestruje 'alpine:init'). -->
    <script defer src="/assets/js/bichu-app.js"></script>
    <script defer src="/assets/js/alpine.min.js"></script>
</head>
<body x-data="bichuApp" class="min-h-screen p-4 md:p-8 relative">

    <!-- Background decoration (CSS-controlled per theme) -->
    <div class="bg-decoration" aria-hidden="true">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
        <div class="cyber-grid"></div>
        <div class="cyber-scanlines"></div>
        <div class="cyber-glow"></div>
        <div class="cyber-sun"></div>
    </div>

    <div class="max-w-4xl mx-auto z-10 relative space-y-8">

        <!-- HEADER -->
        <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 w-full">
            <div>
                <h1>
                    <a href="/" class="page-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                        <span>Bichu</span>
                    </a>
                </h1>
            </div>

            <div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                <a href="/" class="theme-btn px-3 sm:px-4 text-xs sm:text-sm inline-flex items-center gap-1.5" style="text-decoration:none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0" style="height:0.9em;width:0.9em" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
                    <span>Powrót</span>
                </a>

                <!-- switcher motywu wstawia theme.js -->
                <div data-theme-switcher></div>
            </div>
        </header>

        <p class="status-msg" role="status" aria-live="polite" x-show="status.message"
           :data-kind="status.kind" x-text="status.message" style="display: none;"></p>

        <main class="w-full relative">
            <!-- Treść początkowa dla JS (bez migotania i bez zbędnego zapytania na starcie) -->
            <script id="bichu-initial" type="application/json"><?= json_encode($bichu_initial_content, JSON_HEX_TAG | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?></script>

            <!-- Widok treści (bez x-cloak: bez JS też ma być czytelny) -->
            <div x-show="!editMode" class="panel-card p-8 min-h-[300px] relative group">
                <h2 class="sr-only">Treść strony Bichu</h2>
                <div class="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-base leading-relaxed"
                     x-text="content || 'Brak treści...'"><?= htmlspecialchars($bichu_initial_content, ENT_QUOTES, 'UTF-8') ?></div>

                <!--
                  Widoczny zawsze na urządzeniach bez hovera (telefon) i przy fokusie
                  z klawiatury; na desktopie odsłania się po najechaniu.
                -->
                <button id="bichu-edit-btn" type="button" @click="openEditor()"
                        class="absolute top-4 right-4 theme-btn px-4 py-1.5 text-xs transition-opacity duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="height:0.8em;width:0.8em;margin-right:0.4em" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Edytuj
                </button>
            </div>

            <!-- Tryb edycji -->
            <form x-show="editMode" x-cloak class="panel-card p-8 space-y-6 relative" @submit.prevent="save()">
                <h2 class="sr-only">Edycja treści</h2>
                <div class="flex flex-col gap-2">
                    <label class="label-tiny" for="bichu-password">Hasło edycji</label>
                    <input id="bichu-password" type="password" x-model="password" placeholder="Wpisz hasło..."
                           class="theme-input text-sm" autocomplete="current-password" required>
                </div>
                <div class="flex flex-col gap-2">
                    <label class="label-tiny" for="bichu-content">Treść strony</label>
                    <textarea id="bichu-content" x-model="tempContent" rows="12" class="theme-input resize-none font-mono text-sm"></textarea>
                </div>
                <div class="flex flex-wrap gap-4">
                    <button type="submit" :disabled="saving" class="theme-btn py-2.5 px-6 text-sm flex-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="height:0.9em;width:0.9em;margin-right:0.4em" :class="{ 'spin-icon': saving }" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                        ZAPISZ ZMIANY
                    </button>
                    <button type="button" @click="cancelEditor()" class="theme-btn theme-btn-secondary py-2.5 px-6 text-sm">Anuluj</button>
                </div>
            </form>
        </main>
    </div>

    <script>
        WikdraTheme.mountSwitcher();
    </script>
</body>
</html>
