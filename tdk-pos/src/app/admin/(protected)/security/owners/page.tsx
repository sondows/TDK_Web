import OwnerManagement from "./OwnerManagement";
import styles from "../../../admin.module.css";

export default function OwnersPage() {
  return <div className={styles.content}>
    <div className={styles.pageHeading}><h1>보안 → 최고관리자 관리</h1><p className={styles.pageDescription}>최고관리자 지정과 보안 비밀번호 설정 상태를 관리합니다.</p></div>
    <OwnerManagement />
  </div>;
}
