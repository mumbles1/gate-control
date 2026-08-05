"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Copy, Eye, EyeOff, Plus, Radio, Save, Send, ShieldAlert, Trash2, X } from "lucide-react";
import { testGateConnection } from "./mqtt-service";
import type { AdditionalMQTTTopic, BrokerProtocol, GateCommand, GateConfiguration, GateRuntimeState } from "./types";
import { brokerUrl, cloneData, controllerTopicDefaults, createId, defaultBrokerPort, jogMacroDefinition, readBinaryPayload, schedulePayload, topicDefaults, updateGatePlace, validateGate } from "./types";

interface GateEditorProps {
  initial: GateConfiguration;
  existing: GateConfiguration[];
  cloneDraft?: boolean;
  advanced?: boolean;
  runtime?: GateRuntimeState;
  onPublishAdvanced?: (gate: GateConfiguration, action: AdditionalMQTTTopic) => Promise<boolean>;
  onSave: (gate: GateConfiguration) => void;
  onCancel: () => void;
}

export function GateEditor({ initial, existing, cloneDraft, advanced = false, runtime, onPublishAdvanced, onSave, onCancel }: GateEditorProps) {
  const [gate, setGate] = useState(() => cloneData(initial));
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [switchStates, setSwitchStates] = useState<Record<string, boolean>>({});
  const [switchCommandAt, setSwitchCommandAt] = useState<Record<string, number>>({});
  const [schedulePicker, setSchedulePicker] = useState<{ entry: AdditionalMQTTTopic; hour: string; minute: string; period: "AM" | "PM" } | null>(null);
  const [publishingSchedule, setPublishingSchedule] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);
  const errors = useMemo(() => validateGate(gate, existing), [gate, existing]);

  const setBroker = (key: keyof GateConfiguration["broker"], value: string | number) => {
    setGate((current) => ({ ...current, broker: { ...current.broker, [key]: value } }));
  };
  const setBrokerAddress = (key: "protocol" | "host" | "port" | "basePath" | "tls" | "validateCertificate", value: string | number | boolean) => {
    setGate((current) => {
      const previousDefaultPort = defaultBrokerPort(current.broker.protocol, current.broker.tls);
      let nextBroker = { ...current.broker, [key]: value };
      if (key === "protocol") {
        const protocol = value as BrokerProtocol;
        nextBroker.protocol = protocol;
        nextBroker.tls = protocol === "wss";
        if (current.broker.port === previousDefaultPort) nextBroker.port = defaultBrokerPort(protocol, nextBroker.tls);
      }
      if (key === "tls") {
        const tls = Boolean(value);
        nextBroker.tls = tls;
        if (nextBroker.protocol === "ws" || nextBroker.protocol === "wss") nextBroker.protocol = tls ? "wss" : "ws";
        if (current.broker.port === previousDefaultPort) nextBroker.port = defaultBrokerPort(nextBroker.protocol, tls);
      }
      nextBroker.url = brokerUrl(nextBroker);
      return { ...current, broker: nextBroker };
    });
  };
  const setAction = (command: GateCommand, key: "topic" | "payload", value: string) => {
    setGate((current) => ({ ...current, actions: { ...current.actions, [command]: { ...current.actions[command], [key]: value } } }));
  };
  const setMapping = (key: keyof GateConfiguration["mapping"], value: string) => {
    setGate((current) => ({ ...current, mapping: { ...current.mapping, [key]: value } }));
  };
  const setPlace = (key: "property" | "location", value: string) => {
    setGate((current) => updateGatePlace(current, key, value));
  };
  const addAdvancedTopic = () => {
    setGate((current) => ({
      ...current,
      advancedTopics: [...current.advancedTopics, { id: createId(), name: "", topic: "", direction: "subscribe", qos: 0, payload: "" }],
    }));
  };
  const updateAdvancedTopic = <K extends keyof AdditionalMQTTTopic,>(id: string, key: K, value: AdditionalMQTTTopic[K]) => {
    setGate((current) => ({ ...current, advancedTopics: current.advancedTopics.map((entry) => entry.id === id ? { ...entry, [key]: value } : entry) }));
  };
  const removeAdvancedTopic = (id: string) => {
    setGate((current) => ({ ...current, advancedTopics: current.advancedTopics.filter((entry) => entry.id !== id) }));
  };
  const updateAdvancedPair = (onId: string, offId: string, key: "topic" | "qos", value: string | 0 | 1) => {
    setGate((current) => ({ ...current, advancedTopics: current.advancedTopics.map((entry) => entry.id === onId || entry.id === offId ? { ...entry, [key]: value } : entry) }));
  };
  const toggleAdvancedPair = async (key: string, onAction: AdditionalMQTTTopic, offAction: AdditionalMQTTTopic, enabled: boolean) => {
    if (!onPublishAdvanced) return;
    const requestedAt = Date.now();
    if (await onPublishAdvanced(gate, enabled ? offAction : onAction)) {
      setSwitchStates((current) => ({ ...current, [key]: !enabled }));
      setSwitchCommandAt((current) => ({ ...current, [key]: requestedAt }));
    }
  };
  const loadControllerTopics = () => {
    setGate((current) => {
      const presets = controllerTopicDefaults(current.property, current.location);
      const presetByName = new Map(presets.map((entry) => [entry.name.toLowerCase(), entry]));
      const updated = current.advancedTopics.map((entry) => {
        const preset = presetByName.get(entry.name.trim().toLowerCase());
        return preset ? { ...preset, id: entry.id } : entry;
      });
      const existingNames = new Set(updated.map((entry) => entry.name.trim().toLowerCase()));
      return { ...current, advancedTopics: [...updated, ...presets.filter((entry) => !existingNames.has(entry.name.toLowerCase()))] };
    });
  };
  const openSchedulePicker = (entry: AdditionalMQTTTopic) => {
    const now = new Date();
    let hour24 = now.getHours();
    let minute = now.getMinutes();
    const savedTime = entry.payload.trim();
    if (/^\d{4}$/.test(savedTime)) {
      const savedHour = Number(savedTime.slice(0, 2));
      const savedMinute = Number(savedTime.slice(2));
      if (savedHour <= 23 && savedMinute <= 59) {
        hour24 = savedHour;
        minute = savedMinute;
      }
    }
    setScheduleResult(null);
    setSchedulePicker({ entry, hour: String(hour24 % 12 || 12), minute: String(minute).padStart(2, "0"), period: hour24 >= 12 ? "PM" : "AM" });
  };
  const publishSchedule = async () => {
    if (!schedulePicker || !onPublishAdvanced) return;
    const hour = Number(schedulePicker.hour);
    const minute = Number(schedulePicker.minute);
    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      setScheduleResult("Enter an hour from 1–12 and minutes from 00–59.");
      return;
    }
    const payload = schedulePayload(hour, minute, schedulePicker.period);
    const action = { ...schedulePicker.entry, direction: "publish" as const, payload };
    setPublishingSchedule(true);
    const ok = await onPublishAdvanced(gate, action);
    setPublishingSchedule(false);
    if (ok) {
      updateAdvancedTopic(action.id, "payload", payload);
      setScheduleResult(`${schedulePicker.entry.name} published: ${payload}`);
      setSchedulePicker(null);
    } else {
      setScheduleResult("Publish failed. Confirm that the gate broker is connected.");
    }
  };
  const applyTopicDefaults = () => {
    const topics = topicDefaults(gate.property, gate.location);
    setGate((current) => ({
      ...current,
      statusTopic: topics.statusTopic,
      availabilityTopic: topics.availabilityTopic,
      actions: {
        pulse: { ...current.actions.pulse, topic: topics.pulseTopic },
        open: { ...current.actions.open, topic: topics.openTopic },
        close: { ...current.actions.close, topic: topics.closeTopic },
      },
    }));
  };

  const pairedNames = new Set(["Enable constant publishing", "Disable constant publishing", "Enable open safety", "Disable open safety", "Enable automatic timer", "Disable automatic timer", "Enable safety output", "Disable safety output", "Enable manual daylight savings", "Disable manual daylight savings", "Stop command"]);
  const toggleMappings = [
    { key: "constant-publishing", label: "Constant publishing", on: gate.advancedTopics.find((entry) => entry.name === "Enable constant publishing"), off: gate.advancedTopics.find((entry) => entry.name === "Disable constant publishing") },
    { key: "open-safety", label: "Open safety", on: gate.advancedTopics.find((entry) => entry.name === "Enable open safety"), off: gate.advancedTopics.find((entry) => entry.name === "Disable open safety") },
    { key: "automatic-timer", label: "Automatic timer", on: gate.advancedTopics.find((entry) => entry.name === "Enable automatic timer"), off: gate.advancedTopics.find((entry) => entry.name === "Disable automatic timer") },
    { key: "safety-output", label: "Safety output", on: gate.advancedTopics.find((entry) => entry.name === "Enable safety output"), off: gate.advancedTopics.find((entry) => entry.name === "Disable safety output") },
    { key: "daylight-savings", label: "Manual daylight savings", on: gate.advancedTopics.find((entry) => entry.name === "Enable manual daylight savings"), off: gate.advancedTopics.find((entry) => entry.name === "Disable manual daylight savings") },
  ].filter((mapping) => mapping.on && mapping.off);
  const stopAction = gate.advancedTopics.find((entry) => entry.name === "Stop command");
  const controllerGroups = [
    { key: "broker", title: "Broker connectivity", note: "Static Subscribe topics with separate online and offline JSON payloads.", names: ["Ethernet broker status", "Wi-Fi broker status"] },
    { key: "traffic", title: "Traffic & breach", note: "Static Subscribe topic with breach and clear JSON payloads.", names: ["Traffic breach"] },
    { key: "timer", title: "Automatic timer", note: "Status, current Open time, and current Close time share Time_Check and use separate JSON paths. Set times publish one four-digit 24-hour payload.", names: ["Automatic timer status", "Current automatic open time", "Current automatic close time", "Automatic open time", "Automatic close time"] },
    { key: "rtc", title: "RTC clock", note: "Date, Time, and manual daylight savings status subscribe to RTC Time_Check using their JSON paths.", names: ["RTC Date", "RTC Time", "Manual daylight savings status"] },
    { key: "inputs", title: "Input statuses", note: "Each field subscribes to the shared Inputs topic using its JSON path.", names: ["RF Remote sensor input", "Keypad sensor input", "Lamp module sensor input", "Exit sensor input", "Siren operated sensor input", "Open/close status input", "Outside safety sensor input", "Inside safety sensor input"] },
    { key: "outputs", title: "Output statuses", note: "Each field subscribes to the shared Outputs topic using its JSON path.", names: ["Open safety output status", "Gate movement output", "Open signal output", "Stop signal output", "Close signal output", "Safety signal output", "Power relay output", "Liftmaster reset output"] },
  ].map((group) => ({ ...group, entries: group.names.map((name) => gate.advancedTopics.find((entry) => entry.name === name)).filter((entry): entry is AdditionalMQTTTopic => Boolean(entry)) }));
  const controllerNames = new Set(controllerGroups.flatMap((group) => group.names));
  const standardAdvancedTopics = gate.advancedTopics.filter((entry) => !pairedNames.has(entry.name) && !controllerNames.has(entry.name));
  const primaryToggleMappings = toggleMappings.filter((mapping) => mapping.key !== "automatic-timer" && mapping.key !== "daylight-savings");
  const automaticTimerToggle = toggleMappings.find((mapping) => mapping.key === "automatic-timer");
  const daylightSavingsToggle = toggleMappings.find((mapping) => mapping.key === "daylight-savings");
  const renderToggleControl = (mapping: (typeof toggleMappings)[number]) => {
    const onAction = mapping.on!;
    const offAction = mapping.off!;
    const signalName = mapping.key === "daylight-savings" ? "Manual daylight savings status"
      : mapping.key === "automatic-timer" ? "Automatic timer status"
      : mapping.key === "safety-output" ? "Open safety output status" : undefined;
    const signalKey = mapping.key === "daylight-savings" ? "DST" : mapping.key === "automatic-timer" ? "Status" : mapping.key === "safety-output" ? "OpnSafe" : undefined;
    const signal = signalName ? Object.values(runtime?.mqttSignals ?? {}).find((value) => value.name === signalName) : undefined;
    const commandSignal = mapping.key === "daylight-savings" ? runtime?.mqttSignals?.[onAction.id] : undefined;
    const statusEnabled = signal?.payload && signalKey ? readBinaryPayload(signal.payload, signalKey) : undefined;
    const commandEnabled = commandSignal?.payload === onAction.payload ? true : commandSignal?.payload === offAction.payload ? false : undefined;
    const reportedEnabled = commandSignal && commandSignal.at > (signal?.at ?? 0) ? commandEnabled : statusEnabled;
    const pendingAt = switchCommandAt[mapping.key];
    const latestSignalAt = Math.max(signal?.at ?? 0, commandSignal?.at ?? 0);
    const awaitingStatus = Boolean(signalName && pendingAt && latestSignalAt <= pendingAt);
    const enabled = awaitingStatus ? switchStates[mapping.key] ?? false : reportedEnabled ?? switchStates[mapping.key] ?? false;
    return <article key={mapping.key}>
      <button type="button" role="switch" aria-checked={enabled} className={enabled ? "controller-switch controller-switch--on" : "controller-switch"} onClick={() => void toggleAdvancedPair(mapping.key, onAction, offAction, enabled)} disabled={!runtime?.connected || !onPublishAdvanced}><span><strong>{mapping.label}</strong><small>{enabled ? "On" : "Off"}{awaitingStatus ? " · Waiting for status" : ""}</small></span><i aria-hidden="true" /></button>
      <div className="advanced-toggle-fields">
        <label className="field"><span>Topic</span><input aria-label={`${mapping.label} topic`} value={onAction.topic} onChange={(event) => updateAdvancedPair(onAction.id, offAction.id, "topic", event.target.value)} /></label>
        <label className="field"><span>On payload</span><input aria-label={`${mapping.label} on payload`} value={onAction.payload} onChange={(event) => updateAdvancedTopic(onAction.id, "payload", event.target.value)} /></label>
        <label className="field"><span>Off payload</span><input aria-label={`${mapping.label} off payload`} value={offAction.payload} onChange={(event) => updateAdvancedTopic(offAction.id, "payload", event.target.value)} /></label>
        <label className="field"><span>QoS</span><select aria-label={`${mapping.label} QoS`} value={onAction.qos} onChange={(event) => updateAdvancedPair(onAction.id, offAction.id, "qos", Number(event.target.value) as 0 | 1)}><option value={0}>0</option><option value={1}>1</option></select></label>
      </div>
    </article>;
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const message = await testGateConnection(gate);
      setTestResult({ ok: true, message });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : "Connection failed." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Cancel editing"><ArrowLeft /></button>
        <div><p className="eyebrow">{advanced ? "Advanced setup" : "Gate setup"}</p><h1>{advanced ? "Advanced gate settings" : cloneDraft ? "Clone gate" : initial.name === "New gate" ? "Add a gate" : "Edit gate"}</h1></div>
        <button className="primary-button save-button" type="button" disabled={errors.length > 0} onClick={() => onSave(gate)}><Save /> Save</button>
      </header>

      {cloneDraft && <div className="notice notice--warning"><Copy /><span>This copy cannot be saved until every topic is unique from the original gate.</span></div>}

      <div className="editor-grid">
        <section className="form-card">
          <div className="section-heading"><span>01</span><div><h2>Identity & behavior</h2><p>How this gate appears and responds.</p></div></div>
          <div className="form-grid form-grid--two">
            <label className="field"><span>Gate name</span><input value={gate.name} onChange={(event) => setGate({ ...gate, name: event.target.value })} /></label>
            <label className="field"><span>Animation style</span><select value={gate.visualStyle} onChange={(event) => setGate({ ...gate, visualStyle: event.target.value as GateConfiguration["visualStyle"] })}><option value="sliding">Sliding gate</option><option value="swing">Swing gate</option><option value="ranch">Ranch pipe swing gate</option><option value="barrier">Barrier arm</option></select></label>
            <label className="field"><span>Property <em>topic value</em></span><input placeholder="main-campus" value={gate.property} onChange={(event) => setPlace("property", event.target.value)} /></label>
            <label className="field"><span>Location <em>topic value</em></span><input placeholder="north-entrance" value={gate.location} onChange={(event) => setPlace("location", event.target.value)} /></label>
            <label className="field"><span>Property alias <em>optional</em></span><input placeholder="Main Campus" value={gate.propertyAlias} onChange={(event) => setGate({ ...gate, propertyAlias: event.target.value })} /><small>Shown in property dropdowns; MQTT topics keep the topic value above.</small></label>
            <label className="field"><span>Location alias <em>optional</em></span><input placeholder="North Entrance" value={gate.locationAlias} onChange={(event) => setGate({ ...gate, locationAlias: event.target.value })} /><small>Shown in gate labels; MQTT topics keep the topic value above.</small></label>
            <label className="field field--wide"><span>Graphic tap action</span><select value={gate.graphicTapAction} onChange={(event) => setGate({ ...gate, graphicTapAction: event.target.value as GateConfiguration["graphicTapAction"] })}><option value="pulse">Pulse</option><option value="toggle">Toggle open / close</option></select><small>Toggle uses the Open and Close topics and payloads configured below.</small></label>
          </div>
        </section>

        <section className="form-card">
          <div className="section-heading"><span>02</span><div><h2>MQTT broker</h2><p>Connection address, transport, encryption, and credentials.</p></div></div>
          <div className="form-grid form-grid--two">
            <label className="field"><span>Protocol</span><select value={gate.broker.protocol} onChange={(event) => setBrokerAddress("protocol", event.target.value as BrokerProtocol)}><option value="mqtt">mqtt://</option><option value="ws">ws://</option><option value="wss">wss://</option></select></label>
            <label className="field"><span>Host</span><input placeholder="mqtt.example.com" value={gate.broker.host} onChange={(event) => setBrokerAddress("host", event.target.value)} /></label>
            <label className="field"><span>Port</span><input type="number" min={1} max={65535} inputMode="numeric" value={Number.isNaN(gate.broker.port) ? "" : gate.broker.port} onChange={(event) => setBrokerAddress("port", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></label>
            <label className="field"><span>Base path <em>WebSocket only</em></span><input placeholder="mqtt" value={gate.broker.basePath} onChange={(event) => setBrokerAddress("basePath", event.target.value)} /></label>
            <label className="switch-field"><span><strong>Encryption (TLS)</strong><small>Uses WSS or MQTTS when enabled.</small></span><input type="checkbox" checked={gate.broker.tls} onChange={(event) => setBrokerAddress("tls", event.target.checked)} /></label>
            <label className="switch-field"><span><strong>Validate certificate</strong><small>Browser validation remains enforced for WSS.</small></span><input type="checkbox" checked={gate.broker.validateCertificate} onChange={(event) => setBrokerAddress("validateCertificate", event.target.checked)} /></label>
            <div className="broker-preview field--wide"><span>Effective address</span><code>{brokerUrl(gate.broker)}</code></div>
            {gate.broker.protocol === "mqtt" && <div className="notice notice--warning field--wide"><ShieldAlert /><span>Web browsers cannot open raw MQTT TCP sockets. Use ws:// or wss:// for this web app; mqtt:// is retained for compatible proxy or future native runtimes.</span></div>}
            <label className="field"><span>Username</span><input autoComplete="username" value={gate.broker.username} onChange={(event) => setBroker("username", event.target.value)} /></label>
            <label className="field"><span>Password</span><span className="password-input"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={gate.broker.password} onChange={(event) => setBroker("password", event.target.value)} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff /> : <Eye />}</button></span></label>
            <label className="field"><span>MQTT version</span><select value={gate.broker.protocolVersion} onChange={(event) => setBroker("protocolVersion", Number(event.target.value))}><option value={4}>3.1.1</option><option value={5}>5.0</option></select></label>
            <label className="field"><span>QoS</span><select value={gate.qos} onChange={(event) => setGate({ ...gate, qos: Number(event.target.value) as 0 | 1 })}><option value={0}>0 — at most once</option><option value={1}>1 — at least once</option></select></label>
            <label className="field"><span>Keepalive seconds</span><input type="number" min={15} max={300} value={gate.broker.keepalive} onChange={(event) => setBroker("keepalive", Number(event.target.value))} /></label>
            <label className="field"><span>Client ID override</span><input placeholder="Auto-generated" value={gate.broker.clientId} onChange={(event) => setBroker("clientId", event.target.value)} /></label>
          </div>
          <div className="credential-note"><ShieldAlert /><span>Credentials stay in this browser’s local database. Use a broker account restricted to only this gate’s topics.</span></div>
        </section>

        {advanced && <section className="form-card">
          <div className="section-heading"><span>03</span><div><h2>Controls & primary topics</h2><p>Pulse, Open, Close, Stop, and press-and-hold Jog macros are never retained.</p></div></div>
          <div className="form-grid form-grid--two topic-mode-row">
            <label className="field"><span>Home Assistant discovery</span><select value={gate.homeAssistantDiscoveryEnabled ? "enabled" : "disabled"} onChange={(event) => setGate({ ...gate, homeAssistantDiscoveryEnabled: event.target.value === "enabled" })}><option value="disabled">Disabled</option><option value="enabled">Enabled</option></select></label>
            {!gate.homeAssistantDiscoveryEnabled && <div className="topic-defaults"><div><strong>Case-sensitive property/location schema</strong><span>Actions: {topicDefaults(gate.property, gate.location).pulseTopic}</span></div><button className="secondary-button" type="button" onClick={applyTopicDefaults}>Apply defaults</button></div>}
          </div>
          <div className="form-grid">
            <label className="field"><span>Status topic</span><input value={gate.statusTopic} onChange={(event) => setGate({ ...gate, statusTopic: event.target.value })} /></label>
            <label className="field"><span>Availability topic <em>optional</em></span><input value={gate.availabilityTopic} onChange={(event) => setGate({ ...gate, availabilityTopic: event.target.value })} /></label>
          </div>
          <div className="command-table"><div className="command-row command-row--heading"><span>Action</span><span>Topic</span><span>Payload</span></div>{(["pulse", "open", "close"] as GateCommand[]).map((command) => <div className="command-row" key={command}><strong>{command}</strong><input aria-label={`${command} topic`} value={gate.actions[command].topic} onChange={(event) => setAction(command, "topic", event.target.value)} /><input aria-label={`${command} payload`} value={gate.actions[command].payload} onChange={(event) => setAction(command, "payload", event.target.value)} /></div>)}{stopAction && <><div className="command-row"><strong>stop</strong><input aria-label="stop topic" value={stopAction.topic} onChange={(event) => updateAdvancedTopic(stopAction.id, "topic", event.target.value)} /><input aria-label="stop payload" value={stopAction.payload} onChange={(event) => updateAdvancedTopic(stopAction.id, "payload", event.target.value)} /></div>{(["open", "close"] as const).map((direction) => { const macro = jogMacroDefinition(gate, direction, stopAction); return <div className="command-row command-row--macro" key={`jog-${direction}`}><strong>Jog {direction}</strong><input aria-label={`Jog ${direction} topics`} readOnly value={macro.press.topic === macro.release.topic ? macro.press.topic : `${macro.press.topic} → ${macro.release.topic}`} /><input aria-label={`Jog ${direction} payloads`} readOnly value={`${macro.press.payload} → ${macro.release.payload}`} /></div>; })}</>}</div>
        </section>}

        {advanced && <section className="form-card advanced-topic-card">
          <div className="section-heading advanced-topic-heading"><span>A1</span><div><h2>Additional MQTT topics</h2><p>Load the Turnage Automation controller contract or add a custom broker topic.</p></div><div className="advanced-topic-actions"><button className="secondary-button" type="button" onClick={loadControllerTopics}>Load controller topics</button><button className="secondary-button" type="button" onClick={addAdvancedTopic}><Plus /> Add custom</button></div></div>
          {primaryToggleMappings.length > 0 && <div className="advanced-toggle-settings">{primaryToggleMappings.map(renderToggleControl)}</div>}
          {controllerGroups.some((group) => group.entries.length > 0) && <div className="controller-contract-cards">{controllerGroups.filter((group) => group.entries.length > 0).map((group) => <section className="controller-contract-card" key={group.key}>
            <header><div><h3>{group.title}</h3><p>{group.note}</p></div></header>
            {group.key === "timer" && automaticTimerToggle && <div className="advanced-toggle-settings controller-group-toggle">{renderToggleControl(automaticTimerToggle)}</div>}
            {group.key === "rtc" && daylightSavingsToggle && <div className="advanced-toggle-settings controller-group-toggle">{renderToggleControl(daylightSavingsToggle)}</div>}
            <div className="controller-contract-list">{group.entries.map((entry) => <article className="controller-contract-row" key={entry.id}>
              <div className="controller-contract-name"><strong>{entry.name}</strong><span>{entry.direction === "subscribe" ? "Subscribe payload" : "Publish payload"}</span></div>
              <label className="field controller-contract-topic"><span>Topic</span><input aria-label={`${entry.name} topic`} value={entry.topic} onChange={(event) => updateAdvancedTopic(entry.id, "topic", event.target.value)} /></label>
              <div className="static-direction"><strong>{entry.direction === "subscribe" ? "Subscribe" : "Publish"}</strong><span>Static direction</span></div>
              {entry.offPayload !== undefined ? <>
                <label className="field"><span>On payload</span><input aria-label={`${entry.name} on payload`} value={entry.payload} onChange={(event) => updateAdvancedTopic(entry.id, "payload", event.target.value)} /></label>
                <label className="field"><span>Off payload</span><input aria-label={`${entry.name} off payload`} value={entry.offPayload} onChange={(event) => updateAdvancedTopic(entry.id, "offPayload", event.target.value)} /></label>
              </> : <label className="field controller-contract-payload"><span>{entry.direction === "subscribe" ? "Subscribe payload" : "Publish 24-hour payload"}</span><input aria-label={`${entry.name} payload`} value={entry.payload} onChange={(event) => updateAdvancedTopic(entry.id, "payload", event.target.value)} /></label>}
              <label className="field controller-contract-qos"><span>QoS</span><select aria-label={`${entry.name} QoS`} value={entry.qos} onChange={(event) => updateAdvancedTopic(entry.id, "qos", Number(event.target.value) as 0 | 1)}><option value={0}>0</option><option value={1}>1</option></select></label>
              {(entry.name === "Automatic open time" || entry.name === "Automatic close time") && <button className="schedule-publish-button" type="button" onClick={() => openSchedulePicker(entry)} disabled={!onPublishAdvanced}><Clock3 /><span>Set & publish</span></button>}
            </article>)}</div>
            {group.entries.some((entry) => entry.direction === "subscribe") && <div className="controller-group-signals"><div className="controller-group-signals-heading"><strong>Live signals</strong><span>Latest subscribed values</span></div><div className="mqtt-signal-grid">{group.entries.filter((entry) => entry.direction === "subscribe").map((entry) => {
              const signal = runtime?.mqttSignals?.[entry.id];
              return <article className={!signal ? "mqtt-signal-waiting" : undefined} key={entry.id}><div><strong>{entry.name}</strong><span>{signal ? new Date(signal.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Waiting"}</span></div><code>{signal?.payload ?? "No message received"}</code></article>;
            })}</div></div>}
          </section>)}</div>}
          {gate.advancedTopics.length === 0 ? <div className="advanced-topic-empty"><p>No additional MQTT topics configured.</p><span>Controller defaults include broker status, traffic, timers, I/O, safety, publishing, Stop, and safety commands.</span></div> : standardAdvancedTopics.length > 0 && <div className="advanced-topic-list">
            {standardAdvancedTopics.map((entry, index) => <div className="advanced-topic-row" key={entry.id}>
              <label className="field"><span>Name</span><input aria-label={`Additional topic ${index + 1} name`} placeholder="Custom topic" value={entry.name} onChange={(event) => updateAdvancedTopic(entry.id, "name", event.target.value)} /></label>
              <label className="field advanced-topic-path"><span>Topic</span><input aria-label={`Additional topic ${index + 1} topic`} placeholder={`${gate.property}/${gate.location}/custom`} value={entry.topic} onChange={(event) => updateAdvancedTopic(entry.id, "topic", event.target.value)} /></label>
              <label className="field"><span>Direction</span><select aria-label={`Additional topic ${index + 1} direction`} value={entry.direction} onChange={(event) => updateAdvancedTopic(entry.id, "direction", event.target.value as AdditionalMQTTTopic["direction"])}><option value="subscribe">Subscribe</option><option value="publish">Publish</option></select></label>
              <label className="field"><span>QoS</span><select aria-label={`Additional topic ${index + 1} QoS`} value={entry.qos} onChange={(event) => updateAdvancedTopic(entry.id, "qos", Number(event.target.value) as 0 | 1)}><option value={0}>0</option><option value={1}>1</option></select></label>
              <label className="field advanced-topic-payload"><span>Payload <em>{entry.direction === "publish" ? "optional" : "reference"}</em></span><input aria-label={`Additional topic ${index + 1} payload`} placeholder={entry.direction === "publish" ? "Optional publish payload" : "Expected value (optional)"} value={entry.payload} onChange={(event) => updateAdvancedTopic(entry.id, "payload", event.target.value)} /></label>
              <button className="advanced-topic-delete" type="button" onClick={() => removeAdvancedTopic(entry.id)} aria-label={`Remove additional topic ${index + 1}`}><Trash2 /></button>
            </div>)}
          </div>}
          {standardAdvancedTopics.some((entry) => entry.direction === "subscribe") && <section className="controller-contract-card custom-signal-card"><header><div><h3>Custom topic signals</h3><p>Latest values from custom Subscribe topics.</p></div></header><div className="mqtt-signal-grid">{standardAdvancedTopics.filter((entry) => entry.direction === "subscribe").map((entry) => {
            const signal = runtime?.mqttSignals?.[entry.id];
            return <article className={!signal ? "mqtt-signal-waiting" : undefined} key={entry.id}><div><strong>{entry.name || "Custom topic"}</strong><span>{signal ? new Date(signal.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Waiting"}</span></div><code>{signal?.payload ?? "No message received"}</code></article>;
          })}</div></section>}
        </section>}

        {advanced && <section className="form-card">
          <div className="section-heading"><span>04</span><div><h2>Status mapping</h2><p>Translate broker payloads into gate states.</p></div></div>
          <div className="form-grid form-grid--two">
            <label className="field"><span>Payload format</span><select value={gate.mapping.format} onChange={(event) => setMapping("format", event.target.value)}><option value="plain">Plain text</option><option value="json">JSON</option></select></label>
            {gate.mapping.format === "json" && <label className="field"><span>JSON key path</span><input placeholder="state" value={gate.mapping.jsonPath} onChange={(event) => setMapping("jsonPath", event.target.value)} /></label>}
            {(["open", "closed", "opening", "closing", "stopped", "available", "unavailable"] as const).map((key) => <label className="field" key={key}><span>{key} payload</span><input value={gate.mapping[key]} onChange={(event) => setMapping(key, event.target.value)} /></label>)}
          </div>
        </section>}
      </div>

      <section className="test-panel">
        <div><p className="eyebrow">Before saving</p><h2>Verify the live connection</h2><p>The test authenticates, subscribes to every configured status topic, and previews the first received message.</p></div>
        <button className="secondary-button" type="button" disabled={testing || errors.some((error) => error.includes("URL") || error.includes("topic is required"))} onClick={runTest}><Radio className={testing ? "spin" : ""} />{testing ? "Testing…" : "Test connection"}</button>
        {testResult && <div className={`test-result ${testResult.ok ? "test-result--ok" : "test-result--bad"}`}>{testResult.ok && <CheckCircle2 />}<span>{testResult.message}</span></div>}
      </section>

      {errors.length > 0 && <aside className="validation-panel" aria-live="polite"><strong>Complete setup to save</strong><ul>{errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></aside>}
      {schedulePicker && <div className="schedule-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSchedulePicker(null); }}>
        <section className="schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title">
          <header><div><p className="eyebrow">MQTT schedule</p><h2 id="schedule-dialog-title">{schedulePicker.entry.name}</h2></div><button className="icon-button" type="button" onClick={() => setSchedulePicker(null)} aria-label="Close time picker"><X /></button></header>
          <p className="schedule-help">Enter a 12-hour time. Gate Control converts it to a four-digit 24-hour payload before publishing once. Example: 7:56 PM publishes 1956.</p>
          <div className="schedule-keypad">
            <label><span>Hour</span><input autoFocus type="number" inputMode="numeric" min="1" max="12" aria-label="Schedule hour" value={schedulePicker.hour} onChange={(event) => setSchedulePicker({ ...schedulePicker, hour: event.target.value })} /></label>
            <span className="schedule-colon">:</span>
            <label><span>Minute</span><input type="number" inputMode="numeric" min="0" max="59" aria-label="Schedule minute" value={schedulePicker.minute} onChange={(event) => setSchedulePicker({ ...schedulePicker, minute: event.target.value })} /></label>
            <div className="schedule-period" aria-label="AM or PM"><button type="button" className={schedulePicker.period === "AM" ? "active" : ""} onClick={() => setSchedulePicker({ ...schedulePicker, period: "AM" })}>AM</button><button type="button" className={schedulePicker.period === "PM" ? "active" : ""} onClick={() => setSchedulePicker({ ...schedulePicker, period: "PM" })}>PM</button></div>
          </div>
          <div className="schedule-preview"><span>Four-digit 24-hour MQTT payload</span><code>{schedulePayload(Number(schedulePicker.hour), Number(schedulePicker.minute), schedulePicker.period)}</code></div>
          {scheduleResult && <p className="schedule-error" role="alert">{scheduleResult}</p>}
          <button className="primary-button schedule-confirm" type="button" disabled={publishingSchedule || !runtime?.connected} onClick={() => void publishSchedule()}><Send />{publishingSchedule ? "Publishing…" : "Publish time"}</button>
        </section>
      </div>}
      {!schedulePicker && scheduleResult && <div className="publish-toast" role="status">{scheduleResult}</div>}
    </main>
  );
}
