export type GateState = "open" | "closed" | "opening" | "closing" | "stopped" | "unknown" | "offline";
export type GateVisualStyle = "sliding" | "swing" | "ranch" | "barrier";
export type GraphicTapAction = "pulse" | "toggle";
export type DashboardLayout = "cards" | "list" | "compact";
export type ColorTheme = "system" | "light" | "dark";
export type GateDisplayMode = "all" | "property";
export type GateCommand = "pulse" | "open" | "close";
export type BrokerProtocol = "mqtt" | "ws" | "wss";

type RandomSource = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

/** Creates a UUID on older Safari and on non-secure LAN origins where randomUUID is unavailable. */
export function createId(source: RandomSource | undefined = globalThis.crypto as unknown as RandomSource | undefined): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type NativeClone = <T>(value: T) => T;

/** Clones the app's plain configuration data on Safari versions without structuredClone. */
export function cloneData<T>(value: T, nativeClone: NativeClone | null | undefined = (globalThis as typeof globalThis & { structuredClone?: NativeClone }).structuredClone): T {
  if (typeof nativeClone === "function") return nativeClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface MQTTActionMapping {
  topic: string;
  payload: string;
}

export interface AccessControlSettings {
  mode: "off" | "integrated" | "external";
  protocol: "http" | "https";
  host: string;
  port: number;
  basePath: string;
}

export const defaultAccessControlSettings = (): AccessControlSettings => ({
  mode: "off",
  protocol: "http",
  host: "",
  port: 8080,
  basePath: "",
});

export function accessControlConfigured(settings?: AccessControlSettings): boolean {
  if (!settings) return false;
  const mode = settings.mode ?? (settings.host?.trim() ? "external" : "off");
  if (mode === "integrated") return true;
  return mode === "external" && Boolean(settings.host?.trim());
}

export function accessControlUrl(settings?: AccessControlSettings): string {
  if (!settings) return "";
  const mode = settings.mode ?? (settings.host?.trim() ? "external" : "off");
  if (mode === "off") return "";
  if (mode === "integrated") return "/access-control/";
  if (!settings.host.trim()) return "";
  const host = settings.host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  const basePath = settings.basePath.trim().replace(/^\/+|\/+$/g, "");
  return `${settings.protocol}://${host}:${settings.port}${basePath ? `/${basePath}` : ""}`;
}

export interface AdditionalMQTTTopic {
  id: string;
  name: string;
  topic: string;
  direction: "subscribe" | "publish";
  qos: 0 | 1;
  payload: string;
  offPayload?: string;
  lockedDirection?: boolean;
}

export function schedulePayload(hour12: number, minute: number, period: "AM" | "PM"): string {
  const safeHour = Math.min(12, Math.max(1, Math.trunc(hour12) || 12));
  const safeMinute = Math.min(59, Math.max(0, Math.trunc(minute) || 0));
  const hour = safeHour % 12 + (period === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}${String(safeMinute).padStart(2, "0")}`;
}

export function formatControllerTime12h(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Waiting for controller";
  const text = String(value).trim();
  const compact = text.match(/^(\d{2})(\d{2})$/);
  const separated = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const hour = compact ? Number(compact[1]) : separated ? Number(separated[1]) : Number.NaN;
  const minute = compact ? compact[2] : separated ? separated[2] : "";
  const second = separated?.[3];
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || Number(minute) > 59) return text;
  return `${hour % 12 || 12}:${minute}${second ? `:${second}` : ""} ${hour >= 12 ? "PM" : "AM"}`;
}

export interface StateMapping {
  format: "plain" | "json";
  jsonPath: string;
  open: string;
  closed: string;
  opening: string;
  closing: string;
  stopped: string;
  available: string;
  unavailable: string;
}

export interface BrokerSettings {
  url: string;
  protocol: BrokerProtocol;
  host: string;
  port: number;
  basePath: string;
  tls: boolean;
  validateCertificate: boolean;
  username: string;
  password: string;
  clientId: string;
  protocolVersion: 4 | 5;
  keepalive: number;
}

export function defaultBrokerPort(protocol: BrokerProtocol, tls: boolean): number {
  if (protocol === "mqtt") return tls ? 8883 : 1883;
  return protocol === "wss" || tls ? 443 : 80;
}

export function brokerUrl(broker: BrokerSettings): string {
  const host = broker.host.trim().replace(/^\[|\]$/g, "");
  const formattedHost = host.includes(":") ? `[${host}]` : host;
  // TLS is the source of truth for the transport scheme. Older imports could
  // contain protocol: "wss" with tls: false, which made the editor show TLS
  // off while the client still attempted WSS until the switch was toggled.
  const scheme = broker.protocol === "mqtt" ? (broker.tls ? "mqtts" : "mqtt") : (broker.tls ? "wss" : "ws");
  const path = broker.protocol === "mqtt" ? "" : broker.basePath.trim() ? `/${broker.basePath.trim().replace(/^\/+|\/+$/g, "")}` : "";
  const port = Number.isInteger(broker.port) ? `:${broker.port}` : "";
  return `${scheme}://${formattedHost}${port}${path}`;
}

/** Default Cloudflare hostname for a property-specific broker. */
export function defaultBrokerHost(property: string): string {
  const subdomain = property
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "property";
  return `${subdomain}.turnageautomation.com`;
}

/** Default Mosquitto WebSocket route exposed by Cloudflare. */
export function defaultBrokerBasePath(_property?: string): string {
  return "mqtt";
}

export function migrateBrokerSettings(broker: BrokerSettings): BrokerSettings {
  if (broker.protocol && broker.host && broker.port) {
    const protocol: BrokerProtocol = broker.protocol === "mqtt" ? "mqtt" : broker.tls ? "wss" : "ws";
    const normalized = {
      ...broker,
      protocol,
      validateCertificate: broker.validateCertificate ?? true,
    };
    return { ...normalized, url: brokerUrl(normalized) };
  }
  try {
    const parsed = new URL(broker.url.trim());
    const rawScheme = parsed.protocol.replace(":", "").toLowerCase();
    const protocol: BrokerProtocol = rawScheme === "mqtt" || rawScheme === "mqtts" ? "mqtt" : rawScheme === "ws" ? "ws" : "wss";
    const tls = rawScheme === "wss" || rawScheme === "mqtts";
    const migrated = {
      ...broker,
      protocol,
      host: parsed.hostname,
      port: Number(parsed.port) || defaultBrokerPort(protocol, tls),
      basePath: protocol === "mqtt" ? "" : parsed.pathname.replace(/^\/+|\/+$/g, ""),
      tls,
      validateCertificate: broker.validateCertificate ?? true,
    };
    return { ...migrated, url: brokerUrl(migrated) };
  } catch {
    const migrated = {
      ...broker,
      protocol: "wss" as BrokerProtocol,
      host: "",
      port: 443,
      basePath: "mqtt",
      tls: true,
      validateCertificate: true,
    };
    return { ...migrated, url: brokerUrl(migrated) };
  }
}

export interface GateConfiguration {
  id: string;
  /** Local-only demonstration gate. It never opens an MQTT connection. */
  simulated?: boolean;
  name: string;
  property: string;
  propertyAlias: string;
  location: string;
  locationAlias: string;
  order: number;
  visualStyle: GateVisualStyle;
  graphicTapAction: GraphicTapAction;
  homeAssistantDiscoveryEnabled: boolean;
  accessControl: AccessControlSettings;
  broker: BrokerSettings;
  statusTopic: string;
  availabilityTopic: string;
  actions: Record<GateCommand, MQTTActionMapping>;
  advancedTopics: AdditionalMQTTTopic[];
  mapping: StateMapping;
  qos: 0 | 1;
}

export function jogMacroDefinition(gate: GateConfiguration, direction: "open" | "close", stopAction: AdditionalMQTTTopic) {
  return {
    press: { ...gate.actions[direction] },
    release: { topic: stopAction.topic, payload: stopAction.payload },
  };
}

export interface GateRuntimeState {
  state: GateState;
  connected: boolean;
  /** Gate controller's own Ethernet/Wi-Fi connection to the MQTT broker. */
  controllerConnected?: boolean;
  lastMessageAt?: number;
  lastPublish?: { ok: boolean; message: string; at: number };
  mqttSignals?: Record<string, { name: string; payload: string; at: number }>;
  warning?: string;
  error?: string;
}

export function displayedGateState(runtime: GateRuntimeState): GateState {
  if (!runtime.connected) return "unknown";
  return runtime.controllerConnected === false ? "offline" : runtime.state;
}

export function topicDefaults(property: string, location: string) {
  const segment = (value: string, fallback: string) => value.trim().replace(/^\/+|\/+$/g, "") || fallback;
  const base = `${segment(property, "property")}/${segment(location, "location")}`;
  return {
    statusTopic: `${base}/state`,
    availabilityTopic: `${base}/availability`,
    pulseTopic: base,
    openTopic: base,
    closeTopic: base,
  };
}

export function configurationTransferTopic(property?: string): string {
  const propertySegment = property?.trim().replace(/^\/+|\/+$/g, "");
  return propertySegment ? `${propertySegment}/GateControl/Settings` : "";
}

/** Turnage Automation controller topics extracted from the installed MQTT contract. */
export function controllerTopicDefaults(property: string, location: string): AdditionalMQTTTopic[] {
  const root = topicDefaults(property, location).pulseTopic;
  const preset = (name: string, suffix: string, direction: AdditionalMQTTTopic["direction"], payload: string, offPayload?: string): AdditionalMQTTTopic => ({
    id: createId(),
    name,
    topic: suffix ? `${root}/${suffix}` : root,
    direction,
    qos: 0,
    payload,
    offPayload,
    lockedDirection: true,
  });
  return [
    preset("Ethernet broker status", "Broker/Eth", "subscribe", '{"LWT":1}', '{"LWT":0}'),
    preset("Wi-Fi broker status", "Broker/WiFi", "subscribe", '{"LWT":1}', '{"LWT":0}'),
    preset("Traffic breach", "Traffic", "subscribe", '{"Breach":1}', '{"Breach":0}'),
    preset("Automatic timer status", "Auto/Time_Check", "subscribe", "$.Status"),
    preset("Current automatic open time", "Auto/Time_Check", "subscribe", "$.Open"),
    preset("Current automatic close time", "Auto/Time_Check", "subscribe", "$.Close"),
    preset("Enable automatic timer", "Auto", "publish", "1"),
    preset("Disable automatic timer", "Auto", "publish", "0"),
    preset("Automatic open time", "Auto/Open_Time", "publish", "<hour><minutes>"),
    preset("Automatic close time", "Auto/Close_Time", "publish", "<hour><minutes>"),
    preset("RTC Date", "RTC/Time_Check", "subscribe", "$.Date"),
    preset("RTC Time", "RTC/Time_Check", "subscribe", "$.Time"),
    preset("Manual daylight savings status", "RTC/Time_Check", "subscribe", "$.DST"),
    preset("Enable manual daylight savings", "DST", "publish", "1"),
    preset("Disable manual daylight savings", "DST", "publish", "0"),
    preset("RF Remote sensor input", "IO_Status/Inputs", "subscribe", "$.RF"),
    preset("Keypad sensor input", "IO_Status/Inputs", "subscribe", "$.KP"),
    preset("Lamp module sensor input", "IO_Status/Inputs", "subscribe", "$.Lamp"),
    preset("Exit sensor input", "IO_Status/Inputs", "subscribe", "$.Exit"),
    preset("Siren operated sensor input", "IO_Status/Inputs", "subscribe", "$.SOS"),
    preset("Open/close status input", "IO_Status/Inputs", "subscribe", "$.Relay"),
    preset("Outside safety sensor input", "IO_Status/Inputs", "subscribe", "$.OS"),
    preset("Inside safety sensor input", "IO_Status/Inputs", "subscribe", "$.IS"),
    preset("Open safety output status", "IO_Status/Outputs", "subscribe", "$.OpnSafe"),
    preset("Gate movement output", "IO_Status/Outputs", "subscribe", "$.Move"),
    preset("Open signal output", "IO_Status/Outputs", "subscribe", "$.MBOpn"),
    preset("Stop signal output", "IO_Status/Outputs", "subscribe", "$.MBSt"),
    preset("Close signal output", "IO_Status/Outputs", "subscribe", "$.MBCl"),
    preset("Safety signal output", "IO_Status/Outputs", "subscribe", "$.MBSafe"),
    preset("Power relay output", "IO_Status/Outputs", "subscribe", "$.PWRelay"),
    preset("Liftmaster reset output", "IO_Status/Outputs", "subscribe", "$.LMReset"),
    preset("Enable safety output", "IO_Status/Outputs", "publish", "Safe_1"),
    preset("Disable safety output", "IO_Status/Outputs", "publish", "Safe_0"),
    preset("Enable constant publishing", "Pub", "publish", "1"),
    preset("Disable constant publishing", "Pub", "publish", "0"),
    preset("Stop command", "", "publish", "Stop"),
    preset("Enable open safety", "", "publish", "Safe_1"),
    preset("Disable open safety", "", "publish", "Safe_0"),
  ];
}

/** Reads a controller binary field from JSON, accepting numeric and string 0/1 values. */
export function readBinaryPayload(payload: string, key: string): boolean | undefined {
  try {
    const decoded = JSON.parse(payload) as Record<string, unknown>;
    const value = decoded[key];
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
  } catch {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = payload.match(new RegExp(`["']*${escaped}["']*\\s*:\\s*(?:"([01])"|'([01])'|([01]))`, "i"));
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value === "1") return true;
    if (value === "0") return false;
  }
  return undefined;
}

