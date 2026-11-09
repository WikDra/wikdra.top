package main

import (
	"bytes"
	"math"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// Metryki kontenera dla strony głównej (index-app.js co 10 s). Zasady jak w dawnym stats.php:
//   - CPU wymaga okna (dwa odczyty cgroup cpu.stat co 300 ms); pomiar robi najwyżej jedno żądanie
//     naraz, a w ciągu 10 s wszyscy dostają wynik z pamięci;
//   - metryka niedostępna = null (front pokazuje „—”), nigdy wartość zmyślona.
const (
	statsTTL    = 10 * time.Second
	statsWindow = 300 * time.Millisecond
)

type sample struct {
	CPU, RAM, Disk *float64
	At             time.Time
}

type statsResponse struct {
	CPU  *float64 `json:"cpu"`
	RAM  *float64 `json:"ram"`
	Disk *float64 `json:"disk"`
	Age  int      `json:"age"`
}

func (a *app) handleStats(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.Set("Allow", "GET, HEAD")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Metoda nieobsługiwana."})
		return
	}
	s := a.stats.get()
	age := int(a.now().Sub(s.At) / time.Second)
	if age < 0 {
		age = 0
	}
	writeJSON(w, http.StatusOK, statsResponse{CPU: s.CPU, RAM: s.RAM, Disk: s.Disk, Age: age})
}

// statsCache: wynik ważny statsTTL. Gdy jest nieaktualny, mierzy dokładnie jedno żądanie; pozostałe
// w tym czasie dostają poprzedni wynik, a jeśli jeszcze żadnego nie ma — czekają na pomiar.
type statsCache struct {
	measure func() sample
	now     func() time.Time

	mu       sync.Mutex
	last     *sample
	inflight chan struct{}
}

func newStatsCache(measure func() sample, now func() time.Time) *statsCache {
	return &statsCache{measure: measure, now: now}
}

func (c *statsCache) get() sample {
	c.mu.Lock()
	if c.last != nil && c.now().Sub(c.last.At) < statsTTL {
		s := *c.last
		c.mu.Unlock()
		return s
	}
	if ch := c.inflight; ch != nil {
		if c.last != nil {
			s := *c.last
			c.mu.Unlock()
			return s
		}
		c.mu.Unlock()
		<-ch
		c.mu.Lock()
		s := *c.last
		c.mu.Unlock()
		return s
	}
	ch := make(chan struct{})
	c.inflight = ch
	c.mu.Unlock()

	s := c.measure()

	c.mu.Lock()
	c.last = &s
	c.inflight = nil
	close(ch)
	c.mu.Unlock()
	return s
}

// ——— pomiar ———

var (
	cpuStatPath = "/sys/fs/cgroup/cpu.stat"
	loadavgPath = "/proc/loadavg"
	meminfoPath = "/proc/meminfo"
)

func measureSystem() sample {
	return sample{CPU: cpuPercent(statsWindow), RAM: ramPercent(), Disk: diskPercent("/"), At: time.Now()}
}

// cpuPercent: %CPU kontenera z cgroup v2 (usage_usec w dwóch punktach czasu). loadavg na tym hoście
// LXC pokazuje obciążenie hosta, nie kontenera — tylko awaryjnie (1 vCPU: load 1.0 ≈ 100%).
func cpuPercent(window time.Duration) *float64 {
	if u1, ok := readCPUUsage(); ok {
		t1 := time.Now()
		time.Sleep(window)
		if u2, ok := readCPUUsage(); ok {
			if el := time.Since(t1).Microseconds(); el > 0 {
				return pct(float64(int64(u2)-int64(u1)) / float64(el) * 100)
			}
		}
	}
	if b, err := os.ReadFile(loadavgPath); err == nil {
		if l, ok := parseLoadavg(b); ok {
			return pct(l * 100)
		}
	}
	return nil
}

func readCPUUsage() (uint64, bool) {
	b, err := os.ReadFile(cpuStatPath)
	if err != nil {
		return 0, false
	}
	return parseCPUUsage(b)
}

// parseCPUUsage: wartość `usage_usec` z cpu.stat cgroup v2.
func parseCPUUsage(b []byte) (uint64, bool) {
	for _, line := range bytes.Split(b, []byte("\n")) {
		f := bytes.Fields(line)
		if len(f) == 2 && string(f[0]) == "usage_usec" {
			v, err := strconv.ParseUint(string(f[1]), 10, 64)
			return v, err == nil
		}
	}
	return 0, false
}

// parseLoadavg: pierwsza liczba z /proc/loadavg (średnia z 1 minuty).
func parseLoadavg(b []byte) (float64, bool) {
	f := bytes.Fields(b)
	if len(f) == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(string(f[0]), 64)
	return v, err == nil && v >= 0
}

func ramPercent() *float64 {
	b, err := os.ReadFile(meminfoPath)
	if err != nil {
		return nil
	}
	return parseMeminfo(b)
}

// parseMeminfo: zajęta pamięć = 1 − MemAvailable/MemTotal (w LXC /proc/meminfo dotyczy kontenera).
func parseMeminfo(b []byte) *float64 {
	var total, avail float64
	var haveT, haveA bool
	for _, line := range bytes.Split(b, []byte("\n")) {
		f := bytes.Fields(line)
		if len(f) < 2 {
			continue
		}
		v, err := strconv.ParseFloat(string(f[1]), 64)
		if err != nil {
			continue
		}
		switch string(f[0]) {
		case "MemTotal:":
			total, haveT = v, true
		case "MemAvailable:":
			avail, haveA = v, true
		}
	}
	if !haveT || !haveA || total <= 0 {
		return nil
	}
	return pct((1 - avail/total) * 100)
}

// pct: procent przycięty do 0–100 i zaokrąglony do 0,1.
func pct(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	v = math.Round(math.Min(math.Max(v, 0), 100)*10) / 10
	return &v
}
