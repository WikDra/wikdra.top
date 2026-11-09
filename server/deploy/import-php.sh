#!/bin/sh
# import-php.sh — jednorazowe przeniesienie danych Bichu z wersji PHP do usługi wikdra.
# Uruchamiać jako root po pierwszym wdrożeniu binarki (scripts/deploy-api.ps1 -ImportPhp).
#
#   treść: <WWW>/bichu_content.txt → /var/lib/wikdra/bichu.txt
#   hasło: <WWW>/bichu_config.php ($admin_password_hash albo $admin_password) → /var/lib/wikdra/bichu.hash
#
# Hasło idzie potokiem php83 → `wikdra hash-password` (bcrypt) i nigdzie nie jest wypisywane ani
# zapisywane jawnie. Istniejących danych usługi nie nadpisuje, chyba że z --force.
set -eu
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
WWW=${WIKDRA_PHP_WWW:-/var/lib/nginx/html}
DATA=/var/lib/wikdra
USR=wikdra
BIN=/srv/wikdra/current/wikdra
PHP=${WIKDRA_PHP:-php83}
FORCE=0
[ "${1:-}" = --force ] && FORCE=1

[ "$(id -u)" = 0 ] || {
	echo "BŁĄD: uruchom jako root" >&2
	exit 1
}
[ -x "$BIN" ] || {
	echo "BŁĄD: brak $BIN — najpierw wdróż binarkę (wikdra-deploy)" >&2
	exit 1
}

# ——— treść ———
if [ -f "$DATA/bichu.txt" ] && [ "$FORCE" = 0 ]; then
	echo "treść: $DATA/bichu.txt już jest ($(wc -c <"$DATA/bichu.txt") B) — pomijam (--force nadpisuje)"
elif [ -f "$WWW/bichu_content.txt" ]; then
	tmp=$(mktemp "$DATA/.bichu.txt.XXXXXX")
	cat "$WWW/bichu_content.txt" >"$tmp"
	chown "$USR:$USR" "$tmp"
	chmod 0640 "$tmp"
	mv -f "$tmp" "$DATA/bichu.txt"
	echo "treść: skopiowano $(wc -c <"$DATA/bichu.txt") B z $WWW/bichu_content.txt"
else
	echo "treść: brak $WWW/bichu_content.txt — strona będzie pusta"
fi

# ——— hasło ———
CFG=$WWW/bichu_config.php
if [ -f "$DATA/bichu.hash" ] && [ "$FORCE" = 0 ]; then
	echo "hasło: $DATA/bichu.hash już jest — pomijam (--force nadpisuje)"
	exit 0
fi
if [ ! -f "$CFG" ]; then
	echo "hasło: brak $CFG — ustaw ręcznie: su -s /bin/sh $USR -c '$BIN hash-password --data-dir=$DATA' (hasło na stdin)"
	exit 0
fi
command -v "$PHP" >/dev/null 2>&1 || {
	echo "BŁĄD: brak $PHP do odczytu $CFG" >&2
	exit 1
}
# rodzaj wpisu: hash (preferowany w PHP) albo hasło jawne; sama wartość tylko w potoku poniżej
kind=$(CFG="$CFG" "$PHP" -n -r '
$admin_password = null; $admin_password_hash = null;
require getenv("CFG");
if (is_string($admin_password_hash) && strlen($admin_password_hash) >= 20) { echo "hash"; }
elseif (is_string($admin_password) && $admin_password !== "") { echo "plain"; }
else { echo "none"; }')
case "$kind" in
hash)
	CFG="$CFG" "$PHP" -n -r 'require getenv("CFG"); echo $admin_password_hash;' |
		su -s /bin/sh "$USR" -c "exec '$BIN' hash-password --bcrypt --data-dir='$DATA'" >/dev/null
	echo "hasło: przeniesiono hash bcrypt z $CFG"
	;;
plain)
	CFG="$CFG" "$PHP" -n -r 'require getenv("CFG"); echo $admin_password;' |
		su -s /bin/sh "$USR" -c "exec '$BIN' hash-password --data-dir='$DATA'" >/dev/null
	echo "hasło: jawne hasło z $CFG zamienione na hash bcrypt (to samo hasło)"
	;;
*)
	echo "hasło: $CFG nie ustawia hasła — edycja zostaje wyłączona (503) do: wikdra hash-password"
	exit 0
	;;
esac
[ -s "$DATA/bichu.hash" ] || {
	echo "BŁĄD: $DATA/bichu.hash nie powstał" >&2
	exit 1
}
echo "OK: $(stat -c '%U %a' "$DATA/bichu.hash") $DATA/bichu.hash"
