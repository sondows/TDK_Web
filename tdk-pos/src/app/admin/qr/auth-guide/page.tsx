import { redirect } from "next/navigation";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getAdminSidebarPermissions } from "@/lib/admin-sidebar-permissions";
import { canManageMenu } from "@/lib/permissions";
import { getQrAuthGuide } from "@/lib/qr-auth-guide-settings";
import QrAuthGuideEditor from "./QrAuthGuideEditor";

export const dynamic = "force-dynamic";

export default async function QrAuthGuidePage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");
  const [sidebar, guide] = await Promise.all([
    getAdminSidebarPermissions(staff),
    getQrAuthGuide().catch(() => null),
  ]);
  return <AdminWorkspaceShell {...sidebar} userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>인증버튼</h1><p className={styles.pageDescription}>고객의 QR 인증창에 표시할 제목, 안내 문구, 모니터 사진을 설정합니다.</p></div>
      {guide ? <QrAuthGuideEditor initialGuide={guide} /> : <p role="alert">인증 안내를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>}
    </div>
  </AdminWorkspaceShell>;
}
