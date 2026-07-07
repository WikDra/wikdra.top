import os

base_dir = os.path.dirname(os.path.abspath(__file__))
update_sh_path = os.path.join(base_dir, 'update.sh')

with open(update_sh_path, 'wb') as f:
    f.write(b"cat << 'EOF' | crontab -\n0 15 * * * curl -s \"https://api.forecast.solar/estimate/50.482/21.315/30/0/8\" > /dev/null\nEOF\n")
