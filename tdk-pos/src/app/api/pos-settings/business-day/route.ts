import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminWrite } from "@/lib/admin-auth";
import { BUSINESS_CUTOFF_KEY, OPENING_CASH_ENABLED_KEY } from "@/lib/business-session";
import { isValidCutoffTime } from "@/lib/business-date";

async function settings() {
  const rows = await db.select({ key: systemSettings.settingKey, value: systemSettings.settingValue }).from(systemSettings);
  const values = new Map(rows.map(row => [row.key, row.value]));
  return { cutoffTime: values.get(BUSINESS_CUTOFF_KEY) ?? "06:00", openingCashEnabled: values.get(OPENING_CASH_ENABLED_KEY) === "1" };
}

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  return Response.json({ success: true, ...await settings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const writeDenied = await requireAdminWrite(); if (writeDenied) return writeDenied;
  const admin = await getCurrentAdminStaff();
  if (!admin) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { cutoffTime?: unknown; openingCashEnabled?: unknown } | null;
  const hasCutoffTime = !!body && Object.prototype.hasOwnProperty.call(body, "cutoffTime");
  const hasOpeningCashEnabled = !!body && Object.prototype.hasOwnProperty.call(body, "openingCashEnabled");
  if (!body || (!hasCutoffTime && !hasOpeningCashEnabled)
    || (hasCutoffTime && !isValidCutoffTime(body.cutoffTime))
    || (hasOpeningCashEnabled && typeof body.openingCashEnabled !== "boolean"))
    return Response.json({ success: false, message: "영업일 설정값을 확인해 주세요." }, { status: 400 });
  const cutoffTime = hasCutoffTime ? body.cutoffTime as string : undefined;
  const openingCashEnabled = hasOpeningCashEnabled ? body.openingCashEnabled as boolean : undefined;
  await db.transaction(async tx => {
    const values: Array<[string, string]> = [];
    if (cutoffTime !== undefined) values.push([BUSINESS_CUTOFF_KEY, cutoffTime]);
    if (openingCashEnabled !== undefined) values.push([OPENING_CASH_ENABLED_KEY, openingCashEnabled ? "1" : "0"]);
    for (const [key, value] of values) {
      await tx.insert(systemSettings).values({ settingKey: key, settingValue: value, updatedByStaffId: admin.staffId })
        .onDuplicateKeyUpdate({ set: { settingValue: value, updatedByStaffId: admin.staffId, updatedAt: new Date() } });
    }
  });
  return Response.json({ success: true, ...(cutoffTime !== undefined ? { cutoffTime } : {}), ...(openingCashEnabled !== undefined ? { openingCashEnabled } : {}) });
}
