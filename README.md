# Gate Control

## Combined app edition (v1.2)

Gate Control now ships as one combined Docker image with a single installed-app experience:

- Gate Control dashboard, gate setup, schedules, MQTT controls, notifications, and configuration transfer;
- UHPPOTE Access Control running internally and opened through the Gate Control origin;
- MQTT Explorer available from the main dock;
- an optional local Mosquitto broker for sites that need one.

The standalone Access Control image remains available. The combined image imports it as a build stage and does not modify or replace that standalone deployment.

Persistent files share the `/data` mount but use separate directories:

```text
/data/
|-- access-control/
|-- mqtt-explorer/
`-- gate-control notification and transfer data
```

The built-in broker is intentionally non-persistent. It is disabled by default. Set `ENABLE_LOCAL_BROKER=true` to enable MQTT on port `1883` and MQTT over WebSockets on port `9001`. Remote brokers remain fully supported.

MQTT Explorer is enabled by default with `ENABLE_MQTT_EXPLORER=true`. This combined build uses `smeagolworms4/mqtt-explorer:browser-1.0.3`, which provides AMD64 and ARM64 images.

The combined deployment uses Docker bridge networking and publishes the single combined web interface on port `3000`. Gate Control proxies the built-in Access Control and MQTT Explorer services, so their internal web ports do not need to be exposed. Configure UHPPOTE controllers by their fixed LAN address; UDP broadcast discovery may not cross a Docker bridge. The standalone Access Control image and its files are retained and can be used again later.

To reuse existing data without copying it, the combined Compose file mounts:

```yaml
volumes:
  - /DATA/AppData/gate-control:/data
  - /DATA/AppData/uhppoted-httpd:/data/access-control
  - /DATA/AppData/mqtt-explorer:/data/mqtt-explorer
```

Do not run the standalone and combined Access Control services against the same data directory simultaneously.

Gate Control is an installable responsive web app for monitoring and controlling multiple gates through Mosquitto MQTT over secure WebSockets. It runs from Docker or CasaOS and connects each browser directly to the configured remote broker.

## What is included

- Adaptive cards, large-list, and compact dashboard layouts
- Sliding, swing, and barrier-arm status animations
- Dedicated gate page with Pulse, Open, and Close controls
- Per-gate WSS broker credentials, topics, payloads, MQTT version, QoS, and state parsing
- Case-sensitive Property/Location topic defaults; Pulse, Open, and Close share the `Property/Location` action topic
- Home Assistant-style defaults plus plain-text or JSON status mapping
- Add, edit, reorder, delete, and clone flows with duplicate endpoint prevention
- Pooled MQTT connections, keepalive, reconnect, authoritative status, non-retained actions, and debounce
- Device-local IndexedDB configuration and an installable PWA manifest

## Recommended CasaOS and Cloudflare layout

Use Cloudflare Tunnel rather than router port forwarding. The tunnel makes outbound connections from CasaOS, so no inbound broker or app ports need to remain open.

```text
gates.example.com             -> http://gate-control:3000
gate-one-mqtt.example.com     -> http://CASAOS_LAN_IP:9001
gate-two-mqtt.example.com     -> http://CASAOS_LAN_IP:9002
```

Mosquitto WebSocket listeners begin with an HTTP Upgrade request, so their Cloudflare Tunnel service is `http://`, while users configure `wss://gate-one-mqtt.example.com` in Gate Control. Cloudflare WebSockets must be enabled. Do not configure a Cloudflare Access login in front of MQTT hostnames unless the MQTT browser client can satisfy that separate authentication layer; use Mosquitto username/password and topic ACLs instead.

An example locally managed tunnel file is provided in `cloudflared-config.example.yml`. Replace all example hostnames, LAN addresses, and the tunnel UUID.

## Mosquitto listener example

Each broker must expose a WebSocket listener. When Cloudflare Tunnel terminates public TLS, the private listener can remain HTTP WebSocket on the trusted Docker/LAN network:

```conf
listener 9001 0.0.0.0
protocol websockets
allow_anonymous false
password_file /mosquitto/config/passwords
acl_file /mosquitto/config/acl
```

Give each operator only the minimum topic permissions required for their gates. Actions are published with `retain=false`, but the broker ACL should also prevent access to unrelated topics.

## Docker deployment

1. Replace `NEXT_PUBLIC_APP_URL` in `docker-compose.yml` with the app's public HTTPS hostname.
2. Build and run:

   ```sh
   docker compose up -d --build
   ```

3. Open `http://SERVER_IP:3000` locally or publish port 3000 through Cloudflare Tunnel as the app hostname.

## CasaOS deployment

