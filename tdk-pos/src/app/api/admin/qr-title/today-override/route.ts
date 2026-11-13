import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import {
  businessHoursError, businessWeekday, getBusinessHoursStatus, getBusinessOperatingDate, getBusinessScheduleForDate,
  QR_BUSINESS_TODAY_OVERRIDE_KEY, QR_STORE_TIME_ZONE, type TodayBusinessOverride,
} from "@/lib/qr-business-hours";
import { getQrBusinessHoursSettings } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";

function isTime(value: unknown): value is string { return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function timeMinutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function seoulClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: QR_STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export async function PUT(request: Request) {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) return Response.json({ success: false, message: "ADM 권한이 필요합니다." }, { status: 403 });
  try {
    const body = await request.json() as {
      earlyClose?: null | { mode?: unknown; closeTime?: unknown };
      earlyBreak?: null | { mode?: unknown; startTime?: unknown; endTime?: unknown };
    };
    if (body.earlyClose !== null && body.earlyClose !== undefined &&
      !(body.earlyClose.mode === "NOW" || (body.earlyClose.mode === "AT" && isTime(body.earlyClose.closeTime)))) {
      return Response.json({ success: false, message: "조기 마감 방식을 확인해 주세요." }, { status: 400 });
    }
    if (body.earlyBreak !== null && body.earlyBreak !== undefined &&
      !(body.earlyBreak.mode === "NOW" ? isTime(body.earlyBreak.endTime) : body.earlyBreak.mode === "AT" && isTime(body.earlyBreak.startTime) && isTime(body.earlyBreak.endTime))) {
      return Response.json({ success: false, message: "오늘 브레이크타임을 확인해 주세요." }, { status: 400 });
    }
    if (!body.earlyClose && !body.earlyBreak) {
      await db.delete(systemSettings).where(eq(systemSettings.settingKey, QR_BUSINESS_TODAY_OVERRIDE_KEY));
      return Response.json({ success: true, todayOverride: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const now = new Date();
    const settings = await getQrBusinessHoursSettings(now);
    const businessDate = getBusinessOperatingDate(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules);
    const schedule = getBusinessScheduleForDate(settings.weekly, settings.specialHours, businessDate, businessWeekday(businessDate), settings.closedDates, settings.holidayRules);
    if (schedule.closed || businessHoursError(schedule, true)) {
      return Response.json({ success: false, message: "오늘은 휴무이거나 영업시간이 등록되지 않아 특별 설정을 적용할 수 없습니다." }, { status: 400 });
    }

    const clock = seoulClock(now);
    const currentMinute = Number(clock.hour) * 60 + Number(clock.minute);
    const currentTimeline = businessDate === `${clock.year}-${clock.month}-${clock.day}` ? currentMinute : currentMinute + 1440;
    let earlyClose: TodayBusinessOverride["earlyClose"] = null;
    if (body.earlyClose?.mode === "NOW") {
      const existing = settings.todayOverride?.businessDate === businessDate ? settings.todayOverride.earlyClose : null;
      earlyClose = existing?.mode === "NOW" ? existing : { mode: "NOW", closedAt: now.toISOString() };
    } else if (body.earlyClose?.mode === "AT") {
      const start = schedule.allDay ? 0 : timeMinutes(schedule.openTime);
      const regularClose = schedule.allDay ? start + 1440 : timeMinutes(schedule.closeTime) <= start ? timeMinutes(schedule.closeTime) + 1440 : timeMinutes(schedule.closeTime);
      let requestedClose = timeMinutes(body.earlyClose.closeTime as string);
      while (requestedClose <= start) requestedClose += 1440;
      if (requestedClose <= currentTimeline || requestedClose >= regularClose) {
        return Response.json({ success: false, message: "조기 마감 시각은 현재 시각보다 뒤이며 기본 영업 종료보다 빨라야 합니다." }, { status: 400 });
      }
      earlyClose = { mode: "AT", closeTime: body.earlyClose.closeTime as string };
    }

    let earlyBreak: TodayBusinessOverride["earlyBreak"] = null;
    if (body.earlyBreak?.mode === "NOW" || body.earlyBreak?.mode === "AT") {
      const isNow = body.earlyBreak.mode === "NOW";
      const startTime = isNow ? `${clock.hour}:${clock.minute}` : body.earlyBreak.startTime as string;
      const endTime = body.earlyBreak.endTime as string;
      const breakSchedule = { ...schedule, breakStart: startTime, breakEnd: endTime };
      const breakError = businessHoursError(breakSchedule, true);
      if (breakError) return Response.json({ success: false, message: breakError }, { status: 400 });
      if (isNow) {
        const activeStatus = getBusinessHoursStatus(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.todayOverride);
        if (activeStatus.state !== "OPEN" && activeStatus.state !== "BREAK") return Response.json({ success: false, message: "영업 중이 아닐 때는 지금부터 브레이크타임을 적용할 수 없습니다." }, { status: 400 });
        const existing = settings.todayOverride?.businessDate === businessDate ? settings.todayOverride.earlyBreak : null;
        earlyBreak = existing?.mode === "NOW" ? { ...existing, endTime } : { mode: "NOW", startedAt: now.toISOString(), startTime, endTime };
      } else earlyBreak = { mode: "AT", startTime, endTime };
    }

    const todayOverride: TodayBusinessOverride = { businessDate, earlyClose, earlyBreak };
    const settingValue = JSON.stringify(todayOverride);
    if (settingValue.length > 255) return Response.json({ success: false, message: "오늘 영업 설정 값이 너무 깁니다." }, { status: 400 });
    await db.insert(systemSettings).values({ settingKey: QR_BUSINESS_TODAY_OVERRIDE_KEY, settingValue, updatedByStaffId: staff.staffId })
      .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
    return Response.json({ success: true, todayOverride }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "오늘 영업 특별 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
