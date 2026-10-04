const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:5168";

export async function requestSystemShutdown(): Promise<void> {
  const url = new URL(agentUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") {
    throw new Error("Device Agent 주소가 POS PC localhost가 아닙니다.");
  }

  const response = await fetch(new URL("/system/shutdown", url), {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Device Agent system shutdown request failed: ${response.status}`);
}
