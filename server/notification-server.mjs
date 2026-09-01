import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import mqtt from "mqtt";
import webpush from "web-push";
import { advanceControllerClock, binaryValue, controllerClock, controllerDate, controllerReportedOffline, expectedGateState, normalizeSchedule, readJsonPath } from "./alert-logic.mjs";

const PORT = Number(process.env.ALERT_MONITOR_PORT || 3001);
const DATA_DIR = process.env.ALERT_DATA_DIR || (process.platform === "win32" ? path.join(process.cwd(), ".alert-data") : "/data");
const STATE_FILE = path.join(DATA_DIR, "schedule-alerts.enc");
const KEY_FILE = path.join(DATA_DIR, "schedule-alerts.key");
const VAPID_FILE = path.join(DATA_DIR, "vapid.json");
const monitors = new Map();
const gateTransfers = new Map();
const TRANSFER_TTL_MS = 10 * 60 * 1000;
let encryptionKey;
let vapidKeys;
let state = { version: 1, devices: {} };
let saveQueue = Promise.resolve();

function pruneGateTransfers() {
  const now = Date.now();
  for (const [token, transfer] of gateTransfers) if (transfer.expiresAt <= now) gateTransfers.delete(token);
  while (gateTransfers.size > 100) gateTransfers.delete(gateTransfers.keys().next().value);
}

async function ensureFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  try { encryptionKey = Buffer.from((await readFile(KEY_FILE, "utf8")).trim(), "base64"); }
  catch {
    encryptionKey = crypto.randomBytes(32);
    await writeFile(KEY_FILE, encryptionKey.toString("base64"), { mode: 0o600 });
    await chmod(KEY_FILE, 0o600).catch(() => undefined);
  }
  let vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    try { vapid = JSON.parse(await readFile(VAPID_FILE, "utf8")); }
    catch {
      vapid = webpush.generateVAPIDKeys();
      await writeFile(VAPID_FILE, JSON.stringify(vapid, null, 2), { mode: 0o600 });
      await chmod(VAPID_FILE, 0o600).catch(() => undefined);
    }
  }
  vapidKeys = vapid;
  return vapid.publicKey;
}

async function loadState() {
  try {
    const envelope = JSON.parse(await readFile(STATE_FILE, "utf8"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const clear = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    state = JSON.parse(clear.toString("utf8"));
  } catch { state = { version: 1, devices: {} }; }
}

function saveState() {
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
    await writeFile(STATE_FILE, JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") }), { mode: 0o600 });
  });
  return saveQueue;
}

function secretHash(secret) { return crypto.createHash("sha256").update(String(secret || "")).digest("hex"); }
function field(gate, name) { return (gate.advancedTopics || []).find((entry) => entry.direction === "subscribe" && entry.name === name); }
function base(gate) { return `${gate.property}/${gate.location}`.replace(/^\/+|\/+$/g, ""); }
function topicField(gate, name, fallback, jsonPath) {
  const entry = field(gate, name);
  return { name, topic: entry?.topic || `${base(gate)}/${fallback}`, path: entry?.payload || jsonPath, qos: entry?.qos === 1 ? 1 : 0 };
}
function monitorFields(gate) {
  return [
    topicField(gate, "Automatic timer status", "Auto/Time_Check", "$.Status"),
    topicField(gate, "Current automatic open time", "Auto/Time_Check", "$.Open"),
    topicField(gate, "Current automatic close time", "Auto/Time_Check", "$.Close"),
    topicField(gate, "RTC Date", "RTC/Time_Check", "$.Date"),
    topicField(gate, "RTC Time", "RTC/Time_Check", "$.Time"),
    topicField(gate, "Ethernet broker status", "Broker/Eth", "$.LWT"),
    topicField(gate, "Wi-Fi broker status", "Broker/WiFi", "$.LWT"),
    topicField(gate, "Gate movement output", "IO_Status/Outputs", "$.Move"),
    topicField(gate, "Open/close status input", "IO_Status/Inputs", "$.Relay"),
  ];
}

function sanitizeGate(gate) {
  const str = (value, max = 512) => String(value ?? "").slice(0, max);
  return {
    id: str(gate.id, 100), name: str(gate.name, 120), property: str(gate.property, 180), location: str(gate.location, 180),
    broker: {
      url: str(gate.broker?.url, 1000), username: str(gate.broker?.username, 300), password: str(gate.broker?.password, 1000),
      clientId: str(gate.broker?.clientId, 300), protocolVersion: gate.broker?.protocolVersion === 5 ? 5 : 4,
      keepalive: Math.max(10, Math.min(300, Number(gate.broker?.keepalive) || 30)), validateCertificate: gate.broker?.validateCertificate !== false,
    },
    advancedTopics: (gate.advancedTopics || []).filter((entry) => entry.direction === "subscribe").slice(0, 100).map((entry) => ({
      name: str(entry.name, 120), topic: str(entry.topic, 1000), payload: str(entry.payload, 300), direction: "subscribe", qos: entry.qos === 1 ? 1 : 0,
    })),
  };
}

async function sendAlert(deviceId, gate, kind, detail) {
  const device = state.devices[deviceId];
  if (!device?.subscription) return;
  const action = kind === "open" ? "open" : "close";
  const payload = JSON.stringify({
    title: `${gate.name} schedule warning`,
    body: `${gate.name} did not fully ${action} after its scheduled ${action} time. ${detail}`,
    tag: `gate-${gate.id}-${kind}`,
    url: `/?gate=${encodeURIComponent(gate.id)}`,
  });
  try { await webpush.sendNotification(device.subscription, payload, pushOptions(device)); }
  catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      delete device.subscription;
      await saveState();
    } else console.error("Schedule notification failed:", error?.message || error);
  }
}

