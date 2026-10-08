FROM ghcr.io/mumbles1/uhppoted-httpd:latest AS access_control

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG APP_BUILD=local
RUN printf 'export const APP_BUILD = "%s";\n' "$APP_BUILD" > app/build-id.ts
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV ACCESS_CONTROL_DATA_DIR=/data/access-control
ENV UHPPOTED_CREDENTIALS_CSV=/data/access-control/credentials.csv
ENV GATE_CONTROL_LISTEN_PORT=3000
RUN apk add --no-cache nginx && corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY --from=build /app ./
COPY --from=access_control /opt/uhppoted /opt/uhppoted
COPY --from=access_control /usr/local/etc/uhppoted /usr/local/etc/uhppoted
RUN chmod +x /app/server/start-access-control.sh /app/server/start-gateway.sh
EXPOSE 3000 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 CMD wget -qO- "http://127.0.0.1:${GATE_CONTROL_LISTEN_PORT}/api/health" >/dev/null || exit 1
CMD ["pnpm", "start"]
