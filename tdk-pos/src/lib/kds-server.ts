import "server-only";

import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import {
  buildKdsTaskDrafts, needsNewCookingGroup, remainingKdsQuantity, transitionKdsState,
  type KdsMember, type KdsMenuKind, type KdsState, type KdsStateSnapshot, type KdsTaskStatus,
  KDS_WINDOW_MS,
} from "@/lib/kds-model";

type IdRow = RowDataPacket & { orderId: number };
type CursorRow = RowDataPacket & { initialOrderId: number; lastOrderId: number };
type SourceRow = RowDataPacket & {
  itemId: number; parentItemId: number | null; menuId: number;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  kdsKind: KdsMenuKind; kdsGroupKey: string | null; kdsCompletionTimer: number; printOnKitchen: number; kdsVisible: number;
};
type TaskRow = RowDataPacket & {
  taskId: number; orderId: number; memberItems: string; kind: "POT" | "SOLO";
  compatibilityKey: string; completionTimer: number; status: KdsTaskStatus;
  cookingGroupId: number | null; cookingStartedAtMs: number | null; cookingCompletedAtMs: number | null;
  previousState: string | null; changedAtMs: number | null; cancelAcknowledgedAtMs: number | null;
  sessionId: number; groupId: number | null; tableId: number | null; tableNo: string | null;
  sessionKind: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  displayName: string | null; orderStatus: string; sessionStatus: string; orderedAtMs: number; orderNote: string | null;
};
type ItemRow = RowDataPacket & {
  itemId: number; parentItemId: number | null; itemName: string; qty: number; note: string | null;
  actualComponentQty: number | null; status: string; kdsVisible: number;
};
type CancelRow = RowDataPacket & { itemId: number; cancelledQty: number };
type OptionRow = RowDataPacket & { itemId: number; optionName: string; qty: number };
type GroupRow = RowDataPacket & { groupId: number; startedAtMs: number };

const number = (value: number | string | null) => value === null ? null : Number(value);

async function materializeOrder(connection: PoolConnection, orderId: number) {
  const [items] = await connection.query<SourceRow[]>(`
    SELECT oi.order_item_id AS itemId, oi.parent_order_item_id AS parentItemId,
      oi.menu_id AS menuId, oi.item_type AS itemType, m.kds_kind AS kdsKind,
      m.kds_group_key AS kdsGroupKey, m.kds_completion_timer AS kdsCompletionTimer,
      m.kds_visible AS kdsVisible,
      CASE WHEN oi.item_type='COMPONENT' THEN COALESCE(mc.print_on_kitchen,1) ELSE 1 END AS printOnKitchen
    FROM order_items oi
    INNER JOIN menus m ON m.menu_id=oi.menu_id
    LEFT JOIN order_items parent ON parent.order_item_id=oi.parent_order_item_id
    LEFT JOIN menu_components mc ON mc.parent_menu_id=parent.menu_id AND mc.component_menu_id=oi.menu_id
    WHERE oi.order_id=? ORDER BY oi.order_item_id`, [orderId]);
  for (const task of buildKdsTaskDrafts(orderId, items.map(item => ({
    itemId: Number(item.itemId), parentItemId: number(item.parentItemId),
    menuId: Number(item.menuId), itemType: item.itemType, kdsKind: item.kdsKind,
    kdsGroupKey: item.kdsGroupKey, kdsCompletionTimer: Boolean(item.kdsCompletionTimer),
    printOnKitchen: Boolean(item.printOnKitchen), kdsVisible: Boolean(item.kdsVisible),
  })))) {
    await connection.execute(
      "INSERT IGNORE INTO kds_tasks (order_id,task_key,member_items,kind,compatibility_key,completion_timer) VALUES (?,?,?,?,?,?)",
      [task.orderId, task.taskKey, JSON.stringify(task.members), task.kind, task.compatibilityKey, Number(task.completionTimer)],
    );
  }
}