function pushOptions(device) {
  return {
    TTL: 3600,
    urgency: "high",
    vapidDetails: {
      subject: device.contactEmail ? `mailto:${device.contactEmail}` : "https://turnageautomation.com",
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey,
    },
  };
}

async function sendOfflineAlert(deviceId, gate, detail) {
  const device = state.devices[deviceId];
  if (!device?.subscription) return;
  try {
    await webpush.sendNotification(device.subscription, JSON.stringify({
      title: `${gate.name} is offline`, body: detail, tag: `gate-${gate.id}-offline`, url: `/?gate=${encodeURIComponent(gate.id)}`,
    }), pushOptions(device));
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) { delete device.subscription; await saveState(); }
    else console.error("Offline notification failed:", error?.message || error);
  }
}

function startGateMonitor(deviceId, gate) {
  const key = `${deviceId}:${gate.id}`;
  const storedDevice = state.devices[deviceId];
  const fields = monitorFields(gate);
  const live = {
    connected: false, connectedAt: 0, offlineSince: Date.now(), controllerOfflineSince: 0, offlineNotified: Boolean(storedDevice?.activeOutages?.[gate.id]),
    ethernet: undefined, wifi: undefined, auto: undefined, openTime: "", closeTime: "", date: "", clock: null,
    clockReceivedAt: 0, movement: undefined, relay: undefined, pending: new Map(),
  };
  const options = {
    username: gate.broker.username || undefined, password: gate.broker.password || undefined,
    clientId: gate.broker.clientId ? `${gate.broker.clientId}-alerts` : `gate-alerts-${crypto.randomBytes(6).toString("hex")}`,
    protocolVersion: gate.broker.protocolVersion, keepalive: gate.broker.keepalive, reconnectPeriod: 5000,
    rejectUnauthorized: gate.broker.validateCertificate,
  };
  const client = mqtt.connect(gate.broker.url, options);
  client.on("connect", () => {
    live.connected = true; live.connectedAt = Date.now(); live.offlineSince = 0;
    const groups = new Map();
    for (const item of fields) groups.set(item.topic, Math.max(groups.get(item.topic) || 0, item.qos));
    for (const [topic, qos] of groups) client.subscribe(topic, { qos });
  });
  const markDisconnected = () => { live.connected = false; if (!live.offlineSince) live.offlineSince = Date.now(); };
  client.on("offline", markDisconnected);
  client.on("close", markDisconnected);
  client.on("error", (error) => console.warn(`Alert MQTT ${gate.name}:`, error.message));
  client.on("message", (topic, buffer) => {
    const payload = buffer.toString();
    for (const item of fields.filter((candidate) => candidate.topic === topic)) {
      const value = item.name === "Ethernet broker status" || item.name === "Wi-Fi broker status"
        ? readJsonPath(payload, "$.LWT")
        : readJsonPath(payload, item.path);
      if (item.name === "Automatic timer status") live.auto = binaryValue(value);
      else if (item.name === "Current automatic open time") live.openTime = normalizeSchedule(value);
      else if (item.name === "Current automatic close time") live.closeTime = normalizeSchedule(value);
      else if (item.name === "RTC Date") live.date = controllerDate(value);
      else if (item.name === "RTC Time") { live.clock = controllerClock(value); live.clockReceivedAt = Date.now(); }
      else if (item.name === "Ethernet broker status") live.ethernet = binaryValue(value);
      else if (item.name === "Wi-Fi broker status") live.wifi = binaryValue(value);
      else if (item.name === "Gate movement output") live.movement = Number(value);
      else if (item.name === "Open/close status input") live.relay = binaryValue(value);
    }
  });
  const timer = setInterval(async () => {
    const device = state.devices[deviceId];
    if (!device) return;
    const controllerOffline = controllerReportedOffline(live.ethernet, live.wifi);
    if (controllerOffline) {
      if (!live.controllerOfflineSince) live.controllerOfflineSince = Date.now();
    } else live.controllerOfflineSince = 0;
    const brokerOutage = !live.connected && live.offlineSince && Date.now() - live.offlineSince >= 60_000;
    const controllerOfflineDelay = Math.min(3600, Math.max(15, Number(device.controllerOfflineDelaySeconds) || 15));
    const controllerOutage = controllerOffline && Date.now() - live.controllerOfflineSince >= controllerOfflineDelay * 1000;
    if ((brokerOutage || controllerOutage) && !live.offlineNotified) {
      live.offlineNotified = true;
      device.activeOutages = { ...(device.activeOutages || {}), [gate.id]: true };
      await saveState();
      await sendOfflineAlert(deviceId, gate, brokerOutage
        ? `The MQTT broker for ${gate.name} has been unreachable for at least 60 seconds.`
        : `${gate.name} reports no active controller network connection (LWT 0 with no Ethernet or Wi-Fi online report) for ${controllerOfflineDelay} seconds.`);
    }
    const explicitlyOnline = live.ethernet === true || live.wifi === true;
    const connectedWithoutOfflineReport = live.connected && live.connectedAt && Date.now() - live.connectedAt >= 15_000 && !controllerOffline;
    if ((explicitlyOnline || connectedWithoutOfflineReport) && live.offlineNotified) {
      live.offlineNotified = false;
      device.activeOutages = { ...(device.activeOutages || {}), [gate.id]: false };
      await saveState();
    }
    const now = advanceControllerClock(live.date, live.clock, Date.now() - live.clockReceivedAt);
    if (live.auto !== true || !now) return;
    const recent = new Set(device.recentEvents || []);
    for (const kind of ["open", "close"]) {
      const scheduled = kind === "open" ? live.openTime : live.closeTime;
      if (!scheduled || scheduled !== now.hhmm) continue;
      const eventKey = `${gate.id}:${now.date}:${kind}:${scheduled}`;
      if (recent.has(eventKey) || live.pending.has(eventKey)) continue;
      live.pending.set(eventKey, { kind, dueAt: Date.now() + Math.max(0, 90_000 - now.second * 1000) });
    }
    for (const [eventKey, pending] of live.pending) {
      if (Date.now() < pending.dueAt) continue;
      const success = expectedGateState(pending.kind, live.movement, live.relay);
      if (!success) {
        const detail = live.connected ? `Reported movement code: ${Number.isFinite(live.movement) ? live.movement : "unknown"}.` : "The broker is offline.";
        await sendAlert(deviceId, gate, pending.kind, detail);
      }
      device.recentEvents = [...(device.recentEvents || []), eventKey].slice(-200);
      live.pending.delete(eventKey);
      await saveState();
    }
  }, 1000);
  monitors.set(key, { client, timer });
}

