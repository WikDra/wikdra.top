#!/bin/sh
# Dokłada wpis crona rozgrzewający cache forecast.solar, NIE gubiąc istniejących.
#
# Poprzednia wersja robiła `... | crontab -` na wyniku `grep -v`, więc każdy
# błąd potoku (albo pusty crontab) kończył się wyczyszczeniem harmonogramu.
# Teraz: kopia zapasowa, budowa nowej listy w pliku tymczasowym, instalacja
# tylko gdy plik jest niepusty.
set -eu

ENTRY='0 15 * * * curl -fsS --max-time 20 "https://api.forecast.solar/estimate/52.232/21.008/30/0/8" >/dev/null 2>>/tmp/forecast-warmup.log || echo "$(date -Is) forecast warmup failed" >> /tmp/forecast-warmup.log'
BACKUP="/tmp/crontab-backup-$(date +%Y%m%d%H%M%S).txt"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

crontab -l > "$BACKUP" 2>/dev/null || : > "$BACKUP"
echo "Kopia zapasowa crontaba: $BACKUP"

grep -v 'api\.forecast\.solar' "$BACKUP" > "$TMP" || :
echo "$ENTRY" >> "$TMP"

if [ ! -s "$TMP" ]; then
    echo "Plik wynikowy jest pusty — przerywam, crontab bez zmian." >&2
    exit 1
fi

crontab "$TMP"
echo "Zainstalowano wpis crona:"
crontab -l | grep 'forecast.solar'
