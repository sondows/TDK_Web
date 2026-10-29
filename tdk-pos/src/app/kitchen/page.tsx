import { getCurrentKdsStaff } from "@/lib/kds-auth";
import KitchenClient from "./KitchenClient";
import KitchenLogin from "./KitchenLogin";
import KitchenPinChange from "./KitchenPinChange";
import { getKdsNetworkContext } from "@/lib/kds-network-server";
import { maskEmployeeLoginId } from "@/lib/employee-login-id";

export default async function KitchenPage() {
  const staff = await getCurrentKdsStaff({ allowPinChange: true });
  if (!staff) {
    const network = await getKdsNetworkContext();
    return <KitchenLogin internalNetwork={network.isInternal} />;
  }
  return staff.kdsPinChangeRequired === 1 ? <KitchenPinChange /> : <KitchenClient staffName={maskEmployeeLoginId(staff.loginId)} />;
}
