package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseCPUUsage(t *testing.T) {
	v, ok := parseCPUUsage([]byte("usage_usec 123456789\nuser_usec 100\nsystem_usec 200\n"))
	if !ok || v != 123456789 {
		t.Fatalf("%d %v", v, ok)
	}
	for _, bad := range []string{"", "user_usec 5\n", "usage_usec abc\n", "usage_usec\n"} {
		if _, ok := parseCPUUsage([]byte(bad)); ok {
			t.Errorf("%q: oczekiwano braku wyniku", bad)
		}
	}
}

func TestParseLoadavg(t *testing.T) {
	if v, ok := parseLoadavg([]byte("0.52 0.58 0.59 1/123 4567\n")); !ok || v != 0.52 {
		t.Fatalf("%v %v", v, ok)
	}
	for _, bad := range []string{"", "x 1 2", "-1 0 0"} {
		if _, ok := parseLoadavg([]byte(bad)); ok {
			t.Errorf("%q", bad)
		}
	}
}

func TestParseMeminfo(t *testing.T) {
	got := parseMeminfo([]byte("MemTotal:         262144 kB\nMemFree:           12000 kB\nMemAvailable:     230000 kB\n"))
	if got == nil || *got != 12.3 {
		t.Fatalf("%v", got)
	}
	for _, bad := range []string{"", "MemTotal: 100 kB\n", "MemAvailable: 5 kB\n", "MemTotal: 0 kB\nMemAvailable: 0 kB\n"} {
		if v := parseMeminfo([]byte(bad)); v != nil {
			t.Errorf("%q → %v (oczekiwano null)", bad, *v)
		}
	}
}

func TestPct(t *testing.T) {
	for in, want := range map[float64]float64{12.34: 12.3, 12.36: 12.4, -3: 0, 100.04: 100, 250: 100, 0: 0} {
		if got := pct(in); got == nil || *got != want {
			t.Errorf("pct(%v) = %v, oczekiwano %v", in, got, want)
		}
	}
}

func withPaths(t *testing.T, cpu, load, mem string) {
	t.Helper()
	oc, ol, om := cpuStatPath, loadavgPath, meminfoPath
	cpuStatPath, loadavgPath, meminfoPath = cpu, load, mem
	t.Cleanup(func() { cpuStatPath, loadavgPath, meminfoPath = oc, ol, om })
}

