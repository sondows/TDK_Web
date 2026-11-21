import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, diningTables, qrCodeDailyCounters, qrCodes, qrSessions, qrTableLinks } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { createQrIdentifier } from "@/lib/qr-order-auth";
import { formatQrManagementNumber, qrIssueDateInSeoul } from "@/lib/qr-management-number";
import { analyzeQrAccessAnomalies, QR_ACCESS_ACTIONS, failureTypeFromDescription } from "@/lib/qr-access-analysis";
import { getBusinessHoursStatus } from "@/lib/qr-business-hours";
import { getQrBusinessHoursSettings } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";
const ACCESS_RECORD_LIMIT = 10_000;
const qrHistoryActions = ["QR_TABLE_ASSIGN", "QR_TARGET_ASSIGN", "QR_RETIRE", "QR_RETIRED_BY_REPLACEMENT", "QR_UNASSIGN"];

export async function GET() {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const [rows, tables] = await Promise.all([db.select({ qrCodeId: qrCodes.qrCodeId, managementNumber: qrCodes.managementNumber, targetType: qrCodes.targetType,
    status: qrCodes.status, createdAt: qrCodes.createdAt, updatedAt: qrCodes.updatedAt, tableId: qrTableLinks.tableId, tableNo: diningTables.tableNo })
    .from(qrCodes).leftJoin(qrTableLinks, eq(qrTableLinks.qrCodeId, qrCodes.qrCodeId))
    .leftJoin(diningTables, eq(diningTables.tableId, qrTableLinks.tableId)).orderBy(asc(qrCodes.createdAt), asc(qrCodes.qrCodeId)),
    db.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo, isActive: diningTables.isActive }).from(diningTables).orderBy(asc(diningTables.sortOrder), asc(diningTables.tableNo))]);
  const retiredIds = rows.filter(row => row.status === "RETIRED").map(row => row.qrCodeId);
  const historyRows = retiredIds.length ? await db.select({ entityId: auditLogs.entityId, actionType: auditLogs.actionType, description: auditLogs.description, createdAt: auditLogs.createdAt })
    .from(auditLogs).where(and(eq(auditLogs.entityType, "QR_CODE"), inArray(auditLogs.entityId, retiredIds), inArray(auditLogs.actionType, qrHistoryActions))).orderBy(asc(auditLogs.createdAt)) : [];
  const historyByQr = new Map<number, Array<{ actionType: string; description: string | null; createdAt: Date }>>();
  for (const row of historyRows) {
    if (row.entityId === null) continue;
    const item = { actionType: row.actionType, description: row.description?.replace(/[A-Za-z0-9]{16}/g, "[QR token]") ?? null, createdAt: row.createdAt };
    const history = historyByQr.get(Number(row.entityId)) ?? [];
    history.push(item);
    historyByQr.set(Number(row.entityId), history);
  }

  const accessRows = await db.select({ auditLogId: auditLogs.auditLogId, entityId: auditLogs.entityId, actionType: auditLogs.actionType, description: auditLogs.description, createdAt: auditLogs.createdAt })
    .from(auditLogs).where(and(eq(auditLogs.entityType, "QR_CODE"), isNotNull(auditLogs.entityId), inArray(auditLogs.actionType, [...QR_ACCESS_ACTIONS])))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.auditLogId)).limit(ACCESS_RECORD_LIMIT);
  let hoursSettings: Awaited<ReturnType<typeof getQrBusinessHoursSettings>> | null = null;
  try { hoursSettings = await getQrBusinessHoursSettings(); } catch { /* no guessed operating hours */ }
  const recordsByQr = new Map<number, Array<{ auditLogId: number; actionType: string; occurredAt: Date; failureType: string | null; outsideBusinessHours: boolean }>>();
  for (const row of accessRows) {
    if (row.entityId === null) continue;
    let outsideBusinessHours = false;
    if (hoursSettings && row.createdAt instanceof Date) {
      const state = getBusinessHoursStatus(hoursSettings.weekly, hoursSettings.specialHours, row.createdAt,
        hoursSettings.closedDates, hoursSettings.holidayRules, hoursSettings.todayOverride).state;
      outsideBusinessHours = state !== "OPEN" && state !== "NO_HOURS";
    }
    const id = Number(row.entityId);
    const records = recordsByQr.get(id) ?? [];
    records.push({ auditLogId: Number(row.auditLogId), actionType: row.actionType, occurredAt: row.createdAt,
      failureType: failureTypeFromDescription(row.description), outsideBusinessHours });
    recordsByQr.set(id, records);
  }
  const anomaliesByQr = new Map<number, string[]>();
  for (const [id, records] of recordsByQr) {
    const anomalies = analyzeQrAccessAnomalies(records);
    const labels = [...new Set([...anomalies.values()].flat())];
    if (labels.length) anomaliesByQr.set(id, labels);
  }
  const tableQrIds = new Set(rows.filter(row => row.targetType === "TABLE_ORDER").map(row => Number(row.qrCodeId)));
  for (const [id, auditHistory] of historyByQr) {
    if (auditHistory.some(item => item.actionType === "QR_TABLE_ASSIGN")) tableQrIds.add(id);
  }
  return Response.json({ success: true, tables: tables.filter(table => table.isActive === 1).map(table => ({ tableId: Number(table.tableId), tableNo: table.tableNo })),
    codes: rows.map(row => {
      const qrCodeId = Number(row.qrCodeId);
      return { ...row, status: row.status === "UNUSED" && row.targetType !== "UNASSIGNED" ? "IN_USE" : row.status,
        qrCodeId, tableId: row.tableId === null ? null : Number(row.tableId), history: historyByQr.get(qrCodeId) ?? [],
        attentionRequired: tableQrIds.has(qrCodeId) && Boolean(anomaliesByQr.get(qrCodeId)?.length),
        attentionLabels: tableQrIds.has(qrCodeId) ? anomaliesByQr.get(qrCodeId) ?? [] : [] };
    }), accessEventsTruncated: accessRows.length >= ACCESS_RECORD_LIMIT }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as { count?: unknown } | null;
  const count = Number(body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) return Response.json({ success: false, message: "발행 수량은 1~500개로 입력해 주세요." }, { status: 400 });
  try {
    const issueDate = qrIssueDateInSeoul(new Date());
    await db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO qr_code_daily_counters (issue_date, last_serial)
        VALUES (${issueDate}, 0)
        ON DUPLICATE KEY UPDATE last_serial = qr_code_daily_counters.last_serial`);
      const [counter] = await tx.select({ lastSerial: qrCodeDailyCounters.lastSerial })
        .from(qrCodeDailyCounters).where(eq(qrCodeDailyCounters.issueDate, issueDate)).for("update").limit(1);
      if (!counter) throw new Error("COUNTER_NOT_FOUND");
      const firstSerial = Number(counter.lastSerial) + 1;
      const lastSerial = Number(counter.lastSerial) + count;
      if (!Number.isSafeInteger(lastSerial) || lastSerial > 4_294_967_295) throw new Error("DAILY_SERIAL_LIMIT");
      await tx.update(qrCodeDailyCounters).set({ lastSerial }).where(eq(qrCodeDailyCounters.issueDate, issueDate));
      const rows = Array.from({ length: count }, (_, index) => ({
        identifier: createQrIdentifier(),
        managementNumber: formatQrManagementNumber(issueDate, firstSerial + index),
        targetType: "UNASSIGNED" as const,
        status: "UNUSED" as const,
        createdByStaffId: auth.staff.staffId,
        updatedByStaffId: auth.staff.staffId,
      }));
      await tx.insert(qrCodes).values(rows);
      await tx.insert(auditLogs).values({ staffId: auth.staff.staffId, actionType: "QR_BULK_ISSUE", entityType: "QR_CODE", description: `Issued ${rows.length} QR stickers` });
    });
    return Response.json({ success: true, issued: count }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "DAILY_SERIAL_LIMIT") {
      return Response.json({ success: false, message: "해당 날짜의 QR 관리번호 한도를 초과했습니다." }, { status: 409 });
    }
    return Response.json({ success: false, message: "QR 발행에 실패했습니다. 다시 시도해 주세요." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as { qrCodeId?: unknown; action?: unknown; tableId?: unknown; targetType?: unknown } | null;
  const qrCodeId = Number(body?.qrCodeId);
  if (!Number.isSafeInteger(qrCodeId) || qrCodeId <= 0) return Response.json({ success: false, message: "QR 번호가 유효하지 않습니다." }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [qr] = await tx.select().from(qrCodes).where(eq(qrCodes.qrCodeId, qrCodeId)).for("update").limit(1);
      if (!qr) throw new Error("NOT_FOUND");
      if (qr.status === "RETIRED") throw new Error("RETIRED");
      const now = new Date();
      const closeUnboundCustomers = async (tableId: number) => {
        await tx.update(qrSessions).set({ status: "CLOSED", closedAt: now })
          .where(and(eq(qrSessions.tableId, tableId), isNull(qrSessions.sessionId), eq(qrSessions.status, "ACTIVE")));
      };
      if (body?.action === "RETIRE") {
        const [link] = await tx.select({ tableId: qrTableLinks.tableId }).from(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId)).for("update").limit(1);
        if (link) await closeUnboundCustomers(Number(link.tableId));
        await tx.delete(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId));
        await tx.update(qrCodes).set({ targetType: "UNASSIGNED", status: "RETIRED", updatedByStaffId: auth.staff.staffId, updatedAt: now }).where(eq(qrCodes.qrCodeId, qrCodeId));
        await tx.insert(auditLogs).values({ staffId: auth.staff.staffId, actionType: "QR_RETIRE", entityType: "QR_CODE", entityId: qrCodeId, description: `Retired QR ${qr.managementNumber}` });
        return;
      }
      const targetType = body?.targetType;
      if (targetType === "TABLE_ORDER") {
        if (qr.status === "LOCKED") throw new Error("LEGACY_LOCKED");
        const tableId = Number(body?.tableId);
        if (!Number.isSafeInteger(tableId) || tableId <= 0) throw new Error("INVALID_TABLE");
        await tx.select({ tableId: diningTables.tableId }).from(diningTables).where(eq(diningTables.tableId, tableId)).for("update").limit(1);
        const [table] = await tx.select({ tableId: diningTables.tableId }).from(diningTables)
          .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1))).limit(1);
        if (!table) throw new Error("NOT_FOUND_TABLE");
        const [oldLink] = await tx.select({ qrCodeId: qrTableLinks.qrCodeId }).from(qrTableLinks).where(eq(qrTableLinks.tableId, tableId)).for("update").limit(1);
        if (oldLink && Number(oldLink.qrCodeId) === qrCodeId) return;
        await closeUnboundCustomers(tableId);
        let retiredPreviousNumber: string | null = null;
        if (oldLink) {
          const [old] = await tx.select({ qrCodeId: qrCodes.qrCodeId, managementNumber: qrCodes.managementNumber }).from(qrCodes).where(eq(qrCodes.qrCodeId, oldLink.qrCodeId)).for("update").limit(1);
          if (old) {
            retiredPreviousNumber = old.managementNumber;
            await tx.delete(qrTableLinks).where(eq(qrTableLinks.qrCodeId, old.qrCodeId));
            await tx.update(qrCodes).set({ targetType: "UNASSIGNED", status: "RETIRED", updatedByStaffId: auth.staff.staffId, updatedAt: now }).where(eq(qrCodes.qrCodeId, old.qrCodeId));
            await tx.insert(auditLogs).values({ staffId: auth.staff.staffId, actionType: "QR_RETIRED_BY_REPLACEMENT", entityType: "QR_CODE", entityId: old.qrCodeId, description: `Replaced by QR ${qr.managementNumber}` });
          }
        }
        await tx.delete(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId));
        await tx.insert(qrTableLinks).values({ qrCodeId, tableId, assignedByStaffId: auth.staff.staffId });
        await tx.update(qrCodes).set({ targetType: "TABLE_ORDER", status: "IN_USE", updatedByStaffId: auth.staff.staffId, updatedAt: now }).where(eq(qrCodes.qrCodeId, qrCodeId));
        await tx.insert(auditLogs).values({ staffId: auth.staff.staffId, actionType: "QR_TABLE_ASSIGN", entityType: "QR_CODE", entityId: qrCodeId, description: `Assigned QR ${qr.managementNumber} to table ${tableId}${retiredPreviousNumber ? `; retired ${retiredPreviousNumber}` : ""}` });
        return;
      }
      if (targetType === "GUEST_MENU" || targetType === "WAITING") {
        if (qr.status === "LOCKED") throw new Error("LEGACY_LOCKED");
        const [link] = await tx.select({ tableId: qrTableLinks.tableId }).from(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId)).for("update").limit(1);
        if (link) await closeUnboundCustomers(Number(link.tableId));
        await tx.delete(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId));
        await tx.update(qrCodes).set({ targetType, status: "IN_USE", updatedByStaffId: auth.staff.staffId, updatedAt: now }).where(eq(qrCodes.qrCodeId, qrCodeId));
        await tx.insert(auditLogs).values({ staffId: auth.staff.staffId, actionType: "QR_TARGET_ASSIGN", entityType: "QR_CODE", entityId: qrCodeId, description: `Assigned QR ${qr.managementNumber} to ${targetType}` });
        return;
      }
      if (targetType === "UNASSIGNED") {
        if (qr.status === "LOCKED") throw new Error("LEGACY_LOCKED");
        const [link] = await tx.select({ tableId: qrTableLinks.tableId }).from(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId)).for("update").limit(1);
        if (link) await closeUnboundCustomers(Number(link.tableId));
        await tx.delete(qrTableLinks).where(eq(qrTableLinks.qrCodeId, qrCodeId));
        const wasUsed = qr.status === "IN_USE" || qr.targetType !== "UNASSIGNED";
        const status = wasUsed ? "RETIRED" : "UNUSED";
        await tx.update(qrCodes).set({ targetType, status, updatedByStaffId: auth.staff.staffId, updatedAt: now }).where(eq(qrCodes.qrCodeId, qrCodeId));
        await tx.insert(auditLogs).values({ staffId: auth.staff.staffId, actionType: wasUsed ? "QR_RETIRE" : "QR_UNASSIGN", entityType: "QR_CODE", entityId: qrCodeId, description: `${wasUsed ? "Retired used" : "Kept unused"} QR ${qr.managementNumber}` });
        return;
      }
      throw new Error("INVALID_ACTION");
    });
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "NOT_FOUND" || message === "NOT_FOUND_TABLE" ? 404 : message === "INVALID_TABLE" || message === "INVALID_ACTION" ? 400 : 409;
    const userMessage = message === "RETIRED" ? "폐기된 QR은 다시 연결할 수 없습니다." : message === "LEGACY_LOCKED" ? "기존 잠금 상태의 QR은 변경할 수 없습니다. 전체 목록에서 상태를 확인해 주세요." : status === 404 ? "QR 또는 테이블을 찾을 수 없습니다." : status === 400 ? "요청 값이 유효하지 않습니다." : "QR 연결에 실패했습니다. 새로고침 후 다시 시도해 주세요.";
    return Response.json({ success: false, message: userMessage }, { status });
  }
}
