(crontab -l 2>/dev/null | grep -v 'api.forecast.solar'; echo "0 15 * * * curl -s \"https://api.forecast.solar/estimate/50.482/21.315/30/0/8\" > /dev/null") | crontab -