func TestCPUPercentSources(t *testing.T) {
	dir := t.TempDir()
	cpu := filepath.Join(dir, "cpu.stat")
	load := filepath.Join(dir, "loadavg")
	if err := os.WriteFile(cpu, []byte("usage_usec 1000\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(load, []byte("0.5 0.4 0.3 1/2 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	withPaths(t, cpu, load, filepath.Join(dir, "brak"))

	// cgroup: licznik stoi → 0 %
	if v := cpuPercent(5 * time.Millisecond); v == nil || *v != 0 {
		t.Fatalf("cgroup: %v", v)
	}
	// bez cgroup: loadavg 0.5 → 50 %
	cpuStatPath = filepath.Join(dir, "brak")
	if v := cpuPercent(time.Millisecond); v == nil || *v != 50 {
		t.Fatalf("loadavg: %v", v)
	}
	// bez obu: null
	loadavgPath = filepath.Join(dir, "brak")
	if v := cpuPercent(time.Millisecond); v != nil {
		t.Fatalf("brak źródeł: %v", *v)
	}
	if v := ramPercent(); v != nil {
		t.Fatalf("ram bez /proc/meminfo: %v", *v)
	}
}

func TestStatsCacheTTL(t *testing.T) {
	clk := &clock{t: time.Unix(1_800_000_000, 0)}
	var calls atomic.Int32
	c := newStatsCache(func() sample { calls.Add(1); return sample{At: clk.now()} }, clk.now)
	c.get()
	clk.add(statsTTL - time.Second)
	c.get()
	if calls.Load() != 1 {
		t.Fatalf("w TTL pomiarów: %d", calls.Load())
	}
	clk.add(time.Second)
	c.get()
	if calls.Load() != 2 {
		t.Fatalf("po TTL pomiarów: %d", calls.Load())
	}
}

// Jeden pomiar naraz: bez poprzedniego wyniku pozostali czekają, z poprzednim — dostają go od razu.
func TestStatsCacheSingleMeasurement(t *testing.T) {
	clk := &clock{t: time.Unix(1_800_000_000, 0)}
	release := make(chan struct{})
	started := make(chan struct{}, 10)
	var calls atomic.Int32
	c := newStatsCache(func() sample {
		n := calls.Add(1)
		started <- struct{}{}
		<-release
		v := float64(n)
		return sample{CPU: &v, At: clk.now()}
	}, clk.now)

	var wg sync.WaitGroup
	results := make(chan sample, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- c.get() }()
	}
	<-started
	time.Sleep(20 * time.Millisecond) // reszta goroutin dochodzi do czekania
	close(release)
	wg.Wait()
	close(results)
	for s := range results {
		if s.CPU == nil || *s.CPU != 1 {
			t.Fatalf("wynik %v — oczekiwano wspólnego pomiaru nr 1", s.CPU)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("pomiarów %d", calls.Load())
	}

	// nieaktualny wynik: jeden mierzy, inni dostają stary od razu
	clk.add(statsTTL)
	release2 := make(chan struct{})
	c.measure = func() sample {
		calls.Add(1)
		started <- struct{}{}
		<-release2
		v := 2.0
		return sample{CPU: &v, At: clk.now()}
	}
	done := make(chan sample)
	go func() { done <- c.get() }()
	<-started
	if s := c.get(); s.CPU == nil || *s.CPU != 1 {
		t.Fatalf("w trakcie pomiaru oczekiwano starego wyniku, jest %v", s.CPU)
	}
	close(release2)
	if s := <-done; *s.CPU != 2 {
		t.Fatalf("mierzący dostał %v", *s.CPU)
	}
}

func TestStatsHandler(t *testing.T) {
	e := newTestEnv(t, false)
	rec := e.do(http.MethodGet, "/stats.php", "", "")
	expect(t, rec, http.StatusOK)
	h := rec.Header()
	if h.Get("Cache-Control") != "no-store" || h.Get("Content-Type") != "application/json; charset=utf-8" || h.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("nagłówki %v", h)
	}
	var v map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	if v["cpu"] != 12.5 || v["ram"] != nil || v["disk"] != nil || v["age"] != 0.0 {
		t.Fatalf("odpowiedź %s", rec.Body.String())
	}
	if _, ok := v["ram"]; !ok {
		t.Fatal("pole ram musi być (null), nie może zniknąć")
	}

	e.clk.add(4 * time.Second)
	rec = e.do(http.MethodGet, "/stats.php", "", "")
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil || v["age"] != 4.0 {
		t.Fatalf("wiek wyniku: %s", rec.Body.String())
	}

	rec = e.do(http.MethodPost, "/stats.php", "", "")
	expect(t, rec, http.StatusMethodNotAllowed)
	if rec.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("Allow %q", rec.Header().Get("Allow"))
	}
	expect(t, e.do(http.MethodHead, "/stats.php", "", ""), http.StatusOK)
}

// Prawdziwy pomiar na maszynie testów (Linux w CI): wartości w zakresie albo null, bez paniki.
func TestMeasureSystem(t *testing.T) {
	s := measureSystem()
	for name, v := range map[string]*float64{"cpu": s.CPU, "ram": s.RAM, "disk": s.Disk} {
		if v != nil && (*v < 0 || *v > 100) {
			t.Errorf("%s = %v poza 0–100", name, *v)
		}
	}
	t.Logf("cpu=%v ram=%v disk=%v", deref(s.CPU), deref(s.RAM), deref(s.Disk))
}

func deref(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
