#!/bin/sh
set -eu

data_dir="${ACCESS_CONTROL_DATA_DIR:-/data/access-control}"
config_dir="/tmp/gate-control-access"
config_file="$config_dir/uhppoted.conf"

mkdir -p "$data_dir/system" "$data_dir/audit" "$config_dir"

for source in /opt/uhppoted/defaults/system/*.json; do
  target="$data_dir/system/$(basename "$source")"
  if [ ! -e "$target" ]; then
    cp "$source" "$target"
  fi
done

if [ ! -e "$data_dir/auth.json" ]; then
  cp /opt/uhppoted/defaults/auth.json "$data_dir/auth.json"
fi

sed "s|/data/|$data_dir/|g" /usr/local/etc/uhppoted/uhppoted.conf > "$config_file"

exec /opt/uhppoted/uhppoted-httpd --debug --config "$config_file" --console
