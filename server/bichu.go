package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"html"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

// Bichu — strona z jedną treścią i edycją chronioną jednym hasłem.
//   - FAIL-CLOSED: bez poprawnego <data-dir>/bichu.hash zapis zawsze 503;
//   - limit prób przed sprawdzeniem hasła: 5 błędnych w 15 min → 5 min blokady dla adresu,
//     40 błędnych w 15 min od wszystkich → zapis zablokowany dla każdego (rozproszony brute force);
//     liczniki w pamięci (restart usługi je zeruje);
//   - bcrypt sprawdzany po jednym naraz (słaby vCPU), treść walidowana i zapisywana atomowo.
const (
	bichuContentFile = "bichu.txt"
	bichuHashFile    = "bichu.hash"
	bichuMaxBytes    = 64 << 10  // treść (musi zgadzać się z MAX_CONTENT_BYTES w bichu-app.js)
	bichuMaxBody     = 256 << 10 // surowe żądanie
	bichuMaxFails    = 5
	bichuWindow      = 15 * time.Minute
	bichuLockout     = 5 * time.Minute
	bichuGlobalFails = 40
	bichuMaxClients  = 500
	bichuVerifyWait  = 5 * time.Second
)

//go:embed bichu.html
var bichuPage string

type attempts struct {
	fails       int
	first       time.Time
	lockedUntil time.Time
}

type bichu struct {
	dir string
	log *slog.Logger
	now func() time.Time

	mu      sync.Mutex // liczniki prób
	clients map[string]*attempts
	global  attempts

	verify chan struct{} // jedno sprawdzenie bcrypt naraz
}

func newBichu(dir string, logger *slog.Logger, now func() time.Time) *bichu {
	return &bichu{dir: dir, log: logger, now: now, clients: map[string]*attempts{}, verify: make(chan struct{}, 1)}
}

func (b *bichu) contentPath() string { return filepath.Join(b.dir, bichuContentFile) }

func (b *bichu) readContent() (string, error) {
	data, err := os.ReadFile(b.contentPath())
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	return string(data), err
}

// loadHash: hash bcrypt z pliku albo nil (brak, pusty, nie bcrypt). Czytany przy każdym zapisie,
// więc zmiana hasła (`wikdra hash-password`) działa bez restartu.
func (b *bichu) loadHash() []byte {
	data, err := os.ReadFile(filepath.Join(b.dir, bichuHashFile))
	if err != nil {
		return nil
	}
	h := []byte(strings.TrimSpace(string(data)))
	if _, err := bcrypt.Cost(h); err != nil {
		return nil
	}
	return h
}

func (b *bichu) passwordConfigured() bool { return b.loadHash() != nil }

// handle: /bichu, /bichu/, /bichu.php — z ?api (dowolna wartość) API JSON, bez — strona.
func (b *bichu) handle(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("X-Robots-Tag", "noindex, nofollow")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "no-store")
	if r.URL.Query().Has("api") {
		b.handleAPI(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.Set("Allow", "GET, HEAD")
		http.Error(w, "Metoda nieobsługiwana.", http.StatusMethodNotAllowed)
		return
	}
	content, err := b.readContent()
	if err != nil {
		b.log.Error("bichu: odczyt treści", "err", err)
		http.Error(w, "Nie udało się odczytać treści.", http.StatusInternalServerError)
		return
	}
	h.Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, renderBichuPage(content))
}

// renderBichuPage: treść jako JSON dla skryptu (json.Marshal zamienia < > & na \u003c…, więc
// `</script>` nie zamknie znacznika) i jako tekst HTML dla widoku bez JS.
func renderBichuPage(content string) string {
	js, _ := json.Marshal(content) // string zawsze się serializuje
	return strings.NewReplacer("{{INITIAL_JSON}}", string(js), "{{INITIAL_TEXT}}", html.EscapeString(content)).Replace(bichuPage)
}

type apiError struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Success: false, Error: msg})
}

func (b *bichu) handleAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		content, err := b.readContent()
		if err != nil {
			b.log.Error("bichu: odczyt treści", "err", err)
			fail(w, http.StatusInternalServerError, "Nie udało się odczytać treści.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"content": content})
	case http.MethodPost:
		b.save(w, r)
	default:
		w.Header().Set("Allow", "GET, HEAD, POST")
		fail(w, http.StatusMethodNotAllowed, "Metoda nieobsługiwana.")
	}
}

