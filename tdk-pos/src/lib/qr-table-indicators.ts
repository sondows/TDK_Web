import "server-only";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import { QR_ORDER_ACCESS_MAX_AGE_SECONDS } from "@/lib/qr-order-auth";

export type QrTableIndicator = {
  tableId: number;
  tableNo: string;
  issuedAt: string;
  adultCount: number | null;
  babyCount: number | null;
  hasActiveQrToken: boolean;
  hasPendingQrOrder: boolean;
  hasQrOrderHistory: boolean;
};

type QrTableIndicatorRow = RowDataPacket & {
  tableId: number | string;
  tableNo: string;
  issuedAt: string;
  adultCount: number | string | null;
  babyCount: number | string | null;
  hasActiveQrToken: number | string;
  hasPendingQrOrder: number | string;
  hasQrOrderHistory: number | string;
};

type QrOrderCursorRow = RowDataPacket & { max_order_id: number | string };
type PendingQrOrderCountRow = RowDataPacket & { orderCount: number | string };

export async function loadQrOrderNotificationCursor() {
  const [rows] = await pool.query<QrOrderCursorRow[]>("SELECT COALESCE(MAX(qr_order_id), 0) AS max_order_id FROM qr_orders");
  return Number(rows[0]?.max_order_id ?? 0);
}

/** Counts the same current-session PENDING QR orders returned by the staff queue endpoint. */
export async function loadCurrentPendingQrOrderCount() {
  const [rows] = await pool.query<PendingQrOrderCountRow[]>(`
    SELECT COUNT(*) AS orderCount
    FROM qr_orders qo
    INNER JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
    LEFT JOIN table_sessions ts ON ts.session_id = qs.session_id
    INNER JOIN dining_tables t ON t.table_id = COALESCE(ts.table_id, qs.table_id)
    WHERE qo.status = 'PENDING'
      AND qs.status = 'ACTIVE'
      AND t.is_active = 1
      AND ((qs.session_id IS NULL AND qs.table_id IS NOT NULL)
        OR (ts.status = 'OPEN' AND ts.session_kind = 'DINE_IN'))
  `);
  return Number(rows[0]?.orderCount ?? 0);
}

