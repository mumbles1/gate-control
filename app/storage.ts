import type { ColorTheme, DashboardLayout, GateConfiguration, GateDisplayMode } from "./types";
import { migrateGate } from "./types";
import type { AlertIdentity } from "./notifications";

const DB_NAME = "gate-control";
const STORE_NAME = "settings";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readValue<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openDatabase();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return fallback;
  }
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export const gateStorage = {
  loadGates: async () => (await readValue<GateConfiguration[]>("gates", [])).map(migrateGate),
  saveGates: (gates: GateConfiguration[]) => writeValue("gates", gates),
  loadLayout: () => readValue<DashboardLayout>("layout", "cards"),
  saveLayout: (layout: DashboardLayout) => writeValue("layout", layout),
  loadTheme: async () => {
    const theme = await readValue<ColorTheme>("theme", "system");
    try { localStorage.setItem("gate-control-theme", theme); } catch { /* storage can be unavailable in private mode */ }
    return theme;
  },
  saveTheme: (theme: ColorTheme) => {
    try { localStorage.setItem("gate-control-theme", theme); } catch { /* storage can be unavailable in private mode */ }
    return writeValue("theme", theme);
  },
  loadDisplayMode: () => readValue<GateDisplayMode>("displayMode", "all"),
  saveDisplayMode: (mode: GateDisplayMode) => writeValue("displayMode", mode),
  loadDefaultProperty: () => readValue<string>("defaultProperty", ""),
  saveDefaultProperty: (property: string) => writeValue("defaultProperty", property),
  loadActiveProperty: () => readValue<string>("activeProperty", ""),
  saveActiveProperty: (property: string) => writeValue("activeProperty", property),
  loadScheduleAlertsEnabled: () => readValue<boolean>("scheduleAlertsEnabled", false),
  saveScheduleAlertsEnabled: (enabled: boolean) => writeValue("scheduleAlertsEnabled", enabled),
  loadAlertIdentity: () => readValue<AlertIdentity | null>("alertIdentity", null),
  saveAlertIdentity: (identity: AlertIdentity) => writeValue("alertIdentity", identity),
  loadNotificationContactEmail: () => readValue<string>("notificationContactEmail", ""),
  saveNotificationContactEmail: (email: string) => writeValue("notificationContactEmail", email),
  loadControllerOfflineDelay: () => readValue<number>("controllerOfflineDelaySeconds", 15),
  saveControllerOfflineDelay: (seconds: number) => writeValue("controllerOfflineDelaySeconds", seconds),
  loadMQTTTransferTopic: () => readValue<string>("mqttTransferTopic", ""),
  saveMQTTTransferTopic: (topic: string) => writeValue("mqttTransferTopic", topic),
  loadMQTTTransferRetain: () => readValue<boolean>("mqttTransferRetain", true),
  saveMQTTTransferRetain: (retain: boolean) => writeValue("mqttTransferRetain", retain),
  loadMQTTTransferGateId: () => readValue<string>("mqttTransferGateId", ""),
  saveMQTTTransferGateId: (gateId: string) => writeValue("mqttTransferGateId", gateId),
};
