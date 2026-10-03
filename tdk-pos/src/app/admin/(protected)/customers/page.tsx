import CustomerManagement from "../../customers/CustomerManagement";
import styles from "../../admin.module.css";

export default function CustomersPage() {
  return (
    <div className={styles.content}>
      <div className={styles.pageHeading}>
        <h1>고객관리</h1>
        <p className={styles.pageDescription}>고객 등록 및 고객 정보를 관리합니다.</p>
      </div>
      <CustomerManagement />
    </div>
  );
}
