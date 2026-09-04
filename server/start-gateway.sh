#!/bin/sh
set -eu

port="${GATE_CONTROL_LISTEN_PORT:-3000}"
case "$port" in
  ''|*[!0-9]*) echo "Invalid GATE_CONTROL_LISTEN_PORT: $port" >&2; exit 1 ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "Invalid GATE_CONTROL_LISTEN_PORT: $port" >&2
  exit 1
fi

runtime_dir=/tmp/gate-control-nginx
mkdir -p \
  "$runtime_dir/logs" \
  "$runtime_dir/client_body" \
  "$runtime_dir/proxy" \
  "$runtime_dir/fastcgi" \
  "$runtime_dir/uwsgi" \
  "$runtime_dir/scgi"

sed "s/__GATE_CONTROL_LISTEN_PORT__/$port/g" /app/server/combined-nginx.conf > /tmp/gate-control-nginx.conf
exec nginx -p "$runtime_dir/" -c /tmp/gate-control-nginx.conf -g 'daemon off;'
