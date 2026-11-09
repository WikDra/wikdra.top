package main

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

type app struct {
	version string
	log     *slog.Logger
	now     func() time.Time
	stats   *statsCache
	bichu   *bichu
}

func newApp(dataDir, ver string, logger *slog.Logger) *app {
	return &app{
		version: ver,
		log:     logger,
		now:     time.Now,
		stats:   newStatsCache(measureSystem, time.Now),
		bichu:   newBichu(dataDir, logger, time.Now),
	}
}

// routes: tylko to, co nginx przekazuje (location = /stats.php, location ^~ /bichu) plus /healthz
// dla skryptu wdrożeń (nginx go nie przekazuje). Reszta → 404.
func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/stats.php", a.handleStats)
	mux.HandleFunc("/bichu", a.bichu.handle)
	mux.HandleFunc("/bichu/{$}", a.bichu.handle)
	mux.HandleFunc("/bichu.php", a.bichu.handle)
	mux.HandleFunc("/healthz", a.handleHealth)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.Error(w, "404 — nie ma takiej strony", http.StatusNotFound)
	})
	return mux
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": a.version})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	h := w.Header()
	if h.Get("Content-Type") == "" {
		h.Set("Content-Type", "application/json; charset=utf-8")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// clientIP: adres klienta. Przed usługą stoi nginx na tej samej maszynie (real_ip z Cloudflare),
// więc X-Real-IP jest wiarygodny tylko z loopbacku; inaczej liczy się adres połączenia.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if x := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); x != nil {
			return x.String()
		}
	}
	return host
}
