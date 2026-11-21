import { sql, type SQLWrapper } from "drizzle-orm";

export const QR_ORDER_ACCESS_MAX_AGE_SECONDS = 6 * 60 * 60;

/** The first accepted QR order's token anchors every member's table-session expiry. */
export function qrTableSessionExpiresAtSql(sessionId: SQLWrapper | number) {
  return sql`(
    SELECT DATE_ADD(root_qr_session.created_at, INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)
    FROM qr_orders root_order
    INNER JOIN qr_sessions root_qr_session ON root_qr_session.qr_session_id = root_order.qr_session_id
    WHERE root_qr_session.session_id = ${sessionId}
      AND root_order.status = 'ACCEPTED'
    ORDER BY root_order.accepted_at ASC, root_order.qr_order_id ASC
    LIMIT 1
  )`;
}

export function qrSessionCookieMaxAgeSeconds(remainingSeconds: number, maxAgeSeconds: number) {
  return Math.max(0, Math.min(maxAgeSeconds, Math.floor(remainingSeconds)));
}