/** Reads the controller Outputs `Move` field without interpreting other fields. */
export function readControllerMoveValue(payload: string): number | undefined {
  let rawMove: unknown;
  try {
    const decoded = JSON.parse(payload) as { Move?: unknown };
    rawMove = decoded.Move;
  } catch {
    // Recover only Move when unrelated fields make the controller object
    // non-standard JSON. No other output field affects the gate position.
  }
  if (rawMove === undefined || rawMove === null || rawMove === "") {
    const match = payload.match(/["']?Move["']?\s*:\s*(?:["']\s*)?(-?\d+)/i);
    rawMove = match?.[1];
  }
  const move = Number(rawMove);
  if (!Number.isFinite(move)) return undefined;
  return move;
}

/** Maps the controller Outputs `Move` field into the gate animation states. */
export function mapControllerMovePayload(payload: string, openCloseStatus?: boolean): GateState | undefined {
  const move = readControllerMoveValue(payload);
  if (move === 0) return openCloseStatus === undefined ? undefined : openCloseStatus ? "open" : "closed";
  if (move === 1) return "opening";
  if (move === 2) return "closing";
  if (move === 3) return "open";
  if (move === 4 || move === 5 || move === 8) return "closed";
  if (move === 6 || move === 7 || move === 10) return "open";
  if (move === 11) return "stopped";
  if (move === 9) return "closed";
  return undefined;
}

