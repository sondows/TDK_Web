import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import {
  buildKdsTaskDrafts, canJoinKdsCookingGroup, isKdsMenuEligible, needsNewCookingGroup, remainingKdsQuantity, transitionKdsState,
  isKdsPostCookTimerMinutes, type KdsPostCookTimerMinutes, type KdsMember, type KdsMenuKind, type KdsState, type KdsStateSnapshot, type KdsTaskStatus,
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
  postCookTimerMinutes: number | null; postCookTimerStartedAtMs: number | null;
  previousState: string | null; changedAtMs: number | null; cancelAcknowledgedAtMs: number | null;
  sessionId: number; groupId: number | null; tableId: number | null; tableNo: string | null;
  sessionKind: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  displayName: string | null; orderStatus: string; sessionStatus: string; orderedAtMs: number; orderNote: string | null;
};
type ItemRow = RowDataPacket & {
  itemId: number; parentItemId: number | null; itemName: string; qty: number; note: string | null;
  actualComponentQty: number | null; status: string; kdsVisible: number; kdsKind: KdsMenuKind; kdsPostCookTimer: number;
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
  postCookTimerEligible: boolean; postCookTimerMinutes: KdsPostCookTimerMinutes | null; postCookTimerStartedAtMs: number | null;
  completionRequestedAtMs: number | null; completionRequestId: string | null; completionRequestScope: "TASK" | "TABLE" | null;
  pendingPostCookTimerMinutes: KdsPostCookTimerMinutes | null;
  startedAtMs: number | null; completedAtMs: number | null; changedAtMs: number | null;
  previousStatus: KdsTaskStatus | null; bulkStartId: string | null;
  startSource: "MENU" | "STATUS" | "TABLE" | null;
  cancelled: boolean; partiallyCancelled: boolean;
  orderNote: string | null;
  items: Array<{ itemId: number; name: string; qty: number; kind: KdsMember["kind"]; note: string | null; options: Array<{ name: string; qty: number }> }>;
};

type KdsPreviousState = KdsStateSnapshot & {
  bulkStartId?: string;
  startSource?: "MENU" | "STATUS" | "TABLE";
  completionRequest?: {
    requestedAtMs: number; postCookTimerMinutes: number | null; requestId?: string;
    scope?: "TASK" | "TABLE"; sessionId?: number; expectedStatus?: KdsTaskStatus; expectedChangedAtMs?: number | null;
  };
};

function parseKdsPreviousState(value: string | null): KdsPreviousState | null {
  if (!value) return null;
  try { return JSON.parse(value) as KdsPreviousState; } catch { return null; }
}

const pendingCompletion = (previous: KdsPreviousState | null) => previous?.completionRequest ?? null;
const stateSnapshotForKds = (state: KdsState): KdsStateSnapshot => ({
  status: state.status, cookingGroupId: state.cookingGroupId,
  cookingStartedAtMs: state.cookingStartedAtMs, cookingCompletedAtMs: state.cookingCompletedAtMs,
});

