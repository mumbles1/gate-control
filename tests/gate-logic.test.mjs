import assert from "node:assert/strict";
import test from "node:test";
import { brokerUrl, cloneData, cloneGate, controllerTopicDefaults, createId, defaultGate, endpointIdentity, formatControllerTime12h, gateLocationLabel, gateProperties, gatePropertyLabel, gatePropertyOptions, gatesForProperty, jogMacroDefinition, mapControllerMovePayload, mapGateState, migrateBrokerSettings, migrateGate, readBinaryPayload, schedulePayload, sortGates, topicDefaults, updateGatePlace, validateGate } from "../app/types.ts";

test("normalizes broker and topic identity", () => {
  const first = defaultGate();
  Object.assign(first.broker, { url: "WSS://MQTT.EXAMPLE.COM/mqtt/", protocol: "wss", host: "MQTT.EXAMPLE.COM", port: 443, basePath: "/mqtt/", tls: true });
  first.statusTopic = "/home/gate/state/";
  const second = cloneData(first);
  second.id = createId();
  Object.assign(second.broker, { url: "wss://mqtt.example.com:443/mqtt", protocol: "wss", host: "mqtt.example.com", port: 443, basePath: "mqtt", tls: true });
  second.statusTopic = "home/gate/state";
  assert.equal(endpointIdentity(first), endpointIdentity(second));
  assert.match(validateGate(second, [first]).join(" "), /already used/);
});

test("creates compatible UUIDs when crypto.randomUUID is unavailable", () => {
  const id = createId({ getRandomValues: (bytes) => {
    bytes.fill(17);
    return bytes;
  } });
  assert.equal(id, "11111111-1111-4111-9111-111111111111");
});

test("clones configuration data when structuredClone is unavailable", () => {
  const original = defaultGate();
  const copy = cloneData(original, null);
  copy.actions.open.payload = "Changed";
  assert.notEqual(copy.actions.open.payload, original.actions.open.payload);
});

test("builds protocol, port, TLS, and base-path broker addresses", () => {
  const gate = defaultGate();
  assert.equal(brokerUrl(gate.broker), "wss://mqtt.example.com:443/mqtt");
  Object.assign(gate.broker, { protocol: "ws", tls: false, port: 8083, basePath: "/socket/" });
  assert.equal(brokerUrl(gate.broker), "ws://mqtt.example.com:8083/socket");
  Object.assign(gate.broker, { protocol: "mqtt", tls: false, port: 1883, basePath: "ignored" });
  assert.equal(brokerUrl(gate.broker), "mqtt://mqtt.example.com:1883");
  Object.assign(gate.broker, { tls: true, port: 8883 });
  assert.equal(brokerUrl(gate.broker), "mqtts://mqtt.example.com:8883");
  gate.broker.port = Number.NaN;
  assert.equal(brokerUrl(gate.broker), "mqtts://mqtt.example.com");
  assert.match(validateGate(gate, []).join(" "), /Broker port must be between 1 and 65535/);
});

test("migrates legacy broker URLs into structured fields", () => {
  const gate = defaultGate();
  const migrated = migrateBrokerSettings({ ...gate.broker, url: "wss://Example.COM:9443/custom/path", protocol: undefined, host: undefined, port: undefined });
  assert.equal(migrated.protocol, "wss");
  assert.equal(migrated.host, "example.com");
  assert.equal(migrated.port, 9443);
  assert.equal(migrated.basePath, "custom/path");
  assert.equal(migrated.tls, true);
});

test("clone is an unsaved duplicate until endpoint topics change", () => {
  const original = defaultGate();
  const copy = cloneGate(original);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, "New gate (Copy)");
  assert.match(validateGate(copy, [original]).join(" "), /already used/);
  copy.statusTopic = "home/other-gate/state";
  copy.availabilityTopic = "home/other-gate/availability";
  copy.actions.pulse.topic = "home/other-gate/pulse";
  copy.actions.open.topic = "home/other-gate/open";
  copy.actions.close.topic = "home/other-gate/close";
  assert.doesNotMatch(validateGate(copy, [original]).join(" "), /already used/);
});

