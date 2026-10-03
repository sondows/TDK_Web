import StaffManagement from "../../staff/StaffManagement";
import styles from "../../admin.module.css";

export default function StaffPage() {
  return (
    <div className={styles.content}>
      <div className={styles.pageHeading}>
        <h1>직원관리</h1>
        <p className={styles.pageDescription}>직원을 등록하고 POS 및 관리센터 접근 권한을 관리합니다.</p>
      </div>
      <StaffManagement />
    </div>
  );
}
