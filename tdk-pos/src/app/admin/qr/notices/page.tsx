import { redirect } from "next/navigation";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { listQrNotices } from "@/lib/qr-notices";
import QrNoticeManagementClient, { type QrNoticeAdminItem } from "./QrNoticeManagementClient";

export const dynamic = "force-dynamic";

export default async function QrNoticesPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");

  let notices: QrNoticeAdminItem[] = [];
  let loadError = "";
  try {
    notices = (await listQrNotices()).map(notice => {
      const korean = notice.translations.ko!;
      return { id: String(notice.noticeId), title: korean.title, blocks: korean.blocks, isActive: notice.isActive, sortOrder: notice.sortOrder, updatedAt: notice.updatedAt.toISOString() };
    });
  } catch {
    loadError = "안내문을 불러오지 못했습니다. 데이터베이스 마이그레이션 적용 여부를 확인해 주세요.";
  }

  return <AdminWorkspaceShell canManageMenu userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>QR 안내문</h1><p className={styles.pageDescription}>고객 QR에 제목을 표시하고, 선택하면 글과 사진을 상세 안내로 보여줍니다.</p></div>
      <QrNoticeManagementClient initialNotices={notices} initialError={loadError} />
    </div>
  </AdminWorkspaceShell>;
}
