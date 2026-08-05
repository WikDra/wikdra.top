<?php
declare(strict_types=1);

/**
 * stats.php — metryki kontenera (CPU / RAM / dysk) dla strony głównej.
 *
 * Dwie zasady:
 *  1. Pomiar CPU wymaga okna czasowego (dwa odczyty cgroup cpu.stat). Okno
 *     wykonuje MAKSYMALNIE jedno żądanie na TTL, pod nieblokującą blokadą —
 *     pozostałe żądania dostają wynik z cache i nie trzymają workera PHP-FPM.
 *  2. Nigdy nie zmyślamy danych. Metryka niedostępna = null (front pokazuje „—").
 */

const STATS_TTL_SEC = 10;
const STATS_SAMPLE_US = 300000; // 300 ms okno próbkowania cpu.stat

$cacheFile = sys_get_temp_dir() . '/wikdra-stats.json';
$lockFile = sys_get_temp_dir() . '/wikdra-stats.lock';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, HEAD');
    http_response_code(405);
    echo json_encode(['error' => 'Metoda nieobsługiwana.']);
    exit;
}

/** @return array{cpu: float|null, ram: float|null, disk: float|null, at: int} */
function stats_measure(): array
{
    return [
        'cpu' => stats_cpu_percent(),
        'ram' => stats_ram_percent(),
        'disk' => stats_disk_percent(),
        'at' => time(),
    ];
}

/**
 * %CPU kontenera z cgroup v2 (usage_usec w dwóch punktach czasu).
 * sys_getloadavg() na tym hoście LXC pokazuje obciążenie HOSTA, nie kontenera,
 * więc jest tylko awaryjnym przybliżeniem (1 vCPU: load 1.0 ≈ 100%).
 */
function stats_cpu_percent(): ?float
{
    $first = @file_get_contents('/sys/fs/cgroup/cpu.stat');
    if ($first !== false && preg_match('/usage_usec\s+(\d+)/', $first, $m1)) {
        $t1 = microtime(true);
        usleep(STATS_SAMPLE_US);
        $second = @file_get_contents('/sys/fs/cgroup/cpu.stat');
        $t2 = microtime(true);
        if ($second !== false && preg_match('/usage_usec\s+(\d+)/', $second, $m2)) {
            $elapsedUs = ($t2 - $t1) * 1e6;
            if ($elapsedUs > 0) {
                $percent = ((int) $m2[1] - (int) $m1[1]) / $elapsedUs * 100;
                return round(min(max($percent, 0), 100), 1);
            }
        }
    }
    $loadavg = @file_get_contents('/proc/loadavg');
    if ($loadavg !== false && preg_match('/^([\d.]+)/', $loadavg, $lm)) {
        return round(min((float) $lm[1] * 100, 100), 1);
    }
    return null;
}

function stats_ram_percent(): ?float
{
    $info = @file_get_contents('/proc/meminfo');
    if ($info === false) {
        return null;
    }
    if (!preg_match('/MemTotal:\s+(\d+) kB/', $info, $total)) {
        return null;
    }
    if (!preg_match('/MemAvailable:\s+(\d+) kB/', $info, $available)) {
        return null;
    }
    $totalKb = (float) $total[1];
    if ($totalKb <= 0) {
        return null;
    }
    return round((1 - ((float) $available[1] / $totalKb)) * 100, 1);
}

function stats_disk_percent(): ?float
{
    $total = @disk_total_space('/');
    $free = @disk_free_space('/');
    if ($total === false || $free === false || $total <= 0) {
        return null;
    }
    return round((1 - ($free / $total)) * 100, 1);
}

function stats_read_cache(string $path): ?array
{
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) && isset($data['at']) ? $data : null;
}

function stats_write_cache(string $path, array $data): void
{
    $tmp = @tempnam(dirname($path), '.wstats');
    if ($tmp === false) {
        return;
    }
    $encoded = json_encode($data);
    if ($encoded === false || @file_put_contents($tmp, $encoded) === false || !@rename($tmp, $path)) {
        @unlink($tmp);
    }
}

$cached = stats_read_cache($cacheFile);
$now = time();
$fresh = $cached !== null && ($now - (int) $cached['at']) < STATS_TTL_SEC;

if (!$fresh) {
    // Tylko jeden proces próbkuje; reszta oddaje ostatni znany wynik.
    $lock = @fopen($lockFile, 'c');
    if ($lock !== false) {
        if (flock($lock, LOCK_EX | LOCK_NB)) {
            $cached = stats_measure();
            stats_write_cache($cacheFile, $cached);
            flock($lock, LOCK_UN);
        }
        fclose($lock);
    } elseif ($cached === null) {
        $cached = stats_measure();
    }
}

if ($cached === null) {
    $cached = ['cpu' => null, 'ram' => null, 'disk' => null, 'at' => $now];
}

echo json_encode([
    'cpu' => $cached['cpu'],
    'ram' => $cached['ram'],
    'disk' => $cached['disk'],
    'age' => max(0, $now - (int) $cached['at']),
]);
