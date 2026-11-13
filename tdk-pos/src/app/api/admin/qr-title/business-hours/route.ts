import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import {
  businessClosureSettingKey, businessHolidaySettingKey, businessHoursError, businessHoursSettingKey, businessSpecialSettingKey,
  dateRangeError, isBusinessDate, QR_BUSINESS_CLOSURE_PREFIX, QR_BUSINESS_HOLIDAY_PREFIX, QR_BUSINESS_MODE_KEY,
  QR_BUSINESS_SPECIAL_PREFIX, serializeBusinessHours, type BusinessDateClosure, type BusinessHolidayRule,
  type BusinessHours, type BusinessHoursMode, type SpecialBusinessHours,
} from "@/lib/qr-business-hours";
import { getQrBusinessHoursSettings } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";

async function authorize() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) return { error: Response.json({ success: false, message: "ADM 권한이 필요합니다." }, { status: 403 }) };
  return { staff };
}

export async function GET() {
  const auth = await authorize();
  if (auth.error) return auth.error;
  try {
    const hours = await getQrBusinessHoursSettings();
    return Response.json({ success: true, ...hours }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "매장 영업시간 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { weekly?: unknown; specialHours?: unknown; businessHoursMode?: unknown; closedDates?: unknown; holidayRules?: unknown };
    const mode = body.businessHoursMode as BusinessHoursMode;
    if (!(mode === "DAILY" || mode === "WEEKEND" || mode === "WEEKLY") ||
      !Array.isArray(body.weekly) || body.weekly.length !== 7 || body.weekly.some(value => !value || typeof value !== "object") ||
      !Array.isArray(body.specialHours) || body.specialHours.length > 100 ||
      !Array.isArray(body.closedDates) || body.closedDates.length > 100 ||
      !Array.isArray(body.holidayRules) || body.holidayRules.length > 100) {
      return Response.json({ success: false, message: "요일별 또는 특별 영업시간 입력을 확인해 주세요." }, { status: 400 });
    }
    const weekly = body.weekly as BusinessHours[];
    for (const hours of weekly) {
      const error = businessHoursError(hours);
      if (error) return Response.json({ success: false, message: error }, { status: 400 });
    }
    const specials = body.specialHours as SpecialBusinessHours[];
    if (specials.some(item => !item || !isBusinessDate(item.date) || !item.hours || businessHoursError(item.hours, true)) ||
      new Set(specials.map(item => item.date)).size !== specials.length) {
      return Response.json({ success: false, message: "특별 영업일은 날짜별 휴무 또는 올바른 영업시간을 입력해 주세요." }, { status: 400 });
    }
    const sameHours = (a: BusinessHours, b: BusinessHours) => JSON.stringify(a) === JSON.stringify(b);
    if (mode === "DAILY" && weekly.some(hours => !sameHours(hours, weekly[0]))) {
      return Response.json({ success: false, message: "매일 같은 방식에서는 월~일 영업시간이 모두 같아야 합니다." }, { status: 400 });
    }
    if (mode === "WEEKEND" && (weekly.slice(1, 6).some(hours => !sameHours(hours, weekly[1])) || !sameHours(weekly[0], weekly[6]))) {
      return Response.json({ success: false, message: "평일/주말 설정값을 확인해 주세요." }, { status: 400 });
    }

    const closures = body.closedDates as BusinessDateClosure[];
    if (closures.some(item => !item || !/^[a-zA-Z0-9-]{1,36}$/.test(item.id) || dateRangeError(item.startDate, item.endDate) || typeof item.reason !== "string" || [...item.reason].length > 80) ||
      new Set(closures.map(item => item.id)).size !== closures.length ||
      closures.some((item, index) => closures.slice(index + 1).some(other => item.startDate <= other.endDate && other.startDate <= item.endDate))) {
      return Response.json({ success: false, message: "날짜 지정 휴무의 기간 또는 중복을 확인해 주세요." }, { status: 400 });
    }
    const holidays = body.holidayRules as BusinessHolidayRule[];
    if (holidays.some(item => !item || !/^[a-zA-Z0-9-]{1,36}$/.test(item.id) || dateRangeError(item.startDate, item.endDate) ||
      !["REGULAR", "CLOSED", "CUSTOM"].includes(item.mode) || !item.hours || businessHoursError(item.hours, item.mode === "CUSTOM")) ||
      new Set(holidays.map(item => item.id)).size !== holidays.length ||
      holidays.some((item, index) => holidays.slice(index + 1).some(other => item.startDate <= other.endDate && other.startDate <= item.endDate))) {
      return Response.json({ success: false, message: "법정공휴일 날짜 또는 영업 설정이 겹치거나 올바르지 않습니다." }, { status: 400 });
    }
    const conflictingSpecial = specials.find(item => closures.some(range => item.date >= range.startDate && item.date <= range.endDate));
    if (conflictingSpecial) return Response.json({ success: false, message: `${conflictingSpecial.date} 날짜가 임시 영업시간과 날짜 지정 휴무에 중복 등록되어 있습니다.` }, { status: 400 });
    await db.transaction(async tx => {
      await tx.insert(systemSettings).values({ settingKey: QR_BUSINESS_MODE_KEY, settingValue: mode, updatedByStaffId: auth.staff.staffId })
        .onDuplicateKeyUpdate({ set: { settingValue: mode, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() } });

      for (let day = 0; day < 7; day++) {
        const key = businessHoursSettingKey(day);
        const hours = weekly[day];
        if (!hours.closed && !hours.openTime && !hours.closeTime) {
          await tx.delete(systemSettings).where(eq(systemSettings.settingKey, key));
          continue;
        }
        const settingValue = serializeBusinessHours(hours);
        await tx.insert(systemSettings).values({ settingKey: key, settingValue, updatedByStaffId: auth.staff.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() } });
      }

      const oldRows = await tx.select({ settingKey: systemSettings.settingKey }).from(systemSettings)
        .where(sql`LEFT(${systemSettings.settingKey}, ${QR_BUSINESS_SPECIAL_PREFIX.length}) = ${QR_BUSINESS_SPECIAL_PREFIX}`).for("update");
      const nextKeys = new Set(specials.map(item => businessSpecialSettingKey(item.date)));
      const removedKeys = oldRows.map(row => row.settingKey).filter(key => !nextKeys.has(key));
      if (removedKeys.length) await tx.delete(systemSettings).where(inArray(systemSettings.settingKey, removedKeys));
      for (const item of specials) {
        const key = businessSpecialSettingKey(item.date);
        const settingValue = serializeBusinessHours(item.hours);
        await tx.insert(systemSettings).values({ settingKey: key, settingValue, updatedByStaffId: auth.staff.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() } });
      }

      const saveCollection = async <T extends { id: string }>(prefix: string, values: T[], keyFor: (id: string) => string, serialize: (value: T) => string) => {
        const old = await tx.select({ settingKey: systemSettings.settingKey }).from(systemSettings)
          .where(sql`LEFT(${systemSettings.settingKey}, ${prefix.length}) = ${prefix}`).for("update");
        const nextKeys = new Set(values.map(item => keyFor(item.id)));
        const removed = old.map(row => row.settingKey).filter(key => !nextKeys.has(key));
        if (removed.length) await tx.delete(systemSettings).where(inArray(systemSettings.settingKey, removed));
        for (const item of values) {
          const settingValue = serialize(item);
          if (settingValue.length > 255) throw new Error("Setting value exceeds column length");
          await tx.insert(systemSettings).values({ settingKey: keyFor(item.id), settingValue, updatedByStaffId: auth.staff.staffId })
            .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() } });
        }
      };
      await saveCollection(QR_BUSINESS_CLOSURE_PREFIX, closures, businessClosureSettingKey, item => JSON.stringify({ startDate: item.startDate, endDate: item.endDate, reason: item.reason.trim() }));
      await saveCollection(QR_BUSINESS_HOLIDAY_PREFIX, holidays, businessHolidaySettingKey, item => JSON.stringify({ startDate: item.startDate, endDate: item.endDate, mode: item.mode, hours: item.hours }));
    });

    const hours = await getQrBusinessHoursSettings();
    return Response.json({ success: true, ...hours }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR business hours save failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "영업시간 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
