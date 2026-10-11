export type AccountTransferNotice = {
  storeName: string;
  receiptLogo: { width: number; height: number; pixelsBase64: string } | null;
  totalAmount: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};

const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:5168";

function localAgentUrl(path: string) {
  const url = new URL(agentUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/")
    throw new Error("Device Agent 주소는 POS PC의 localhost여야 합니다.");
  return new URL(path, url);
}

export async function prepareAccountTransferNotice(input:
  | { mode: "TEST"; bankName: string; accountNumber: string; accountHolder: string }
  | { mode: "LIVE"; paymentId: number },
): Promise<AccountTransferNotice> {
  const response = await fetch("/api/account-transfer-notice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input),
  });
  const result = await response.json() as { success?: boolean; message?: string; notice?: AccountTransferNotice };
  if (!response.ok || !result.success || !result.notice)
    throw new Error(result.message ?? "계좌이체 안내서를 준비하지 못했습니다.");
  return result.notice;
}

async function sendToAgent(path: string, notice: AccountTransferNotice) {
  const url = localAgentUrl(path);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(notice),
    });
    const result = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || !result.success)
      throw new Error(result.error ?? `Device Agent 인쇄 요청이 실패했습니다. (HTTP ${response.status})`);
    return result;
  } catch (error) {
    console.error("Account transfer notice print through local Device Agent failed", { url: url.toString(), error });
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))
      throw new Error("영수증 프린터에 연결하지 못했습니다. Device Agent가 최신 버전으로 실행 중인지 확인해 주세요.");
    throw error;
  }
}
export async function printAccountTransferNotice(notice: AccountTransferNotice): Promise<void> {
  await sendToAgent("/api/printer/account-transfer/print", notice);
}
