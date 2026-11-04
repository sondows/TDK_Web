import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import HosTableLayoutEditor from "./HosTableLayoutEditor";

export default async function HosTableLayoutPage() {
  const member = await getCurrentAdminStaff();
  if (!member) redirect("/tdkadm/login");
  if (member.role !== "OWNER") redirect("/tdkadm");
  return <HosTableLayoutEditor />;
}
