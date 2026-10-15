import type { RowDataPacket } from "mysql2";
import { pool } from "@/db";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { won } from "@/lib/sales-financial-summary";

export const dynamic = "force-dynamic";

type ItemRow = RowDataPacket & { menuId: number; itemName: string; qty: string; salesAmount: string };
type DayRow = RowDataPacket & { businessDate: string; qty: string; salesAmount: string };
type CountRow = RowDataPacket & { salesDayCount: number };

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Checkout item snapshots already contain the quantity left after item cancellations.
// APPROVED payments establish a completed sale without multiplying rows for split payments.
const soldItems = `FROM checkout_items ci
  JOIN checkouts c ON c.checkout_id = ci.checkout_id
  JOIN order_items oi ON oi.order_item_id = ci.order_item_id
  WHERE c.completed_at >= ? AND c.completed_at < ? AND c.status = 'PAID'
    AND ci.qty > 0 AND ci.unit_price > 0 AND ci.amount > 0
    AND oi.item_type <> 'SERVICE'
    AND EXISTS (SELECT 1 FROM payments p WHERE p.checkout_id = c.checkout_id
      AND p.status = 'APPROVED' AND p.applied_amount > 0)`;

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff())
    return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  const menuIdText = params.get("menuId");
  const itemName = params.get("itemName");
  const menuId = menuIdText === null ? null : Number(menuIdText);
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate ||
      startDate < "1900-01-01" || endDate > "9998-12-31" ||
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 > 3_660 ||
      (menuIdText !== null && (!Number.isSafeInteger(menuId) || menuId === null || menuId <= 0 ||
        !itemName || itemName.length > 200)) || (menuIdText === null && itemName !== null))
    return Response.json({ success: false, message: "조회 기간이나 품목을 확인해 주세요." }, { status: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const range = [startDate, nextDay(endDate)];
    if (menuId !== null && itemName !== null) {
      const [days] = await connection.query<DayRow[]>(
        `SELECT DATE_FORMAT(c.completed_at, '%Y-%m-%d') AS businessDate,
          SUM(ci.qty) AS qty, SUM(GREATEST(ci.amount - ci.discount_amount, 0)) AS salesAmount
          ${soldItems} AND oi.menu_id = ? AND oi.item_name = ?
          GROUP BY DATE(c.completed_at) ORDER BY businessDate ASC`,
        [...range, menuId, itemName],
      );
      return Response.json({ success: true, days: days.map(day => ({
        businessDate: day.businessDate, qty: Number(day.qty), salesAmount: won(day.salesAmount),
      })) }, { headers: { "Cache-Control": "no-store" } });
    }

    const [rows] = await connection.query<ItemRow[]>(
      `SELECT oi.menu_id AS menuId, oi.item_name AS itemName,
        SUM(ci.qty) AS qty, SUM(GREATEST(ci.amount - ci.discount_amount, 0)) AS salesAmount
        ${soldItems} GROUP BY oi.menu_id, oi.item_name`, range,
    );
    const [dayCounts] = await connection.query<CountRow[]>(
      `SELECT COUNT(DISTINCT DATE(c.completed_at)) AS salesDayCount ${soldItems}`, range,
    );
    return Response.json({ success: true, salesDayCount: Number(dayCounts[0]?.salesDayCount ?? 0),
      rows: rows.map(row => ({ menuId: Number(row.menuId), itemName: row.itemName,
        qty: Number(row.qty), salesAmount: won(row.salesAmount) })) },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin item sales failed", error);
    return Response.json({ success: false, message: "품목별 매출을 불러오지 못했습니다." }, { status: 500 });
  } finally {
    try { await connection.rollback(); }
    finally { connection.release(); }
  }
}
