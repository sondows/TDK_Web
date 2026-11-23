import { sql, type SQLWrapper } from "drizzle-orm";

export const QR_ORDER_ACCESS_MAX_AGE_SECONDS = 6 * 60 * 60;

/**
 * The first accepted QR order remains the normal expiry anchor. POS-first table
 * sessions have no accepted QR order yet, so use the first QR owner token as a
 * temporary anchor. Invite creator links preserve that owner if an older,
 * unbound guest token is later attached through an invite.
 */
export function qrTableSessionExpiresAtSql(sessionId: SQLWrapper | number) {
  return sql`COALESCE(
    (
    SELECT DATE_ADD(root_qr_session.created_at, INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)
    FROM qr_orders root_order
    INNER JOIN qr_sessions root_qr_session ON root_qr_session.qr_session_id = root_order.qr_session_id
    WHERE root_qr_session.session_id = ${sessionId}
      AND root_order.status = 'ACCEPTED'
    ORDER BY root_order.accepted_at ASC, root_order.qr_order_id ASC
    LIMIT 1
    ),
    (
      SELECT DATE_ADD(invite_owner.created_at, INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)
      FROM qr_session_invites owner_invite
      INNER JOIN qr_sessions invite_owner ON invite_owner.qr_session_id = owner_invite.created_by_qr_session_id
      WHERE owner_invite.session_id = ${sessionId}
      ORDER BY owner_invite.invite_id ASC
      LIMIT 1
    ),
    (
      SELECT DATE_ADD(MIN(first_member.created_at), INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)
      FROM qr_sessions first_member
      WHERE first_member.session_id = ${sessionId}
    )
  )`;
}

/** Uses the same six-hour boundary for unbound and accepted table sessions. */
export function qrCustomerSessionExpiredSql(createdAt: SQLWrapper, sessionId: SQLWrapper | number) {
  return sql<boolean>`CASE
    WHEN ${sessionId} IS NULL
      THEN DATE_ADD(${createdAt}, INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND) <= CURRENT_TIMESTAMP
    ELSE ${qrTableSessionExpiresAtSql(sessionId)} <= CURRENT_TIMESTAMP
  END`;
}

export function qrSessionCookieMaxAgeSeconds(remainingSeconds: number, maxAgeSeconds: number) {
  return Math.max(0, Math.min(maxAgeSeconds, Math.floor(remainingSeconds)));
}
