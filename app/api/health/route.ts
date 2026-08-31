import { APP_VERSION } from "../../app-version";

export function GET() {
  return Response.json({ ok: true, service: "gate-control", version: APP_VERSION, at: Date.now() }, { headers: { "cache-control": "no-store" } });
}