/** The cursor is locked across tablets. Open sessions at deployment are backfilled safely. */
export async function syncKdsOrders() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [cursors] = await connection.query<CursorRow[]>(
      "SELECT initial_order_id AS initialOrderId,last_order_id AS lastOrderId FROM kds_sync_cursor WHERE cursor_id=1 FOR UPDATE",
    );
    const cursor = cursors[0];
    if (!cursor) throw new Error("KDS migration is missing");
    const [newOrders] = await connection.query<IdRow[]>(
      // Recheck a small overlap: an order with a lower auto ID can commit
      // after a later order and would otherwise be skipped by the cursor.
      `SELECT o.order_id AS orderId FROM orders o
       INNER JOIN table_sessions s ON s.session_id=o.session_id
       WHERE o.order_id>? AND s.status='OPEN'
         AND NOT EXISTS (SELECT 1 FROM kds_tasks k WHERE k.order_id=o.order_id)
         AND EXISTS (SELECT 1 FROM order_items oi INNER JOIN menus m ON m.menu_id=oi.menu_id
           WHERE oi.order_id=o.order_id AND oi.parent_order_item_id IS NULL AND m.kds_kind<>'NONE' AND m.kds_visible=1)
       ORDER BY o.order_id LIMIT 250`,
      [Math.max(Number(cursor.initialOrderId), Number(cursor.lastOrderId) - 100)],
    );
    const [openOldOrders] = await connection.query<IdRow[]>(`
      SELECT o.order_id AS orderId FROM orders o
      INNER JOIN table_sessions s ON s.session_id=o.session_id
      WHERE s.status='OPEN' AND o.order_id<=? AND o.status IN ('ACCEPTED','OPEN','COMPLETED')
        AND NOT EXISTS (SELECT 1 FROM kds_tasks k WHERE k.order_id=o.order_id)
        AND EXISTS (SELECT 1 FROM order_items oi INNER JOIN menus m ON m.menu_id=oi.menu_id
          WHERE oi.order_id=o.order_id AND oi.parent_order_item_id IS NULL AND m.kds_kind<>'NONE' AND m.kds_visible=1)
      ORDER BY o.order_id`, [cursor.initialOrderId]);
    for (const orderId of new Set([...openOldOrders, ...newOrders].map(row => Number(row.orderId)))) {
      await materializeOrder(connection, orderId);
    }
    let nextCursor = Number(newOrders.at(-1)?.orderId ?? cursor.lastOrderId);
    if (newOrders.length < 250) {
      const [latestRows] = await connection.query<(RowDataPacket & { latestId: number })[]>(
        "SELECT COALESCE(MAX(order_id),0) AS latestId FROM orders",
      );
      nextCursor = Number(latestRows[0]?.latestId ?? nextCursor);
    }
    if (nextCursor > Number(cursor.lastOrderId)) await connection.execute(
      "UPDATE kds_sync_cursor SET last_order_id=? WHERE cursor_id=1", [nextCursor],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type KdsViewTask = {
  taskId: number; orderId: number; sessionId: number; tableId: number | null; groupId: number | null;
  label: string; sessionKind: TaskRow["sessionKind"]; orderedAtMs: number;
  kind: "POT" | "SOLO"; status: KdsTaskStatus; completionTimer: boolean;
  startedAtMs: number | null; completedAtMs: number | null; changedAtMs: number | null;
  cancelled: boolean; partiallyCancelled: boolean;
  orderNote: string | null;
  items: Array<{ itemId: number; name: string; qty: number; kind: KdsMember["kind"]; note: string | null; options: Array<{ name: string; qty: number }> }>;
};

export async function listKdsTasks(): Promise<KdsViewTask[]> {
  const recentDoneAt = Date.now() - 2 * 60 * 60 * 1000;
  const [tasks] = await pool.query<TaskRow[]>(`
    SELECT k.task_id AS taskId,k.order_id AS orderId,k.member_items AS memberItems,
      k.kind,k.compatibility_key AS compatibilityKey,k.completion_timer AS completionTimer,
      k.status,k.cooking_group_id AS cookingGroupId,k.cooking_started_at_ms AS cookingStartedAtMs,
      k.cooking_completed_at_ms AS cookingCompletedAtMs,k.previous_state AS previousState,
      k.changed_at_ms AS changedAtMs,k.cancel_acknowledged_at_ms AS cancelAcknowledgedAtMs,
      o.status AS orderStatus,o.note AS orderNote,ROUND(UNIX_TIMESTAMP(o.ordered_at)*1000) AS orderedAtMs,
      s.session_id AS sessionId,s.group_id AS groupId,s.table_id AS tableId,
      s.session_kind AS sessionKind,s.display_name AS displayName,s.status AS sessionStatus,
      dt.table_no AS tableNo
    FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id
    INNER JOIN table_sessions s ON s.session_id=o.session_id
    LEFT JOIN dining_tables dt ON dt.table_id=s.table_id
    -- A POS COMPLETE commits orders.COMPLETED and table_sessions.CLOSED together.
    -- Keep the true kitchen status/timestamps; the closed session is the durable KDS exit record.
    WHERE s.status='OPEN' AND (k.status<>'DONE' OR k.cooking_completed_at_ms>=?
      OR EXISTS (SELECT 1 FROM orders sibling_order
        INNER JOIN kds_tasks sibling ON sibling.order_id=sibling_order.order_id
        WHERE sibling_order.session_id=s.session_id AND sibling.status<>'DONE'))
    ORDER BY orderedAtMs,k.task_id`, [recentDoneAt]);
  if (!tasks.length) return [];
  const membersByTask = new Map<number, KdsMember[]>();
  const itemIds = new Set<number>();
  for (const task of tasks) {
    const members = JSON.parse(task.memberItems) as KdsMember[];
    membersByTask.set(Number(task.taskId), members);
    for (const member of members) itemIds.add(member.itemId);
  }
  const ids = [...itemIds];
  const [items, cancellations, options] = await Promise.all([
    pool.query<ItemRow[]>(`SELECT oi.order_item_id AS itemId,oi.parent_order_item_id AS parentItemId,
      oi.item_name AS itemName,oi.qty,oi.actual_component_qty AS actualComponentQty,oi.status,oi.note,
      m.kds_visible AS kdsVisible
      FROM order_items oi INNER JOIN menus m ON m.menu_id=oi.menu_id
      WHERE oi.order_item_id IN (?)`, [ids]).then(([rows]) => rows),
    pool.query<CancelRow[]>(`SELECT order_item_id AS itemId,SUM(cancelled_qty) AS cancelledQty
      FROM order_item_cancellations WHERE order_item_id IN (?) GROUP BY order_item_id`, [ids]).then(([rows]) => rows),
    pool.query<OptionRow[]>(`SELECT order_item_id AS itemId,option_name AS optionName,qty
      FROM order_item_options WHERE order_item_id IN (?) ORDER BY order_item_id,modifier_option_id`, [ids]).then(([rows]) => rows),
  ]);
  const itemById = new Map(items.map(item => [Number(item.itemId), item]));
  const cancelledById = new Map(cancellations.map(row => [Number(row.itemId), Number(row.cancelledQty)]));
  const optionsById = new Map<number, OptionRow[]>();
  for (const option of options) optionsById.set(Number(option.itemId), [...(optionsById.get(Number(option.itemId)) ?? []), option]);
  const result: KdsViewTask[] = [];
  for (const task of tasks) {
    const members = membersByTask.get(Number(task.taskId)) ?? [];
    const parentQty = new Map<number, number>();
    for (const member of members) {
      if (member.kind === "COMPONENT") continue;
      const item = itemById.get(member.itemId);
      if (!item) continue;
      parentQty.set(member.itemId, remainingKdsQuantity(
        Number(item.actualComponentQty ?? item.qty), cancelledById.get(member.itemId) ?? 0,
        item.status === "CANCELLED" || task.orderStatus === "CANCELLED" || task.sessionStatus === "CANCELLED",
      ));
    }
    const active = members.flatMap(member => {
      const item = itemById.get(member.itemId);
      if (!item || !item.kdsVisible) return [];
      if (member.kind === "COMPONENT" && !itemById.get(Number(item.parentItemId))?.kdsVisible) return [];
      const qty = member.kind === "COMPONENT"
        ? parentQty.get(Number(item.parentItemId)) ? remainingKdsQuantity(Number(item.actualComponentQty ?? item.qty), cancelledById.get(member.itemId) ?? 0, item.status === "CANCELLED") : 0
        : parentQty.get(member.itemId) ?? 0;
      if (!qty) return [];
      const originalQty = Number(item.actualComponentQty ?? item.qty);
      return [{ itemId: member.itemId, name: item.itemName, qty, kind: member.kind, note: item.note,
        options: (optionsById.get(member.itemId) ?? []).map(option => ({
          name: option.optionName, qty: Math.round(Number(option.qty) * qty / Math.max(1, originalQty)),
        })).filter(option => option.qty > 0) }];
    });
    if (!members.some(member => member.kind !== "COMPONENT" && itemById.get(member.itemId)?.kdsVisible)) continue;
    const cancelled = !members.some(member => member.kind !== "COMPONENT" && itemById.get(member.itemId)?.kdsVisible && (parentQty.get(member.itemId) ?? 0) > 0);
    if (cancelled && (task.status === "WAITING" || task.cancelAcknowledgedAtMs !== null)) continue;
    const displayItems = cancelled ? members.flatMap(member => {
      if (member.kind === "COMPONENT") return [];
      const item = itemById.get(member.itemId);
      return item?.kdsVisible ? [{ itemId: member.itemId, name: item.itemName, qty: Number(item.actualComponentQty ?? item.qty), kind: member.kind, note: item.note, options: [] }] : [];
    }) : active;
    result.push({
      taskId: Number(task.taskId), orderId: Number(task.orderId), sessionId: Number(task.sessionId),
      tableId: number(task.tableId), groupId: number(task.groupId),
      label: task.sessionKind === "DINE_IN" ? String(task.tableNo ?? task.tableId ?? "?") : task.displayName ?? (task.sessionKind === "TAKEOUT_PHONE" ? "전화포장" : "방문포장"),
      sessionKind: task.sessionKind, orderedAtMs: Number(task.orderedAtMs), kind: task.kind,
      status: task.status, completionTimer: Boolean(task.completionTimer),
      orderNote: task.orderNote,
      startedAtMs: number(task.cookingStartedAtMs), completedAtMs: number(task.cookingCompletedAtMs),
      changedAtMs: number(task.changedAtMs), cancelled,
      partiallyCancelled: !cancelled && members.some(member => (cancelledById.get(member.itemId) ?? 0) > 0 || itemById.get(member.itemId)?.status === "CANCELLED"),
      items: displayItems,
    });
  }
  return result;
}

export class KdsActionError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message); }
}

