import StaffManagement from "@/app/admin/staff/StaffManagement";
import styles from "../../../admin.module.css";

export default function SecurityStaffPage() {
  return <div className={styles.content}>
    <div className={styles.pageHeading}><h1>보안 → 직원관리</h1><p className={styles.pageDescription}>직원별 프로그램 접근 권한과 공통 PIN을 관리합니다.</p></div>
    <StaffManagement />
  </div>;
}
