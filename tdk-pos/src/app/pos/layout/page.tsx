import { redirect } from "next/navigation";
import { db } from "@/db";
import { diningTables } from "@/db/schema";
import { getPrivilegedStaff } from "@/lib/permissions";
import LayoutEditor from "./LayoutEditor";
import { resolveTableLayout } from "@/lib/table-layout";

export default async function LayoutPage() {
  const staff = await getPrivilegedStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "OWNER") redirect("/pos");
  const tables = await db.select().from(diningTables).orderBy(diningTables.sortOrder);
  return <LayoutEditor tables={tables.map((table, index) => ({ ...table, ...resolveTableLayout({ positionX: table.positionX === null ? undefined : Number(table.positionX), positionY: table.positionY === null ? undefined : Number(table.positionY), layoutWidth: table.layoutWidth === null ? undefined : Number(table.layoutWidth), layoutHeight: table.layoutHeight === null ? undefined : Number(table.layoutHeight), rotation: table.rotation }, index) }))} />;
}
