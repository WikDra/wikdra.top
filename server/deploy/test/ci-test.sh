#!/bin/sh
# Test usługi wikdra na prawdziwym Alpine z OpenRC i nginx (CI, job „serwer Go”; lokalnie przez Docker):
# instalacja, wdrożenia z powrotem po zepsutym wydaniu, import z PHP, nginx/default.conf z repo
# (proxy do Go, nagłówki, blokady), zapis Bichu przez nginx, limit prób z prawdziwym adresem klienta.
#
#   docker run --rm -v "$PWD:/src:ro" -v "$WORK:/work" alpine:3.23 sh /src/server/deploy/test/ci-test.sh
# /work: wikdra-ci-1 … wikdra-ci-4 (binarki z wersjami ci-1 … ci-4).
set -eu
PW='tajne-haslo-ci'
fails=0
ok() { echo "  ✓ $*"; }
bad() {
	echo "  ✗ $*"
	fails=$((fails + 1))
}
check() { # check <opis> <polecenie…>
	d=$1
	shift
	if "$@" >/tmp/check.out 2>&1; then ok "$d"; else
		bad "$d"
		sed 's/^/      /' /tmp/check.out | tail -n 15
	fi
}
pack() { gzip -9 -n -c "$1" >"$1.gz" && sha256sum "$1.gz" | cut -d' ' -f1; }
# pomocnicze polecenia (używane także w sh -c): curl przez nginx z Host strony głównej (z odstępem
# 0,25 s — nginx przepuszcza 5 żądań/s z adresu, a test nie sprawdza tu limit_req), wdrożenie paczki
printf '#!/bin/sh\nsleep 0.25\nexec curl -s -H "Host: wikdra.top" "$@"\n' >/usr/local/bin/web
printf '#!/bin/sh\nexec /usr/local/sbin/wikdra-deploy "$1" <"$2"\n' >/usr/local/bin/deploy
chmod +x /usr/local/bin/web /usr/local/bin/deploy

echo "[1] System jak na serwerze (openrc, nginx, php83 do importu)"
apk add -q --no-progress openrc nginx curl php83 >/dev/null
printf 'rc_sys="docker"\nrc_provide="loopback net"\nrc_controller_cgroups="NO"\n' >>/etc/rc.conf
mkdir -p /run/openrc /run/lock
touch /run/openrc/softlevel
# strona statyczna i pliki dawnej wersji PHP (jak na serwerze przed przełączeniem)
H=/var/lib/nginx/html
mkdir -p "$H/assets/css"
printf '<!doctype html><title>Wikdra - test</title><h1>wikdra</h1>' >"$H/index.html"
printf '<!doctype html><title>404</title><h1>404</h1>' >"$H/404.html"
printf 'body{}' >"$H/assets/css/app-v6.css"
printf "<?php\n\$admin_password = '%s';\n" "$PW" >"$H/bichu_config.php"
printf 'Treść z PHP: zażółć' >"$H/bichu_content.txt"
printf '<?php echo "kod PHP";' >"$H/bichu.php"
cp "$H/bichu.php" "$H/stats.php"
chown -R nobody:nobody "$H/bichu_content.txt"

echo "[2] Instalacja"
check "plan bez zmian w systemie" sh -c 'sh /src/server/deploy/install.sh --plan > /tmp/plan; cat /tmp/plan; grep -q "Plan zmian" /tmp/plan && grep -q "/etc/init.d/wikdra" /tmp/plan && ! id wikdra'
check "instalacja" sh -c 'sh /src/server/deploy/install.sh | tee /tmp/inst; grep -q "Zainstalowano" /tmp/inst'
check "drugie uruchomienie: bez zmian" sh -c 'sh /src/server/deploy/install.sh | grep -q "Bez zmian"'
check "użytkownik wikdra bez hasła i powłoki" sh -c '[ "$(awk -F: "\$1==\"wikdra\"{print \$2}" /etc/shadow)" = "!" ] && [ "$(awk -F: "\$1==\"wikdra\"{print \$7}" /etc/passwd)" = /sbin/nologin ]'
check "dane 0750 wikdra" sh -c '[ "$(stat -c "%a %U" /var/lib/wikdra)" = "750 wikdra" ]'
check "usługa w runlevelu default" sh -c 'rc-update show default | grep -qE "^ *wikdra +[|]"'
check "wikdra-deploy bez sumy: błąd" sh -c '! /usr/local/sbin/wikdra-deploy < /dev/null'

