import type { RowDataPacket } from "mysql2";
import { salePlaceLabel } from "@/lib/sale-place-label";
import { pool } from "@/db";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { won } from "@/lib/sales-financial-summary";
import type { SaleDisplayStatus } from "@/lib/sales-types";

export const dynamic = "force-dynamic";
type CheckoutRow = RowDataPacket & { checkoutId: number; occurredAt: string; status: string };
type PaymentRow = RowDataPacket & { checkoutId: number; appliedAmount: string; status: string; methodName: string };
type TableRow = RowDataPacket & { checkoutId: number; tableNo: string };
type CountRow = RowDataPacket & { count: number };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const displayStatus = (checkoutStatus: string, rows: PaymentRow[]): SaleDisplayStatus => {
  if (checkoutStatus === "CANCELLED" || checkoutStatus === "REFUNDED") return "CANCELLED";
  if (checkoutStatus !== "PAID") return "IN_PROGRESS";
  const approved = rows.filter(row => row.status === "APPROVED").reduce((sum, row) => sum + won(row.appliedAmount), 0);
  const cancelled = rows.filter(row => row.status === "CANCELLED" || row.status === "REFUNDED").reduce((sum, row) => sum + won(row.appliedAmount), 0);
  return cancelled > 0 && approved === 0 ? "CANCELLED" : cancelled > 0 ? "PARTIALLY_CANCELLED" : "COMPLETED";
};
const businessDateSql = `DATE(c.completed_at)`;

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  const page = Number(params.get("page") ?? "1");
  const requestedSort = params.get("sortBy") ?? "occurredAt";
  const sortDirection = params.get("sortDirection") === "asc" ? "ASC" : "DESC";
  const sortColumns: Record<string, string> = {
    occurredAt: "c.completed_at",
    tableLabel: `(SELECT MIN(COALESCE(ts.display_name, dt.table_no)) FROM checkout_items ci JOIN order_items oi ON oi.order_item_id = ci.order_item_id JOIN orders o ON o.order_id = oi.order_id JOIN table_sessions ts ON ts.session_id = o.session_id LEFT JOIN dining_tables dt ON dt.table_id = ts.table_id WHERE ci.checkout_id = c.checkout_id)`,
    amount: `(SELECT COALESCE(SUM(p.applied_amount), 0) FROM payments p WHERE p.checkout_id = c.checkout_id AND p.status = 'APPROVED')`,
    paymentMethods: `(SELECT GROUP_CONCAT(DISTINCT pm.method_name ORDER BY pm.method_name SEPARATOR '+') FROM payments p JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id WHERE p.checkout_id = c.checkout_id AND p.status IN ('APPROVED', 'CANCELLED', 'REFUNDED'))`,
    status: `CASE WHEN c.status IN ('CANCELLED', 'REFUNDED') THEN 2 WHEN c.status <> 'PAID' THEN 1 WHEN EXISTS (SELECT 1 FROM payments p WHERE p.checkout_id = c.checkout_id AND p.status IN ('CANCELLED', 'REFUNDED')) THEN 3 ELSE 0 END`,
  };
  const sortExpression = sortColumns[requestedSort] ?? sortColumns.occurredAt;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate ||
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 > 3_660 ||
      !Number.isSafeInteger(page) || page < 1 || page > 100_000)
    return Response.json({ success: false, message: "조회 기간과 페이지를 확인해 주세요." }, { status: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const condition = `c.completed_at IS NOT NULL AND ${businessDateSql} >= ? AND ${businessDateSql} < ? AND NOT EXISTS (SELECT 1 FROM legacy_daily_sales l WHERE l.source = 'LEGACY_POS' AND l.business_date = ${businessDateSql})`;
    const args = [startDate, nextDay(endDate)];
    const [counts] = await connection.query<CountRow[]>(`SELECT COUNT(*) AS count FROM checkouts c WHERE ${condition}`, args);
    const pageSize = 50;
    const [checkouts] = await connection.query<CheckoutRow[]>(
      `SELECT c.checkout_id AS checkoutId, CONCAT(DATE_FORMAT(c.completed_at, '%Y-%m-%dT%H:%i:%s'), '+09:00') AS occurredAt, c.status FROM checkouts c WHERE ${condition} ORDER BY ${sortExpression} ${sortDirection}, c.completed_at DESC, c.checkout_id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    const ids = checkouts.map(row => row.checkoutId);
    const [payments] = ids.length ? await connection.query<PaymentRow[]>(
      "SELECT p.checkout_id AS checkoutId, p.applied_amount AS appliedAmount, p.status, pm.method_name AS methodName FROM payments p JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id WHERE p.checkout_id IN (?)", [ids],
    ) : [[] as PaymentRow[]];
    const [tables] = ids.length ? await connection.query<TableRow[]>(
      "SELECT DISTINCT ci.checkout_id AS checkoutId, COALESCE(ts.display_name, dt.table_no) AS tableNo FROM checkout_items ci JOIN order_items oi ON oi.order_item_id = ci.order_item_id JOIN orders o ON o.order_id = oi.order_id JOIN table_sessions ts ON ts.session_id = o.session_id LEFT JOIN dining_tables dt ON dt.table_id = ts.table_id WHERE ci.checkout_id IN (?)", [ids],
    ) : [[] as TableRow[]];
    const paymentByCheckout = new Map<number, PaymentRow[]>();
    for (const row of payments) paymentByCheckout.set(row.checkoutId, [...(paymentByCheckout.get(row.checkoutId) ?? []), row]);
    const tableByCheckout = new Map<number, string[]>();
    for (const row of tables) tableByCheckout.set(row.checkoutId, [...(tableByCheckout.get(row.checkoutId) ?? []), row.tableNo]);
    const rows = checkouts.map(checkout => {
      const related = paymentByCheckout.get(checkout.checkoutId) ?? [];
      const tableNos = [...new Set(tableByCheckout.get(checkout.checkoutId) ?? [])].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
      return { checkoutId: checkout.checkoutId, occurredAt: checkout.occurredAt,
        tableLabel: tableNos.length ? tableNos.map(salePlaceLabel).join("+") : "-",
        salesAmount: related.filter(row => row.status === "APPROVED").reduce((sum, row) => sum + won(row.appliedAmount), 0),
        paymentMethods: [...new Set(related.filter(row => ["APPROVED", "CANCELLED", "REFUNDED"].includes(row.status)).map(row => row.methodName))].join("+") || "-",
        status: displayStatus(checkout.status, related), source: "TDK_POS" as const };
    });
    return Response.json({ success: true, rows, page, pageSize, totalCount: Number(counts[0]?.count ?? 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin sales report detail list failed", error);
    return Response.json({ success: false, message: "판매건 목록을 불러오지 못했습니다." }, { status: 500 });
  } finally {
    try { await connection.rollback(); }
    finally { connection.release(); }
  }
}
