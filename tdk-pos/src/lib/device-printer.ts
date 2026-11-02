import type { PrintDocument } from "@/lib/print-document";

const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:5168";

function agentEndpoint(path: string) {
  const url = new URL(agentUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/")
    throw new Error("Device Agent URL must point to localhost on the POS PC.");
  return new URL(path, url);
}

async function post(path: string, payload: unknown) {
  const url = agentEndpoint(path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(30_000), body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) throw error;
    throw new Error(`Device Agent request failed at ${url}: ${error instanceof Error ? error.message : "unknown network error"}`);
  }

  const body = await response.text();
  let result: { success?: boolean; error?: string } | null = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try { result = JSON.parse(body) as { success?: boolean; error?: string }; } catch { /* Keep the raw response for diagnostics. */ }
  }
  return { response, result, url, body };
}

export async function sendPrintDocument(document: PrintDocument, legacy?: { path: string; payload: unknown }): Promise<void> {
  try {
    let attempt;
    try {
      attempt = await post("/api/printer/document", document);
    } catch (error) {
      // Old Agents reject the new endpoint at the CORS preflight, so the
      // browser exposes only a TypeError rather than an HTTP 404.
      if (!legacy || !(error instanceof TypeError)) throw error;
      attempt = await post(legacy.path, legacy.payload);
    }
    // Preserve compatibility with installed Agents that predate this endpoint.
    // Real printer and validation failures are not retried with another layout.
    if (legacy && (attempt.response.status === 404 || attempt.response.status === 405) && !attempt.result)
      attempt = await post(legacy.path, legacy.payload);
    if (!attempt.response.ok || !attempt.result?.success) {
      const body = attempt.body.replace(/[\r\n\t]+/g, " ").trim();
      const preview = body.length > 240 ? `${body.slice(0, 240)}…` : body || "(empty body)";
      throw new Error(`Device Agent print failed: ${attempt.url} returned HTTP ${attempt.response.status} ${attempt.response.statusText}; ${attempt.result?.error ?? preview}`);
    }
  } catch (error) {
    console.error("Local Device Agent print failed", error);
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))
      throw new Error(`Device Agent connection failed while printing to ${agentUrl}: ${error.name === "TimeoutError" ? "request timed out" : "browser network/CORS request failed"}`);
    throw error;
  }
}
