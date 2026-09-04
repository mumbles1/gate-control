#!/bin/sh
set -eu

data_dir="${MQTT_EXPLORER_DATA_DIR:-/data/mqtt-explorer}"
mkdir -p "$data_dir"

export HTTP_PORT=4000
export CONFIG_PATH="$data_dir"
cd /mqtt-explorer/app
# Keep MQTT Explorer on the Node runtime shipped with its own image. Its
# prebuilt dependencies target that runtime rather than Gate Control's Node 22.
exec /opt/mqtt-explorer-node node-server/server/dist/node-server/server/src/index.js
