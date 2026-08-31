const transferServiceUrl = process.env.ALERT_MONITOR_URL || "http://127.0.0.1:3001";

export async function POST(request: Request) {
  try {
    const requestBody = await request.text();
    const response = await fetch(transferServiceUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const responseText = await response.text();
    if (response.ok) {
      const requestAction = JSON.parse(requestBody || "{}").action;
      const result = JSON.parse(responseText || "{}");
      if (requestAction === "create-transfer" && result.token) {
        const configured = String(process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
        const usableConfiguredAddress = configured && !/(YOUR[_-]?SERVER|YOUR[_-]?CASAOS|example\.com)/i.test(configured);
        const baseUrl = usableConfiguredAddress ? configured : new URL(request.url).origin;
        result.url = `${baseUrl}/?gateTransfer=${encodeURIComponent(String(result.token))}`;
      }
      return Response.json(result, { status: response.status, headers: { "cache-control": "no-store" } });
    }
    return new Response(responseText, {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "The secure transfer service is unavailable." }, { status: 503 });
  }
}