echo "[3] Pierwsze wdrożenie"
cp /work/wikdra-ci-1 /tmp/w1
S1=$(pack /tmp/w1)
check "deploy ci-1" sh -c "/usr/local/sbin/wikdra-deploy $S1 < /tmp/w1.gz | tee /tmp/out; tail -n 1 /tmp/out | grep -q 'OK: ci-1'"
check "healthz: ci-1" sh -c 'wget -q -O - http://127.0.0.1:8092/healthz | grep -q "\"version\":\"ci-1\""'
check "proces jako wikdra pod supervise-daemon" sh -c 'ps -o user,args | grep -E "^wikdra +/srv/wikdra/current/wikdra serve" >/dev/null && rc-service wikdra status | grep -q started'
check "bez hasła zapis wyłączony (503)" sh -c '[ "$(curl -s -o /dev/null -w %{http_code} -d "{\"password\":\"x\",\"content\":\"x\"}" "http://127.0.0.1:8092/bichu?api=1")" = 503 ]'
check "status" sh -c '/usr/local/sbin/wikdra-deploy status | grep -q "wydanie: ci-1"'

echo "[4] Import z PHP"
check "import treści i hasła" sh -c '/usr/local/lib/wikdra/import-php.sh | tee /tmp/imp; grep -q "treść: skopiowano" /tmp/imp && grep -q "jawne hasło" /tmp/imp && grep -q "OK: wikdra 600" /tmp/imp'
check "hasło nie wypisane" sh -c "! grep -q '$PW' /tmp/imp"
check "drugi import: pomija" sh -c '/usr/local/lib/wikdra/import-php.sh | grep -c pomijam | grep -qx 2'
check "treść z PHP w usłudze" sh -c 'wget -q -O - "http://127.0.0.1:8092/bichu?api=1" | grep -q "Treść z PHP"'
h=$(php83 -r 'echo password_hash("z-hasha-php", PASSWORD_DEFAULT);')
printf "<?php\n\$admin_password_hash = '%s';\n" "$h" >"$H/bichu_config.php"
check "hash: przez --force z hashem PHP" sh -c '/usr/local/lib/wikdra/import-php.sh --force | grep -q "przeniesiono hash"'
check "hasło z hashem PHP działa" sh -c '[ "$(curl -s -o /dev/null -w %{http_code} -d "{\"password\":\"z-hasha-php\",\"content\":\"z hasha\"}" "http://127.0.0.1:8092/bichu?api=1")" = 200 ]'
printf "<?php\n\$admin_password = '%s';\n" "$PW" >"$H/bichu_config.php"
check "z powrotem jawne hasło (--force)" sh -c '/usr/local/lib/wikdra/import-php.sh --force | grep -q "jawne hasło"'

echo "[5] nginx/default.conf z repo"
cp /src/nginx/default.conf /etc/nginx/http.d/default.conf
check "nginx -t" nginx -t
rc-service nginx start >/dev/null 2>&1 || true
check "strona statyczna" sh -c 'web http://127.0.0.1/ | grep -q "Wikdra - test"'
check "/stats.php z Go (JSON, no-store raz)" sh -c 'web -D /tmp/h -o /tmp/b http://127.0.0.1/stats.php; grep -q "\"cpu\":" /tmp/b && grep -q "\"age\":" /tmp/b && [ "$(grep -ci "^cache-control:" /tmp/h)" = 1 ] && grep -qi "^cache-control: no-store" /tmp/h'
check "/stats.php: nagłówki bezpieczeństwa z nginx" sh -c 'web -D - -o /dev/null http://127.0.0.1/stats.php | grep -qi "^x-frame-options: SAMEORIGIN"'
for p in /bichu /bichu/ /bichu.php; do
	check "$p: strona z treścią, jeden Cache-Control" sh -c "web -D /tmp/h -o /tmp/b http://127.0.0.1$p; grep -q 'Treść z PHP' /tmp/b && grep -q 'id=\"bichu-initial\"' /tmp/b && [ \"\$(grep -ci '^cache-control:' /tmp/h)\" = 1 ] && grep -qi '^x-robots-tag: noindex' /tmp/h && grep -qi '^referrer-policy:' /tmp/h"
