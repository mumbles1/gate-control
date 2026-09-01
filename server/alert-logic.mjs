export function readJsonPath(payload, path) {
  if (!payload) return undefined;
  try {
    let value = JSON.parse(payload);
    const parts = String(path || "").replace(/^\$\.?/, "").split(".").filter(Boolean);
    for (const part of parts) value = value?.[part];
    return value;
  } catch {
    return undefined;
  }
}

export function controllerDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

export function controllerClock(value) {
  const text = String(value ?? "").trim();
  const compact = text.match(/^(\d{2})(\d{2})$/);
  const separated = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const hour = Number(compact?.[1] ?? separated?.[1]);
  const minute = Number(compact?.[2] ?? separated?.[2]);
  const second = Number(separated?.[3] ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute, second, hhmm: `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}` };
}

export function advanceControllerClock(date, clock, elapsedMillis) {
  if (!date || !clock) return null;
  const start = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return null;
  const timestamp = start + ((clock.hour * 60 + clock.minute) * 60 + clock.second) * 1000 + Math.max(0, elapsedMillis);
  const current = new Date(timestamp);
  return {
    date: current.toISOString().slice(0, 10),
    hour: current.getUTCHours(), minute: current.getUTCMinutes(), second: current.getUTCSeconds(),
    hhmm: `${String(current.getUTCHours()).padStart(2, "0")}${String(current.getUTCMinutes()).padStart(2, "0")}`,
  };
}

export function normalizeSchedule(value) {
  const text = String(value ?? "").trim().replace(":", "");
  return /^\d{4}$/.test(text) ? text : "";
}

export function expectedGateState(kind, movement, relay) {
  const move = Number(movement);
  if (kind === "open") {
    if ([3, 6, 7, 10].includes(move)) return true;
    if (move === 0 && relay === true) return true;
    return false;
  }
  if ([4, 5, 8, 9].includes(move)) return true;
  if (move === 0 && relay === false) return true;
  return false;
}

export function binaryValue(value) {
  if (value === 1 || value === "1" || value === true) return true;
  if (value === 0 || value === "0" || value === false) return false;
  return undefined;
}

export function controllerReportedOffline(ethernet, wifi) {
  const hasOfflineReport = ethernet === false || wifi === false;
  const hasOnlineReport = ethernet === true || wifi === true;
  return hasOfflineReport && !hasOnlineReport;
}
