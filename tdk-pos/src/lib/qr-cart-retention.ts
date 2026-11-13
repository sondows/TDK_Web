import "server-only";

import type { ResultSetHeader } from "mysql2";
import { pool } from "@/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 5_000;
let cleanupInFlight = false;

/** Bounded purge; old events expire after 180 days, then their anonymous session can be removed. */
export async function purgeExpiredQrCartAnalytics() {
  let deletedEvents = 0;
  let deletedVisitors = 0;
  const [expiredOrders] = await pool.query<ResultSetHeader>(
    `UPDATE qr_wait_orders SET status='EXPIRED', version=version+1, updated_at=NOW()
     WHERE status IN ('PENDING','ASSIGNED') AND expires_at <= NOW()`);
  const [closedEmptySessions] = await pool.query<ResultSetHeader>(
    `UPDATE table_sessions ts
     INNER JOIN qr_wait_orders qo ON qo.assigned_session_id=ts.session_id AND qo.status='EXPIRED'
     LEFT JOIN orders o ON o.session_id=ts.session_id
     SET ts.status='CLOSED', ts.closed_at=NOW()
     WHERE ts.status='OPEN' AND o.order_id IS NULL`);
  let deletedWaitOrders = 0;
  for (let batch = 0; batch < 10; batch++) {
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM qr_wait_orders WHERE status IN ('CONFIRMED','CANCELLED','EXPIRED')
       AND updated_at < DATE_SUB(NOW(), INTERVAL 180 DAY) LIMIT ?`, [DELETE_BATCH_SIZE]);
    deletedWaitOrders += result.affectedRows;
    if (result.affectedRows < DELETE_BATCH_SIZE) break;
  }
  for (let batch = 0; batch < 10; batch++) {
    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM qr_visit_events WHERE occurred_at < DATE_SUB(NOW(), INTERVAL 180 DAY) LIMIT ?",
      [DELETE_BATCH_SIZE],
    );
    deletedEvents += result.affectedRows;
    if (result.affectedRows < DELETE_BATCH_SIZE) break;
  }
  for (let batch = 0; batch < 10; batch++) {
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM qr_visit_sessions
       WHERE expires_at < NOW()
         AND NOT EXISTS (SELECT 1 FROM qr_visit_events e WHERE e.visitor_id = qr_visit_sessions.visitor_id)
         AND NOT EXISTS (SELECT 1 FROM qr_wait_orders w WHERE w.visitor_id = qr_visit_sessions.visitor_id)
       LIMIT ?`,
      [DELETE_BATCH_SIZE],
    );
    deletedVisitors += result.affectedRows;
    if (result.affectedRows < DELETE_BATCH_SIZE) break;
  }
  return { expiredOrders: expiredOrders.affectedRows, closedEmptySessions: closedEmptySessions.affectedRows, deletedWaitOrders, deletedEvents, deletedVisitors };
}

/** Start at most one best-effort cleanup schedule per Node process. */
export function scheduleQrCartAnalyticsRetention() {
  const registry = globalThis as typeof globalThis & { __tdkonQrCartRetentionStarted?: boolean };
  if (registry.__tdkonQrCartRetentionStarted) return;
  registry.__tdkonQrCartRetentionStarted = true;

  const run = () => {
    if (cleanupInFlight) return;
    cleanupInFlight = true;
    void purgeExpiredQrCartAnalytics().catch(error => {
      console.warn("QR analytics retention cleanup failed", { code: (error as { code?: string }).code });
    }).finally(() => { cleanupInFlight = false; });
  };
  const initialTimer = setTimeout(run, 10 * 60 * 1000);
  initialTimer.unref?.();
  const dailyTimer = setInterval(run, DAY_MS);
  dailyTimer.unref?.();
}
