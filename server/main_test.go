package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func init() { bcryptCost = bcrypt.MinCost }

func runCmd(t *testing.T, stdin string, args ...string) (int, string, string) {
	t.Helper()
	var out, errb bytes.Buffer
	code := run(args, strings.NewReader(stdin), &out, &errb)
	return code, out.String(), errb.String()
}

func TestVersion(t *testing.T) {
	code, out, _ := runCmd(t, "", "version")
	// wikdra-deploy czyta wersję jako 2. pole pierwszej linii
	if code != 0 || !strings.HasPrefix(out, "wikdra dev (go") {
		t.Fatalf("%d %q", code, out)
	}
	if code, _, _ := runCmd(t, "", "nie-ma-takiego"); code != 2 {
		t.Fatalf("nieznane polecenie: kod %d", code)
	}
	if code, _, _ := runCmd(t, ""); code != 2 {
		t.Fatalf("bez polecenia: kod %d", code)
	}
}

func TestHashPassword(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, bichuHashFile)

	code, out, errs := runCmd(t, "moje haslo\r\n", "hash-password", "--data-dir", dir)
	if code != 0 || !strings.HasPrefix(out, "OK: ") {
		t.Fatalf("%d %q %q", code, out, errs)
	}
	if strings.Contains(out+errs, "moje haslo") {
		t.Fatal("hasło nie może trafić na wyjście")
	}
	h, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := bcrypt.CompareHashAndPassword(bytes.TrimSpace(h), []byte("moje haslo")); err != nil {
		t.Fatalf("hash nie pasuje do hasła bez końca linii: %v", err)
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(path); st.Mode().Perm() != 0o600 {
			t.Fatalf("uprawnienia %v", st.Mode().Perm())
		}
	}
	b := newBichu(dir, nil, nil)
	if !b.passwordConfigured() {
		t.Fatal("usługa nie widzi hasła")
	}

	// gotowy hash z PHP ($2y$) przez --bcrypt
	gen, _ := bcrypt.GenerateFromPassword([]byte("z php"), bcrypt.MinCost)
	php := "$2y$" + string(gen[4:])
	if _, err := bcrypt.Cost([]byte(php)); err != nil {
		t.Fatalf("przykładowy hash: %v", err)
	}
	if code, _, errs := runCmd(t, php+"\n", "hash-password", "--data-dir", dir, "--bcrypt"); code != 0 {
		t.Fatalf("--bcrypt: %q", errs)
	}
	if h, _ := os.ReadFile(path); strings.TrimSpace(string(h)) != php {
		t.Fatalf("zapisano %q", h)
	}

	for name, c := range map[string]struct {
		stdin string
		args  []string
	}{
		"puste":           {"\n", nil},
		"za długie":       {strings.Repeat("x", 73), nil},
		"zły hash":        {"to-nie-bcrypt", []string{"--bcrypt"}},
		"ogromne wejście": {strings.Repeat("x", 5000), nil},
	} {
		args := append([]string{"hash-password", "--data-dir", dir}, c.args...)
		if code, _, _ := runCmd(t, c.stdin, args...); code != 1 {
			t.Errorf("%s: kod %d, oczekiwano 1", name, code)
		}
	}
	if h, _ := os.ReadFile(path); strings.TrimSpace(string(h)) != php {
		t.Fatal("odrzucone wejście nadpisało hash")
	}
}

func TestWriteFileAtomic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "plik.txt")
	for _, s := range []string{"pierwsza", "druga, dłuższa wersja", ""} {
		if err := writeFileAtomic(p, []byte(s), 0o640); err != nil {
			t.Fatal(err)
		}
		if got, _ := os.ReadFile(p); string(got) != s {
			t.Fatalf("%q", got)
		}
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".plik.txt.*")); len(left) != 0 {
		t.Fatalf("pliki tymczasowe: %v", left)
	}
	if err := writeFileAtomic(filepath.Join(dir, "brak", "x"), []byte("x"), 0o640); err == nil {
		t.Fatal("zapis do nieistniejącego katalogu powinien się nie udać")
	}
}
