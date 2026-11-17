import QrMenuClient from "@/app/qr/QrMenuClient";
import { emptyQrPublicTitleSettings } from "@/lib/qr-title-model";
import { getQrPublicTitleData } from "@/lib/qr-title-settings";
import { listPublicQrNotices } from "@/lib/qr-notices";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import QrDevTestBadge from "../QrDevTestBadge";

export const dynamic = "force-dynamic";

export default async function QrOrderMenuPage() {
  let initialTitleData = emptyQrPublicTitleSettings();
  let notices: QrPublicNotice[] = [];
  try { initialTitleData = await getQrPublicTitleData(); } catch { initialTitleData.storeName = "탑동김치찌개"; /* Keep a readable fallback if public title settings are unavailable. */ }
  try { notices = await listPublicQrNotices(); } catch { /* Preserve menu ordering if public notices are unavailable. */ }
  if (!initialTitleData.storeName.trim()) initialTitleData.storeName = "탑동김치찌개";
  return <><QrDevTestBadge /><QrMenuClient tableOrderMode initialTitleData={initialTitleData} notices={notices} /></>;
}
