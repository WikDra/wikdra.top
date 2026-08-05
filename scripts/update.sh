#!/bin/sh
# Rozgrzewka cache forecast.solar — wpis crona dla serwera.
#
# UWAGA: ten plik jest tylko SZABLONEM wpisu. Nie instaluj go przez `crontab -`,
# bo nadpisze cały crontab użytkownika. Do instalacji użyj update_cron.sh,
# który dokłada wpis zachowując istniejące.
#
# Współrzędne są NIEPRYWATNE (centrum Warszawy) — nie wstawiaj tu adresu instalacji.
echo '0 15 * * * curl -fsS --max-time 20 "https://api.forecast.solar/estimate/52.232/21.008/30/0/8" >/dev/null 2>>/tmp/forecast-warmup.log || echo "$(date -Is) forecast warmup failed" >> /tmp/forecast-warmup.log'
