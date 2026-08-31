const monitorUrl = process.env.ALERT_MONITOR_URL || "http://127.0.0.1:3001";

async function proxy(request: Request) {
  try {
    const response = await fetch(monitorUrl, {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "The notification service is unavailable." }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
