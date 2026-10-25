import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/db";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { spicyChoiceKey } from "@/lib/pos-pot-spiciness";

type SessionRow = RowDataPacket & { status: string; tableNo: string | null };
type ItemRow = RowDataPacket & { itemId: number; orderId: number; menuId: number; status: string };
type ChoiceRow = RowDataPacket & { menuId: number; groupId: number; groupName: string; optionId: number; optionName: string; priceDelta: string };
type SavedOptionRow = RowDataPacket & { id: number; itemId: number; optionId: number | null; optionName: string; unitPrice: string; groupId: number | null };
type TaskRow = RowDataPacket & { memberItems: string; status: string };

class SpicinessError extends Error {
  constructor(message: string, readonly status: number = 409) { super(message); }
}

const isSpicyGroup = (rows: ChoiceRow[]) => rows.some(row => row.groupName === "매운맛" ||
  /^\s*\d+\s*[.번)].*(?:매운맛|순한맛|안매움)/.test(row.optionName));

function completedSpicyTarget(items: ItemRow[], choices: ChoiceRow[], tasks: TaskRow[]) {
  const completedItemIds = new Set<number>();
  for (const task of tasks) {
    if (task.status !== "DONE") continue;
    try {
      for (const member of JSON.parse(task.memberItems) as Array<{ itemId: number }>) completedItemIds.add(Number(member.itemId));
    } catch { throw new SpicinessError("조리 상태를 확인할 수 없어 매운맛을 변경하지 않았습니다."); }
  }
  return items.find(item => {
    const menuChoices = choices.filter(choice => choice.menuId === item.menuId);
    if (!isSpicyGroup(menuChoices)) return false;
    return completedItemIds.has(Number(item.itemId)) || item.status === "READY" || item.status === "SERVED";
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff && await getPosLoginMode() !== "SHARED")
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sessionId = Number((await params).sessionId);
  const sourceOrderItemId = Number(new URL(request.url).searchParams.get("sourceOrderItemId"));
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(sourceOrderItemId) || sourceOrderItemId <= 0)
    return Response.json({ success: false, message: "테이블과 매운맛 선택값을 확인해 주세요." }, { status: 400 });
  const connection = await pool.getConnection();
  try {
    const [sessions] = await connection.query<SessionRow[]>(`SELECT s.status,dt.table_no AS tableNo FROM table_sessions s
      LEFT JOIN dining_tables dt ON dt.table_id=s.table_id WHERE s.session_id=?`, [sessionId]);
    if (sessions[0]?.status !== "OPEN") throw new SpicinessError("이용 중인 테이블만 변경할 수 있습니다.");
    const [items] = await connection.query<ItemRow[]>(`SELECT oi.order_item_id AS itemId,oi.order_id AS orderId,
      oi.menu_id AS menuId,oi.status FROM order_items oi INNER JOIN orders o ON o.order_id=oi.order_id
      INNER JOIN menus m ON m.menu_id=oi.menu_id WHERE o.session_id=? AND o.status IN ('OPEN','ACCEPTED')
      AND oi.status<>'CANCELLED' AND oi.item_type='NORMAL' AND m.kds_kind='POT'`, [sessionId]);
    if (!items.some(item => Number(item.itemId) === sourceOrderItemId))
      throw new SpicinessError("현재 테이블의 김치찌개 주문을 찾지 못했습니다.");
    const menuIds = [...new Set(items.map(item => Number(item.menuId)))];
    const [choices] = await connection.query<ChoiceRow[]>(`SELECT mmg.menu_id AS menuId,mg.modifier_group_id AS groupId,
      mg.pos_name AS groupName,mo.modifier_option_id AS optionId,mo.pos_name AS optionName,
      mo.price_delta AS priceDelta FROM menu_modifier_groups mmg
      INNER JOIN modifier_groups mg ON mg.modifier_group_id=mmg.modifier_group_id AND mg.is_active=1
      INNER JOIN modifier_options mo ON mo.modifier_group_id=mg.modifier_group_id AND mo.is_active=1
      WHERE mmg.menu_id IN (?) ORDER BY mmg.sort_order,mo.sort_order,mo.modifier_option_id`, [menuIds]);
    const [tasks] = await connection.query<TaskRow[]>(`SELECT k.member_items AS memberItems,k.status FROM kds_tasks k
      INNER JOIN orders o ON o.order_id=k.order_id WHERE o.session_id=?`, [sessionId]);
    if (completedSpicyTarget(items, choices, tasks))
      throw new SpicinessError("조리완료된 메뉴에서는 매운맛을 변경할 수 없습니다.");
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SpicinessError) return Response.json({ success: false, message: error.message }, { status: error.status });
    console.error("POS table spiciness check failed", { sessionId, sourceOrderItemId, error });
    return Response.json({ success: false, message: "매운맛 변경 가능 여부를 확인하지 못했습니다." }, { status: 500 });
  } finally { connection.release(); }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff && await getPosLoginMode() !== "SHARED")
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sessionId = Number((await params).sessionId);
  const body = await request.json().catch(() => null) as { sourceOrderItemId?: unknown; modifierOptionId?: unknown } | null;
  const sourceOrderItemId = body?.sourceOrderItemId;
  const modifierOptionId = body?.modifierOptionId;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(sourceOrderItemId) ||
    Number(sourceOrderItemId) <= 0 || !Number.isSafeInteger(modifierOptionId) || Number(modifierOptionId) <= 0) {
    return Response.json({ success: false, message: "테이블과 매운맛 선택값을 확인해 주세요." }, { status: 400 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [sessions] = await connection.query<SessionRow[]>(`SELECT s.status,dt.table_no AS tableNo FROM table_sessions s
      LEFT JOIN dining_tables dt ON dt.table_id=s.table_id WHERE s.session_id=? FOR UPDATE`, [sessionId]);
    if (sessions[0]?.status !== "OPEN") throw new SpicinessError("이용 중인 테이블만 변경할 수 있습니다.");
    const [items] = await connection.query<ItemRow[]>(`SELECT oi.order_item_id AS itemId,oi.order_id AS orderId,
      oi.menu_id AS menuId,oi.status FROM order_items oi INNER JOIN orders o ON o.order_id=oi.order_id
      INNER JOIN menus m ON m.menu_id=oi.menu_id WHERE o.session_id=? AND o.status IN ('OPEN','ACCEPTED')
      AND oi.status<>'CANCELLED' AND oi.item_type='NORMAL' AND m.kds_kind='POT'
      ORDER BY oi.order_item_id FOR UPDATE`, [sessionId]);
    const source = items.find(item => Number(item.itemId) === sourceOrderItemId);
    if (!source) throw new SpicinessError("현재 테이블의 김치찌개 주문을 찾지 못했습니다.");
    const menuIds = [...new Set(items.map(item => Number(item.menuId)))];
    const [choices] = await connection.query<ChoiceRow[]>(`SELECT mmg.menu_id AS menuId,mg.modifier_group_id AS groupId,
      mg.pos_name AS groupName,mo.modifier_option_id AS optionId,mo.pos_name AS optionName,
      mo.price_delta AS priceDelta FROM menu_modifier_groups mmg
      INNER JOIN modifier_groups mg ON mg.modifier_group_id=mmg.modifier_group_id AND mg.is_active=1
      INNER JOIN modifier_options mo ON mo.modifier_group_id=mg.modifier_group_id AND mo.is_active=1
      WHERE mmg.menu_id IN (?) ORDER BY mmg.sort_order,mo.sort_order,mo.modifier_option_id`, [menuIds]);
    const selected = choices.find(choice => Number(choice.menuId) === source.menuId && Number(choice.optionId) === modifierOptionId);
    const selectedGroup = choices.filter(choice => choice.menuId === source.menuId && choice.groupId === selected?.groupId);
    if (!selected || !isSpicyGroup(selectedGroup)) throw new SpicinessError("등록된 매운맛 선택지를 선택해 주세요.", 400);
    const stage = spicyChoiceKey(selected.optionName);
    const [tasks] = await connection.query<TaskRow[]>(`SELECT k.member_items AS memberItems,k.status FROM kds_tasks k
      INNER JOIN orders o ON o.order_id=k.order_id WHERE o.session_id=? FOR UPDATE`, [sessionId]);
    if (completedSpicyTarget(items, choices, tasks))
      throw new SpicinessError("조리완료된 메뉴에서는 매운맛을 변경할 수 없습니다.");
    const [savedOptions] = await connection.query<SavedOptionRow[]>(`SELECT io.order_item_option_id AS id,io.order_item_id AS itemId,
      io.modifier_option_id AS optionId,io.option_name AS optionName,io.unit_price AS unitPrice,
      mo.modifier_group_id AS groupId FROM order_item_options io
      LEFT JOIN modifier_options mo ON mo.modifier_option_id=io.modifier_option_id
      WHERE io.order_item_id IN (?) FOR UPDATE`, [items.map(item => item.itemId)]);
    const updates: Array<{ id: number; itemId: number; optionId: number; optionName: string }> = [];
    let before = "";
    for (const item of items) {
      const menuChoices = choices.filter(choice => choice.menuId === item.menuId);
      const groups = [...new Set(menuChoices.map(choice => choice.groupId))];
      const spicyGroupId = groups.find(groupId => isSpicyGroup(menuChoices.filter(choice => choice.groupId === groupId)));
      if (spicyGroupId === undefined) continue;
      const existing = savedOptions.find(option => option.itemId === item.itemId && option.groupId === spicyGroupId);
      if (!existing) throw new SpicinessError("매운맛 기록이 없는 주문이 있어 전체 변경을 중단했습니다.");
      if (item.itemId === source.itemId) before = existing.optionName;
      const replacement = menuChoices.find(choice => choice.groupId === spicyGroupId && spicyChoiceKey(choice.optionName) === stage);
      if (!replacement) throw new SpicinessError("일부 메뉴에 같은 매운맛 선택지가 없어 변경하지 않았습니다.");
      if (Number(replacement.priceDelta) !== Number(existing.unitPrice)) {
        throw new SpicinessError("가격이 다른 매운맛 옵션은 이 화면에서 일괄 변경할 수 없습니다.");
      }
      if (existing.optionId !== replacement.optionId || existing.optionName !== replacement.optionName)
        updates.push({ id: existing.id, itemId: item.itemId, optionId: replacement.optionId, optionName: replacement.optionName });
    }
    if (!before) throw new SpicinessError("기존 매운맛 기록을 확인할 수 없습니다.");
    for (const update of updates) {
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE order_item_options SET modifier_option_id=?,option_name=?
        WHERE order_item_option_id=?`, [update.optionId, update.optionName, update.id]);
      if (result.affectedRows !== 1) throw new SpicinessError("옵션 변경 중 주문 정보가 바뀌었습니다.");
    }
    if (updates.length) await connection.execute(`INSERT INTO audit_logs
      (staff_id,action_type,entity_type,entity_id,description) VALUES (?,?,?,?,?)`, [staff?.staffId ?? null,
      "KDS_SPICY_CHANGE", "TABLE_SESSION", sessionId,
      `${sessions[0].tableNo ?? sessionId}번 테이블 매운맛 변경: ${before} → ${selected.optionName}`]);
    await connection.commit();
    return Response.json({ success: true, changes: updates.map(({ itemId, optionId, optionName }) =>
      ({ itemId, optionId, optionName })), changedCount: updates.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await connection.rollback();
    if (error instanceof SpicinessError) return Response.json({ success: false, message: error.message }, { status: error.status });
    console.error("POS table spiciness change failed", { sessionId, sourceOrderItemId, error });
    return Response.json({ success: false, message: "매운맛 변경을 저장하지 못했습니다." }, { status: 500 });
  } finally { connection.release(); }
}
