import { eq } from "drizzle-orm";
import { db } from "@/db";
import { menus, qrMenuDescriptions } from "@/db/schema";
import { QR_MENU_DESCRIPTION_LOCALE, parseQrMenuDescriptionInput } from "@/lib/qr-menu-description-model";
import { requireQrMenuDescriptionManager } from "@/lib/qr-menu-description-admin-auth";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const auth = await requireQrMenuDescriptionManager();
  if ("error" in auth) return auth.error;

  try {
    const { menuId: rawMenuId } = await params;
    if (!/^[1-9]\d{0,14}$/.test(rawMenuId)) return Response.json({ success: false, message: "메뉴 정보가 올바르지 않습니다." }, { status: 400 });
    const menuId = Number(rawMenuId);
    if (!Number.isSafeInteger(menuId)) return Response.json({ success: false, message: "메뉴 정보가 올바르지 않습니다." }, { status: 400 });
    const input = parseQrMenuDescriptionInput(await request.json());
    if (!input) return Response.json({ success: false, message: "설명 또는 원산지 입력값을 확인해 주세요." }, { status: 400 });

    const result = await db.transaction(async tx => {
      const [menu] = await tx.select({ menuId: menus.menuId }).from(menus).where(eq(menus.menuId, menuId)).limit(1).for("update");
      if (!menu) return null;
      const updatedAt = new Date();
      await tx.insert(qrMenuDescriptions).values({
        menuId, localeCode: QR_MENU_DESCRIPTION_LOCALE, shortDescription: input.shortDescription,
        detailDescription: input.detailDescription, originDescription: input.originDescription,
        updatedByStaffId: auth.staff.staffId, updatedAt,
      }).onDuplicateKeyUpdate({ set: {
        shortDescription: input.shortDescription, detailDescription: input.detailDescription,
        originDescription: input.originDescription,
        updatedByStaffId: auth.staff.staffId, updatedAt,
      } });
      return { menuId, shortDescription: input.shortDescription, detailDescription: input.detailDescription,
        originDescription: input.originDescription };
    });

    if (!result) return Response.json({ success: false, message: "해당 메뉴를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: true, record: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_BAD_FIELD_ERROR") {
      return Response.json({ success: false, message: "원산지 서술형 저장을 위해 개발 DB 마이그레이션을 먼저 적용해 주세요." }, { status: 503 });
    }
    return Response.json({ success: false, message: "메뉴 설명을 저장하지 못했습니다." }, { status: 500 });
  }
}