function stopDeviceMonitors(deviceId) {
  for (const [key, monitor] of monitors) if (key.startsWith(`${deviceId}:`)) {
    clearInterval(monitor.timer); monitor.client.end(true); monitors.delete(key);
  }
}
function restartDevice(deviceId) {
  stopDeviceMonitors(deviceId);
  for (const gate of state.devices[deviceId]?.gates || []) {
    try { startGateMonitor(deviceId, gate); }
    catch (error) { console.error(`Could not start alert monitor for ${gate.name}:`, error?.message || error); }
  }
}

function json(response, status = 200) {
  return { status, body: JSON.stringify(response), headers: { "content-type": "application/json", "cache-control": "no-store" } };
}
async function readBody(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 2_000_000) throw new Error("Request too large");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const publicKey = await ensureFiles();
await loadState();
for (const deviceId of Object.keys(state.devices)) restartDevice(deviceId);

const server = http.createServer(async (request, response) => {
  let result;
  try {
    if (request.method === "GET") result = json({ publicKey });
    else {
      const body = await readBody(request);
      if (body.action === "create-transfer") {
        pruneGateTransfers();
        const payload = String(body.payload || "");
        if (!payload || Buffer.byteLength(payload, "utf8") > 500_000) result = json({ error: "The encrypted gate transfer is empty or too large." }, 400);
        else {
          const token = crypto.randomBytes(18).toString("base64url");
          const expiresAt = Date.now() + TRANSFER_TTL_MS;
          gateTransfers.set(token, { payload, expiresAt });
          result = json({ token, expiresAt });
        }
      } else if (body.action === "get-transfer") {
        pruneGateTransfers();
        const transfer = gateTransfers.get(String(body.token || ""));
        result = transfer ? json({ payload: transfer.payload, expiresAt: transfer.expiresAt }) : json({ error: "This gate QR code has expired or is unavailable." }, 404);
      } else {
        const deviceId = String(body.deviceId || ""); const hash = secretHash(body.secret);
        if (!deviceId || !body.secret) result = json({ error: "Missing device identity." }, 400);
        else if (body.action === "sync") {
        const current = state.devices[deviceId];
        if (current && current.secretHash !== hash) result = json({ error: "Device authorization failed." }, 403);
        else {
          const gates = (body.gates || []).slice(0, 100).map(sanitizeGate).filter((gate) => gate.id && gate.broker.url);
          const email = String(body.contactEmail || "").trim().slice(0, 254);
          const controllerOfflineDelaySeconds = Math.min(3600, Math.max(15, Math.round(Number(body.controllerOfflineDelaySeconds) || 15)));
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) result = json({ error: "Enter a valid push service contact email." }, 400);
          else {
            state.devices[deviceId] = { ...current, secretHash: hash, subscription: body.subscription, contactEmail: email, controllerOfflineDelaySeconds, gates, recentEvents: current?.recentEvents || [], activeOutages: current?.activeOutages || {}, updatedAt: Date.now() };
            await saveState(); restartDevice(deviceId); result = json({ ok: true, monitoredGates: gates.length });
          }
        }
      } else if (body.action === "disable") {
        const current = state.devices[deviceId];
        if (!current || current.secretHash !== hash) result = json({ error: "Device authorization failed." }, 403);
        else { stopDeviceMonitors(deviceId); delete state.devices[deviceId]; await saveState(); result = json({ ok: true }); }
      } else if (body.action === "test") {
        const current = state.devices[deviceId];
        if (!current || current.secretHash !== hash) result = json({ error: "Device authorization failed." }, 403);
        else {
          await webpush.sendNotification(current.subscription, JSON.stringify({ title: "Gate Control notifications enabled", body: "This device will receive failed-schedule, controller-offline, and MQTT-broker-offline alerts.", tag: "gate-alert-test", url: "/" }), pushOptions(current));
          result = json({ ok: true });
        }
        } else result = json({ error: "Unknown action." }, 400);
      }
    }
  } catch (error) { console.error(error); result = json({ error: "Notification service request failed." }, 500); }
  response.writeHead(result.status, result.headers); response.end(result.body);
});
server.listen(PORT, "127.0.0.1", () => console.log(`Gate schedule notification monitor listening on 127.0.0.1:${PORT}`));

function shutdown() { for (const monitor of monitors.values()) { clearInterval(monitor.timer); monitor.client.end(true); } server.close(() => process.exit(0)); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
