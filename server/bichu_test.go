package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const testPassword = "tajne-haslo-123"

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

type testEnv struct {
	t   *testing.T
	dir string
	clk *clock
	app *app
	h   http.Handler
}

func newTestEnv(t *testing.T, withPassword bool) *testEnv {
	t.Helper()
	dir := t.TempDir()
	clk := &clock{t: time.Date(2026, 11, 9, 18, 0, 0, 0, time.UTC)}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := &app{
		version: "test-1",
		log:     logger,
		now:     clk.now,
		stats: newStatsCache(func() sample {
			v := 12.5
			return sample{CPU: &v, At: clk.now()}
		}, clk.now),
		bichu: newBichu(dir, logger, clk.now),
	}
	e := &testEnv{t: t, dir: dir, clk: clk, app: a, h: a.routes()}
	if withPassword {
		e.setPassword(testPassword)
	}
	return e
}

func (e *testEnv) setPassword(pw string) {
	e.t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
	if err != nil {
		e.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.dir, bichuHashFile), append(h, '\n'), 0o600); err != nil {
		e.t.Fatal(err)
	}
}

func (e *testEnv) do(method, target, ip string, body string) *httptest.ResponseRecorder {
	e.t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, r)
	req.RemoteAddr = "127.0.0.1:40000"
	if ip != "" {
		req.Header.Set("X-Real-IP", ip)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func (e *testEnv) post(ip, password, content string) *httptest.ResponseRecorder {
	e.t.Helper()
	b, _ := json.Marshal(map[string]string{"password": password, "content": content})
	return e.do(http.MethodPost, "/bichu.php?api=1", ip, string(b))
}

func (e *testEnv) stored() (string, bool) {
	b, err := os.ReadFile(filepath.Join(e.dir, bichuContentFile))
	return string(b), err == nil
}

func errorOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var v apiError
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("odpowiedź nie jest JSON: %q", rec.Body.String())
	}
	if v.Success {
		t.Fatalf("success=true przy błędzie: %q", rec.Body.String())
	}
	return v.Error
}

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, oczekiwano %d: %s", rec.Code, status, rec.Body.String())
	}
}

func TestBichuFailClosed(t *testing.T) {
	e := newTestEnv(t, false)
	rec := e.post("", "", "hack")
	expect(t, rec, http.StatusServiceUnavailable)
	if msg := errorOf(t, rec); !strings.Contains(msg, "brak konfiguracji hasła") {
		t.Fatalf("komunikat: %q", msg)
	}
	if _, ok := e.stored(); ok {
		t.Fatal("bez hasła nic nie może zostać zapisane")
	}
	// pusty albo uszkodzony plik hasła = też brak hasła
	for _, bad := range []string{"", "\n", "tajne123", "$2y$10$zakrotki"} {
		if err := os.WriteFile(filepath.Join(e.dir, bichuHashFile), []byte(bad), 0o600); err != nil {
			t.Fatal(err)
		}
		expect(t, e.post("", bad, "hack"), http.StatusServiceUnavailable)
	}
	if e.app.bichu.passwordConfigured() {
		t.Fatal("passwordConfigured przy złym pliku")
	}
	// brak pola password: 400 przed czymkolwiek innym
	expect(t, e.do(http.MethodPost, "/bichu.php?api=1", "", `{"content":"hack"}`), http.StatusBadRequest)
}