Gate Control publishes versioned multi-platform images to GitHub Container Registry:

```text
ghcr.io/mumbles1/gate-control:latest
ghcr.io/mumbles1/gate-control:v1.0.0
```

In CasaOS, select **App Store → Install a customized app → Import Compose**, then import `docker-compose.casaos.yml`. Use `latest` to follow the current stable release, or replace `latest` with a specific version such as `v1.0.0` to pin the installation.

The app exposes local port 3000. Gate configuration stays in each browser. If Gate notifications are enabled, the container stores encrypted monitoring configuration and stable Web Push keys in `/DATA/AppData/gate-control`.

### Complete CasaOS Compose example

Replace `YOUR_CASAOS_IP` with the LAN address of the CasaOS machine, then paste this YAML into CasaOS **Import Compose**:

```yaml
name: gate-control
services:
  gate-control:
    image: ghcr.io/mumbles1/gate-control:latest
    container_name: gate-control
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_APP_URL: "http://YOUR_CASAOS_IP:3000"
      ALERT_DATA_DIR: "/data"
      ACCESS_CONTROL_DATA_DIR: "/data/access-control"
      MQTT_EXPLORER_DATA_DIR: "/data/mqtt-explorer"
      ENABLE_LOCAL_BROKER: "false"
      ENABLE_MQTT_EXPLORER: "true"
      GATE_CONTROL_LISTEN_PORT: "3000"
    ports:
      - target: 3000
        published: "3000"
        protocol: tcp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    volumes:
      - /DATA/AppData/gate-control:/data
      - /DATA/AppData/uhppoted-httpd:/data/access-control
      - /DATA/AppData/mqtt-explorer:/data/mqtt-explorer
    x-casaos:
      envs:
        - container: NEXT_PUBLIC_APP_URL
          description:
            en_us: Gate Control WebUI address
      ports:
        - container: "3000"
          description:
            en_us: Gate Control WebUI
x-casaos:
  architectures: [amd64, arm64]
  main: gate-control
  author: Turnage Automation
  category: Home Automation
  description:
    en_us: MQTT multi-gate monitoring and control PWA
  icon: https://raw.githubusercontent.com/mumbles1/gate-control/main/public/icon-512.png
  index: /
  port_map: "3000"
  scheme: http
  title:
    en_us: Gate Control
```

WebUI values: scheme `http`, host port `3000`, container port `3000`, and path `/`. Mount `/DATA/AppData/gate-control` on the host to `/data` in the container so notification subscriptions and encryption keys survive updates.

Update a `latest` installation from the CasaOS interface, or from a terminal with:

```bash
docker compose -f docker-compose.casaos.yml pull
docker compose -f docker-compose.casaos.yml up -d
```

## Gate setup walkthrough

After Gate Control is running, open its Web UI and select **Gate setup** in the bottom navigation. Existing gates appear under **Configured endpoints**. Select **Add gate** to configure the first gate.

![Gate Setup desktop view](docs/setup-guide/01-gate-setup-desktop.jpg)

The same setup screen works on phones. Each configured gate includes controls for ordering, cloning, editing, opening advanced settings, and deleting.

![Gate Setup mobile view](docs/setup-guide/02-gate-setup-mobile.jpg)

### Add the gate and MQTT broker

In **Identity & behavior**, enter the gate name, Property, Location, animation style, and graphic tap action. Property and Location are case-sensitive and are used to build the Turnage Automation topic defaults.

In **MQTT broker**, enter the WebSocket connection supplied by the broker administrator:

- Protocol: normally `wss://` for remote access or `ws://` for trusted LAN testing
- Host: broker hostname or LAN IP address
- Port: the Mosquitto WebSocket listener port
- Base path: normally `mqtt`
- Encryption and certificate validation: enable both for `wss://`
- Username and password: use an MQTT account restricted to this gate's topics

![Add Gate form on mobile](docs/setup-guide/03-add-gate-mobile.jpg)

Review every generated topic before saving. Gate Control blocks a save if any MQTT topic duplicates a topic assigned to another gate. Select **Test connection** to authenticate, subscribe to the configured status topics, and preview received values before saving.

### Advanced gate settings

Press and hold a gate's **Edit** button for five seconds to open **Advanced gate settings**. This page contains primary commands, broker status, traffic, automatic timer, RTC clock, input/output status fields, safety controls, live subscribed values, and gate-state mapping.

![Advanced MQTT settings](docs/setup-guide/04-advanced-mqtt-settings.jpg)

Automatic open and close times use a 12-hour picker in the app and publish the controller's required four-digit 24-hour payload.

![Schedule time picker](docs/setup-guide/05-schedule-time-picker.jpg)

