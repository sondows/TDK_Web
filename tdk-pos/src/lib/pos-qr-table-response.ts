type QrResponse = { success?: boolean; orders?: unknown[]; message?: string };

export async function readPosQrTableResponse<T extends QrResponse>(response: Response, action: string): Promise<T> {
  if (response.status === 401) throw new Error("POS 로그인 정보가 만료되었습니다. 다시 로그인해 주세요.");
  if (response.status === 403) throw new Error("POS QR 주문 조회 권한이 거부되었습니다. 관리자에게 HTTP 403을 알려 주세요.");
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(`${action} 응답 형식이 올바르지 않습니다. (HTTP ${response.status})`);
  }
  let payload: T;
  try { payload = await response.json() as T; }
  catch { throw new Error(`${action} 응답을 읽지 못했습니다. (HTTP ${response.status})`); }
  if (!response.ok || !payload.success) throw new Error(payload.message ?? `${action}에 실패했습니다. (HTTP ${response.status})`);
  return payload;
}
