import { redirect } from "next/navigation";
import { getPrivilegedStaff } from "@/lib/permissions";

export default async function PosAdminPage() {
  const staff = await getPrivilegedStaff();
  if (staff?.role === "MANAGER") redirect("/admin/menus");
  redirect("/admin");
}
