import { db } from "@/db";
import { diningTables } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getPosFanStates, loadPosFanLayouts } from "@/lib/pos-fan-server";
import { loadTableFanAssignments, setTableFanAssignment } from "@/lib/qr-table-fan-assignments";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function owner() {
  const staff = await getCurrentAdminStaff();
  return staff?.role === "OWNER" ? staff : null;
}

export async function GET() {
  if (!await owner()) return Response.json({ success: false }, { status: 403, headers });
  try {
    const [layouts, tables, assignments] = await Promise.all([
      loadPosFanLayouts(),
      db.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo, isActive: diningTables.isActive })
        .from(diningTables).orderBy(diningTables.sortOrder),
      loadTableFanAssignments(),
    ]);
    const state = await getPosFanStates(layouts);
    return Response.json({ success: true, configured: state.configured, fans: layouts.map(layout => ({
      fanId: layout.fanId, name: layout.name, entityId: layout.entityId, isVisible: layout.isVisible,
      state: state.fans.find(fan => fan.fanId === layout.fanId)?.state ?? "unknown",
    })), tables, assignments }, { headers });
  } catch {
    return Response.json({ success: false, message: "선풍기 설정을 불러오지 못했습니다." }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403, headers });
  const staff = await owner();
  if (!staff) return Response.json({ success: false }, { status: 403, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ success: false }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ success: false }, { status: 400, headers });
  const { tableId, fanId } = body as { tableId?: unknown; fanId?: unknown };
  if (!Number.isSafeInteger(tableId) || Number(tableId) < 1 ||
      !(fanId === null || (Number.isInteger(fanId) && Number(fanId) >= 1 && Number(fanId) <= 6))) {
    return Response.json({ success: false, message: "테이블 또는 선풍기 번호가 올바르지 않습니다." }, { status: 400, headers });
  }
  try {
    const result = await setTableFanAssignment(Number(tableId), fanId as number | null, staff.staffId);
    if (result !== "OK") return Response.json({ success: false, code: result,
      message: "테이블 또는 선풍기 연결을 확인해 주세요." }, { status: 409, headers });
    return Response.json({ success: true }, { headers });
  } catch {
    return Response.json({ success: false, message: "선풍기 연결을 저장하지 못했습니다." }, { status: 503, headers });
  }
}
