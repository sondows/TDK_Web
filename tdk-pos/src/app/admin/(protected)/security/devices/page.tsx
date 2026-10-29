import DeviceManagement from "./DeviceManagement";
import styles from "../../../admin.module.css";

export default function AdminDevicesPage() {
  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>보안 → 기기관리</h1>
      <p className={styles.pageDescription}>POS, ADM, KDS, HOS 등록 요청을 승인하고 등록된 기기의 권한과 인증 상태를 관리합니다.</p>
    </div>
    <DeviceManagement />
  </div>;
}
