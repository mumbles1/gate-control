#!/bin/sh
set -eu

port="${GATE_CONTROL_LISTEN_PORT:-3080}"
httpd_port="${UHPPOTED_HTTP_PORT:-8080}"
internal_port="${GATE_CONTROL_INTERNAL_PORT:-3100}"
case "$port" in ''|*[!0-9]*) echo "Invalid GATE_CONTROL_LISTEN_PORT: $port" >&2; exit 1 ;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then echo "Invalid GATE_CONTROL_LISTEN_PORT: $port" >&2; exit 1; fi
case "$httpd_port" in ''|*[!0-9]*) echo "Invalid UHPPOTED_HTTP_PORT: $httpd_port" >&2; exit 1 ;; esac
if [ "$httpd_port" -lt 1 ] || [ "$httpd_port" -gt 65535 ]; then echo "Invalid UHPPOTED_HTTP_PORT: $httpd_port" >&2; exit 1; fi
case "$internal_port" in ''|*[!0-9]*) echo "Invalid GATE_CONTROL_INTERNAL_PORT: $internal_port" >&2; exit 1 ;; esac
if [ "$internal_port" -lt 1 ] || [ "$internal_port" -gt 65535 ]; then echo "Invalid GATE_CONTROL_INTERNAL_PORT: $internal_port" >&2; exit 1; fi

runtime_dir=/tmp/gate-control-nginx
mkdir -p "$runtime_dir/logs" "$runtime_dir/client_body" "$runtime_dir/proxy" "$runtime_dir/fastcgi" "$runtime_dir/uwsgi" "$runtime_dir/scgi"
sed -e "s/__GATE_CONTROL_LISTEN_PORT__/$port/g" -e "s/__UHPPOTED_HTTP_PORT__/$httpd_port/g" -e "s/__GATE_CONTROL_INTERNAL_PORT__/$internal_port/g" /app/server/combined-nginx.conf > /tmp/gate-control-nginx.conf
exec nginx -p "$runtime_dir/" -c /tmp/gate-control-nginx.conf -g 'daemon off;'
