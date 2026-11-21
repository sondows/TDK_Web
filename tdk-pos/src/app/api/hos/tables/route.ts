import { getCurrentHosStaff } from "@/lib/hos-auth";
import { loadHosTables } from "@/lib/hos-table-data";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentHosStaff()) {
    return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await loadHosTables();
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const rootCause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const databaseError = rootCause as Error & { code?: string; errno?: number; sqlState?: string; sqlMessage?: string };
    console.error("HOS table list unavailable", {
      name: error instanceof Error ? error.name : undefined,
      code: databaseError.code,
      errno: databaseError.errno,
      sqlState: databaseError.sqlState,
      message: databaseError.sqlMessage ?? databaseError.message,
    });
    return Response.json({ success: false, message: "테이블 정보를 불러오지 못했습니다." }, { status: 503,
      headers: { "Cache-Control": "no-store" } });
  }
}