done
for p in /bichu_config.php /bichu_content.txt /bichu_attempts.json /stats.php.bak /cokolwiek.php /bichu/x /.git/config; do
	check "$p: 404, bez kodu PHP i hasła" sh -c "[ \"\$(web -o /tmp/b -w %{http_code} http://127.0.0.1$p)\" = 404 ] && ! grep -q -e '<?php' -e '$PW' /tmp/b"
done
check "zły POST przez nginx: 403" sh -c "[ \"\$(web -o /dev/null -w %{http_code} -d '{\"password\":\"zle\",\"content\":\"x\"}' 'http://127.0.0.1/bichu?api=1')\" = 403 ]"
check "zapis przez nginx: 200 i treść na stronie" sh -c "[ \"\$(web -o /dev/null -w %{http_code} -H 'Content-Type: application/json' -d '{\"password\":\"$PW\",\"content\":\"Zapis przez nginx <b>\"}' 'http://127.0.0.1/bichu.php?api=1')\" = 200 ] && web http://127.0.0.1/bichu | grep -q 'Zapis przez nginx &lt;b&gt;'"
check "plik treści należy do wikdra" sh -c '[ "$(stat -c "%U %a" /var/lib/wikdra/bichu.txt)" = "wikdra 640" ]'
head -c 400000 /dev/zero | tr '\0' x >/tmp/big
check "żądanie > 300 kB: 413 z nginx" sh -c '[ "$(web -o /dev/null -w %{http_code} --data-binary @/tmp/big "http://127.0.0.1/bichu?api=1")" = 413 ]'
# CF-Connecting-IP z adresu spoza Cloudflare jest ignorowany: wszystkie próby liczą się dla 127.0.0.1
check "podrobiony CF-Connecting-IP nie omija limitu prób" sh -c "for i in 1 2 3 4 5; do web -o /dev/null -H \"CF-Connecting-IP: 198.51.100.\$i\" -d '{\"password\":\"zle\",\"content\":\"x\"}' 'http://127.0.0.1/bichu?api=1'; sleep 0.3; done; [ \"\$(web -o /dev/null -w %{http_code} -H 'CF-Connecting-IP: 198.51.100.99' -d '{\"password\":\"$PW\",\"content\":\"x\"}' 'http://127.0.0.1/bichu?api=1')\" = 429 ]"

