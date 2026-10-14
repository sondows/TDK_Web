import type { PrintDocument } from "@/lib/print-document";

const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:5168";

function agentEndpoint(path: string) {
  const url = new URL(agentUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/")
    throw new Error("Device Agent 주소는 POS PC의 localhost여야 합니다.");
  return new URL(path, url);
}

async function post(path: string, payload: unknown) {
  const url = agentEndpoint(path);
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(30_000), body: JSON.stringify(payload),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? await response.json() as { success?: boolean; error?: string }
    : null;
  return { response, result, url };
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
    // An older installed Agent does not have this endpoint. Preserve printing
    // during rollout; a real printer/validation failure from the new Agent is
    // never silently retried through a different document layout.
    if (legacy && (attempt.response.status === 404 || attempt.response.status === 405) && !attempt.result)
      attempt = await post(legacy.path, legacy.payload);
    if (!attempt.response.ok || !attempt.result?.success)
      throw new Error(attempt.result?.error ?? `Device Agent 인쇄 요청이 실패했습니다. (HTTP ${attempt.response.status})`);
  } catch (error) {
    console.error("Local Device Agent print failed", error);
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))
      throw new Error("영수증 프린터에 연결하지 못했습니다. Device Agent 연결을 확인해 주세요.");
    throw error;
  }
}

