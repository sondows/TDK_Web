import { asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { menuCategories, menus } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import MenuCategoryManagementClient from "../MenuCategoryManagementClient";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminMenuCategoriesPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");
  const categories = await db.select({
    categoryId: menuCategories.categoryId,
    name: menuCategories.posName,
    sortOrder: menuCategories.sortOrder,
    isActive: menuCategories.isActive,
    tabColor: menuCategories.tabColor,
    menuCount: sql<number>`count(${menus.menuId})`,
  }).from(menuCategories).leftJoin(menus, eq(menus.categoryId, menuCategories.categoryId))
    .groupBy(menuCategories.categoryId, menuCategories.posName, menuCategories.sortOrder, menuCategories.isActive, menuCategories.tabColor)
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.categoryId));

  return <AdminWorkspaceShell canManageMenu={canManageMenu(staff.role)} userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>메뉴 분류 관리</h1><p className={styles.pageDescription}>POS, HOS, QR 메뉴에 함께 표시되는 분류명과 순서를 관리합니다.</p></div>
      <MenuCategoryManagementClient initialCategories={categories} />
    </div>
  </AdminWorkspaceShell>;
}
