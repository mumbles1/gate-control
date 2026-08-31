"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { AdditionalMQTTTopic, GateCommand, GateConfiguration, GateRuntimeState } from "./types";
import { brokerUrl, createId, mapControllerMovePayload, mapGateState, migrateBrokerSettings, readBinaryPayload, readControllerMoveValue } from "./types";

type RuntimeMap = Record<string, GateRuntimeState>;

const offlineRuntime = (): GateRuntimeState => ({ state: "offline", connected: false });

function installationId(): string {
  const key = "gate-control-installation";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = createId().replace(/-/g, "").slice(0, 12);
  localStorage.setItem(key, value);
  return value;
}

function poolKey(gate: GateConfiguration): string {
  const broker = migrateBrokerSettings(gate.broker);
  return [
    brokerUrl(broker).toLowerCase(),
    broker.username,
    broker.password,
    broker.clientId,
    broker.protocolVersion,
    broker.keepalive,
  ].join("|");
}

function connectionOptions(gate: GateConfiguration, suffix: string): IClientOptions {
  const broker = migrateBrokerSettings(gate.broker);
  return {
    username: broker.username || undefined,
    password: broker.password || undefined,
    clientId: broker.clientId || `gate-control-${installationId()}-${suffix}`,
    protocolVersion: broker.protocolVersion,
    keepalive: Math.max(15, broker.keepalive || 30),
    reconnectPeriod: 3_000,
    connectTimeout: 10_000,
    clean: true,
    resubscribe: true,
    rejectUnauthorized: broker.validateCertificate,
  };
}

