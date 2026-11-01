import TrustTokenManagement from "./TrustTokenManagement";
import styles from "../../../admin.module.css";

export default function AdminDevicesPage() {
  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>보안 → 신뢰 토큰 관리</h1>
      <p className={styles.pageDescription}>프로그램별 신뢰 토큰을 확인하고 개별 폐기합니다.</p>
    </div>
    <TrustTokenManagement />
  </div>;
}