/** Returns per-table token, pending-order, and current-use QR-order history indicators. */
export async function loadQrTableIndicators(): Promise<Map<number, QrTableIndicator>> {
  const boundQrAnchor = `COALESCE(root_qs.created_at,
    (SELECT invite_owner.created_at FROM qr_session_invites owner_invite
      INNER JOIN qr_sessions invite_owner ON invite_owner.qr_session_id = owner_invite.created_by_qr_session_id
      WHERE owner_invite.session_id = qs.session_id AND owner_invite.revoked_at IS NULL
      ORDER BY owner_invite.invite_id ASC LIMIT 1),
    (SELECT MIN(first_member.created_at) FROM qr_sessions first_member
      WHERE first_member.session_id = qs.session_id AND first_member.status = 'ACTIVE'))`;
  const [rows] = await pool.query<QrTableIndicatorRow[]>(`
    SELECT t.table_id AS tableId, t.table_no AS tableNo,
      DATE_FORMAT(MIN(qs.created_at), '%Y-%m-%d %H:%i:%s') AS issuedAt,
      MAX(COALESCE(ts.person_count, active_ts.person_count)) AS adultCount,
      MAX(COALESCE(ts.baby_count, active_ts.baby_count)) AS babyCount,
      MAX(CASE WHEN qs.status = 'ACTIVE' AND (
        (qs.session_id IS NULL AND qs.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
        OR (qs.session_id IS NOT NULL AND ${boundQrAnchor} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
      ) THEN 1 ELSE 0 END) AS hasActiveQrToken,
      MAX(CASE WHEN qo.qr_order_id IS NOT NULL THEN 1 ELSE 0 END) AS hasPendingQrOrder,
      MAX(CASE WHEN history_order.qr_order_id IS NOT NULL AND (
        (active_ts.session_id IS NOT NULL AND (
          qs.session_id = active_ts.session_id
          OR (qs.session_id IS NULL AND history_order.ordered_at >= active_ts.opened_at)
        ))
        OR (active_ts.session_id IS NULL AND qs.session_id IS NULL
          AND qs.status = 'ACTIVE'
          AND qs.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
      ) THEN 1 ELSE 0 END) AS hasQrOrderHistory
    FROM qr_sessions qs
    LEFT JOIN table_sessions ts ON ts.session_id = qs.session_id
    INNER JOIN dining_tables t ON t.table_id = COALESCE(ts.table_id, qs.table_id)
    INNER JOIN qr_table_links qtl ON qtl.table_id = t.table_id
    INNER JOIN qr_codes qc ON qc.qr_code_id = qtl.qr_code_id
    LEFT JOIN table_sessions active_ts ON active_ts.table_id = t.table_id
      AND active_ts.status = 'OPEN' AND active_ts.session_kind = 'DINE_IN'
    LEFT JOIN qr_orders history_order ON history_order.qr_session_id = qs.qr_session_id
    LEFT JOIN qr_sessions root_qs ON root_qs.qr_session_id = (
      SELECT first_qr.qr_session_id
      FROM qr_orders first_order
      INNER JOIN qr_sessions first_qr ON first_qr.qr_session_id = first_order.qr_session_id
      WHERE first_qr.session_id = qs.session_id AND first_order.status = 'ACCEPTED'
      ORDER BY first_order.accepted_at ASC, first_order.qr_order_id ASC
      LIMIT 1
    )
    LEFT JOIN qr_orders qo ON qo.qr_session_id = qs.qr_session_id AND qo.status = 'PENDING'
    WHERE (
      (qs.status = 'ACTIVE' AND (
        (qs.session_id IS NULL AND qs.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
        OR (qs.session_id IS NOT NULL AND ${boundQrAnchor} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
        OR qo.qr_order_id IS NOT NULL
        OR (history_order.qr_order_id IS NOT NULL AND (
          (active_ts.session_id IS NOT NULL AND (
            qs.session_id = active_ts.session_id
            OR (qs.session_id IS NULL AND history_order.ordered_at >= active_ts.opened_at)
          ))
          OR (active_ts.session_id IS NULL AND qs.session_id IS NULL
            AND qs.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
        ))
      ))
      OR (active_ts.session_id IS NOT NULL AND qs.session_id = active_ts.session_id
        AND history_order.qr_order_id IS NOT NULL)
    )
      AND (qs.session_id IS NULL OR (ts.status = 'OPEN' AND ts.session_kind = 'DINE_IN'))
      AND t.is_active = 1
      AND qc.target_type = 'TABLE_ORDER'
      AND qc.status = 'IN_USE'
    GROUP BY t.table_id, t.table_no`, [QR_ORDER_ACCESS_MAX_AGE_SECONDS, QR_ORDER_ACCESS_MAX_AGE_SECONDS,
      QR_ORDER_ACCESS_MAX_AGE_SECONDS, QR_ORDER_ACCESS_MAX_AGE_SECONDS, QR_ORDER_ACCESS_MAX_AGE_SECONDS,
      QR_ORDER_ACCESS_MAX_AGE_SECONDS]);

  return new Map(rows.map(row => {
    const adultCount = row.adultCount === null ? null : Number(row.adultCount);
    const babyCount = row.babyCount === null ? null : Number(row.babyCount);
    const hasRegisteredPeople = adultCount !== null && (adultCount > 0 || (babyCount ?? 0) > 0);
    return [Number(row.tableId), {
    tableId: Number(row.tableId),
    tableNo: String(row.tableNo),
    issuedAt: row.issuedAt,
    adultCount: hasRegisteredPeople ? adultCount : null,
    babyCount: hasRegisteredPeople ? babyCount : null,
    hasActiveQrToken: Number(row.hasActiveQrToken) === 1,
    hasPendingQrOrder: Number(row.hasPendingQrOrder) === 1,
    hasQrOrderHistory: Number(row.hasQrOrderHistory) === 1,
  }];
  }));
}
