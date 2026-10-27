import { getCurrentKdsStaff } from "@/lib/kds-auth";
import KitchenClient from "./KitchenClient";
import KitchenLogin from "./KitchenLogin";
import KitchenPinChange from "./KitchenPinChange";

export default async function KitchenPage() {
  const staff = await getCurrentKdsStaff({ allowPinChange: true });
  if (!staff) return <KitchenLogin />;
  return staff.kdsPinChangeRequired === 1 ? <KitchenPinChange /> : <KitchenClient staffName={staff.name} />;
}
