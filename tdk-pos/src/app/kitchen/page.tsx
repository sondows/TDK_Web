import { getCurrentKdsStaff } from "@/lib/kds-auth";
import KitchenClient from "./KitchenClient";
import KitchenLogin from "./KitchenLogin";

export default async function KitchenPage() {
  const staff = await getCurrentKdsStaff();
  return staff ? <KitchenClient staffName={staff.name} /> : <KitchenLogin />;
}
