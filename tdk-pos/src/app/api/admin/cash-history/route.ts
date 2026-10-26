import type { RowDataPacket } from "mysql2";
import { pool } from "@/db";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { parseCashOpeningFund } from "@/lib/cash-opening-fund";

type CashHistoryRow = RowDataPacket & {
  id: string; occurredAt: string; type: "OPENING_CASH" | "CASH_CHECK";
  source: "POS" | "BUSINESS_CLOSE"; amount: string | number;
  expectedCash: string | number | null; actualCash: string | number | null;
  difference: string | number | null; fundJson: string | null;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string) => datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const jsonNumber = (column: string, path: string) => `CAST(JSON_UNQUOTE(JSON_EXTRACT(${column}, '${path}')) AS DECIMAL(14,2))`;

// The opening table keeps one row per date. Its CREATE audit entry preserves the original
// registration amount and denominations if that row was edited later.
const eventsSql = `
  SELECT CONCAT('opening:', f.cash_opening_fund_id) AS id,
    DATE_FORMAT(f.created_at, '%Y-%m-%dT%H:%i:%s') AS occurredAt,
    'OPENING_CASH' AS type, 'POS' AS source,
    COALESCE(${jsonNumber("IF(JSON_VALID(a.description), a.description, '{}')", "$.totalAmount")}, f.total_amount) AS amount,
    NULL AS expectedCash, NULL AS actualCash, NULL AS difference,
    COALESCE(JSON_EXTRACT(IF(JSON_VALID(a.description), a.description, '{}'), '$.after'),
      JSON_OBJECT('otherAmount', f.other_amount, 'counts', JSON_OBJECT(
        '50000', f.count_50000, '10000', f.count_10000, '5000', f.count_5000,
        '1000', f.count_1000, '500', f.count_500, '100', f.count_100))) AS fundJson
  FROM cash_opening_funds f
  LEFT JOIN audit_logs a ON a.audit_log_id = (
    SELECT MIN(a2.audit_log_id) FROM audit_logs a2
    WHERE a2.entity_type = 'CASH_OPENING_FUND' AND a2.action_type = 'CREATE'
      AND a2.entity_id = f.cash_opening_fund_id)
  WHERE f.created_at >= ? AND f.created_at < DATE_ADD(?, INTERVAL 1 DAY)
  UNION ALL
  SELECT CONCAT('check:', a.audit_log_id), DATE_FORMAT(a.created_at, '%Y-%m-%dT%H:%i:%s'),
    'CASH_CHECK', 'POS',
    ${jsonNumber("IF(JSON_VALID(a.description), a.description, '{}')", "$.actualCash")},
    ${jsonNumber("IF(JSON_VALID(a.description), a.description, '{}')", "$.expectedCash")},
    ${jsonNumber("IF(JSON_VALID(a.description), a.description, '{}')", "$.actualCash")},
    ${jsonNumber("IF(JSON_VALID(a.description), a.description, '{}')", "$.difference")},
    JSON_EXTRACT(IF(JSON_VALID(a.description), a.description, '{}'), '$.fund')
  FROM audit_logs a
  WHERE a.entity_type = 'CASH_CHECK' AND a.action_type = 'CHECK'
    AND JSON_VALID(a.description)
    AND JSON_TYPE(JSON_EXTRACT(IF(JSON_VALID(a.description), a.description, '{}'), '$.actualCash')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
    AND JSON_TYPE(JSON_EXTRACT(IF(JSON_VALID(a.description), a.description, '{}'), '$.expectedCash')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
    AND a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)
  UNION ALL
  SELECT CONCAT('close:', c.daily_closing_id), DATE_FORMAT(c.closed_at, '%Y-%m-%dT%H:%i:%s'),
    'CASH_CHECK', 'BUSINESS_CLOSE',
    ${jsonNumber("c.snapshot", "$.actualCash")},
    ${jsonNumber("c.snapshot", "$.expectedCash")},
    ${jsonNumber("c.snapshot", "$.actualCash")},
    ${jsonNumber("c.snapshot", "$.cashDifference")}, JSON_EXTRACT(c.snapshot, '$.actualCashFund')
  FROM daily_closing_snapshots c
  WHERE JSON_VALID(c.snapshot)
    AND JSON_TYPE(JSON_EXTRACT(c.snapshot, '$.actualCash')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
    AND c.closed_at >= ? AND c.closed_at < DATE_ADD(?, INTERVAL 1 DAY)
  UNION ALL
  SELECT CONCAT('session:', s.business_session_id), DATE_FORMAT(s.closed_at, '%Y-%m-%dT%H:%i:%s'),
    'CASH_CHECK', 'BUSINESS_CLOSE', s.actual_cash, s.expected_cash, s.actual_cash,
    s.cash_difference, NULL
  FROM business_sessions s
  WHERE s.status = 'CLOSED' AND s.actual_cash IS NOT NULL
    AND s.closed_at >= ? AND s.closed_at < DATE_ADD(?, INTERVAL 1 DAY)
    AND NOT EXISTS (SELECT 1 FROM daily_closing_snapshots c WHERE c.sales_date = s.business_date)
`;

function storedFund(value: unknown) {
  if (!value) return null;
  try { return parseCashOpeningFund(typeof value === "string" ? JSON.parse(value) : value); }
  catch { return null; }
}

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff())
    return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? "1");
  const sortColumns: Record<string, string> = {
    occurredAt: "occurredAt", type: "type", amount: "amount",
    expectedCash: "expectedCash", actualCash: "actualCash", difference: "difference",
  };
  const sortExpression = sortColumns[params.get("sortBy") ?? "occurredAt"] ?? "occurredAt";
  const sortDirection = params.get("sortDirection") === "asc" ? "ASC" : "DESC";
  if (!isDate(from) || !isDate(to) || from > to || !Number.isSafeInteger(page) || page < 1 || page > 100000)
    return Response.json({ success: false, message: "조회기간 또는 페이지를 확인해 주세요." }, { status: 400 });

  const pageSize = 20;
  const values = [from, to, from, to, from, to, from, to];
  try {
    const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM (${eventsSql}) AS events`, values);
    const total = Number(countRows[0]?.total ?? 0);
    const [rows] = await pool.query<CashHistoryRow[]>(
      `SELECT * FROM (${eventsSql}) AS events ORDER BY CASE WHEN ${sortExpression} IS NULL THEN 1 ELSE 0 END ASC, ${sortExpression} ${sortDirection}, occurredAt DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize]);
    return Response.json({ success: true, total, page, pageSize, rows: rows.map(row => ({
      id: row.id, occurredAt: row.occurredAt, type: row.type, source: row.source,
      amount: Number(row.amount), expectedCash: row.expectedCash === null ? null : Number(row.expectedCash),
      actualCash: row.actualCash === null ? null : Number(row.actualCash),
      difference: row.difference === null ? null : Number(row.difference), fund: storedFund(row.fundJson),
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Cash history lookup failed", error);
    return Response.json({ success: false, message: "시재 내역을 불러오지 못했습니다." }, { status: 500 });
  }
}