test("blocks a save when any topic matches another gate", () => {
  const first = defaultGate();
  const second = defaultGate();
  second.statusTopic = "different/status";
  second.availabilityTopic = "different/availability";
  second.actions.pulse.topic = "different/pulse";
  second.actions.open.topic = "different/open";
  second.actions.close.topic = first.statusTopic;
  assert.match(validateGate(second, [first]).join(" "), /Close action/);
});

test("graphic action defaults to Pulse", () => {
  const gate = defaultGate();
  assert.equal(gate.graphicTapAction, "pulse");
  assert.equal(gate.actions.pulse.payload, "Pulse");
  assert.equal(gate.actions.open.payload, "Open");
  assert.equal(gate.actions.close.payload, "Close");
});

test("non-discovery topics use property and location schema", () => {
  const gate = defaultGate(2);
  assert.equal(gate.homeAssistantDiscoveryEnabled, false);
  assert.equal(gate.property, "property");
  assert.equal(gate.location, "gate-3");
  assert.equal(gate.statusTopic, "property/gate-3/state");
  assert.equal(gate.actions.open.topic, "property/gate-3");
  assert.deepEqual(topicDefaults("Main Campus", "North Entrance"), {
    statusTopic: "Main Campus/North Entrance/state",
    availabilityTopic: "Main Campus/North Entrance/availability",
    pulseTopic: "Main Campus/North Entrance",
    openTopic: "Main Campus/North Entrance",
    closeTopic: "Main Campus/North Entrance",
  });
});

test("MQTT topic duplicate checks are case-sensitive", () => {
  const upper = defaultGate();
  upper.property = "PlantA";
  Object.assign(upper, { statusTopic: "PlantA/Gate/state", availabilityTopic: "PlantA/Gate/availability" });
  upper.actions.pulse.topic = upper.actions.open.topic = upper.actions.close.topic = "PlantA/Gate";
  const lower = defaultGate();
  lower.property = "planta";
  Object.assign(lower, { statusTopic: "planta/Gate/state", availabilityTopic: "planta/Gate/availability" });
  lower.actions.pulse.topic = lower.actions.open.topic = lower.actions.close.topic = "planta/Gate";
  assert.doesNotMatch(validateGate(lower, [upper]).join(" "), /already used/);
});

test("migrates earlier suffixed command defaults to the shared command topic", () => {
  const gate = defaultGate();
  gate.property = "PlantA";
  gate.location = "NorthGate";
  gate.actions.pulse.topic = "PlantA/NorthGate/pulse";
  gate.actions.open.topic = "PlantA/NorthGate/open";
  gate.actions.close.topic = "PlantA/NorthGate/close";
  const migrated = migrateGate(gate);
  assert.equal(migrated.actions.pulse.topic, "PlantA/NorthGate");
  assert.equal(migrated.actions.open.topic, "PlantA/NorthGate");
  assert.equal(migrated.actions.close.topic, "PlantA/NorthGate");
});

test("migrates the old command suffix to the base action topic", () => {
  const gate = defaultGate();
  gate.property = "PlantA";
  gate.location = "SouthGate";
  gate.actions.pulse.topic = gate.actions.open.topic = gate.actions.close.topic = "PlantA/SouthGate/command";
  const migrated = migrateGate(gate);
  assert.equal(migrated.actions.pulse.topic, "PlantA/SouthGate");
  assert.equal(migrated.actions.open.topic, "PlantA/SouthGate");
  assert.equal(migrated.actions.close.topic, "PlantA/SouthGate");
});

