import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

export default async function AdminStoreSettingsPage() {
  if (!await getCurrentAdminStaff()) redirect("/tdkadm/login");
  redirect("/tdkadm/settings/printing/nameplate");
}
