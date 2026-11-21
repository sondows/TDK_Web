import { redirect } from "next/navigation";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { getAdminSidebarPermissions } from "@/lib/admin-sidebar-permissions";
import { getQrPublicTitleData, getQrTitleScreenSettings, listQrTitleScreenPhotos } from "@/lib/qr-title-settings";
import { defaultQrTitleScreenSettings, emptyQrPublicTitleSettings, type QrPublicTitleSettings, type QrTitleScreenId, type QrTitleScreenSettings } from "@/lib/qr-title-model";
import { listPublicQrNotices } from "@/lib/qr-notices";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import QrTitleManagementClient, { type QrTitleAdminPhoto } from "./QrTitleManagementClient";

export const dynamic = "force-dynamic";

export default async function QrTitleSettingsPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");
  const sidebarPermissions = await getAdminSidebarPermissions(staff);

  let loadError = "";
  let previewSettings: QrPublicTitleSettings = emptyQrPublicTitleSettings();
  let orderSettings: QrTitleScreenSettings = defaultQrTitleScreenSettings("order");
  let historySettings: QrTitleScreenSettings = defaultQrTitleScreenSettings("order_history");
  let orderPhotos: QrTitleAdminPhoto[] = [];
  let historyPhotos: QrTitleAdminPhoto[] = [];
  let previewNotices: QrPublicNotice[] = [];
  try {
    const publicSettings = await getQrPublicTitleData();
    const [storedOrderPhotos, storedHistoryPhotos, savedOrderSettings, savedHistorySettings] = await Promise.all([
      listQrTitleScreenPhotos("order"), listQrTitleScreenPhotos("order_history"),
      getQrTitleScreenSettings("order", publicSettings.storeName), getQrTitleScreenSettings("order_history", publicSettings.storeName),
    ]);
    const adminPhotos = (screenId: QrTitleScreenId, storedPhotos: Awaited<ReturnType<typeof listQrTitleScreenPhotos>>) => storedPhotos.map(photo => ({
      ...photo,
      previewUrl: `/api/admin/qr-title/photos/${photo.photoId}?kind=preview&asset=${photo.assetId}&screen=${screenId}`,
      sourceUrl: `/api/admin/qr-title/photos/${photo.photoId}?kind=source&asset=${photo.assetId}&screen=${screenId}`,
    }));
    orderPhotos = adminPhotos("order", storedOrderPhotos);
    historyPhotos = adminPhotos("order_history", storedHistoryPhotos);
    orderSettings = savedOrderSettings;
    historySettings = savedHistorySettings;
    previewSettings = publicSettings;
  } catch {
    loadError = "타이틀 사진 설정을 불러오지 못했습니다. 사진 기능은 화면에서 다시 시도해 주세요.";
  }

  try { previewNotices = await listPublicQrNotices(); } catch { /* Keep the title preview available if public notices cannot be loaded. */ }

  return <AdminWorkspaceShell {...sidebarPermissions} userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>QR 타이틀설정</h1><p className={styles.pageDescription}>주문내역과 주문하기 화면의 타이틀을 각각 설정합니다.</p></div>
      <div className="space-y-6">
        <QrTitleManagementClient screenId="order_history" screenLabel="주문내역 설정" initialSettings={historySettings} initialPhotos={historyPhotos} initialError={loadError} previewNotices={previewNotices} previewSettings={previewSettings} />
        <QrTitleManagementClient screenId="order" screenLabel="주문하기 설정" initialSettings={orderSettings} initialPhotos={orderPhotos} initialError={loadError} previewNotices={previewNotices} previewSettings={previewSettings} />
      </div>
    </div>
  </AdminWorkspaceShell>;
}
