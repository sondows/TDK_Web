import type { Metadata } from "next";
import QrMenuClient from "./QrMenuClient";
import { emptyQrPublicTitleSettings, type QrPublicTitleSettings } from "@/lib/qr-title-model";
import { getQrPublicTitleData } from "@/lib/qr-title-settings";
import { listPublicQrNotices } from "@/lib/qr-notices";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import { qrPageIcons } from "@/lib/qr-manifest";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "탑동김치찌개",
  applicationName: "탑동김치찌개",
  description: "탑동김치찌개 QR 메뉴",
  manifest: "/qr/manifest.webmanifest?v=2",
  icons: qrPageIcons,
  appleWebApp: { capable: true, title: "탑동김치찌개", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export default async function QrMenuPage() {
  let initialTitleData: QrPublicTitleSettings = emptyQrPublicTitleSettings();
  let notices: QrPublicNotice[] = [];
  try { initialTitleData = await getQrPublicTitleData(); } catch { /* QR menu remains available without title settings. */ }
  try { notices = await listPublicQrNotices(); } catch { /* QR ordering remains available if notice migration is not installed yet. */ }
  return <QrMenuClient initialTitleData={initialTitleData} notices={notices} />;
}
