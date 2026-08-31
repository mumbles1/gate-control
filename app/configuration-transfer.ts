"use client";

import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import QRCode from "qrcode";
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { ColorTheme, DashboardLayout, GateConfiguration, GateDisplayMode } from "./types";
import { brokerUrl, createId } from "./types";

export interface TransferSettings {
  layout: DashboardLayout;
  theme: ColorTheme;
  displayMode: GateDisplayMode;
  defaultProperty: string;
  notificationContactEmail: string;
  controllerOfflineDelaySeconds: number;
  mqttTransferTopic: string;
  mqttTransferRetain: boolean;
}

export interface ConfigurationBundle {
  format: "gate-control-configuration";
  version: 1;
  scope?: "app" | "gate";
  exportedAt: string;
  gates: GateConfiguration[];
  settings: TransferSettings;
}

interface GateTransferResponse {
  token: string;
  expiresAt: number;
}

interface EncryptedEnvelope {
  format: "gate-control-encrypted-configuration";
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ITERATIONS = 250_000;

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function transferKey(passphrase: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey("raw", asArrayBuffer(textEncoder.encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: asArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

async function portableTransferKey(passphrase: string, salt: Uint8Array, iterations: number) {
  return pbkdf2Async(sha256, textEncoder.encode(passphrase), salt, { c: iterations, dkLen: 32, asyncTick: 8 });
}

export async function encryptConfiguration(bundle: ConfigurationBundle, passphrase: string): Promise<string> {
  if (passphrase.length < 8) throw new Error("Transfer passphrase must contain at least 8 characters.");
  if (!globalThis.crypto?.getRandomValues) throw new Error("This browser cannot securely create encrypted transfers.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cleartext = textEncoder.encode(JSON.stringify(bundle));
  const ciphertext = globalThis.crypto.subtle
    ? new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, await transferKey(passphrase, salt, ITERATIONS, ["encrypt"]), asArrayBuffer(cleartext)))
    : gcm(await portableTransferKey(passphrase, salt, ITERATIONS), iv).encrypt(cleartext);
  const envelope: EncryptedEnvelope = {
    format: "gate-control-encrypted-configuration",
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
  return JSON.stringify(envelope);
}

export async function decryptConfiguration(value: string, passphrase: string): Promise<ConfigurationBundle> {
  if (passphrase.length < 8) throw new Error("Enter the transfer passphrase used when the configuration was published or exported.");
  try {
    const envelope = JSON.parse(value) as EncryptedEnvelope;
    if (envelope.format !== "gate-control-encrypted-configuration" || envelope.version !== 1 || envelope.kdf !== "PBKDF2-SHA256") throw new Error("Unsupported configuration format.");
    if (!Number.isInteger(envelope.iterations) || envelope.iterations < 100_000 || envelope.iterations > 1_000_000) throw new Error("Invalid encryption settings.");
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const encrypted = base64ToBytes(envelope.ciphertext);
    const clear = globalThis.crypto?.subtle
      ? new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, await transferKey(passphrase, salt, envelope.iterations, ["decrypt"]), asArrayBuffer(encrypted)))
      : gcm(await portableTransferKey(passphrase, salt, envelope.iterations), iv).decrypt(encrypted);
    const bundle = JSON.parse(textDecoder.decode(clear)) as ConfigurationBundle;
    if (bundle.format !== "gate-control-configuration" || bundle.version !== 1 || !Array.isArray(bundle.gates) || bundle.gates.length > 100 || !bundle.settings) throw new Error("Invalid Gate Control configuration.");
    return bundle;
  } catch (error) {
    if (error instanceof Error && /passphrase|format|configuration|encryption/.test(error.message)) throw error;
    throw new Error("Could not decrypt the configuration. Check the passphrase and file or MQTT payload.");
  }
}

export function downloadConfiguration(payload: string) {
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gate-control-${new Date().toISOString().slice(0, 10)}.gateconfig`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
}

export async function shareConfiguration(payload: string): Promise<"shared" | "downloaded"> {
  const file = new File([payload], `gate-control-${new Date().toISOString().slice(0, 10)}.gateconfig`, { type: "application/json" });
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title: "Gate Control configuration", text: "Encrypted Gate Control configuration", files: [file] });
    return "shared";
  }
  downloadConfiguration(payload);
  return "downloaded";
}

async function transferApi(body: unknown) {
  const response = await fetch("/api/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The secure transfer service is unavailable.");
  return result;
}

export async function createGateTransfer(payload: string): Promise<GateTransferResponse> {
  const result = await transferApi({ action: "create-transfer", payload });
  return { token: String(result.token || ""), expiresAt: Number(result.expiresAt || 0) };
}

export async function loadGateTransfer(token: string): Promise<string> {
  const result = await transferApi({ action: "get-transfer", token });
  return String(result.payload || "");
}

export function gateTransferUrl(token: string) {
  return `${window.location.origin}/?gateTransfer=${encodeURIComponent(token)}`;
}

export function gateTransferQRCode(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 340, margin: 2, errorCorrectionLevel: "M", color: { dark: "#102831", light: "#ffffff" } });
}

function transferOptions(gate: GateConfiguration): IClientOptions {
  return {
    username: gate.broker.username || undefined,
    password: gate.broker.password || undefined,
    clientId: `gate-control-transfer-${createId().replace(/-/g, "").slice(0, 12)}`,
    protocolVersion: gate.broker.protocolVersion,
    keepalive: Math.max(15, gate.broker.keepalive || 30),
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    clean: true,
    rejectUnauthorized: gate.broker.validateCertificate,
  };
}

function openTransferClient(gate: GateConfiguration): MqttClient {
  if (gate.broker.protocol === "mqtt") throw new Error("Configuration transfer in a web browser requires a WS or WSS broker connection.");
  return mqtt.connect(brokerUrl(gate.broker), transferOptions(gate));
}

export function publishConfigurationToMQTT(gate: GateConfiguration, topic: string, payload: string, retain: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let client: MqttClient;
    try { client = openTransferClient(gate); } catch (error) { reject(error); return; }
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      client.end(true);
      if (error) reject(error); else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error("MQTT configuration publish timed out.")), 15_000);
    client.once("error", () => finish(new Error("The configuration broker rejected the connection.")));
    client.once("connect", () => {
      const publishBundle = () => client.publish(topic, payload, { qos: 1, retain }, (error) => finish(error || undefined));
      if (retain) publishBundle();
      else client.publish(topic, "", { qos: 1, retain: true }, (error) => error ? finish(error) : publishBundle());
    });
  });
}

export function loadConfigurationFromMQTT(gate: GateConfiguration, topic: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let client: MqttClient;
    try { client = openTransferClient(gate); } catch (error) { reject(error); return; }
    let settled = false;
    const finish = (error?: Error, payload?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      client.end(true);
      if (error) reject(error); else resolve(payload || "");
    };
    const timer = window.setTimeout(() => finish(new Error("No retained configuration was received from this MQTT topic.")), 12_000);
    client.once("error", () => finish(new Error("The configuration broker rejected the connection.")));
    client.once("connect", () => client.subscribe(topic, { qos: 1 }, (error) => { if (error) finish(new Error("Could not subscribe to the configuration topic.")); }));
    client.on("message", (receivedTopic, buffer) => {
      if (receivedTopic !== topic || !buffer.length) return;
      finish(undefined, buffer.toString("utf8"));
    });
  });
}
