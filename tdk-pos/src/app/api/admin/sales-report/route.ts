import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { addTotals, loadUnifiedDailySales, type DailySales, type SalesSource } from "@/lib/unified-sales-report";

export const dynamic = "force-dynamic";

type View = "yearly" | "monthly" | "daily" | "detail";
type ReportRow = ReturnType<typeof addTotals> & {
  label: string; date: string; source: SalesSource | "MIXED" | null; overlapDays: number;
  salesDayCount: number; dailySalesAverage: number | null;
  customerAverage: number | null; tableAverage: number | null;
  durationMinutes: number | null; tableGuestAverage: number | null;
};
const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const daysBetween = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
const todayInKorea = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sourceOf = (days: DailySales[]): ReportRow["source"] => !days.length ? null : days.every(day => day.source === days[0].source) ? days[0].source : "MIXED";
function reportRow(label: string, date: string, days: DailySales[]): ReportRow {
  const totals = addTotals(days);
  const salesDayCount = days.filter(day => day.salesAmount > 0).length;
  const legacySales = days.some(day => day.source === "LEGACY_POS" && day.saleCount > 0);
  const guestCount = days.reduce((sum, day) => sum + day.guestCount, 0);
  const incompleteGuestCount = days.reduce((sum, day) => sum + day.incompleteGuestCount, 0);
  const durationCount = days.reduce((sum, day) => sum + day.durationCount, 0);
  const durationTotal = days.reduce((sum, day) => sum + day.durationTotalMinutes, 0);
  return { label, date, source: sourceOf(days), ...totals,
    overlapDays: days.filter(day => day.overlapWithOtherSource).length,
    salesDayCount, dailySalesAverage: salesDayCount ? Math.round(totals.salesAmount / salesDayCount) : null,
    customerAverage: totals.saleCount ? Math.round(totals.salesAmount / totals.saleCount) : null,
    tableAverage: !legacySales && totals.saleCount ? Math.round(totals.salesAmount / totals.saleCount) : null,
    durationMinutes: !legacySales && totals.saleCount && durationCount === totals.saleCount ? Math.round(durationTotal / durationCount) : null,
    tableGuestAverage: !legacySales && totals.saleCount && !incompleteGuestCount ? Math.round(guestCount / totals.saleCount * 10) / 10 : null,
  };
}

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const view = (params.get("view") ?? "daily") as View;
    if (!["yearly", "monthly", "daily", "detail"].includes(view))
      return Response.json({ success: false, message: "조회 단위를 확인해 주세요." }, { status: 400 });
    const today = todayInKorea();
    const year = Number(params.get("year") ?? today.slice(0, 4));
    const month = Number(params.get("month") ?? today.slice(5, 7));
    if (!Number.isInteger(year) || year < 1900 || year > 9998 || !Number.isInteger(month) || month < 1 || month > 12)
      return Response.json({ success: false, message: "조회 기간을 확인해 주세요." }, { status: 400 });
    const monthText = String(month).padStart(2, "0");
    // Keep the previous year/month API form usable while accepting explicit ranges.
    const defaultStart = view === "yearly" ? "2017-01-01" : view === "monthly" ? `${year}-01-01` : `${year}-${monthText}-01`;
    const defaultEnd = view === "yearly" ? today : view === "monthly" ? `${year}-12-31` :
      new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const startDate = params.get("startDate") ?? defaultStart;
    const endDate = params.get("endDate") ?? defaultEnd;
    if (!isoDate(startDate) || !isoDate(endDate) || startDate > endDate ||
        startDate < "1900-01-01" || endDate > "9998-12-31" || daysBetween(startDate, endDate) > 36_525 ||
        ((view === "daily" || view === "detail") && daysBetween(startDate, endDate) > 3_660))
      return Response.json({ success: false, message: "조회 기간을 확인해 주세요. 일별·상세는 최대 10년까지 조회할 수 있습니다." }, { status: 400 });
    const endExclusive = nextDay(endDate) < nextDay(today) ? nextDay(endDate) : nextDay(today);
    const days = startDate < endExclusive ? await loadUnifiedDailySales(startDate, endExclusive) : [];
    const byDate = new Map(days.map(day => [day.businessDate, day]));
    let rows: ReportRow[] = [];
    if (view === "daily") {
      rows = Array.from({ length: daysBetween(startDate, endDate) + 1 }, (_, index) => {
        const date = new Date(Date.parse(`${startDate}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
        return reportRow(date.slice(5).replace("-", "/"), date, byDate.has(date) ? [byDate.get(date)!] : []);
      });
    } else if (view === "monthly") {
      const first = Number(startDate.slice(0, 4)) * 12 + Number(startDate.slice(5, 7)) - 1;
      const last = Number(endDate.slice(0, 4)) * 12 + Number(endDate.slice(5, 7)) - 1;
      rows = Array.from({ length: last - first + 1 }, (_, index) => {
        const value = first + index;
        const key = `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`;
        return reportRow(`${key.slice(0, 4)}년 ${key.slice(5)}월`, key, days.filter(day => day.businessDate.startsWith(key)));
      });
    } else if (view === "yearly") {
      rows = Array.from({ length: Number(endDate.slice(0, 4)) - Number(startDate.slice(0, 4)) + 1 }, (_, index) => {
        const key = String(Number(startDate.slice(0, 4)) + index);
        return reportRow(`${key}년`, key, days.filter(day => day.businessDate.startsWith(key)));
      });
    }
    return Response.json({ success: true, view, startDate, endDate, rows,
      totals: reportRow("전체", `${startDate}~${endDate}`, days),
      overlapDays: days.filter(day => day.overlapWithOtherSource).length,
      sourceRule: "LEGACY_POS_WINS_ON_DATE_OVERLAP" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin sales report failed", error);
    return Response.json({ success: false, message: "매출조회를 불러오지 못했습니다." }, { status: 500 });
  }
}
