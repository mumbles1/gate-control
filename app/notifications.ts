import type { GateConfiguration } from "./types";
import { createId } from "./types";

export type ScheduleAlertState = "unsupported" | "disabled" | "enabled" | "denied" | "unavailable";
export interface AlertIdentity { deviceId: string; secret: string; }

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createAlertIdentity(): AlertIdentity {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  return { deviceId: createId(), secret: base64Url(bytes) };
}

function applicationKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function supported() {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function api(body?: unknown) {
  const response = await fetch("/api/alerts", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Schedule alert service failed.");
  return result;
}

export async function scheduleAlertState(enabled: boolean): Promise<ScheduleAlertState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (!enabled) return "disabled";
  const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  return subscription ? "enabled" : "unavailable";
}

export async function enableScheduleAlerts(gates: GateConfiguration[], identity: AlertIdentity, contactEmail: string, controllerOfflineDelaySeconds: number) {
  if (!supported()) throw new Error("Install Gate Control to the Home Screen and open it using HTTPS to enable notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey) });
  return api({ action: "sync", ...identity, contactEmail, controllerOfflineDelaySeconds, subscription: subscription.toJSON(), gates });
}

export async function syncScheduleAlerts(gates: GateConfiguration[], identity: AlertIdentity, contactEmail: string, controllerOfflineDelaySeconds: number) {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (!subscription) return;
  await api({ action: "sync", ...identity, contactEmail, controllerOfflineDelaySeconds, subscription: subscription.toJSON(), gates });
}

export async function disableScheduleAlerts(identity: AlertIdentity) {
  let warning: Error | undefined;
  try { await api({ action: "disable", ...identity }); }
  catch (error) { warning = error instanceof Error ? error : new Error("The notification service could not be reached."); }
  if (supported()) await (await navigator.serviceWorker.ready).pushManager.getSubscription().then((subscription) => subscription?.unsubscribe());
  return warning?.message;
}

export async function testScheduleAlert(identity: AlertIdentity) {
  await api({ action: "test", ...identity });
}
