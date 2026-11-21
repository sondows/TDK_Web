import "server-only";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type { QrAccessAction } from "@/lib/qr-access-analysis";

export type QrAccessFailureType = "RETIRED_QR" | "QR_DISABLED" | "TABLE_NOT_LINKED" | "TABLE_INACTIVE" | "QR_LINK_CHANGED" | "SESSION_TABLE_MISMATCH" | "SESSION_ISSUE_FAILED" | "AUTH_ERROR";
const ACCESS_LOG_WRITE_TIMEOUT_MS = 250;

export async function recordQrAccess(qrCodeId: number, actionType: QrAccessAction, failureType?: QrAccessFailureType) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = db.insert(auditLogs).values({
    actionType,
    entityType: "QR_CODE",
    entityId: qrCodeId,
    description: actionType === "QR_ACCESS_FAILED" ? "reason=" + (failureType ?? "AUTH_ERROR") : null,
  }).then(() => "WRITTEN" as const).catch(error => {
    console.error("QR access record write failed", { code: (error as { code?: string }).code });
    return "FAILED" as const;
  });
  const completed = await Promise.race([write, new Promise<"TIMEOUT">(resolve => { timer = setTimeout(() => resolve("TIMEOUT"), ACCESS_LOG_WRITE_TIMEOUT_MS); })]);
  if (timer) clearTimeout(timer);
  if (completed === "TIMEOUT") console.error("QR access record write timed out", { qrCodeId, actionType });
}
