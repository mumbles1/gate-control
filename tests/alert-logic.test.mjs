import test from "node:test";
import assert from "node:assert/strict";
import { advanceControllerClock, binaryValue, controllerClock, controllerDate, controllerReportedOffline, expectedGateState, normalizeSchedule, readJsonPath } from "../server/alert-logic.mjs";

test("reads controller schedule and RTC fields", () => {
  const auto = '{"Open":"19:56","Close":"20:51","Status":1}';
  assert.equal(readJsonPath(auto, "$.Status"), 1);
  assert.equal(normalizeSchedule(readJsonPath(auto, "$.Open")), "1956");
  assert.deepEqual(controllerClock("19:56:04"), { hour: 19, minute: 56, second: 4, hhmm: "1956" });
  assert.equal(controllerDate("2026/08/31"), "2026-08-31");
  assert.deepEqual(advanceControllerClock("2026-08-31", controllerClock("23:59:30"), 45_000), { date: "2026-09-01", hour: 0, minute: 0, second: 15, hhmm: "0000" });
});

test("uses the established movement mapping for scheduled outcomes", () => {
  for (const value of [3, 6, 7, 10]) assert.equal(expectedGateState("open", value, false), true);
  for (const value of [4, 5, 8, 9]) assert.equal(expectedGateState("close", value, true), true);
  assert.equal(expectedGateState("open", 0, true), true);
  assert.equal(expectedGateState("close", 0, false), true);
  assert.equal(expectedGateState("open", 11, true), false);
  assert.equal(binaryValue("1"), true);
  assert.equal(binaryValue(0), false);
});

test("detects controller outages with one or two reporting interfaces", () => {
  assert.equal(controllerReportedOffline(false, undefined), true);
  assert.equal(controllerReportedOffline(undefined, false), true);
  assert.equal(controllerReportedOffline(false, false), true);
  assert.equal(controllerReportedOffline(false, true), false);
  assert.equal(controllerReportedOffline(true, false), false);
  assert.equal(controllerReportedOffline(undefined, undefined), false);
});
