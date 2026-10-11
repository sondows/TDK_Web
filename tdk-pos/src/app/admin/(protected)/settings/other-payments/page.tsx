import OtherPaymentSettingsClient from "../../../../pos/admin/settings/payment/other/OtherPaymentSettingsClient";
import { getReceiptLogoFileName, readReceiptLogo } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";

export default async function AdminOtherPaymentSettingsPage() {
  const [storeInfo, logoFileName] = await Promise.all([getStoreInfo(), getReceiptLogoFileName()]);
  const logoDataUrl = logoFileName
    ? await readReceiptLogo(logoFileName).then(image => `data:image/png;base64,${image.toString("base64")}`).catch(() => null)
    : null;
  return <OtherPaymentSettingsClient logoDataUrl={logoDataUrl} storeName={storeInfo.storeName} />;
}