echo "[6] Kolejne wdrożenia, powrót, odrzucane paczki"
cp /work/wikdra-ci-2 /tmp/w2
S2=$(pack /tmp/w2)
check "deploy ci-2 (limit prób w pamięci zeruje restart)" sh -c "deploy $S2 /tmp/w2.gz | tail -n 1 | grep -q 'OK: ci-2' && [ \"\$(web -o /dev/null -w %{http_code} -d '{\"password\":\"$PW\",\"content\":\"po ci-2\"}' 'http://127.0.0.1/bichu?api=1')\" = 200 ]"
check "dane przetrwały wdrożenie" sh -c 'web "http://127.0.0.1/bichu?api=1" | grep -q "po ci-2"'
check "ta sama paczka drugi raz: bez zmian" sh -c "deploy $S2 /tmp/w2.gz | tail -n 1 | grep -q '(bez zmian)'"
cat >/tmp/broken <<'EOF'
#!/bin/sh
case "$1" in
version) echo "wikdra ci-broken (test)" ;;
*) exit 1 ;;
esac
EOF
chmod +x /tmp/broken
SB=$(pack /tmp/broken)
check "zepsute wydanie: kod 1 i powrót do ci-2" sh -c "! deploy $SB /tmp/broken.gz > /tmp/out 2>&1; cat /tmp/out; grep -q 'przywrócono ci-2' /tmp/out"
check "po powrocie: current = ci-2, odpowiada ci-2" sh -c '[ "$(readlink /srv/wikdra/current)" = releases/ci-2 ] && wget -q -O - http://127.0.0.1:8092/healthz | grep -q "\"version\":\"ci-2\"" && [ ! -e /srv/wikdra/releases/ci-broken ]'
check "zła suma" sh -c "! deploy $(printf %064d 0) /tmp/w1.gz > /tmp/out 2>&1; grep -q 'suma SHA-256 się nie zgadza' /tmp/out"
printf 'to nie gzip' >/tmp/notgz.gz
SNG=$(sha256sum /tmp/notgz.gz | cut -d' ' -f1)
check "nie gzip" sh -c "! deploy $SNG /tmp/notgz.gz > /tmp/out 2>&1; grep -q 'uszkodzona paczka' /tmp/out"
head -c 33554500 /dev/urandom >/tmp/big.gz
SBIG=$(sha256sum /tmp/big.gz | cut -d' ' -f1)
check "za duża paczka" sh -c "! deploy $SBIG /tmp/big.gz > /tmp/out 2>&1; grep -q 'paczka większa' /tmp/out"
cp /work/wikdra-ci-2 /tmp/w2b
printf 'x' >>/tmp/w2b
SX=$(pack /tmp/w2b)
check "inna binarka z wersją, która już jest bieżąca: odrzucona" sh -c "! deploy $SX /tmp/w2b.gz > /tmp/out 2>&1; grep -q 'inna binarka' /tmp/out"

echo "[7] Retencja wydań, respawn"
cp /work/wikdra-ci-3 /tmp/w3
S3=$(pack /tmp/w3)
cp /work/wikdra-ci-4 /tmp/w4
S4=$(pack /tmp/w4)
check "deploy ci-3, ci-4" sh -c "sleep 1; deploy $S3 /tmp/w3.gz | tail -n 1 | grep -q 'OK: ci-3' && sleep 1 && deploy $S4 /tmp/w4.gz | tail -n 1 | grep -q 'OK: ci-4'"
check "zostają 3 wydania (ci-4, ci-3, ci-2)" sh -c '[ "$(ls -1t /srv/wikdra/releases | tr "\n" " ")" = "ci-4 ci-3 ci-2 " ]'
check "restart po awarii procesu (respawn)" sh -c 'kill -9 $(pgrep -f "wikdra/current/wikdra serve" | head -1); sleep 4; wget -q -O - http://127.0.0.1:8092/healthz | grep -q "\"version\":\"ci-4\""'
check "dziennik wdrożeń (ci-1, ci-2, ci-2 bez zmian, ci-3, ci-4)" sh -c 'grep -c "OK: ci-" /var/log/wikdra/deploy.log | grep -qx 5'
check "binarka jako root odmawia" sh -c '! /srv/wikdra/current/wikdra serve --addr 127.0.0.1:1 2>/tmp/err; grep -q "nie działa jako root" /tmp/err'

echo
if [ "$fails" -gt 0 ]; then
	echo "WYNIK: BŁĘDY: $fails"
	echo "--- /var/log/wikdra/deploy.log"
	tail -n 30 /var/log/wikdra/deploy.log || true
	echo "--- /var/log/wikdra/wikdra.log"
	tail -n 30 /var/log/wikdra/wikdra.log || true
	echo "--- /var/log/nginx/error.log"
	tail -n 20 /var/log/nginx/error.log || true
	exit 1
fi
echo "WYNIK: OK"
