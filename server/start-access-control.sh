#!/bin/sh
set -eu

data_dir="${ACCESS_CONTROL_DATA_DIR:-/data/access-control}"
config_dir="/tmp/gate-control-access"
config_file="$config_dir/uhppoted.conf"
port="${UHPPOTED_HTTP_PORT:-8080}"
case "$port" in ''|*[!0-9]*) echo "Invalid UHPPOTED_HTTP_PORT: $port" >&2; exit 1 ;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then echo "Invalid UHPPOTED_HTTP_PORT: $port" >&2; exit 1; fi

mkdir -p "$data_dir/system" "$data_dir/audit" "$config_dir"

for source in /opt/uhppoted/defaults/system/*.json; do
  target="$data_dir/system/$(basename "$source")"
  if [ ! -e "$target" ]; then cp "$source" "$target"; fi
done

if [ ! -e "$data_dir/auth.json" ]; then cp /opt/uhppoted/defaults/auth.json "$data_dir/auth.json"; fi

sed -e "s|/data/|$data_dir/|g" -e "s|^httpd.http.port = 8080$|httpd.http.port = $port|" /usr/local/etc/uhppoted/uhppoted.conf > "$config_file"
export UHPPOTED_CREDENTIALS_CSV="${UHPPOTED_CREDENTIALS_CSV:-$data_dir/credentials.csv}"

exec /opt/uhppoted/uhppoted-httpd --debug --config "$config_file" --console