test("changing Property or Location always refreshes all action topics", () => {
  const gate = defaultGate();
  gate.actions.pulse.topic = gate.actions.open.topic = gate.actions.close.topic = "old/value/command";
  gate.homeAssistantDiscoveryEnabled = true;
  const propertyChanged = updateGatePlace(gate, "property", "PlantA");
  assert.equal(propertyChanged.actions.pulse.topic, "PlantA/gate-1");
  assert.equal(propertyChanged.actions.open.topic, "PlantA/gate-1");
  assert.equal(propertyChanged.actions.close.topic, "PlantA/gate-1");
  const locationChanged = updateGatePlace(propertyChanged, "location", "NorthGate");
  assert.equal(locationChanged.actions.pulse.topic, "PlantA/NorthGate");
  assert.equal(locationChanged.actions.open.topic, "PlantA/NorthGate");
  assert.equal(locationChanged.actions.close.topic, "PlantA/NorthGate");
});

test("shows all gates in configured order or sorts them by property", () => {
  const north = defaultGate(0);
  north.name = "North";
  north.property = "Warehouse";
  north.location = "North";
  const south = defaultGate(1);
  south.name = "South";
  south.property = "Office";
  south.location = "South";
  assert.deepEqual(sortGates([north, south], "all").map((gate) => gate.name), ["North", "South"]);
  assert.deepEqual(sortGates([north, south], "property").map((gate) => gate.name), ["South", "North"]);
});

test("builds property choices and selects gates using case-sensitive property values", () => {
  const north = defaultGate(0);
  north.property = "PlantB";
  const south = defaultGate(1);
  south.property = "PlantA";
  south.propertyAlias = "Main Plant";
  south.locationAlias = "South Entrance";
  const duplicate = defaultGate(2);
  duplicate.property = "PlantA";
  assert.deepEqual(gateProperties([north, south, duplicate]), ["PlantA", "PlantB"]);
  assert.deepEqual(gatePropertyOptions([north, south, duplicate]), [{ value: "PlantA", label: "Main Plant" }, { value: "PlantB", label: "PlantB" }]);
  assert.equal(gatePropertyLabel(south), "Main Plant");
  assert.equal(gateLocationLabel(south), "South Entrance");
  assert.equal(gatePropertyLabel(north), "PlantB");
  assert.deepEqual(gatesForProperty([north, south, duplicate], "PlantA").map((gate) => gate.id), [south.id, duplicate.id]);
  assert.equal(gatesForProperty([north, south], "planta").length, 0);
});

test("maps plain and JSON status payloads", () => {
  const gate = defaultGate();
  assert.equal(mapGateState("opening", gate.mapping), "opening");
  assert.equal(mapGateState("unexpected", gate.mapping), "unknown");
  gate.mapping.format = "json";
  gate.mapping.jsonPath = "cover.state";
  assert.equal(mapGateState('{"cover":{"state":"closed"}}', gate.mapping), "closed");
});

test("new and migrated gates initialize additional MQTT topics safely", () => {
  assert.deepEqual(defaultGate().advancedTopics, []);
  const legacy = defaultGate();
  delete legacy.advancedTopics;
  assert.deepEqual(migrateGate(legacy).advancedTopics, []);
});

test("validates additional MQTT topic fields", () => {
  const gate = defaultGate();
  gate.advancedTopics.push({ id: createId(), name: "", topic: "", direction: "subscribe", qos: 0, payload: "" });
  const errors = validateGate(gate, []).join(" ");
  assert.match(errors, /Additional topic 1 needs a name/);
  assert.match(errors, /Additional topic 1 needs a topic/);
});

test("additional MQTT topics cannot duplicate any topic on another gate", () => {
  const first = defaultGate();
  first.advancedTopics.push({ id: createId(), name: "Fault", topic: "PlantA/Gate/fault", direction: "subscribe", qos: 1, payload: "fault" });
  const second = defaultGate(1);
  second.statusTopic = "PlantA/Gate/fault";
  assert.match(validateGate(second, [first]).join(" "), /already used/);
});

