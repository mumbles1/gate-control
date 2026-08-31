const transferServiceUrl = process.env.ALERT_MONITOR_URL || "http://127.0.0.1:3001";

export async function POST(request: Request) {
  try {
    const response = await fetch(transferServiceUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "The secure transfer service is unavailable." }, { status: 503 });
  }
}