func TestBichuSaveAndRead(t *testing.T) {
	e := newTestEnv(t, true)

	rec := e.post("", "zle", "hack")
	expect(t, rec, http.StatusForbidden)
	if msg := errorOf(t, rec); msg != "Błędne hasło." {
		t.Fatalf("komunikat: %q", msg)
	}
	if _, ok := e.stored(); ok {
		t.Fatal("złe hasło utworzyło plik treści")
	}

	text := "Treść z polskimi znakami: zażółć gęślą jaźń\nDruga linia"
	rec = e.post("", testPassword, text)
	expect(t, rec, http.StatusOK)
	if strings.TrimSpace(rec.Body.String()) != `{"success":true}` {
		t.Fatalf("odpowiedź: %s", rec.Body.String())
	}
	if got, _ := e.stored(); got != text {
		t.Fatalf("zapisano %q", got)
	}
	if st, err := os.Stat(filepath.Join(e.dir, bichuContentFile)); err != nil || st.Size() != int64(len(text)) {
		t.Fatalf("plik treści: %v %v", st, err)
	}
	if left, _ := filepath.Glob(filepath.Join(e.dir, ".bichu.txt.*")); len(left) != 0 {
		t.Fatalf("zostały pliki tymczasowe: %v", left)
	}

	for _, target := range []string{"/bichu.php?api=1", "/bichu?api", "/bichu/?api=1"} {
		rec = e.do(http.MethodGet, target, "", "")
		expect(t, rec, http.StatusOK)
		var v map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil || v["content"] != text {
			t.Fatalf("%s: %s", target, rec.Body.String())
		}
		h := rec.Header()
		if h.Get("Cache-Control") != "no-store" || h.Get("X-Robots-Tag") != "noindex, nofollow" ||
			h.Get("Content-Type") != "application/json; charset=utf-8" || h.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: nagłówki %v", target, h)
		}
	}

	rec = e.do(http.MethodPut, "/bichu.php?api=1", "", "{}")
	expect(t, rec, http.StatusMethodNotAllowed)
	if rec.Header().Get("Allow") != "GET, HEAD, POST" {
		t.Fatalf("Allow: %q", rec.Header().Get("Allow"))
	}

	// zmiana hasła działa bez restartu
	e.setPassword("nowe-haslo")
	expect(t, e.post("", testPassword, "x"), http.StatusForbidden)
	expect(t, e.post("", "nowe-haslo", "po zmianie hasła"), http.StatusOK)
}

func TestBichuRejectsBadInput(t *testing.T) {
	e := newTestEnv(t, true)
	expect(t, e.post("", testPassword, "stara treść"), http.StatusOK)

	cases := []struct {
		name, body string
		status     int
		msg        string
	}{
		{"nie JSON", "to nie json", 400, "Oczekiwano obiektu JSON."},
		{"null", "null", 400, "Oczekiwano obiektu JSON."},
		{"tablica", `["a"]`, 400, "Oczekiwano obiektu JSON."},
		{"tekst", `"a"`, 400, "Oczekiwano obiektu JSON."},
		{"hasło liczbą", `{"password":123,"content":"x"}`, 400, `Pola "password" i "content" muszą być tekstem.`},
		{"treść null", `{"password":"` + testPassword + `","content":null}`, 400, `Pola "password" i "content" muszą być tekstem.`},
		{"zły UTF-8", "{\"password\":\"" + testPassword + "\",\"content\":\"\xff\xfe\"}", 400, "Treść musi być poprawnym UTF-8."},
		{"treść > 64 kB", `{"password":"` + testPassword + `","content":"` + strings.Repeat("x", 70000) + `"}`, 413, "Treść przekracza 64 kB."},
		{"żądanie > 256 kB", `{"password":"x","content":"` + strings.Repeat("x", 300000) + `"}`, 413, "Żądanie za duże."},
	}
	for _, c := range cases {
		rec := e.do(http.MethodPost, "/bichu.php?api=1", "", c.body)
		if rec.Code != c.status {
			t.Errorf("%s: status %d, oczekiwano %d (%s)", c.name, rec.Code, c.status, rec.Body.String())
			continue
		}
		if msg := errorOf(t, rec); msg != c.msg {
			t.Errorf("%s: komunikat %q", c.name, msg)
		}
	}
	if got, _ := e.stored(); got != "stara treść" {
		t.Fatalf("treść zmieniona przez odrzucone żądanie: %q", got)
	}
	// dokładnie 64 kB przechodzi
	expect(t, e.post("", testPassword, strings.Repeat("ż", bichuMaxBytes/2)), http.StatusOK)
}

