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
    console.error("HOS table list unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "HOS table data unavailable." }, { status: 503,
      headers: { "Cache-Control": "no-store" } });
  }
}
