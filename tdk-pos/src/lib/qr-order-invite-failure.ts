export type QrOrderInviteFailureKind = "CLOSED" | "EXPIRED" | "FULL";

const QR_ORDER_INVITE_FAILURES = {
  CLOSED: { code: "SESSION_CLOSED", message: "테이블 이용이 종료되어 초대할 수 없습니다." },
  EXPIRED: { code: "SESSION_EXPIRED", message: "테이블 이용 시간이 만료되었습니다." },
  FULL: { code: "INVITE_FULL", message: "함께 주문할 수 있는 인원을 초과했습니다." },
} as const;

export function getQrOrderInviteFailure(kind: QrOrderInviteFailureKind) {
  return QR_ORDER_INVITE_FAILURES[kind];
}