test("builds Turnage Automation controller topics and payloads", () => {
  const topics = controllerTopicDefaults("Test_Gate", "gate-1");
  const byName = Object.fromEntries(topics.map((entry) => [entry.name, entry]));
  assert.equal(byName["Ethernet broker status"].topic, "Test_Gate/gate-1/Broker/Eth");
  assert.equal(byName["Ethernet broker status"].direction, "subscribe");
  assert.equal(byName["Ethernet broker status"].payload, '{"LWT":1}');
  assert.equal(byName["Ethernet broker status"].offPayload, '{"LWT":0}');
  assert.equal(byName["RF Remote sensor input"].topic, "Test_Gate/gate-1/IO_Status/Inputs");
  assert.equal(byName["RF Remote sensor input"].payload, "$.RF");
  assert.equal(byName["Inside safety sensor input"].payload, "$.IS");
  assert.equal(byName["Open safety output status"].topic, "Test_Gate/gate-1/IO_Status/Outputs");
  assert.equal(byName["Open safety output status"].payload, "$.OpnSafe");
  assert.equal(byName["Gate movement output"].payload, "$.Move");
  assert.equal(byName["Liftmaster reset output"].payload, "$.LMReset");
  assert.equal(byName["Stop command"].topic, "Test_Gate/gate-1");
  assert.equal(byName["Stop command"].payload, "Stop");
  assert.equal(byName["Enable open safety"].payload, "Safe_1");
  assert.equal(byName["Enable constant publishing"].payload, "1");
  assert.equal(byName["Enable automatic timer"].payload, "1");
  assert.equal(byName["Disable automatic timer"].payload, "0");
  assert.equal(byName["Enable automatic timer"].topic, "Test_Gate/gate-1/Auto");
  assert.equal(byName["Disable automatic timer"].topic, "Test_Gate/gate-1/Auto");
  assert.equal(byName["Automatic timer status"].payload, "$.Status");
  assert.equal(byName["Current automatic open time"].payload, "$.Open");
  assert.equal(byName["Current automatic close time"].payload, "$.Close");
  assert.equal(byName["RTC Date"].topic, "Test_Gate/gate-1/RTC/Time_Check");
  assert.equal(byName["RTC Date"].payload, "$.Date");
  assert.equal(byName["RTC Time"].topic, "Test_Gate/gate-1/RTC/Time_Check");
  assert.equal(byName["RTC Time"].payload, "$.Time");
  assert.equal(byName["Manual daylight savings status"].topic, "Test_Gate/gate-1/RTC/Time_Check");
  assert.equal(byName["Manual daylight savings status"].payload, "$.DST");
  assert.equal(byName["Enable manual daylight savings"].topic, "Test_Gate/gate-1/DST");
  assert.equal(byName["Enable manual daylight savings"].payload, "1");
  assert.equal(byName["Disable manual daylight savings"].payload, "0");
  assert.equal(byName["Automatic open time"].direction, "publish");
  assert.equal(byName["Automatic open time"].payload, "<hour><minutes>");
  assert.equal(byName["Enable safety output"].topic, "Test_Gate/gate-1/IO_Status/Outputs");
  assert.equal(byName["Enable safety output"].payload, "Safe_1");
  assert.equal(byName["Disable safety output"].payload, "Safe_0");
  assert.equal(byName["Safety output status"], undefined);
  assert.equal(byName["Light signal output"], undefined);
  assert.ok(topics.every((entry) => entry.lockedDirection));
  assert.ok(topics.every((entry) => entry.qos === 0));
});

test("converts 12-hour schedule input to a four-digit 24-hour payload", () => {
  assert.equal(schedulePayload(12, 0, "AM"), "0000");
  assert.equal(schedulePayload(12, 30, "PM"), "1230");
  assert.equal(schedulePayload(7, 56, "PM"), "1956");
});

