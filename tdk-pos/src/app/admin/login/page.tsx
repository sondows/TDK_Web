import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import AdminLoginForm from "./AdminLoginForm";

export default async function AdminLoginPage() {
  if (await getCurrentAdminStaff()) redirect("/tdkadm");
  return <AdminLoginForm />;
}
