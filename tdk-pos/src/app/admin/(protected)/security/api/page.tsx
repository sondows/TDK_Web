import ApiManagement from "./ApiManagement";
import styles from "../../../admin.module.css";

export default function ApiManagementPage() {
  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>보안 → API 관리</h1>
      <p className={styles.pageDescription}>외부 서비스 연동에 사용하는 API 인증정보를 안전하게 등록하고 관리합니다.</p>
    </div>
    <ApiManagement />
  </div>;
}
