const PREFIX = "/access-control";
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"]);

function upstreamBase(): URL {
  return new URL(process.env.ACCESS_CONTROL_INTERNAL_URL ?? "http://127.0.0.1:8080");
}

function rewriteLocation(value: string): string {
  try {
    const location = new URL(value, upstreamBase());
    if (location.origin === upstreamBase().origin) return `${PREFIX}${location.pathname}${location.search}${location.hash}`;
  } catch {
    // Return an unrecognised Location unchanged.
  }
  return value.startsWith("/") ? `${PREFIX}${value}` : value;
}

function rewriteText(body: string): string {
  return body
    .replace(/(["'`])\/(?!\/|access-control\/)/g, `$1${PREFIX}/`)
    .replace(/(url\s*=\s*)\/(?!\/|access-control\/)/gi, `$1${PREFIX}/`)
    .replace(/(url\(\s*["']?)\/(?!\/|access-control\/)/gi, `$1${PREFIX}/`);
}

export async function proxyAccessControl(request: Request, path: string[] = []): Promise<Response> {
  const incoming = new URL(request.url);
  const upstream = upstreamBase();
  upstream.pathname = `/${path.join("/")}`;
  upstream.search = incoming.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "host") headers.set(key, value);
  });
  headers.set("host", upstream.host);
  headers.set("x-forwarded-prefix", PREFIX);

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return new Response("Access Control is starting. Please try again in a few seconds.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const outgoing = new Headers();
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-length" || lower === "content-encoding") return;
    if (lower === "location") outgoing.set(key, rewriteLocation(value));
    else if (lower === "set-cookie") outgoing.append(key, value.replace(/Path=\/(;|$)/i, `Path=${PREFIX}/$1`));
    else outgoing.append(key, value);
  });
  outgoing.set("cache-control", "no-store");

  const contentType = response.headers.get("content-type") ?? "";
  const textual = /text\/(html|css|javascript)|application\/javascript/i.test(contentType);
  const body = request.method === "HEAD" ? null : textual ? rewriteText(await response.text()) : await response.arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: outgoing });
}
