"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CalendarDays, ChevronRight, CircleDot, Clock3, Copy, Send, Square,
  Gauge, LayoutGrid, List, Menu, Monitor, Moon, Plus, Radio, Settings, SlidersHorizontal,
  Sun, Trash2, Wifi, WifiOff, X,
} from "lucide-react";
import { GateArtwork } from "./GateArtwork";
import { GateEditor } from "./GateEditor";
import { useMQTTManager } from "./mqtt-service";
import { gateStorage } from "./storage";
import type { AdditionalMQTTTopic, ColorTheme, DashboardLayout, GateConfiguration, GateDisplayMode, GateRuntimeState, GateState } from "./types";
import { brokerUrl, cloneData, cloneGate, defaultGate, formatControllerTime12h, gateLocationLabel, gatePropertyLabel, gatePropertyOptions, gatesForProperty, schedulePayload, sortGates } from "./types";

type Screen =
  | { name: "dashboard" }
  | { name: "setup" }
  | { name: "appSettings" }
  | { name: "detail"; gateId: string }
  | { name: "editor"; gate: GateConfiguration; cloneDraft?: boolean; advanced?: boolean };

const stateLabels: Record<GateState, string> = {
  open: "Open",
  closed: "Closed",
  opening: "Moving — opening",
  closing: "Moving — closing",
  stopped: "Stopped halfway",
  unknown: "Status unknown",
  offline: "Offline",
};

function GateBrandIcon() {
  return <img className="gate-brand-icon" src="/gate-icon.svg" alt="" aria-hidden="true" />;
}

function formatAge(timestamp?: number) {
  if (!timestamp) return "No status received";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

function ConnectionBadge({ runtime }: { runtime: GateRuntimeState }) {
  return <span className={`connection-badge ${runtime.connected ? "connection-badge--online" : "connection-badge--offline"}`}>{runtime.connected ? <Wifi /> : <WifiOff />}{runtime.connected ? "Connected" : "Offline"}</span>;
}

function JogControls({ gate, runtime, stopAction, onPublish, onStop }: {
  gate: GateConfiguration;
  runtime: GateRuntimeState;
  stopAction: AdditionalMQTTTopic;
  onPublish: (gate: GateConfiguration, command: "open" | "close") => Promise<boolean>;
  onStop: (gate: GateConfiguration, action: AdditionalMQTTTopic, options?: { bypassCooldown?: boolean }) => Promise<boolean>;
}) {
  const activeRef = useRef<"open" | "close" | null>(null);
  const [active, setActive] = useState<"open" | "close" | null>(null);
  const release = () => {
    if (!activeRef.current) return;
    activeRef.current = null;
    setActive(null);
    void onStop(gate, stopAction, { bypassCooldown: true });
  };
  useEffect(() => {
    const releaseOnHidden = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", releaseOnHidden);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", releaseOnHidden);
      release();
    };
  }, [gate, stopAction, onStop]);
  const begin = (direction: "open" | "close") => {
    if (!runtime.connected || activeRef.current) return;
    activeRef.current = direction;
    setActive(direction);
    void onPublish(gate, direction);
  };
  return <div className="jog-controls">
    <p className="control-label">Press and hold</p>
    <div className="control-buttons control-buttons--jog">
      {(["open", "close"] as const).map((direction) => <button
        type="button"
        className={`${direction === "open" ? "control-open" : "control-close"}${active === direction ? " jog-button--active" : ""}`}
        key={direction}
        aria-pressed={active === direction}
        aria-label={`Jog ${direction}; hold to ${direction} and release to stop`}
        disabled={!runtime.connected}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); begin(direction); }}
        onPointerUp={(event) => { event.preventDefault(); release(); }}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); begin(direction); } }}
        onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); release(); } }}
        onBlur={release}
      >{direction === "open" ? <ArrowUp /> : <ArrowDown />}<span>Jog {direction === "open" ? "Open" : "Close"}</span></button>)}
    </div>
    <p className="jog-help">Hold to move. Releasing, canceling, hiding, or leaving the app sends Stop.</p>
  </div>;
}

