type QrAccessAnomaly = "OUTSIDE_BUSINESS_HOURS" | "REPEATED_ACCESS" | "REPEATED_FAILURE" | "RETIRED_QR_ACCESS";
const QR_ACCESS_ACTIONS = ["QR_ACCESS_ISSUED", "QR_ACCESS_REUSED", "QR_ACCESS_FAILED"];
function failureTypeFromDescription(description: string | null | undefined) { return description?.match(/^reason=([A-Z_]+)$/)?.[1] ?? null; }

export const QR_HISTORY_AUDIT_ACTIONS = [
  "QR_TABLE_ASSIGN",
  "QR_TARGET_ASSIGN",
  "QR_RETIRE",
  "QR_RETIRED_BY_REPLACEMENT",
  "QR_UNASSIGN",
  ...QR_ACCESS_ACTIONS,
] as const;

export type QrHistoryAuditAction = typeof QR_HISTORY_AUDIT_ACTIONS[number];
export type QrHistoryAuditRow = { auditLogId: number; actionType: string; createdAt: Date | null; description: string | null; outsideBusinessHours?: boolean };
export type QrUsageHistoryEvent = { auditLogId: number | null; eventType: string; happenedAt: string; table: string | null; detail: string | null; anomalies: QrAccessAnomaly[] };

function toIso(value: Date | null): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

const failureLabel: Record<string, string> = {
  RETIRED_QR: "폐기 QR 접속 시도",
  QR_DISABLED: "비활성 QR",
  TABLE_NOT_LINKED: "연결 테이블 없음",
  TABLE_INACTIVE: "비활성 테이블",
  QR_LINK_CHANGED: "테이블 연결 변경 중 인증 실패",
  SESSION_TABLE_MISMATCH: "다른 테이블 인증 세션",
  SESSION_ISSUE_FAILED: "보안토큰 발급 실패",
  AUTH_ERROR: "인증 처리 오류",
};

export function buildQrUsageHistoryEvents(issuedAt: Date, auditRows: QrHistoryAuditRow[], anomalyMap = new Map<number, QrAccessAnomaly[]>()): QrUsageHistoryEvent[] {
  const issueTime = toIso(issuedAt);
  const events: Array<QrUsageHistoryEvent | null> = [
    issueTime ? { auditLogId: null, eventType: "QR 발행", happenedAt: issueTime, table: null, detail: "관리번호 생성 기록", anomalies: [] } : null,
    ...auditRows.map(row => {
      const happenedAt = toIso(row.createdAt);
      if (!happenedAt || !QR_HISTORY_AUDIT_ACTIONS.includes(row.actionType as QrHistoryAuditAction)) return null;
      const description = row.description ?? "";
      const tableId = row.actionType === "QR_TABLE_ASSIGN" ? description.match(/\btable\s+(\d+)\b/i)?.[1] : undefined;
      const target = row.actionType === "QR_TARGET_ASSIGN" ? description.match(/\bto\s+(GUEST_MENU|WAITING)\b/i)?.[1] : undefined;
      const failureType = row.actionType === "QR_ACCESS_FAILED" ? failureTypeFromDescription(row.description) : null;
      const eventType = row.actionType === "QR_ACCESS_ISSUED" ? "QR 접속 · 신규 보안토큰 발급"
        : row.actionType === "QR_ACCESS_REUSED" ? "QR 접속 · 기존 인증 세션 재사용"
          : row.actionType === "QR_ACCESS_FAILED" ? "QR 인증 실패"
            : row.actionType === "QR_TABLE_ASSIGN" ? "테이블 연결 변경"
              : row.actionType === "QR_TARGET_ASSIGN" ? "QR 사용 대상 변경"
                : row.actionType === "QR_RETIRED_BY_REPLACEMENT" ? "다른 QR로 교체되어 폐기"
                  : row.actionType === "QR_UNASSIGN" ? "QR 연결 해제"
                    : "QR 폐기";
      return {
        auditLogId: row.auditLogId,
        eventType,
        happenedAt,
        table: tableId ? `테이블 ID ${tableId}` : null,
        detail: failureType ? failureLabel[failureType] ?? "인증 실패"
          : target === "GUEST_MENU" ? "매장 메뉴 QR로 지정"
            : target === "WAITING" ? "대기 QR로 지정"
              : row.actionType === "QR_RETIRED_BY_REPLACEMENT" ? "기존 QR 관리 기록"
                : null,
        anomalies: anomalyMap.get(row.auditLogId) ?? [],
      };
    }),
  ];
  return events.filter((event): event is QrUsageHistoryEvent => event !== null).sort((a, b) => Date.parse(b.happenedAt) - Date.parse(a.happenedAt));
}
