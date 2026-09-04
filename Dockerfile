FROM ghcr.io/mumbles1/uhppoted-httpd:latest AS access_control
FROM smeagolworms4/mqtt-explorer:browser-1.0.3 AS mqtt_explorer

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV ACCESS_CONTROL_INTERNAL_URL=http://127.0.0.1:8080
ENV ACCESS_CONTROL_DATA_DIR=/data/access-control
ENV ENABLE_LOCAL_BROKER=false
ENV ENABLE_MQTT_EXPLORER=true
ENV MQTT_EXPLORER_DATA_DIR=/data/mqtt-explorer
ENV GATE_CONTROL_LISTEN_PORT=3000
RUN apk add --no-cache mosquitto nginx && corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY --from=build /app ./
COPY --from=access_control /opt/uhppoted /opt/uhppoted
COPY --from=access_control /usr/local/etc/uhppoted /usr/local/etc/uhppoted
COPY --from=mqtt_explorer /mqtt-explorer /mqtt-explorer
COPY --from=mqtt_explorer /usr/local/bin/node /opt/mqtt-explorer-node
RUN chmod +x /app/server/start-access-control.sh /app/server/start-local-broker.sh /app/server/start-mqtt-explorer.sh /app/server/start-gateway.sh
EXPOSE 3000
EXPOSE 8080
EXPOSE 1883
EXPOSE 9001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- "http://127.0.0.1:${GATE_CONTROL_LISTEN_PORT}/" >/dev/null || exit 1
CMD ["pnpm", "start"]
