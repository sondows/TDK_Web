import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { menuCategories, menuComponents, menuImages, menus } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { getMenuManager } from "@/lib/management-auth";
import MenuManagementClient from "@/app/pos/admin/menus/MenuManagementClient";
import AdminWorkspaceShell from "../AdminWorkspaceShell";
import styles from "../admin.module.css";

export default async function AdminMenuManagementPage() {
  const actor = await getMenuManager();
  if (!actor || !canManageMenu(actor.role)) redirect("/admin/login");
  const isCenterOwner = Boolean(await getCurrentAdminStaff());
  const componentMenu = alias(menus, "component_menu");
  const [categories, menuRows, componentMenuRows, componentRows] = await Promise.all([
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, sortOrder: menuCategories.sortOrder }).from(menuCategories).where(eq(menuCategories.isActive, 1)).orderBy(menuCategories.sortOrder, menuCategories.categoryId),
    db.select({ menuId: menus.menuId, menuCode: menus.menuCode, name: menus.posName, price: menus.price, categoryId: menus.categoryId, categoryName: menuCategories.posName, categorySortOrder: menuCategories.sortOrder, countsAsPerson: menus.countsAsPerson, isActive: menus.isActive, sortOrder: menus.sortOrder, imageUrl: menuImages.imageUrl }).from(menus).innerJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId)).leftJoin(menuImages, and(eq(menuImages.menuId, menus.menuId), eq(menuImages.imageType, "POS"), eq(menuImages.isActive, 1))).orderBy(menuCategories.sortOrder, menus.sortOrder, menus.menuId),
    db.select({ menuId: menus.menuId, name: menus.posName, price: menus.price }).from(menus).where(eq(menus.isActive, 1)).orderBy(menus.posName),
    db.select({ menuComponentId: menuComponents.menuComponentId, parentMenuId: menuComponents.parentMenuId, componentMenuId: componentMenu.menuId, itemName: componentMenu.posName, price: componentMenu.price, qtyPerUnit: menuComponents.qtyPerUnit, printOnKitchen: menuComponents.printOnKitchen, printOnReceipt: menuComponents.printOnReceipt, sortOrder: menuComponents.sortOrder }).from(menuComponents).innerJoin(componentMenu, eq(componentMenu.menuId, menuComponents.componentMenuId)).orderBy(menuComponents.sortOrder, menuComponents.menuComponentId),
  ]);
  const componentsByMenu = new Map<number, typeof componentRows>();
  componentRows.forEach(component => componentsByMenu.set(component.parentMenuId, [...(componentsByMenu.get(component.parentMenuId) ?? []), component]));
  const menusWithComponents = menuRows.map(menu => ({ ...menu, components: componentsByMenu.get(menu.menuId) ?? [] }));
  return <AdminWorkspaceShell menuOnly={!isCenterOwner} showLogout={isCenterOwner} userName={`${actor.staff.name} · ${actor.role}`}>
    <div className={styles.content}><div className={styles.pageHeading}><h1>메뉴 관리</h1><p className={styles.pageDescription}>POS 메뉴와 구성 메뉴를 관리합니다.</p></div><MenuManagementClient categories={categories} initialMenus={menusWithComponents} componentMenus={componentMenuRows} /></div>
  </AdminWorkspaceShell>;
}
