import { getCurrentKdsStaff } from "@/lib/kds-auth";
import KitchenClient from "./KitchenClient";
import KitchenLogin from "./KitchenLogin";
import { maskEmployeeLoginId } from "@/lib/employee-login-id";

export default async function KitchenPage() {
  const staff = await getCurrentKdsStaff();
  if (!staff) return <KitchenLogin />;
  return <KitchenClient staffName={maskEmployeeLoginId(staff.loginId)} />;
}
