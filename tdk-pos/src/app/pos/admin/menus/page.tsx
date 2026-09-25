import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { menuCategories, menuImages, menus } from "@/db/schema";
import { canManageMenu, getPrivilegedStaff } from "@/lib/permissions";
import MenuManagementClient from "./MenuManagementClient";
import ManagementPageHeader from "../ManagementPageHeader";

export default async function MenuManagementPage() {
  const staff = await getPrivilegedStaff();
  if (!staff) redirect("/pos/admin");
  if (!canManageMenu(staff.role)) redirect("/pos");

  const [categories, menuRows] = await Promise.all([
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, sortOrder: menuCategories.sortOrder })
      .from(menuCategories)
      .where(eq(menuCategories.isActive, 1))
      .orderBy(menuCategories.sortOrder, menuCategories.categoryId),
    db.select({
      menuId: menus.menuId,
      menuCode: menus.menuCode,
      name: menus.posName,
      price: menus.price,
      categoryId: menus.categoryId,
      categoryName: menuCategories.posName,
      categorySortOrder: menuCategories.sortOrder,
      countsAsPerson: menus.countsAsPerson,
      isActive: menus.isActive,
      sortOrder: menus.sortOrder,
      imageUrl: menuImages.imageUrl,
    })
      .from(menus)
      .innerJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId))
      .leftJoin(menuImages, and(eq(menuImages.menuId, menus.menuId), eq(menuImages.imageType, "POS"), eq(menuImages.isActive, 1)))
      .orderBy(menuCategories.sortOrder, menus.sortOrder, menus.menuId),
  ]);

  return <main className="min-h-dvh bg-slate-100 p-6 text-slate-900">
    <ManagementPageHeader maxWidth="max-w-6xl" title="메뉴 관리" />
    <MenuManagementClient categories={categories} initialMenus={menuRows} />
  </main>;
}
