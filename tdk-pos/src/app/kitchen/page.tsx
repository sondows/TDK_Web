import { getCurrentKdsAccount } from "@/lib/kds-auth";
import KitchenClient from "./KitchenClient";
import KitchenLogin from "./KitchenLogin";

export default async function KitchenPage() {
  const account = await getCurrentKdsAccount();
  return account ? <KitchenClient staffName={account.loginId} /> : <KitchenLogin />;
}
