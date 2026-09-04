#!/bin/sh
set -eu

data_dir="${MQTT_EXPLORER_DATA_DIR:-/data/mqtt-explorer}"
mkdir -p "$data_dir"

cd /mqtt-explorer/app
# Keep MQTT Explorer on the Node runtime shipped with its own image. Its
# prebuilt dependencies target that runtime rather than Gate Control's Node 22.
# The browser server reads command-line flags directly. The source image's
# entrypoint normally converts HTTP_PORT/CONFIG_PATH into these flags, but the
# combined image starts the Node server without that entrypoint.
set -- \
  --http-port "${MQTT_EXPLORER_HTTP_PORT:-4000}" \
  --config-path "$data_dir"

if [ -n "${MQTT_EXPLORER_HTTP_USER:-}" ] && [ -n "${MQTT_EXPLORER_HTTP_PASSWORD:-}" ]; then
  set -- "$@" \
    --http-user "$MQTT_EXPLORER_HTTP_USER" \
    --http-password "$MQTT_EXPLORER_HTTP_PASSWORD"
fi

echo "Starting MQTT Explorer on port ${MQTT_EXPLORER_HTTP_PORT:-4000} with configuration in $data_dir"
exec /opt/mqtt-explorer-node \
  node-server/server/dist/node-server/server/src/index.js \
  "$@"
