export type SalesReportView = "yearly" | "monthly" | "daily" | "detail";
export type SalesReportRange = { startDate: string; endDate: string };
export type SalesReportPreset = { id: "all" | "recent" | "recent7" | "current" | "today"; label: string; range: SalesReportRange | null };

const yearRange = (startYear: number, endYear: number): SalesReportRange => ({
  startDate: `${startYear}-01-01`, endDate: `${endYear}-12-31`,
});
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const shiftMonth = (month: string, offset: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1)).toISOString().slice(0, 7);
const shiftDay = (day: string, offset: number) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

export function defaultSalesReportRange(view: SalesReportView, today: string): SalesReportRange {
  const year = Number(today.slice(0, 4));
  if (view === "yearly") return yearRange(Math.floor(year / 10) * 10, year);
  if (view === "monthly") return { startDate: `${year}-01-01`, endDate: monthEnd(today.slice(0, 7)) };
  if (view === "detail") return { startDate: today, endDate: today };
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}

export function salesReportPresets(view: SalesReportView, today: string, firstAvailableDate: string | null): SalesReportPreset[] {
  const year = Number(today.slice(0, 4));
  const wholeStart = firstAvailableDate && firstAvailableDate <= today ? firstAvailableDate : null;
  if (view === "detail") return [
    { id: "recent", label: "최근 30일", range: { startDate: shiftDay(today, -29), endDate: today } },
    { id: "recent7", label: "최근 7일", range: { startDate: shiftDay(today, -6), endDate: today } },
    { id: "today", label: "당일", range: defaultSalesReportRange(view, today) },
  ];
  if (view === "yearly") return [
    { id: "all", label: "전체", range: wholeStart ? yearRange(Number(wholeStart.slice(0, 4)), year) : null },
    { id: "recent", label: "최근 10년", range: yearRange(year - 9, year) },
    { id: "current", label: `${Math.floor(year / 10) * 10}년대`, range: defaultSalesReportRange(view, today) },
  ];
  if (view === "monthly") return [
    { id: "all", label: "전체", range: wholeStart ? { startDate: `${wholeStart.slice(0, 7)}-01`, endDate: monthEnd(today.slice(0, 7)) } : null },
    { id: "recent", label: "최근 12개월", range: { startDate: `${shiftMonth(today.slice(0, 7), -11)}-01`, endDate: monthEnd(today.slice(0, 7)) } },
    { id: "current", label: `${year}년`, range: defaultSalesReportRange(view, today) },
  ];
  return [
    { id: "all", label: "전체", range: wholeStart ? { startDate: wholeStart, endDate: today } : null },
    { id: "recent", label: "최근 30일", range: { startDate: shiftDay(today, -29), endDate: today } },
    { id: "current", label: `${Number(today.slice(5, 7))}월`, range: defaultSalesReportRange(view, today) },
  ];
}
