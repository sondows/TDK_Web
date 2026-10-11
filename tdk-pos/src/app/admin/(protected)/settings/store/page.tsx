import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

export default async function AdminStoreSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/admin/login");
  redirect("/admin/settings/printing/nameplate");
}
