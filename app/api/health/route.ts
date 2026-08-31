export function GET() {
  return Response.json({ ok: true, service: "gate-control", at: Date.now() }, { headers: { "cache-control": "no-store" } });
}
