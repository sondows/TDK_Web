import { redirect } from "next/navigation";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { listQrTitlePhotos } from "@/lib/qr-title-settings";
import { getQrPublicTitleData } from "@/lib/qr-title-settings";
import { emptyQrPublicTitleSettings, type QrPublicTitleSettings } from "@/lib/qr-title-model";
import QrTitleManagementClient, { type QrTitleAdminPhoto } from "./QrTitleManagementClient";

export const dynamic = "force-dynamic";

export default async function QrTitleSettingsPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");

  let photos: QrTitleAdminPhoto[] = [];
  let loadError = "";
  let previewSettings: QrPublicTitleSettings = emptyQrPublicTitleSettings();
  try {
    const [storedPhotos, publicSettings] = await Promise.all([listQrTitlePhotos(), getQrPublicTitleData()]);
    photos = storedPhotos.map(photo => ({
      ...photo,
      previewUrl: `/api/admin/qr-title/photos/${photo.photoId}?kind=preview&asset=${photo.assetId}`,
      sourceUrl: `/api/admin/qr-title/photos/${photo.photoId}?kind=source&asset=${photo.assetId}`,
    }));
    previewSettings = publicSettings;
  } catch {
    loadError = "타이틀 사진 설정을 불러오지 못했습니다. 사진 기능은 화면에서 다시 시도해 주세요.";
  }

  return <AdminWorkspaceShell canManageMenu userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>QR 타이틀설정</h1><p className={styles.pageDescription}>고객 화면에 표시할 상호명과 보조 문구, 상단 사진을 설정합니다.</p></div>
      <QrTitleManagementClient initialPhotos={photos} initialError={loadError} previewSettings={previewSettings} />
    </div>
  </AdminWorkspaceShell>;
}
