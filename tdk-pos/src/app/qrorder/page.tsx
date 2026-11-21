import QrOrderHistory from "./QrOrderHistory";
import QrDevTestBadge from "./QrDevTestBadge";
import { emptyQrPublicTitleSettings } from "@/lib/qr-title-model";
import { getQrScreenTitleData } from "@/lib/qr-title-settings";
import { listPublicQrNotices } from "@/lib/qr-notices";
import type { QrPublicNotice } from "@/lib/qr-notice-model";

export const dynamic = "force-dynamic";

export default async function QrOrderPage() {
  let titleData = emptyQrPublicTitleSettings();
  let notices: QrPublicNotice[] = [];
  try { titleData = await getQrScreenTitleData("order_history"); } catch { titleData.storeName = "탑동김치찌개"; /* Keep a readable fallback if public title settings are unavailable. */ }
  try { notices = await listPublicQrNotices(); } catch { /* Preserve order history if public notices are unavailable. */ }
  if (!titleData.storeName.trim()) titleData.storeName = "탑동김치찌개";
  return <><QrDevTestBadge /><QrOrderHistory titleData={titleData} notices={notices} /></>;
}
