import { pool } from "@/db";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import type { RowDataPacket } from "mysql2";

export const dynamic = "force-dynamic";

const fields = ["sale_count", "gross_sales", "discount_amount", "net_sales", "card_amount", "cash_amount", "bank_transfer_amount", "other_amount", "cancelled_count", "cancelled_amount"] as const;
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    let startDate = params.get("startDate");
    let endDate = params.get("endDate");
    if (!startDate && !endDate) {
      const [latest] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(MAX(business_date), '%Y-%m-%d') AS day FROM legacy_daily_sales WHERE source = 'LEGACY_POS'");
      startDate = endDate = latest[0]?.day ?? null;
    }
    if (!startDate || !endDate) return Response.json({ success: true, startDate: null, endDate: null, rows: [], totals: null }, { headers: { "Cache-Control": "no-store" } });
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return Response.json({ success: false, message: "조회 기간을 확인해 주세요." }, { status: 400 });
    const [data] = await pool.query<RowDataPacket[]>(
      "SELECT DATE_FORMAT(business_date, '%Y-%m-%d') AS business_date, sale_count, gross_sales, discount_amount, net_sales, card_amount, cash_amount, bank_transfer_amount, other_amount, cancelled_count, cancelled_amount, source FROM legacy_daily_sales WHERE source = 'LEGACY_POS' AND business_date >= ? AND business_date <= ? ORDER BY business_date DESC",
      [startDate, endDate],
    );
    const rows = data.map(row => ({ ...row, ...Object.fromEntries(fields.map(field => [field, Number(row[field])])) }));
    const totals = Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + row[field], 0)]));
    return Response.json({ success: true, startDate, endDate, rows, totals }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("legacy daily sales query failed", error);
    return Response.json({ success: false, message: "구 POS 집계자료를 불러오지 못했습니다." }, { status: 500 });
  }
}
