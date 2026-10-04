const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:5168";
const printerError = "영수증을 출력할 수 없습니다.\n프린터 및 Device Agent 연결을 확인해주세요.";

export async function printReceipt(target: { checkoutId?: number; tableId?: number; isReprint?: boolean }): Promise<void> {
  let prepared: Response;
  let result: { success?: boolean; message?: string; receipt?: Record<string, unknown> };
  try {
    prepared = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(target),
    });
    result = await prepared.json();
  } catch (error) {
    console.error("Receipt preparation request failed", error);
    throw new Error("영수증 정보를 준비할 수 없습니다.");
  }
  if (!prepared.ok || !result.success || !result.receipt)
    throw new Error(result.message ?? "영수증 정보를 준비할 수 없습니다.");

  try {
    const url = new URL(agentUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/")
      throw new Error("Device Agent 주소는 POS PC의 localhost여야 합니다.");

    const response = await fetch(new URL("/api/printer/receipt", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(result.receipt),
    });
    const output = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || !output.success) throw new Error(output.error ?? `Device Agent returned ${response.status}`);
  } catch (error) {
    console.error("Receipt print through local Device Agent failed", error);
    throw new Error(printerError);
  }
}