Return to **Gates** and confirm that the gate shows **Connected** and reports its current state. Test controls while physically observing the gate and its safety devices.

Gate configuration and credentials remain in that browser's local device storage. Use **App → Configuration transfer** to copy a configuration to another phone, tablet, or computer. Adding the site to a mobile home screen alone does not synchronize configuration between devices.

## PWA installation

- Android/Chrome: open the HTTPS app URL and choose **Install app**.
- iPhone/Safari: open the HTTPS app URL, choose **Share**, then **Add to Home Screen**.
- Desktop: use the browser's install control.

HTTPS is required for service workers and a reliable installed-app experience. Clearing browser site data also clears saved gates and credentials.

## Gate notifications

Open **App → Gate notifications** from the installed HTTPS app, optionally enter the Web Push service contact email, and enable the switch. No contact email is hard-coded into Gate Control. The field identifies the service to push providers and is not an email-alert destination. Use **Test alert** to confirm delivery. On iPhone, Gate Control must first be added to the Home Screen and opened from that icon before iOS offers notification permission.

While enabled, the CasaOS companion monitor connects read-only to each configured MQTT endpoint and can alert for:

- An enabled automatic open/close schedule that has not reached the expected final state after 90 seconds.
- Both `<Property>/<Location>/Broker/Eth` and `<Property>/<Location>/Broker/WiFi` continuously reporting `{"LWT":0}` for the configurable controller-offline delay (15–3600 seconds, default 15).
- The configured MQTT broker remaining unreachable for 60 seconds.

Only one notification is sent per outage. The monitor does not publish gate commands, retry a scheduled action, or change the displayed gate state. Use a separate broker account restricted to the required status topics when possible. Alert configuration and MQTT credentials required by the monitor are encrypted in the `/data` volume.

## Clone configuration to another device

Open **App → Configuration transfer**, choose whether to transfer the full app or one gate, then choose a transfer method.

- **Save backup** downloads a `.gateconfig` file. On platforms that support PWA file handling, opening it launches Gate Control and starts the import. On iPhone, open the installed app and use **App > Configuration transfer > Backup file > Import backup**.
- **AirDrop or device share** sends a temporary clone link instead of an unknown `.gateconfig` document. The new device opens the link and confirms the import; the link expires after 10 minutes.
- **Share / AirDrop** opens the native mobile Share Sheet when supported, allowing AirDrop on Apple devices; unsupported browsers download the file instead.
- Select **One gate only** and **Share QR** to create a 10-minute handoff. Scan it on the receiving device and import the shared gate.
- **Import file** loads the file and replaces the gates and app preferences on that device.
- **Publish settings** publishes the bundle to the selected gate broker and configurable MQTT topic with QoS 1. Retain can be enabled or disabled.
- **Load settings** subscribes to that topic and imports the retained bundle.

The transfer includes gate definitions, MQTT credentials, dashboard preferences, notification contact email, and offline delay. It never transfers the device's Web Push subscription, notification permission, or local notification identity. Transfers are not password protected, so share them only with trusted devices and restrict the configuration topic with Mosquitto ACLs. The default topic is `<Property>/GateControl/Settings`. When **Retain** is disabled, Gate Control first clears any older retained configuration before publishing the new bundle once.

QR codes contain only a random short-lived transfer link. The gate payload is held in memory by the app server for 10 minutes and is never written to disk.

## Offline launch behavior

The installed app caches a branded server-unavailable screen. If the app server cannot be reached within five seconds during launch, Gate Control explains the problem and retries automatically every 10 seconds. If the server becomes unavailable while the app is already open, a warning banner appears with a manual retry button. A first-time device still needs a working server connection to install and cache the app.

## Security notes

- Browser storage is protected by the browser's same-origin boundary but is not equivalent to iOS Keychain or Android Keystore.
- Use unique, limited Mosquitto accounts and strong passwords; never use a broker administrator account.
- Serve only first-party app code with a restrictive Content Security Policy at the reverse proxy.
- Prefer Cloudflare Tunnel and close the router's forwarded Mosquitto/WebSocket ports after verifying the tunnel.
- Gate actuation can create a physical hazard. Add real-world obstruction detection and safety controls at the gate controller; this UI is not a substitute.

## Development and verification

```sh
pnpm install
pnpm dev
pnpm test
pnpm lint
```

`pnpm dev` listens on every network interface at port `3002`. Open
`http://YOUR_COMPUTER_LAN_IP:3002` from another device on the same network. If
Windows asks whether Node.js may accept connections, allow it on Private
networks only.

Production behavior should also be checked against each actual broker, especially its WebSocket path, Origin policy, retained status, availability payloads, and ACLs.
