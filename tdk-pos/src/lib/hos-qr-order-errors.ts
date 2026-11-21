export type HosQrOrderOperation = "load" | "decision";

export function getHosQrOrderResponseError(
  status: number,
  serverMessage: unknown,
  operation: HosQrOrderOperation,
) {
  if (status === 401) return "로그인 시간이 만료되었습니다. 다시 로그인해 주세요.";
  if (status === 403) return "QR 주문에 접근할 권한이 없습니다.";
  if (status >= 500) return "QR 주문 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  if (typeof serverMessage === "string" && serverMessage.trim()) return serverMessage;
  return operation === "load"
    ? "QR 주문 목록을 불러오지 못했습니다."
    : "QR 주문을 처리하지 못했습니다.";
}

export function getHosQrOrderNetworkError(operation: HosQrOrderOperation) {
  return operation === "load"
    ? "네트워크 연결을 확인한 뒤 QR 주문 목록을 다시 불러와 주세요."
    : "네트워크 연결을 확인한 뒤 QR 주문을 다시 처리해 주세요.";
}
