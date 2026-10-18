import { redirect } from "next/navigation";
import { db } from "@/db";
import { diningTables } from "@/db/schema";
import { resolveTableLayout } from "@/lib/table-layout";
import LayoutEditor from "@/app/pos/layout/LayoutEditor";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

export default async function AdminTablesPage() {
  const member = await getCurrentAdminStaff();
  if (!member) redirect("/admin/login");
  const tables = await db.select().from(diningTables).orderBy(diningTables.sortOrder);
  return <LayoutEditor embedded readOnly={member.adminPermission === "READ_ONLY"} returnPath="/admin" tables={tables.map((table, index) => ({ ...table, ...resolveTableLayout({ positionX: table.positionX === null ? undefined : Number(table.positionX), positionY: table.positionY === null ? undefined : Number(table.positionY), layoutWidth: table.layoutWidth === null ? undefined : Number(table.layoutWidth), layoutHeight: table.layoutHeight === null ? undefined : Number(table.layoutHeight), rotation: table.rotation }, index) }))} />;
}