export async function listKdsTasks(): Promise<KdsViewTask[]> {
  await finalizeExpiredKdsTaskCompletions();
  await cleanupUnusedKdsCookingGroups();
  const recentDoneAt = Date.now() - 2 * 60 * 60 * 1000;
  const [tasks] = await pool.query<TaskRow[]>(`
    SELECT k.task_id AS taskId,k.order_id AS orderId,k.member_items AS memberItems,
      k.kind,k.compatibility_key AS compatibilityKey,k.completion_timer AS completionTimer,
      k.post_cook_timer_minutes AS postCookTimerMinutes,k.post_cook_timer_started_at_ms AS postCookTimerStartedAtMs,
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
      m.kds_visible AS kdsVisible,m.kds_kind AS kdsKind,m.kds_post_cook_timer AS kdsPostCookTimer
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
    const eligibleItem = (itemId: number) => {
      const item = itemById.get(itemId);
      return Boolean(item && isKdsMenuEligible({ kdsKind: item.kdsKind, kdsVisible: Boolean(item.kdsVisible) }));
    };
    const eligibleMember = (member: KdsMember) => {
      if (!eligibleItem(member.itemId)) return false;
      if (member.kind !== "COMPONENT") return true;
      const item = itemById.get(member.itemId);
      return item?.parentItemId !== null && item?.parentItemId !== undefined && eligibleItem(Number(item.parentItemId));
    };
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
      if (!item || !eligibleMember(member)) return [];
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
    if (!members.some(member => member.kind !== "COMPONENT" && eligibleMember(member))) continue;
    const cancelled = !members.some(member => member.kind !== "COMPONENT" && eligibleMember(member) && (parentQty.get(member.itemId) ?? 0) > 0);
    if (cancelled && (task.status === "WAITING" || task.cancelAcknowledgedAtMs !== null)) continue;
    const displayItems = cancelled ? members.flatMap(member => {
      if (member.kind === "COMPONENT") return [];
      const item = itemById.get(member.itemId);
      return item && eligibleMember(member) ? [{ itemId: member.itemId, name: item.itemName, qty: Number(item.actualComponentQty ?? item.qty), kind: member.kind, note: item.note, options: [] }] : [];
    }) : active;
    const previousState = parseKdsPreviousState(task.previousState);
    const completionRequest = pendingCompletion(previousState);
    result.push({
      taskId: Number(task.taskId), orderId: Number(task.orderId), sessionId: Number(task.sessionId),
      tableId: number(task.tableId), groupId: number(task.groupId),
      label: task.sessionKind === "DINE_IN" ? String(task.tableNo ?? task.tableId ?? "?") : task.displayName ?? (task.sessionKind === "TAKEOUT_PHONE" ? "전화포장" : "방문포장"),
      sessionKind: task.sessionKind, orderedAtMs: Number(task.orderedAtMs), kind: task.kind,
      status: task.status, completionTimer: Boolean(task.completionTimer),
      postCookTimerEligible: active.some(item => Boolean(itemById.get(item.itemId)?.kdsPostCookTimer)),
      postCookTimerMinutes: task.postCookTimerMinutes !== null && isKdsPostCookTimerMinutes(Number(task.postCookTimerMinutes)) ? Number(task.postCookTimerMinutes) as KdsPostCookTimerMinutes : null,
      postCookTimerStartedAtMs: number(task.postCookTimerStartedAtMs),
      completionRequestedAtMs: completionRequest?.requestedAtMs ?? null,
      completionRequestId: completionRequest?.requestId ?? null,
      completionRequestScope: completionRequest?.scope ?? (completionRequest ? "TASK" : null),
      pendingPostCookTimerMinutes: completionRequest?.postCookTimerMinutes !== null && isKdsPostCookTimerMinutes(completionRequest?.postCookTimerMinutes)
        ? completionRequest.postCookTimerMinutes : null,
      orderNote: task.orderNote,
      startedAtMs: number(task.cookingStartedAtMs), completedAtMs: number(task.cookingCompletedAtMs),
      changedAtMs: number(task.changedAtMs),
      previousStatus: previousState?.status ?? null,
      bulkStartId: previousState?.bulkStartId ?? null,
      startSource: previousState?.startSource ?? null,
      cancelled,
      partiallyCancelled: !cancelled && members.some(member => eligibleMember(member) && ((cancelledById.get(member.itemId) ?? 0) > 0 || itemById.get(member.itemId)?.status === "CANCELLED")),
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
  "cookingStartedAtMs" | "cookingCompletedAtMs" | "postCookTimerMinutes" | "postCookTimerStartedAtMs" | "previousState" | "changedAtMs" | "cancelAcknowledgedAtMs">;

export async function updateKdsTask(
  taskId: number, action: "MENU" | "STATUS" | "TIME" | "ACK",
  expected: { status: KdsTaskStatus; changedAtMs: number | null },
  postCookTimerMinutes?: KdsPostCookTimerMinutes,
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<LockedTask[]>(`
      SELECT task_id AS taskId,member_items AS memberItems,compatibility_key AS compatibilityKey,
        status,cooking_group_id AS cookingGroupId,cooking_started_at_ms AS cookingStartedAtMs,
        cooking_completed_at_ms AS cookingCompletedAtMs,post_cook_timer_minutes AS postCookTimerMinutes,
        post_cook_timer_started_at_ms AS postCookTimerStartedAtMs,previous_state AS previousState,
        changed_at_ms AS changedAtMs,cancel_acknowledged_at_ms AS cancelAcknowledgedAtMs
      FROM kds_tasks WHERE task_id=? FOR UPDATE`, [taskId]);
    const row = rows[0];
    if (!row) throw new KdsActionError("조리 작업을 찾을 수 없습니다.", 404);
    if (row.status !== expected.status || number(row.changedAtMs) !== expected.changedAtMs) {
      throw new KdsActionError("다른 주방 화면에서 먼저 변경했습니다. 최신 상태를 확인해 주세요.");
    }
    const members = JSON.parse(row.memberItems) as KdsMember[];
    const primaryIds = members.filter(member => member.kind !== "COMPONENT").map(member => member.itemId);
    const memberIds = members.map(member => member.itemId);
    if (!primaryIds.length) throw new KdsActionError("조리 항목을 찾을 수 없습니다.");
    const [activeRows] = await connection.query<RowDataPacket[]>(`
      SELECT oi.order_item_id AS itemId,oi.parent_order_item_id AS parentItemId,oi.status,
        m.kds_post_cook_timer AS kdsPostCookTimer,m.kds_kind AS kdsKind,m.kds_visible AS kdsVisible,
        COALESCE(oi.actual_component_qty,oi.qty)-COALESCE(c.cancelled_qty,0) AS remaining,
        o.status AS orderStatus,s.status AS sessionStatus
      FROM order_items oi INNER JOIN menus m ON m.menu_id=oi.menu_id INNER JOIN orders o ON o.order_id=oi.order_id
      INNER JOIN table_sessions s ON s.session_id=o.session_id
      LEFT JOIN (SELECT order_item_id,SUM(cancelled_qty) AS cancelled_qty
        FROM order_item_cancellations WHERE order_item_id IN (?) GROUP BY order_item_id) c ON c.order_item_id=oi.order_item_id
      WHERE oi.order_item_id IN (?)`, [memberIds, memberIds]);
    if (activeRows.some(item => item.sessionStatus === "CLOSED")) {
      throw new KdsActionError("POS에서 종료된 주문입니다. 화면을 갱신해 주세요.");
    }
    const isActive = (item: RowDataPacket) => item.status !== "CANCELLED" && item.orderStatus !== "CANCELLED" && item.sessionStatus !== "CANCELLED" && Number(item.remaining) > 0;
    const activePrimaryIds = new Set(activeRows.filter(item => primaryIds.includes(Number(item.itemId)) && isActive(item)).map(item => Number(item.itemId)));
    const cancelled = activePrimaryIds.size === 0;
    const timerEligible = activeRows.some(item => Boolean(item.kdsPostCookTimer) &&
      isKdsMenuEligible({ kdsKind: item.kdsKind, kdsVisible: Boolean(item.kdsVisible) }) && isActive(item) &&
      (primaryIds.includes(Number(item.itemId)) || activePrimaryIds.has(Number(item.parentItemId))));
    if (action === "TIME" && row.status === "COOKING" && timerEligible && !isKdsPostCookTimerMinutes(postCookTimerMinutes)) {
      throw new KdsActionError("조리 후 타이머를 3분, 5분, 10분 중 선택해 주세요.", 400);
    }
    if (postCookTimerMinutes !== undefined && !(action === "TIME" && row.status === "COOKING" && timerEligible && isKdsPostCookTimerMinutes(postCookTimerMinutes))) {
      throw new KdsActionError("이 조리작업에는 조리 후 타이머를 설정할 수 없습니다.", 400);
    }
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
      previousState: parseKdsPreviousState(row.previousState),
      changedAtMs: number(row.changedAtMs),
    };
    if (pendingCompletion(state.previousState)) {
      throw new KdsActionError("테이블 완료 카운트다운 중에는 상태를 변경할 수 없습니다.");
    }
    if ((action === "MENU" || action === "STATUS") && state.status === "COOKING" &&
      state.previousState?.status === "WAITING" && state.changedAtMs !== null && now >= state.changedAtMs &&
      now - state.changedAtMs <= KDS_WINDOW_MS) {
      const startedFrom = parseKdsPreviousState(row.previousState)?.startSource;
      if (startedFrom === "TABLE" || (startedFrom && startedFrom !== action)) {
        throw new KdsActionError("조리를 시작한 버튼에서만 3초 취소할 수 있습니다.");
      }
    }
    let newGroup: { groupId: number | null; startedAtMs: number } | undefined;
    if (action === "MENU" && needsNewCookingGroup(state, now)) {
      await connection.query("SELECT mutex_id FROM kds_group_mutex WHERE mutex_id=1 FOR UPDATE");
      const groupNow = Date.now();
      const [groups] = await connection.query<GroupRow[]>(`
        SELECT g.group_id AS groupId,g.started_at_ms AS startedAtMs,MAX(k.changed_at_ms) AS lastStartAtMs
        FROM kds_cooking_groups g INNER JOIN kds_tasks k ON k.cooking_group_id=g.group_id AND k.status='COOKING'
        WHERE g.compatibility_key=? GROUP BY g.group_id,g.started_at_ms
        HAVING MAX(k.changed_at_ms)>=? ORDER BY lastStartAtMs DESC,g.group_id DESC LIMIT 1`,
      [row.compatibilityKey, groupNow - KDS_WINDOW_MS]);
      if (groups[0] && canJoinKdsCookingGroup(Number(groups[0].lastStartAtMs), groupNow)) {
        newGroup = { groupId: Number(groups[0].groupId), startedAtMs: Number(groups[0].startedAtMs) };
      }
      if (!newGroup) {
        const [insert] = await connection.execute<ResultSetHeader>(
          "INSERT INTO kds_cooking_groups (compatibility_key,started_at_ms) VALUES (?,?)",
          [row.compatibilityKey, groupNow],
        );
        newGroup = { groupId: insert.insertId, startedAtMs: groupNow };
      }
    }
    if (action === "STATUS" && state.status === "WAITING" && needsNewCookingGroup(state, now)) {
      newGroup = { groupId: null, startedAtMs: now };
    }
    const transitionAt = Math.max(now, (state.changedAtMs ?? 0) + 1);
    const next = transitionKdsState(state, action === "STATUS" ? "MENU" : action, transitionAt, newGroup);
    if (!next) throw new KdsActionError("현재 상태에서는 해당 조작을 할 수 없습니다. 화면을 갱신해 주세요.");
    const persistedPreviousState = next.status === "COOKING" && row.status === "WAITING" && next.previousState
      ? { ...next.previousState, startSource: action === "STATUS" ? "STATUS" as const : "MENU" as const }
      : next.previousState;
    await connection.execute(`
      UPDATE kds_tasks SET status=?,cooking_group_id=?,cooking_started_at_ms=?,
        cooking_completed_at_ms=?,previous_state=?,changed_at_ms=?,post_cook_timer_minutes=?,post_cook_timer_started_at_ms=? WHERE task_id=?`,
      [next.status, next.cookingGroupId, next.cookingStartedAtMs,
        next.cookingCompletedAtMs, JSON.stringify(persistedPreviousState), next.changedAtMs,
        next.status === "DONE" && row.status === "COOKING" && timerEligible ? postCookTimerMinutes ?? null : null,
        next.status === "DONE" && row.status === "COOKING" && timerEligible ? next.cookingCompletedAtMs : null, taskId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

type CompletionLockedTask = RowDataPacket & {
  taskId: number; memberItems: string; status: KdsTaskStatus; cookingGroupId: number | null;
  cookingStartedAtMs: number | null; cookingCompletedAtMs: number | null; previousState: string | null;
  changedAtMs: number | null;
};

async function taskCookingEligibility(connection: PoolConnection, memberItems: string) {
  const members = JSON.parse(memberItems) as KdsMember[];
  const primaryIds = members.filter(member => member.kind !== "COMPONENT").map(member => member.itemId);
  const ids = members.map(member => member.itemId);
  if (!ids.length) return { hasActivePrimary: false, timerEligible: false };
  const [rows] = await connection.query<Array<RowDataPacket & {
    itemId: number; parentItemId: number | null; timerEligible: number; kdsKind: KdsMenuKind; kdsVisible: number;
    itemStatus: string; remaining: number; orderStatus: string; sessionStatus: string;
  }>>(`
    SELECT oi.order_item_id AS itemId,oi.parent_order_item_id AS parentItemId,m.kds_post_cook_timer AS timerEligible,
      m.kds_kind AS kdsKind,m.kds_visible AS kdsVisible,oi.status AS itemStatus,
      COALESCE(oi.actual_component_qty,oi.qty)-COALESCE(c.cancelled_qty,0) AS remaining,
      o.status AS orderStatus,s.status AS sessionStatus
    FROM order_items oi INNER JOIN menus m ON m.menu_id=oi.menu_id
    INNER JOIN orders o ON o.order_id=oi.order_id INNER JOIN table_sessions s ON s.session_id=o.session_id
    LEFT JOIN (SELECT order_item_id,SUM(cancelled_qty) AS cancelled_qty
      FROM order_item_cancellations WHERE order_item_id IN (?) GROUP BY order_item_id) c ON c.order_item_id=oi.order_item_id
    WHERE oi.order_item_id IN (?)`, [ids, ids]);
  const active = (row: typeof rows[number]) => row.itemStatus !== "CANCELLED" && row.orderStatus !== "CANCELLED" &&
    row.sessionStatus === "OPEN" && row.kdsKind !== "NONE" && Boolean(row.kdsVisible) && Number(row.remaining) > 0;
  const activePrimaryIds = new Set(rows.filter(row => primaryIds.includes(Number(row.itemId)) && active(row)).map(row => Number(row.itemId)));
  return {
    hasActivePrimary: activePrimaryIds.size > 0,
    timerEligible: rows.some(row => Boolean(row.timerEligible) && active(row) &&
      (primaryIds.includes(Number(row.itemId)) || activePrimaryIds.has(Number(row.parentItemId)))),
  };
}

async function lockCompletionTask(connection: PoolConnection, taskId: number) {
  const [rows] = await connection.query<CompletionLockedTask[]>(`
    SELECT task_id AS taskId,member_items AS memberItems,status,cooking_group_id AS cookingGroupId,
      cooking_started_at_ms AS cookingStartedAtMs,cooking_completed_at_ms AS cookingCompletedAtMs,
      previous_state AS previousState,changed_at_ms AS changedAtMs
    FROM kds_tasks WHERE task_id=? FOR UPDATE`, [taskId]);
  return rows[0] ?? null;
}

function completionState(row: CompletionLockedTask): KdsState {
  return {
    status: row.status, cookingGroupId: number(row.cookingGroupId),
    cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
    previousState: parseKdsPreviousState(row.previousState), changedAtMs: number(row.changedAtMs),
  };
}

export async function requestKdsTaskCompletion(
  taskId: number,
  expected: { status: KdsTaskStatus; changedAtMs: number | null },
  postCookTimerMinutes?: KdsPostCookTimerMinutes,
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await lockCompletionTask(connection, taskId);
    if (!row || row.status !== expected.status || number(row.changedAtMs) !== expected.changedAtMs) {
      throw new KdsActionError("조리 상태가 바뀌었습니다. 화면을 새로고침해 주세요.");
    }
    if (row.status !== "COOKING") throw new KdsActionError("조리중인 메뉴만 완료 요청할 수 있습니다.");
    const now = Date.now();
    const state = completionState(row);
    if (state.previousState?.status === "WAITING" && state.changedAtMs !== null && now >= state.changedAtMs && now - state.changedAtMs <= KDS_WINDOW_MS) {
      throw new KdsActionError("조리 시작 취소 가능 시간에는 완료 요청을 시작할 수 없습니다.");
    }
    const previous = parseKdsPreviousState(row.previousState) ?? {
      status: row.status, cookingGroupId: number(row.cookingGroupId),
      cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
    };
    if (pendingCompletion(previous)) throw new KdsActionError("완료 요청이 이미 진행 중입니다.");
    const eligibility = await taskCookingEligibility(connection, row.memberItems);
    if (!eligibility.hasActivePrimary) throw new KdsActionError("POS에서 취소되었거나 종료된 주문입니다.");
    const timerEligible = eligibility.timerEligible;
    if (timerEligible && !isKdsPostCookTimerMinutes(postCookTimerMinutes)) {
      throw new KdsActionError("외부 끓임 시간을 선택해 주세요.", 400);
    }
    if (!timerEligible && postCookTimerMinutes !== undefined) throw new KdsActionError("이 메뉴에는 외부 끓임 시간을 지정할 수 없습니다.", 400);
    previous.completionRequest = { requestedAtMs: now, postCookTimerMinutes: timerEligible ? postCookTimerMinutes! : null };
    await connection.execute("UPDATE kds_tasks SET previous_state=? WHERE task_id=? AND status='COOKING'", [JSON.stringify(previous), taskId]);
    await connection.commit();
    return { requestedAtMs: now };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function cancelKdsTaskCompletion(taskId: number, expectedRequestAtMs: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await lockCompletionTask(connection, taskId);
    if (!row || row.status !== "COOKING") throw new KdsActionError("조리 상태가 이미 변경되었습니다.");
    const previous = parseKdsPreviousState(row.previousState);
    const request = pendingCompletion(previous);
    if (!previous || !request || request.requestedAtMs !== expectedRequestAtMs) {
      throw new KdsActionError("완료 요청 상태가 이미 변경되었습니다.");
    }
    if (request.scope === "TABLE") throw new KdsActionError("테이블 전체 완료는 테이블 번호 버튼으로 취소해야 합니다.");
    if (Date.now() >= request.requestedAtMs + 5000) {
      await connection.commit();
      return { cancelled: false, expired: true };
    }
    delete previous.completionRequest;
    await connection.execute("UPDATE kds_tasks SET previous_state=? WHERE task_id=? AND status='COOKING'", [JSON.stringify(previous), taskId]);
    await connection.commit();
    return { cancelled: true, expired: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function finalizeKdsTaskCompletion(taskId: number, expectedRequestAtMs?: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [taskSessions] = await connection.query<Array<RowDataPacket & { sessionId: number }>>(`
      SELECT o.session_id AS sessionId FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id WHERE k.task_id=?`, [taskId]);
    if (!taskSessions[0]) {
      await connection.commit();
      return false;
    }
    const [sessions] = await connection.query<Array<RowDataPacket & { status: string }>>(
      "SELECT status FROM table_sessions WHERE session_id=? FOR UPDATE", [taskSessions[0].sessionId]);
    if (sessions[0]?.status !== "OPEN") {
      await connection.commit();
      return false;
    }
    const row = await lockCompletionTask(connection, taskId);
    if (!row || row.status !== "COOKING") {
      await connection.commit();
      return false;
    }
    const previous = parseKdsPreviousState(row.previousState);
    const request = pendingCompletion(previous);
    if (!previous || !request || request.scope === "TABLE" || (expectedRequestAtMs !== undefined && request.requestedAtMs !== expectedRequestAtMs)) {
      await connection.commit();
      return false;
    }
    const completedAt = Date.now();
    if (completedAt < request.requestedAtMs + 5000) {
      await connection.commit();
      return false;
    }
    const eligibility = await taskCookingEligibility(connection, row.memberItems);
    if (!eligibility.hasActivePrimary) {
      await connection.commit();
      return false;
    }
    const timerEligible = eligibility.timerEligible;
    if (timerEligible && !isKdsPostCookTimerMinutes(request.postCookTimerMinutes)) {
      throw new KdsActionError("완료 시간 선택이 없어 완료하지 않았습니다.");
    }
    const state = completionState(row);
    const next = transitionKdsState(state, "TIME", Math.max(completedAt, (state.changedAtMs ?? 0) + 1));
    if (!next || next.status !== "DONE") {
      await connection.commit();
      return false;
    }
    const timerMinutes = timerEligible ? request.postCookTimerMinutes : null;
    await connection.execute(`
      UPDATE kds_tasks SET status='DONE',cooking_group_id=?,cooking_completed_at_ms=?,previous_state=?,changed_at_ms=?,
        post_cook_timer_minutes=?,post_cook_timer_started_at_ms=? WHERE task_id=? AND status='COOKING'`,
    [next.cookingGroupId, next.cookingCompletedAtMs, JSON.stringify(next.previousState), next.changedAtMs,
      timerMinutes, timerEligible ? next.cookingCompletedAtMs : null, taskId]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function finalizeExpiredKdsTaskCompletions() {
  const [rows] = await pool.query<Array<RowDataPacket & { taskId: number; previousState: string | null }>>(
    "SELECT task_id AS taskId,previous_state AS previousState FROM kds_tasks",
  );
  const now = Date.now();
  const tableRequests = new Map<string, { sessionId: number; requestId: string; requestedAtMs: number }>();
  for (const row of rows) {
    const request = pendingCompletion(parseKdsPreviousState(row.previousState));
    if (request?.scope === "TABLE" && request.requestId && request.sessionId) {
      tableRequests.set(`${request.sessionId}:${request.requestId}`, {
        sessionId: request.sessionId, requestId: request.requestId, requestedAtMs: request.requestedAtMs,
      });
      continue;
    }
    if (request && now >= request.requestedAtMs + 5000) {
      try { await finalizeKdsTaskCompletion(Number(row.taskId), request.requestedAtMs); }
      catch (error) { console.error("KDS 완료 카운트다운 확정 실패:", error); }
    }
  }
  for (const request of tableRequests.values()) {
    if (now < request.requestedAtMs + 5000) continue;
    try { await finalizeKdsTableCompletion(request.sessionId, request.requestId, request.requestedAtMs); }
    catch (error) { console.error("KDS 테이블 완료 카운트다운 확정 실패:", error); }
  }
}

type ExpectedTableTask = { taskId: number; status: KdsTaskStatus; changedAtMs: number | null };

export async function requestKdsTableCompletion(
  sessionId: number,
  expected: ExpectedTableTask[],
  defaultPostCookTimerMinutes: KdsPostCookTimerMinutes,
) {
  if (!isKdsPostCookTimerMinutes(defaultPostCookTimerMinutes)) throw new KdsActionError("기본 끓임 시간이 올바르지 않습니다.", 400);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [sessions] = await connection.query<Array<RowDataPacket & { sessionKind: string; status: string; tableId: number | null }>>(
      "SELECT session_kind AS sessionKind,status,table_id AS tableId FROM table_sessions WHERE session_id=? FOR UPDATE", [sessionId]);
    const session = sessions[0];
    if (!session || session.sessionKind !== "DINE_IN" || session.status !== "OPEN" || session.tableId === null) {
      throw new KdsActionError("진행 중인 매장 테이블 주문만 전체 완료할 수 있습니다.");
    }
    const expectedById = new Map(expected.map(item => [item.taskId, item]));
    if (expectedById.size !== expected.length || expected.some(item => item.status === "DONE")) {
      throw new KdsActionError("테이블 작업 목록이 올바르지 않습니다.", 400);
    }
    const [rows] = await connection.query<CompletionLockedTask[]>(`
      SELECT k.task_id AS taskId,k.member_items AS memberItems,k.status,k.cooking_group_id AS cookingGroupId,
        k.cooking_started_at_ms AS cookingStartedAtMs,k.cooking_completed_at_ms AS cookingCompletedAtMs,
        k.previous_state AS previousState,k.changed_at_ms AS changedAtMs
      FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id
      WHERE o.session_id=? AND k.status<>'DONE' ORDER BY k.task_id FOR UPDATE`, [sessionId]);
    const activeRows: Array<{ row: CompletionLockedTask; timerEligible: boolean }> = [];
    for (const row of rows) {
      const eligibility = await taskCookingEligibility(connection, row.memberItems);
      if (eligibility.hasActivePrimary) activeRows.push({ row, timerEligible: eligibility.timerEligible });
    }
    if (!activeRows.length || !activeRows.some(({ row }) => row.status === "COOKING")) {
      throw new KdsActionError("조리 중인 작업이 없어 테이블 전체 완료를 시작할 수 없습니다.");
    }
    if (activeRows.some(({ row }) => {
      const item = expectedById.get(Number(row.taskId));
      return !item || item.status !== row.status || item.changedAtMs !== number(row.changedAtMs);
    }) || expectedById.size !== activeRows.length) {
      throw new KdsActionError("테이블 주문 상태가 변경되었습니다. KDS 화면을 새로고침해 주세요.");
    }
    const requestedAtMs = Date.now();
    const requestId = randomUUID();
    for (const { row, timerEligible } of activeRows) {
      const previous = parseKdsPreviousState(row.previousState) ?? {
        status: row.status, cookingGroupId: number(row.cookingGroupId),
        cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
      };
      previous.completionRequest = {
        scope: "TABLE", requestId, sessionId, requestedAtMs,
        expectedStatus: row.status, expectedChangedAtMs: number(row.changedAtMs),
        postCookTimerMinutes: timerEligible ? defaultPostCookTimerMinutes : null,
      };
      await connection.execute("UPDATE kds_tasks SET previous_state=? WHERE task_id=? AND status=? AND changed_at_ms <=> ?",
        [JSON.stringify(previous), row.taskId, row.status, row.changedAtMs]);
    }
    await connection.commit();
    return { requestId, requestedAtMs, taskCount: activeRows.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function cancelKdsTableCompletion(sessionId: number, requestId: string, requestedAtMs: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [sessions] = await connection.query<Array<RowDataPacket & { status: string }>>(
      "SELECT status FROM table_sessions WHERE session_id=? FOR UPDATE", [sessionId]);
    if (!sessions[0]) throw new KdsActionError("테이블 주문을 찾을 수 없습니다.", 404);
    const [rows] = await connection.query<Array<RowDataPacket & { taskId: number; status: KdsTaskStatus; previousState: string | null }>>(`
      SELECT k.task_id AS taskId,k.status,k.previous_state AS previousState
      FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id
      WHERE o.session_id=? AND k.status<>'DONE' ORDER BY k.task_id FOR UPDATE`, [sessionId]);
    const matching = rows.filter(row => {
      const request = pendingCompletion(parseKdsPreviousState(row.previousState));
      return request?.scope === "TABLE" && request.requestId === requestId &&
        request.sessionId === sessionId && request.requestedAtMs === requestedAtMs;
    });
    if (!matching.length) throw new KdsActionError("테이블 완료 요청이 이미 처리되었거나 취소되었습니다.");
    if (Date.now() >= requestedAtMs + 5000) {
      await connection.commit();
      return { cancelled: false, expired: true };
    }
    for (const row of matching) {
      const previous = parseKdsPreviousState(row.previousState)!;
      delete previous.completionRequest;
      await connection.execute("UPDATE kds_tasks SET previous_state=? WHERE task_id=? AND status=?",
        [JSON.stringify(previous), row.taskId, row.status]);
    }
    await connection.commit();
    return { cancelled: true, expired: false, taskCount: matching.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function finalizeKdsTableCompletion(sessionId: number, requestId: string, requestedAtMs: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [sessions] = await connection.query<Array<RowDataPacket & { status: string }>>(
      "SELECT status FROM table_sessions WHERE session_id=? FOR UPDATE", [sessionId]);
    if (sessions[0]?.status !== "OPEN") { await connection.commit(); return 0; }
    const [rows] = await connection.query<CompletionLockedTask[]>(`
      SELECT k.task_id AS taskId,k.member_items AS memberItems,k.status,k.cooking_group_id AS cookingGroupId,
        k.cooking_started_at_ms AS cookingStartedAtMs,k.cooking_completed_at_ms AS cookingCompletedAtMs,
        k.previous_state AS previousState,k.changed_at_ms AS changedAtMs
      FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id
      WHERE o.session_id=? AND k.status<>'DONE' ORDER BY k.task_id FOR UPDATE`, [sessionId]);
    const matching = rows.flatMap(row => {
      const previous = parseKdsPreviousState(row.previousState);
      const request = pendingCompletion(previous);
      return request?.scope === "TABLE" && request.requestId === requestId && request.sessionId === sessionId &&
        request.requestedAtMs === requestedAtMs ? [{ row, previous, request }] : [];
    });
    if (!matching.length || Date.now() < requestedAtMs + 5000) { await connection.commit(); return 0; }
    let completed = 0;
    const completedAtMs = Date.now();
    for (const { row, previous, request } of matching) {
      const unchanged = row.status === request.expectedStatus && number(row.changedAtMs) === request.expectedChangedAtMs;
      const eligibility = unchanged ? await taskCookingEligibility(connection, row.memberItems) : { hasActivePrimary: false, timerEligible: false };
      if (!unchanged || !eligibility.hasActivePrimary) {
        if (previous) delete previous.completionRequest;
        await connection.execute("UPDATE kds_tasks SET previous_state=? WHERE task_id=? AND status=?",
          [JSON.stringify(previous), row.taskId, row.status]);
        continue;
      }
      const timerMinutes = eligibility.timerEligible && isKdsPostCookTimerMinutes(request.postCookTimerMinutes)
        ? request.postCookTimerMinutes : null;
      const originalState: KdsStateSnapshot = {
        status: row.status, cookingGroupId: number(row.cookingGroupId),
        cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
      };
      const [result] = await connection.execute<ResultSetHeader>(`
        UPDATE kds_tasks SET status='DONE',cooking_completed_at_ms=?,previous_state=?,changed_at_ms=?,
          post_cook_timer_minutes=?,post_cook_timer_started_at_ms=?
        WHERE task_id=? AND status=? AND changed_at_ms <=> ?`,
      [completedAtMs, JSON.stringify(originalState), completedAtMs, timerMinutes,
        timerMinutes !== null ? completedAtMs : null, row.taskId, row.status, row.changedAtMs]);
      if (result.affectedRows === 1) completed += 1;
    }
    await connection.commit();
    return completed;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function cleanupUnusedKdsCookingGroups() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const expiredBefore = Date.now() - KDS_WINDOW_MS;
    const [expiredDone] = await connection.query<Array<RowDataPacket & { taskId: number }>>(
      "SELECT task_id AS taskId FROM kds_tasks WHERE status='DONE' AND cooking_group_id IS NOT NULL AND changed_at_ms<=? FOR UPDATE",
      [expiredBefore],
    );
    for (const row of expiredDone) {
      await connection.execute("UPDATE kds_tasks SET cooking_group_id=NULL,previous_state=NULL WHERE task_id=? AND status='DONE'", [row.taskId]);
    }
    const [recentWaiting] = await connection.query<Array<RowDataPacket & { previousState: string | null }>>(
      "SELECT previous_state AS previousState FROM kds_tasks WHERE status='WAITING' AND changed_at_ms>? FOR UPDATE", [expiredBefore],
    );
    const protectedGroupIds = new Set<number>();
    for (const row of recentWaiting) {
      const previous = parseKdsPreviousState(row.previousState);
      if (previous?.cookingGroupId !== null && previous?.cookingGroupId !== undefined) protectedGroupIds.add(previous.cookingGroupId);
    }
    const [groups] = await connection.query<GroupRow[]>(`
      SELECT g.group_id AS groupId,g.started_at_ms AS startedAtMs FROM kds_cooking_groups g
      WHERE NOT EXISTS (SELECT 1 FROM kds_tasks k WHERE k.cooking_group_id=g.group_id) FOR UPDATE`);
    for (const group of groups) {
      if (protectedGroupIds.has(Number(group.groupId))) continue;
      await connection.execute("DELETE FROM kds_cooking_groups WHERE group_id=? AND NOT EXISTS (SELECT 1 FROM kds_tasks WHERE cooking_group_id=?)",
        [group.groupId, group.groupId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

type LockedTableTask = RowDataPacket & {
  taskId: number; orderId: number; memberItems: string; compatibilityKey: string;
  status: KdsTaskStatus; cookingGroupId: number | null; cookingStartedAtMs: number | null;
  cookingCompletedAtMs: number | null; previousState: string | null; changedAtMs: number | null;
};

async function getActivePrimaryTaskIds(connection: PoolConnection, rows: LockedTableTask[]) {
  const itemIds = [...new Set(rows.flatMap(row =>
    (JSON.parse(row.memberItems) as KdsMember[]).filter(member => member.kind !== "COMPONENT").map(member => member.itemId),
  ))];
  if (!itemIds.length) return new Set<number>();
  const [items] = await connection.query<Array<RowDataPacket & {
    itemId: number; itemStatus: string; remaining: number; orderStatus: string; sessionStatus: string;
    kdsKind: KdsMenuKind; kdsVisible: number;
  }>>(`
    SELECT oi.order_item_id AS itemId,oi.status AS itemStatus,
      COALESCE(oi.actual_component_qty,oi.qty)-COALESCE(c.cancelled_qty,0) AS remaining,
      o.status AS orderStatus,s.status AS sessionStatus,m.kds_kind AS kdsKind,m.kds_visible AS kdsVisible
    FROM order_items oi INNER JOIN menus m ON m.menu_id=oi.menu_id
    INNER JOIN orders o ON o.order_id=oi.order_id INNER JOIN table_sessions s ON s.session_id=o.session_id
    LEFT JOIN (SELECT order_item_id,SUM(cancelled_qty) AS cancelled_qty
      FROM order_item_cancellations WHERE order_item_id IN (?) GROUP BY order_item_id) c ON c.order_item_id=oi.order_item_id
    WHERE oi.order_item_id IN (?) FOR UPDATE`, [itemIds, itemIds],
  );
  return new Set(items.filter(item => item.itemStatus !== "CANCELLED" && item.orderStatus !== "CANCELLED" &&
    item.sessionStatus === "OPEN" && item.kdsKind !== "NONE" && Boolean(item.kdsVisible) && Number(item.remaining) > 0)
    .map(item => Number(item.itemId)));
}

async function lockOpenDiningSession(connection: PoolConnection, sessionId: number) {
  const [sessions] = await connection.query<(RowDataPacket & { sessionKind: string; status: string; tableId: number | null })[]>(
    "SELECT session_kind AS sessionKind,status,table_id AS tableId FROM table_sessions WHERE session_id=? FOR UPDATE", [sessionId],
  );
  const session = sessions[0];
  if (!session || session.sessionKind !== "DINE_IN" || session.status !== "OPEN" || session.tableId === null) {
    throw new KdsActionError("현재 진행 중인 매장 테이블 주문이 아닙니다.");
  }
}

export async function startKdsTable(sessionId: number) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockOpenDiningSession(connection, sessionId);
    const [rows] = await connection.query<LockedTableTask[]>(`
      SELECT k.task_id AS taskId,k.order_id AS orderId,k.member_items AS memberItems,
        k.compatibility_key AS compatibilityKey,k.status,k.cooking_group_id AS cookingGroupId,
        k.cooking_started_at_ms AS cookingStartedAtMs,k.cooking_completed_at_ms AS cookingCompletedAtMs,
        k.previous_state AS previousState,k.changed_at_ms AS changedAtMs
      FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id
      WHERE o.session_id=? AND k.status='WAITING' ORDER BY k.task_id FOR UPDATE`, [sessionId],
    );
    const activeItemIds = await getActivePrimaryTaskIds(connection, rows);
    const waitingRows = rows.filter(row => (JSON.parse(row.memberItems) as KdsMember[])
      .some(member => member.kind !== "COMPONENT" && activeItemIds.has(member.itemId)));
    if (!waitingRows.length) {
      await connection.commit();
      return { batchStartId: null, taskCount: 0 };
    }
    const startedAtMs = Math.max(Date.now(), ...waitingRows.map(row => (number(row.changedAtMs) ?? 0) + 1));
    const batchStartId = randomUUID();
    for (const row of waitingRows) {
      const state: KdsState = {
        status: row.status, cookingGroupId: number(row.cookingGroupId),
        cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
        previousState: row.previousState ? JSON.parse(row.previousState) as KdsStateSnapshot : null,
        changedAtMs: number(row.changedAtMs),
      };
      const previousState = { ...stateSnapshotForKds(state), bulkStartId: batchStartId, startSource: "TABLE" as const };
      await connection.execute(`
        UPDATE kds_tasks SET status='COOKING',cooking_group_id=?,cooking_started_at_ms=?,
          cooking_completed_at_ms=NULL,previous_state=?,changed_at_ms=?,
          post_cook_timer_minutes=NULL,post_cook_timer_started_at_ms=NULL WHERE task_id=?`,
      [null, startedAtMs, JSON.stringify(previousState), startedAtMs, row.taskId]);
    }
    await connection.commit();
    return { batchStartId, taskCount: waitingRows.length, startedAtMs };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function undoKdsTableStart(sessionId: number, batchStartId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockOpenDiningSession(connection, sessionId);
    const [rows] = await connection.query<LockedTableTask[]>(`
      SELECT k.task_id AS taskId,k.order_id AS orderId,k.member_items AS memberItems,
        k.compatibility_key AS compatibilityKey,k.status,k.cooking_group_id AS cookingGroupId,
        k.cooking_started_at_ms AS cookingStartedAtMs,k.cooking_completed_at_ms AS cookingCompletedAtMs,
        k.previous_state AS previousState,k.changed_at_ms AS changedAtMs
      FROM kds_tasks k INNER JOIN orders o ON o.order_id=k.order_id
      WHERE o.session_id=? AND k.status='COOKING' ORDER BY k.task_id FOR UPDATE`, [sessionId],
    );
    const activeItemIds = await getActivePrimaryTaskIds(connection, rows);
    const now = Date.now();
    let taskCount = 0;
    for (const row of rows) {
      const previous = row.previousState
        ? JSON.parse(row.previousState) as KdsStateSnapshot & { bulkStartId?: string }
        : null;
      const changedAtMs = number(row.changedAtMs);
      if (previous?.bulkStartId !== batchStartId || previous.status !== "WAITING" || changedAtMs === null ||
        now < changedAtMs || now - changedAtMs > KDS_WINDOW_MS ||
        !(JSON.parse(row.memberItems) as KdsMember[]).some(member => member.kind !== "COMPONENT" && activeItemIds.has(member.itemId))) continue;
      const state: KdsState = {
        status: row.status, cookingGroupId: number(row.cookingGroupId),
        cookingStartedAtMs: number(row.cookingStartedAtMs), cookingCompletedAtMs: number(row.cookingCompletedAtMs),
        previousState: previous, changedAtMs,
      };
      const next = transitionKdsState(state, "MENU", now);
      if (!next) continue;
      await connection.execute(`
        UPDATE kds_tasks SET status=?,cooking_group_id=?,cooking_started_at_ms=?,
          cooking_completed_at_ms=?,previous_state=?,changed_at_ms=?,
          post_cook_timer_minutes=NULL,post_cook_timer_started_at_ms=NULL WHERE task_id=?`,
      [next.status, next.cookingGroupId, next.cookingStartedAtMs,
        next.cookingCompletedAtMs, JSON.stringify(next.previousState), next.changedAtMs, row.taskId]);
      taskCount += 1;
    }
    await connection.commit();
    return { taskCount };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