func TestBichuClientLockout(t *testing.T) {
	e := newTestEnv(t, true)
	const ip = "203.0.113.7"
	for i := 1; i <= bichuMaxFails; i++ {
		expect(t, e.post(ip, "zle", "x"), http.StatusForbidden)
	}
	rec := e.post(ip, "zle", "x")
	expect(t, rec, http.StatusTooManyRequests)
	if ra := rec.Header().Get("Retry-After"); ra != "300" {
		t.Fatalf("Retry-After %q", ra)
	}
	if msg := errorOf(t, rec); !strings.HasPrefix(msg, "Zbyt wiele nieudanych prób") {
		t.Fatalf("komunikat %q", msg)
	}
	// blokada obowiązuje także dla poprawnego hasła, ale nie dla innego adresu
	expect(t, e.post(ip, testPassword, "x"), http.StatusTooManyRequests)
	expect(t, e.post("203.0.113.8", testPassword, "inny adres"), http.StatusOK)

	e.clk.add(2 * time.Minute)
	if ra := e.post(ip, "zle", "x").Header().Get("Retry-After"); ra != "180" {
		t.Fatalf("Retry-After po 2 min: %q", ra)
	}

	// po blokadzie, ale w tym samym oknie 15 min: jedna zła próba od razu blokuje znowu
	e.clk.add(3*time.Minute + time.Second)
	expect(t, e.post(ip, "zle", "x"), http.StatusForbidden)
	expect(t, e.post(ip, testPassword, "x"), http.StatusTooManyRequests)

	// po oknie i blokadzie: czysto, poprawne hasło przechodzi
	e.clk.add(bichuWindow)
	expect(t, e.post(ip, testPassword, "po blokadzie"), http.StatusOK)
}

func TestBichuSuccessClearsCounter(t *testing.T) {
	e := newTestEnv(t, true)
	const ip = "198.51.100.1"
	for i := 0; i < bichuMaxFails-1; i++ {
		expect(t, e.post(ip, "zle", "x"), http.StatusForbidden)
	}
	expect(t, e.post(ip, testPassword, "ok"), http.StatusOK)
	for i := 0; i < bichuMaxFails-1; i++ {
		expect(t, e.post(ip, "zle", "x"), http.StatusForbidden)
	}
	expect(t, e.post(ip, testPassword, "nadal ok"), http.StatusOK)
}

func TestBichuGlobalLock(t *testing.T) {
	e := newTestEnv(t, true)
	for i := 0; i < bichuGlobalFails; i++ {
		ip := "192.0.2." + itoa(i+1)
		expect(t, e.post(ip, "zle", "x"), http.StatusForbidden)
	}
	rec := e.post("192.0.2.200", testPassword, "x")
	expect(t, rec, http.StatusTooManyRequests)
	if msg := errorOf(t, rec); msg != "Zapis chwilowo zablokowany. Spróbuj później." {
		t.Fatalf("komunikat %q", msg)
	}
	if ra := rec.Header().Get("Retry-After"); ra != "900" {
		t.Fatalf("Retry-After %q", ra)
	}
	e.clk.add(bichuWindow)
	expect(t, e.post("192.0.2.200", testPassword, "po oknie"), http.StatusOK)
}

func TestBichuPruneKeepsNewest(t *testing.T) {
	e := newTestEnv(t, true)
	b := e.app.bichu
	for i := 0; i < bichuMaxClients+100; i++ {
		b.recordFailure("10.0." + itoa(i/250) + "." + itoa(i%250))
		e.clk.add(time.Millisecond)
	}
	b.mu.Lock()
	n := len(b.clients)
	_, newest := b.clients["10.0.2.99"] // ostatni z 600
	_, oldest := b.clients["10.0.0.0"]
	b.mu.Unlock()
	if n > bichuMaxClients || !newest || oldest {
		t.Fatalf("wpisów %d, najnowszy %v, najstarszy %v", n, newest, oldest)
	}
}

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("X-Real-IP", "203.0.113.5")
	if got := clientIP(r); got != "203.0.113.5" {
		t.Fatalf("z loopbacku: %q", got)
	}
	r.Header.Set("X-Real-IP", "nie-adres")
	if got := clientIP(r); got != "127.0.0.1" {
		t.Fatalf("zły nagłówek: %q", got)
	}
	r.RemoteAddr = "198.51.100.9:5555"
	r.Header.Set("X-Real-IP", "203.0.113.5")
	if got := clientIP(r); got != "198.51.100.9" {
		t.Fatalf("spoza loopbacku nagłówek ma być zignorowany: %q", got)
	}
	r.RemoteAddr = "[::1]:80"
	if got := clientIP(r); got != "203.0.113.5" {
		t.Fatalf("::1: %q", got)
	}
}

