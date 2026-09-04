#!/bin/sh
set -eu

config="/tmp/gate-control-mosquitto.conf"
cat > "$config" <<'EOF'
listener 1883
protocol mqtt

listener 9001
protocol websockets

allow_anonymous true
persistence false
user root
log_dest stdout
log_type error
log_type warning
log_type notice
log_type information
EOF

exec mosquitto -c "$config"