export function updateGatePlace(gate: GateConfiguration, key: "property" | "location", value: string): GateConfiguration {
  const oldDefaults = topicDefaults(gate.property, gate.location);
  const next = { ...gate, [key]: value };
  const newDefaults = topicDefaults(next.property, next.location);
  const oldDefaultHost = defaultBrokerHost(gate.property);
  const nextDefaultHost = defaultBrokerHost(next.property);
  const currentHost = gate.broker.host.trim().toLowerCase();
  const broker = key === "property" && currentHost === oldDefaultHost
    ? (() => {
        const updated = { ...gate.broker, host: nextDefaultHost };
        return { ...updated, url: brokerUrl(updated) };
      })()
    : gate.broker;
  return {
    ...next,
    broker,
    statusTopic: !gate.homeAssistantDiscoveryEnabled && gate.statusTopic === oldDefaults.statusTopic ? newDefaults.statusTopic : gate.statusTopic,
    availabilityTopic: !gate.homeAssistantDiscoveryEnabled && gate.availabilityTopic === oldDefaults.availabilityTopic ? newDefaults.availabilityTopic : gate.availabilityTopic,
    actions: {
      pulse: { ...gate.actions.pulse, topic: newDefaults.pulseTopic },
      open: { ...gate.actions.open, topic: newDefaults.openTopic },
      close: { ...gate.actions.close, topic: newDefaults.closeTopic },
    },
    advancedTopics: (gate.advancedTopics ?? []).map((entry) => ({
      ...entry,
      topic: entry.topic === oldDefaults.pulseTopic || entry.topic.startsWith(`${oldDefaults.pulseTopic}/`)
        ? `${newDefaults.pulseTopic}${entry.topic.slice(oldDefaults.pulseTopic.length)}`
        : entry.topic,
    })),
  };
}

