const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:5168";

export async function openCashDrawer(): Promise<void> {
  const url = new URL(agentUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") {
    throw new Error("Device Agent 주소는 POS PC의 localhost여야 합니다.");
  }

  let response: Response;
  try {
    response = await fetch(new URL("/cash-drawer/open", url), {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error("현금서랍 요청 시간이 초과되었습니다. Device Agent 응답을 확인해 주세요.");
    if (error instanceof TypeError)
      throw new Error("Device Agent에 연결할 수 없습니다. POS PC에서 Device Agent가 실행 중인지 확인해 주세요.");
    throw new Error(`Device Agent 요청 실패: ${error instanceof Error ? error.message : "알 수 없는 연결 오류"}`);
  }

  const body = await response.text();
  let result: { ok?: boolean; error?: string } | null = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try { result = JSON.parse(body) as { ok?: boolean; error?: string }; } catch { /* Include the bounded response body below. */ }
  }
  if (!response.ok || !result?.ok) {
    const preview = body.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) || "(empty response)";
    throw new Error(`현금서랍 명령 실패: HTTP ${response.status} ${response.statusText}; ${result?.error ?? preview}`);
  }
}
