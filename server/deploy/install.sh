#!/bin/sh
# install.sh — instalacja usługi wikdra na serwerze (Alpine, OpenRC). Idempotentna: drugie
# uruchomienie bez zmian w repo niczego nie zmienia. Uruchamiać jako root z katalogu paczki
# (scripts/deploy-api.ps1 -Install wysyła server/deploy/ i woła ten skrypt).
#
#   sh install.sh --plan   lista zmian, nic nie zmienia
#   sh install.sh          instalacja
#
# Zakłada: użytkownik systemowy wikdra (bez hasła i powłoki), /srv/wikdra/releases (root),
# /var/lib/wikdra (wikdra, 0750), /var/log/wikdra, /etc/init.d/wikdra, /etc/conf.d/wikdra,
# /usr/local/sbin/wikdra-deploy, /usr/local/lib/wikdra/import-php.sh, usługa w runlevelu default.
# Nie rusza nginx ani PHP — przełączenie nginx to osobny krok (deploy-api.ps1 -Nginx).
set -eu
umask 022
PATH=/usr/sbin:/usr/bin:/sbin:/bin
HERE=$(cd "$(dirname "$0")" && pwd)
PLAN=0
case "${1:-}" in
--plan) PLAN=1 ;;
"") ;;
*)
	echo "Użycie: sh install.sh [--plan]" >&2
	exit 2
	;;
esac
[ "$(id -u)" = 0 ] || {
	echo "BŁĄD: uruchom jako root" >&2
	exit 1
}

CHANGES=""
change() { CHANGES="$CHANGES
  + $*"; }
apply() { [ "$PLAN" = 1 ] || "$@"; }

if ! id wikdra >/dev/null 2>&1; then
	change "użytkownik systemowy wikdra (bez hasła, powłoka /sbin/nologin)"
	apply addgroup -S wikdra
	apply adduser -S -D -H -h /var/lib/wikdra -s /sbin/nologin -G wikdra wikdra
fi

ensure_dir() { # ensure_dir <ścieżka> <tryb> <właściciel:grupa>
	if [ ! -d "$1" ]; then
		change "katalog $1 ($2, $3)"
		apply install -d -m "$2" -o "${3%:*}" -g "${3#*:}" "$1"
	elif [ "$(stat -c '%a %U:%G' "$1")" != "${2#0} $3" ]; then
		change "uprawnienia $1 → $2 $3"
		apply chmod "$2" "$1"
		apply chown "$3" "$1"
	fi
}
ensure_dir /srv/wikdra 0755 root:root
ensure_dir /srv/wikdra/releases 0755 root:root
ensure_dir /var/lib/wikdra 0750 wikdra:wikdra
ensure_dir /var/log/wikdra 0755 root:root
ensure_dir /usr/local/sbin 0755 root:root
ensure_dir /usr/local/lib/wikdra 0755 root:root

ensure_file() { # ensure_file <źródło> <cel> <tryb>
	if [ ! -f "$2" ] || ! cmp -s "$1" "$2"; then
		if [ -f "$2" ]; then change "aktualizacja $2"; else change "plik $2"; fi
		apply install -m "$3" -o root -g root "$1" "$2"
	elif [ "$(stat -c '%a %U' "$2")" != "${3#0} root" ]; then
		change "uprawnienia $2 → $3 root"
		apply chmod "$3" "$2"
		apply chown root:root "$2"
	fi
}
ensure_file "$HERE/wikdra.initd" /etc/init.d/wikdra 0755
ensure_file "$HERE/wikdra.confd" /etc/conf.d/wikdra 0644
ensure_file "$HERE/wikdra-deploy" /usr/local/sbin/wikdra-deploy 0755
ensure_file "$HERE/import-php.sh" /usr/local/lib/wikdra/import-php.sh 0755

if ! rc-update show default 2>/dev/null | grep -qE '^ *wikdra +[|]'; then
	change "rc-update add wikdra default (start przy starcie systemu)"
	apply rc-update add wikdra default >/dev/null
fi

# port 8092 ma być wolny albo zajęty przez naszą usługę
if netstat -ltn 2>/dev/null | grep -q '127.0.0.1:8092 ' && ! rc-service wikdra status >/dev/null 2>&1; then
	echo "UWAGA: port 127.0.0.1:8092 zajmuje inny proces — usługa wikdra nie wystartuje." >&2
	[ "$PLAN" = 1 ] || exit 1
fi

if [ -z "$CHANGES" ]; then
	echo "Bez zmian — wszystko już zainstalowane."
elif [ "$PLAN" = 1 ]; then
	echo "Plan zmian (nic nie zmieniono):$CHANGES"
else
	echo "Zainstalowano:$CHANGES"
	echo "Dalej: wdrożenie binarki (wikdra-deploy), potem import danych z PHP (import-php.sh)."
fi
