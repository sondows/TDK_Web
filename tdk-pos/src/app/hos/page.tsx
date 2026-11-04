import HosHome from "./HosHome";
import HosLogin from "./HosLogin";
import { getCurrentHosStaff } from "@/lib/hos-auth";

export const dynamic = "force-dynamic";

export default async function HosPage() {
  const staff = await getCurrentHosStaff();
  return staff ? <HosHome staffLoginId={staff.loginId} /> : <HosLogin />;
}
