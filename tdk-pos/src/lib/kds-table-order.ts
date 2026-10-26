import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import { completeKdsTableOrder, groupKdsTasksByParty, preparingKdsPartyCards } from "@/lib/kds-party-grouping";
import type { KdsViewTask } from "@/lib/kds-server";

type OrderRow = RowDataPacket & { sessionId: number; sortOrder: number };
type PartyOrderRow = RowDataPacket & { sessionId: number; sortOrder: number };
type ActiveSessionRow = RowDataPacket & { sessionId: number; fallbackOrder: number };

export function activeKdsSessionIds(tasks: KdsViewTask[]): number[] {
  return [...new Set(preparingKdsPartyCards(groupKdsTasksByParty(tasks))
    .flatMap(card => card.tables.map(table => table.sessionId)))];
}

export async function getKdsTableOrder(sessionIds: number[]): Promise<Record<number, number>> {
  if (!sessionIds.length) return {};
  const [rows] = await pool.query<OrderRow[]>(
    "SELECT session_id AS sessionId,sort_order AS sortOrder FROM kds_table_order WHERE session_id IN (?)",
    [sessionIds],
  );
  return Object.fromEntries(rows.map(row => [Number(row.sessionId), Number(row.sortOrder)]));
}

export async function getKdsPartyTableOrder(sessionIds: number[]): Promise<Record<number, number>> {
  if (!sessionIds.length) return {};
  const [rows] = await pool.query<PartyOrderRow[]>(
    `SELECT po.session_id AS sessionId,po.sort_order AS sortOrder FROM kds_party_table_order po
     INNER JOIN table_sessions s ON s.session_id=po.session_id AND s.group_id=po.party_group_id
     WHERE po.session_id IN (?)`,
    [sessionIds],
  );
  return Object.fromEntries(rows.map(row => [Number(row.sessionId), Number(row.sortOrder)]));
}

async function saveOrderRows(connection: PoolConnection, sessionIds: number[]) {
  for (const [sortOrder, sessionId] of sessionIds.entries()) {
    await connection.execute(
      `INSERT INTO kds_table_order (session_id,sort_order) VALUES (?,?)
       ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order)`,
      [sessionId, sortOrder],
    );
  }
}

/** Save display ranks only; this path deliberately does not run KDS task synchronization/finalization. */
export async function persistKdsTableOrder(requestedIds: number[]): Promise<Record<number, number>> {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<Array<RowDataPacket & { acquired: number }>>(
      "SELECT GET_LOCK('tdk_kds_table_order', 5) AS acquired",
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) throw new Error("다른 화면에서 조리 순서를 저장 중입니다. 잠시 후 다시 시도해 주세요.");
    await connection.beginTransaction();
    const [activeRows] = await connection.query<ActiveSessionRow[]>(`
      SELECT s.session_id AS sessionId,MIN(o.ordered_at) AS fallbackOrder
      FROM table_sessions s
      INNER JOIN orders o ON o.session_id=s.session_id
      INNER JOIN kds_tasks k ON k.order_id=o.order_id
      WHERE s.status='OPEN'
      GROUP BY s.session_id
      ORDER BY fallbackOrder,MIN(k.task_id),s.session_id`);
    const activeIds = activeRows.map(row => Number(row.sessionId));
    const [rankRows] = activeIds.length
      ? await connection.query<OrderRow[]>(
        "SELECT session_id AS sessionId,sort_order AS sortOrder FROM kds_table_order WHERE session_id IN (?) FOR UPDATE",
        [activeIds],
      )
      : [[] as OrderRow[]];
    const fallbackOrder = Object.fromEntries(activeRows.map((row, index) => [Number(row.sessionId), index]));
    const finalOrder = completeKdsTableOrder(
      requestedIds,
      activeIds,
      Object.fromEntries(rankRows.map(row => [Number(row.sessionId), Number(row.sortOrder)])),
      fallbackOrder,
    );
    if (!finalOrder) throw new Error("화면의 주방 작업 목록이 변경되었습니다. 목록을 새로고침한 후 다시 정렬해 주세요.");
    await saveOrderRows(connection, finalOrder);
    await connection.commit();
    return Object.fromEntries(finalOrder.map((id, index) => [id, index]));
  } catch (error) {
    try { await connection.rollback(); } catch { /* transaction may not have started */ }
    throw error;
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK('tdk_kds_table_order')"); } catch { /* connection release frees advisory locks */ }
    }
    connection.release();
  }
}

/** Persist a party's internal order without changing the shared global table order. */
export async function persistKdsPartyTableOrder(groupId: number, requestedIds: number[]): Promise<Record<number, number>> {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<Array<RowDataPacket & { acquired: number }>>(
      "SELECT GET_LOCK('tdk_kds_table_order', 5) AS acquired",
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) throw new Error("다른 화면에서 조리 순서를 저장 중입니다. 잠시 후 다시 시도해 주세요.");
    await connection.beginTransaction();
    const [memberRows] = await connection.query<Array<RowDataPacket & { sessionId: number }>>(
      `SELECT s.session_id AS sessionId FROM table_sessions s
       WHERE s.session_id IN (?) AND s.group_id=? AND s.session_kind='DINE_IN' AND s.status='OPEN'
         AND EXISTS (SELECT 1 FROM orders o INNER JOIN kds_tasks k ON k.order_id=o.order_id WHERE o.session_id=s.session_id)
       FOR UPDATE`,
      [requestedIds, groupId],
    );
    const memberIds = memberRows.map(row => Number(row.sessionId));
    if (requestedIds.length < 2 || memberIds.length !== requestedIds.length || new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some(id => !memberIds.includes(id))) {
      throw new Error("일행 내부 순서 대상이 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.");
    }
    for (const [partySortOrder, sessionId] of requestedIds.entries()) {
      await connection.execute(
        `INSERT INTO kds_party_table_order (party_group_id,session_id,sort_order) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order)`,
        [groupId, sessionId, partySortOrder],
      );
    }
    await connection.commit();
    return Object.fromEntries(requestedIds.map((id, index) => [id, index]));
  } catch (error) {
    try { await connection.rollback(); } catch { /* transaction may not have started */ }
    throw error;
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK('tdk_kds_table_order')"); } catch { /* connection release frees advisory locks */ }
    }
    connection.release();
  }
}