test("builds Jog Open and Jog Close from their direction and Stop mappings", () => {
  const gate = defaultGate();
  gate.actions.open = { topic: "Site/Gate", payload: "Open" };
  gate.actions.close = { topic: "Site/Gate", payload: "Close" };
  const stop = { id: createId(), name: "Stop command", topic: "Site/Gate", direction: "publish", qos: 0, payload: "Stop" };
  assert.deepEqual(jogMacroDefinition(gate, "open", stop), { press: { topic: "Site/Gate", payload: "Open" }, release: { topic: "Site/Gate", payload: "Stop" } });
  assert.deepEqual(jogMacroDefinition(gate, "close", stop), { press: { topic: "Site/Gate", payload: "Close" }, release: { topic: "Site/Gate", payload: "Stop" } });
});

test("formats controller RTC and schedule times for 12-hour display", () => {
  assert.equal(formatControllerTime12h("1956"), "7:56 PM");
  assert.equal(formatControllerTime12h("00:05"), "12:05 AM");
  assert.equal(formatControllerTime12h("13:04:09"), "1:04:09 PM");
});

test("migrates legacy automatic time topics to static publish", () => {
  const gate = defaultGate();
  gate.advancedTopics = [{ id: createId(), name: "Automatic open time", topic: "Property/Gate/Auto/Open_Time", direction: "subscribe", qos: 0, payload: "time" }];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics[0].direction, "publish");
  assert.equal(migrated.advancedTopics[0].payload, "<hour><minutes>");
  assert.equal(migrated.advancedTopics[0].lockedDirection, true);
});

test("adds the automatic Time Check toggle actions to older controller configurations", () => {
  const gate = defaultGate();
  gate.advancedTopics = [{ id: createId(), name: "Automatic timer status", topic: "Property/Gate/Auto/Time_Check", direction: "subscribe", qos: 0, payload: '{"Status":1}' }];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Enable automatic timer")?.payload, "1");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Disable automatic timer")?.payload, "0");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Enable automatic timer")?.topic, `${gate.property}/${gate.location}/Auto`);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Automatic timer status")?.payload, "$.Status");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Current automatic open time")?.payload, "$.Open");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Current automatic close time")?.payload, "$.Close");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "RTC Date")?.topic, `${gate.property}/${gate.location}/RTC/Time_Check`);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "RTC Time")?.payload, "$.Time");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Manual daylight savings status")?.payload, "$.DST");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Enable manual daylight savings")?.topic, `${gate.property}/${gate.location}/DST`);
});

test("migrates timer toggle publishes away from the Time Check subscription topic", () => {
  const gate = defaultGate();
  gate.advancedTopics = [{ id: createId(), name: "Enable automatic timer", topic: `${gate.property}/${gate.location}/Auto/Time_Check`, direction: "publish", qos: 0, payload: '{"Status":1}' }];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics[0].topic, `${gate.property}/${gate.location}/Auto`);
});

test("migrates the legacy RTC Time_check casing", () => {
  const gate = defaultGate();
  gate.advancedTopics = [{ id: createId(), name: "RTC Date", topic: `${gate.property}/${gate.location}/RTC/Time_check`, direction: "subscribe", qos: 0, payload: "$.Date" }];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics[0].topic, `${gate.property}/${gate.location}/RTC/Time_Check`);
});

test("splits legacy combined input and output status subscriptions into JSON fields", () => {
  const gate = defaultGate();
  gate.advancedTopics = [
    { id: createId(), name: "Input status", topic: `${gate.property}/${gate.location}/IO_Status/Inputs`, direction: "subscribe", qos: 1, payload: "{}" },
    { id: createId(), name: "Output status", topic: `${gate.property}/${gate.location}/IO_Status/Outputs`, direction: "subscribe", qos: 0, payload: "{}" },
  ];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics.some((entry) => entry.name === "Input status" || entry.name === "Output status"), false);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "RF Remote sensor input")?.payload, "$.RF");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "RF Remote sensor input")?.qos, 1);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Gate movement output")?.payload, "$.Move");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Liftmaster reset output")?.topic, `${gate.property}/${gate.location}/IO_Status/Outputs`);
});

