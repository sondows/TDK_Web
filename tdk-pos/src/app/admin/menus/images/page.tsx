import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import MenuImageManagementClient from "./MenuImageManagementClient";

export const dynamic = "force-dynamic";

export default async function AdminMenuImagesPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");
  return <AdminWorkspaceShell canManageMenu userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>메뉴 이미지</h1><p className={styles.pageDescription}>QR 메뉴 메인 이미지와 상세 이미지를 메뉴별로 등록합니다.</p></div>
      <MenuImageManagementClient />
    </div>
  </AdminWorkspaceShell>;
}