export const defaultGate = (order = 0): GateConfiguration => {
  const property = "property";
  const location = `gate-${order + 1}`;
  const topics = topicDefaults(property, location);
  const host = defaultBrokerHost(property);
  const basePath = defaultBrokerBasePath();
  return ({
  id: createId(),
  name: "New gate",
  property,
  propertyAlias: "",
  location,
  locationAlias: "",
  order,
  visualStyle: "sliding",
  graphicTapAction: "pulse",
  homeAssistantDiscoveryEnabled: false,
  accessControl: defaultAccessControlSettings(),
  broker: {
    url: `wss://${host}:443/${basePath}`,
    protocol: "wss",
    host,
    port: 443,
    basePath,
    tls: true,
    validateCertificate: true,
    username: "",
    password: "",
    clientId: "",
    protocolVersion: 4,
    keepalive: 30,
  },
  statusTopic: topics.statusTopic,
  availabilityTopic: topics.availabilityTopic,
  actions: {
    pulse: { topic: topics.pulseTopic, payload: "Pulse" },
    open: { topic: topics.openTopic, payload: "Open" },
    close: { topic: topics.closeTopic, payload: "Close" },
  },
  advancedTopics: controllerTopicDefaults(property, location),
  mapping: {
    format: "plain",
    jsonPath: "state",
    open: "open",
    closed: "closed",
    opening: "opening",
    closing: "closing",
    stopped: "stopped",
    available: "online",
    unavailable: "offline",
  },
  qos: 0,
  });
};