test("removes retired safety status while migrating its toggle commands", () => {
  const gate = defaultGate();
  gate.advancedTopics = [
    { id: createId(), name: "Safety output", topic: `${gate.property}/${gate.location}/IO_Status/Output`, direction: "subscribe", qos: 0, payload: '{"Safety":1}', offPayload: '{"Safety":0}' },
    { id: createId(), name: "Enable safety output", topic: `${gate.property}/${gate.location}/IO_Status/Output`, direction: "publish", qos: 0, payload: '{"Safety":1}' },
    { id: createId(), name: "Disable safety output", topic: `${gate.property}/${gate.location}/IO_Status/Output`, direction: "publish", qos: 0, payload: '{"Safety":0}' },
  ];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Safety output status"), undefined);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Enable safety output")?.topic, `${gate.property}/${gate.location}/IO_Status/Outputs`);
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Enable safety output")?.payload, "Safe_1");
  assert.equal(migrated.advancedTopics.find((entry) => entry.name === "Disable safety output")?.payload, "Safe_0");
});

test("removes retired light and safety output fields from saved gates", () => {
  const gate = defaultGate();
  gate.advancedTopics = [
    { id: createId(), name: "Light signal output", topic: `${gate.property}/${gate.location}/IO_Status/Outputs`, direction: "subscribe", qos: 0, payload: "$.Lamp" },
    { id: createId(), name: "Safety output status", topic: `${gate.property}/${gate.location}/IO_Status/Output`, direction: "subscribe", qos: 0, payload: "$.Safety" },
  ];
  const migrated = migrateGate(gate);
  assert.equal(migrated.advancedTopics.length, 0);
});

test("property and location changes rebase controller and custom child topics", () => {
  const gate = defaultGate();
  gate.advancedTopics = controllerTopicDefaults(gate.property, gate.location);
  const changed = updateGatePlace(updateGatePlace(gate, "property", "Main"), "location", "North");
  assert.ok(changed.advancedTopics.every((entry) => entry.topic === "Main/North" || entry.topic.startsWith("Main/North/")));
});

test("parses numeric and string broker LWT payloads", () => {
  assert.equal(readBinaryPayload('{"LWT":1}', "LWT"), true);
  assert.equal(readBinaryPayload('{"LWT":"0"}', "LWT"), false);
  assert.equal(readBinaryPayload('{"LWT":2}', "LWT"), undefined);
  assert.equal(readBinaryPayload("not-json", "LWT"), undefined);
});

test("parses malformed controller binary fields used by RTC status", () => {
  assert.equal(readBinaryPayload('{"Date":"2026/08/02","Time":"19:20","DST"":0}', "DST"), false);
  assert.equal(readBinaryPayload('{"DST"":1}', "DST"), true);
});

test("maps controller Move telemetry into gate states", () => {
  assert.equal(mapControllerMovePayload('{"Move":0}', true), "open");
  assert.equal(mapControllerMovePayload('{"Move":0}', false), "closed");
  assert.equal(mapControllerMovePayload('{"Move":0}'), undefined);
  assert.equal(mapControllerMovePayload('{"Move":1}'), "opening");
  assert.equal(mapControllerMovePayload('{"Move":"2"}'), "closing");
  assert.equal(mapControllerMovePayload('{"Move":3}'), "open");
  assert.equal(mapControllerMovePayload('{"Move":4}'), "closed");
  assert.equal(mapControllerMovePayload('{"Move":6}'), "open");
  assert.equal(mapControllerMovePayload('{"Move":7}'), "open");
  assert.equal(mapControllerMovePayload('{"Move":10}'), "open");
  assert.equal(mapControllerMovePayload('{"Move":11}'), "stopped");
  assert.equal(mapControllerMovePayload('{"Move":9}'), "closed");
  assert.equal(mapControllerMovePayload('{"Move":20}'), undefined);
  assert.equal(mapControllerMovePayload('{"Move":7,"Unrelated":bare_token}'), "open");
  assert.equal(mapControllerMovePayload('{"Move":"10","Unrelated":bare_token}'), "open");
});
