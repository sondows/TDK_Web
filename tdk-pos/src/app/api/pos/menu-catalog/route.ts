import { createHash } from "node:crypto";
import { getCurrentStaff } from "@/lib/auth";
import { loadPosMenuCatalog } from "@/lib/pos-menu-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await getCurrentStaff())
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const catalog = await loadPosMenuCatalog();
    // Categories and components have no updated_at; hashing their visible data
    // catches edits, deletions, image changes, and menu reordering alike.
    const version = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
    const currentVersion = new URL(request.url).searchParams.get("version");
    const body = currentVersion === version
      ? { success: true, changed: false, version }
      : { success: true, changed: true, version, ...catalog };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POS menu catalog refresh failed", error);
    return Response.json({ success: false, message: "메뉴 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}
