import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
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
  const admin = await getCurrentAdminStaff();
  if (!admin) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { cutoffTime?: unknown; openingCashEnabled?: unknown } | null;
  if (!body || !isValidCutoffTime(body.cutoffTime) || typeof body.openingCashEnabled !== "boolean")
    return Response.json({ success: false, message: "영업일 설정값을 확인해 주세요." }, { status: 400 });
  const cutoffTime = body.cutoffTime;
  const openingCashEnabled = body.openingCashEnabled;
  await db.transaction(async tx => {
    for (const [key, value] of [[BUSINESS_CUTOFF_KEY, cutoffTime], [OPENING_CASH_ENABLED_KEY, openingCashEnabled ? "1" : "0"]] as const) {
      await tx.insert(systemSettings).values({ settingKey: key, settingValue: value, updatedByStaffId: admin.staffId })
        .onDuplicateKeyUpdate({ set: { settingValue: value, updatedByStaffId: admin.staffId, updatedAt: new Date() } });
    }
  });
  return Response.json({ success: true, cutoffTime, openingCashEnabled });
}
