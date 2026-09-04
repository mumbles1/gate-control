import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const appPort = process.platform === "win32" ? (process.env.PORT || "3000") : "3100";
const app = spawn(command, ["exec", "vinext", "start", "--host", "0.0.0.0"], { stdio: "inherit", env: { ...process.env, PORT: appPort } });
const alerts = spawn(process.execPath, ["server/notification-server.mjs"], { stdio: "inherit", env: process.env });
const accessControl = process.platform === "win32"
  ? null
  : spawn("/app/server/start-access-control.sh", [], { stdio: "inherit", env: process.env });
const localBroker = process.platform === "win32" || !/^(1|true|yes|on)$/i.test(process.env.ENABLE_LOCAL_BROKER || "")
  ? null
  : spawn("/app/server/start-local-broker.sh", [], { stdio: "inherit", env: process.env });
const mqttExplorer = process.platform === "win32" || !/^(1|true|yes|on)$/i.test(process.env.ENABLE_MQTT_EXPLORER || "true")
  ? null
  : spawn("/app/server/start-mqtt-explorer.sh", [], { stdio: "inherit", env: process.env });
const gateway = process.platform === "win32"
  ? null
  : spawn("/app/server/start-gateway.sh", [], { stdio: "inherit", env: process.env });
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  app.kill("SIGTERM"); alerts.kill("SIGTERM"); accessControl?.kill("SIGTERM"); localBroker?.kill("SIGTERM"); mqttExplorer?.kill("SIGTERM"); gateway?.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
app.on("exit", (code) => stop(code || 0));
alerts.on("exit", (code) => stop(code || 0));
accessControl?.on("exit", (code) => console.error(`Access Control service exited with code ${code ?? "unknown"}.`));
localBroker?.on("exit", (code) => console.error(`Local MQTT broker exited with code ${code ?? "unknown"}.`));
mqttExplorer?.on("exit", (code) => console.error(`MQTT Explorer exited with code ${code ?? "unknown"}.`));
gateway?.on("exit", (code) => stop(code || 0));
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
