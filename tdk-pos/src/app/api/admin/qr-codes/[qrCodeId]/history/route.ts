import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, diningTables, qrCodes, qrTableLinks } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { analyzeQrAccessAnomalies, failureTypeFromDescription, QR_ACCESS_ACTIONS } from "@/lib/qr-access-analysis";
import { buildQrUsageHistoryEvents, QR_HISTORY_AUDIT_ACTIONS } from "@/lib/qr-usage-history";
import { getBusinessHoursStatus, isBusinessHoursConfigured } from "@/lib/qr-business-hours";
import { getQrBusinessHoursSettings } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";
const HISTORY_LIMIT = 200;
type RouteContext = { params: Promise<{ qrCodeId: string }> };
function iso(value: Date | null): string | null { return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null; }

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const { qrCodeId: rawId } = await params;
  const qrCodeId = Number(rawId);
  if (!Number.isSafeInteger(qrCodeId) || qrCodeId <= 0) return Response.json({ success: false, message: "QR 관리번호가 유효하지 않습니다." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const [qr] = await db.select({ qrCodeId: qrCodes.qrCodeId, managementNumber: qrCodes.managementNumber, status: qrCodes.status,
    targetType: qrCodes.targetType, createdAt: qrCodes.createdAt, tableNo: diningTables.tableNo })
    .from(qrCodes).leftJoin(qrTableLinks, eq(qrTableLinks.qrCodeId, qrCodes.qrCodeId))
    .leftJoin(diningTables, eq(diningTables.tableId, qrTableLinks.tableId)).where(eq(qrCodes.qrCodeId, qrCodeId)).limit(1);
  if (!qr) return Response.json({ success: false, message: "QR 관리번호를 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const [historyRows, accessRows, accessStats] = await Promise.all([
    db.select({ auditLogId: auditLogs.auditLogId, actionType: auditLogs.actionType, createdAt: auditLogs.createdAt, description: auditLogs.description })
      .from(auditLogs).where(and(eq(auditLogs.entityType, "QR_CODE"), eq(auditLogs.entityId, qrCodeId), inArray(auditLogs.actionType, [...QR_HISTORY_AUDIT_ACTIONS])))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.auditLogId)).limit(HISTORY_LIMIT + 1),
    db.select({ auditLogId: auditLogs.auditLogId, actionType: auditLogs.actionType, createdAt: auditLogs.createdAt, description: auditLogs.description })
      .from(auditLogs).where(and(eq(auditLogs.entityType, "QR_CODE"), eq(auditLogs.entityId, qrCodeId), inArray(auditLogs.actionType, [...QR_ACCESS_ACTIONS])))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.auditLogId)).limit(HISTORY_LIMIT + 1),
    db.select({ attempts: sql<number>`COUNT(*)`, firstUseAt: sql<Date | null>`MIN(${auditLogs.createdAt})`, recentUseAt: sql<Date | null>`MAX(${auditLogs.createdAt})`,
      issued: sql<number>`SUM(CASE WHEN ${auditLogs.actionType} = 'QR_ACCESS_ISSUED' THEN 1 ELSE 0 END)`,
      reused: sql<number>`SUM(CASE WHEN ${auditLogs.actionType} = 'QR_ACCESS_REUSED' THEN 1 ELSE 0 END)`,
      failures: sql<number>`SUM(CASE WHEN ${auditLogs.actionType} = 'QR_ACCESS_FAILED' THEN 1 ELSE 0 END)` })
      .from(auditLogs).where(and(eq(auditLogs.entityType, "QR_CODE"), eq(auditLogs.entityId, qrCodeId), inArray(auditLogs.actionType, [...QR_ACCESS_ACTIONS]))).then(rows => rows[0]),
  ]);

  let hoursSettings: Awaited<ReturnType<typeof getQrBusinessHoursSettings>> | null = null;
  try { hoursSettings = await getQrBusinessHoursSettings(); } catch { /* unavailable settings are reported as unverified */ }
  const displayedAccessRows = accessRows.slice(0, HISTORY_LIMIT);
  const accessRecords = displayedAccessRows.map(row => {
    let outsideBusinessHours = false;
    if (hoursSettings && row.createdAt instanceof Date) {
      const state = getBusinessHoursStatus(hoursSettings.weekly, hoursSettings.specialHours, row.createdAt,
        hoursSettings.closedDates, hoursSettings.holidayRules, hoursSettings.todayOverride).state;
      outsideBusinessHours = state !== "OPEN" && state !== "NO_HOURS";
    }
    return { auditLogId: Number(row.auditLogId), actionType: row.actionType, occurredAt: row.createdAt,
      failureType: failureTypeFromDescription(row.description), outsideBusinessHours };
  });
  const anomalyMap = analyzeQrAccessAnomalies(accessRecords);
  const businessHoursConfigured = Boolean(hoursSettings && (isBusinessHoursConfigured(hoursSettings.weekly) || hoursSettings.specialHours.length > 0 || hoursSettings.closedDates.length > 0 || hoursSettings.holidayRules.length > 0));
  const hasAccess = Number(accessStats?.attempts ?? 0) > 0;
  const anomalyLabels = [...new Set([...anomalyMap.values()].flat())];
  const usage = hasAccess ? {
    firstUseAt: iso(accessStats.firstUseAt), recentUseAt: iso(accessStats.recentUseAt), attemptCount: Number(accessStats.attempts),
    successCount: Number(accessStats.issued ?? 0) + Number(accessStats.reused ?? 0), failureCount: Number(accessStats.failures ?? 0),
    anomalyCount: anomalyLabels.length, anomalyLabels, accessRecordAvailable: true,
  } : { firstUseAt: null, recentUseAt: null, attemptCount: null, successCount: null, failureCount: null,
    anomalyCount: null, anomalyLabels: [], accessRecordAvailable: false };

  const combinedRows = [...new Map([...historyRows, ...displayedAccessRows].map(row => [Number(row.auditLogId), row])).values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || Number(b.auditLogId) - Number(a.auditLogId));
  const events = buildQrUsageHistoryEvents(qr.createdAt, combinedRows.slice(0, HISTORY_LIMIT).map(row => ({ ...row, auditLogId: Number(row.auditLogId) })), anomalyMap);
  return Response.json({ success: true, qr: { qrCodeId: Number(qr.qrCodeId), managementNumber: qr.managementNumber,
    status: qr.status, targetType: qr.targetType, issuedAt: iso(qr.createdAt), currentTable: qr.tableNo }, usage, events,
    truncated: historyRows.length > HISTORY_LIMIT || accessRows.length > HISTORY_LIMIT || combinedRows.length > HISTORY_LIMIT,
    businessHoursEvaluated: Boolean(hoursSettings), businessHoursConfigured,
    eventAttributionNote: "이 화면의 접속기록은 기능 적용 시점 이후에 저장됩니다. 기존 고객 세션·주문·계산기록은 고정 QR 관리번호가 없어 연결할 수 없습니다.",
  }, { headers: { "Cache-Control": "no-store" } });
}