export function useMQTTManager(gates: GateConfiguration[]) {
  const [runtime, setRuntime] = useState<RuntimeMap>({});
  const clients = useRef(new Map<string, MqttClient>());
  const cooldowns = useRef(new Map<string, number>());
  const brokerSignals = useRef(new Map<string, { ethernet?: boolean; wifi?: boolean }>());
  const controllerSignals = useRef(new Map<string, { move?: number; relay?: boolean }>());

  const updateGate = useCallback((id: string, update: Partial<GateRuntimeState>) => {
    setRuntime((current) => ({
      ...current,
      [id]: { ...(current[id] ?? offlineRuntime()), ...update },
    }));
  }, []);

  const updateBrokerSignal = useCallback((id: string, channel: "ethernet" | "wifi", online: boolean, at: number) => {
    const signals = { ...(brokerSignals.current.get(id) ?? {}), [channel]: online };
    brokerSignals.current.set(id, signals);
    const controllerOnline = signals.ethernet === true || signals.wifi === true;
    const controllerOffline = signals.ethernet === false && signals.wifi === false;
    setRuntime((current) => {
      const previous = current[id] ?? offlineRuntime();
      const connected = controllerOnline ? true : controllerOffline ? false : previous.connected;
      return {
        ...current,
        [id]: {
          ...previous,
          connected,
          state: connected ? (previous.state === "offline" ? "unknown" : previous.state) : "offline",
          lastMessageAt: at,
          error: controllerOffline ? "Controller reports Ethernet and Wi-Fi offline" : connected ? undefined : previous.error,
        },
      };
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const effectClients = clients.current;
    const pools = new Map<string, GateConfiguration[]>();
    for (const gate of gates) {
      const key = poolKey(gate);
      pools.set(key, [...(pools.get(key) ?? []), gate]);
    }

    const activeKeys = new Set(pools.keys());
    for (const [key, client] of clients.current) {
      if (!activeKeys.has(key)) {
        client.end(true);
        clients.current.delete(key);
      }
    }

    for (const [key, groupedGates] of pools) {
      if (clients.current.has(key)) continue;
      const representative = groupedGates[0];
      const broker = migrateBrokerSettings(representative.broker);
      if (broker.protocol === "mqtt") {
        for (const gate of groupedGates) updateGate(gate.id, { connected: false, state: "offline", error: "Raw MQTT is unavailable in web browsers; use WS or WSS" });
        continue;
      }
      const client = mqtt.connect(
        brokerUrl(broker),
        connectionOptions(representative, String(clients.current.size + 1)),
      );
      clients.current.set(key, client);

      const subscriptions = Array.from(
        new Set(groupedGates.flatMap((gate) => [gate.statusTopic, gate.availabilityTopic].filter(Boolean))),
      );
      const isObservedTopic = (entry: AdditionalMQTTTopic) => entry.direction === "subscribe"
        || entry.name === "Enable manual daylight savings"
        || entry.name === "Disable manual daylight savings";
      const advancedQos0 = Array.from(new Set(groupedGates.flatMap((gate) => (gate.advancedTopics ?? []).filter((entry) => isObservedTopic(entry) && entry.qos === 0 && entry.topic).map((entry) => entry.topic))));
      const advancedQos1 = Array.from(new Set(groupedGates.flatMap((gate) => (gate.advancedTopics ?? []).filter((entry) => isObservedTopic(entry) && entry.qos === 1 && entry.topic).map((entry) => entry.topic))));

      client.on("connect", () => {
        for (const gate of groupedGates) {
          brokerSignals.current.delete(gate.id);
          controllerSignals.current.delete(gate.id);
          updateGate(gate.id, { connected: true, state: "unknown", warning: undefined, error: undefined });
        }
        if (subscriptions.length) client.subscribe(subscriptions, { qos: 0 });
        if (advancedQos0.length) client.subscribe(advancedQos0, { qos: 0 });
        if (advancedQos1.length) client.subscribe(advancedQos1, { qos: 1 });
      });

      client.on("reconnect", () => {
        for (const gate of groupedGates) updateGate(gate.id, { connected: false, state: "offline", error: "Reconnecting…" });
      });

      client.on("offline", () => {
        for (const gate of groupedGates) updateGate(gate.id, { connected: false, state: "offline" });
      });

      client.on("error", (error) => {
        const detail = error instanceof Error && error.message ? error.message.replace(/\s+/g, " ").slice(0, 160) : "Unknown connection error";
        for (const gate of groupedGates) updateGate(gate.id, { connected: false, state: "offline", error: `Broker connection failed: ${detail}` });
      });

      client.on("message", (topic, buffer) => {
        const payload = buffer.toString("utf8");
        const now = Date.now();
        for (const gate of groupedGates) {
          const brokerStatus = (gate.advancedTopics ?? []).find((entry) => entry.topic === topic);
          const subscribedSignals = (gate.advancedTopics ?? []).filter((entry) => entry.direction === "subscribe" && entry.topic === topic);
          const daylightOn = (gate.advancedTopics ?? []).find((entry) => entry.name === "Enable manual daylight savings" && entry.topic === topic);
          const daylightOff = (gate.advancedTopics ?? []).find((entry) => entry.name === "Disable manual daylight savings" && entry.topic === topic);
          if (subscribedSignals.length > 0) {
            setRuntime((current) => {
              const previous = current[gate.id] ?? offlineRuntime();
              const receivedSignals = Object.fromEntries(subscribedSignals.map((signal) => [signal.id, { name: signal.name, payload: payload.slice(0, 500), at: now }]));
              return {
                ...current,
                [gate.id]: {
                  ...previous,
                  lastMessageAt: now,
                  mqttSignals: {
                    ...(previous.mqttSignals ?? {}),
                    ...receivedSignals,
                  },
                },
              };
            });
            const normalizedTopic = topic.replace(/^\/+|\/+$/g, "");
            const isInputStatus = normalizedTopic.endsWith("/IO_Status/Inputs");
            const isOutputStatus = normalizedTopic.endsWith("/IO_Status/Outputs");
            if (isInputStatus || isOutputStatus) {
              const signals = { ...(controllerSignals.current.get(gate.id) ?? {}) };
              if (isInputStatus) {
                const relay = readBinaryPayload(payload, "Relay");
                if (relay !== undefined) signals.relay = relay;
              }
              if (isOutputStatus) {
                const move = readControllerMoveValue(payload);
                if (move !== undefined) signals.move = move;
              }
              controllerSignals.current.set(gate.id, signals);
              const controllerState = isOutputStatus
                ? mapControllerMovePayload(payload, signals.relay)
                : signals.move === 0 && signals.relay !== undefined
                  ? (signals.relay ? "open" : "closed")
                  : undefined;
              updateGate(gate.id, {
                ...(controllerState ? { state: controllerState } : {}),
                connected: true,
                lastMessageAt: now,
                warning: signals.move === 0 ? "Inside safety beam is blocked" : undefined,
                error: undefined,
              });
            }
          }
          if (daylightOn && daylightOff && (payload === daylightOn.payload || payload === daylightOff.payload)) {
            setRuntime((current) => {
              const previous = current[gate.id] ?? offlineRuntime();
              return {
                ...current,
                [gate.id]: {
                  ...previous,
                  lastMessageAt: now,
                  mqttSignals: {
                    ...(previous.mqttSignals ?? {}),
                    [daylightOn.id]: { name: "Manual daylight savings command", payload, at: now },
                  },
                },
              };
            });
          }
          const brokerChannel = brokerStatus?.topic.replace(/^\/+|\/+$/g, "").endsWith("/Broker/Eth")
            ? "ethernet"
            : brokerStatus?.topic.replace(/^\/+|\/+$/g, "").endsWith("/Broker/WiFi") ? "wifi" : undefined;
          if (brokerChannel) {
            const online = readBinaryPayload(payload, "LWT");
            if (online !== undefined) updateBrokerSignal(gate.id, brokerChannel, online, now);
          }
          if (topic === gate.availabilityTopic) {
            const value = payload.trim();
            if (value === gate.mapping.unavailable) updateGate(gate.id, { state: "offline", connected: true, lastMessageAt: now });
            else if (value === gate.mapping.available) updateGate(gate.id, { connected: true, lastMessageAt: now, error: undefined });
          }
          if (topic === gate.statusTopic) {
            try {
              updateGate(gate.id, { state: mapGateState(payload, gate.mapping), connected: true, lastMessageAt: now, error: undefined });
            } catch {
              updateGate(gate.id, { state: "unknown", connected: true, lastMessageAt: now, error: "Status payload could not be parsed" });
            }
          }
        }
      });
    }

    return () => {
      for (const client of effectClients.values()) client.end(true);
      effectClients.clear();
    };
  }, [gates, updateBrokerSignal, updateGate]);

  const publish = useCallback(async (gate: GateConfiguration, command: GateCommand) => {
    const key = poolKey(gate);
    const client = clients.current.get(key);
    const now = Date.now();
    const cooldownKey = `${gate.id}:${command}`;
    if ((cooldowns.current.get(cooldownKey) ?? 0) > now) {
      updateGate(gate.id, { lastPublish: { ok: false, message: "Please wait before sending again", at: now } });
      return false;
    }
    if (!client?.connected) {
      updateGate(gate.id, { lastPublish: { ok: false, message: "Gate is offline—action not sent", at: now } });
      return false;
    }
    cooldowns.current.set(cooldownKey, now + 1_500);
    const action = gate.actions[command];
    try {
      await new Promise<void>((resolve, reject) => {
        client.publish(action.topic, action.payload, { qos: gate.qos, retain: false }, (error) => error ? reject(error) : resolve());
      });
      navigator.vibrate?.(20);
      updateGate(gate.id, { lastPublish: { ok: true, message: `${command[0].toUpperCase()}${command.slice(1)} sent`, at: Date.now() } });
      return true;
    } catch {
      updateGate(gate.id, { lastPublish: { ok: false, message: "Publish failed—state unchanged", at: Date.now() } });
      return false;
    }
  }, [updateGate]);

  const publishAdvanced = useCallback(async (gate: GateConfiguration, action: AdditionalMQTTTopic, options?: { bypassCooldown?: boolean }) => {
    const key = poolKey(gate);
    const client = clients.current.get(key);
    const now = Date.now();
    const cooldownKey = `${gate.id}:advanced:${action.id}`;
    if (!options?.bypassCooldown && (cooldowns.current.get(cooldownKey) ?? 0) > now) {
      updateGate(gate.id, { lastPublish: { ok: false, message: "Please wait before sending again", at: now } });
      return false;
    }
    if (action.direction !== "publish" || !client?.connected) {
      updateGate(gate.id, { lastPublish: { ok: false, message: "Gate is offline鈥攁ction not sent", at: now } });
      return false;
    }
    if (!options?.bypassCooldown) cooldowns.current.set(cooldownKey, now + 1_500);
    try {
      await new Promise<void>((resolve, reject) => {
        client.publish(action.topic, action.payload, { qos: action.qos, retain: false }, (error) => error ? reject(error) : resolve());
      });
      navigator.vibrate?.(20);
      updateGate(gate.id, { lastPublish: { ok: true, message: `${action.name} sent`, at: Date.now() } });
      return true;
    } catch {
      updateGate(gate.id, { lastPublish: { ok: false, message: "Publish failed鈥攕tate unchanged", at: Date.now() } });
      return false;
    }
  }, [updateGate]);

  return { runtime, publish, publishAdvanced };
}

export function testGateConnection(gate: GateConfiguration): Promise<string> {
  const broker = migrateBrokerSettings(gate.broker);
  if (broker.protocol === "mqtt") return Promise.reject(new Error("Raw mqtt:// connections are unavailable in web browsers. Select ws:// or wss://."));
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl(broker), {
      ...connectionOptions(gate, "test"),
      reconnectPeriod: 0,
      connectTimeout: 8_000,
      clientId: gate.broker.clientId ? `${gate.broker.clientId}-test` : `gate-control-test-${createId().slice(0, 8)}`,
    });
    let settled = false;
    const finish = (error?: Error, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      if (error) reject(error);
      else resolve(message ?? "Connected and subscribed successfully.");
    };
    const timer = window.setTimeout(() => finish(new Error("Connection test timed out.")), 10_000);
    client.once("connect", () => {
      const topics = Array.from(new Set([
        gate.statusTopic,
        gate.availabilityTopic,
        ...(gate.advancedTopics ?? []).filter((entry) => entry.direction === "subscribe").map((entry) => entry.topic),
      ].filter(Boolean)));
      client.subscribe(topics, { qos: 0 }, (error) => {
        if (error) finish(new Error("Connected, but could not subscribe to the configured topics."));
        else window.setTimeout(() => finish(undefined, "Connected and subscribed. No configured topic message arrived during the test window."), 2_500);
      });
    });
    client.once("message", (topic, payload) => {
      const signal = (gate.advancedTopics ?? []).find((entry) => entry.topic === topic);
      const label = topic === gate.statusTopic ? "Status" : topic === gate.availabilityTopic ? "Availability" : signal?.name ?? topic;
      finish(undefined, `Connected. ${label}: ${payload.toString("utf8").slice(0, 120)}`);
    });
    client.once("error", () => finish(new Error("Broker rejected the connection. Check the URL and credentials.")));
  });
}
