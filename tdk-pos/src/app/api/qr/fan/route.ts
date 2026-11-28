import { pool } from "@/db";
import type { RowDataPacket } from "mysql2";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { getAssignedTableFan } from "@/lib/qr-table-fan-assignments";
import { commandPosFan, getPosFanStates } from "@/lib/pos-fan-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403, headers });
  try {
    const member = await resolveQrOrderRequest(request);
    if (!member) return Response.json({ success: false }, { status: 401, headers });
    const fan = await getAssignedTableFan(member.tableId);
    if (!fan) return Response.json({ success: true, available: false }, { headers });
    const state = await getPosFanStates([fan]);
    return Response.json({ success: true, available: true, name: fan.name,
      state: state.fans[0]?.state ?? "unknown" }, { headers });
  } catch {
    return Response.json({ success: false, message: "선풍기 연결을 확인해 주세요." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ success: false }, { status: 400, headers }); }
  const desiredState = body && typeof body === "object" && !Array.isArray(body) ? (body as { state?: unknown }).state : null;
  if (desiredState !== "on" && desiredState !== "off") return Response.json({ success: false }, { status: 400, headers });
  try {
    const member = await resolveQrOrderRequest(request);
    if (!member) return Response.json({ success: false }, { status: 401, headers });
    const fan = await getAssignedTableFan(member.tableId);
    if (!fan) return Response.json({ success: false, message: "연결된 선풍기가 없습니다." }, { status: 404, headers });
    // Serialize commands from concurrent customers, including separate server workers.
    const connection = await pool.getConnection();
    let acquired = false;
    let result: Awaited<ReturnType<typeof commandPosFan>>;
    try {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 5) AS acquired", [`tdkon.qr.fan.${fan.fanId}`]);
      acquired = Number(rows[0]?.acquired) === 1;
      if (!acquired) return Response.json({ success: false, message: "선풍기가 사용 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 409, headers });
      result = await commandPosFan(fan, desiredState);
    } finally {
      try {
        if (acquired) await connection.query("SELECT RELEASE_LOCK(?)", [`tdkon.qr.fan.${fan.fanId}`]);
      } finally { connection.release(); }
    }
    if (!result.success) return Response.json({ success: false, message: "선풍기 연결을 확인해 주세요.", state: result.state }, { status: 503, headers });
    return Response.json({ success: true, state: result.state }, { headers });
  } catch {
    return Response.json({ success: false, message: "선풍기 연결을 확인해 주세요." }, { status: 503, headers });
  }
}
