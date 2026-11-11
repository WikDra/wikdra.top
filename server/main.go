// Command wikdra — dynamiczne części wikdra.top za nginx: metryki serwera (/stats.php)
// i edytor treści Bichu (/bichu, /bichu.php, ?api=1). Reszta strony to pliki statyczne z site/.
//
//	wikdra serve [--addr 127.0.0.1:8092] [--data-dir /var/lib/wikdra]
//	wikdra hash-password [--data-dir …] [--bcrypt]   hasło (albo gotowy hash bcrypt) ze stdin → bichu.hash
//	wikdra version
//
// Wdrożenie i serwer: docs/deployment.md, katalog server/deploy/.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"syscall"
	"time"
	_ "time/tzdata" // Alpine na serwerze nie ma tzdata, a logi mają być w czasie polskim

	"golang.org/x/crypto/bcrypt"
)

// version ustawia build: -ldflags "-X main.version=<gałąź>-<sha7>".
var version = "dev"

const (
	defaultAddr     = "127.0.0.1:8092"
	defaultDataDir  = "/var/lib/wikdra"
	defaultMemLimit = 32 << 20 // gdy GOMEMLIMIT nie jest ustawione (serwer ma 256 MB RAM)
)

// bcryptCost dla nowych hashy (~0,3 s na serwerze; testy zmniejszają).
var bcryptCost = 12

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stderr)
		return 2
	}
	switch args[0] {
	case "version":
		fmt.Fprintf(stdout, "wikdra %s (%s)\n", version, runtime.Version())
		return 0
	case "serve":
		return cmdServe(args[1:], stderr)
	case "hash-password":
		return cmdHashPassword(args[1:], stdin, stdout, stderr)
	case "help", "-h", "--help":
		usage(stdout)
		return 0
	}
	fmt.Fprintf(stderr, "nieznane polecenie %q\n\n", args[0])
	usage(stderr)
	return 2
}

func usage(w io.Writer) {
	fmt.Fprint(w, `Użycie:
  wikdra serve [--addr 127.0.0.1:8092] [--data-dir /var/lib/wikdra]
  wikdra hash-password [--data-dir /var/lib/wikdra] [--bcrypt]
      hasło edycji Bichu ze stdin (bez echa w logach) → <data-dir>/bichu.hash;
      --bcrypt: na stdin jest już gotowy hash bcrypt ($2a$/$2b$/$2y$)
  wikdra version
Zmienne: WIKDRA_DATA_DIR, WIKDRA_ADDR, GOMEMLIMIT (domyślnie 32MiB).
`)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func cmdServe(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(stderr)
	addr := fs.String("addr", envOr("WIKDRA_ADDR", defaultAddr), "adres nasłuchu (tylko loopback — przed usługą stoi nginx)")
	dataDir := fs.String("data-dir", envOr("WIKDRA_DATA_DIR", defaultDataDir), "katalog danych (treść i hash hasła Bichu)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if os.Geteuid() == 0 {
		fmt.Fprintln(stderr, "wikdra serve nie działa jako root — uruchom jako użytkownik usługi (wikdra).")
		return 1
	}
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(defaultMemLimit)
	}
	logger := slog.New(slog.NewTextHandler(stderr, nil))
	if err := os.MkdirAll(*dataDir, 0o750); err != nil {
		logger.Error("katalog danych", "err", err)
		return 1
	}

	a := newApp(*dataDir, version, logger)
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		logger.Error("nasłuch", "addr", *addr, "err", err)
		return 1
	}
	srv := &http.Server{
		Handler:           a.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	logger.Info("start", "version", version, "addr", "http://"+ln.Addr().String(), "data", *dataDir,
		"password_set", a.bichu.passwordConfigured())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("serwer", "err", err)
		return 1
	}
	<-done
	logger.Info("stop")
	return 0
}

// cmdHashPassword zapisuje hash bcrypt hasła edycji Bichu do <data-dir>/bichu.hash (0600).
// Hasło przychodzi na stdin (potokiem, np. z importu PHP) — nigdy w argumentach ani w logu.
func cmdHashPassword(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("hash-password", flag.ContinueOnError)
	fs.SetOutput(stderr)
	dataDir := fs.String("data-dir", envOr("WIKDRA_DATA_DIR", defaultDataDir), "katalog danych")
	already := fs.Bool("bcrypt", false, "na stdin jest gotowy hash bcrypt, nie hasło")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	raw, err := io.ReadAll(io.LimitReader(stdin, 4097))
	if err != nil {
		fmt.Fprintln(stderr, "BŁĄD: odczyt stdin:", err)
		return 1
	}
	if len(raw) > 4096 {
		fmt.Fprintln(stderr, "BŁĄD: za długie wejście")
		return 1
	}
	in := trimNewline(raw)
	if len(in) == 0 {
		fmt.Fprintln(stderr, "BŁĄD: puste hasło na stdin")
		return 1
	}
	var hash []byte
	if *already {
		if _, err := bcrypt.Cost(in); err != nil {
			fmt.Fprintln(stderr, "BŁĄD: to nie jest hash bcrypt:", err)
			return 1
		}
		hash = in
	} else {
		if len(in) > 72 {
			fmt.Fprintln(stderr, "BŁĄD: hasło dłuższe niż 72 bajty (limit bcrypt)")
			return 1
		}
		if hash, err = bcrypt.GenerateFromPassword(in, bcryptCost); err != nil {
			fmt.Fprintln(stderr, "BŁĄD: bcrypt:", err)
			return 1
		}
	}
	if err := os.MkdirAll(*dataDir, 0o750); err != nil {
		fmt.Fprintln(stderr, "BŁĄD:", err)
		return 1
	}
	path := filepath.Join(*dataDir, bichuHashFile)
	if err := writeFileAtomic(path, append(hash, '\n'), 0o600); err != nil {
		fmt.Fprintln(stderr, "BŁĄD: zapis:", err)
		return 1
	}
	fmt.Fprintln(stdout, "OK: hash hasła zapisany w", path)
	return 0
}

// trimNewline zdejmuje jeden końcowy znak nowej linii (\n albo \r\n) — z echo/printf albo klawiatury.
func trimNewline(b []byte) []byte {
	if n := len(b); n > 0 && b[n-1] == '\n' {
		b = b[:n-1]
		if n := len(b); n > 0 && b[n-1] == '\r' {
			b = b[:n-1]
		}
	}
	return b
}

// writeFileAtomic: plik tymczasowy w tym samym katalogu, fsync, rename — nigdy pół pliku.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			_ = f.Close()
			_ = os.Remove(tmp)
		}
	}()
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Chmod(perm); err != nil && runtime.GOOS != "windows" {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	ok = true
	return nil
}
