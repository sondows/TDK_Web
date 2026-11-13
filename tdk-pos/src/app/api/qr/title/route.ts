import { getBusinessHoursStatus } from "@/lib/qr-business-hours";
import { getQrPublicTitleData } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getQrPublicTitleData();
    const status = getBusinessHoursStatus(data.weekly, data.specialHours, new Date(data.serverNow), data.closedDates, data.holidayRules, data.todayOverride);
    return Response.json({ success: true, ...data, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR title settings unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "매장 타이틀 정보를 불러오지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