var initialRe = regexp.MustCompile(`<script id="bichu-initial" type="application/json">(.*?)</script>`)

func TestBichuPage(t *testing.T) {
	if strings.Count(bichuPage, "{{INITIAL_JSON}}") != 1 || strings.Count(bichuPage, "{{INITIAL_TEXT}}") != 1 {
		t.Fatal("szablon bichu.html: każdy znacznik dokładnie raz")
	}
	e := newTestEnv(t, true)

	rec := e.do(http.MethodGet, "/bichu", "", "")
	expect(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), `type="application/json">""</script>`) {
		t.Fatal("pusta treść: oczekiwano \"\" w skrypcie")
	}

	evil := "</script><script>alert(1)</script> <b>&amp;</b> \"cudzysłów\" 'apostrof' \u2028 ok"
	expect(t, e.post("", testPassword, evil), http.StatusOK)
	for _, target := range []string{"/bichu", "/bichu/", "/bichu.php"} {
		rec = e.do(http.MethodGet, target, "", "")
		expect(t, rec, http.StatusOK)
		body := rec.Body.String()
		h := rec.Header()
		if h.Get("Content-Type") != "text/html; charset=utf-8" || h.Get("X-Robots-Tag") != "noindex, nofollow" || h.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: nagłówki %v", target, h)
		}
		if strings.Contains(body, "<script>alert(1)") || strings.Contains(body, "{{INITIAL_") {
			t.Fatalf("%s: treść nie jest zabezpieczona", target)
		}
		m := initialRe.FindStringSubmatch(body)
		if m == nil {
			t.Fatalf("%s: brak skryptu z treścią", target)
		}
		var got string
		if err := json.Unmarshal([]byte(m[1]), &got); err != nil || got != evil {
			t.Fatalf("%s: JSON w skrypcie %q → %q (%v)", target, m[1], got, err)
		}
		if !strings.Contains(body, "&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;&amp;amp;&lt;/b&gt; &#34;cudzysłów&#34; &#39;apostrof&#39;") {
			t.Fatalf("%s: tekst dla widoku bez JS nie jest zakodowany", target)
		}
		if strings.Count(body, "<h1>") != 1 {
			t.Fatalf("%s: liczba <h1>", target)
		}
	}

	expect(t, e.do(http.MethodHead, "/bichu", "", ""), http.StatusOK)
	rec = e.do(http.MethodPost, "/bichu", "", "{}")
	expect(t, rec, http.StatusMethodNotAllowed)
	if rec.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("Allow: %q", rec.Header().Get("Allow"))
	}
}

func TestRoutes(t *testing.T) {
	e := newTestEnv(t, true)
	for _, p := range []string{"/", "/index.html", "/bichu/x", "/bichu_config.php", "/bichu_content.txt", "/bichuabc", "/stats", "/bichu.php/x"} {
		if rec := e.do(http.MethodGet, p, "", ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d, oczekiwano 404", p, rec.Code)
		}
	}
	rec := e.do(http.MethodGet, "/healthz", "", "")
	expect(t, rec, http.StatusOK)
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"version":"test-1"`)) {
		t.Fatalf("healthz: %s", rec.Body.String())
	}
}

func TestBichuConcurrentSaves(t *testing.T) {
	e := newTestEnv(t, true)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rec := e.post("", testPassword, strings.Repeat(itoa(i), 1000))
			if rec.Code != http.StatusOK {
				t.Errorf("zapis %d: %d %s", i, rec.Code, rec.Body.String())
			}
		}(i)
	}
	wg.Wait()
	got, _ := e.stored()
	if len(got) != 1000 || strings.Trim(got, got[:1]) != "" {
		t.Fatalf("treść po równoległych zapisach nie jest jednym z zapisów: %d B", len(got))
	}
}

func itoa(i int) string { return strconv.Itoa(i) }