function timerValue(payload: string | undefined, keys: string[]): unknown {
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(payload) as unknown;
    const normalizedKeys = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
    const findValue = (value: unknown): unknown => {
      if (!value || typeof value !== "object") return undefined;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (normalizedKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) return child;
      }
      for (const child of Object.values(value as Record<string, unknown>)) {
        const nested = findValue(child);
        if (nested !== undefined) return nested;
      }
      return undefined;
    };
    return findValue(decoded);
  } catch {
    // Some installed controllers append a malformed field after otherwise valid
    // Date/Time values (for example `"DST"":0`). Recover the requested scalar.
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = payload.match(new RegExp(`["']*${escaped}["']*\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^,}\\s]+))`, "i"));
      if (match) return match[1] ?? match[2] ?? match[3];
    }
    return undefined;
  }
}

function AutoTimerCard({ gate, runtime, onPublish }: { gate: GateConfiguration; runtime: GateRuntimeState; onPublish: (gate: GateConfiguration, action: AdditionalMQTTTopic) => Promise<boolean> }) {
  const [picker, setPicker] = useState<{ action: AdditionalMQTTTopic; label: string; hour: string; minute: string; period: "AM" | "PM" } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(false);
  const [timerCommandAt, setTimerCommandAt] = useState(0);
  const [constantPublishing, setConstantPublishing] = useState(false);
  const [localDaylightSavings, setLocalDaylightSavings] = useState(false);
  const [daylightCommandAt, setDaylightCommandAt] = useState(0);
  const action = (name: string) => gate.advancedTopics.find((entry) => entry.direction === "publish" && entry.name === name);
  const signalFor = (entry: AdditionalMQTTTopic | undefined, name: string) => entry
    ? runtime.mqttSignals?.[entry.id] ?? Object.values(runtime.mqttSignals ?? {}).find((signal) => signal.name === name)
    : Object.values(runtime.mqttSignals ?? {}).find((signal) => signal.name === name);
  const statusEntry = gate.advancedTopics.find((entry) => entry.direction === "subscribe" && entry.name === "Automatic timer status");
  const statusSignal = signalFor(statusEntry, "Automatic timer status");
  const statusPayload = statusSignal?.payload;
  const rtcDateEntry = gate.advancedTopics.find((entry) => entry.direction === "subscribe" && entry.name === "RTC Date");
  const rtcTimeEntry = gate.advancedTopics.find((entry) => entry.direction === "subscribe" && entry.name === "RTC Time");
  const daylightSavingsEntry = gate.advancedTopics.find((entry) => entry.direction === "subscribe" && entry.name === "Manual daylight savings status");
  const rtcSignal = signalFor(rtcDateEntry, "RTC Date") ?? signalFor(rtcTimeEntry, "RTC Time") ?? signalFor(daylightSavingsEntry, "Manual daylight savings status");
  const rtcPayload = rtcSignal?.payload;
  const openAction = action("Automatic open time");
  const closeAction = action("Automatic close time");
  const enableAction = action("Enable automatic timer");
  const disableAction = action("Disable automatic timer");
  const enableConstantPublishing = action("Enable constant publishing");
  const disableConstantPublishing = action("Disable constant publishing");
  const enableDaylightSavings = action("Enable manual daylight savings");
  const disableDaylightSavings = action("Disable manual daylight savings");
  if (!statusEntry && !rtcDateEntry && !openAction && !closeAction && !enableAction) return null;

  const statusValue = timerValue(statusPayload, ["Status"]);
  const reportedEnabled = statusValue === 1 || statusValue === "1" ? true : statusValue === 0 || statusValue === "0" ? false : undefined;
  const waitingForTimerStatus = Boolean(timerCommandAt && (statusSignal?.at ?? 0) <= timerCommandAt);
  const enabled = waitingForTimerStatus ? localEnabled : reportedEnabled ?? localEnabled;
  const currentOpen = formatControllerTime12h(timerValue(statusPayload, ["Open", "OpenTime", "Open_Time"]));
  const currentClose = formatControllerTime12h(timerValue(statusPayload, ["Close", "CloseTime", "Close_Time"]));
  const rtcDate = timerValue(rtcPayload, ["Date"]);
  const rtcTime = formatControllerTime12h(timerValue(rtcPayload, ["Time"]));
  const daylightValue = timerValue(rtcPayload, ["DST"]);
  const rtcDaylightSavings = daylightValue === 1 || daylightValue === "1" ? true : daylightValue === 0 || daylightValue === "0" ? false : undefined;
  const daylightCommandSignal = enableDaylightSavings ? runtime.mqttSignals?.[enableDaylightSavings.id] : undefined;
  const commandDaylightSavings = daylightCommandSignal?.payload === enableDaylightSavings?.payload ? true : daylightCommandSignal?.payload === disableDaylightSavings?.payload ? false : undefined;
  const reportedDaylightSavings = daylightCommandSignal && daylightCommandSignal.at > (rtcSignal?.at ?? 0) ? commandDaylightSavings : rtcDaylightSavings;
  const latestDaylightSignalAt = Math.max(rtcSignal?.at ?? 0, daylightCommandSignal?.at ?? 0);
  const waitingForDaylightStatus = Boolean(daylightCommandAt && latestDaylightSignalAt <= daylightCommandAt);
  const daylightSavings = waitingForDaylightStatus ? localDaylightSavings : reportedDaylightSavings ?? localDaylightSavings;

  const openPicker = (entry: AdditionalMQTTTopic, label: string) => {
    const now = new Date();
    const saved = entry.payload.trim();
    let hour24 = now.getHours();
    let minute = now.getMinutes();
    if (/^\d{4}$/.test(saved) && Number(saved.slice(0, 2)) <= 23 && Number(saved.slice(2)) <= 59) {
      hour24 = Number(saved.slice(0, 2));
      minute = Number(saved.slice(2));
    }
    setPicker({ action: entry, label, hour: String(hour24 % 12 || 12), minute: String(minute).padStart(2, "0"), period: hour24 >= 12 ? "PM" : "AM" });
  };
  const publishTime = async () => {
    if (!picker) return;
    const hour = Number(picker.hour);
    const minute = Number(picker.minute);
    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return;
    setPublishing(true);
    const ok = await onPublish(gate, { ...picker.action, payload: schedulePayload(hour, minute, picker.period) });
    setPublishing(false);
    if (ok) setPicker(null);
  };
  const toggleTimer = async () => {
    const selected = enabled ? disableAction : enableAction;
    const requestedAt = Date.now();
    if (selected && await onPublish(gate, selected)) {
      setLocalEnabled(!enabled);
      setTimerCommandAt(requestedAt);
    }
  };
  const toggleConstantPublishing = async () => {
    const selected = constantPublishing ? disableConstantPublishing : enableConstantPublishing;
    if (selected && await onPublish(gate, selected)) setConstantPublishing(!constantPublishing);
  };
  const toggleDaylightSavings = async () => {
    const selected = daylightSavings ? disableDaylightSavings : enableDaylightSavings;
    const requestedAt = Date.now();
    if (selected && await onPublish(gate, selected)) {
      setLocalDaylightSavings(!daylightSavings);
      setDaylightCommandAt(requestedAt);
    }
  };

  return <>
    <section className="auto-timer-card" aria-label="Auto Open Close Timer">
      <header><div><p className="eyebrow">Auto open/close timer</p><h2>Gate schedule</h2></div>{statusEntry && <span className="timer-topic">{statusEntry.topic}</span>}</header>
      <div className="rtc-grid"><div><CalendarDays /><span>RTC Date</span><strong>{rtcDate ? String(rtcDate) : "Waiting for controller"}</strong></div><div><Clock3 /><span>RTC Time</span><strong>{rtcTime}</strong></div></div>
      <div className="timer-time-grid">
        <article><span>Current Open time</span><strong>{currentOpen}</strong>{openAction && <button type="button" onClick={() => openPicker(openAction, "Open time")}><Clock3 />Set Open time</button>}</article>
        <article><span>Current Close time</span><strong>{currentClose}</strong>{closeAction && <button type="button" onClick={() => openPicker(closeAction, "Close time")}><Clock3 />Set Close time</button>}</article>
      </div>
      <div className="timer-switch-grid">
        {enableAction && disableAction && <button type="button" role="switch" aria-checked={enabled} className={enabled ? "controller-switch controller-switch--on timer-enable-switch" : "controller-switch timer-enable-switch"} onClick={() => void toggleTimer()} disabled={!runtime.connected}><span><strong>Auto Open/Close</strong><small>{enabled ? "Enabled" : "Disabled"}{waitingForTimerStatus ? " · Waiting for status" : ""}</small></span><i aria-hidden="true" /></button>}
        {enableConstantPublishing && disableConstantPublishing && <button type="button" role="switch" aria-checked={constantPublishing} className={constantPublishing ? "controller-switch controller-switch--on timer-enable-switch" : "controller-switch timer-enable-switch"} onClick={() => void toggleConstantPublishing()} disabled={!runtime.connected}><span><strong>Constant publishing</strong><small>{constantPublishing ? "On" : "Off"}</small></span><i aria-hidden="true" /></button>}
        {enableDaylightSavings && disableDaylightSavings && <button type="button" role="switch" aria-checked={daylightSavings} className={daylightSavings ? "controller-switch controller-switch--on timer-enable-switch" : "controller-switch timer-enable-switch"} onClick={() => void toggleDaylightSavings()} disabled={!runtime.connected}><span><strong>Manual daylight savings</strong><small>{daylightSavings ? "On" : "Off"}{waitingForDaylightStatus ? " · Waiting for status" : ""}</small></span><i aria-hidden="true" /></button>}
      </div>
    </section>
    {picker && <div className="schedule-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPicker(null); }}><section className="schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-schedule-title"><header><div><p className="eyebrow">Auto open/close timer</p><h2 id="detail-schedule-title">Set {picker.label}</h2></div><button className="icon-button" type="button" onClick={() => setPicker(null)} aria-label="Close time picker"><X /></button></header><p className="schedule-help">Enter a 12-hour time. The published MQTT payload is four-digit 24-hour time.</p><div className="schedule-keypad"><label><span>Hour</span><input autoFocus type="number" inputMode="numeric" min="1" max="12" aria-label="Schedule hour" value={picker.hour} onChange={(event) => setPicker({ ...picker, hour: event.target.value })} /></label><span className="schedule-colon">:</span><label><span>Minute</span><input type="number" inputMode="numeric" min="0" max="59" aria-label="Schedule minute" value={picker.minute} onChange={(event) => setPicker({ ...picker, minute: event.target.value })} /></label><div className="schedule-period"><button type="button" className={picker.period === "AM" ? "active" : ""} onClick={() => setPicker({ ...picker, period: "AM" })}>AM</button><button type="button" className={picker.period === "PM" ? "active" : ""} onClick={() => setPicker({ ...picker, period: "PM" })}>PM</button></div></div><div className="schedule-preview"><span>MQTT payload</span><code>{schedulePayload(Number(picker.hour), Number(picker.minute), picker.period)}</code></div><button className="primary-button schedule-confirm" type="button" disabled={publishing || !runtime.connected} onClick={() => void publishTime()}><Send />{publishing ? "Publishing…" : `Publish ${picker.label}`}</button></section></div>}
  </>;
}

function AppNav({ screen, onDashboard, onSetup, onAppSettings }: { screen: Screen; onDashboard: () => void; onSetup: () => void; onAppSettings: () => void }) {
  return (
    <nav className="app-nav" aria-label="Primary navigation">
      <button className={screen.name === "dashboard" || screen.name === "detail" ? "active" : ""} onClick={onDashboard}><Gauge /><span>Gates</span></button>
      <button className={screen.name === "setup" || screen.name === "editor" ? "active" : ""} onClick={onSetup}><SlidersHorizontal /><span>Gate setup</span></button>
      <button className={screen.name === "appSettings" ? "active" : ""} onClick={onAppSettings}><Settings /><span>App</span></button>
    </nav>
  );
}

export function GateControlApp() {
  const [gates, setGates] = useState<GateConfiguration[]>([]);
  const [layout, setLayout] = useState<DashboardLayout>("cards");
  const [theme, setTheme] = useState<ColorTheme>("system");
  const [displayMode, setDisplayMode] = useState<GateDisplayMode>("all");
  const [defaultProperty, setDefaultProperty] = useState("");
  const [activeProperty, setActiveProperty] = useState("");
  const [screen, setScreen] = useState<Screen>({ name: "dashboard" });
  const [loaded, setLoaded] = useState(false);
  const detailOpenedAt = useRef(0);
  const { runtime, publish, publishAdvanced } = useMQTTManager(gates);

  useEffect(() => {
    Promise.all([gateStorage.loadGates(), gateStorage.loadLayout(), gateStorage.loadTheme(), gateStorage.loadDisplayMode(), gateStorage.loadDefaultProperty()]).then(([savedGates, savedLayout, savedTheme, savedDisplayMode, savedDefaultProperty]) => {
      const properties = gatePropertyOptions(savedGates).map((option) => option.value);
      const selectedProperty = properties.includes(savedDefaultProperty) ? savedDefaultProperty : (properties[0] ?? "");
      setGates(savedGates.sort((a, b) => a.order - b.order));
      setLayout(savedLayout);
      setTheme(savedTheme);
      setDisplayMode(savedDisplayMode);
      setDefaultProperty(selectedProperty);
      setActiveProperty(selectedProperty);
      setLoaded(true);
    });
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => { if (loaded) void gateStorage.saveGates(gates); }, [gates, loaded]);
  useEffect(() => { if (loaded) void gateStorage.saveLayout(layout); }, [layout, loaded]);
  useEffect(() => { if (loaded) void gateStorage.saveDisplayMode(displayMode); }, [displayMode, loaded]);
  useEffect(() => { if (loaded) void gateStorage.saveDefaultProperty(defaultProperty); }, [defaultProperty, loaded]);
  useEffect(() => {
    if (!loaded) return;
    void gateStorage.saveTheme(theme);
    document.documentElement.dataset.theme = theme;
  }, [theme, loaded]);

  const runtimeFor = (gate: GateConfiguration): GateRuntimeState => runtime[gate.id] ?? { state: "offline", connected: false };
  const connectedCount = gates.filter((gate) => runtimeFor(gate).connected).length;
  const propertyOptions = useMemo(() => gatePropertyOptions(gates), [gates]);
  const properties = useMemo(() => propertyOptions.map((option) => option.value), [propertyOptions]);
  const activePropertyLabel = propertyOptions.find((option) => option.value === activeProperty)?.label || activeProperty;
  const sortedGates = useMemo(() => sortGates(gates, "all"), [gates]);
  const dashboardGates = useMemo(() => sortGates(displayMode === "property" ? gatesForProperty(gates, activeProperty) : gates, "all"), [gates, displayMode, activeProperty]);

  useEffect(() => {
    if (!loaded) return;
    const fallback = properties[0] ?? "";
    if (!properties.includes(defaultProperty)) setDefaultProperty(fallback);
    if (!properties.includes(activeProperty)) setActiveProperty(properties.includes(defaultProperty) ? defaultProperty : fallback);
  }, [properties, defaultProperty, activeProperty, loaded]);

  const saveGate = (gate: GateConfiguration) => {
    setGates((current) => {
      const exists = current.some((item) => item.id === gate.id);
      return (exists ? current.map((item) => item.id === gate.id ? gate : item) : [...current, { ...gate, order: current.length }]).sort((a, b) => a.order - b.order);
    });
    setScreen({ name: "setup" });
  };

  const activateGraphic = (gate: GateConfiguration) => {
    const command = gate.graphicTapAction === "toggle"
      ? (["open", "opening"].includes(runtimeFor(gate).state) ? "close" : "open")
      : "pulse";
    void publish(gate, command);
  };

  const openGateDetail = (gateId: string) => {
    detailOpenedAt.current = Date.now();
    setScreen({ name: "detail", gateId });
  };

  const removeGate = (gate: GateConfiguration) => {
    if (!window.confirm(`Delete ${gate.name}? This cannot be undone.`)) return;
    setGates((current) => current.filter((item) => item.id !== gate.id).map((item, index) => ({ ...item, order: index })));
  };

  const moveGate = (gate: GateConfiguration, direction: -1 | 1) => {
    setGates((current) => {
      const sorted = [...current].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((item) => item.id === gate.id);
      const target = index + direction;
      if (target < 0 || target >= sorted.length) return current;
      [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
      return sorted.map((item, order) => ({ ...item, order }));
    });
  };

  if (!loaded) return <main className="loading-screen"><span className="brand-mark"><GateBrandIcon /></span><p>Loading Gate Control…</p></main>;

  if (screen.name === "editor") {
    return <GateEditor initial={screen.gate} existing={gates} cloneDraft={screen.cloneDraft} advanced={screen.advanced} runtime={runtimeFor(screen.gate)} onPublishAdvanced={publishAdvanced} onSave={saveGate} onCancel={() => setScreen({ name: "setup" })} />;
  }

  if (screen.name === "detail") {
    const gate = gates.find((item) => item.id === screen.gateId);
    if (!gate) return null;
    const live = runtimeFor(gate);
    const actionByName = (name: string) => gate.advancedTopics.find((entry) => entry.direction === "publish" && entry.name === name);
    const stopAction = actionByName("Stop command");
    return (
      <div className="app-shell">
        <main className="detail-page">
          <header className="topbar topbar--detail">
            <button className="icon-button" onClick={() => setScreen({ name: "dashboard" })} aria-label="Back to dashboard"><ArrowLeft /></button>
            <div className="detail-title"><p className="eyebrow">Gate detail</p><h1>{gate.name}</h1></div>
            <button className="icon-button" onClick={() => setScreen({ name: "editor", gate: cloneData(gate) })} aria-label="Edit gate"><SlidersHorizontal /></button>
          </header>
          <section className={`detail-hero state-surface--${live.state}`}>
            <div className="detail-status-line"><span className={`state-dot state-dot--${live.state}`} /><strong>{stateLabels[live.state]}</strong><ConnectionBadge runtime={live} /></div>
            {live.warning && <div className="gate-warning gate-warning--detail" role="status"><AlertTriangle />{live.warning}</div>}
            <GateArtwork style={gate.visualStyle} state={live.state} large onActivate={() => activateGraphic(gate)} />
            <div className="detail-meta"><span>{formatAge(live.lastMessageAt)}</span><span>{brokerUrl(gate.broker)}</span></div>
          </section>
          <section className="control-panel" aria-label="Gate controls">
            <p className="control-label">Direct controls</p>
            <div className={`control-buttons ${stopAction ? "control-buttons--four" : ""}`}>
              <button onClick={() => void publish(gate, "pulse")} disabled={!live.connected}><CircleDot /><span>Pulse</span></button>
              <button className="control-open" onClick={() => void publish(gate, "open")} disabled={!live.connected}><ArrowUp /><span>Open</span></button>
              <button className="control-close" onClick={() => void publish(gate, "close")} disabled={!live.connected}><ArrowDown /><span>Close</span></button>
              {stopAction && <button className="control-stop" onClick={() => void publishAdvanced(gate, stopAction)} disabled={!live.connected}><Square /><span>Stop</span></button>}
            </div>
            {stopAction && <JogControls gate={gate} runtime={live} stopAction={stopAction} onPublish={publish} onStop={publishAdvanced} />}
            <p className="control-help">Actions publish once and never change the display until the broker reports a new status.</p>
          </section>
          <AutoTimerCard gate={gate} runtime={live} onPublish={publishAdvanced} />
          {live.lastPublish && live.lastPublish.at >= detailOpenedAt.current && <div className={`toast ${live.lastPublish.ok ? "toast--ok" : "toast--bad"}`} role="status"><span>{live.lastPublish.message}</span><X /></div>}
        </main>
        <AppNav screen={screen} onDashboard={() => setScreen({ name: "dashboard" })} onSetup={() => setScreen({ name: "setup" })} onAppSettings={() => setScreen({ name: "appSettings" })} />
      </div>
    );
  }

  if (screen.name === "setup") {
    return (
      <div className="app-shell">
        <main className="setup-page">
          <header className="topbar">
            <div><p className="eyebrow">Configuration</p><h1>Setup</h1></div>
            <button className="primary-button" onClick={() => setScreen({ name: "editor", gate: defaultGate(gates.length) })}><Plus /> Add gate</button>
          </header>
          <section className="gate-settings-list">
            <div className="list-heading"><div><p className="eyebrow">Configured endpoints</p><h2>{gates.length} {gates.length === 1 ? "gate" : "gates"}</h2></div><span>Hold Edit for 5 seconds to open advanced settings</span></div>
            {gates.length === 0 ? <EmptySetup onAdd={() => setScreen({ name: "editor", gate: defaultGate(0) })} /> : sortedGates.map((gate, index) => {
              const live = runtimeFor(gate);
              return <article className="setup-gate-row" key={gate.id}>
                <div className={`mini-state mini-state--${live.state}`}><GateArtwork style={gate.visualStyle} state={live.state} /></div>
                <div className="setup-gate-copy"><h3>{gate.name}</h3><p>{gatePropertyLabel(gate)} / {gateLocationLabel(gate)} · {brokerUrl(gate.broker)}</p><span>{gate.statusTopic}</span></div>
                <ConnectionBadge runtime={live} />
                <div className="row-actions">
                  <button disabled={index === 0} onClick={() => moveGate(gate, -1)} aria-label={`Move ${gate.name} up`}><ArrowUp /></button>
                  <button disabled={index === sortedGates.length - 1} onClick={() => moveGate(gate, 1)} aria-label={`Move ${gate.name} down`}><ArrowDown /></button>
                  <button onClick={() => setScreen({ name: "editor", gate: cloneGate(gate), cloneDraft: true })} aria-label={`Clone ${gate.name}`}><Copy /></button>
                  <LongPressEditButton gateName={gate.name} onEdit={() => setScreen({ name: "editor", gate: cloneData(gate) })} onAdvanced={() => setScreen({ name: "editor", gate: cloneData(gate), advanced: true })} />
                  <button className="danger-action" onClick={() => removeGate(gate)} aria-label={`Delete ${gate.name}`}><Trash2 /></button>
                </div>
              </article>;
            })}
          </section>
          <section className="security-card"><span><Radio /></span><div><h2>Cloudflare + Mosquitto</h2><p>Use one secure WebSocket hostname per broker. Keep MQTT ACLs limited to each operator’s required status and action topics. The app automatically reconnects if Cloudflare rotates a WebSocket session.</p></div></section>
        </main>
        <AppNav screen={screen} onDashboard={() => setScreen({ name: "dashboard" })} onSetup={() => setScreen({ name: "setup" })} onAppSettings={() => setScreen({ name: "appSettings" })} />
      </div>
    );
  }

  if (screen.name === "appSettings") {
    return (
      <div className="app-shell">
        <main className="setup-page">
          <header className="topbar"><div><p className="eyebrow">Turnage Automation</p><h1>App settings</h1></div></header>
          <section className="settings-section">
            <div className="section-copy"><span className="section-icon"><LayoutGrid /></span><div><h2>Dashboard layout</h2><p>Choose how gates are arranged on this device.</p></div></div>
            <div className="layout-picker">
              {([{ value: "cards", label: "Adaptive cards", icon: <LayoutGrid /> }, { value: "list", label: "Large list", icon: <List /> }, { value: "compact", label: "Compact", icon: <Menu /> }] as const).map((option) => <button key={option.value} className={layout === option.value ? "active" : ""} onClick={() => setLayout(option.value)}>{option.icon}<span>{option.label}</span></button>)}
            </div>
          </section>
          <section className="settings-section">
            <div className="section-copy"><span className="section-icon"><ArrowDown /></span><div><h2>Gate display</h2><p>Show every configured gate or start with one property.</p></div></div>
            <div className="display-setting-controls">
              <div className="layout-picker sort-picker">
                {([{ value: "all", label: "Show all" }, { value: "property", label: "Sort" }] as const).map((option) => <button key={option.value} className={displayMode === option.value ? "active" : ""} onClick={() => setDisplayMode(option.value)}><span>{option.label}</span></button>)}
              </div>
              {displayMode === "property" && <label className="inline-select"><span>Default property</span><select value={defaultProperty} disabled={!propertyOptions.length} onChange={(event) => { setDefaultProperty(event.target.value); setActiveProperty(event.target.value); }}>{propertyOptions.length ? propertyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : <option value="">No properties configured</option>}</select></label>}
            </div>
          </section>
          <section className="settings-section">
            <div className="section-copy"><span className="section-icon"><Moon /></span><div><h2>Appearance</h2><p>Use your device theme or choose a fixed mode.</p></div></div>
            <div className="layout-picker theme-picker">
              {([{ value: "system", label: "System", icon: <Monitor /> }, { value: "light", label: "Light", icon: <Sun /> }, { value: "dark", label: "Dark", icon: <Moon /> }] as const).map((option) => <button key={option.value} className={theme === option.value ? "active" : ""} onClick={() => setTheme(option.value)}>{option.icon}<span>{option.label}</span></button>)}
            </div>
          </section>
          <section className="security-card"><span><GateBrandIcon /></span><div><h2>Gate Control</h2><p>Built for Turnage Automation gate integration systems. App preferences and MQTT gate configurations remain on this device.</p></div></section>
        </main>
        <AppNav screen={screen} onDashboard={() => setScreen({ name: "dashboard" })} onSetup={() => setScreen({ name: "setup" })} onAppSettings={() => setScreen({ name: "appSettings" })} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="dashboard-page">
        <header className="dashboard-header">
          <div className="brand"><span className="brand-mark"><GateBrandIcon /></span><div><p>Gate Control</p><span>Turnage Automation</span></div></div>
          <div className="fleet-status"><span className={connectedCount ? "fleet-pulse" : "fleet-pulse fleet-pulse--offline"} /><div><strong>{connectedCount}/{gates.length}</strong><span>brokers online</span></div></div>
          <button className="icon-button settings-shortcut" onClick={() => setScreen({ name: "appSettings" })} aria-label="Open app settings"><Settings /></button>
        </header>
        <section className="dashboard-intro"><div><p className="eyebrow">Live overview</p><h1>{displayMode === "property" && activeProperty ? activePropertyLabel : "All gates"}</h1></div><div className="dashboard-sort-controls"><label><span>Order</span><select value={displayMode} onChange={(event) => { const mode = event.target.value as GateDisplayMode; setDisplayMode(mode); if (mode === "property" && !properties.includes(activeProperty)) setActiveProperty(properties.includes(defaultProperty) ? defaultProperty : (properties[0] ?? "")); }}><option value="all">Show All</option><option value="property">Property</option></select></label>{displayMode === "property" && <label><span>Property</span><select value={activeProperty} onChange={(event) => setActiveProperty(event.target.value)}>{propertyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}</div></section>
        {gates.length === 0 ? <EmptyDashboard onAdd={() => setScreen({ name: "editor", gate: defaultGate(0) })} /> : dashboardGates.length === 0 ? <section className="empty-dashboard compact-empty"><p className="eyebrow">No matching gates</p><h2>{activeProperty || "Property"}</h2><p>Choose another property from the dashboard control or update gate setup.</p></section> : <section className={`gate-collection gate-collection--${layout}`}>{dashboardGates.map((gate) => {
          const live = runtimeFor(gate);
          return <article className={`gate-card gate-card--${live.state}`} key={gate.id} onClick={() => openGateDetail(gate.id)} onKeyDown={(event) => { if (event.key === "Enter") openGateDetail(gate.id); }} role="button" tabIndex={0} aria-label={`Open ${gate.name} details`}>
            <div className="gate-card-top"><div><p className="gate-index">{gatePropertyLabel(gate)} / {gateLocationLabel(gate)}</p><h2>{gate.name}</h2></div><ConnectionBadge runtime={live} /></div>
            <div className="gate-card-art" onClick={(event) => event.stopPropagation()}><GateArtwork style={gate.visualStyle} state={live.state} onActivate={() => activateGraphic(gate)} /></div>
            <div className="gate-card-bottom"><div className="state-copy"><span className={`state-dot state-dot--${live.state}`} /><div><strong>{stateLabels[live.state]}</strong><span>{formatAge(live.lastMessageAt)}</span>{live.warning && <span className="gate-warning" role="status"><AlertTriangle />{live.warning}</span>}</div></div><ChevronRight /></div>
          </article>;
        })}</section>}
      </main>
      <AppNav screen={screen} onDashboard={() => setScreen({ name: "dashboard" })} onSetup={() => setScreen({ name: "setup" })} onAppSettings={() => setScreen({ name: "appSettings" })} />
    </div>
  );
}

function LongPressEditButton({ gateName, onEdit, onAdvanced }: { gateName: string; onEdit: () => void; onAdvanced: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const completed = useRef(false);
  const [holding, setHolding] = useState(false);

  const cancelHold = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  const startHold = (event: React.PointerEvent<HTMLButtonElement>) => {
    cancelHold();
    completed.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      completed.current = true;
      setHolding(false);
      navigator.vibrate?.([20, 40, 20]);
      onAdvanced();
    }, 5_000);
  };

  return <button
    className={`long-press-edit ${holding ? "long-press-edit--holding" : ""}`}
    onPointerDown={startHold}
    onPointerUp={cancelHold}
    onPointerCancel={cancelHold}
    onLostPointerCapture={cancelHold}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        completed.current = true;
        onAdvanced();
      }
    }}
    onClick={(event) => {
      if (completed.current) {
        completed.current = false;
        event.preventDefault();
        return;
      }
      onEdit();
    }}
    aria-label={`Edit ${gateName}; press and hold five seconds for advanced settings`}
    title="Hold for 5 seconds for advanced settings"
  ><Settings /></button>;
}

function EmptyDashboard({ onAdd }: { onAdd: () => void }) {
  return <section className="empty-dashboard"><div className="empty-art"><GateArtwork style="sliding" state="closed" /><GateArtwork style="swing" state="opening" /><GateArtwork style="barrier" state="open" /></div><p className="eyebrow">Ready for your first endpoint</p><h2>No gates configured</h2><p>Add a Mosquitto secure WebSocket URL, credentials, topics, and payload mappings. Everything stays on this device.</p><button className="primary-button" onClick={onAdd}><Plus /> Add first gate</button></section>;
}

function EmptySetup({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-setup"><span><Radio /></span><div><h3>No broker endpoints yet</h3><p>Start with one gate, then clone it to speed up setup for brokers using similar topics.</p></div><button className="secondary-button" onClick={onAdd}><Plus /> Add gate</button></div>;
}