type LockedTask = RowDataPacket & Pick<TaskRow,
  "taskId" | "memberItems" | "compatibilityKey" | "status" | "cookingGroupId" |
  "cookingStartedAtMs" | "cookingCompletedAtMs" | "previousState" | "changedAtMs" | "cancelAcknowledgedAtMs">;

export async function updateKdsTask(
  taskId: number, action: "MENU" | "TIME" | "ACK",
  expected: { status: KdsTaskStatus; changedAtMs: number | null },
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<LockedTask[]>(`
      SELECT task_id AS taskId,member_items AS memberItems,compatibility_key AS compatibilityKey,
        status,cooking_group_id AS cookingGroupId,cooking_started_at_ms AS cookingStartedAtMs,
        cooking_completed_at_ms AS cookingCompletedAtMs,previous_state AS previousState,
        changed_at_ms AS changedAtMs,cancel_acknowledged_at_ms AS cancelAcknowledgedAtMs
      FROM kds_tasks WHERE task_id=? FOR UPDATE`, [taskId]);
    const row = rows[0];
    if (!row) throw new KdsActionError("조리 작업을 찾을 수 없습니다.", 404);
    if (row.status !== expected.status || number(row.changedAtMs) !== expected.changedAtMs) {
      throw new KdsActionError("다른 주방 화면에서 먼저 변경했습니다. 최신 상태를 확인해 주세요.");
    }
    const members = JSON.parse(row.memberItems) as KdsMember[];
    const primaryIds = members.filter(member => member.kind !== "COMPONENT").map(member => member.itemId);
    if (!primaryIds.length) throw new KdsActionError("조리 항목을 찾을 수 없습니다.");
    const [activeRows] = await connection.query<RowDataPacket[]>(`
      SELECT oi.order_item_id AS itemId,oi.status,
        COALESCE(oi.actual_component_qty,oi.qty)-COALESCE(c.cancelled_qty,0) AS remaining,
        o.status AS orderStatus,s.status AS sessionStatus
      FROM order_items oi INNER JOIN orders o ON o.order_id=oi.order_id
      INNER JOIN table_sessions s ON s.session_id=o.session_id
      LEFT JOIN (SELECT order_item_id,SUM(cancelled_qty) AS cancelled_qty
        FROM order_item_cancellations WHERE order_item_id IN (?) GROUP BY order_item_id) c ON c.order_item_id=oi.order_item_id
      WHERE oi.order_item_id IN (?)`, [primaryIds, primaryIds]);
    if (activeRows.some(item => item.sessionStatus === "CLOSED")) {
      throw new KdsActionError("POS에서 종료된 주문입니다. 화면을 갱신해 주세요.");
    }
    const cancelled = !activeRows.some(item => item.status !== "CANCELLED" && item.orderStatus !== "CANCELLED" && item.sessionStatus !== "CANCELLED" && Number(item.remaining) > 0);
    const now = Date.now();
    if (action === "ACK") {
      if (!cancelled) throw new KdsActionError("취소된 주문이 아닙니다.");
      await connection.execute("UPDATE kds_tasks SET cancel_acknowledged_at_ms=? WHERE task_id=?", [now, taskId]);
      await connection.commit();
      return;
    }
    if (cancelled) throw new KdsActionError("POS에서 취소된 주문입니다. 취소 알림을 확인해 주세요.");
    const state: KdsState = {
      status: row.status, cookingGroupId: number(row.cookingGroupId),
      cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
      previousState: row.previousState ? JSON.parse(row.previousState) as KdsStateSnapshot : null,
      changedAtMs: number(row.changedAtMs),
    };
    let newGroup: { groupId: number; startedAtMs: number } | undefined;
    if (action === "MENU" && needsNewCookingGroup(state, now)) {
      await connection.query("SELECT mutex_id FROM kds_group_mutex WHERE mutex_id=1 FOR UPDATE");
      const groupNow = Date.now();
      const [groups] = await connection.query<GroupRow[]>(`
        SELECT group_id AS groupId,started_at_ms AS startedAtMs FROM kds_cooking_groups
        WHERE compatibility_key=? AND started_at_ms>=?
        ORDER BY started_at_ms DESC,group_id DESC LIMIT 1 FOR UPDATE`,
      [row.compatibilityKey, groupNow - KDS_WINDOW_MS]);
      if (groups[0]) newGroup = { groupId: Number(groups[0].groupId), startedAtMs: Number(groups[0].startedAtMs) };
      else {
        const [insert] = await connection.execute<ResultSetHeader>(
          "INSERT INTO kds_cooking_groups (compatibility_key,started_at_ms) VALUES (?,?)",
          [row.compatibilityKey, groupNow],
        );
        newGroup = { groupId: insert.insertId, startedAtMs: groupNow };
      }
    }
    const transitionAt = Math.max(Date.now(), (state.changedAtMs ?? 0) + 1);
    const next = transitionKdsState(state, action, transitionAt, newGroup);
    if (!next) throw new KdsActionError("현재 상태에서는 해당 조작을 할 수 없습니다. 화면을 갱신해 주세요.");
    await connection.execute(`
      UPDATE kds_tasks SET status=?,cooking_group_id=?,cooking_started_at_ms=?,
        cooking_completed_at_ms=?,previous_state=?,changed_at_ms=? WHERE task_id=?`,
      [next.status, next.cookingGroupId, next.cookingStartedAtMs,
        next.cookingCompletedAtMs, JSON.stringify(next.previousState), next.changedAtMs, taskId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
