import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { menuCategories, menus, qrMenuDescriptions, qrMenuOriginItems, qrMenuOriginTranslations } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import MenuDescriptionManagementClient, { type MenuDescriptionAdminRecord, type MenuDescriptionAdminMenu } from "./MenuDescriptionManagementClient";

export const dynamic = "force-dynamic";

async function loadKoreanDescriptionRows() {
  try {
    return await db.select({ menuId: qrMenuDescriptions.menuId, shortDescription: qrMenuDescriptions.shortDescription,
      detailDescription: qrMenuDescriptions.detailDescription, originDescription: qrMenuDescriptions.originDescription })
      .from(qrMenuDescriptions).where(eq(qrMenuDescriptions.localeCode, "ko"));
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_BAD_FIELD_ERROR") throw error;
    const rows = await db.select({ menuId: qrMenuDescriptions.menuId, shortDescription: qrMenuDescriptions.shortDescription,
      detailDescription: qrMenuDescriptions.detailDescription })
      .from(qrMenuDescriptions).where(eq(qrMenuDescriptions.localeCode, "ko"));
    return rows.map(row => ({ ...row, originDescription: null }));
  }
}

export default async function MenuDescriptionsPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");

  let menusForAdmin: MenuDescriptionAdminMenu[] = [];
  let records: MenuDescriptionAdminRecord[] = [];
  let loadError = "";
  try {
    const [menuRows, descriptionRows, originRows] = await Promise.all([
      db.select({ menuId: menus.menuId, name: menus.posName, categoryId: menuCategories.categoryId,
        categoryName: menuCategories.posName, categorySortOrder: menuCategories.sortOrder, sortOrder: menus.sortOrder })
        .from(menus).leftJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.categoryId), asc(menus.sortOrder), asc(menus.menuId)),
      loadKoreanDescriptionRows(),
      db.select({ originId: qrMenuOriginItems.originId, menuId: qrMenuOriginItems.menuId,
        sortOrder: qrMenuOriginItems.sortOrder, ingredientName: qrMenuOriginTranslations.ingredientName,
        originText: qrMenuOriginTranslations.originText })
        .from(qrMenuOriginItems).innerJoin(qrMenuOriginTranslations, and(
          eq(qrMenuOriginTranslations.originId, qrMenuOriginItems.originId),
          eq(qrMenuOriginTranslations.localeCode, "ko"),
        )).orderBy(asc(qrMenuOriginItems.menuId), asc(qrMenuOriginItems.sortOrder), asc(qrMenuOriginItems.originId)),
    ]);
    menusForAdmin = menuRows.map(row => ({ menuId: row.menuId, name: row.name,
      categoryId: row.categoryId, categoryName: row.categoryName ?? "카테고리 미지정" }));
    records = menuRows.map(menu => ({
      menuId: menu.menuId,
      shortDescription: descriptionRows.find(row => row.menuId === menu.menuId)?.shortDescription ?? "",
      detailDescription: descriptionRows.find(row => row.menuId === menu.menuId)?.detailDescription ?? "",
      originDescription: descriptionRows.find(row => row.menuId === menu.menuId)?.originDescription
        ?? originRows.filter(row => row.menuId === menu.menuId)
          .map(row => `${row.ingredientName}: ${row.originText}`).join("\n"),
    }));
  } catch {
    loadError = "메뉴 설명을 불러오지 못했습니다. 개발 DB 마이그레이션 적용 여부를 확인해 주세요.";
  }

  return <AdminWorkspaceShell canManageMenu userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>메뉴설명</h1><p className={styles.pageDescription}>고객 QR에서 사용할 메뉴별 설명과 원산지 정보를 관리합니다.</p></div>
      <MenuDescriptionManagementClient initialMenus={menusForAdmin} initialRecords={records} initialError={loadError} />
    </div>
  </AdminWorkspaceShell>;
}
