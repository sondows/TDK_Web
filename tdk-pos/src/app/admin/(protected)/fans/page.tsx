import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import FanManagementClient from "./FanManagementClient";

export default async function FansPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (staff.role !== "OWNER") redirect("/tdkadm");
  return <main className="p-4"><h1 className="text-2xl font-bold">선풍기관리</h1><FanManagementClient /></main>;
}
