import { inArray, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "@/db";
import { diningTables, qrCodePreparations, qrCodes, qrTableLinks } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { createQrZipStream, publicQrUrl } from "@/lib/admin-qr-export";
import { qrIssueDateInSeoul } from "@/lib/qr-management-number";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as { qrCodeIds?: unknown; background?: unknown } | null;
  if (!Array.isArray(body?.qrCodeIds) || body.qrCodeIds.length < 1 || body.qrCodeIds.length > 500) {
    return Response.json({ success: false, message: "내보낼 QR을 1~500개 선택해 주세요." }, { status: 400 });
  }
  const ids = body.qrCodeIds.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    return Response.json({ success: false, message: "QR 선택 값이 유효하지 않습니다." }, { status: 400 });
  }
  const background = body.background === undefined ? "transparent" : body.background;
  if (background !== "transparent" && background !== "white") {
    return Response.json({ success: false, message: "배경 옵션이 유효하지 않습니다." }, { status: 400 });
  }
  const preparedTable = alias(diningTables, "prepared_table");
  const activeTable = alias(diningTables, "active_table");
  const rows = await db.select({ qrCodeId: qrCodes.qrCodeId, identifier: qrCodes.identifier, managementNumber: qrCodes.managementNumber, status: qrCodes.status,
    tableNo: sql<string | null>`COALESCE(${preparedTable.tableNo}, ${activeTable.tableNo})` })
    .from(qrCodes).leftJoin(qrCodePreparations, eq(qrCodePreparations.qrCodeId, qrCodes.qrCodeId))
    .leftJoin(preparedTable, eq(preparedTable.tableId, qrCodePreparations.tableId))
    .leftJoin(qrTableLinks, eq(qrTableLinks.qrCodeId, qrCodes.qrCodeId))
    .leftJoin(activeTable, eq(activeTable.tableId, qrTableLinks.tableId)).where(inArray(qrCodes.qrCodeId, ids));
  if (rows.length !== ids.length) return Response.json({ success: false, message: "선택한 QR 중 일부를 찾을 수 없습니다." }, { status: 404 });
  if (rows.some(row => row.status === "RETIRED")) return Response.json({ success: false, message: "폐기된 QR은 일괄 내보낼 수 없습니다. 목록을 새로고침해 주세요." }, { status: 409 });
  const byId = new Map(rows.map(row => [Number(row.qrCodeId), row]));
  let entries: Array<{ fileName: string; targetUrl: string; label: string | null }>;
  try {
    entries = ids.map(id => {
      const row = byId.get(id)!;
      return { fileName: `${row.managementNumber}.png`, targetUrl: publicQrUrl(row.identifier), label: row.tableNo ? `${row.tableNo}T` : null };
    });
  } catch {
    return Response.json({ success: false, message: "QR 공개 주소 설정을 확인해 주세요." }, { status: 503 });
  }
  const date = qrIssueDateInSeoul(new Date()).replaceAll("-", "");
  return new Response(createQrZipStream(entries, background), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="TDKON_QR_${date}.zip"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