func (b *bichu) save(w http.ResponseWriter, r *http.Request) {
	// ——— 1. wejście ———
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, bichuMaxBody))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "Żądanie za duże.")
			return
		}
		fail(w, http.StatusBadRequest, "Nie udało się odczytać żądania.")
		return
	}
	if !utf8.Valid(raw) {
		fail(w, http.StatusBadRequest, "Treść musi być poprawnym UTF-8.")
		return
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		fail(w, http.StatusBadRequest, "Oczekiwano obiektu JSON.")
		return
	}
	password, ok1 := jsonString(fields["password"])
	content, ok2 := jsonString(fields["content"])
	if !ok1 || !ok2 {
		fail(w, http.StatusBadRequest, `Pola "password" i "content" muszą być tekstem.`)
		return
	}
	ip := clientIP(r)

	// ——— 2. limit prób (przed hasłem) ———
	if b.rejectIfLimited(w, ip) {
		return
	}

	// ——— 3. FAIL-CLOSED ———
	hash := b.loadHash()
	if hash == nil {
		b.log.Warn("bichu: brak hasła (bichu.hash) — zapis odrzucony", "ip", ip)
		fail(w, http.StatusServiceUnavailable, "Edycja jest wyłączona: brak konfiguracji hasła na serwerze.")
		return
	}

	// ——— 4. hasło (bcrypt po jednym naraz; limit sprawdzony ponownie po czekaniu) ———
	ctx, cancel := context.WithTimeout(r.Context(), bichuVerifyWait)
	defer cancel()
	select {
	case b.verify <- struct{}{}:
	case <-ctx.Done():
		w.Header().Set("Retry-After", "5")
		fail(w, http.StatusServiceUnavailable, "Serwer jest zajęty. Spróbuj za chwilę.")
		return
	}
	if b.rejectIfLimited(w, ip) {
		<-b.verify
		return
	}
	match := bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
	if !match {
		fails := b.recordFailure(ip)
		<-b.verify
		b.log.Info("bichu: błędne hasło", "ip", ip, "fails", fails)
		fail(w, http.StatusForbidden, "Błędne hasło.")
		return
	}
	b.recordSuccess(ip)
	<-b.verify

	// ——— 5. treść ———
	if len(content) > bichuMaxBytes {
		fail(w, http.StatusRequestEntityTooLarge, "Treść przekracza "+strconv.Itoa(bichuMaxBytes/1024)+" kB.")
		return
	}

	// ——— 6. zapis ———
	b.mu.Lock()
	err = writeFileAtomic(b.contentPath(), []byte(content), 0o640)
	b.mu.Unlock()
	if err != nil {
		b.log.Error("bichu: zapis treści", "err", err)
		fail(w, http.StatusInternalServerError, "Zapis na serwerze nie powiódł się.")
		return
	}
	b.log.Info("bichu: zapisano", "ip", ip, "bytes", len(content))
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// jsonString: wartość pola, tylko gdy to tekst JSON (nie liczba, null, obiekt).
func jsonString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// ——— limit prób ———

func (b *bichu) rejectIfLimited(w http.ResponseWriter, ip string) bool {
	retry, who := b.limited(ip)
	switch who {
	case "client":
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		fail(w, http.StatusTooManyRequests, "Zbyt wiele nieudanych prób. Odczekaj kilka minut.")
		return true
	case "global":
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		fail(w, http.StatusTooManyRequests, "Zapis chwilowo zablokowany. Spróbuj później.")
		return true
	}
	return false
}

// limited: ("client"|"global"|"", sekundy do odblokowania).
func (b *bichu) limited(ip string) (int, string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.prune(now)
	if e := b.clients[ip]; e != nil && e.lockedUntil.After(now) {
		return seconds(e.lockedUntil.Sub(now)), "client"
	}
	if b.global.fails >= bichuGlobalFails {
		return seconds(b.global.first.Add(bichuWindow).Sub(now)), "global"
	}
	return 0, ""
}

// recordFailure: kolejna błędna próba; od 5. w oknie każda daje blokadę. Licznik nie jest
// zerowany po blokadzie — inaczej po 5 minutach znów byłoby 5 prób.
func (b *bichu) recordFailure(ip string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.prune(now)
	e := b.clients[ip]
	if e == nil || !e.first.Add(bichuWindow).After(now) {
		e = &attempts{first: now}
		b.clients[ip] = e
	}
	e.fails++
	if e.fails >= bichuMaxFails {
		e.lockedUntil = now.Add(bichuLockout)
	}
	if b.global.first.IsZero() {
		b.global.first = now
	}
	b.global.fails++
	b.prune(now) // limit liczby adresów także zaraz po dodaniu nowego
	return e.fails
}

// recordSuccess: poprawne hasło czyści licznik tego adresu (globalnego nie).
func (b *bichu) recordSuccess(ip string) {
	b.mu.Lock()
	delete(b.clients, ip)
	b.mu.Unlock()
}

// prune (pod b.mu): usuwa wpisy poza oknem i blokadą, zeruje licznik globalny po oknie i trzyma
// najwyżej bichuMaxClients najnowszych adresów.
func (b *bichu) prune(now time.Time) {
	for ip, e := range b.clients {
		if !e.lockedUntil.After(now) && !e.first.Add(bichuWindow).After(now) {
			delete(b.clients, ip)
		}
	}
	if !b.global.first.IsZero() && !b.global.first.Add(bichuWindow).After(now) {
		b.global = attempts{}
	}
	if len(b.clients) > bichuMaxClients {
		ips := make([]string, 0, len(b.clients))
		for ip := range b.clients {
			ips = append(ips, ip)
		}
		sort.Slice(ips, func(i, j int) bool { return b.clients[ips[i]].first.Before(b.clients[ips[j]].first) })
		for _, ip := range ips[:len(ips)-bichuMaxClients] {
			delete(b.clients, ip)
		}
	}
}

func seconds(d time.Duration) int {
	s := int(math.Ceil(d.Seconds()))
	if s < 1 {
		return 1
	}
	return s
}
