import { db, pool } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { OPENING_CASH_ENABLED_KEY } from "@/lib/business-session";

async function settings() {
  const rows = await db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue }).from(systemSettings);
  const values = new Map(rows.map(row => [row.key, row.value]));
  return { openingCashEnabled: values.get(OPENING_CASH_ENABLED_KEY) === "1" };
}

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  return Response.json({ success: true, ...await settings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const writeDenied = await requireAdminAccess(); if (writeDenied) return writeDenied;
  const admin = await getCurrentAdminStaff();
  if (!admin) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { openingCashEnabled?: unknown } | null;
  const hasOpeningCashEnabled = !!body && Object.prototype.hasOwnProperty.call(body, "openingCashEnabled");
  if (!hasOpeningCashEnabled || typeof body?.openingCashEnabled !== "boolean")
    return Response.json({ success: false, message: "준비금 설정값을 확인해 주세요." }, { status: 400 });
  const openingCashEnabled = hasOpeningCashEnabled ? body.openingCashEnabled as boolean : undefined;
  if (openingCashEnabled) {
    try {
      await pool.query("SELECT cash_opening_fund_id FROM cash_opening_funds LIMIT 0");
    } catch (error) {
      console.error("영업준비금 테이블 확인 실패:", error);
      return Response.json({ success: false, message: "영업준비금 DB 테이블이 준비되지 않았습니다. 관리자에게 DB 마이그레이션을 요청해 주세요." }, { status: 503 });
    }
  }
  await db.transaction(async tx => {
    const values: Array<[string, string]> = [];
    if (openingCashEnabled !== undefined) values.push([OPENING_CASH_ENABLED_KEY, openingCashEnabled ? "1" : "0"]);
    for (const [key, value] of values) {
      await tx.insert(systemSettings).values({ settingKey: key, settingValue: value, updatedByStaffId: admin.staffId })
        .onDuplicateKeyUpdate({ set: { settingValue: value, updatedByStaffId: admin.staffId, updatedAt: new Date() } });
    }
  });
  return Response.json({ success: true, openingCashEnabled });
}
