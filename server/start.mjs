import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const app = spawn(command, ["exec", "vinext", "start", "--host", "0.0.0.0"], { stdio: "inherit", env: { ...process.env, PORT: process.env.PORT || "3000" } });
const alerts = spawn(process.execPath, ["server/notification-server.mjs"], { stdio: "inherit", env: process.env });
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  app.kill("SIGTERM"); alerts.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
app.on("exit", (code) => stop(code || 0));
alerts.on("exit", (code) => stop(code || 0));
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
