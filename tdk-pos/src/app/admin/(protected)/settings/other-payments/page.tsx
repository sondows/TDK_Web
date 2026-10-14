import OtherPaymentSettingsClient from "../../../../pos/admin/settings/payment/other/OtherPaymentSettingsClient";
import sharp from "sharp";
import { getReceiptLogoRaster } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";

export default async function AdminOtherPaymentSettingsPage() {
  const storeInfo = await getStoreInfo();
  let logoDataUrl: string | null = null;
  let receiptLogo: Awaited<ReturnType<typeof getReceiptLogoRaster>> = null;
  let logoLoadError: string | null = null;
  try {
    receiptLogo = await getReceiptLogoRaster({ throwOnLoadError: true });
    if (receiptLogo) {
      const png = await sharp(Buffer.from(receiptLogo.pixelsBase64, "base64"), {
        raw: { width: receiptLogo.width, height: receiptLogo.height, channels: 1 },
      }).png().toBuffer();
      logoDataUrl = `data:image/png;base64,${png.toString("base64")}`;
    }
  } catch (error) {
    console.error("account transfer notice preview logo load failed", error);
    logoLoadError = error instanceof Error ? error.message : String(error);
  }
  return <OtherPaymentSettingsClient logoDataUrl={logoDataUrl} logoLoadError={logoLoadError} receiptLogo={receiptLogo} storeName={storeInfo.storeName} />;
}