export const defaultSimulatedGate = (order = 0): GateConfiguration => {
  const gate = defaultGate(order);
  return {
    ...gate,
    simulated: true,
    name: "Demo gate",
    property: "Demo Property",
    propertyAlias: "",
    location: "Main Entrance",
    locationAlias: "",
    advancedTopics: gate.advancedTopics.filter((entry) => entry.name === "Stop command"),
  };
};

const normalizeTopic = (value: string) => value.trim().replace(/^\/+|\/+$/g, "");

export function endpointIdentity(gate: GateConfiguration): string {
  let url = brokerUrl(migrateBrokerSettings(gate.broker)).toLowerCase();
  try {
    const parsed = new URL(url);
    const port = parsed.port || "443";
    url = `${parsed.protocol}//${parsed.hostname}:${port}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    // Validation reports malformed URLs. Identity remains deterministic.
  }
  return [
    url,
    normalizeTopic(gate.statusTopic),
    normalizeTopic(gate.actions.pulse.topic),
    normalizeTopic(gate.actions.open.topic),
    normalizeTopic(gate.actions.close.topic),
  ].join("|");
}

export function validateGate(gate: GateConfiguration, existing: GateConfiguration[]): string[] {
  const errors: string[] = [];
  if (!gate.name.trim()) errors.push("Gate name is required.");
  if (!gate.property.trim()) errors.push("Property is required.");
  if (!gate.location.trim()) errors.push("Location is required.");
  if (gate.accessControl.mode === "external") {
    if (!gate.accessControl.host.trim()) errors.push("Access control server IP or hostname is required in External server mode.");
    if (!Number.isInteger(gate.accessControl.port) || gate.accessControl.port < 1 || gate.accessControl.port > 65535) errors.push("Access control port must be between 1 and 65535.");
    try { new URL(accessControlUrl(gate.accessControl)); }
    catch { errors.push("Enter a valid access control server IP or hostname."); }
  }
  if (gate.simulated) return errors;
  try {
    if (!Number.isInteger(gate.broker.port) || gate.broker.port < 1 || gate.broker.port > 65535) errors.push("Broker port must be between 1 and 65535.");
    const broker = migrateBrokerSettings(gate.broker);
    if (!broker.host.trim()) errors.push("Broker host is required.");
    new URL(brokerUrl(broker));
  } catch { errors.push("Enter valid broker connection settings."); }
  if (!gate.statusTopic.trim()) errors.push("Status topic is required.");
  for (const command of ["pulse", "open", "close"] as GateCommand[]) {
    if (!gate.actions[command].topic.trim()) errors.push(`${command} topic is required.`);
    if (!gate.actions[command].payload.length) errors.push(`${command} payload is required.`);
  }
  if (gate.mapping.format === "json" && !gate.mapping.jsonPath.trim()) {
    errors.push("JSON key path is required for JSON status messages.");
  }
  const topicEntries = [
    ["status", gate.statusTopic],
    ["availability", gate.availabilityTopic],
    ["Pulse action", gate.actions.pulse.topic],
    ["Open action", gate.actions.open.topic],
    ["Close action", gate.actions.close.topic],
    ...(gate.advancedTopics ?? []).map((entry) => [`Additional topic ${entry.name || entry.id}`, entry.topic] as const),
  ] as const;
  const otherTopics = new Set(existing
    .filter((item) => item.id !== gate.id)
    .flatMap((item) => [item.statusTopic, item.availabilityTopic, item.actions.pulse.topic, item.actions.open.topic, item.actions.close.topic, ...(item.advancedTopics ?? []).map((entry) => entry.topic)])
    .map(normalizeTopic)
    .filter(Boolean));
  const conflicts = [...new Set(topicEntries
    .filter(([, topic]) => topic.trim() && otherTopics.has(normalizeTopic(topic)))
    .map(([label]) => label))];
  if (conflicts.length) errors.push(`Topics already used by another gate: ${conflicts.join(", ")}.`);
  (gate.advancedTopics ?? []).forEach((entry, index) => {
    if (!entry.name.trim()) errors.push(`Additional topic ${index + 1} needs a name.`);
    if (!entry.topic.trim()) errors.push(`Additional topic ${index + 1} needs a topic.`);
  });
  return errors;
}

export function migrateGate(gate: GateConfiguration): GateConfiguration {
  const statusSegments = normalizeTopic(gate.statusTopic).split("/");
  const property = gate.property?.trim() || statusSegments[0] || "property";
  const location = gate.location?.trim() || statusSegments[1] || `gate-${gate.order + 1}`;
  const discoveryEnabled = gate.homeAssistantDiscoveryEnabled ?? false;
  const defaults = topicDefaults(property, location);
  const base = defaults.pulseTopic;
  const actions = cloneData(gate.actions);
  const controllerPresets = new Map(controllerTopicDefaults(property, location).map((entry) => [entry.name, entry]));
  if (!discoveryEnabled) {
    if ([`${base}/`, `${base}/command`, `${base}/pulse`].includes(actions.pulse.topic)) actions.pulse.topic = base;
    if ([`${base}/`, `${base}/command`, `${base}/open`].includes(actions.open.topic)) actions.open.topic = base;
    if ([`${base}/`, `${base}/command`, `${base}/close`].includes(actions.close.topic)) actions.close.topic = base;
  }
  const previousAccessControl = gate.accessControl as Partial<AccessControlSettings> | undefined;
  const accessControl = {
    ...defaultAccessControlSettings(),
    ...(previousAccessControl ?? {}),
    mode: previousAccessControl?.mode ?? (previousAccessControl?.host?.trim() ? "external" : "off"),
  } as AccessControlSettings;
  return {
    ...gate,
    accessControl,
    broker: migrateBrokerSettings(gate.broker),
    property,
    propertyAlias: gate.propertyAlias?.trim() ?? "",
    location,
    locationAlias: gate.locationAlias?.trim() ?? "",
    actions,
    mapping: { ...gate.mapping, stopped: gate.mapping?.stopped ?? "stopped" },
    advancedTopics: (() => {
      const removedControllerFields = new Set(["Light signal output", "Safety output status"]);
      const migrated: AdditionalMQTTTopic[] = (gate.advancedTopics ?? []).map((entry): AdditionalMQTTTopic => {
        const renamedControllerFields: Record<string, string> = {
          "Remote input": "RF Remote sensor input",
          "Keypad input": "Keypad sensor input",
          "Light input": "Lamp module sensor input",
          "Exit probe input": "Exit sensor input",
          "Manual button safety output": "Safety signal output",
          "Limit reset output": "Liftmaster reset output",
          "Lamp signal output": "Light signal output",
          "Safety output": "Safety output status",
        };
        const entryName = renamedControllerFields[entry.name] ?? entry.name;
        const preset = controllerPresets.get(entryName);
        const legacyTimePayload = (entryName === "Automatic open time" || entryName === "Automatic close time")
          && (!entry.payload || entry.payload.trim().toLowerCase() === "time" || /hour|minute|\{/.test(entry.payload));
        const legacyAutomaticStatusPayload = entryName === "Automatic timer status"
          && (!entry.payload || entry.payload.trim().startsWith("{"));
        const safetyCommand = entryName === "Enable safety output" || entryName === "Disable safety output";
        const legacySafetyStatusPayload = entryName === "Safety output status"
          && (!entry.payload || entry.payload.trim().startsWith("{") || Boolean(entry.offPayload));
        return {
          id: entry.id || createId(),
          name: entryName ?? "",
          topic: safetyCommand
            ? preset?.topic ?? entry.topic
            : (entryName === "Enable automatic timer" || entryName === "Disable automatic timer") && /\/Auto\/Time_Check\/?$/.test(entry.topic)
            ? preset?.topic ?? entry.topic
            : (entryName === "RTC Date" || entryName === "RTC Time") && /\/RTC\/Time_check\/?$/.test(entry.topic)
              ? preset?.topic ?? entry.topic
              : entry.topic ?? preset?.topic ?? "",
          direction: preset?.direction ?? (entry.direction === "publish" ? "publish" : "subscribe"),
          qos: entry.qos === 1 ? 1 : 0,
          payload: entryName === "Enable automatic timer" || entryName === "Disable automatic timer" || entryName === "Enable manual daylight savings" || entryName === "Disable manual daylight savings" || safetyCommand || legacySafetyStatusPayload
            ? preset?.payload ?? entry.payload
            : legacyAutomaticStatusPayload || legacyTimePayload ? preset?.payload ?? entry.payload : entry.payload ?? preset?.payload ?? "",
          offPayload: legacyAutomaticStatusPayload || legacySafetyStatusPayload ? undefined : entry.offPayload ?? preset?.offPayload,
          lockedDirection: preset ? true : entry.lockedDirection ?? false,
        };
      }).filter((entry) => !removedControllerFields.has(entry.name));
      const hasAutomaticTimer = migrated.some((entry) => entry.name === "Automatic timer status" || /\/Auto\/Time_Check\/?$/.test(entry.topic));
      if (hasAutomaticTimer) {
        for (const name of ["Current automatic open time", "Current automatic close time", "Enable automatic timer", "Disable automatic timer", "RTC Date", "RTC Time", "Manual daylight savings status", "Enable manual daylight savings", "Disable manual daylight savings"]) {
          if (!migrated.some((entry) => entry.name === name)) {
            const preset = controllerPresets.get(name);
            if (preset) migrated.push(preset);
          }
        }
      }
      const expandLegacyStatus = (legacyName: string, replacementNames: string[]) => {
        const legacyIndex = migrated.findIndex((entry) => entry.name === legacyName);
        if (legacyIndex < 0) return;
        const [legacy] = migrated.splice(legacyIndex, 1);
        for (const name of replacementNames) {
          if (migrated.some((entry) => entry.name === name)) continue;
          const preset = controllerPresets.get(name);
          if (preset) migrated.push({ ...preset, topic: legacy.topic || preset.topic, qos: legacy.qos });
        }
      };
      expandLegacyStatus("Input status", ["RF Remote sensor input", "Keypad sensor input", "Lamp module sensor input", "Exit sensor input", "Siren operated sensor input", "Open/close status input", "Outside safety sensor input", "Inside safety sensor input"]);
      expandLegacyStatus("Output status", ["Open safety output status", "Gate movement output", "Open signal output", "Stop signal output", "Close signal output", "Safety signal output", "Power relay output", "Liftmaster reset output"]);
      return migrated;
    })(),
    homeAssistantDiscoveryEnabled: discoveryEnabled,
    graphicTapAction: gate.graphicTapAction === "toggle" ? "toggle" : "pulse",
  };
}

export function cloneGate(gate: GateConfiguration): GateConfiguration {
  return {
    ...cloneData(gate),
    id: createId(),
    name: `${gate.name} (Copy)`,
  };
}

export function sortGates(gates: GateConfiguration[], sort: GateDisplayMode): GateConfiguration[] {
  return [...gates].sort((a, b) => {
    if (sort === "property") return a.property.localeCompare(b.property) || a.location.localeCompare(b.location) || a.name.localeCompare(b.name);
    return a.order - b.order;
  });
}

export function gateProperties(gates: GateConfiguration[]): string[] {
  return [...new Set(gates.map((gate) => gate.property.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function gatePropertyOptions(gates: GateConfiguration[]): Array<{ value: string; label: string }> {
  return gateProperties(gates).map((value) => {
    const aliasedGate = gates.find((gate) => gate.property.trim() === value && gate.propertyAlias?.trim());
    return { value, label: aliasedGate?.propertyAlias.trim() || value };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

export function gatePropertyLabel(gate: GateConfiguration): string {
  return gate.propertyAlias?.trim() || gate.property;
}

export function gateLocationLabel(gate: GateConfiguration): string {
  return gate.locationAlias?.trim() || gate.location;
}

export function gatesForProperty(gates: GateConfiguration[], property: string): GateConfiguration[] {
  return gates.filter((gate) => gate.property.trim() === property);
}

export function extractStatePayload(payload: string, mapping: StateMapping): string {
  if (mapping.format === "plain") return payload.trim();
  const root = JSON.parse(payload) as unknown;
  const value = mapping.jsonPath.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, root);
  return String(value ?? "").trim();
}

export function mapGateState(payload: string, mapping: StateMapping): GateState {
  const value = extractStatePayload(payload, mapping);
  const entries: Array<[GateState, string]> = [
    ["open", mapping.open],
    ["closed", mapping.closed],
    ["opening", mapping.opening],
    ["closing", mapping.closing],
    ["stopped", mapping.stopped],
  ];
  return entries.find(([, expected]) => value === expected)?.[0] ?? "unknown";
}
